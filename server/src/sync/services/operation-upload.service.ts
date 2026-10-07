import { authorizeInboundOperations, type InboundUploadIdentity } from '../../automation/worker-identity';
import { Prisma } from '@prisma/client';
import { Logger } from '../../logger';
import {
  CLIENT_ID_REGEX,
  computeOpStorageBytes,
  MAX_CLIENT_ID_LENGTH,
} from '../sync.const';
import {
  DEFAULT_SYNC_CONFIG,
  DUPLICATE_OP_SELECT,
  isCausalFullStateOperation,
  Operation,
  OP_TYPES,
  ProcessOperationResult,
  SyncConfig,
  SYNC_ERROR_CODES,
  UploadResult,
  VectorClock,
} from '../sync.types';
import {
  detectConflict,
  getStoredEntityIds,
  isSameDuplicateOperation,
  isSameIncomingOperation,
} from '../conflict';
import {
  ALLOWED_ENTITY_TYPES,
  ValidationService,
  type ValidationResult,
} from './validation.service';
import { matchesVaultPayloadGeneration } from '../vault-payload';

// Observability threshold: log a warning when the full-state op aggregate scan
// exceeds this duration. Mirrors the threshold used by the legacy snapshot
// vector-clock aggregate in OperationDownloadService so production logs use a
// consistent slow-aggregate signal.
const SLOW_FULL_STATE_AGGREGATE_MS = 5_000;
const INVALID_AUDIT_FIELD = '[invalid]';
const SAFE_AUDIT_ID_REGEX = /^[A-Za-z0-9_-]+$/;
// TIME_TRACKING addresses its ops by a composite `CONTEXT_TYPE:contextId:date` key, so
// under the plain charset every time-tracking rejection audited as '[invalid]' and the
// OP_REJECTED logs could not name the entity. The colon stays scoped to that one entity
// type: PLUGIN_USER_DATA ids are `pluginId:key`, and `key` is plugin-authored text that
// `assertPluginPersistenceKey` checks for type and length only -- never a charset. Those
// must keep redacting.
const SAFE_AUDIT_COMPOSITE_ID_REGEX = /^[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+){1,2}$/;

const isSafeAuditIdentifier = (
  value: unknown,
  maxLength: number,
  pattern: RegExp = SAFE_AUDIT_ID_REGEX,
): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= maxLength &&
  pattern.test(value);

const getSafeAuditOperationMetadata = (
  op: Operation,
): { opId: string; entityType: string; entityId?: string; opType: string } => {
  const rawOp = op as unknown as Record<string, unknown>;
  const rawOpId = rawOp['id'];
  const rawEntityType = rawOp['entityType'];
  const rawEntityId = rawOp['entityId'];
  const rawOpType = rawOp['opType'];

  return {
    opId: isSafeAuditIdentifier(rawOpId, 255) ? rawOpId : INVALID_AUDIT_FIELD,
    entityType:
      typeof rawEntityType === 'string' && ALLOWED_ENTITY_TYPES.has(rawEntityType)
        ? rawEntityType
        : INVALID_AUDIT_FIELD,
    entityId:
      rawEntityId === undefined || rawEntityId === null
        ? undefined
        : isSafeAuditIdentifier(
              rawEntityId,
              255,
              rawEntityType === 'TIME_TRACKING'
                ? SAFE_AUDIT_COMPOSITE_ID_REGEX
                : SAFE_AUDIT_ID_REGEX,
            )
          ? rawEntityId
          : INVALID_AUDIT_FIELD,
    opType:
      typeof rawOpType === 'string' && OP_TYPES.includes(rawOpType as Operation['opType'])
        ? rawOpType
        : INVALID_AUDIT_FIELD,
  };
};

const getSafeAuditClientId = (clientId: string): string =>
  clientId.length <= MAX_CLIENT_ID_LENGTH && CLIENT_ID_REGEX.test(clientId)
    ? clientId
    : INVALID_AUDIT_FIELD;

export class OperationUploadService {
  constructor(
    private readonly validationService: ValidationService,
    private readonly config: SyncConfig = DEFAULT_SYNC_CONFIG,
  ) {}

  private clampFutureTimestamp(
    userId: number,
    clientId: string,
    op: Operation,
    now: number,
  ): number {
    const originalTimestamp = op.timestamp;
    const maxAllowedTimestamp = now + this.config.maxClockDriftMs;
    if (op.timestamp > maxAllowedTimestamp) {
      op.timestamp = maxAllowedTimestamp;
      Logger.audit({
        event: 'TIMESTAMP_CLAMPED',
        userId,
        clientId: getSafeAuditClientId(clientId),
        ...getSafeAuditOperationMetadata(op),
        originalTimestamp,
        clampedTo: maxAllowedTimestamp,
        driftMs: originalTimestamp - now,
      });
    }
    return originalTimestamp;
  }

  private rejectedUploadResult(
    userId: number,
    clientId: string,
    op: Operation,
    error: string | undefined,
    errorCode: UploadResult['errorCode'],
    existingClock?: VectorClock,
  ): UploadResult {
    Logger.audit({
      event: 'OP_REJECTED',
      userId,
      clientId: getSafeAuditClientId(clientId),
      ...getSafeAuditOperationMetadata(op),
      errorCode,
      reason: errorCode ?? 'OP_REJECTED',
    });

    return {
      opId: op.id,
      accepted: false,
      error,
      errorCode,
      existingClock,
    };
  }

  /**
   * Aggregate the per-client max vector_clock counter over all operations for
   * `userId` with `server_seq < beforeServerSeq`. Used at full-state op upload
   * time so the persisted `latest_full_state_vector_clock` reflects every
   * client whose ops may still live in conflict detection — not just the
   * clients named on the snapshot op itself.
   *
   * Logs a warning when the scan exceeds `SLOW_FULL_STATE_AGGREGATE_MS` so
   * pathological histories (millions of ops, cleanup retention too long) are
   * observable in production before they approach the 60s upload-tx timeout.
   */
  private async _aggregatePriorVectorClock(
    tx: Prisma.TransactionClient,
    userId: number,
    beforeServerSeq: number,
  ): Promise<VectorClock> {
    const startedAt = Date.now();
    const rows = await tx.$queryRaw<Array<{ client_id: string; max_counter: bigint }>>`
      SELECT kv.key AS client_id, MAX(kv.value::bigint) AS max_counter
      FROM operations, LATERAL jsonb_each_text(vector_clock) AS kv(key, value)
      WHERE user_id = ${userId}
        AND server_seq < ${beforeServerSeq}
        AND jsonb_typeof(vector_clock) = 'object'
        AND kv.value ~ '^[0-9]+$'
      GROUP BY kv.key
    `;
    const out: VectorClock = {};
    for (const row of rows) {
      out[row.client_id] = Number(row.max_counter);
    }
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > SLOW_FULL_STATE_AGGREGATE_MS) {
      Logger.warn(
        `[user:${userId}] Full-state op aggregate scan took ${elapsedMs}ms ` +
          `(${rows.length} clients, beforeSeq=${beforeServerSeq}); approaching ` +
          `upload-tx timeout. Investigate history size and cleanup retention.`,
      );
    }
    return out;
  }

  /**
   * Aggregate the prior vector clock, merge the full-state op's clock into it
   * (max per client) and persist it as the user's latest-full-state marker.
   * Costs 2 DB round trips (the aggregate scan + the userSyncState update).
   */
  private async persistMergedFullStateClock(
    tx: Prisma.TransactionClient,
    userId: number,
    serverSeq: number,
    opClock: VectorClock,
  ): Promise<void> {
    const priorAggregate = await this._aggregatePriorVectorClock(tx, userId, serverSeq);
    const mergedClock: VectorClock = { ...priorAggregate };
    for (const [clientId, counter] of Object.entries(opClock)) {
      mergedClock[clientId] = Math.max(mergedClock[clientId] ?? 0, counter);
    }
    await tx.userSyncState.update({
      where: { userId },
      data: {
        latestFullStateSeq: serverSeq,
        latestFullStateVectorClock: mergedClock as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Process a single operation within a transaction.
   * Handles validation, conflict detection, and persistence.
   */
  async processOperation(
    userId: number,
    clientId: string,
    op: Operation,
    now: number,
    tx: Prisma.TransactionClient,
    prevalidatedResult?: ValidationResult,
    wasOccupiedAtRequestStart?: boolean,
    firstRequestOperation?: { op: Operation; originalTimestamp: number },
    inboundIdentity?: InboundUploadIdentity,
  ): Promise<ProcessOperationResult> {
    // Rejected ops have no storage cost; the caller only reads storageBytes when
    // result.accepted is true.
    const reject = (result: UploadResult): ProcessOperationResult => ({
      result,
      storageBytes: 0,
      fallback: false,
    });

    // This also guards internal upload callers and exact duplicate returns.
    if (!await authorizeInboundOperations(tx, userId, clientId, [op], inboundIdentity)) {
      return reject({ opId: op.id, accepted: false, error: 'Inbound commit authorization required',
        errorCode: SYNC_ERROR_CODES.INVALID_CLIENT_ID });
    }

    // Clamp future timestamps instead of rejecting them (prevents silent data
    // loss).
    const originalTimestamp = this.clampFutureTimestamp(userId, clientId, op, now);

    // Validate operation (including clientId match)
    const validation =
      prevalidatedResult ?? this.validationService.validateOp(op, clientId);
    if (firstRequestOperation) {
      const isExactRetry = isSameIncomingOperation(
        firstRequestOperation.op,
        op,
        firstRequestOperation.originalTimestamp,
        originalTimestamp,
      );
      return reject(
        this.rejectedUploadResult(
          userId,
          clientId,
          op,
          isExactRetry
            ? 'Duplicate operation ID'
            : 'Operation ID already belongs to a different operation',
          isExactRetry
            ? SYNC_ERROR_CODES.DUPLICATE_OPERATION
            : SYNC_ERROR_CODES.INVALID_OP_ID,
        ),
      );
    }

    if (!validation.valid) {
      return reject(
        this.rejectedUploadResult(
          userId,
          clientId,
          op,
          validation.error,
          validation.errorCode,
        ),
      );
    }

    // Capture the complete vector clock for full-state ops. The operation row
    // is lossless as well; the aggregate marker is retained for fast frontier
    // reads and compatibility with older full-state rows.
    const fullStateVectorClock = isCausalFullStateOperation(op)
      ? { ...op.vectorClock }
      : undefined;

    // Check for duplicate operation before conflict checks and sequence allocation.
    // This avoids expensive conflict work on retries and prevents rejected duplicates
    // from advancing lastSeq.
    const existingOp = await tx.operation.findUnique({
      where: { id: op.id },
      // `serverSeq` 不在 DUPLICATE_OP_SELECT 里，但幂等重试要把**原来那个序号**
      // 回给客户端，所以这里显式补上 —— 与 snapshot-handler 同一写法。
      select: { ...DUPLICATE_OP_SELECT, serverSeq: true },
    });

    if (existingOp) {
      if (
        !isSameDuplicateOperation(
          existingOp,
          userId,
          op,
          this.config.maxClockDriftMs,
          originalTimestamp,
        )
      ) {
        return reject(
          this.rejectedUploadResult(
            userId,
            clientId,
            op,
            'Operation ID already belongs to a different operation',
            SYNC_ERROR_CODES.INVALID_OP_ID,
          ),
        );
      }

      // 🔴 幂等重试：`isSameDuplicateOperation` 已经确认磁盘上那条就是**同一个 op**
      // （内容不同会走上面的 INVALID_OP_ID，那仍然是硬拒绝）。也就是说客户端上一次
      // 其实传成功了，只是没收到响应。
      //
      // 这时回 `DUPLICATE_OPERATION` 是错的 —— 它的字面意思是"服务端已经有了"，
      // 而那**正是上传想要的结果**。把它当失败，客户端就不会去标记"已上传"，
      // 于是队列永不清空 → 下次重传整批 → 又全是重复 → **永久卡死**：
      // 用户看到"同步一直失败 + 待上传数永远不减"，而数据其实一条都没丢。
      //
      // 按幂等语义回 accepted + 原来那个 serverSeq。
      // 存储计量必须是 0：本次没有写入任何东西（调用方只在 accepted 时读 storageBytes）。
      // 与 sync.routes.snapshot-handler.ts 里 BACKUP_IMPORT / REPAIR 的幂等分支同形。
      return {
        result: { opId: op.id, accepted: true, serverSeq: existingOp.serverSeq },
        storageBytes: 0,
        fallback: false,
      };
    }

    if (wasOccupiedAtRequestStart) {
      return reject(
        this.rejectedUploadResult(
          userId,
          clientId,
          op,
          'Operation ID was already occupied before quota enforcement',
          SYNC_ERROR_CODES.INVALID_OP_ID,
        ),
      );
    }

    // Once a full-history migration commits, every subsequent write must use
    // the published payload generation. This check is intentionally inside
    // the same transaction as the sequence allocation. The caller locks the
    // per-user sync state before entering this reducer, so a migration racing
    // this request waits on the same row and cannot publish a new payload
    // generation between this check and the write.
    const activePayload = await tx.vaultKeyPackage.findUnique({
      where: { userId },
      select: { activePayloadKeyVersion: true },
    });
    if (
      activePayload?.activePayloadKeyVersion !== null &&
      activePayload?.activePayloadKeyVersion !== undefined &&
      !matchesVaultPayloadGeneration(op.payload, activePayload.activePayloadKeyVersion)
    ) {
      return reject({
        opId: op.id,
        accepted: false,
        error: 'Operation payload uses an inactive encryption generation',
        errorCode: SYNC_ERROR_CODES.E2EE_REQUIRED,
      });
    }

    // Check for conflicts with existing operations
    const conflict = await detectConflict(userId, op, tx);
    if (conflict.hasConflict) {
      const errorCode =
        conflict.conflictType === 'concurrent' ||
        conflict.conflictType === 'equal_different_client'
          ? SYNC_ERROR_CODES.CONFLICT_CONCURRENT
          : SYNC_ERROR_CODES.CONFLICT_SUPERSEDED;
      return reject(
        this.rejectedUploadResult(
          userId,
          clientId,
          op,
          conflict.reason,
          errorCode,
          conflict.existingClock,
        ),
      );
    }

    // Get next sequence number
    const updatedState = await tx.userSyncState.update({
      where: { userId },
      data: { lastSeq: { increment: 1 } },
    });
    const serverSeq = updatedState.lastSeq;

    // No post-allocation conflict re-check is needed here. The upload transaction
    // already holds the user's sync-state row lock from its first statements;
    // concurrent uploads and migrations for this account therefore cannot commit
    // an intervening operation or payload generation before this increment.

    // Keep the exact validated clock. It is part of the operation's causal
    // proof and must never be top-K pruned before persistence.
    op.vectorClock = { ...op.vectorClock };

    // Size the op once, here, after validation (the stored clock is complete),
    // reusing the payload byte size from validation (so the
    // payload isn't re-stringified). Reused for the payloadBytes column and the
    // caller's acceptedDeltaBytes accumulation.
    const sized = computeOpStorageBytes(op, validation.payloadBytes);

    const createResult = await tx.operation.createMany({
      data: [
        {
          id: op.id,
          userId,
          clientId,
          serverSeq,
          actionType: op.actionType,
          opType: op.opType,
          entityType: op.entityType,
          entityId: op.entityId ?? null,
          // Persist the full entity set for multi-entity ops so conflict detection
          // can match a write to any touched entity across uploads, not just
          // entityIds[0]; single-entity ops store [] and use the scalar (#8334).
          entityIds: getStoredEntityIds(op),
          payload: op.payload as Prisma.InputJsonValue,
          payloadBytes: BigInt(sized.bytes),
          vectorClock: op.vectorClock as Prisma.InputJsonValue,
          schemaVersion: op.schemaVersion,
          clientTimestamp: BigInt(op.timestamp),
          receivedAt: BigInt(now),
          isPayloadEncrypted: op.isPayloadEncrypted ?? false,
          syncImportReason: op.syncImportReason ?? null,
          repairBaseServerSeq: op.repairBaseServerSeq ?? null,
        },
      ],
      skipDuplicates: true,
    });

    // A concurrent retry can pass the duplicate pre-check and then lose the
    // insert race. `createMany(..., skipDuplicates)` maps that to count=0
    // instead of aborting the PostgreSQL transaction with P2002/25P02.
    if (createResult.count === 0) {
      const duplicateOp = await tx.operation.findUnique({
        where: { id: op.id },
        // 同上：竞态分支也要把并发插入那条的 serverSeq 回给客户端。
        select: { ...DUPLICATE_OP_SELECT, serverSeq: true },
      });

      if (!duplicateOp) {
        throw new Error(
          `Operation insert skipped by non-id unique constraint (userId=${userId}, opId=${op.id}, serverSeq=${serverSeq})`,
        );
      }

      await tx.userSyncState.update({
        where: { userId },
        data: { lastSeq: { decrement: 1 } },
      });

      if (
        !isSameDuplicateOperation(
          duplicateOp,
          userId,
          op,
          this.config.maxClockDriftMs,
          originalTimestamp,
        )
      ) {
        return reject(
          this.rejectedUploadResult(
            userId,
            clientId,
            op,
            'Operation ID already belongs to a different operation',
            SYNC_ERROR_CODES.INVALID_OP_ID,
          ),
        );
      }

      // 🔴 幂等重试：`isSameDuplicateOperation` 已经确认磁盘上那条就是**同一个 op**
      // （内容不同会走上面的 INVALID_OP_ID，那仍然是硬拒绝）。也就是说客户端上一次
      // 其实传成功了，只是没收到响应。
      //
      // 这时回 `DUPLICATE_OPERATION` 是错的 —— 它的字面意思是"服务端已经有了"，
      // 而那**正是上传想要的结果**。把它当失败，客户端就不会去标记"已上传"，
      // 于是队列永不清空 → 下次重传整批 → 又全是重复 → **永久卡死**：
      // 用户看到"同步一直失败 + 待上传数永远不减"，而数据其实一条都没丢。
      //
      // 按幂等语义回 accepted + 原来那个 serverSeq。
      // 存储计量必须是 0：本次没有写入任何东西（调用方只在 accepted 时读 storageBytes）。
      // 与 sync.routes.snapshot-handler.ts 里 BACKUP_IMPORT / REPAIR 的幂等分支同形。
      return {
        result: { opId: op.id, accepted: true, serverSeq: duplicateOp.serverSeq },
        storageBytes: 0,
        fallback: false,
      };
    }

    if (fullStateVectorClock) {
      // Persist the aggregate of (prior history ∪ this op's clock), not just the
      // op's own clock. BACKUP_IMPORT uses a fresh `{ clientId: 1 }` by design
      // and a compaction-built SYNC_IMPORT clock may omit old writers. The
      // aggregate marker therefore remains the complete frontier for downloads.
      await this.persistMergedFullStateClock(tx, userId, serverSeq, fullStateVectorClock);
    }

    return {
      result: { opId: op.id, accepted: true, serverSeq },
      storageBytes: sized.bytes,
      fallback: sized.fallback,
    };
  }
}
