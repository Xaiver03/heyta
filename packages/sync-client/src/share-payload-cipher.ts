import {
  aesDecrypt,
  aesEncrypt,
  decodeBase64,
  deriveShareOperationKey,
  encodeBase64,
  getRandomBytes,
} from '@heyta/sync-core';

import type { SyncPayloadIdentity } from './payload-cipher';

/**
 * Share op 载荷信封（ADR-0062 W3 的纯函数切片）。
 * =====================================================
 *
 * 与 `payload-cipher.ts` 的 vault codec **同一条安全契约，另一个密钥域**：
 * vault 用「账号 root key 的 sync purpose 子钥」，这里用「清单密钥的
 * share op 子钥」（`deriveShareOperationKey(listKey, shareId, keyEpoch)`，
 * sync-core W1 的纯函数）。服务端两种信封都只有密文。
 *
 * ## 信封形状
 *
 * ```base64( 'heyta-share-op/' | FORMAT_VERSION(1B) | keyEpoch(float64 BE) | AES-GCM body )```
 *
 * 与 vault 信封同构（magic + 版本字节 + float64 密钥世代），差别只有：
 * 世代的语义是 **rekey 世代**（移除成员时 +1），不是密钥包版本——
 * rekey 之后历史重加密完成前，下载页里会同时存在新旧世代的 op，
 * 所以 decrypt 接受 `previous` 世代表（照 vault 的 `previous` 形状）。
 *
 * ## AAD 绑定
 *
 * 整条 op 身份（含 shareId）进 AAD——与 vault 的 `identityAAD` 同一姿势。
 * 理由也一样：所有成员都持有清单密钥，**没有 AAD 绑定的话，一张密文可以
 * 被改名为另一条 op 重放**。改这里的绑定字段 = 改变防重放承诺，需要变异
 * 测试与评审，不许顺手。
 *
 * 🔴 跨包 zod 的教训（W2）在这里同款成立：sync-core 导出的**纯函数**随便调
 * （`deriveShareOperationKey` / `aesEncrypt`），但不要把两个包的 zod schema
 * 互相组合。
 */

const MAGIC = Uint8Array.from('heyta-share-op/', (char) => char.charCodeAt(0));
const FORMAT_VERSION = 1;
const HEADER_LENGTH = MAGIC.length + 1 + 8;
const hasShareMarker = (bytes: Uint8Array): boolean =>
  bytes.length >= MAGIC.length && MAGIC.every((byte, index) => bytes[index] === byte);

/** 可加密的最小 GCM 体：IV(12) + tag(16) + 至少 1 字节明文。 */
const MIN_BODY_LENGTH = 12 + 16 + 1;
/** 清单密钥长度。与 vault codec 同款字面量（sync-core 的 `KEY_LENGTH` 不在导出面上）。 */
const LIST_KEY_LENGTH = 32;

export interface ShareSyncKey {
  shareId: string;
  keyEpoch: number;
  listKey: Uint8Array;
}

export interface SharePayloadCipher {
  encrypt(payload: string, identity: SyncPayloadIdentity): Promise<string>;
  decrypt(payload: string, identity: SyncPayloadIdentity): Promise<string>;
}

const shareIdentityAAD = (shareId: string, op: SyncPayloadIdentity): string => JSON.stringify([
  'heyta:share-op',
  FORMAT_VERSION,
  shareId,
  op.id, op.clientId, op.actionType, op.opType, op.entityType,
  // 与 vault 的 identityAAD 同一条规范化：HTTP 下载面会省略空 entityIds，
  // 绑定用同一份规范形，空列表与非空列表不会互相冒充。
  op.entityId ?? null, op.entityIds?.length ? op.entityIds : null, op.timestamp, op.schemaVersion,
]);

const assertShareSyncKey = (entry: ShareSyncKey): void => {
  if (typeof entry.shareId !== 'string' || entry.shareId.length === 0 || entry.shareId.length > 256) {
    throw new Error('Invalid share id');
  }
  if (!Number.isSafeInteger(entry.keyEpoch) || entry.keyEpoch <= 0) {
    throw new Error('Invalid share key epoch');
  }
  if (entry.listKey.length !== LIST_KEY_LENGTH) throw new Error('Invalid share list key');
};

/**
 * 新世代写入 + 显式世代表读取。调用方必须先拿到清单密钥（成员信封解出），
 * 这里不持久化任何密钥、也不做历史重加密——重加密是 W1 `reencryptShareRecord`
 * 的迁移批次职责。
 */
export function createSharePayloadCipher(options: {
  current: ShareSyncKey;
  /** rekey 过渡期还能读到旧世代的 op；世代必须互不重复。 */
  previous?: readonly ShareSyncKey[];
}): SharePayloadCipher {
  const keys = new Map<number, { shareId: string; key: Uint8Array }>();
  for (const entry of [...(options.previous ?? []), options.current]) {
    assertShareSyncKey(entry);
    if (keys.has(entry.keyEpoch)) throw new Error('Duplicate share key epoch');
    // 会话内快照：调用方改自己的 buffer 不能把一半批次加密换钥。
    keys.set(entry.keyEpoch, { shareId: entry.shareId, key: entry.listKey.slice() });
  }
  const currentEpoch = options.current.keyEpoch;
  const current = keys.get(currentEpoch)!;
  return {
    async encrypt(payload, identity) {
      const opKey = deriveShareOperationKey(current.key, current.shareId, currentEpoch);
      const iv = getRandomBytes(12);
      const body = await aesEncrypt(
        opKey,
        iv,
        new TextEncoder().encode(payload),
        new TextEncoder().encode(shareIdentityAAD(current.shareId, identity)),
      );
      // 🔴 `aesEncrypt` 返回的是 **ct+tag，不含 IV**（与 vault codec 内部走
      // `encryptVaultRecord` 不同——那一条的 IV 打在 record 信封里）。IV 必须
      // 由本层显式写进信封，否则解密方无从取 IV——第一版漏了它，单测当场抓红。
      const bytes = new Uint8Array(HEADER_LENGTH + 12 + body.length);
      bytes.set(MAGIC);
      bytes[MAGIC.length] = FORMAT_VERSION;
      new DataView(bytes.buffer).setFloat64(MAGIC.length + 1, currentEpoch, false);
      bytes.set(iv, HEADER_LENGTH);
      bytes.set(body, HEADER_LENGTH + 12);
      return encodeBase64(bytes);
    },
    async decrypt(payload, identity) {
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(decodeBase64(payload));
      } catch {
        throw new Error('Invalid encrypted operation');
      }
      if (!hasShareMarker(bytes)) throw new Error('Not a share operation envelope');
      if (bytes.length < HEADER_LENGTH + MIN_BODY_LENGTH || bytes[MAGIC.length] !== FORMAT_VERSION) {
        throw new Error('Invalid share operation envelope');
      }
      const epoch = new DataView(
        bytes.buffer, bytes.byteOffset, bytes.byteLength,
      ).getFloat64(MAGIC.length + 1, false);
      if (!Number.isSafeInteger(epoch) || epoch <= 0) throw new Error('Invalid share key epoch');
      const entry = keys.get(epoch);
      if (!entry) throw new Error('Share key epoch unavailable');
      const opKey = deriveShareOperationKey(entry.key, entry.shareId, epoch);
      const plaintext = await aesDecrypt(
        opKey,
        bytes.slice(HEADER_LENGTH, HEADER_LENGTH + 12),
        bytes.slice(HEADER_LENGTH + 12),
        new TextEncoder().encode(shareIdentityAAD(entry.shareId, identity)),
      );
      return new TextDecoder().decode(plaintext);
    },
  };
}

/** 传输层形状嗅探：给下载路径判断「这条 op 是否带 share 信封」（不做密码学校验）。 */
export const isSharePayloadTransportShape = (payload: string): boolean => {
  if (typeof payload !== 'string' || payload.length === 0) return false;
  try {
    return hasShareMarker(new Uint8Array(decodeBase64(payload)));
  } catch {
    return false;
  }
};
