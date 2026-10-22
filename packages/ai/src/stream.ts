/**
 * 流式（SSE）响应解析 —— 线格式的另一半
 * =======================================
 *
 * `wire.ts` 组装**请求**，本文件解析**响应**。两者是同一份契约的两面：
 * OpenAI 兼容的 `/chat/completions` 在 `stream: true` 时回的是
 * `text/event-stream`，每帧一行 `data: {...}`，最后一个数据以 `data: [DONE]` 收尾。
 *
 * ## 为什么是"纯字符串"而不是"读流"
 *
 * 读流需要 `ReadableStream` / `TextDecoder`，而这两样**不是所有宿主都有**
 * （Hermes 上 `TextDecoder` 就缺席，见 `packages/sync-core/src/encryption/web-crypto.ts` 文件头）。
 * 把字节解码与网络读取留在调用方（`routing.ts` 的 `attemptOnce`），本文件只吃
 * 已解码的字符串 —— 于是它能在**任何** JS 运行时里跑，而且测试不需要伪造流。
 *
 * ## 🔴 本文件不是第二份"响应形状"判断
 *
 * `extractContent` / `extractToolCalls`（`provider.ts`）判的是**非流式**响应，
 * 这里判的是**流式分片**（`choices[0].delta`）。两者读的是同一个字段体系、
 * 不同的层级，所以没有复用空间；但**空响应的判据仍然只有一份**
 * （`wire.ts` 的 `isEmptyModelResponse`）—— 组装完的文本与工具调用回到调用方，
 * 由同一个函数判"这是不是空响应"。
 *
 * ⚠️ 分片是**增量**，不是累积：OpenAI 兼容的 `delta.content` 是这一帧新到的那几个字。
 * 少数网关发累积文本，那样拼出来会是重复内容 —— 本文件不做前缀去重，
 * 因为"猜一个网关是累积还是增量"比"拼出来是重复的"更难诊断：前者会把
 * 真正重复的内容也吃掉。
 */

import type { AiToolCall } from './provider.js';

/** SSE 的结束哨兵。它不是 JSON，`JSON.parse` 会抛。 */
export const SSE_DONE = '[DONE]';

/**
 * 流式响应里的一个**新到**片段。
 *
 * 🔴 三种片段分开，是因为界面要用**三种不同的行**渲染它们（这正是"过程可见"的形状）：
 * 文本进气泡、思考进行内灰字、工具名进"正在调用工具"那一行。
 * 合成一个 string 就等于把这三件事又揉回一个"输出"。
 */
export type StreamDelta =
  | { readonly type: 'text'; readonly delta: string }
  /**
   * 模型的思考片段（`reasoning_content`，DeepSeek/Qwen 等在用）。
   *
   * ⚠️ 它**不是**要展示给用户的答案，而是"模型正在想什么"。界面可以折叠它，
   * 但**不能**把它当成答案正文 —— 有些模型会把已给的答案在思考里复述一遍。
   */
  | { readonly type: 'reasoning'; readonly delta: string }
  | { readonly type: 'tool-call'; readonly index: number; readonly id: string; readonly name: string };

/**
 * 把缓冲区按 SSE 帧切开，返回**完整帧**与还没收完的尾巴。
 *
 * 🔴 必须保留尾巴：一帧可能跨两个网络分片，而"半帧"里往往正好是
 * `{"choices":[{"delta":{"content":"半` —— 直接 `JSON.parse` 会把正常流打断。
 *
 * ⚠️ `\r\n` 先归一成 `\n`：SSE 规范允许两者，而按 `\n\n` 切分的实现在
 * CRLF 服务器上会**一帧都切不出来**，症状是"接了流、屏幕上一动不动"。
 */
export function splitSseFrames(buffer: string): { readonly frames: readonly string[]; readonly rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  const rest = parts.pop() ?? '';
  return { frames: parts, rest };
}

/**
 * 一帧里 `data:` 行的内容（多行按 SSE 规范用 `\n` 连接）。
 *
 * 返回 `undefined` 表示这一帧没有数据行（例如只有注释的 keep-alive 帧 `: ping`）——
 * 那不是错误，跳过即可。
 */
export function sseData(frame: string): string | undefined {
  const lines: string[] = [];
  for (const line of frame.split('\n')) {
    if (!line.startsWith('data:')) continue;
    // `data: x` 与 `data:x` 都合法；只去掉**一个**前导空格，别 trim 掉正文里的空白。
    const value = line.slice(5);
    lines.push(value.startsWith(' ') ? value.slice(1) : value);
  }
  if (lines.length === 0) return undefined;
  return lines.join('\n');
}

/** 流式响应的累加器：吃帧、吐片段、最后给出一份与非流式同形的结果。 */
export interface CompletionAccumulator {
  /** 吃一帧已 `JSON.parse` 的负载，返回这一帧产生的**新**片段。 */
  accept(payload: unknown): readonly StreamDelta[];
  /** 到目前为止的全部正文。 */
  readonly text: string;
  /** 到目前为止的全部思考（没有就是空串）。 */
  readonly reasoning: string;
  /** 到目前为止装配好的工具调用（按 `index` 顺序；没名字的槽位丢掉）。 */
  readonly toolCalls: readonly AiToolCall[];
  /** `finish_reason`（若模型给了）。 */
  readonly finishReason: string | undefined;
}

interface ToolSlot {
  id: string;
  name: string;
  arguments: string;
}

/** 取 `choices[0]` 的对象形状；不信任任何一层。 */
function firstChoice(payload: unknown): Record<string, unknown> | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first: unknown = choices[0];
  return typeof first === 'object' && first !== null ? (first as Record<string, unknown>) : undefined;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

export function createCompletionAccumulator(): CompletionAccumulator {
  let text = '';
  let reasoning = '';
  let finishReason: string | undefined;
  const slots = new Map<number, ToolSlot>();

  return {
    accept(payload: unknown): readonly StreamDelta[] {
      const out: StreamDelta[] = [];
      const choice = firstChoice(payload);
      if (choice === undefined) return out;

      const finish = choice.finish_reason;
      if (typeof finish === 'string' && finish !== '') finishReason = finish;

      const delta = recordOf(choice.delta);
      if (delta === undefined) return out;

      const content = delta.content;
      if (typeof content === 'string' && content !== '') {
        text += content;
        out.push({ type: 'text', delta: content });
      }

      // 两种拼法都有人用：`reasoning_content`（DeepSeek / Qwen）与 `reasoning`（部分网关）。
      const reasoningDelta = delta.reasoning_content ?? delta.reasoning;
      if (typeof reasoningDelta === 'string' && reasoningDelta !== '') {
        reasoning += reasoningDelta;
        out.push({ type: 'reasoning', delta: reasoningDelta });
      }

      const calls = delta.tool_calls;
      if (Array.isArray(calls)) {
        calls.forEach((entry, position) => {
          const raw = recordOf(entry);
          if (raw === undefined) return;
          const index = typeof raw.index === 'number' ? raw.index : position;
          const fn = recordOf(raw.function);
          const id = typeof raw.id === 'string' ? raw.id : '';
          const name = typeof fn?.name === 'string' ? fn.name : '';
          const args = typeof fn?.arguments === 'string' ? fn.arguments : '';

          const slot = slots.get(index) ?? { id: `call_${String(index)}`, name: '', arguments: '' };
          if (id !== '') slot.id = id;
          if (name !== '' && slot.name === '') {
            slot.name = name;
            // 工具名只报**一次**：界面靠这一帧开一行"正在调用工具 · <name>"。
            out.push({ type: 'tool-call', index, id: slot.id, name });
          } else if (name !== '' && slot.name !== name) {
            // 少数网关把名字也拆成多帧。拼起来仍然是同一个工具名。
            slot.name += name;
          }
          slot.arguments += args;
          slots.set(index, slot);
        });
      }

      return out;
    },
    get text(): string {
      return text;
    },
    get reasoning(): string {
      return reasoning;
    },
    get toolCalls(): readonly AiToolCall[] {
      return [...slots.entries()]
        .sort(([left], [right]) => left - right)
        .filter(([, slot]) => slot.name !== '')
        .map(([, slot]) => ({ id: slot.id, name: slot.name, arguments: slot.arguments }));
    },
    get finishReason(): string | undefined {
      return finishReason;
    },
  };
}
