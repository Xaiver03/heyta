/**
 * web 端共享清单密钥的本地存储 —— **薄适配层**。
 * ==================================================================
 *
 * 🔴 为什么这么存（信封生命周期、合成 AAD、多世代密钥环的三条纪律）只讲一遍，
 * 正文在 `@heyta/app-host` 的 `share-key-store.ts`（AGENTS §3.5：这段判定本体
 * 决定"密钥怎么落盘"，是业务语义，不许住在 `apps/*`）。本文件只做一件事：
 * 把 DOM 的 `Storage` 适配成那个端口 —— 同步接口用同步实现（纯函数直接读写），
 * 异步流程用 Promise 包装的 shim 喂给 `*Portable` 那组函数。
 *
 * 盘上形状（键名 `heyta.share-keys.v1`、`version: 1`、字段名与可选性）由
 * app-host 那一份决定，与 web 旧实现逐字节兼容 —— 已存过钥的设备升级后不丢钥。
 */

import type { SyncPayloadCipher } from '@heyta/sync-client';
import {
  SHARE_KEY_STORAGE_PORTABLE_KEY,
  parseShareKeyStore,
  readShareOwnIdentityPortable,
  removeShareKeyFromStore,
  serializeShareKeyStore,
  storeShareIdentityPortable,
  unwrapShareIdentitySeedPortable,
  unwrapShareKeyRingPortable,
  unwrapShareListKeyPortable,
  wrapAndStoreShareKeyPortable,
  type ShareKeyStoragePort,
  type ShareKeyStoreShape,
  type WrappedShareKey,
} from '@heyta/app-host';

export type { PriorShareKey, ShareKeyStoreShape, WrappedShareKey } from '@heyta/app-host';

/** 同步 `Storage` → 异步 KV 端口（`*Portable` 那组函数的注入点）。 */
const toPort = (storage: Storage): ShareKeyStoragePort => ({
  get: async (key) => storage.getItem(key),
  set: async (key, value) => void storage.setItem(key, value),
  remove: async (key) => void storage.removeItem(key),
});

export function loadShareKeyStore(storage: Storage): ShareKeyStoreShape {
  return parseShareKeyStore(storage.getItem(SHARE_KEY_STORAGE_PORTABLE_KEY));
}

export function saveShareKeyStore(storage: Storage, store: ShareKeyStoreShape): void {
  storage.setItem(SHARE_KEY_STORAGE_PORTABLE_KEY, serializeShareKeyStore(store));
}

/** 剔除一条（纯函数，端口无关 —— 直接转出去）。 */
export function removeShareKey(store: ShareKeyStoreShape, shareId: string): ShareKeyStoreShape {
  return removeShareKeyFromStore(store, shareId);
}

/** 剔除一条并落盘（离开/被移除清单时用——只 remove 不 save 等于没删）。 */
export function deleteShareKey(storage: Storage, shareId: string): void {
  saveShareKeyStore(storage, removeShareKey(loadShareKeyStore(storage), shareId));
}

/** 读一条原始条目（不解密）——回填身份/查看世代用。 */
export function getShareKeyEntry(storage: Storage, shareId: string): WrappedShareKey | undefined {
  return loadShareKeyStore(storage).entries.find((e) => e.shareId === shareId);
}

export function wrapAndStoreShareKey(args: {
  storage: Storage;
  cipher: SyncPayloadCipher;
  shareId: string;
  listKey: Uint8Array;
  keyEpoch: number;
  identitySeed?: Uint8Array;
  ownMemberId?: string;
}): Promise<ShareKeyStoreShape> {
  const { storage, ...rest } = args;
  return wrapAndStoreShareKeyPortable({ ...rest, port: toPort(storage) });
}

/** 只回填身份/memberId（不动 listKey）——接受邀请后先记身份、等 owner 信封的那段窗口用。 */
export function storeShareIdentity(args: {
  storage: Storage;
  cipher: SyncPayloadCipher;
  shareId: string;
  identitySeed: Uint8Array;
  ownMemberId: string;
}): Promise<void> {
  const { storage, ...rest } = args;
  return storeShareIdentityPortable({ ...rest, port: toPort(storage) });
}

/**
 * 解出某共享的**整个密钥环**（当前世代 + 保留的旧世代）。
 * 为什么必须整环、解不开时的两种 undefined 分档，理由在 app-host 那份的函数注释里。
 */
export function unwrapShareKeyRing(args: {
  storage: Storage;
  cipher: SyncPayloadCipher;
  shareId: string;
}): Promise<
  | {
      current: { shareId: string; keyEpoch: number; listKey: Uint8Array };
      previous: { shareId: string; keyEpoch: number; listKey: Uint8Array }[];
    }
  | undefined
> {
  const { storage, ...rest } = args;
  return unwrapShareKeyRingPortable({ ...rest, port: toPort(storage) });
}

/** 解出本机在这份共享里的身份（成员行 id + X25519/Ed25519 两对钥）；没有/解不开 ⇒ undefined。 */
export function readShareOwnIdentity(args: {
  storage: Storage;
  cipher: SyncPayloadCipher;
  shareId: string;
}): Promise<
  | {
      memberId: string;
      x25519PublicKey: Uint8Array;
      x25519SecretKey: Uint8Array;
      ed25519PublicKey: Uint8Array;
      ed25519SecretKey: Uint8Array;
    }
  | undefined
> {
  const { storage, ...rest } = args;
  return readShareOwnIdentityPortable({ ...rest, port: toPort(storage) });
}

/** 解出某共享的 listKey。信封解不开（vault 未解锁/换口令/被换记录）⇒ undefined。 */
export function unwrapShareListKey(args: {
  storage: Storage;
  cipher: SyncPayloadCipher;
  shareId: string;
}): Promise<Uint8Array | undefined> {
  const { storage, ...rest } = args;
  return unwrapShareListKeyPortable({ ...rest, port: toPort(storage) });
}

/** 解出某共享的身份种子（换钥解新信封要用）。没有/解不开 ⇒ undefined。 */
export function unwrapShareIdentitySeed(args: {
  storage: Storage;
  cipher: SyncPayloadCipher;
  shareId: string;
}): Promise<Uint8Array | undefined> {
  const { storage, ...rest } = args;
  return unwrapShareIdentitySeedPortable({ ...rest, port: toPort(storage) });
}
