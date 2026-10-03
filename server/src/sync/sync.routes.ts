import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  SuperSyncDownloadOpsQuerySchema,
  SUPER_SYNC_CLIENT_ID_REGEX,
  vaultKeyPackageSchema,
  vaultKeyPackageUploadSchema,
  vaultKeyMigrationChunkSchema,
  vaultKeyMigrationManifestSchema,
  vaultKeyMigrationRequestIdSchema,
  vaultKeyMigrationRequestSchema,
  vaultKeyMigrationInventoryPageSchema,
} from '@heyta/shared-schema';
import { Prisma } from '@prisma/client';
import { authenticate, getAuthUser } from '../middleware';
import { prisma } from '../db';
import { revokeAllTokens } from '../auth';
import { createEntitlementGuard } from '../entitlement';
import { loadConfigFromEnv } from '../config';
import { getSyncService } from './sync.service';
import { parseAppVersion } from './checkpoint-gate';
import { Logger } from '../logger';
import {
  UploadOpsRequest,
  DownloadOpsResponse,
  SyncStatusResponse,
  SyncDevicesResponse,
  SYNC_ERROR_CODES,
} from './sync.types';
import { normalizeContentEncoding } from './compressed-body-parser';
import { EncryptedOpsNotSupportedError } from './services/snapshot.service';
import {
  createRawBodyLimitPreParsingHook,
  createValidationErrorResponse,
  ENCRYPTED_OPS_CLIENT_MESSAGE,
  errorMessage,
  MAX_COMPRESSED_SIZE_OPS,
  MAX_COMPRESSED_SIZE_SNAPSHOT,
  MAX_RAW_BODY_SIZE_OPS,
  MAX_RAW_BODY_SIZE_SNAPSHOT,
} from './sync.routes.payload';
import { uploadOpsHandler } from './sync.routes.ops-handler';
import { getWsConnectionService } from './services/websocket-connection.service';
import {
  VaultKeyMigrationError,
  vaultKeyMigrationService,
} from './services/vault-key-migration.service';

/**
 * 路由级限流配置。
 *
 * 🔴 **TEST_MODE 下必须关掉。**
 *
 * 限流是按 IP 计的，而验收套件里的全部设备都来自 127.0.0.1 ——
 * 于是"用例越多越容易撞额度"，表现为随机几个用例报 HTTP 429。
 * 更糟的是它**伪装成业务失败**：我这次看到的现象是"冲突没有被识别"，
 * 排查方向直接偏到同步协议上去了，而真正的原因在限流。
 * 一个会让自己的验收套件随机变红的服务端，没法用来验收。
 *
 * 只在 TEST_MODE（且要求显式 `TEST_MODE_CONFIRM`）下关闭，
 * 生产配置一个字没改。判定复用 `loadConfigFromEnv()`，
 * **不直接读 `process.env.TEST_MODE`** —— 那会变成第二份定义，
 * 而"两套并行定义"正是这个仓库里反复出现的 bug 形状。
 */
const RATE_LIMIT_DISABLED = loadConfigFromEnv().testMode !== undefined;

/**
 * Serialize key-package writes with operation uploads and atomic payload
 * migrations.  The package row is not the synchronization fence: an upload
 * owns `user_sync_state` first and then `users`, and a migration uses the same
 * order.  A wrapper-only rewrap must join that order or it can be overwritten
 * by a migration commit that started before the rewrap.
 */
const withVaultKeyPackageWriteLock = async <T>(
  userId: number,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> => prisma.$transaction(
  async (tx) => {
    await tx.userSyncState.upsert({
      where: { userId },
      create: { userId, lastSeq: 0 },
      update: {},
    });
    await tx.$queryRaw`
      SELECT user_id
      FROM user_sync_state
      WHERE user_id = ${userId}
      FOR UPDATE
    `;
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    return fn(tx);
  },
  { timeout: 30_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
);

function routeRateLimit(max: number, timeWindow: string): false | { max: number; timeWindow: string } {
  if (RATE_LIMIT_DISABLED) return false;
  return { max, timeWindow };
}
import { uploadSnapshotHandler } from './sync.routes.snapshot-handler';

export const syncRoutes = async (fastify: FastifyInstance): Promise<void> => {
  // Add content type parser for gzip-encoded JSON
  // This allows clients to send compressed request bodies with Content-Encoding: gzip
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body: Buffer, done) => {
      // B10: normalize Content-Encoding so RFC-valid values like ' Gzip ' or
      // arrays still hit the gzip branch.
      const encoding = normalizeContentEncoding(req.headers['content-encoding']);
      // W9: reject layered or non-gzip encodings with 415 Unsupported Media
      // Type so clients (and operators) get a clear error rather than a
      // misleading 400 invalid-json when we try to JSON.parse gzip bytes.
      if (encoding.layered || (encoding.value !== '' && encoding.value !== 'gzip')) {
        const err = new Error(
          `Unsupported Content-Encoding: ${encoding.value || 'identity (with separators)'}. ` +
            `Only single-token 'gzip' or identity is accepted.`,
        ) as Error & { statusCode?: number };
        err.statusCode = 415;
        done(err, undefined);
        return;
      }
      if (encoding.value === 'gzip') {
        // Return raw buffer for gzip - will be decompressed in route handler
        done(null, body);
      } else {
        // Parse JSON normally for uncompressed requests
        try {
          // Handle empty body (e.g., DELETE requests)
          if (body.length === 0) {
            done(null, undefined);
            return;
          }
          const json = JSON.parse(body.toString('utf-8'));
          done(null, json);
        } catch (err) {
          done(err as Error, undefined);
        }
      }
    },
  );

  // All sync routes require authentication
  fastify.addHook('preHandler', authenticate);

  // 🔴 权益守卫**必须**排在 `authenticate` 之后：Fastify 的 preHandler 按注册
  // 顺序执行，排在前面时 `req.user` 还是空的，`getAuthUser` 会直接抛异常。
  // 守卫自身读 `ENTITLEMENT_GATE_ENABLED`（默认关）：关着的时候它立刻返回，
  // 一次数据库都不查，自托管默认全放行（docs/plans/subscription-boundary.md §1）。
  fastify.addHook('preHandler', createEntitlementGuard());

  // POST /api/sync/ops - Upload operations
  // Route-level limiting is a pre-auth per-IP backstop for upload floods before
  // auth/DB work. uploadOpsHandler applies the separate per-user fairness limit.
  // A separate URL prevents legacy servers from stripping encoding metadata.
  for (const uploadPath of ['/ops', '/ops/causal']) {
  fastify.post<{ Body: UploadOpsRequest }>(
    uploadPath,
    {
      // Cap raw request body at the base64 envelope of the binary gzip limit.
      // `parseCompressedJsonBody` still enforces MAX_COMPRESSED_SIZE_OPS
      // against decoded gzip bytes.
      bodyLimit: MAX_RAW_BODY_SIZE_OPS,
      preParsing: createRawBodyLimitPreParsingHook(
        MAX_COMPRESSED_SIZE_OPS,
        MAX_RAW_BODY_SIZE_OPS,
      ),
      config: {
        rateLimit: routeRateLimit(100, '1 minute'),
      },
    },
    uploadOpsHandler,
  );
  }

  // GET /api/sync/ops - Download operations
  fastify.get<{
    Querystring: { sinceSeq: string; limit?: string; excludeClient?: string };
  }>(
    '/ops',
    {
      config: {
        rateLimit: routeRateLimit(200, '1 minute'),
      },
    },
    async (
      req: FastifyRequest<{
        Querystring: { sinceSeq: string; limit?: string; excludeClient?: string };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const userId = getAuthUser(req).userId;

        // Validate query params
        const parseResult = SuperSyncDownloadOpsQuerySchema.safeParse(req.query);
        if (!parseResult.success) {
          Logger.warn(
            `[user:${userId}] Download validation failed`,
            parseResult.error.issues,
          );
          return reply
            .status(400)
            .send(createValidationErrorResponse(parseResult.error.issues));
        }

        const { sinceSeq, limit = 500, excludeClient, appVersion } = parseResult.data;
        const syncService = getSyncService();

        // `excludeClient` is the caller's own id (it means "don't echo my ops
        // back"), so a caller that omits it simply isn't recorded. `appVersion`
        // rides along for the checkpoint gate (#9962); a malformed one is
        // dropped rather than failing the download.
        if (excludeClient) {
          syncService.touchDevice(userId, excludeClient, parseAppVersion(appVersion));
        }

        Logger.debug(
          `[user:${userId}] Download request: sinceSeq=${sinceSeq}, limit=${limit}`,
        );

        const maxLimit = Math.min(limit, 1000);

        // Use atomic read to get ops and latestSeq in one transaction
        // This prevents race conditions where new ops arrive between the two reads
        const { ops, latestSeq, gapDetected, latestSnapshotSeq, snapshotVectorClock, causalFrontier } =
          await syncService.getOpsSinceWithSeq(
            userId,
            sinceSeq,
            excludeClient,
            maxLimit + 1,
          );

        const hasMore = ops.length > maxLimit;
        if (hasMore) ops.pop();

        if (gapDetected) {
          Logger.warn(
            `[user:${userId}] Download: gap detected, client should resync from snapshot`,
          );
        }

        Logger.info(
          `[user:${userId}] Download: ${ops.length} ops ` +
            `(sinceSeq=${sinceSeq}, latestSeq=${latestSeq}, hasMore=${hasMore}, gap=${gapDetected}` +
            `${latestSnapshotSeq ? `, snapshotSeq=${latestSnapshotSeq}` : ''})`,
        );

        const response: DownloadOpsResponse = {
          ops,
          hasMore,
          latestSeq,
          gapDetected: gapDetected || undefined, // Only include if true
          snapshotVectorClock, // Aggregated clock from skipped ops for conflict resolution
          causalFrontier,
          serverTime: Date.now(), // For client clock drift detection
          // The frontier is signed, bound to this account and served losslessly;
          // clients may use the dedicated delta endpoint after validating it.
          capabilities: { causalRepairSnapshots: true, causalFrontierDelta: true },
        };

        return reply.send(response);
      } catch (err) {
        Logger.error(`Download ops error: ${errorMessage(err)}`);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  // POST /api/sync/snapshot - Upload full state
  // Supports gzip-compressed request bodies via Content-Encoding: gzip header
  // B8: per-user rate limit — uploads are expensive (up to 30MB body,
  // `prepareSnapshotCache` zlib + JSON.stringify, full-state op replay).
  // 10/15 min matches the other write-heavy operations (DELETE /data,
  // /restore/:seq) so burst-uploads can't pin a worker.
  fastify.post<{ Body: unknown }>(
    '/snapshot',
    {
      bodyLimit: MAX_RAW_BODY_SIZE_SNAPSHOT,
      preParsing: createRawBodyLimitPreParsingHook(
        MAX_COMPRESSED_SIZE_SNAPSHOT,
        MAX_RAW_BODY_SIZE_SNAPSHOT,
      ),
      config: {
        // B8: snapshot uploads are heavy (full state replay + cache write).
        // Match the backup/repair-import budget.
        rateLimit: routeRateLimit(10, '15 minutes'),
      },
    },
    uploadSnapshotHandler,
  );

  // GET /api/sync/status - Get sync status (diagnostic — not used by the production client)
  fastify.get(
    '/status',
    {
      config: {
        rateLimit: routeRateLimit(60, '1 minute'),
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const userId = getAuthUser(req).userId;
        const syncService = getSyncService();

        const [latestSeq, devicesOnline, snapshotGeneratedAt, storageInfo] =
          await Promise.all([
            syncService.getLatestSeq(userId),
            syncService.getOnlineDeviceCount(userId),
            syncService.getCachedSnapshotGeneratedAt(userId),
            syncService.getStorageInfo(userId),
          ]);
        const snapshotAge =
          snapshotGeneratedAt !== null ? Date.now() - snapshotGeneratedAt : undefined;

        Logger.debug(
          `[user:${userId}] Status: seq=${latestSeq}, devices=${devicesOnline}`,
        );

        const response: SyncStatusResponse = {
          latestSeq,
          devicesOnline,
          snapshotAge,
          storageUsedBytes: storageInfo.storageUsedBytes,
          storageQuotaBytes: storageInfo.storageQuotaBytes,
        };

        return reply.send(response);
      } catch (err) {
        Logger.error(`Get status error: ${errorMessage(err)}`);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  // GET /api/sync/devices - List the devices syncing this account
  fastify.get(
    '/devices',
    {
      config: {
        rateLimit: routeRateLimit(30, '1 minute'),
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const userId = getAuthUser(req).userId;
        const syncService = getSyncService();

        const devices = await syncService.listDevices(userId);

        Logger.debug(`[user:${userId}] Devices: ${devices.length}`);

        const response: SyncDevicesResponse = { devices };
        return reply.send(response);
      } catch (err) {
        Logger.error(`Get devices error: ${errorMessage(err)}`);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  // Opaque vault key package. The server stores wrappers only; rootKey and
  // recoveryCode are intentionally not valid fields in this request.
  fastify.get('/key-package', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = getAuthUser(req).userId;
    const row = await prisma.vaultKeyPackage.findUnique({ where: { userId } });
    if (!row) return reply.status(404).send({ error: 'key_package_not_found' });
    const parsed = vaultKeyPackageSchema.safeParse(row.packageData);
    if (!parsed.success) {
      Logger.error(`[user:${userId}] Stored vault key package failed validation`);
      return reply.status(500).send({ error: 'invalid_stored_key_package' });
    }
    // `payloadKeyVersion` is deliberately a sibling field rather than part of
    // the wrapper package: rotating a passphrase wrapper does not rewrite op
    // ciphertext, while a completed atomic migration advances this generation.
    return reply.send({
      package: parsed.data,
      payloadKeyVersion: row.activePayloadKeyVersion ?? null,
    });
  });

  fastify.delete<{ Params: { clientId: string } }>(
    '/devices/:clientId',
    { config: { rateLimit: routeRateLimit(20, '15 minutes') } },
    async (req: FastifyRequest<{ Params: { clientId: string } }>, reply: FastifyReply) => {
      const userId = getAuthUser(req).userId;
      const { clientId } = req.params;
      if (!SUPER_SYNC_CLIENT_ID_REGEX.test(clientId)) {
        return reply.status(400).send({ error: 'invalid_client_id' });
      }
      await getSyncService().revokeDevice(userId, clientId);
      await revokeAllTokens(userId);
      getWsConnectionService().closeForUser(userId);
      Logger.audit({ event: 'SYNC_DEVICE_REVOKED', userId, clientId });
      return reply.send({ success: true, clientId, requiresKeyRotation: true });
    },
  );

  fastify.put<{ Body: unknown }>(
    '/key-package',
    { config: { rateLimit: routeRateLimit(12, '15 minutes') } },
    async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      const userId = getAuthUser(req).userId;
      const parsed = vaultKeyPackageUploadSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'invalid_key_package' });
      }
      const now = BigInt(Date.now());
      const packageData = parsed.data.package as Prisma.InputJsonValue;
      const { expectedKeyVersion } = parsed.data;
      if (expectedKeyVersion === 0) {
        try {
          const payloadKeyVersion = await withVaultKeyPackageWriteLock(userId, async (tx) => {
            // A package can be absent on an account that already has the
            // password-era operation history (for example, while an account
            // is being upgraded to vault mode).  Generation 1 is valid only
            // for a genuinely empty history.  For retained history leave the
            // generation unset so the client enters the explicit legacy
            // migration path and supplies the old password to the decryptor.
            const operationCount = await tx.operation.count({ where: { userId } });
            const activePayloadKeyVersion = operationCount === 0 ? 1 : null;
            await tx.vaultKeyPackage.create({
              data: {
                userId,
                keyVersion: parsed.data.package.keyVersion,
                packageData,
                activePayloadKeyVersion,
                createdAt: now,
                updatedAt: now,
              },
            });
            return activePayloadKeyVersion;
          });
          return reply.send({ package: parsed.data.package, payloadKeyVersion });
        } catch (error) {
          // Only a competing create is an idempotency candidate. Database
          // failures must remain failures instead of becoming stale-version 409s.
          if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
        }
      } else {
        // Compare against the version the caller actually unlocked. Merely
        // accepting every greater version lets a stale writer skip a winner.
        // Root changes also require an atomic ciphertext migration; this
        // wrapper-only endpoint cannot safely publish a replacement root.
        const updated = await withVaultKeyPackageWriteLock(userId, (tx) => tx.vaultKeyPackage.updateMany({
          where: {
            userId,
            keyVersion: expectedKeyVersion,
            packageData: { path: ['rootKeyFingerprint'], equals: parsed.data.package.rootKeyFingerprint },
          },
          data: { keyVersion: parsed.data.package.keyVersion, packageData, updatedAt: now },
        }));
        if (updated.count === 1) return reply.send({ package: parsed.data.package });
      }
      const current = await prisma.vaultKeyPackage.findUnique({
        where: { userId },
        select: { keyVersion: true, packageData: true, activePayloadKeyVersion: true },
      });
      const currentPackage = vaultKeyPackageSchema.safeParse(current?.packageData);
      // Parsing reconstructs property order, including JSONB objects whose key
      // order is not preserved. Retrying after a lost response is safe.
      if (current?.keyVersion === parsed.data.package.keyVersion && currentPackage.success &&
          JSON.stringify(currentPackage.data) === JSON.stringify(parsed.data.package)) {
        return reply.send({
          package: parsed.data.package,
          payloadKeyVersion: current.activePayloadKeyVersion ?? null,
        });
      }
      if (current?.keyVersion === expectedKeyVersion && currentPackage.success &&
          currentPackage.data.rootKeyFingerprint !== parsed.data.package.rootKeyFingerprint) {
        return reply.status(409).send({ error: 'root_rotation_requires_atomic_migration' });
      }
      return reply.status(409).send({ error: 'stale_key_package' });
    },
  );

  fastify.delete('/key-package', async (_req: FastifyRequest, reply: FastifyReply) => {
    // Deleting wrappers independently strands ciphertext and permits version
    // reset. Account/data erasure must own its separate atomic cleanup policy.
    return reply.status(409).send({ error: 'key_package_removal_requires_atomic_erasure' });
  });

  /**
   * Migration-only retained-history inventory. It intentionally has no
   * `sinceSeq` fallback: ordinary download may fast-forward over a drain
   * snapshot, while a root rotation must cover every retained ciphertext.
   */
  fastify.get<{ Querystring: { cursor?: string; limit?: string } }>(
    '/key-migration/inventory',
    { config: { rateLimit: routeRateLimit(120, '15 minutes') } },
    async (req, reply) => {
      const userId = getAuthUser(req).userId;
      const limit = req.query.limit === undefined ? 500 : Number(req.query.limit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
        return reply.status(400).send({ error: 'invalid_key_migration_inventory_limit' });
      }
      try {
        const page = await vaultKeyMigrationService.inventory(userId, req.query.cursor, limit);
        // The service validates this before returning; keep the route boundary
        // explicit so an accidental future field cannot become wire contract.
        return reply.send(vaultKeyMigrationInventoryPageSchema.parse(page));
      } catch (error) {
        if (error instanceof VaultKeyMigrationError) return reply.status(error.statusCode).send({ error: error.code });
        Logger.error(`Vault key migration inventory failed for user ${userId}: ${errorMessage(error)}`);
        return reply.status(500).send({ error: 'key_migration_failed' });
      }
    },
  );

  /**
   * Atomically publish a client-produced full-history payload migration. The
   * request body contains opaque ciphertext only; the service verifies the
   * complete `(id, serverSeq)` inventory and the public vault-envelope
   * generation before changing any row.
   */
  fastify.post<{ Body: unknown }>(
    '/key-migration',
    {
      // New migrations send only a small manifest here. Inline legacy requests
      // remain bounded; large histories use the durable chunk routes below.
      bodyLimit: 2 * 1024 * 1024,
      config: { rateLimit: routeRateLimit(3, '15 minutes') },
    },
    async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      const userId = getAuthUser(req).userId;
      const manifest = vaultKeyMigrationManifestSchema.safeParse(req.body);
      if (manifest.success) {
        try {
          return reply.send(await vaultKeyMigrationService.begin(userId, manifest.data));
        } catch (error) {
          if (error instanceof VaultKeyMigrationError) return reply.status(error.statusCode).send({ error: error.code });
          Logger.error(`Vault key migration manifest failed for user ${userId}: ${errorMessage(error)}`);
          return reply.status(500).send({ error: 'key_migration_failed' });
        }
      }
      const parsed = vaultKeyMigrationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'invalid_key_migration_request' });
      }
      try {
        const result = await vaultKeyMigrationService.migrate(userId, parsed.data);
        Logger.audit({
          event: 'E2EE_PAYLOAD_MIGRATED',
          userId,
          requestId: parsed.data.requestId,
          keyVersion: result.keyVersion,
          payloadKeyVersion: result.payloadKeyVersion,
          latestSeq: result.latestSeq,
          migratedOperationCount: result.migratedOperationCount,
        });
        return reply.send(result);
      } catch (error) {
        if (error instanceof VaultKeyMigrationError) {
          return reply.status(error.statusCode).send({ error: error.code });
        }
        Logger.error(`Vault key migration failed for user ${userId}: ${errorMessage(error)}`);
        return reply.status(500).send({ error: 'key_migration_failed' });
      }
    },
  );

  fastify.post<{ Params: { requestId: string }; Body: unknown }>(
    '/key-migration/:requestId/chunks',
    {
      bodyLimit: 34 * 1024 * 1024,
      config: { rateLimit: routeRateLimit(120, '15 minutes') },
    },
    async (req, reply) => {
      const userId = getAuthUser(req).userId;
      const parsed = vaultKeyMigrationChunkSchema.safeParse(req.body);
      if (!parsed.success || parsed.data.requestId !== req.params.requestId) {
        return reply.status(400).send({ error: 'invalid_key_migration_chunk' });
      }
      try {
        return reply.send(await vaultKeyMigrationService.uploadChunk(userId, parsed.data));
      } catch (error) {
        if (error instanceof VaultKeyMigrationError) return reply.status(error.statusCode).send({ error: error.code });
        Logger.error(`Vault key migration chunk failed for user ${userId}: ${errorMessage(error)}`);
        return reply.status(500).send({ error: 'key_migration_failed' });
      }
    },
  );

  fastify.get<{ Params: { requestId: string } }>(
    '/key-migration/:requestId',
    async (req, reply) => {
      const userId = getAuthUser(req).userId;
      if (!vaultKeyMigrationRequestIdSchema.safeParse(req.params.requestId).success) {
        return reply.status(400).send({ error: 'invalid_key_migration_request' });
      }
      try {
        return reply.send(await vaultKeyMigrationService.status(userId, req.params.requestId));
      } catch (error) {
        if (error instanceof VaultKeyMigrationError) return reply.status(error.statusCode).send({ error: error.code });
        Logger.error(`Vault key migration status failed for user ${userId}: ${errorMessage(error)}`);
        return reply.status(500).send({ error: 'key_migration_failed' });
      }
    },
  );

  fastify.post<{ Params: { requestId: string } }>(
    '/key-migration/:requestId/commit',
    { config: { rateLimit: routeRateLimit(6, '15 minutes') } },
    async (req, reply) => {
      const userId = getAuthUser(req).userId;
      if (!vaultKeyMigrationRequestIdSchema.safeParse(req.params.requestId).success) {
        return reply.status(400).send({ error: 'invalid_key_migration_request' });
      }
      try {
        return reply.send(await vaultKeyMigrationService.commit(userId, req.params.requestId));
      } catch (error) {
        if (error instanceof VaultKeyMigrationError) return reply.status(error.statusCode).send({ error: error.code });
        Logger.error(`Vault key migration commit failed for user ${userId}: ${errorMessage(error)}`);
        return reply.status(500).send({ error: 'key_migration_failed' });
      }
    },
  );

  fastify.delete<{ Params: { requestId: string } }>(
    '/key-migration/:requestId',
    { config: { rateLimit: routeRateLimit(12, '15 minutes') } },
    async (req, reply) => {
      const userId = getAuthUser(req).userId;
      if (!vaultKeyMigrationRequestIdSchema.safeParse(req.params.requestId).success) {
        return reply.status(400).send({ error: 'invalid_key_migration_request' });
      }
      try {
        return reply.send(await vaultKeyMigrationService.cancel(userId, req.params.requestId));
      } catch (error) {
        if (error instanceof VaultKeyMigrationError) return reply.status(error.statusCode).send({ error: error.code });
        Logger.error(`Vault key migration cancellation failed for user ${userId}: ${errorMessage(error)}`);
        return reply.status(500).send({ error: 'key_migration_failed' });
      }
    },
  );

  // DELETE /api/sync/data - Delete all sync data for user
  // Used for encryption password changes
  fastify.delete(
    '/data',
    {
      config: {
        rateLimit: routeRateLimit(3, '15 minutes'),
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const userId = getAuthUser(req).userId;
        const syncService = getSyncService();

        Logger.info(`[user:${userId}] DELETE ALL DATA requested`);

        await syncService.deleteAllUserData(userId);

        Logger.audit({
          event: 'USER_DATA_DELETED',
          userId,
        });

        return reply.send({ success: true });
      } catch (err) {
        Logger.error(`Delete user data error: ${errorMessage(err)}`);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  // GET /api/sync/restore-points - List available restore points
  fastify.get<{
    Querystring: { limit?: string };
  }>(
    '/restore-points',
    {
      config: {
        rateLimit: routeRateLimit(30, '1 minute'),
      },
    },
    async (req, reply) => {
      try {
        const userId = getAuthUser(req).userId;
        const syncService = getSyncService();
        const limit = req.query.limit ? parseInt(req.query.limit, 10) : 30;

        if (isNaN(limit) || limit < 1 || limit > 100) {
          return reply.status(400).send({
            error: 'Invalid limit parameter (must be 1-100)',
          });
        }

        Logger.debug(`[user:${userId}] Restore points requested (limit=${limit})`);

        const restorePoints = await syncService.getRestorePoints(userId, limit);

        Logger.info(`[user:${userId}] Returning ${restorePoints.length} restore points`);

        return reply.send({ restorePoints });
      } catch (err) {
        Logger.error(`Get restore points error: ${errorMessage(err)}`);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  // GET /api/sync/restore/:serverSeq - Get state snapshot at specific serverSeq
  // Rate limited: Snapshot generation is CPU-intensive
  fastify.get<{
    Params: { serverSeq: string };
  }>(
    '/restore/:serverSeq',
    {
      config: {
        rateLimit: routeRateLimit(10, '5 minutes'),
      },
    },
    async (req, reply) => {
      try {
        const userId = getAuthUser(req).userId;
        const syncService = getSyncService();
        const targetSeq = parseInt(req.params.serverSeq, 10);

        if (isNaN(targetSeq) || targetSeq < 1) {
          return reply.status(400).send({
            error: 'Invalid serverSeq parameter (must be a positive integer)',
          });
        }

        Logger.info(`[user:${userId}] Restore snapshot requested at seq=${targetSeq}`);

        const snapshot = await syncService.generateSnapshotAtSeq(userId, targetSeq);

        Logger.info(`[user:${userId}] Restore snapshot generated at seq=${targetSeq}`);

        return reply.send(snapshot);
      } catch (err) {
        // Handle encrypted ops error - this is a known limitation, not a server error
        if (err instanceof EncryptedOpsNotSupportedError) {
          Logger.info(
            `[user:${getAuthUser(req).userId}] Restore blocked due to encrypted ops (count=${err.encryptedOpCount})`,
          );
          return reply.status(400).send({
            error: ENCRYPTED_OPS_CLIENT_MESSAGE,
            errorCode: SYNC_ERROR_CODES.ENCRYPTED_OPS_NOT_SUPPORTED,
          });
        }
        const message = errorMessage(err);
        if (
          message.includes('exceeds latest sequence') ||
          message.includes('must be at least') ||
          message.includes('is no longer available')
        ) {
          Logger.warn(
            `[user:${getAuthUser(req).userId}] Invalid restore request: ${message}`,
          );
          return reply.status(400).send({ error: message });
        }
        Logger.error(`Get restore snapshot error: ${message}`);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
};
