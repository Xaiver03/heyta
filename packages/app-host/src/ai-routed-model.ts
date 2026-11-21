/**
 * `createRoutedModelCall` —— 把 `runCloudAgentTurn` 的 `callModel` 接到
 * `packages/ai` 的 `invokeRouted`（**唯一出境执行点**：走云端网关 + 既有出境闸门 + 熔断）。
 *
 * 这条适配器的意义：让"设备本地循环（`runCloudAgentTurn`）+ 云端模型（`invokeRouted`）
 * + 云端工具（`CloudToolTransport`）”串成**一个生产函数**，而不是三块各自正确的零件。
 *
 * ## 硬边界（都继承自既有设计，不新造）
 *
 * - **模型调用只走 `invokeRouted`**：`feature='tool-calling'`、`tools` 作为 `AiToolDescriptor` 进请求体，
 *   `fields` 必须含 `tools`（工具名/说明是出境数据）。
 * - **不重新拼线格式**：只组装 `AiInvocation`，请求体由 `packages/ai` 的 `wire.ts` 生成。
 * - `invoke` 可注入（测试离线），默认就是 `invokeRouted`。
 */
import {
  DEFAULT_ROUTING_POLICY,
  invokeRouted,
  type AiFeature,
  type AiInvocation,
  type AiRoutingConfig,
  type AiRoutingPolicy,
  type AiToolCall,
  type ChatMessage,
  type EgressConsent,
  type RoutedDeps,
  type RoutedOutcome,
} from '@heyta/ai';

import type { CloudToolDescriptor } from './ai-cloud-tools.js';
import type { HarnessMessage, HarnessModelReply, HarnessToolCall } from './agent-harness.js';

/** 可注入的路由调用（默认即真实 `invokeRouted`）。 */
export type RoutedInvoke = (
  config: AiRoutingConfig,
  invocation: AiInvocation,
  consents: readonly EgressConsent[],
  policy: AiRoutingPolicy,
  deps: RoutedDeps,
) => Promise<RoutedOutcome>;

export interface RoutedModelCallOptions {
  readonly routing: AiRoutingConfig;
  readonly consents: readonly EgressConsent[];
  readonly policy?: AiRoutingPolicy;
  readonly deps?: RoutedDeps;
  /** 功能档；默认 `'tool-calling'`。 */
  readonly feature?: AiFeature;
  /** 注入以便离线测试；默认真实 `invokeRouted`。 */
  readonly invoke?: RoutedInvoke;
}

/** 把循环里的 `HarnessMessage` 转成线格式消息（与 `ai-assistant` 同构：tool 结果带 toolCallId）。 */
export function harnessMessagesToChat(messages: readonly HarnessMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      out.push({ role: 'system', content: typeof m.content === 'string' ? m.content : '' });
      continue;
    }
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
      continue;
    }
    if (m.role === 'assistant') {
      // 与 ai-assistant 同构：带工具调用的 assistant 帧**不单独发出**（工具结果以 tool 帧回填）。
      if (m.toolCalls !== undefined && m.toolCalls.length > 0) continue;
      if (m.content !== '') out.push({ role: 'assistant', content: m.content });
      continue;
    }
    // tool
    out.push({
      role: 'tool',
      content: m.content,
      ...(m.toolCallId === undefined ? {} : { toolCallId: m.toolCallId }),
    });
  }
  return out;
}

/** `arguments` 原文（通常是 JSON 字符串）→ 对象；坏 JSON 给 `{}`（服务端会按 schema 拒）。 */
export function parseToolCallArguments(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    /* 落到下面 */
  }
  return {};
}

/**
 * 造一个 `callModel`：每步把（消息 + 工具描述）转成 `AiInvocation`，经路由层发出去，
 * 再把 `AiSuggestion` 翻成循环需要的 `HarnessModelReply`（文本 + 工具调用）。
 */
export function createRoutedModelCall(
  options: RoutedModelCallOptions,
): (request: { messages: readonly HarnessMessage[]; tools: readonly CloudToolDescriptor[] }) => Promise<HarnessModelReply> {
  const invoke: RoutedInvoke = options.invoke ?? (invokeRouted as unknown as RoutedInvoke);
  const feature = options.feature ?? 'tool-calling';
  const policy = options.policy ?? DEFAULT_ROUTING_POLICY;
  const deps = options.deps ?? {};

  return async ({ messages, tools }) => {
    const systemMsg = messages.find((m) => m.role === 'system');
    const system = systemMsg !== undefined && typeof systemMsg.content === 'string' ? systemMsg.content : '';
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const user = lastUser !== undefined && typeof lastUser.content === 'string' ? lastUser.content : '';

    const invocation: AiInvocation = {
      feature,
      system,
      user,
      // 出境披露：文本 + 工具名/说明（tools 是出境数据，必须写进 fields）。
      fields: ['text', 'tools'],
      tools: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
      messages: harnessMessagesToChat(messages),
    };

    const outcome = await invoke(options.routing, invocation, options.consents, policy, deps);
    const result = outcome.result;
    if (!result.ok) throw new Error(result.message);

    const suggestion = result.suggestion;
    const toolCalls: HarnessToolCall[] = (suggestion.toolCalls ?? []).map((c: AiToolCall) => ({
      id: c.id,
      name: c.name,
      arguments: parseToolCallArguments(c.arguments),
    }));
    return toolCalls.length > 0 ? { text: suggestion.text, toolCalls } : { text: suggestion.text };
  };
}
