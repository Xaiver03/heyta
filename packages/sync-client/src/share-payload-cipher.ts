import {
  decryptShareRecord,
  encryptShareRecord,
  reencryptShareRecord,
  shareRecordEpoch,
  type ShareEncryptedRecord,
} from '@heyta/sync-core';

import type { SyncPayloadIdentity } from './payload-cipher';

/**
 * Share op 载荷信封（ADR-0062 W3）——**薄委托层**。
 * =====================================================================
 *
 * 🔴 2026-10-09 格式统一：share op 载荷只有**一种格式**——sync-core
 * `encryptShareRecord` 的 record 信封（version byte + keyEpoch(float64) +
 * IV + AES-GCM body，全 op 身份 AAD）。本层不再有自己的 magic 包装——
 * 那曾经造成两种不可互操作的格式（迁移机器只吃 record，线上是 magic），
 * 被 `verify-collab-revoke` 当场逼出。世代自描述在信封头里，
 * rekey 过渡期的混合世代下载页由世代选钥自然处理。
 *
 * 密码学全部在 sync-core（单一所有者）；本层只做 API 适配
 * （`SyncPayloadIdentity` → record 调用形状）与世代→钥的选路。
 */

export interface ShareSyncKey {
  shareId: string;
  keyEpoch: number;
  listKey: Uint8Array;
}

export interface SharePayloadCipher {
  encrypt(payload: string, identity: SyncPayloadIdentity): Promise<string>;
  decrypt(payload: string, identity: SyncPayloadIdentity): Promise<string>;
  /**
   * rekey 迁移：把一条旧世代 op 重加密到 `to` 世代。**确定性 IV**——
   * 同输入逐字节同输出（幂等可续传，AGENTS 规则 16）。产出的是一条
   * **新 op**（新 id），由调用方上传。
   */
  reencrypt(payload: string, from: SyncPayloadIdentity, to: {
    identity: SyncPayloadIdentity;
    toListKey: Uint8Array;
    toEpoch: number;
  }): Promise<string>;
}

const assertShareSyncKey = (entry: ShareSyncKey): void => {
  if (typeof entry.shareId !== 'string' || entry.shareId.length === 0 || entry.shareId.length > 256) {
    throw new Error('Invalid share id');
  }
  if (!Number.isSafeInteger(entry.keyEpoch) || entry.keyEpoch <= 0) {
    throw new Error('Invalid share key epoch');
  }
  // 清单密钥 32 字节；长度错误会在 sync-core 的 assert 处响亮失败。
  if (entry.listKey.length !== 32) throw new Error('Invalid share list key');
};

/** 世代 → 钥。current + previous 的世代必须互不重复。 */
const keyByEpoch = (options: {
  current: ShareSyncKey;
  previous?: readonly ShareSyncKey[];
}): Map<number, ShareSyncKey> => {
  const keys = new Map<number, ShareSyncKey>();
  for (const entry of [...(options.previous ?? []), options.current]) {
    assertShareSyncKey(entry);
    if (keys.has(entry.keyEpoch)) throw new Error('Duplicate share key epoch');
    // 会话内快照：调用方改自己的 buffer 不能把一半批次加密换钥。
    keys.set(entry.keyEpoch, { ...entry, listKey: entry.listKey.slice() });
  }
  return keys;
};

const toWireIdentity = (identity: SyncPayloadIdentity) => ({
  clientId: identity.clientId,
  actionType: identity.actionType,
  opType: identity.opType,
  entityType: identity.entityType,
  entityId: identity.entityId,
  entityIds: identity.entityIds,
  timestamp: identity.timestamp,
  schemaVersion: identity.schemaVersion,
});

export function createSharePayloadCipher(options: {
  current: ShareSyncKey;
  previous?: readonly ShareSyncKey[];
}): SharePayloadCipher {
  const keys = keyByEpoch(options);
  const current = keys.get(options.current.keyEpoch)!;
  return {
    async encrypt(payload, identity) {
      const record = await encryptShareRecord({
        id: identity.id,
        plaintext: new TextEncoder().encode(payload),
        shareId: current.shareId,
        listKey: current.listKey,
        keyEpoch: current.keyEpoch,
        identity: toWireIdentity(identity),
      });
      return record.ciphertext;
    },
    async decrypt(payload, identity) {
      // 世代从信封头自描述地取，再按世代选钥（rekey 过渡期混合世代下载页）。
      const epoch = shareRecordEpoch(payload);
      const entry = keys.get(epoch);
      if (!entry) throw new Error('Share key epoch unavailable');
      const plaintext = await decryptShareRecord({
        record: { id: identity.id, keyEpoch: epoch, ciphertext: payload },
        shareId: entry.shareId,
        listKey: entry.listKey,
        identity: toWireIdentity(identity),
      });
      return new TextDecoder().decode(plaintext);
    },
    async reencrypt(payload, from, to) {
      const record: ShareEncryptedRecord = {
        id: from.id,
        keyEpoch: shareRecordEpoch(payload),
        ciphertext: payload,
      };
      const migrated = await reencryptShareRecord({
        record,
        shareId: current.shareId,
        fromListKey: keys.get(record.keyEpoch)!.listKey,
        toListKey: to.toListKey,
        toEpoch: to.toEpoch,
        identity: toWireIdentity(from),
      });
      return migrated.ciphertext;
    },
  };
}

/** 传输层世代嗅探：给下载路径判断「这条载荷是哪个世代」（不做密码学校验）。 */
export const sharePayloadEpoch = (payload: string): number => shareRecordEpoch(payload);
