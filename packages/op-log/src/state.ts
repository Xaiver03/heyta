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
  AiFeedback,
  FocusSession,
  PreferenceCorrection,
  Habit,
  HabitLog,
  Note,
  Project,
  Reminder,
  Tag,
  Task,
} from '@heyta/domain';
import { OpType, compareVectorClocks } from '@heyta/sync-core';
import { SUPER_SYNC_SNAPSHOT_OP_TYPES, isHeytaFullStatePayload, type HeytaFullStatePayload } from '@heyta/shared-schema';
import type { Operation, VectorClock } from '@heyta/sync-core';

/** 物化状态。所有实体按 id 索引。 */
export interface MaterializedState {
  tasks: Record<string, Task>;
  projects: Record<string, Project>;
  tags: Record<string, Tag>;
  notes: Record<string, Note>;
  habits: Record<string, Habit>;
  habitLogs: Record<string, HabitLog>;
  focusSessions: Record<string, FocusSession>;
  /**
   * AI 反馈（用户对 AI 建议的处置）。
   *
   * ⚠️ 它物化进来是**有意的**：偏好推断（P6/P7）要读它。
   * 但它**不是用户内容** —— 只有数字与枚举，没有文本（见 `AiFeedback`）。
   */
  aiFeedback: Record<string, AiFeedback>;
  /** 用户对推断偏好的纠正。见 `PreferenceCorrection`。 */
  preferenceCorrections: Record<string, PreferenceCorrection>;
  /**
   * 任务提醒（B1-1）。
   *
   * ⚠️ 它与 `tasks[*].dueDate` **不是同一个东西**：`dueDate` 是截止瞬间
   * （ADR-0015 的紧迫性轴），提醒是通知规则（可多条、可提前、可 snooze）。
   * 理由逐条写在 `packages/domain/src/entities.ts` 的 `Reminder` 上。
   */
  reminders: Record<string, Reminder>;
}

export function emptyState(): MaterializedState {
  return {
    tasks: {},
    projects: {},
    tags: {},
    notes: {},
    habits: {},
    habitLogs: {},
    focusSessions: {},
    aiFeedback: {},
    preferenceCorrections: {},
    reminders: {},
  };
}

/** 各实体的字段名，供 reducer 分派。 */
const BUCKET_BY_ENTITY = {
  TASK: 'tasks',
  PROJECT: 'projects',
  TAG: 'tags',
  NOTE: 'notes',
  HABIT: 'habits',
  HABIT_LOG: 'habitLogs',
  FOCUS_SESSION: 'focusSessions',
  AI_FEEDBACK: 'aiFeedback',
  PREFERENCE_CORRECTION: 'preferenceCorrections',
  REMINDER: 'reminders',
} as const;

type ModeledEntity = keyof typeof BUCKET_BY_ENTITY;

function isModeled(entityType: string): entityType is ModeledEntity {
  return entityType in BUCKET_BY_ENTITY;
}

/**
 * 取某实体在物化状态里的桶。
 *
 * 🔴 这是**唯一**的实体类型 → 桶 的运行时映射。
 *
 * 曾经 `engine.ts` 的 `snapshot()` 自己又抄了一份同样的 6 行映射。
 * 于是「哪些实体被建模、各自在哪个桶」在仓库里有**四份**定义：
 * `EntityModelMap`、`hasModel`、`BUCKET_BY_ENTITY`、`snapshot()` 里的内联表。
 * 加一个新实体要改四处，漏掉 `snapshot` 的那处**不会报错** ——
 * 只会让该实体的 `overwritten` 判定恒为 false，即冲突覆盖**静默不生效**。
 */
/** 实体在物化状态里的形状：任意字段 + 写入闸门要读的 `updatedAt`。 */
export type MaterializedBucket = Record<string, Record<string, unknown> & { updatedAt?: number }>;

/**
 * Reducer-only metadata. It is deliberately non-enumerable and symbol keyed:
 * materialized entities remain wire/domain compatible, while replay can make
 * field-level decisions without inheriting whichever partial update happened
 * to arrive first.
 */
const ENTITY_VERSIONS = Symbol('heyta.entityVersions');
const FIELD_VERSIONS = Symbol('heyta.fieldVersions');

export interface OperationMeta {
  clock: VectorClock;
  timestamp: number;
  /** Source device used by the wire-level LWW tie-breaker. */
  clientId?: string;
  opId: string;
}

export interface FieldVersion {
  meta: OperationMeta;
  value?: unknown;
  deleted: boolean;
}

/** Versioned, structured-clone-safe representation used by D checkpoints. */
export interface SerializedMaterializedState {
  formatVersion: 1;
  buckets: Record<keyof MaterializedState, Record<string, {
    data: Record<string, unknown>;
    entityVersions: OperationMeta[];
    fieldVersions: Record<string, FieldVersion[]>;
  }> >;
}

type InternalEntity = Record<string, unknown> & {
  updatedAt?: number;
  deletedAt?: number;
  [ENTITY_VERSIONS]?: OperationMeta[];
  [FIELD_VERSIONS]?: Record<string, FieldVersion[]>;
};

function attachMetadata(
  entity: InternalEntity,
  entityVersions: OperationMeta[],
  fieldVersions: Record<string, FieldVersion[]>,
): void {
  Object.defineProperty(entity, ENTITY_VERSIONS, {
    configurable: true,
    enumerable: false,
    value: entityVersions,
    writable: true,
  });
  Object.defineProperty(entity, FIELD_VERSIONS, {
    configurable: true,
    enumerable: false,
    value: fieldVersions,
    writable: true,
  });
}

function operationMeta(op: Operation<string>): OperationMeta {
  return {
    clock: { ...op.vectorClock },
    timestamp: op.timestamp,
    clientId: op.clientId,
    opId: op.id,
  };
}

function compareMeta(a: OperationMeta, b: OperationMeta): number {
  const causal = compareVectorClocks(a.clock, b.clock);
  if (causal === 'GREATER_THAN') return 1;
  if (causal === 'LESS_THAN') return -1;
  if (a.timestamp !== b.timestamp) return a.timestamp > b.timestamp ? 1 : -1;
  // sync-core and the server use clientId for exact-millisecond concurrent
  // writes. Keep opId as a final deterministic fallback for malformed/legacy
  // metadata that has no clientId (and for two ops from the same client).
  const aClientId = a.clientId ?? '';
  const bClientId = b.clientId ?? '';
  if (aClientId !== bClientId) return aClientId > bClientId ? 1 : -1;
  return a.opId > b.opId ? 1 : a.opId < b.opId ? -1 : 0;
}

function selectVersion<T extends { meta: OperationMeta }>(versions: readonly T[]): T | undefined {
  if (versions.length === 0) return undefined;
  const maximal = versions.filter(
    (candidate) =>
      !versions.some(
        (other) => other !== candidate && compareVectorClocks(other.meta.clock, candidate.meta.clock) === 'GREATER_THAN',
      ),
  );
  return maximal.reduce((winner, candidate) =>
    winner === undefined || compareMeta(candidate.meta, winner.meta) > 0 ? candidate : winner,
  );
}

function addUnique<T extends { meta: OperationMeta }>(versions: T[], version: T): void {
  if (versions.some((existing) => existing.meta.opId === version.meta.opId ||
    compareVectorClocks(existing.meta.clock, version.meta.clock) === 'GREATER_THAN')) return;
  for (let i = versions.length - 1; i >= 0; i -= 1) {
    if (compareVectorClocks(version.meta.clock, versions[i]!.meta.clock) === 'GREATER_THAN') {
      versions.splice(i, 1);
    }
  }
  versions.push(version);
}

function addUniqueMeta(versions: OperationMeta[], version: OperationMeta): void {
  const frontier = versions.map((meta) => ({ meta }));
  addUnique(frontier, { meta: version });
  versions.splice(0, versions.length, ...frontier.map(({ meta }) => meta));
}

function legacyEntityVersions(existing: InternalEntity | undefined): OperationMeta[] {
  if (existing?.[ENTITY_VERSIONS] !== undefined) return [...existing[ENTITY_VERSIONS]];
  const clock = existing?.['_lastClock'];
  const opId = existing?.['_lastOpId'];
  if (existing !== undefined && clock !== undefined && typeof opId === 'string') {
    const clientId = existing?.['_lastClientId'];
    return [
      {
        clock: { ...(clock as VectorClock) },
        timestamp: existing.updatedAt ?? 0,
        ...(typeof clientId === 'string' ? { clientId } : {}),
        opId,
      },
    ];
  }
  return [];
}

function legacyFieldVersions(existing: InternalEntity | undefined): Record<string, FieldVersion[]> {
  if (existing?.[FIELD_VERSIONS] !== undefined) {
    return Object.fromEntries(
      Object.entries(existing[FIELD_VERSIONS]).map(([key, versions]) => [key, [...versions]]),
    );
  }
  const entityVersions = legacyEntityVersions(existing);
  const fallback = entityVersions[0];
  if (existing === undefined || fallback === undefined) return {};
  const result: Record<string, FieldVersion[]> = {};
  for (const key of Object.keys(existing)) {
    if (key.startsWith('_') || key === 'id' || key === 'updatedAt') continue;
    result[key] = [{ meta: fallback, value: existing[key], deleted: false }];
  }
  return result;
}

function cloneWithMetadata(
  entity: InternalEntity,
  entityVersions: OperationMeta[],
  fieldVersions: Record<string, FieldVersion[]>,
): InternalEntity {
  const clone = { ...entity } as InternalEntity;
  attachMetadata(clone, entityVersions, fieldVersions);
  return clone;
}

function materializeVersions(
  entityId: string,
  entityVersions: OperationMeta[],
  fieldVersions: Record<string, FieldVersion[]>,
): InternalEntity {
  const next: InternalEntity = { id: entityId };
  for (const [key, versions] of Object.entries(fieldVersions)) {
    const winner = selectVersion(versions);
    if (winner !== undefined && !winner.deleted) next[key] = winner.value;
  }
  const winner = selectVersion(entityVersions.map((meta) => ({ meta })));
  if (winner !== undefined) {
    next.updatedAt = winner.meta.timestamp;
    next._lastOpId = winner.meta.opId;
    next._lastClock = winner.meta.clock;
    if (winner.meta.clientId !== undefined) next._lastClientId = winner.meta.clientId;
  }
  next.id = entityId;
  return cloneWithMetadata(next, entityVersions, fieldVersions);
}

/** A lossless reducer frontier, not an unversioned replacement of local state. */
export type FullStatePayload = HeytaFullStatePayload<SerializedMaterializedState>;

export function isFullStateOperation(op: Operation<string>): boolean {
  return (SUPER_SYNC_SNAPSHOT_OP_TYPES as readonly string[]).includes(op.opType);
}

function applyFullState(state: MaterializedState, op: Operation<string>): MaterializedState {
  const payload = op.payload;
  if (op.entityType !== 'ALL' || !isHeytaFullStatePayload(payload)) {
    throw new Error(`Unsupported full-state operation: ${op.id}`);
  }
  const incoming = deserializeMaterializedState(payload.state);
  if (incoming === undefined) throw new Error(`Invalid full-state operation: ${op.id}`);
  const merged = { ...state };
  for (const bucketName of Object.values(BUCKET_BY_ENTITY)) {
    const target = { ...state[bucketName] } as unknown as Record<string, InternalEntity>;
    for (const [id, entity] of Object.entries(incoming[bucketName])) {
      const versions = legacyEntityVersions(target[id]);
      const fields = legacyFieldVersions(target[id]);
      const assertCovered = (meta: OperationMeta): void => {
        const relation = compareVectorClocks(op.vectorClock, meta.clock);
        if (relation !== 'EQUAL' && relation !== 'GREATER_THAN') {
          throw new Error(`Full-state metadata exceeds its causal boundary: ${op.id}`);
        }
      };
      for (const version of legacyEntityVersions(entity as InternalEntity)) {
        assertCovered(version);
        addUniqueMeta(versions, version);
      }
      for (const [key, candidates] of Object.entries(legacyFieldVersions(entity as InternalEntity))) {
        const existing = fields[key] ??= [];
        for (const candidate of candidates) {
          assertCovered(candidate.meta);
          addUnique(existing, candidate);
        }
      }
      target[id] = materializeVersions(id, versions, fields);
    }
    (merged as unknown as Record<string, unknown>)[bucketName] = target;
  }
  return merged;
}

/**
 * Encode reducer metadata explicitly. JSON/structured clone drops Symbols, so
 * persisting only the visible entity JSON would make the next incremental op
 * forget causality and resurrect stale fields.
 */
export function serializeMaterializedState(state: MaterializedState): SerializedMaterializedState {
  const buckets = {} as SerializedMaterializedState['buckets'];
  for (const bucketName of Object.values(BUCKET_BY_ENTITY)) {
    const source = state[bucketName] as unknown as Record<string, InternalEntity>;
    const target: Record<string, SerializedMaterializedState['buckets'][keyof MaterializedState][string]> = {};
    for (const [entityId, entity] of Object.entries(source)) {
      target[entityId] = {
        data: { ...entity },
        entityVersions: [...(entity[ENTITY_VERSIONS] ?? [])].sort((a, b) => a.opId < b.opId ? -1 : a.opId > b.opId ? 1 : 0).map((meta) => ({
          ...meta,
          clock: { ...meta.clock },
        })),
        fieldVersions: Object.fromEntries(
          Object.entries(entity[FIELD_VERSIONS] ?? {}).map(([key, versions]) => [
            key,
            [...versions].sort((a, b) => a.meta.opId < b.meta.opId ? -1 : a.meta.opId > b.meta.opId ? 1 : 0).map((version) => ({
              ...version,
              meta: { ...version.meta, clock: { ...version.meta.clock } },
            })),
          ]),
        ),
      };
    }
    (buckets as Record<string, unknown>)[bucketName] = target;
  }
  return { formatVersion: 1, buckets };
}

/** Decode a checkpoint and restore non-enumerable reducer metadata. */
function isOperationMeta(value: unknown): value is OperationMeta {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const meta = value as OperationMeta;
  return typeof meta.opId === 'string' && meta.opId.length > 0 && Number.isFinite(meta.timestamp) &&
    (meta.clientId === undefined || typeof meta.clientId === 'string') &&
    meta.clock !== null && typeof meta.clock === 'object' && !Array.isArray(meta.clock) &&
    Object.values(meta.clock).every((n) => Number.isSafeInteger(n) && n >= 0);
}

export function deserializeMaterializedState(value: unknown): MaterializedState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<SerializedMaterializedState>;
  if (candidate.formatVersion !== 1 || !candidate.buckets || typeof candidate.buckets !== 'object') {
    return undefined;
  }
  const knownBuckets: readonly string[] = Object.values(BUCKET_BY_ENTITY);
  if (Object.keys(candidate.buckets).some((key) => !knownBuckets.includes(key))) return undefined;
  const state = emptyState();
  for (const [entityType, bucketName] of Object.entries(BUCKET_BY_ENTITY)) {
    const encodedBucket = (candidate.buckets as Record<string, unknown>)[bucketName];
    if (!encodedBucket || typeof encodedBucket !== 'object' || Array.isArray(encodedBucket)) return undefined;
    const target = state[bucketName] as unknown as Record<string, InternalEntity>;
    for (const [entityId, encoded] of Object.entries(encodedBucket as Record<string, unknown>)) {
      if (!encoded || typeof encoded !== 'object') return undefined;
      const record = encoded as Partial<SerializedMaterializedState['buckets'][keyof MaterializedState][string]>;
      if (!record.data || typeof record.data !== 'object' || Array.isArray(record.data) ||
          !Array.isArray(record.entityVersions) || record.entityVersions.length === 0 ||
          !record.entityVersions.every(isOperationMeta) || !record.fieldVersions ||
          typeof record.fieldVersions !== 'object' || Array.isArray(record.fieldVersions)) {
        return undefined;
      }
      for (const versions of Object.values(record.fieldVersions)) {
        if (!Array.isArray(versions) || !versions.every((version) => version !== null &&
            typeof version === 'object' && typeof version.deleted === 'boolean' && isOperationMeta(version.meta))) {
          return undefined;
        }
      }
      const entity = { ...(record.data as Record<string, unknown>) } as InternalEntity;
      entity.id = entityId;
      attachMetadata(
        entity,
        record.entityVersions.map((meta) => ({ ...meta, clock: { ...meta.clock } })),
        Object.fromEntries(
          Object.entries(record.fieldVersions).map(([key, versions]) => [
            key,
            (versions as FieldVersion[]).map((version) => ({
              ...version,
              meta: { ...version.meta, clock: { ...version.meta.clock } },
            })),
          ]),
        ),
      );
      target[entityId] = entity;
    }
  }
  return state;
}

export function bucketFor(
  state: MaterializedState,
  entityType: string,
): MaterializedBucket | undefined {
  if (!isModeled(entityType)) return undefined;
  return state[BUCKET_BY_ENTITY[entityType]] as unknown as MaterializedBucket;
}

/** reducer 会物化的实体类型（供门禁与宿主自省）。 */
export const MODELED_ENTITY_TYPES: readonly string[] = Object.keys(BUCKET_BY_ENTITY);

/**
 * 🔴 **合法但尚未物化**的实体 —— 必须逐个登记，并写明为什么。
 *
 * 为什么需要这份清单：`isModeled` 原本把两件完全不同的事混为一谈 ——
 *
 *   1. **未知的未来实体**：老客户端不认识它，应当优雅跳过，别让同步卡死（合理）。
 *   2. **已知且合法的实体，只是还没实现**：跳过它 = **静默丢用户数据**。
 *
 * 实测过第 2 种：`NOTE` / `TASK_REPEAT_CFG` 都是合法实体
 * （`isEntityType()` 返回 true），`dispatch` **不报错**，op **正常入队并同步到所有设备**，
 * 但**没有任何设备会物化它们**。用户建一条重复任务，它同步得到处都是，哪儿也不显示。
 *
 * ⚠️ **`REMINDER` 曾经也在这份清单里，2026-10-02 已从"未物化"移出** ——
 * 它现在进了 `BUCKET_BY_ENTITY`（桶 `reminders`），有领域模型
 * （`packages/domain/src/entities.ts` 的 `Reminder`）、领域规则
 * （`packages/domain/src/reminders.ts`）与写路径
 * （`packages/app-host/src/reminder-actions.ts`）。
 * 移除登记就是这个清单文件头说的"那个实体的物化已经实现"。
 *
 * 静默是这里最糟的部分。所以这份清单 + `entity-coverage` 测试把"跳过"变成
 * **必须显式登记的决定**：往 `ENTITY_TYPES` 里加一个新实体却忘了实现，
 * 门禁会红，而不是等到用户数据丢了才发现。
 *
 * 从这份清单里移除一项 = 那个实体的物化已经实现。
 */
export const UNMODELED_ENTITY_TYPES: readonly { entityType: string; reason: string }[] = [
  {
    entityType: 'TASK_REPEAT_CFG',
    reason:
      'vendored 线协议里的独立重复规则实体。**heyta 有意不使用它**：' +
      '重复规则放在 Task.repeatRule / Task.repeatDtstart 上（见 packages/domain/src/entities.ts），' +
      '因为一个用户意图必须是一个 op，而本引擎的 reducer 不处理跨实体类型的 op。' +
      '本条不是"还没做"，是"决定不用"。',
  },
  {
    entityType: 'GLOBAL_CONFIG',
    reason: '全局配置，有意落在物化状态之外（不是用户数据）',
  },
  {
    entityType: 'MIGRATION',
    reason: '迁移标记，有意落在物化状态之外（不是用户数据）',
  },
  {
    entityType: 'RECOVERY',
    reason: '恢复标记，有意落在物化状态之外（不是用户数据）',
  },
  {
    entityType: 'ALL',
    reason: '不是真实实体：全量操作的路由类型，无独立实体桶；版本化 snapshot 由 applyFullState 合并所有物化桶',
  },
];

/**
 * 把一条 op 应用到状态。
 *
 * **纯函数**：不修改入参，返回新状态（浅拷贝被改动的桶）。
 */
function applyOperationToEntity(
  state: MaterializedState,
  op: Operation<string>,
  entityId: string,
): MaterializedState {
  // 系统实体（GLOBAL_CONFIG 等）落在物化状态之外，直接忽略。
  // ⚠️ 不要抛错：未来新增实体类型时，老客户端必须能优雅跳过，
  // 而不是让整个同步因为一条不认识的 op 就卡死。
  if (!isModeled(op.entityType)) return state;

  const bucket = BUCKET_BY_ENTITY[op.entityType];
  const payload = op.payload;

  const existing = (state[bucket] as Record<string, unknown>)[entityId] as InternalEntity | undefined;
  const entityVersions = legacyEntityVersions(existing);
  const fieldVersions = legacyFieldVersions(existing);
  const currentMeta = operationMeta(op);
  addUniqueMeta(entityVersions, currentMeta);

  const addFieldVersion = (key: string, value: unknown, deleted: boolean): void => {
    const versions = (fieldVersions[key] ??= []);
    addUnique(versions, { meta: currentMeta, value, deleted });
  };

  // DELETE is a field-level tombstone. It must be materialized even when the
  // create has not arrived yet, otherwise an out-of-order replay can resurrect
  // the entity. Other fields are retained for restore/export semantics.
  if (op.opType === OpType.Delete) {
    addFieldVersion('deletedAt', op.timestamp, false);
  } else {
    if (payload === null || typeof payload !== 'object') return state;
    const incoming = payload as Record<string, unknown>;
    for (const [key, value] of Object.entries(incoming)) {
      addFieldVersion(key, value, value === null);
    }
    // CREATE establishes the derived creation timestamp. The explicit marker
    // is versioned just like any other field, so arrival order cannot invent it.
    if (op.opType === OpType.Create) addFieldVersion('createdAt', op.timestamp, false);
  }

  // Soft deletion changes visibility via deletedAt, never removes content.
  // Keep fields for trash, restore and export, including when their operations
  // arrive after the tombstone. Older field writes cannot clear deletedAt.
  const materialized = materializeVersions(entityId, entityVersions, fieldVersions);

  return {
    ...state,
    [bucket]: { ...(state[bucket] as Record<string, unknown>), [entityId]: materialized },
  } as MaterializedState;

}

/**
 * Apply one logical operation to every entity named by its scope. `entityId`
 * is retained for wire compatibility and is always included in the touched
 * set; `entityIds` is an additional batch scope, never a request to create
 * multiple operations. The same op metadata is therefore used for every
 * member, and duplicate delivery remains idempotent per member.
 */
export function applyOperation(
  state: MaterializedState,
  op: Operation<string>,
): MaterializedState {
  if (isFullStateOperation(op)) return applyFullState(state, op);
  if (!isModeled(op.entityType)) return state;
  const ids = Array.from(
    new Set([
      ...(op.entityId !== undefined ? [op.entityId] : []),
      ...(op.entityIds ?? []),
    ]),
  );
  return ids.reduce((next, entityId) => applyOperationToEntity(next, op, entityId), state);
}

/**
 * Replay applies the same associative field/frontier merge used by live remote
 * delivery. Metadata remains reducer-local and is rebuilt from the op-log.
 * Operations may arrive in any order; causal frontiers and deterministic LWW
 * resolve the result without relying on arrival order.
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
