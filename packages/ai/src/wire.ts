/**
 * OpenAI 兼容线格式的**唯一组装点**
 * ==================================
 *
 * 🔴 这个文件存在的原因：请求体的组装原来在**两处各写了一遍** ——
 * `provider.ts` 的 `createProvider()` 与 `routing.ts` 的 `attemptOnce()`，
 * 而且两边的注释**互相指着对方**说"保持同一形状"（原文：
 * 「与 `invokeRouted()` 保持同一形状（见那里的注释）」）。
 *
 * 用注释要求两边一致，就是没有要求 —— 本仓库对这件事有账：
 * `AGENTS §3.5` 那条的结尾是"抽取的收尾动作是**删掉旧的那份并加门禁**"。
 * 于是这里删掉两份、留一份，并配一条**行为级**判据
 * （`packages/ai/tests/wire.spec.ts`：同一次调用，两条路打出去的字节必须逐字相同）。
 *
 * 为什么这条线现在必须收：对话式助手要把 `messages` 从"写死的两条"
 * （`[system, user]`）换成真正的多轮数组（ADR-0045 §2 / 工单 W8）。
 * 形状有两个主人的时候加多轮，得到的会是**一条路能多轮、另一条不能**，
 * 而表现是"某些功能忽然又变成单轮了" —— 那种 bug 没有编译错误，也没有失败用例。
 *
 * ## 零依赖纪律
 *
 * `packages/ai` **零运行时依赖**（AGENTS §2）。本文件只构造 plain object，
 * 不 import 任何东西 —— `JSON.stringify` 留在调用方，好让"发出去的字节"
 * 与"组装出的结构"这两件事仍然可以分别被观测。
 */

import type { AiInvocation } from './provider.js';

/**
 * 一条对话消息。线格式的形状（`role` + `content`），不是领域概念。
 *
 * ⚠️ `toolCallId` 只在 `role === 'tool'` 有意义（OpenAI 兼容格式要求工具观察结果
 * 回填它对应的那次调用 id）。刻意**不**做"role 不是 tool 时禁止带它"这种精细类型：
 * 那需要 discriminated union，而这里的真实约束是"端点会怎么读它"，
 * 多带一个字段不会改变字节形状（省略时**不发**，见组装器）。
 */
export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly toolCallId?: string;
}

/** 一个工具声明在线上的包装形状（OpenAI 兼容）。 */
export interface WireTool {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: unknown;
  };
}

/** `/chat/completions` 的完整 URL。两条路必须拼出同一个串。 */
export function chatCompletionsUrl(endpoint: string): string {
  return `${endpoint}/chat/completions`;
}

/**
 * 请求头：`content-type` 恒定，`authorization` **只在真有密钥时**才出现。
 *
 * ⚠️ 空串也当成"没有密钥"：本机 Ollama 不需要密钥，而配置里留一个空
 * `apiKey` 字段很常见。发一个 `Bearer ` 空头会让某些端点直接 401，
 * 症状是"配了地址却连不上"，最难归因。
 */
export function chatRequestHeaders(apiKey: string | undefined): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...(apiKey !== undefined && apiKey !== '' ? { authorization: `Bearer ${apiKey}` } : {}),
  };
}

/**
 * 组装 `chat.completions` 的请求体。
 *
 * 🔴 数据面**恰好**是披露出去的那几个字段（`system` + `user`，将来是多轮 `messages`），
 * **没有别的字段** —— 这条不变量是整个出境设计的落地点：出境的数据面必须
 * 恰好等于披露字段集合，不多一个。所以这里刻意**不**接受 `invocation` 之外的东西，
 * 也刻意不往 body 里加 `temperature` / `response_format` 之类（加了就等于
 * 悄悄改变发给端点的东西）。
 *
 * ⚠️ `tools` 省略时请求体与加工具线之前**逐字相同** —— 键的顺序、缺键的形态都是判据的一部分
 * （既有测试按 `Object.keys(body)` 断言）。
 *
 * @param model 端点上用的模型名
 * @param invocation 这次调用的内容面
 */
export function buildChatRequestBody(
  model: string,
  invocation: Pick<AiInvocation, 'system' | 'user' | 'tools' | 'messages'>,
): {
  model: string;
  messages: readonly Record<string, unknown>[];
  tools?: readonly WireTool[];
  tool_choice?: 'auto';
} {
  const withTools = invocation.tools !== undefined && invocation.tools.length > 0;
  return {
    model,
    // 🔴 给了 `messages` 就以它为准（对话式助手的多轮）；否则退回写死两条
    // `[system, user]` —— 那五个既有调用点的字节形状**一个字都不许变**。
    messages: (invocation.messages ?? [
      { role: 'system', content: invocation.system },
      { role: 'user', content: invocation.user },
    ]).map(toWireMessage),
    ...(withTools
      ? {
          tools: (invocation.tools ?? []).map(
            (tool): WireTool => ({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            }),
          ),
          tool_choice: 'auto',
        }
      : {}),
  };
}

/**
 * "既没文本、也没工具调用"才是空响应。
 *
 * 🔴 判据共享、**措辞各留**：`routing.ts` 的句子要带端点名（多端点回退时
 * 用户必须知道是哪一个），`provider.ts` 的带排查建议。两边真正的分歧只可能是
 * **这个判断**，所以抽的是判断，不是那句话。
 *
 * 反过来那半边同样承重：模型可以"只调工具、不说话"，那时 `content` 为空
 * **不是**失败 —— 把它判成空响应就等于把工具路径打死。
 */
export function isEmptyModelResponse(parts: {
  text: string | undefined;
  toolCalls: readonly unknown[] | undefined;
}): boolean {
  return parts.toolCalls === undefined && (parts.text === undefined || parts.text.trim() === '');
}

/**
 * `toolCallId` → 线上的 `tool_call_id`；**没有就整个键不发**。
 *
 * 🔴 这个"省略时逐字相同"的纪律是承重的：四个既有面板 + 单步工具调用的请求体
 * 形状不许因为多轮支持而改变（有测试按 `Object.keys()` 与原始串比对钉住）。
 */
function toWireMessage(message: ChatMessage): Record<string, unknown> {
  return {
    role: message.role,
    content: message.content,
    ...(message.toolCallId === undefined ? {} : { tool_call_id: message.toolCallId }),
  };
}

/**
 * 这次调用**实际会发出去多少字节**。
 *
 * 🔴 存在的唯一理由：`MAX_ASSISTANT_EGRESS_BYTES` 要在**发送之前**判，
 * 而判据必须吃"真要发的那段 JSON"，不能吃任何估计值 —— 估算是第二份事实源，会漂。
 *
 * ⚠️ 它**不返回请求体**，只返回长度：线格式组装器仍然不出包
 * （工单 W7 刚删掉过两份各自拼请求体的实现）。
 */
export function egressBytesFor(model: string, invocation: Pick<AiInvocation, 'system' | 'user' | 'tools' | 'messages'>): number {
  return new TextEncoder().encode(JSON.stringify(buildChatRequestBody(model, invocation))).length;
}
