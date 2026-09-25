/**
 * 物化状态与 reducer
 * ====================
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 本文件是整个 op-log 的正确性基石，只有一条不可妥协的规则：
 *
 * 🔴 **reducer 必须是纯函数 (state, op) => state。**
 *
 * 理由不是"函数式好看"，而是三个具体需求都必须靠它：
 *
 *   1. **幂等重放** —— 崩溃恢复要重放 pending 的 op。若 reducer 有副作用
 *      （写库、发请求、生成随机数、读 Date.now()），重放会产生新的副作用，
 *      变成"同步回来又写一遍"的双向灾难。
 *   2. **确定性** —— 两端对同一批 op 重放必须得到同一结果。
 *      否则同步完成的那一刻两台设备的数据就不同了。
 *   3. **可测试** —— 纯函数不需要起数据库、不需要造时钟。
 *
 * 所以：**时间戳只能来自 op 本身**（`op.timestamp`），不能读 `Date.now()`。
 * ─────────────────────────────────────────────────────────────────────────
 */

import type {
  FocusSession,
  Habit,
  HabitLog,
  Project,
  Tag,
  Task,
} from '@heyta/domain';
import { OpType, compareVectorClocks } from '@heyta/sync-core';
import type { Operation, VectorClock } from '@heyta/sync-core';

/** 物化状态。所有实体按 id 索引。 */
export interface MaterializedState {
  tasks: Record<string, Task>;
  projects: Record<string, Project>;
  tags: Record<string, Tag>;
  habits: Record<string, Habit>;
  habitLogs: Record<string, HabitLog>;
  focusSessions: Record<string, FocusSession>;
}

export function emptyState(): MaterializedState {
  return {
    tasks: {},
    projects: {},
    tags: {},
    habits: {},
    habitLogs: {},
    focusSessions: {},
  };
}

/** 各实体的字段名，供 reducer 分派。 */
const BUCKET_BY_ENTITY = {
  TASK: 'tasks',
  PROJECT: 'projects',
  TAG: 'tags',
  HABIT: 'habits',
  HABIT_LOG: 'habitLogs',
  FOCUS_SESSION: 'focusSessions',
} as const;

type ModeledEntity = keyof typeof BUCKET_BY_ENTITY;

function isModeled(entityType: string): entityType is ModeledEntity {
  return entityType in BUCKET_BY_ENTITY;
}

/**
 * 把一条 op 应用到状态。
 *
 * **纯函数**：不修改入参，返回新状态（浅拷贝被改动的桶）。
 */
export function applyOperation(
  state: MaterializedState,
  op: Operation<string>,
): MaterializedState {
  // 系统实体（GLOBAL_CONFIG 等）落在物化状态之外，直接忽略。
  // ⚠️ 不要抛错：未来新增实体类型时，老客户端必须能优雅跳过，
  // 而不是让整个同步因为一条不认识的 op 就卡死。
  if (!isModeled(op.entityType)) return state;

  const bucket = BUCKET_BY_ENTITY[op.entityType];
  const entityId = op.entityId;
  if (entityId === undefined) return state;

  const payload = op.payload;

  const existing = (state[bucket] as Record<string, unknown>)[entityId] as
    | (Record<string, unknown> & { updatedAt?: number; deletedAt?: number })
    | undefined;

  // DELETE op：写入墓碑，**不物理删除**。
  // 物理删除会让同步端永远看不到这次删除，另一端会把数据又同步回来。
  if (op.opType === OpType.Delete) {
    if (existing === undefined) return state;

    // 🔴 删除也必须过同一道写入闸门，并且必须**记下自己的时钟**。
    //
    // 曾经这两件事都没做：DELETE 无条件写墓碑，也不更新 `_lastClock` /
    // `_lastOpId`。后果是删除之后实体上留着的时钟是**删除之前那次写入的** ——
    // 于是后面每条 op 都在和一个过期的时钟比较，因果判定随之失真
    // （陈旧时钟比真实值旧，闸门会变得过于宽松，本该拒绝的写入被放进来了）。
    if (!shouldAcceptWrite(op, existing)) return state;

    return {
      ...state,
      [bucket]: {
        ...state[bucket],
        [entityId]: {
          ...existing,
          deletedAt: op.timestamp,
          updatedAt: op.timestamp,
          _lastOpId: op.id,
          _lastClock: op.vectorClock,
        },
      },
    } as MaterializedState;
  }

  if (payload === null || typeof payload !== 'object') return state;

  const incoming = payload as Record<string, unknown>;

  /**
   * LWW（最后写入者胜）的**实体级**闸门。
   *
   * 冲突判定在引擎层用向量时钟做；这里是**兜底**：
   * 即使两条 op 被判定为并发、且引擎选择了某一条，
   * reducer 也必须能独立地拒绝"更旧的"写入 ——
   * 否则重放顺序一变结果就不同，违反确定性。
   *
   * 平局用 op.id 打破：不能留"谁先到谁赢"，那在两端会不一致。
   */
  if (!shouldAcceptWrite(op, existing)) return state;

  // CREATE / UPDATE 合并语义：只覆盖 payload 里出现的字段。
  // 这样"只改标题"的 op 不会把 dueDate 抹掉。
  const merged: Record<string, unknown> = {
    ...(existing ?? {}),
    ...incoming,
    id: entityId,
    updatedAt: op.timestamp,
    _lastOpId: op.id,
    _lastClock: op.vectorClock,
  };

  /**
   * 🔴 `null` 表示**显式清除这个字段**，不是"把它设成 null"。
   *
   * 为什么需要这个约定：合并语义下没法表达"取消完成"。
   * UI 想清掉 `completedAt` 时若传 `undefined`，展开运算会跳过它
   * （`{...a, ...{x: undefined}}` 里 x 仍然是 undefined，看似可行）——
   * 但 JSON 序列化会**丢掉 undefined 字段**，op 传到另一端时这个意图就消失了，
   * 于是"取消完成"在第二台设备上不生效。
   *
   * `null` 能安全穿过 JSON，所以用它承载"删除"语义，在这里翻译成真正的删除。
   */
  const toDelete: string[] = [];
  for (const [key, value] of Object.entries(incoming)) {
    if (value === null) toDelete.push(key);
  }
  for (const key of toDelete) {
    delete merged[key];
  }
  if (existing === undefined) {
    merged['createdAt'] = op.timestamp;
  }

  return {
    ...state,
    [bucket]: { ...state[bucket], [entityId]: merged },
  } as MaterializedState;
}

/**
 * 写入闸门：**因果优先，墙上时钟只作兜底**。
 *
 * 🔴 为什么不能只比 `op.timestamp`（这是本仓库真实踩过的坑）：
 *
 * 同一台设备连续两次编辑同一实体会落在**同一毫秒**里，于是时间戳相等，
 * 判定就落到 `op.id` 的字典序上 —— 而 `op.id` 是随机 UUID。
 * 结果：**因果上更新的那条有一半概率被丢掉**，且完全静默。
 *
 * 实测症状：`setCompleted(true)` 紧接 `setCompleted(false)`，重开后
 * 「取消完成」约 2/3 的情况不生效（`completedAt` 仍是时间戳）。
 * op 日志里两条 op 的向量时钟清清楚楚是 `3` → `4`，同设备、顺序明确 ——
 * **它们根本不并发，不该由墙上时钟裁决。**
 *
 * 所以先用向量时钟：因果上明确更新/更旧，直接接受/拒绝，不看时间戳。
 * 只有真正**并发**（或时钟相等，即同一条 op 重放）时，才回退到
 * 时间戳 + `op.id` 字典序 —— 后者是为了保证**两端算出同一个结果**。
 *
 * 注：`_lastClock` / `_lastOpId` 都是**内存派生字段**，随 op 重放重建，
 * 不进任何持久化 schema（物化状态从不落盘）。
 */
function shouldAcceptWrite(
  op: Operation<string>,
  existing: (Record<string, unknown> & { updatedAt?: number }) | undefined,
): boolean {
  if (existing === undefined) return true;

  const existingClock = existing['_lastClock'] as VectorClock | undefined;
  const incomingClock = op.vectorClock;
  if (existingClock !== undefined && incomingClock !== undefined) {
    const cmp = compareVectorClocks(incomingClock, existingClock);
    // 因果上更新 → 无条件胜出（同一设备连续编辑就是这种情况）
    if (cmp === 'GREATER_THAN') return true;
    // 因果上更旧 → 无条件拒绝，哪怕时间戳更大（时钟回拨也挡得住）
    if (cmp === 'LESS_THAN') return false;
    // EQUAL（同一条 op 重放）与 CONCURRENT 才需要下面兜底
  }

  const existingUpdated = existing['updatedAt'] ?? 0;
  if (op.timestamp < existingUpdated) return false;
  if (op.timestamp === existingUpdated) {
    // 同毫秒且并发：用 op.id 字典序做确定性决胜，保证两端一致
    const existingOpId = (existing['_lastOpId'] as string | undefined) ?? '';
    if (op.id <= existingOpId) return false;
  }
  return true;
}

/**
按序重放一批 op。
 *
 * ⚠️ 顺序敏感：同实体的 op 必须按发生顺序应用。
 * 调用方负责保证传入顺序（本地 op 按 seq，远程 op 按服务端序）。
 */
export function replayOperations(
  state: MaterializedState,
  ops: readonly Operation<string>[],
): MaterializedState {
  let next = state;
  for (const op of ops) {
    next = applyOperation(next, op);
  }
  return next;
}

/** 取某个实体的全部记录（含墓碑）。 */
export function listEntities<T>(bucket: Record<string, T>): T[] {
  return Object.values(bucket);
}

/** 取未删除的记录。 */
export function listAlive<T extends { deletedAt?: number }>(
  bucket: Record<string, T>,
): T[] {
  return Object.values(bucket).filter((e) => e.deletedAt === undefined);
}
