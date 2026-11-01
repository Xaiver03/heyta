import {
  vaultKeyMigrationManifestSchema,
  type VaultKeyPackageContract,
  type VaultKeyMigrationChunkOperation,
  type VaultKeyMigrationInventoryOperation,
  type VaultKeyMigrationStageResponse,
} from '@heyta/shared-schema';

import { isEncryptedPayloadTransportShape } from '@heyta/sync-core';

import type { VaultKeyMigrationRemote, VaultMigrationInventorySource } from './vault-migration.js';

/**
 * 关掉端到端加密：把服务端上**全部**保留历史解密重传（ADR-0080 §5.2）。
 *
 * ## 为什么它必须是一次整库迁移，而不是一个开关
 *
 * 服务端在 readable 模式下只收明文、在 e2ee 模式下只收密文（两个方向都拒错配）。
 * 如果只把"往后写的"改成明文，历史仍是密文，于是：
 *   - 新设备不带钥匙时读不到旧历史（可它已经被承诺"不需要口令了"）；
 *   - 冲突合并要同时处理两种形状，而"整库同模式"正是这套设计的承重假设。
 * 所以关闭 = 用同一套 staging（manifest → chunk → commit）把每一条都换掉。
 *
 * ## 边界（这一层不做的事）
 *
 * - **不碰钥匙**：解密用的是调用方给的 `decrypt`（宿主持有解锁会话）；
 *   这个模块拿不到 root，也不会把它写进任何地方。
 * - **不决定要不要关**：那是用户的显式动作（界面上过一次危险确认）。
 * - **不发布包**：明文目标没有新包，`begin` 里那三个密钥列必须为空。
 */

export interface DisableEncryptionOptions {
  inventory: VaultMigrationInventorySource;
  remote: VaultKeyMigrationRemote;
  /** 服务端当前包装版本（CAS：迁移期间换过包就必须失败）。 */
  expectedKeyVersion: number;
  requestId: string;
  /** 解一条密文成明文 JSON 字符串。由宿主持有解锁会话时提供。 */
  decrypt: (ciphertext: string, operation: VaultKeyMigrationInventoryOperation) => Promise<string>;
  /** 一片最多多少条（服务端上限 1000）。 */
  chunkOperations?: number;
  onProgress?: (progress: { completed: number; total: number }) => void;
}

export interface DisableEncryptionResult {
  requestId: string;
  migratedOperationCount: number;
  latestSeq: number;
}

export class DisableEncryptionError extends Error {
  constructor(message: string, readonly code:
    | 'inventory_changed'
    | 'unsupported_payload'
    | 'migration_failed') {
    super(message);
    this.name = 'DisableEncryptionError';
  }
}

/** 载荷在线上是 JSON 字符串；这里的字节数口径必须与服务端一致。 */
const jsonBytes = (value: string): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

export async function disableVaultPayloadEncryption(
  options: DisableEncryptionOptions,
): Promise<DisableEncryptionResult> {
  const chunkLimit = options.chunkOperations ?? 500;

  // 1) 服务器是历史的权威：翻完所有页，别用本地库冒充完整性。
  const operations: VaultKeyMigrationInventoryOperation[] = [];
  let cursor: string | undefined;
  let latestSeq = -1;
  for (;;) {
    const page = await options.inventory.getPage(cursor);
    if (latestSeq === -1) latestSeq = page.latestSeq;
    if (page.latestSeq !== latestSeq) {
      throw new DisableEncryptionError('Operation history changed while reading the inventory', 'inventory_changed');
    }
    // 整行留着：解密要按每条 op 自己的身份（AAD）来做，不能只拿 id+seq。
    operations.push(...page.operations);
    if (page.complete) break;
    if (page.nextCursor === undefined) {
      throw new DisableEncryptionError('Inventory pagination ended without a cursor', 'inventory_changed');
    }
    cursor = page.nextCursor;
  }

  // 2) 逐条解密成明文 JSON。任何一条失败都必须**整体失败**：
  //    部分明文 + 部分密文正是这个设计要排除的状态。
  const replacements: VaultKeyMigrationChunkOperation[] = [];
  for (const operation of operations) {
    const plaintext = await options.decrypt(operation.payload, operation);
    try {
      const parsed: unknown = JSON.parse(plaintext);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('payload is not a JSON object');
      }
    } catch {
      throw new DisableEncryptionError(
        `Operation ${operation.id} did not decrypt to a JSON object; refusing to publish a mixed history`,
        'unsupported_payload',
      );
    }
    replacements.push({ id: operation.id, serverSeq: operation.serverSeq, payload: plaintext });
  }

  // 3) begin：目标 readable，**不带**包与世代（带了服务端会拒）。
  const manifest = vaultKeyMigrationManifestSchema.parse({
    requestId: options.requestId,
    targetMode: 'readable',
    expectedKeyVersion: options.expectedKeyVersion,
    // 序号取自**服务器自己**的第一页，不由调用方猜：猜错就是一次必然失败的 CAS。
    expectedLatestSeq: latestSeq,
    expectedOperationCount: replacements.length,
    expectedPayloadBytes: replacements.reduce((sum, item) => sum + jsonBytes(item.payload), 0),
  });
  let stage = await options.remote.begin(manifest);

  // 4) 分片上传。按 id+seq 切，保证每片边界稳定、重试幂等。
  if (stage.state === 'STAGING') {
    for (let index = 0; index < replacements.length; index += chunkLimit) {
      const slice = replacements.slice(index, index + chunkLimit);
      stage = await options.remote.uploadChunk({
        requestId: options.requestId,
        chunkId: `${options.requestId}-${String(Math.floor(index / chunkLimit))}`,
        chunkIndex: Math.floor(index / chunkLimit),
        operations: slice,
      });
      options.onProgress?.({ completed: Math.min(index + slice.length, replacements.length), total: replacements.length });
    }
  }

  // 5) commit：服务端在一个事务里换掉全部载荷、翻模式、删包。
  const published = stage.state === 'PUBLISHED' ? stage : await options.remote.commit(options.requestId);
  assertPublished(published);
  return {
    requestId: options.requestId,
    migratedOperationCount: published.migratedOperationCount,
    latestSeq: published.latestSeq,
  };
}

function assertPublished(stage: VaultKeyMigrationStageResponse): void {
  if (stage.state !== 'PUBLISHED') {
    throw new DisableEncryptionError(`Server did not publish the plaintext migration (state=${stage.state})`, 'migration_failed');
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 反方向：明文 → 加密（ADR-0080 §5.3）
// ─────────────────────────────────────────────────────────────────────────

export interface EnableEncryptionOptions {
  inventory: VaultMigrationInventorySource;
  remote: VaultKeyMigrationRemote;
  /** 这次要发布的新密钥包（root 是新的；`keyVersion` 必须是 1）。 */
  package: VaultKeyPackageContract;
  requestId: string;
  /** 用**新** root 加密：明文 JSON → vault 信封密文。由宿主持有新建的 pending 会话时提供。 */
  encrypt: (plaintext: string, operation: VaultKeyMigrationInventoryOperation) => Promise<string>;
  chunkOperations?: number;
  onProgress?: (progress: { completed: number; total: number }) => void;
}

/**
 * 重新开启端到端加密：把明文历史**全量重新加密**（ADR-0080 §5.3）。
 *
 * 与服务端 `begin` 的约定（三条，缺一条就是一次必然被拒的 CAS）：
 * - `expectedKeyVersion = 0`：readable 期间**没有**包，所以起点是零版本；
 * - `package.keyVersion = 1`：这是这个账号第一次真正意义上的密钥包；
 * - `targetPayloadKeyVersion = 1`：此前没有任何已加密世代。
 *
 * 🔴 为什么包由这次迁移**携带**、而不是先 PUT 一个包再迁移：
 * 先发包含让账号进入"有包但载荷还是明文"的中间态，而那个中间态在服务端是
 * 不可表示的（两个闸门都拒）。携带发布则只有两个状态：全明文、或全密文。
 */
export async function enableVaultPayloadEncryption(
  options: EnableEncryptionOptions,
): Promise<DisableEncryptionResult> {
  const chunkLimit = options.chunkOperations ?? 500;

  if (options.package.keyVersion !== 1) {
    throw new DisableEncryptionError(
      'Re-encryption must publish key version one',
      'migration_failed',
    );
  }

  const operations: VaultKeyMigrationInventoryOperation[] = [];
  let cursor: string | undefined;
  let latestSeq = -1;
  for (;;) {
    const page = await options.inventory.getPage(cursor);
    if (latestSeq === -1) latestSeq = page.latestSeq;
    if (page.latestSeq !== latestSeq) {
      throw new DisableEncryptionError('Operation history changed while reading the inventory', 'inventory_changed');
    }
    operations.push(...page.operations);
    if (page.complete) break;
    if (page.nextCursor === undefined) {
      throw new DisableEncryptionError('Inventory pagination ended without a cursor', 'inventory_changed');
    }
    cursor = page.nextCursor;
  }

  const replacements: VaultKeyMigrationChunkOperation[] = [];
  for (const operation of operations) {
    // 起点必须是明文。已经是密文说明这份历史没被迁移干净 —— 那正是要排除的状态。
    if (isEncryptedPayloadTransportShape(operation.payload)) {
      throw new DisableEncryptionError(
        `Operation ${operation.id} is already ciphertext; refusing to re-encrypt a mixed history`,
        'unsupported_payload',
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(operation.payload);
    } catch {
      throw new DisableEncryptionError(
        `Operation ${operation.id} is not plaintext JSON; refusing to re-encrypt a mixed history`,
        'unsupported_payload',
      );
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new DisableEncryptionError(
        `Operation ${operation.id} did not hold a JSON object`,
        'unsupported_payload',
      );
    }
    const ciphertext = await options.encrypt(operation.payload, operation);
    if (!isEncryptedPayloadTransportShape(ciphertext)) {
      throw new DisableEncryptionError(
        `Operation ${operation.id} did not encrypt to a vault envelope`,
        'migration_failed',
      );
    }
    replacements.push({ id: operation.id, serverSeq: operation.serverSeq, payload: ciphertext });
  }

  const manifest = vaultKeyMigrationManifestSchema.parse({
    requestId: options.requestId,
    targetMode: 'e2ee',
    expectedKeyVersion: 0,
    expectedLatestSeq: latestSeq,
    targetPayloadKeyVersion: 1,
    package: options.package,
    expectedOperationCount: replacements.length,
    expectedPayloadBytes: replacements.reduce((sum, item) => sum + jsonBytes(item.payload), 0),
  });
  let stage = await options.remote.begin(manifest);

  if (stage.state === 'STAGING') {
    for (let index = 0; index < replacements.length; index += chunkLimit) {
      const slice = replacements.slice(index, index + chunkLimit);
      stage = await options.remote.uploadChunk({
        requestId: options.requestId,
        chunkId: `${options.requestId}-${String(Math.floor(index / chunkLimit))}`,
        chunkIndex: Math.floor(index / chunkLimit),
        operations: slice,
      });
      options.onProgress?.({ completed: Math.min(index + slice.length, replacements.length), total: replacements.length });
    }
  }

  const published = stage.state === 'PUBLISHED' ? stage : await options.remote.commit(options.requestId);
  assertPublished(published);
  return {
    requestId: options.requestId,
    migratedOperationCount: published.migratedOperationCount,
    latestSeq: published.latestSeq,
  };
}
