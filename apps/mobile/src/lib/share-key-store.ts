/**
 * 移动端共享清单密钥落盘 —— 把 `@heyta/app-host` 的异步 KV 端口接到原生安全存储。
 * ==================================================================
 *
 * 🔴 判定本体（信封封装/解开、多世代环、盘上键名与 JSON 形状）只在
 * `@heyta/app-host` 的 `share-key-store.ts` 一份（AGENTS §3.5）。本文件是
 * **端口适配器**：`ShareKeyStoragePort`（异步 get/set/remove）→ `VaultSecureStorage`
 * （iOS Keychain / Android Keystore）。密钥料整块进安全存储，不落 device-prefs
 * （sqlite）——整份存储本就是 vault 包裹的信封，拆开分放只会多出"两半不同步"
 * 的坏形状，而那正是这条通道最丢不起的东西（丢钥 = 共享清单不可用）。
 *
 * ## 为什么是"同账号的兄弟槽位"
 *
 * `VaultSecureStorage` 的原生桥每个 `(serverOrigin, accountId)` 只有一格，而
 * **那一格已经是 vault root key 的**（`saveVaultRootKey` 在用）。share 密钥环若
 * 用同一个 scope 落盘会直接覆盖 root key。这里沿用该模块的账号 scope 惯例，
 * 只给 accountId 拼上 `#share-keys` 后缀取同一惯例下的**另一格**：origin 与
 * 账号仍是既有的，注销/撤销路径按同样后缀即可一并清掉。
 *
 * ## 一格多键的形状差怎么办
 *
 * 端口按 `key` 读写，原生槽只有一个值。槽内落一份 `{ [key]: value }` 的 JSON
 * 映射；坏 JSON 当空槽（下一次 `set` 整块覆盖）——与 app-host 对"坏 JSON ⇒
 * 空存储"的口径同形，不虚报成"需要解锁"。
 */

import type { ShareKeyStoragePort } from '@heyta/app-host';

import {
  getVaultSecureStorage,
  normalizeVaultSecureStorageScope,
  type VaultSecureStorage,
  type VaultSecureStorageScope,
} from './vault-secure-storage';

/** 与 vault root key 共用账号 scope 惯例、让出独立槽位的后缀（原生桥把 accountId 当不透明字符串）。 */
const SHARE_KEYS_SLOT_SUFFIX = '#share-keys';

export function shareKeyStoreScope(scope: VaultSecureStorageScope): VaultSecureStorageScope {
  const normalized = normalizeVaultSecureStorageScope(scope);
  return { serverOrigin: normalized.serverOrigin, accountId: `${normalized.accountId}${SHARE_KEYS_SLOT_SUFFIX}` };
}

type SlotMap = Record<string, string>;

const parseSlot = (raw: string): SlotMap => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: SlotMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
};

/** 可注入端口的构造（判据用假实现，测试不碰原生模块）。 */
export function createShareKeyStoragePort(
  vault: VaultSecureStorage,
  scope: VaultSecureStorageScope,
): ShareKeyStoragePort {
  const shareScope = shareKeyStoreScope(scope);
  const loadSlot = async (): Promise<SlotMap> => {
    const raw = await vault.load(shareScope);
    return raw === undefined ? {} : parseSlot(raw);
  };
  return {
    async get(key) {
      const map = await loadSlot();
      return Object.prototype.hasOwnProperty.call(map, key) ? (map[key] as string) : null;
    },
    async set(key, value) {
      const map = await loadSlot();
      map[key] = value;
      await vault.save(shareScope, JSON.stringify(map));
    },
    async remove(key) {
      const map = await loadSlot();
      if (!Object.prototype.hasOwnProperty.call(map, key)) return;
      delete map[key];
      if (Object.keys(map).length === 0) await vault.remove(shareScope);
      else await vault.save(shareScope, JSON.stringify(map));
    },
  };
}

/** 生产入口：真正的原生端口 + 账号 scope。导入本文件不触碰 RN（`getVaultSecureStorage` 自己就是惰性的）。 */
export function getShareKeyStoragePort(scope: VaultSecureStorageScope): ShareKeyStoragePort {
  return createShareKeyStoragePort(getVaultSecureStorage(), scope);
}
