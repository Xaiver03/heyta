/**
 * 撤销历史栈：一次本地意图 → 一条反向意图
 * =========================================
 *
 * 这个文件只回答一个问题：**「刚刚那次写入，怎么用一条新 op 撤回去」**。
 * 它不持有状态、不认识界面、不发请求 —— 栈本身在 `OpLogEngine` 里（会话内内存）。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 🔴 三条不能松的纪律
 *
 * 1. **撤销 = 生成反向 op，不删历史。** op-log 是事实日志：删掉一条 op 会让
 *    其它设备的重放与我们对不上。所以撤销永远是 `dispatch` 一条新的反向 op。
 *
 * 2. **能撤才说能撤。** 批量 op（task batch / priority batch / repeat completion）、
 *    全量快照（Repair）、多实体 op、未建模实体 —— 这些没有可信的反向意图，
 *    一律标 `reason` 并**跳过**，不许编一条"差不多"的 op 出来（那会静默改坏数据）。
 *
 * 3. **前提不成立就拒绝（`stale`），不覆盖。** 反向 op 写的是「我们上次写下去的值」；
 *    如果当前值已经不是那个值，说明别人（另一台设备）改过它 —— 这时写回旧值
 *    就是拿一条撤销去覆盖一次真实的新改动。宁可说一句"没撤成"。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 反向规则表（与 `packages/op-log/src/state.ts` 的 reducer 对应）
 *
 * | 原 op | 反向 op | 前提 |
 * |---|---|---|
 * | `CRT` | `DEL`（字段级墓碑） | 实体存在且未被删 |
 * | `UPD` / `MOV` | `UPD`，载荷 = 每个被写键的**旧值**（原来没有该键 ⇒ `null`） | 当前值与当初写下去的值逐个相等 |
 * | `DEL` | `UPD {deletedAt:null}` | `deletedAt === 原 op.timestamp` 且未 `purgedAt` |
 *
 * `null` 在 reducer 里是「删掉这个字段」的版本标记（`value === null ⇒ deleted`），
 * 所以「原来没有这个键」用 `null` 表达是正确的反向，不是把字段写成 null。
 */

import {
  hasTaskBatchMarker,
  hasTaskPriorityBatchMarker,
  hasTaskRepeatCompletionMarker,
} from '@heyta/shared-schema';
import { OpType, type Operation } from '@heyta/sync-core';

import { bucketFor, isFullStateOperation, type MaterializedState } from './state.js';
import type { OpIntent } from './engine.js';

/** 为什么这一条**不能**撤销（界面要说清是哪种，不要合并成"失败"）。 */
export type HistorySkipReason =
  /** 批量创建/批量优先级：一条 op 承载多个实体，反向意图无法逐条表达。 */
  | 'batch'
  /** 全量快照（Repair）：它不是"一个用户意图"，撤销它等于回滚整库。 */
  | 'snapshot'
  /** 一次意图涉及多个实体：反向需要 N 条 op，破坏"一次撤销 = 一条 op"。 */
  | 'multi-entity'
  /** reducer 不认识这个实体类型：我们不知道该怎么把它改回去。 */
  | 'unmodeled'
  /** 载荷不是普通对象：没有可枚举的字段，无法计算旧值。 */
  | 'non-object-payload'
  /** 其余 op 类型（如 SyncImport）：没有定义过反向。 */
  | 'unsupported-op';

/** 界面描述「刚才那条是什么」所需的最小信息（不要把它翻译成中文放在这里）。 */
export interface HistoryTarget {
  readonly entityType: string;
  readonly entityId: string;
  readonly opType: string;
  readonly timestamp: number;
}

export interface HistoryEntry {
  readonly opId: string;
  /** 原始意图（已深拷贝）。 */
  readonly intent: OpIntent;
  /**
   * 反向意图。`undefined` ⇒ 这一条不可撤销，原因在 {@link reason}。
   * 它不是"尽力而为"的猜测：算不出来就是算不出来。
   */
  readonly inverse?: OpIntent;
  readonly reason?: HistorySkipReason;
  readonly timestamp: number;
}

/** `undo()` / `redo()` 的结果。**封闭词表** —— 界面按它取话，不许只看 `ok`。 */
export type UndoOutcome =
  | { readonly status: 'applied'; readonly opId: string; readonly target: HistoryTarget }
  | { readonly status: 'empty' }
  /** 前提不成立：实体没了，或者别人改过。`reason` 决定界面说哪一句。 */
  | { readonly status: 'stale'; readonly reason: 'entity-missing' | 'entity-changed' }
  /** 栈里唯一一条不可撤销（或栈空）。 */
  | { readonly status: 'unsupported'; readonly reason: HistorySkipReason };

/** `historyState()` 的返回值：只读快照，供界面决定按钮可用性与文案。 */
export interface HistoryState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undo?: HistoryTarget;
  readonly redo?: HistoryTarget;
}

/** 栈的上限。撤销是**会话内**的便利，不是审计日志；超限丢最旧的一条。 */
export const HISTORY_LIMIT = 100;

function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => jsonEqual(item, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && jsonEqual(left[key], right[key]));
}

/**
 * 读实体（**含墓碑**）。
 *
 * 撤销「删除」必须先看到墓碑 —— 与 `listAlive` 相反。用错一个，
 * 症状是"删了之后撤销说找不到这条"。
 */
function rawEntity(state: MaterializedState, entityType: string, entityId: string): Record<string, unknown> | undefined {
  const bucket = bucketFor(state, entityType);
  if (bucket === undefined) return undefined;
  return (bucket as Record<string, Record<string, unknown>>)[entityId];
}

function withNullable(value: unknown): unknown {
  return value === undefined ? null : value;
}

/**
 * 把一次本地写入折成一条历史条目。
 *
 * `state` 必须是**应用这条 op 之前**的状态 —— 旧值只能从那里读到。
 */
export function buildHistoryEntry(
  state: MaterializedState,
  intent: OpIntent,
  op: Operation<string>,
): HistoryEntry {
  const base = {
    opId: op.id,
    intent: { ...intent, payload: clonePayload(intent.payload) },
    timestamp: op.timestamp,
  } as const;

  const skip = (reason: HistorySkipReason): HistoryEntry => ({ ...base, reason });

  if ((intent.entityIds?.length ?? 0) > 0) return skip('multi-entity');
  if (isFullStateOperation(op as Operation<string>)) return skip('snapshot');
  if (hasTaskBatchMarker(op.payload) || hasTaskPriorityBatchMarker(op.payload) ||
      hasTaskRepeatCompletionMarker(op.payload)) {
    return skip('batch');
  }
  if (bucketFor(state, intent.entityType) === undefined) return skip('unmodeled');

  switch (op.opType) {
    case OpType.Create:
      return {
        ...base,
        inverse: {
          entityType: intent.entityType,
          entityId: intent.entityId,
          opType: OpType.Delete,
          payload: {},
        },
      };
    case OpType.Update:
    case OpType.Move: {
      const incoming = intent.payload;
      if (incoming === null || typeof incoming !== 'object' || Array.isArray(incoming)) {
        return skip('non-object-payload');
      }
      const entity = rawEntity(state, intent.entityType, intent.entityId);
      const payload: Record<string, unknown> = {};
      for (const key of Object.keys(incoming as Record<string, unknown>)) {
        // 原来没有这个键 ⇒ 反向用 `null`（reducer 的"删字段"标记），不是写 null 值。
        payload[key] = withNullable(entity?.[key]);
      }
      return {
        ...base,
        inverse: {
          entityType: intent.entityType,
          entityId: intent.entityId,
          opType: OpType.Update,
          payload,
        },
      };
    }
    case OpType.Delete:
      return {
        ...base,
        inverse: {
          entityType: intent.entityType,
          entityId: intent.entityId,
          opType: OpType.Update,
          payload: { deletedAt: null },
        },
      };
    default:
      return skip('unsupported-op');
  }
}

/**
 * 反向意图现在还成立吗？
 *
 * 返回 `undefined` = 成立。任何"不成立"都必须**拒绝**而不是勉强写：
 * 那是拿撤销去覆盖一次别的设备刚做的真实改动。
 */
export function checkInverseStillValid(
  state: MaterializedState,
  entry: HistoryEntry,
): 'entity-missing' | 'entity-changed' | undefined {
  const { intent, inverse } = entry;
  if (inverse === undefined) return 'entity-changed';
  const entity = rawEntity(state, intent.entityType, intent.entityId);
  if (entity === undefined) return 'entity-missing';

  switch (intent.opType) {
    case OpType.Create:
      // 已经被删掉/彻底删掉 ⇒ 没有可撤销的创建了（不是错误，是"没有变化"）。
      return entity.deletedAt === undefined && entity.purgedAt === undefined ? undefined : 'entity-missing';
    case OpType.Update:
    case OpType.Move: {
      const incoming = intent.payload;
      if (incoming === null || typeof incoming !== 'object' || Array.isArray(incoming)) return 'entity-changed';
      for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
        if (!jsonEqual(withNullable(entity[key]), value)) return 'entity-changed';
      }
      return undefined;
    }
    case OpType.Delete:
      // 墓碑的版本就是这个 op 的时间戳；别人恢复过或重删过都对不上。
      if (entity.purgedAt !== undefined) return 'entity-changed';
      return entity.deletedAt === entry.timestamp ? undefined : 'entity-changed';
    default:
      return 'entity-changed';
  }
}

function clonePayload(payload: unknown): unknown {
  if (payload === null || typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) return payload.map((item) => clonePayload(item));
  return Object.fromEntries(
    Object.entries(payload as Record<string, unknown>).map(([key, value]) => [key, clonePayload(value)]),
  );
}

/** 条目 → 界面用的"被撤销的目标"。 */
export function historyTargetOf(intent: OpIntent, timestamp: number): HistoryTarget {
  return {
    entityType: intent.entityType,
    entityId: intent.entityId,
    opType: intent.opType,
    timestamp,
  };
}
