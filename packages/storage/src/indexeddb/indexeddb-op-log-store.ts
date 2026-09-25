/**
 * IndexedDB 操作日志存储
 * ========================
 *
 * 实现 {@link OpLogStore}。这是同步系统的本地事实来源。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 两个不能妥协的正确性要求：
 *
 * 1. **`appendBatchSkipDuplicates` 必须原子且幂等。**
 *    同一批里重复的 opId 和"库里已存在的 opId"都必须被跳过。
 *    实现方式：靠 opId 的**唯一索引** + 捕获 ConstraintError，
 *    **不是**先 getAll 再判断 —— 那有 TOCTOU 竞态：两个并发批次
 *    都会查到"不存在"，然后都尝试写入。
 *
 * 2. **seq 必须无空洞。**
 *    seq 是同步游标的基础。若有空洞（比如失败回滚留下 5 却写了 6），
 *    增量同步会永久漏掉中间的操作 —— **静默丢数据**。
 *    因此写 ops 与更新 `lastLocalSeq` 必须在**同一个事务**里。
 * ─────────────────────────────────────────────────────────────────────────
 */

import type {
  Operation,
  RemoteOperationApplyStorePort,
} from '@heyta/sync-core';
import type { EntityType } from '@heyta/shared-schema';

import type { DbAdapter, DbKeyRange, DbTx } from '../db.types.js';
import {
  OpLogStoreError,
  OpLogStoreErrorCode,
  type OpLogStore,
  type OperationSource,
  type StoredOperation,
} from '../op-log-store.js';
import {
  META_FIELDS,
  META_KEYS,
  OP_FIELDS,
  OP_INDEXES,
  STORES,
} from '../stores.js';

/**
 * `appendBatchSkipDuplicates` 的结果类型。
 *
 * ⚠️ **从端口派生，而不是从 sync-core 直接 import。**
 * `RemoteOperationAppendResult` 在 sync-core 里是模块内声明、未从入口导出
 * （直接 import 会报 TS2459）。用 ReturnType 派生还有个好处：
 * 上游改了结果形状我们会**自动跟上**，不会各写一份而漂移。
 */
type RemoteAppendResult<TOperation extends Operation<string>> = Awaited<
  ReturnType<
    RemoteOperationApplyStorePort<TOperation>['appendBatchSkipDuplicates']
  >
>;

/** 一次 appendBatch 的本地结果。 */
export interface AppendBatchResult<TOperation extends Operation<string>> {
  appended: TOperation[];
  skipped: TOperation[];
  seqs: number[];
}

export class IndexedDbOpLogStore<TOperation extends Operation<string> = Operation>
  implements OpLogStore<TOperation>
{
  constructor(
    private readonly db: DbAdapter,
    /** 压缩阈值：归档时保留多少个最近 op 在热区。 */
    private readonly archiveKeepRecent = 500,
  ) {}

  // ── 写入 ────────────────────────────────────────────────

  async appendLocal(ops: TOperation[]): Promise<number[]> {
    const result = await this.appendBatch(ops, 'local', {});
    return result.seqs;
  }

  async appendBatchSkipDuplicates(
    ops: TOperation[],
    source: 'remote',
    options: { pendingApply: true },
  ): Promise<RemoteAppendResult<TOperation>> {
    const result = await this.appendBatch(ops, source, {
      pendingApply: options.pendingApply,
    });
    // ⚠️ 字段名必须是 writtenOps，不是 appendedOps ——
    // 这是 sync-core 定义的结果契约，写错编译就过不去。
    return {
      writtenOps: result.appended,
      skippedCount: result.skipped.length,
      seqs: result.seqs,
    };
  }

  /**
   * 统一写入路径。
   *
   * ⚠️ 整批在**一个事务**里完成：要么全写，要么全不写。
   * 分批写会在中途失败时留下"只写了一半"的状态，而崩溃恢复无法区分
   * "这批本来就只有这些"还是"写到一半炸了"。
   */
  private async appendBatch(
    ops: TOperation[],
    source: OperationSource,
    flags: { pendingApply?: boolean },
  ): Promise<AppendBatchResult<TOperation>> {
    if (ops.length === 0) return { appended: [], skipped: [], seqs: [] };

    return this.db.transaction(
      [STORES.OPS, STORES.META],
      'readwrite',
      async (tx) => {
        const appended: TOperation[] = [];
        const skipped: TOperation[] = [];
        const seqs: number[] = [];
        // 批内去重：同一批里出现两次的 opId 只算一次
        const seenInBatch = new Set<string>();

        for (const op of ops) {
          if (seenInBatch.has(op.id)) {
            skipped.push(op);
            continue;
          }
          seenInBatch.add(op.id);

          const record: Omit<StoredOperation<TOperation>, 'seq'> = {
            op,
            source,
            // 字符串而不是布尔 —— IndexedDB 不能索引布尔（见 stores.ts）
            applyStatus: flags.pendingApply === true ? 'pending' : 'applied',
            // 本地 op 等待上传；远程 op 我们本来就收到了，无需上传
            uploadStatus: source === 'local' ? 'pending' : 'uploaded',
          };

          // 用 addToleratingDuplicate 而不是 try/catch add：
          // 唯一索引冲突必须在**适配器内部** preventDefault，
          // 否则错误冒泡会中止整个事务，把整批写入都回滚掉。
          const outcome = await (
            tx as DbTx & {
              addToleratingDuplicate: (
                s: string,
                v: unknown,
              ) => Promise<{ ok: boolean; key?: number }>;
            }
          ).addToleratingDuplicate(STORES.OPS, record);

          if (!outcome.ok) {
            // 唯一索引冲突 = 这个 opId 已经存在。这是**正常路径**（同步会重复投递）
            skipped.push(op);
            continue;
          }
          appended.push(op);
          seqs.push(outcome.key!);
        }

        // 与写 ops 同一事务更新 lastLocalSeq —— 保证 seq 与游标不会脱节
        if (seqs.length > 0) {
          const maxSeq = Math.max(...seqs);
          const current = await readMetaNumber(tx, META_KEYS.LAST_LOCAL_SEQ);
          if (maxSeq > current) {
            await writeMeta(tx, META_KEYS.LAST_LOCAL_SEQ, maxSeq);
          }
        }

        return { appended, skipped, seqs };
      },
    );
  }

  /** 把本地 op 标记成"已应用"（本地 op 写入时就直接标了，这里用于重试）。 */
  async markApplied(seqs: number[]): Promise<void> {
    if (seqs.length === 0) return;
    await this.db.transaction([STORES.OPS], 'readwrite', async (tx) => {
      for (const seq of seqs) {
        const rec = await tx.get<StoredOperation<TOperation>>(STORES.OPS, seq);
        if (rec === undefined) continue;
        // ⚠️ 不传第三个参数（显式 key）：store 用了 keyPath 'seq'，
        // 而 rec.seq 已经在对象里。put(value, key) 在 keyPath 存在时会抛 DataError。
        await tx.put(STORES.OPS, { ...rec, applyStatus: 'applied' });
      }
    });
  }

  async markFailed(opIds: string[]): Promise<void> {
    if (opIds.length === 0) return;
    await this.db.transaction([STORES.OPS], 'readwrite', async (tx) => {
      for (const opId of opIds) {
        const rec = await tx.getFromIndex<StoredOperation<TOperation>>(
          STORES.OPS,
          OP_INDEXES.OP_ID,
          opId,
        );
        if (rec === undefined) continue;
        await tx.put(STORES.OPS, { ...rec, applyStatus: 'failed' });
      }
    });
  }

  /**
   * 合并远程 op 的向量时钟。
   *
   * ⚠️ 这里**不做冲突判定** —— 那是 sync-core 的职责。
   * 存储层只负责把时钟持久化，保证"收到但还没应用"的 op 的时钟
   * 在崩溃后仍然存在（否则重启后会误判并发而丢更新）。
   */
  async mergeRemoteOpClocks(ops: TOperation[]): Promise<void> {
    if (ops.length === 0) return;
    await this.db.transaction([STORES.META], 'readwrite', async (tx) => {
      await writeMeta(
        tx,
        'pendingRemoteClocks',
        ops.map((op) => op.vectorClock ?? {}),
      );
    });
  }

  async markReducersCommittedAndMergeClocks(
    seqs: number[],
    _ops: TOperation[],
    rejectedOpIds?: string[],
  ): Promise<void> {
    await this.markApplied(seqs);
    if (rejectedOpIds !== undefined && rejectedOpIds.length > 0) {
      await this.markFailed(rejectedOpIds);
    }
  }

  /** 清理"全量状态"操作，只保留最新的。返回被清除的条数。 */
  async clearFullStateOpsExcept(excludeIds: string[]): Promise<number> {
    const exclude = new Set(excludeIds);
    let cleared = 0;

    await this.db.transaction([STORES.OPS], 'readwrite', async (tx) => {
      const all = await tx.getAllFromIndex<StoredOperation<TOperation>>(
        STORES.OPS,
        OP_INDEXES.ENTITY_IDS,
        undefined,
      );
      for (const rec of all) {
        if (isFullStateOp(rec.op) && !exclude.has(rec.op.id)) {
          await tx.delete(STORES.OPS, rec.seq);
          cleared += 1;
        }
      }
    });

    return cleared;
  }

  // ── 读取 ────────────────────────────────────────────────

  async getOpsSince(
    sinceSeq: number,
    limit?: number,
    excludeClient?: string,
  ): Promise<StoredOperation<TOperation>[]> {
    const all = await this.db.getAll<StoredOperation<TOperation>>(STORES.OPS, {
      lower: sinceSeq,
      lowerOpen: true,
    });
    const filtered =
      excludeClient === undefined
        ? all
        : all.filter((r) => r.op.clientId !== excludeClient);
    return limit === undefined ? filtered : filtered.slice(0, limit);
  }

  async getOpsForEntity(
    entityType: EntityType,
    entityId: string,
  ): Promise<StoredOperation<TOperation>[]> {
    const rows = await this.db.getAllFromIndex<StoredOperation<TOperation>>(
      STORES.OPS,
      OP_INDEXES.ENTITY,
      [entityType, entityId],
    );
    return rows.sort((a, b) => a.seq - b.seq);
  }

  async getLastLocalSeq(): Promise<number> {
    const value = await this.db.get<{ key: string; value: number }>(
      STORES.META,
      META_KEYS.LAST_LOCAL_SEQ,
    );
    return value?.value ?? 0;
  }

  async getAllOps(range?: DbKeyRange, limit?: number): Promise<StoredOperation<TOperation>[]> {
    const all = await this.db.getAll<StoredOperation<TOperation>>(STORES.OPS, range);
    const sorted = all.sort((a, b) => a.seq - b.seq);
    return limit === undefined ? sorted : sorted.slice(0, limit);
  }

  // ── 崩溃恢复 ────────────────────────────────────────────

  /**
   * 找出所有"已落盘但未应用"的 op。
   *
   * 启动时必须先重放它们，**再**接受新的同步。
   * 否则那个 op 的状态永远不会生效，而它已占用了 seq —— 等于静默丢数据。
   */
  async findPendingApply(): Promise<StoredOperation<TOperation>[]> {
    const rows = await this.db.getAllFromIndex<StoredOperation<TOperation>>(
      STORES.OPS,
      OP_INDEXES.PENDING_APPLY,
      // 查字符串 'pending'。**不能查布尔 true** —— IndexedDB 不索引布尔值，
      // 索引条目会被静默跳过，查询恒为空（踩过的坑）。
      'pending',
    );
    return rows.sort((a, b) => a.seq - b.seq);
  }

  // ── 压缩 / 归档 ──────────────────────────────────────────

  /**
   * 把 `upToSeq` 之前的 op 移入归档。
   *
   * ⚠️ 调用方必须先确认这些 op 的效果已被快照完整捕获。
   * 这里的实现**不校验**这件事 —— 它无法知道快照是否完整。
   */
  async archiveUpTo(upToSeq: number): Promise<number> {
    const cutoff = upToSeq - this.archiveKeepRecent;
    if (cutoff <= 0) return 0;

    return this.db.transaction(
      [STORES.OPS, STORES.ARCHIVE],
      'readwrite',
      async (tx) => {
        const rows = await tx.getAll<StoredOperation<TOperation>>(STORES.OPS, {
          upper: cutoff,
          upperOpen: true,
        });
        for (const rec of rows) {
          // ARCHIVE 也用 keyPath 'seq'，同样不能传显式 key
          await tx.put(STORES.ARCHIVE, rec);
          await tx.delete(STORES.OPS, rec.seq);
        }
        return rows.length;
      },
    );
  }

  // ── 簿记 ────────────────────────────────────────────────

  /**
   * 待上传的本地 op（离线队列）。
   *
   * 按 seq 升序 —— 上传顺序必须与本地产出顺序一致，
   * 否则服务端的因果校验会看到"后发生的先到"。
   */
  async findPendingUpload(): Promise<StoredOperation<TOperation>[]> {
    const rows = await this.db.getAllFromIndex<StoredOperation<TOperation>>(
      STORES.OPS,
      OP_INDEXES.PENDING_UPLOAD,
      'pending',
    );
    return rows.sort((a, b) => a.seq - b.seq);
  }

  /**
   * 标记 op 已上传，并记录服务端分配的 seq。
   *
   * ⚠️ 必须同时把 `op.seq` 写成服务端序号：下次上传时
   * `lastKnownServerSeq` 与冲突判定都依赖它。
   */
  async markUploaded(
    serverSeqsByOpId: ReadonlyMap<string, number>,
  ): Promise<number> {
    if (serverSeqsByOpId.size === 0) return 0;

    return this.db.transaction(
      [STORES.OPS],
      'readwrite',
      async (tx) => {
        let updated = 0;
        for (const [opId, serverSeq] of serverSeqsByOpId) {
          // 用已有的 getKeyFromIndex（DbAdapter 没有 getAllKeysFromIndex）
          const key = await tx.getKeyFromIndex(STORES.OPS, OP_INDEXES.OP_ID, opId);
          if (key === undefined) continue;

          const record = await tx.get<StoredOperation<TOperation>>(STORES.OPS, key);
          if (record === undefined) continue;

          // 只改本地元数据，**不碰 op** —— op 是要发给服务端的东西
          await tx.put(STORES.OPS, {
            ...record,
            uploadStatus: 'uploaded',
            serverSeq,
          });
          updated += 1;
        }
        return updated;
      },
    );
  }

  async getLastServerSeq(): Promise<number> {
    return readMetaNumber(this.db, META_KEYS.LAST_SERVER_SEQ);
  }

  async setLastServerSeq(seq: number): Promise<void> {
    await this.db.transaction([STORES.META], 'readwrite', async (tx) => {
      await writeMeta(tx, META_KEYS.LAST_SERVER_SEQ, seq);
    });
  }
}

// ─────────────────────────────────────────────────────────────
// 辅助
// ─────────────────────────────────────────────────────────────

/** 是否"全量状态"操作（用于压缩）。按 payload 里的标记判断。 */
function isFullStateOp(op: Operation<string>): boolean {
  const payload = op.payload;
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'isFullState' in payload &&
    (payload as { isFullState?: unknown }).isFullState === true
  );
}

/**
 * 读一个 meta 数字。
 *
 * ⚠️ 参数类型是 `DbAdapter | DbTx` —— 因为**同一个逻辑既要在事务外调用
 * （getLastServerSeq），也要在事务内调用**（appendBatch 里更新游标）。
 * 只接受 DbAdapter 的话，事务内调用会编译失败（我第一版就是这样）。
 */
async function readMetaNumber(
  db: Pick<DbAdapter, 'get'> | Pick<DbTx, 'get'>,
  key: string,
): Promise<number> {
  const rec = await db.get<{ key: string; value: number }>(STORES.META, key);
  return rec?.value ?? 0;
}

async function writeMeta(tx: DbTx, key: string, value: unknown): Promise<void> {
  await tx.put(STORES.META, { [META_FIELDS.KEY]: key, [META_FIELDS.VALUE]: value });
}

export { OpLogStoreError, OpLogStoreErrorCode };
export type { StoredOperation, OperationSource };
