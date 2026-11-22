/**
 * 云端 Agent 循环（**引擎无关**的"设备本地 loop"）
 * ================================================
 *
 * 这是设计里"两引擎、一契约"的**基线引擎**：
 *   · 本文件：`runCloudAgentTurn` —— 纯 TS 的多步循环，模型调用与工具执行都**注入**，
 *     因此零网络、零 Node 依赖，**桌面/手机/平板/Web 都能跑**（Hermes 也行）。
 *   · 另一引擎：PI 内核（`@earendil-works/pi-agent-core`）—— 桌面走 SDK，
 *     复用同一份 `CloudAgentTool`（见 `ai-cloud-tools.ts` 的 `toCloudAgentTools`）。
 *
 * ## 它做什么
 *
 * 标准的 function-calling 循环（OpenAI / Anthropic 通用形状）：
 *
 * ```text
 * messages = [system, user]
 * loop (<= maxSteps):
 *   reply = callModel({ messages, tools })           // 由调用方注入（走云端网关）
 *   if reply 没有 toolCalls:                         // 模型给最终回答
 *     return reply.text
 *   for call in reply.toolCalls:                      // 工具只打云端
 *     result = transport.invoke(call.name, call.arguments)
 *     把 assistant(toolCalls) 与 tool(result/error) 追加进 messages
 * ```
 *
 * ## 边界（刻意的）
 *
 * - **不碰网络**：`callModel` 与 `transport` 都是注入项。这样本模块可在 node 里单测，
 *   也可在移动端把 `callModel` 接到 `invokeRouted`、`transport` 接到云端工具。
 * - **不产出 op、不写库**：写入是服务端工具 API 的事；本模块只编排。
 * - **失败不吞**：工具失败会作为 `tool` 消息回给模型（`isError`），让模型换路；
 *   循环本身失败（`callModel` 抛错）则向上抛，由调用方转成人话。
 * - **有界**：`maxSteps` 到了就停，返回已得到的文本 + 明确的 `stopped` 原因。
 */
import type { CloudToolDescriptor, CloudToolTransport } from './ai-cloud-tools.js';

/** 循环里用的一条消息（与各 provider 的 messages 同形，`tool` 角色带 toolCallId）。 */
export interface HarnessMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  /** 仅 `role:'tool'`：对应哪次工具调用。 */
  readonly toolCallId?: string;
  /** 仅 `role:'assistant'` 且带工具调用时：原样回传给模型的工具调用块。 */
  readonly toolCalls?: readonly HarnessToolCall[];
}

export interface HarnessToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

/** 模型这一步的回复。只保留循环需要的最小形状。 */
export interface HarnessModelReply {
  readonly text?: string;
  readonly toolCalls?: readonly HarnessToolCall[];
}

/** 一步的执行记录（给回执 / trace 用）。 */
export interface HarnessStep {
  readonly tool: string;
  readonly ok: boolean;
  readonly error?: string;
}

export type HarnessEvent =
  | { readonly type: 'tool-started'; readonly tool: string }
  | { readonly type: 'tool-finished'; readonly tool: string; readonly ok: boolean; readonly error?: string };

export interface CloudAgentHarnessOptions {
  /** 云端工具传输（`createHttpCloudToolTransport(...)` 或测试注入）。 */
  readonly transport: CloudToolTransport;
  /** 本轮暴露给模型的工具（已按授权过滤；见 `toCloudToolDescriptors`）。 */
  readonly tools: readonly CloudToolDescriptor[];
  /**
   * 调模型。注入而非内置：生产接 `invokeRouted(...)`（走云端网关、进程内既有出境闸门），
   * 测试接脚本化函数。**必须真的带 `tools` 给模型**。
   */
  readonly callModel: (request: {
    readonly messages: readonly HarnessMessage[];
    readonly tools: readonly CloudToolDescriptor[];
  }) => Promise<HarnessModelReply>;
  readonly systemPrompt: string;
  /** 上界；默认 6（与 `MAX_ASSISTANT_TOOL_STEPS` 口径一致）。 */
  readonly maxSteps?: number;
  /** 单条工具结果上限字符数（上下文管理；超长截断并标注）。默认 8000（OpenAI/Anthropic 都建议限制工具输出体量）。 */
  readonly maxToolResultChars?: number;
  /** 单工具超时（毫秒）；超时算一次失败并回灌。默认 60000。 */
  readonly toolTimeoutMs?: number;
  /** 判定某工具是否**只读/可安全并行**；为真且一步内多调用时并发执行。默认全串行。 */
  readonly parallelSafe?: (tool: string) => boolean;
  /** 有界重试次数（仅对 `isRetryable` 为真的工具；默认 0 = 不重试）。 */
  readonly retryAttempts?: number;
  readonly retryBackoffMs?: number;
  /** 哪些工具可重试（只读/幂等）。默认复用 `parallelSafe`。 */
  readonly isRetryable?: (tool: string) => boolean;
  /**
   * 本轮运行的稳定 id（一次用户发送）。给了它就给每个工具调用派生幂等键
   * `runId:s<step>:<callId>`，让云端重试不重复落库。
   */
  readonly runId?: string;
  readonly onEvent?: (event: HarnessEvent) => void;
  /** 历史（多轮对话）；不含本轮 user。 */
  readonly history?: readonly HarnessMessage[];
}

export interface CloudAgentTurnResult {
  readonly text: string;
  readonly steps: readonly HarnessStep[];
  readonly messages: readonly HarnessMessage[];
  readonly stopped?: 'tool-steps';
}

const DEFAULT_MAX_STEPS = 6;
const DEFAULT_MAX_TOOL_RESULT_CHARS = 8000;
const DEFAULT_TOOL_TIMEOUT_MS = 60_000;

function truncateToolContent(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…[truncated ${String(text.length - limit)} chars]`;
}

/**
 * 跑一轮：多步只读/写 → 一次回答。**失败**由 `callModel` 抛错表达，本函数不吞。
 */
export async function runCloudAgentTurn(
  userText: string,
  options: CloudAgentHarnessOptions,
): Promise<CloudAgentTurnResult> {
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const maxToolResultChars = options.maxToolResultChars ?? DEFAULT_MAX_TOOL_RESULT_CHARS;
  const toolTimeoutMs = options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  const retryAttempts = Math.max(0, options.retryAttempts ?? 0);
  const retryBackoffMs = options.retryBackoffMs ?? 200;
  const isRetryable = options.isRetryable ?? options.parallelSafe ?? (() => false);

  type CallOutcome = { ok: boolean; content: string; errorText?: string };
  const runOnce = async (call: { id: string; name: string; arguments: Record<string, unknown> }, stepNo: number): Promise<CallOutcome> => {
    try {
      const idemKey = options.runId === undefined ? undefined : `${options.runId}:s${String(stepNo)}:${call.id}`;
      const invoke = options.transport.invoke(
        call.name,
        call.arguments,
        undefined,
        idemKey === undefined ? undefined : { idempotencyKey: idemKey },
      );
      const timeout = new Promise<never>((_, rej) => {
        setTimeout(() => { rej(new Error(`tool-timeout:${String(toolTimeoutMs)}ms`)); }, toolTimeoutMs);
      });
      const result = await Promise.race([invoke, timeout]);
      if (result.ok) {
        let content = JSON.stringify(result.data);
        content = truncateToolContent(content, maxToolResultChars);
        return { ok: true, content };
      }
      return { ok: false, errorText: result.message, content: `工具执行失败：${result.message}` };
    } catch (error: unknown) {
      const errorText = error instanceof Error ? error.message : '工具执行异常';
      return { ok: false, errorText, content: `工具执行失败：${errorText}` };
    }
  };
  const runOne = async (call: { id: string; name: string; arguments: Record<string, unknown> }, stepNo: number): Promise<CallOutcome> => {
    const tries = isRetryable(call.name) ? retryAttempts + 1 : 1;
    let outcome = await runOnce(call, stepNo);
    for (let attempt = 1; attempt < tries && !outcome.ok; attempt += 1) {
      await new Promise((r) => setTimeout(r, retryBackoffMs * attempt));
      outcome = await runOnce(call, stepNo);
    }
    return outcome;
  };
  const messages: HarnessMessage[] = [
    { role: 'system', content: options.systemPrompt },
    ...(options.history ?? []),
    { role: 'user', content: userText },
  ];
  const steps: HarnessStep[] = [];

  for (let step = 0; ; step += 1) {
    if (step >= maxSteps) {
      return {
        text: '',
        steps,
        messages,
        stopped: 'tool-steps',
      };
    }

    const reply = await options.callModel({ messages, tools: options.tools });
    const calls = reply.toolCalls ?? [];

    if (calls.length === 0) {
      const text = reply.text ?? '';
      messages.push({ role: 'assistant', content: text });
      return { text, steps, messages };
    }

    // 记录模型的工具调用（回传给模型时 assistant 消息要带 toolCalls）。
    messages.push({ role: 'assistant', content: reply.text ?? '', toolCalls: calls });

    const canParallel = calls.length > 1 && (options.parallelSafe?.(calls[0]!.name) ?? false) && calls.every((c) => options.parallelSafe?.(c.name) === true);
    const outcomes: CallOutcome[] = canParallel
      ? await Promise.all(calls.map(async (call) => { options.onEvent?.({ type: 'tool-started', tool: call.name }); return runOne(call, step); }))
      : [];
    for (let idx = 0; idx < calls.length; idx += 1) {
      const call = calls[idx]!;
      let outcome: CallOutcome;
      if (canParallel) {
        outcome = outcomes[idx]!;
      } else {
        options.onEvent?.({ type: 'tool-started', tool: call.name });
        outcome = await runOne(call, step);
      }
      const ok = outcome.ok;
      const errorText = outcome.errorText;
      const content = outcome.content;
      steps.push(ok ? { tool: call.name, ok } : { tool: call.name, ok, error: errorText });
      options.onEvent?.(ok ? { type: 'tool-finished', tool: call.name, ok } : { type: 'tool-finished', tool: call.name, ok, error: errorText });
      messages.push({ role: 'tool', content, toolCallId: call.id });
    }
    // 继续下一轮，把工具结果喂回模型。
  }
}
