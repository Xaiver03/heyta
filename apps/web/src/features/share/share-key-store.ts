/**
 * web 端共享清单密钥的本地存储（ADR-0062 W4 接线的密钥落点）。
 * ==================================================================
 *
 * ## 问题：listKey 族放哪
 *
 * listKey 是随机字节，**不可推导**——丢钥 = 共享清单不可用（重新邀请才能拿回）。
 * 但它也是 E2EE 的钥匙：明文落 localStorage 等于把钥匙贴在门上。
 *
 * ## 决定（ADR-0062「share 密钥是 vault 旁的新层」的直接推论）
 *
 * listKey 用 **vault 的载荷信封**（`SyncPayloadCipher`，与 op 载荷同一把
 * sync 子钥、同一套 AAD 规则）加密后落 localStorage；vault 未解锁 ⇒
 * 信封解不开 ⇒ 共享面板如实显示"需要解锁"。 vault 锁定/换口令/撤销设备
 * 的既有语义自动覆盖这份数据——不发明第二条密钥生命周期。
 *
 * 信封的 AAD 身份是**合成的**（`share-key-store:<shareId>`）：它只用于
 * 本地存储的自洽校验（防 localStorage 里两条记录互换），不参与线上协议。
 */

import type { SyncPayloadCipher } from '@heyta/sync-client';

/** 浏览器安全的 base64（web 无 Buffer；仅用于 32 字节钥与短字符串）。 */
const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};
const fromBase64 = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
};

const STORAGE_KEY = 'heyta.share-keys.v1';
const FORMAT_VERSION = 1;

export interface WrappedShareKey {
  shareId: string;
  keyEpoch: number;
  /** sync 载荷信封加密后的 base64（明文 = listKey 的 base64）。 */
  wrappedListKey: string;
}

export interface ShareKeyStoreShape {
  version: number;
  entries: WrappedShareKey[];
}

const syntheticIdentity = (shareId: string) => ({
  id: `share-key-store:${shareId}`,
  clientId: 'share-key-store',
  actionType: 'store',
  opType: 'UPD' as const,
  entityType: 'SHARE_KEY',
  entityId: shareId,
  timestamp: 0,
  schemaVersion: 1,
});

export function loadShareKeyStore(storage: Storage): ShareKeyStoreShape {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return { version: FORMAT_VERSION, entries: [] };
  try {
    const parsed = JSON.parse(raw) as ShareKeyStoreShape;
    if (parsed?.version !== FORMAT_VERSION || !Array.isArray(parsed.entries)) {
      return { version: FORMAT_VERSION, entries: [] };
    }
    return parsed;
  } catch {
    return { version: FORMAT_VERSION, entries: [] };
  }
}

export function saveShareKeyStore(storage: Storage, store: ShareKeyStoreShape): void {
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: FORMAT_VERSION, entries: store.entries }));
}

/** 剔除一条（被移除/离开清单时调用；换钥后由 upsert 覆盖世代）。 */
export function removeShareKey(store: ShareKeyStoreShape, shareId: string): ShareKeyStoreShape {
  return { version: FORMAT_VERSION, entries: store.entries.filter((e) => e.shareId !== shareId) };
}

/** 包裹一把 listKey 并 upsert 进存储（换钥 = 同 shareId 覆盖世代与信封）。 */
export async function wrapAndStoreShareKey(args: {
  storage: Storage;
  cipher: SyncPayloadCipher;
  shareId: string;
  listKey: Uint8Array;
  keyEpoch: number;
}): Promise<ShareKeyStoreShape> {
  const store = loadShareKeyStore(args.storage);
  const wrappedListKey = await args.cipher.encrypt(
    toBase64(args.listKey),
    syntheticIdentity(args.shareId),
  );
  const others = store.entries.filter((e) => e.shareId !== args.shareId);
  const next: ShareKeyStoreShape = {
    version: FORMAT_VERSION,
    entries: [...others, { shareId: args.shareId, keyEpoch: args.keyEpoch, wrappedListKey }],
  };
  saveShareKeyStore(args.storage, next);
  return next;
}

/** 解出某共享的 listKey。信封解不开（vault 未解锁/换口令/被换记录）⇒ undefined。 */
export async function unwrapShareListKey(args: {
  storage: Storage;
  cipher: SyncPayloadCipher;
  shareId: string;
}): Promise<Uint8Array | undefined> {
  const store = loadShareKeyStore(args.storage);
  const entry = store.entries.find((e) => e.shareId === args.shareId);
  if (entry === undefined) return undefined;
  try {
    const plain = await args.cipher.decrypt(entry.wrappedListKey, syntheticIdentity(args.shareId));
    const bytes = fromBase64(plain);
    return bytes.length === 32 ? bytes : undefined;
  } catch {
    return undefined;
  }
}
