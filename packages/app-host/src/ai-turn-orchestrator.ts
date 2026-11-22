/**
 * `runAiTurnWithUndo` —— 壳接入的**编排胶水**：把"记录 seq → 跑一轮云端 Agent → 可撤销"
 * 变成一个函数，壳只需提供两枚 engine 绑定（`getSeq` / `undoSince`），不碰内部细节。
 *
 * 背景（产品裁决 D1）：不做 Action Plan，删除/归档/移动交给 AI，靠**版本回溯**兜底。
 * 本地写入路径的回溯原语已在 op-log：`currentLocalSeq()` + `undoSince(seq)`。
 * 本文件把它们与 `requestCloudAssistantTurn` 串起来，并给这一轮一个稳定 `runId`
 * （同时作为工具调用的幂等键前缀）。
 *
 * 壳用法（node-host / mobile / web 一样）：
 * ```ts
 * const { turn, seqBefore, runId } = await runAiTurnWithUndo('我有哪些任务', {
 *   routing, consents, transport: createLocalToolTransport(runnerDeps), grants,
 *   undo: { getSeq: () => engine.currentLocalSeq(), undoSince: (s) => engine.undoSince(s) },
 * });
 * // 用户点“撤销这次 AI 操作”：
 * await undoLastAiTurn({ undo: { getSeq, undoSince } }, seqBefore);
 * ```
 */
import type { CloudAgentTurnResult } from './agent-harness.js';
import { requestCloudAssistantTurn, type CloudAssistantTurnDeps } from './ai-cloud-assistant.js';

/** 壳提供的引擎绑定（避免 app-host 依赖具体引擎实现）。 */
export interface TurnUndoBindings {
  /** 取当前本地末条 seq（AI 运行前调用）。 */
  getSeq: () => Promise<number>;
  /** 撤销某 seq 之后新增的本地写入（op-log 的 `undoSince`）。 */
  undoSince: (seq: number) => Promise<unknown>;
}

export interface RunAiTurnOptions extends CloudAssistantTurnDeps {
  readonly undo: TurnUndoBindings;
  /** 稳定运行 id；省略则生成一个。同时作为工具调用幂等键前缀。 */
  readonly runId?: string;
}

export interface RunAiTurnResult {
  readonly turn: CloudAgentTurnResult;
  readonly runId: string;
  /** AI 运行前的本地 seq；撤销这段用它。 */
  readonly seqBefore: number;
  /** 本轮若中途抛错：错误信息（此时 `turn` 为空、`seqBefore` 仍可用 —— 已写的部分可撤销）。 */
  readonly error?: string;
}

function newRunId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `run-${String(Date.now())}-${rand}`;
}

export async function runAiTurnWithUndo(
  userText: string,
  options: RunAiTurnOptions,
): Promise<RunAiTurnResult> {
  const runId = options.runId ?? newRunId();
  const seqBefore = await options.undo.getSeq();
  try {
    const turn = await requestCloudAssistantTurn(userText, { ...options, runId });
    return { turn, runId, seqBefore };
  } catch (error: unknown) {
    // 🔴 中途抛错时**也要**把 seqBefore 交回调用方：否则本轮已经成功落库的写
    // 没有锚点可撤（审计 P0-2）。turn 用空结构占位。
    const emptyTurn: CloudAgentTurnResult = { text: '', steps: [], messages: [] };
    return {
      turn: emptyTurn,
      runId,
      seqBefore,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 撤销上一轮 AI 操作（本地写入路径）。云端工具路径的写入在服务端，不走这里。
 * 返回底层 `undoSince` 的结果（applied / partial / stale / empty）。
 */
export async function undoLastAiTurn(
  bindings: { readonly undo: TurnUndoBindings },
  seqBefore: number,
): Promise<unknown> {
  return bindings.undo.undoSince(seqBefore);
}
