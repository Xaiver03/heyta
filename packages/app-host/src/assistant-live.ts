/**
 * 助手进行中状态的归约 —— `AssistantTurnEvent` → 屏上看得见的「这一刻」
 * ======================================================================
 *
 * ## 新家与旧家
 *
 * 本文件是 `reduceAssistantLive` 及其类型（`LiveTurn` / `LiveRow` / `EMPTY_LIVE`）
 * 的**唯一实现处**。它原本长在 `apps/web/src/features/ai/AssistantPanel.tsx`
 * 里（约 175–249 行），2026-11-10 原样下沉到这里 —— 逻辑、签名、注释**逐字未改**。
 *
 * ## 🔴 为什么要下沉（这是本文件存在的全部理由）
 *
 * 移动端（`apps/mobile/src/ai/chat-controller.ts`）要接流式，**也需要这个函数**。
 * 而 `AGENTS.md` §2 / §3.5 的铁律是：**业务语义只许出现在 `packages/`**，
 * `apps/*` 只放平台差异 —— 判据是"这段代码里有没有任何一行在决定业务上该怎么做"。
 * 本文件显然有：它决定文本是增量拼接还是替换、决定工具行按什么配对。
 * 所以它不能留在 `apps/web`，更不能在移动端抄第二份。
 *
 * 抄一份的代价在本仓有**实测事故**：`packages/ui/src/ai/model.ts` 的文件头记着
 * "五份手抄的披露，其中一份漏了安全维度，而没有任何测试会红"。两份实现必然分叉，
 * 而分叉的那一刻没有任何门禁会响。
 *
 * ## 为什么这一层是纯函数（两条必须能被单独钉住的规则）
 *
 *   1. 文本/思考是**增量拼接**，不是替换（替换的症状是屏幕上只剩最后一个字）；
 *   2. `tool-finished` 收掉的是**同名且还在跑**的那一行，而不是"最后一行" ——
 *      事件与渲染是两条异步路径，按位置配会在并发（或重挂载）时配错行。
 *
 * 纯函数是这两条能被单测直接钉住的前提：不需要挂载组件、不需要假时钟。
 *
 * ## 与 `AssistantStep` 的关系（为什么不是同一个类型）
 *
 * 本文件的 `LiveRow` 与 `ai-assistant.ts` 的 `AssistantStep` 形状相近但是**两件事**：
 * `AssistantStep` 是**历史**里落盘的一步（`ok` 必填），`LiveRow` 是**此刻屏上**的一行
 * （`ok === undefined` = 还在跑）。历史只存 outcome，live 不落盘 —— 见 `ai-assistant.ts`
 * 里 `AssistantTurnEvent` 的注释。
 */

import type { AssistantTurnEvent } from './ai-assistant.js';

/**
 * 一轮进行中的**一行过程**（对应 `AssistantTurnEvent` 的 tool-started / -finished）。
 *
 * `ok === undefined` = 还在跑。这一格是**界面自己的**状态，不进历史：
 * 历史里那一轮最终会落成 `AssistantStep[]`。
 */
export interface LiveRow {
  readonly tool: string;
  readonly kind: 'read' | 'write';
  readonly ok: boolean | undefined;
  readonly note?: string;
}

/** 一轮进行中的可见状态。它只活在界面层的 ephemeral 状态里，**不落盘**。 */
export interface LiveTurn {
  readonly text: string;
  readonly reasoning: string;
  readonly rows: readonly LiveRow[];
}

export const EMPTY_LIVE: LiveTurn = { text: '', reasoning: '', rows: [] };

/**
 * 事件 → 进行中的可见状态。**纯函数**，因为它有两条必须能被单独钉住的规则：
 *
 *   1. 文本/思考是**增量拼接**，不是替换（替换的症状是屏幕上只剩最后一个字）；
 *   2. `tool-finished` 收掉的是**同名且还在跑**的那一行，而不是"最后一行" ——
 *      事件与渲染是两条异步路径，按位置配会在并发（或重挂载）时配错行。
 */
export function reduceAssistantLive(
  live: LiveTurn | undefined,
  event: AssistantTurnEvent,
): LiveTurn {
  const base = live ?? EMPTY_LIVE;
  if (event.type === 'text') return { ...base, text: base.text + event.delta };
  if (event.type === 'reasoning') return { ...base, reasoning: base.reasoning + event.delta };
  if (event.type === 'tool-started') {
    return { ...base, rows: [...base.rows, { tool: event.tool, kind: event.kind, ok: undefined }] };
  }
  const settled: LiveRow = {
    tool: event.tool,
    kind: event.kind,
    ok: event.ok,
    ...(event.note === undefined ? {} : { note: event.note }),
  };
  const rows = [...base.rows];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row === undefined || row.ok !== undefined || row.tool !== event.tool) continue;
    rows[index] = settled;
    return { ...base, rows };
  }
  // 没找到对应行（事件比这一轮的状态活得更久，例如面板刚重挂载过）：
  // 补一行「已经结束」的，而不是丢掉 —— 丢掉会让用户看不到刚发生的那一步。
  return { ...base, rows: [...rows, settled] };
}
