/**
 * 共享**管理面**（面板 / 入群）的移动端取数装配（M6-3a）。
 * =====================================================================
 *
 * 和 `share-session.ts` 同一个道理：**这一刻接不上就交回 `undefined`**，
 * 不造一个假装能用的对象（没登录 / 宿主没就绪 / vault 没解锁 ⇒ 界面上说的是
 * 「请先解锁保险库」/「先配置同步」，而不是让一次 `undefined.trim()` 崩掉整屏）。
 *
 * 🔴 这里只有**装配**：`ShareApiClient` 的每个方法打到哪个端点、什么码算被移除，
 * 都在 `@heyta/sync-client` 与 `packages/app-host` 的既有判据里；壳一层不判。
 *
 * ⚠️ `keyPort` 走 `makeMobileSharePorts()` 的**记忆化单例**：入群存钥、面板补发信封、
 * 评论通道读钥必须是同一个 Keychain 兄弟槽，第二份构造就是第二份账。
 */
import {
  createShareKeyRotation,
  type ShareKeyStoragePort,
} from '@heyta/app-host';
import { ShareApiClient, type SyncPayloadCipher } from '@heyta/sync-client';

import { getOpenTaskHostIfReady } from '../db/open-host';
import { consentFetch } from '../privacy/consent-gate';
import { readSyncConfig } from '../sync/config';
import { makeMobileSharePorts } from './share-ports';
import { createMobileShareKeyRotation } from './share-rotation';

export interface MobileShareAdmin {
  readonly baseUrl: string;
  readonly token: string;
  readonly api: ShareApiClient;
  readonly keyPort: ShareKeyStoragePort;
  readonly vaultCipher: SyncPayloadCipher;
  /** 换钥编排（移除即换钥 / 收新信封）；装配缺席时 `undefined`（不该发生：cipher 已就位）。 */
  readonly rotation: ReturnType<typeof createShareKeyRotation> | undefined;
}

/** 现取现用：每一次都在这一刻重读凭据与 vault 会话（登出后它自己就停在 undefined 上）。 */
export async function prepareMobileShareAdmin(): Promise<MobileShareAdmin | undefined> {
  const config = readSyncConfig();
  if (config === undefined) return undefined;
  const token = config.token ?? '';
  if (config.serverUrl.trim() === '' || token.trim() === '') return undefined;
  const ports = makeMobileSharePorts();
  if (ports === undefined) return undefined;
  const host = getOpenTaskHostIfReady();
  if (host === undefined) return undefined;
  let vaultCipher: SyncPayloadCipher | undefined;
  try {
    const session = await host.getVaultSession();
    vaultCipher = await session?.getPayloadCipher();
  } catch {
    return undefined;
  }
  if (vaultCipher === undefined) return undefined;
  const api = new ShareApiClient({
    baseUrl: config.serverUrl,
    getToken: () => token,
    authTransport: 'bearer',
    fetchImpl: consentFetch,
  });
  return {
    baseUrl: config.serverUrl,
    token,
    api,
    keyPort: ports.keyPort,
    vaultCipher,
    rotation: createMobileShareKeyRotation({
      api,
      keyPort: ports.keyPort,
      vaultCipher,
      isSignedIn: () => token.trim() !== '',
    }),
  };
}
