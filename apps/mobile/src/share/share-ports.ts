/**
 * `MobileSharePorts` 的**生产构造**（M6-3a；入口 effect 递给 `armMobileShareSession(ports)`）。
 * ==========================================================================================
 *
 * 这一层只回答一件事：端口三件套在**这台手机上**分别是谁（AGENTS §3.5 —— 装配，不是判断）。
 *
 * | 端口 | 生产实现 | 为什么是它 |
 * |---|---|---|
 * | `keyPort` | `getShareKeyStoragePort({serverOrigin, accountId})`（`lib/share-key-store.ts`，Keychain/Keystore 兄弟槽） | 密钥料不落 sqlite；scope 与 vault root key 同账号惯例 |
 * | `shareLog` | `createMobileShareLogStorage()`（`lib/share-local-store.ts`，device-prefs） | 盘上键名与 web 逐字同名；折叠产物不是秘密 |
 * | `fetchImpl` | `consentFetch`（`privacy/consent-gate.ts`） | 🔴 出站同意闸：没同意 ⇒ 一个字节都不出去。`share-session` 文件头那条"不许偷偷用 `globalThis.fetch` 绕过同意闸"在这里兑现 |
 *
 * 🔴 **同一份实例纪律**：`shareLog` 与 `keyPort` 各只构造一次（按 scope 记忆化）。
 * 信号消费者（`share-signals.ts` 的 `defaultDeps.ensureStorage`）每次现取 `mobileSharePorts()`，
 * 若每次 `arm` 都换一枚新存储，"活动差集"与"会话拉回来的落盘"就会读**两本账** ——
 * 那是"第二份真相"在本条线上最坏的落点。
 *
 * 没登录 / 没 accountId / 没配服务端 ⇒ 返回 `undefined`：`armMobileShareSession` 停在
 * "这一刻建不出共享实例"上，与 `share-session.ts` 的 depKey 判据同一口径（不抛、不猜）。
 */
import type { MobileSharePorts } from './share-session';
import { getShareKeyStoragePort } from '../lib/share-key-store';
import { createMobileShareLogStorage } from '../lib/share-local-store';
import { consentFetch } from '../privacy/consent-gate';
import { readSyncConfig } from '../sync/config';

let lastScopeKey = '';
let memo: Pick<MobileSharePorts, 'keyPort' | 'shareLog'> | undefined;

/** 记忆化的端口本体（scope 变了 ⇒ 换 Keychain 槽位，`shareLog` 仍是同一枚——它按键分家）。 */
export function makeMobileSharePorts(): MobileSharePorts | undefined {
  const config = readSyncConfig();
  if (config === undefined) return undefined;
  const accountId = config.accountId?.trim() ?? '';
  if (accountId === '' || config.serverUrl.trim() === '' || (config.token ?? '').trim() === '') {
    return undefined;
  }
  const scopeKey = `${config.serverUrl}\u0000${accountId}`;
  if (memo === undefined || lastScopeKey !== scopeKey) {
    memo = {
      keyPort: getShareKeyStoragePort({ serverOrigin: config.serverUrl, accountId }),
      shareLog: createMobileShareLogStorage(),
    };
    lastScopeKey = scopeKey;
  }
  return { keyPort: memo.keyPort, shareLog: memo.shareLog, fetchImpl: consentFetch };
}
