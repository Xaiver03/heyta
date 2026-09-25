/**
 * heyta 的操作日志存储契约。
 *
 * 这个接口是**同步内核与存储实现之间的接缝**：
 * - 上方：`@heyta/sync-core` 的 `applyRemoteOperations` 等协调器
 * - 下方：IndexedDB / SQLite 等具体实现
 *
 * 它**继承** `RemoteOperationApplyStorePort`（sync-core 定义的崩溃安全存储契约），
 * 并补上 heyta 自己需要的操作。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么必须区分"写入"与"已应用"（这是整个设计的关键）：
 *
 *   远程 op 的落盘与"重放到 reducer"是**两个不同时刻**。如果只有一条路径，
 *   在两者之间崩溃就会导致：op 已落盘但没应用 → 永不再重放 → **静默丢数据**。
 *
 *   因此 `appendBatchSkipDuplicates(..., { pendingApply: true })` 先写入并打标，
 *   只有 reducer 提交被持久化后才 `markApplied`。启动时扫描 `pendingApply`
 *   即可发现"写了一半"的操作并重放。
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { Operation, RemoteOperationApplyStorePort } from '@heyta/sync-core';
import type { EntityType } from '@heyta/shared-schema';
import type { DbKeyRange } from './db.types';
import type { ApplyStatus } from './stores';

/** 操作的来源。 */
export type OperationSource = 'local' | 'remote' | 'import';

/** 一条持久化后的操作记录。 */
export interface StoredOperation<TOperation extends Operation<string> = Operation> {
  /** 本地自增序号，主键。单调、无空洞。 */
  seq: number;
  op: TOperation;
  source: OperationSource;
  /**
   * 应用状态。**是字符串不是布尔** —— IndexedDB 不能索引布尔值，
   * 见 `stores.ts` 的 {@link ApplyStatus} 注释（这是踩过的坑）。
   */
  applyStatus: ApplyStatus;
}

/**
 * 操作日志存储。
 *
 * 实现方必须保证：
 * - `appendBatchSkipDuplicates` **原子且幂等**（同一 opId 重复写入不得产生两条）
 * - 所有方法**可安全并发调用**（并发契约见 `DbAdapter`）
 * - 崩溃后，`pendingApply` 标记的记录**必须仍可被查出**
 */
export interface OpLogStore<
  TOperation extends Operation<string> = Operation,
> extends RemoteOperationApplyStorePort<TOperation> {
  // ── 本地写入 ─────────────────────────────────────────────

  /**
   * 追加本地操作。
   * 返回分配到的 seq（单调递增）。
   */
  appendLocal(ops: TOperation[]): Promise<number[]>;

  // ── 读取 ────────────────────────────────────────────────

  /** 按本地 seq 区间读取操作（含下界、不含上界）。 */
  getOpsSince(
    sinceSeq: number,
    limit?: number,
    excludeClient?: string,
  ): Promise<StoredOperation<TOperation>[]>;

  /** 读取某个实体的全部操作，按 seq 升序。用于重放单个实体。 */
  getOpsForEntity(
    entityType: EntityType,
    entityId: string,
  ): Promise<StoredOperation<TOperation>[]>;

  /** 本地已分配的最大 seq。 */
  getLastLocalSeq(): Promise<number>;

  /** 全量操作（用于导出、快照）。**必须分页**，不要一次拉全库。 */
  getAllOps(range?: DbKeyRange, limit?: number): Promise<StoredOperation<TOperation>[]>;

  // ── 崩溃恢复 ─────────────────────────────────────────────

  /**
   * 找出所有"已落盘但未应用"的操作。
   *
   * 启动时调用。返回非空意味着上次运行在应用过程中崩溃了，
   * 必须先把这些 op 重放完，**再**接受新的同步。
   */
  findPendingApply(): Promise<StoredOperation<TOperation>[]>;

  // ── 压缩 / 归档 ──────────────────────────────────────────

  /**
   * 把 `upToSeq` 之前的操作移入归档 store。
   *
   * 前提：这些 op 的效果已经被快照或 state 完整捕获。
   * 返回被归档的条数。
   */
  archiveUpTo(upToSeq: number): Promise<number>;

  // ── 簿记 ────────────────────────────────────────────────

  /** 读取同步游标（已拉取到的最大 serverSeq）。 */
  getLastServerSeq(): Promise<number>;

  /** 写入同步游标。 */
  setLastServerSeq(seq: number): Promise<void>;
}

/** 存储层的失败原因，供上层区分处理。 */
export enum OpLogStoreErrorCode {
  /** 同一 opId 被写入了两次（调用方 bug 或恶意输入）。 */
  DUPLICATE_OP_ID = 'DUPLICATE_OP_ID',
  /** seq 出现空洞 —— 说明发生了非原子写入或数据损坏。 */
  SEQ_GAP = 'SEQ_GAP',
  /** 事务嵌套调用。 */
  NESTED_TRANSACTION = 'NESTED_TRANSACTION',
  /** 存储不可用（配额耗尽、被浏览器回收等）。 */
  STORAGE_UNAVAILABLE = 'STORAGE_UNAVAILABLE',
}

export class OpLogStoreError extends Error {
  constructor(
    public readonly code: OpLogStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OpLogStoreError';
  }
}
