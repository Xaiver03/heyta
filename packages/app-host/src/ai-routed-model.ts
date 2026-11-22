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
import { TOOL_ENVELOPE_EGRESS_FIELDS } from '@heyta/local-api';
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
  /**
   * 文本流式回调（逐片）。给了它，`invokeRouted` 会带 `stream:true` 并逐片回调；
   * 只转发 `type:'text'` 的片段（思考片段不算答案）。移动端 Hermes 无 TextDecoder 时
   * `invokeRouted` 自动退回非流式（无需这里判断）。
   */
  readonly onTextDelta?: (text: string) => void;
  /** 透传到线协议的 tool_choice（默认不设=auto）。 */
  readonly toolChoice?: import('@heyta/ai').WireToolChoice;
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
      // 带工具调用的 assistant 帧必须原样回传（真实 OpenAI 兼容端点要求 tool 帧前有
      // 对应的 assistant.tool_calls；否则多步第二次调用 400）。文本帧照发。
      if (m.toolCalls !== undefined && m.toolCalls.length > 0) {
        out.push({
          role: 'assistant',
          content: m.content,
          toolCalls: m.toolCalls.map((c) => ({ id: c.id, name: c.name, arguments: JSON.stringify(c.arguments) })),
        });
        continue;
      }
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

/** 收集一段工具观测结果里「一层 + 二层」出现过的字段名（披露复查用，与 ai-assistant 同口径）。 */
function collectFieldNames(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectFieldNames(v, out);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.add(k);
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        for (const k2 of Object.keys(v as Record<string, unknown>)) out.add(k2);
      }
    }
  }
}

/** 本轮可达工具允许出境的**字段名并集**（`text` / `tools` + 各工具 egressFields + 信封）。 */
function disclosedFields(tools: readonly CloudToolDescriptor[]): string[] {
  const set = new Set<string>(['text', 'tools']);
  for (const t of tools) for (const f of t.egressFields ?? []) set.add(f.split('.')[1] ?? f);
  for (const e of TOOL_ENVELOPE_EGRESS_FIELDS) set.add(e.split('.')[1] ?? e);
  return [...set];
}

/** 回送工具观测前复查：实际出现的字段必须 ⊆ 已披露字段（否则停发，绝不多发）。 */
function assertToolObservationsDisclosed(messages: readonly HarnessMessage[], allowed: Set<string>): void {
  for (const m of messages) {
    if (m.role !== 'tool') continue;
    let data: unknown;
    try {
      data = JSON.parse(m.content);
    } catch {
      continue;
    }
    const names = new Set<string>();
    collectFieldNames(data, names);
    const outside = [...names].filter((n) => !allowed.has(n));
    if (outside.length > 0) {
      throw new Error(`egress-outside-disclosed-set: 工具观测含未披露字段 ${outside.join('、')}`);
    }
  }
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

    const fields = disclosedFields(tools);
    assertToolObservationsDisclosed(messages, new Set(fields));
    const invocation: AiInvocation = {
      feature,
      system,
      user,
      // 出境披露：文本 + 工具名/说明 + **本轮可达工具观测字段的并集**（工具结果会回灌给模型 = 出境）。
      fields,
      tools: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
      ...(options.toolChoice === undefined ? {} : { toolChoice: options.toolChoice }),
      messages: harnessMessagesToChat(messages),
    };

    const routedDeps =
      options.onTextDelta === undefined
        ? deps
        : {
            ...deps,
            onDelta: (delta: { type: string; delta?: string }) => {
              if (delta.type === 'text' && typeof delta.delta === 'string') options.onTextDelta?.(delta.delta);
            },
          };
    const outcome = await invoke(options.routing, invocation, options.consents, policy, routedDeps);
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
