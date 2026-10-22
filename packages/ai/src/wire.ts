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

import type { AiFeature } from './egress.js';
import type { AiInvocation, AiToolDescriptor } from './provider.js';

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
 * 请求体的**传输选项**。刻意只有一个键，而且刻意不是 `RequestInit`。
 *
 * ## 🔴 `stream` 为什么不算出境数据（这条是加流式之前必须先回答的那个问题）
 *
 * `provider.ts` 的 `EGRESS_ORDER_NOTE` 写着：「流式输出看起来更流畅，但它意味着
 * **在你决定要不要之前，数据已经在路上了**。所以如果将来要加流式，必须先回答
 * '怎么在第一个字节发出前完成授权'。」
 *
 * 答案是：**heyta 的授权本来就在第一个字节之前，而且不是在每一帧之前。**
 * 对话式助手的披露是**一次性**的（`planAssistantEgress()` 在循环开始前算完，
 * 用户点头才进循环），`invokeRouted()` 的第三道闸在**网络动作之前**逐候选判。
 * 流式改变的是**响应**到达的形状，不是请求发出前的顺序 —— 一个字节的请求都
 * 还没有因为 `stream: true` 而提前发出去。
 *
 * 反过来说，`stream` 这个键本身**不携带任何用户内容**：它是一个布尔开关。
 * 所以"数据面恰好等于披露字段集合"这条不变量**没有被放宽**：
 * 出去的仍然是 `messages` / `tools`，`fields` 一个字都不用改。
 *
 * ⚠️ 也正因为如此，`stream` **不许**长成"可以塞任意键的袋子"：
 * 一旦接受第二个键（`temperature`、`response_format`…），这条回答就失效了
 * ——那些键会**改变我们发给端点的东西**，而披露里没有它们。
 */
export interface ChatRequestOptions {
  /** 要服务端按 SSE 逐帧回。省略 ⇒ 请求体与加流式之前**逐字相同**。 */
  readonly stream?: true;
}

/** `tools` → OpenAI 兼容线上的 `{tools, tool_choice}` 形状。
 *  两条路径共用（自备端点直连 / 托管档经服务端代理），以免两种打包方式各自漂移。 */
function toWireTools(tools: readonly AiToolDescriptor[]): {
  tools: readonly WireTool[];
  tool_choice: 'auto';
} {
  return {
    tools: tools.map(
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
 * @param options 传输选项，**只有 `stream`**。见下面的「`stream` 为什么不算出境数据」。
 */
export function buildChatRequestBody(
  model: string,
  invocation: Pick<AiInvocation, 'system' | 'user' | 'tools' | 'messages'>,
  options?: ChatRequestOptions,
): {
  model: string;
  messages: readonly Record<string, unknown>[];
  tools?: readonly WireTool[];
  tool_choice?: 'auto';
  stream?: true;
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
    ...(withTools ? toWireTools(invocation.tools ?? []) : {}),
    // 🔴 放在**最后**，且只在要求流式时才出现：省略时键的顺序与缺键形态
    // 与加流式之前逐字相同（`wire.spec.ts` 按原始串比对）。
    ...(options?.stream === true ? { stream: true as const } : {}),
  };
}

/**
 * 托管档的入口 URL —— **不是** OpenAI 兼容端点，是我们自己的服务端代理。
 *
 * 契约在 `server/src/ai/managed-proxy.routes.ts` 的 `ChatBodySchema`：
 * `{ feature, messages, stream? }`，**没有 `model`** ——
 * 模型由服务端配置决定（客户端能选模型 = 客户端能选我们倒贴多少钱，ADR-0021）。
 */
export function managedChatUrl(baseUrl: string): string {
  // 去掉尾斜杠再拼：`https://h.cn/` 与 `https://h.cn` 必须得到同一个串。
  return `${baseUrl.replace(/\/+$/, '')}/api/ai/managed/chat`;
}

/**
 * 两个地址是不是**同一台主机**（比主机名，忽略协议、端口、路径与尾斜杠）。
 *
 * 🔴 用途只有一个，但它是承重的：托管档的**披露**按 `candidate.endpoint` 推导，
 * 而**请求**打到宿主给的 `transport.baseUrl`。两者若不同主机，就是
 * **"披露按 A 说、字节发到 B"** —— 比没有披露更坏，因为用户以为自己知道。
 *
 * ⚠️ 解析不出主机名的（相对串、垃圾串）一律判 `false`：
 * **宁可拒发，也不放行一个说不清的目的地。**
 */
export function sameHost(a: string, b: string): boolean {
  const hostOf = (raw: string): string | undefined => {
    try {
      const host = new URL(raw).hostname.toLowerCase();
      return host === '' ? undefined : host;
    } catch {
      return undefined;
    }
  };
  const left = hostOf(a);
  return left !== undefined && left === hostOf(b);
}

/**
 * 组装**托管档**的请求体（我们自己的服务端代理）。
 *
 * 🔴 **`tools` 与 OpenAI 那条路逐字同源**（同一个 `toWireTools` 打包），
 * 服务端代理的 `ChatBodySchema` 会**照原样**转发给上游。
 * 客户端这里不做任何"托管档不支持工具"的判断 —— 那条老规矩在 launch-blockers
 * §3.2 的 (a) 方案落地时**已经解除**：代理会转发了，所以路由层不再拦。
 *
 * ⚠️ 模型由服务端配置决定（客户端能选模型 = 客户端能选我们倒贴多少钱，ADR-0021），
 * 所以 `model` **不在**这里出现，也**不在** `ChatBodySchema` 里。
 *
 * ⚠️ `messages` 仍走**同一个** `toWireMessage` 归一化，与 OpenAI 那条路逐字共用 ——
 * 托管档与自备档的对话形状不许分叉。
 */
export function buildManagedChatRequestBody(
  feature: AiFeature,
  invocation: Pick<AiInvocation, 'system' | 'user' | 'tools' | 'messages'>,
  options?: ChatRequestOptions,
): {
  feature: AiFeature;
  messages: readonly Record<string, unknown>[];
  tools?: readonly WireTool[];
  tool_choice?: 'auto';
  stream?: true;
} {
  const withTools = invocation.tools !== undefined && invocation.tools.length > 0;
  return {
    feature,
    messages: (invocation.messages ?? [
      { role: 'system', content: invocation.system },
      { role: 'user', content: invocation.user },
    ]).map(toWireMessage),
    ...(withTools ? toWireTools(invocation.tools ?? []) : {}),
    // 托管代理的 `ChatBodySchema` 里 `stream` 是可选的（见 `managed-proxy.routes.ts`），
    // 它的流式分支按 SSE 逐字节透传上游 —— 所以这里与服务端契约同形，不是新协议。
    ...(options?.stream === true ? { stream: true as const } : {}),
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
