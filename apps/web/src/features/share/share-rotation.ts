/**
 * 换钥（M3）的**端壳装配**——把 `@heyta/app-host` 的编排件接到 web 的三个端口上。
 * ============================================================================
 *
 * 判断一个字都不在这里（AGENTS §3.5）：换不换、发给谁、世代写几、什么时候不收，
 * 全在 `share-rekey.ts`。本文件只回答"这台浏览器上这些东西住在哪"：
 *
 * | 端口 | web 上的实现 |
 * |---|---|
 * | HTTP | `ShareApiClient`（与评论通道同一个构造法） |
 * | 本地密钥环 | `share-key-store.ts`（vault 包裹的 localStorage，**多世代**） |
 * | 成员行公钥的 base64 | 本文件那 4 行（web 没有 `Buffer`） |
 *
 * ⚠️ 返回 `undefined` = 这一刻接不上（没配服务端 / 没登录 / vault 没解锁），
 * 与 `createWebShareComments` 同一口径：不造一个假装能换钥的对象。
 */

import { createShareKeyRotation, type ShareKeyRotationOptions } from '@heyta/app-host';
import { ShareApiClient, type SyncPayloadCipher } from '@heyta/sync-client';

import { createWebAuthFetch } from '../../lib/central-fetch.js';

import {
  getShareKeyEntry,
  readShareOwnIdentity,
  unwrapShareListKey,
  wrapAndStoreShareKey,
} from './share-key-store.js';

const fromBase64 = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
};

export interface WebShareKeyRotationDeps {
  readonly baseUrl: string;
  readonly token: string;
  readonly authTransport?: 'bearer' | 'cookie';
  /** vault 的载荷密钥；没解锁就传 undefined ⇒ 这里直接不成立（零请求）。 */
  readonly vaultCipher: SyncPayloadCipher | undefined;
  readonly storage: Storage;
}

export function createWebShareKeyRotation(
  deps: WebShareKeyRotationDeps,
): ReturnType<typeof createShareKeyRotation> | undefined {
  if (deps.baseUrl.trim() === '' || deps.token.trim() === '' || deps.vaultCipher === undefined) return undefined;
  const cipher = deps.vaultCipher;
  const api = new ShareApiClient({
    baseUrl: deps.baseUrl,
    getToken: () => deps.token,
    authTransport: deps.authTransport ?? 'bearer',
    fetchImpl: createWebAuthFetch(deps.baseUrl, deps.authTransport ?? 'bearer'),
  });

  const ports: ShareKeyRotationOptions = {
    api,
    isSignedIn: () => deps.token.trim() !== '',
    decodeMemberPublicKey: fromBase64,
    keys: {
      load: async (shareId) => {
        const entry = getShareKeyEntry(deps.storage, shareId);
        if (entry === undefined || entry.wrappedListKey === '') return undefined;
        const listKey = await unwrapShareListKey({ storage: deps.storage, cipher, shareId });
        return listKey === undefined ? undefined : { keyEpoch: entry.keyEpoch, listKey };
      },
      // 只交世代与钥：身份种子与 ownMemberId 由存储层沿用旧值（换钥不该把身份抹掉）。
      save: async (shareId, next) => {
        await wrapAndStoreShareKey({
          storage: deps.storage, cipher, shareId, keyEpoch: next.keyEpoch, listKey: next.listKey,
        });
      },
      ownIdentity: async (shareId) =>
        readShareOwnIdentity({ storage: deps.storage, cipher, shareId }),
    },
  };

  return createShareKeyRotation(ports);
}
