/**
 * AI 写入的**运行账（run ledger）** —— 「这次 AI 发送到底写了几条、是什么」的唯一记录点。
 *
 * ## 为什么需要它
 *
 * 产品裁决 D1：**不做 Action Plan**，删除/归档/移动等写直接执行，靠"版本回溯"兜底。
 * 但"撤销这次 AI 操作"必须知道**哪几条写入属于同一次 AI 发送**——全仓此前没有
 * `runId` 任何痕迹（审计 §2-D2）。本模块先补上这半：按 `executionId`（= 一次用户发送）
 * 归集写入记录，供 UI 回执（`已删除 N 个 · 撤销`）与后续"回滚"使用。
 *
 * ## 边界（诚实标注）
 *
 * - 这是**进程内**账本（`WeakMap` keyed by host），与既有去重 `WeakMap` 同一生命周期；
 *   跨进程/跨端持久化不在本步。
 * - 它只**记录**，不执行回滚。真正的"按 run 回滚"需要 op-log 暴露显式的反向重放 API
 *   （当前 `engine.undo()` 只作用于栈顶、且 batch op 不可逆）—— 那是下一步。
 * - 记录发生在**唯一写入点** `executeAiToolProposal`（低风险"执行档"自动写）里，
 *   所以不会漏记、也不会记到未真正落库的失败。
 */
import type { LocalApiWriteIntent } from '@heyta/local-api';

/** 一条 AI 写入记录。 */
export interface AiRunWriteRecord {
  readonly runId: string;
  readonly tool: string;
  readonly action: string;
  readonly intent: LocalApiWriteIntent;
  readonly at: number;
}

const MAX_RUNS = 64;
const MAX_WRITES_PER_RUN = 64;
const LEDGER = new WeakMap<object, Map<string, AiRunWriteRecord[]>>();

/** 可记录的最小提案形状（避免与 ai-tool-run 形成 import 环）。 */
export interface LedgerProposal {
  readonly tool: string;
  readonly intent: LocalApiWriteIntent;
}

export function recordAiRunWrite(
  host: object,
  runId: string,
  proposal: LedgerProposal,
  now: number = Date.now(),
): void {
  const id = runId.trim();
  if (id === '') return;
  let runs = LEDGER.get(host);
  if (runs === undefined) {
    runs = new Map();
    LEDGER.set(host, runs);
  }
  let list = runs.get(id);
  if (list === undefined) {
    list = [];
    runs.set(id, list);
  }
  list.push({ runId: id, tool: proposal.tool, action: proposal.intent.action, intent: proposal.intent, at: now });
  if (list.length > MAX_WRITES_PER_RUN) list.splice(0, list.length - MAX_WRITES_PER_RUN);
  if (runs.size > MAX_RUNS) {
    const oldest = runs.keys().next().value;
    if (typeof oldest === 'string') runs.delete(oldest);
  }
}

/** 某次 AI 发送（runId）写入的全部记录，按发生顺序。 */
export function aiRunWrites(host: object, runId: string): readonly AiRunWriteRecord[] {
  const runs = LEDGER.get(host);
  const list = runs?.get(runId.trim());
  return list === undefined ? [] : [...list];
}

/** 当前宿主上记录过的 runId（最近的在末尾）。 */
export function aiRunIds(host: object): readonly string[] {
  const runs = LEDGER.get(host);
  return runs === undefined ? [] : [...runs.keys()];
}
