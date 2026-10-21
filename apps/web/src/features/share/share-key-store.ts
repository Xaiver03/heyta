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
import { deriveShareIdentityKeyPair } from '@heyta/sync-core';
import { shareKeyStoreIdentity } from '@heyta/app-host';

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
  /**
   * 🔴 换钥（M3）留下的**旧世代**那几把（按 `keyEpoch` 各一条）。
   *
   * 这条不是"留着以防万一"：share 日志是追加模型，旧世代的密文不会因为换钥而消失
   * （`verify-collab-revoke` 第 6 步就是去库里验"旧密文仍在"）。环里只留新钥 ⇒
   * 下行一碰到旧世代的载荷就抛 `Share key epoch unavailable`，而按 M1 的纪律那**不推进游标**
   * ⇒ 评论区从此卡死。所以换钥必须把上一代那把留在环里，一直留到这份日志被清掉。
   */
  priorKeys?: PriorShareKey[];
  /**
   * 身份种子的 vault 包裹（明文 = 32 字节 seed 的 base64）。
   * 换钥（epoch+1）时成员要用它派生出的私钥解**新**信封——不落盘就等于
   * "每次换钥都要重新入群"。与 listKey 同一条生命周期（vault 锁 ⇒ 解不开）。
   */
  wrappedIdentitySeed?: string;
  /** 自己的成员行 id（create/accept 响应回给本人；面板自识别用）。 */
  ownMemberId?: string;
}

/** 旧世代的一条：只带世代号与它的 vault 包裹，形状与当前那条同源。 */
export interface PriorShareKey {
  keyEpoch: number;
  wrappedListKey: string;
}

export interface ShareKeyStoreShape {
  version: number;
  entries: WrappedShareKey[];
}

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

/** 剔除一条并落盘（离开/被移除清单时用——只 remove 不 save 等于没删）。 */
export function deleteShareKey(storage: Storage, shareId: string): void {
  saveShareKeyStore(storage, removeShareKey(loadShareKeyStore(storage), shareId));
}

/** 包裹一把 listKey 并 upsert 进存储（换钥 = 同 shareId 覆盖当前世代，**旧世代进 `priorKeys`**）。
 *
 * ⚠️ 两条"别顺手抹掉"的纪律已经收进函数里，不再靠调用方记得传回来：
 * ① `wrappedIdentitySeed` / `ownMemberId` 只在入群那一刻生成一次，后续调用（换钥收新 listKey）
 *    省略它们时**沿用旧值**——抹掉身份种子 = 这台设备再也解不开新信封；
 * ② 被顶掉的那一代必须落进 `priorKeys`（见上面那条注释），否则旧世代的评论会解不开。
 */
export async function wrapAndStoreShareKey(args: {
  storage: Storage;
  cipher: SyncPayloadCipher;
  shareId: string;
  listKey: Uint8Array;
  keyEpoch: number;
  identitySeed?: Uint8Array;
  ownMemberId?: string;
}): Promise<ShareKeyStoreShape> {
  const store = loadShareKeyStore(args.storage);
  const existing = store.entries.find((e) => e.shareId === args.shareId);
  const wrappedListKey = await args.cipher.encrypt(
    toBase64(args.listKey),
    shareKeyStoreIdentity(args.shareId),
  );
  const wrappedIdentitySeed = args.identitySeed === undefined
    ? existing?.wrappedIdentitySeed
    : await args.cipher.encrypt(toBase64(args.identitySeed), shareKeyStoreIdentity(args.shareId));
  const priorKeys = collectPriorKeys(existing, args.keyEpoch);
  const ownMemberId = args.ownMemberId ?? existing?.ownMemberId;
  const next: ShareKeyStoreShape = {
    version: FORMAT_VERSION,
    entries: [...store.entries.filter((e) => e.shareId !== args.shareId), {
      shareId: args.shareId,
      keyEpoch: args.keyEpoch,
      wrappedListKey,
      ...(priorKeys.length > 0 ? { priorKeys } : {}),
      ...(wrappedIdentitySeed === undefined ? {} : { wrappedIdentitySeed }),
      ...(ownMemberId === undefined ? {} : { ownMemberId }),
    }],
  };
  saveShareKeyStore(args.storage, next);
  return next;
}

/**
 * 旧世代的账：把"被顶掉的那一把"与它已有的 `priorKeys` 合成一份新账。
 *
 * 🔴 三条判据，每条都对应一种会静默丢数据的情形：
 * - 同一世代**覆盖而不是追加**（重试一次换钥不该在账上留下两条同号，`createSharePayloadCipher`
 *   对重复世代是直接抛错的）；
 * - 与**新当前世代同号**的那条丢掉（否则 `previous` 与 `current` 撞号 ⇒ 建密码器就抛）；
 * - 空信封（入群后还没拿到钥时 `wrappedListKey` 是 `''`）不进账（它是"没有钥"的占位，不是一把旧钥）。
 */
function collectPriorKeys(
  existing: WrappedShareKey | undefined,
  nextEpoch: number,
): PriorShareKey[] {
  const rows: PriorShareKey[] = [];
  if (existing !== undefined && existing.wrappedListKey !== '' && existing.keyEpoch !== nextEpoch) {
    rows.push({ keyEpoch: existing.keyEpoch, wrappedListKey: existing.wrappedListKey });
  }
  for (const prior of existing?.priorKeys ?? []) {
    if (prior.wrappedListKey === '' || prior.keyEpoch === nextEpoch) continue;
    rows.push(prior);
  }
  // 同号留最后一条（就是本轮刚算出来的那份），并把世代从新到旧排——读的人一眼看得出当前是哪代。
  const byEpoch = new Map<number, PriorShareKey>();
  for (const row of rows) byEpoch.set(row.keyEpoch, row);
  return [...byEpoch.values()].sort((a, b) => b.keyEpoch - a.keyEpoch);
}

/**
 * 解出某共享的**整个密钥环**：当前世代 + 保留下来的旧世代。
 *
 * 🔴 这是 `createSharePayloadCipher({current, previous})` 的唯一正确喂法。
 * 只交当前那一把（换钥之前的写法）会让旧世代的载荷解不开，而按 M1 的纪律
 * "解不开 ⇒ 抛错且不推进游标"——症状是评论区整个卡死，不是"少一条评论"。
 *
 * 信封解不开（vault 未解锁 / 换口令 / 记录被换）⇒ `undefined`；
 * 旧世代里某一把解不开 ⇒ **只跳过它**并保留其余（旧评论读不到是一格信息，
 * 整份环解不开才是真的没解锁，两种情况不该混成同一个 `undefined`）。
 */
export async function unwrapShareKeyRing(args: {
  storage: Storage;
  cipher: SyncPayloadCipher;
  shareId: string;
}): Promise<{ current: { shareId: string; keyEpoch: number; listKey: Uint8Array }; previous: { shareId: string; keyEpoch: number; listKey: Uint8Array }[] } | undefined> {
  const entry = getShareKeyEntry(args.storage, args.shareId);
  if (entry === undefined || entry.wrappedListKey === '') return undefined;
  const listKey = await unwrapShareListKey(args);
  if (listKey === undefined) return undefined;
  const previous: { shareId: string; keyEpoch: number; listKey: Uint8Array }[] = [];
  for (const prior of entry.priorKeys ?? []) {
    let plain: string;
    try {
      plain = await args.cipher.decrypt(prior.wrappedListKey, shareKeyStoreIdentity(args.shareId));
    } catch {
      continue;
    }
    const bytes = fromBase64(plain);
    if (bytes.length === 32) previous.push({ shareId: args.shareId, keyEpoch: prior.keyEpoch, listKey: bytes });
  }
  return { current: { shareId: args.shareId, keyEpoch: entry.keyEpoch, listKey }, previous };
}

/**
 * 解出本机在这份共享里的身份（成员行 id + 那对 X25519 键）。
 *
 * 🔴 换钥的两条腿都要它：owner 要**公钥**给自己封一枚新信封（那是他换设备后
 * 唯一能找回这把钥的通道），成员要**私钥**解自己收到的新信封。
 * 没有身份种子 / 解不开 ⇒ `undefined`（= 需要解锁，不是"没有这份共享"）。
 */
export async function readShareOwnIdentity(args: {
  storage: Storage;
  cipher: SyncPayloadCipher;
  shareId: string;
}): Promise<{ memberId: string; x25519PublicKey: Uint8Array; x25519SecretKey: Uint8Array } | undefined> {
  const entry = getShareKeyEntry(args.storage, args.shareId);
  if (entry?.ownMemberId === undefined) return undefined;
  const seed = await unwrapShareIdentitySeed(args);
  if (seed === undefined) return undefined;
  const pair = deriveShareIdentityKeyPair(seed);
  return {
    memberId: entry.ownMemberId,
    x25519PublicKey: pair.x25519PublicKey,
    x25519SecretKey: pair.x25519SecretKey,
  };
}

/** 只回填身份/memberId（不动 listKey）——接受邀请后先记身份、等 owner 信封的那段窗口用。 */
export async function storeShareIdentity(args: {
  storage: Storage;
  cipher: SyncPayloadCipher;
  shareId: string;
  identitySeed: Uint8Array;
  ownMemberId: string;
}): Promise<void> {
  const store = loadShareKeyStore(args.storage);
  const existing = store.entries.find((e) => e.shareId === args.shareId);
  const wrappedIdentitySeed = await args.cipher.encrypt(
    toBase64(args.identitySeed),
    shareKeyStoreIdentity(args.shareId),
  );
  const entry: WrappedShareKey = {
    shareId: args.shareId,
    keyEpoch: existing?.keyEpoch ?? 0,
    wrappedListKey: existing?.wrappedListKey ?? '',
    wrappedIdentitySeed,
    ownMemberId: args.ownMemberId,
  };
  const next = { version: FORMAT_VERSION, entries: [...store.entries.filter((e) => e.shareId !== args.shareId), entry] };
  saveShareKeyStore(args.storage, next);
}

/** 读一条原始条目（不解密）——回填身份/查看世代用。 */
export function getShareKeyEntry(storage: Storage, shareId: string): WrappedShareKey | undefined {
  return loadShareKeyStore(storage).entries.find((e) => e.shareId === shareId);
}

/** 解出某共享的 listKey。信封解不开（vault 未解锁/换口令/被换记录）⇒ undefined。 */
export async function unwrapShareListKey(args: {
  storage: Storage;
  cipher: SyncPayloadCipher;
  shareId: string;
}): Promise<Uint8Array | undefined> {
  const store = loadShareKeyStore(args.storage);
  const entry = store.entries.find((e) => e.shareId === args.shareId);
  if (entry === undefined || entry.wrappedListKey === '') return undefined;
  try {
    const plain = await args.cipher.decrypt(entry.wrappedListKey, shareKeyStoreIdentity(args.shareId));
    const bytes = fromBase64(plain);
    return bytes.length === 32 ? bytes : undefined;
  } catch {
    return undefined;
  }
}

/** 解出某共享的身份种子（换钥解新信封要用）。没有/解不开 ⇒ undefined。 */
export async function unwrapShareIdentitySeed(args: {
  storage: Storage;
  cipher: SyncPayloadCipher;
  shareId: string;
}): Promise<Uint8Array | undefined> {
  const entry = getShareKeyEntry(args.storage, args.shareId);
  if (entry?.wrappedIdentitySeed === undefined) return undefined;
  try {
    const plain = await args.cipher.decrypt(entry.wrappedIdentitySeed, shareKeyStoreIdentity(args.shareId));
    const bytes = fromBase64(plain);
    return bytes.length === 32 ? bytes : undefined;
  } catch {
    return undefined;
  }
}
