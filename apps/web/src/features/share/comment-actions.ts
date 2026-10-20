/**
 * 共享清单的评论 —— **端壳侧装配**（ADR-0062 W4-0；`check:reachability` 断言 C 的转绿点）。
 * =========================================================================
 *
 * 判据 C 只在 `apps/<端>/src/**` 里数 `\b<家族>\s*\(` 的调用面（`check-reachability.mjs:360-361`），
 * 所以"宿主真的调用得到"这句话必须落在这里 —— 而**判断一个字都不在这里**：
 * - 「这条清单是不是共享的、该不该走共享通道」在 `@heyta/app-host` 的
 *   `comment-actions.ts`（`shareIdForTask`）；"发到哪、什么条件下不发、发完怎么落本地"
 *   在 `createShareCommentDispatch`（同一个包）。
 * - 本文件只做**注入**：baseUrl/token（同步设置与登录态）、vault 的载荷密钥、
 *   本地 share 密钥库、以及一个 `Storage` 上的 share 日志。
 * 这个形状与 `features/tasks/store.ts:253-259` 的 `createTaskActions(actionContext)` 是同一套。
 */

import {
  createCommentActions,
  createShareCommentDispatch,
  type ActionContext,
  type CommentActions,
  type ShareLogStorage,
} from '@heyta/app-host';
import type { CommentLike } from '@heyta/domain';
import { createSharePayloadCipher, ShareApiClient, type SyncPayloadCipher } from '@heyta/sync-client';

import { currentState, dispatchChecked, dispatchIntent } from '../../lib/oplog.js';
import { createWebAuthFetch } from '../../lib/central-fetch.js';
import { getShareKeyEntry, unwrapShareListKey } from './share-key-store.js';

/** share 日志在本地 `Storage` 上的键（一份 share 一条 + 一张索引）。 */
const LOG_PREFIX = 'heyta.share-log.';
const LOG_INDEX_KEY = 'heyta.share-log.index';

/**
 * `Storage` 上的 share 日志实现。
 *
 * ⚠️ 存的是**已解密的 op**（见 `share-comments.ts` 文件头缝②）：
 * 物化不可能拿密文过 reducer。索引单独存是因为读路径要能枚举
 * "这台设备上有哪些 share"（冷启动那条判据钉的就是它）。
 */
export function createStorageShareLog(store: Storage): ShareLogStorage {
  const readIndex = (): string[] => {
    const raw = store.getItem(LOG_INDEX_KEY);
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  };
  const writeIndex = (ids: readonly string[]): void => {
    store.setItem(LOG_INDEX_KEY, JSON.stringify([...new Set(ids)]));
  };
  return {
    load: (shareId) => {
      const raw = store.getItem(`${LOG_PREFIX}${shareId}`);
      if (raw === null) return undefined;
      try {
        return JSON.parse(raw) as ReturnType<ShareLogStorage['load']>;
      } catch {
        return undefined;
      }
    },
    save: (shareId, log) => {
      store.setItem(`${LOG_PREFIX}${shareId}`, JSON.stringify(log));
      writeIndex([...readIndex(), shareId]);
    },
    list: () => readIndex(),
  };
}

export interface WebShareCommentsDeps {
  /** 同步设置里的服务端根（空串 = 没配服务端 ⇒ 不建客户端）。 */
  readonly baseUrl: string;
  /** 当前登录令牌（空串 = 未登录 ⇒ 共享写路径会抛 `ShareNotSignedInError`）。 */
  readonly token: string;
  readonly authTransport?: 'bearer' | 'cookie';
  readonly userId: string;
  readonly clientId: string;
  readonly schemaVersion: number;
  /** vault 的载荷密钥（解 listKey 信封要用）；没解锁就传 undefined。 */
  readonly vaultCipher: SyncPayloadCipher | undefined;
  readonly storage: Storage;
}

export interface WebShareComments {
  readonly actions: CommentActions;
  /** 从重放出来的共享域状态读某条任务的活评论。 */
  commentsForTask(taskId: string): CommentLike[];
}

/**
 * 造一份"这个浏览器会话里的共享评论"。
 *
 * 返回 `undefined` 表示**这一刻还接不上**（没配服务端 / 没登录 / vault 没解锁）——
 * 而不是造一个假装能用的对象：那种对象会在用户点发送之后才失败，还说不清为什么。
 */
export function createWebShareComments(deps: WebShareCommentsDeps): WebShareComments | undefined {
  if (deps.baseUrl.trim() === '' || deps.token.trim() === '') return undefined;
  if (deps.vaultCipher === undefined) return undefined;

  const vaultCipher = deps.vaultCipher;
  const api = new ShareApiClient({
    baseUrl: deps.baseUrl,
    getToken: () => deps.token,
    authTransport: deps.authTransport,
    fetchImpl: createWebAuthFetch(deps.baseUrl, deps.authTransport ?? 'bearer'),
  });

  const dispatch = createShareCommentDispatch({
    api,
    cipherFor: async (shareId) => {
      // 钥匙在本地密钥库里（信封由 vault 载荷密钥包着）；没入库或解不开 ⇒ undefined，
      // 上层会抛 `ShareKeyUnavailableError` 而不是发一条解不开的 op。
      const entry = getShareKeyEntry(deps.storage, shareId);
      if (entry === undefined) return undefined;
      const listKey = await unwrapShareListKey({ storage: deps.storage, cipher: vaultCipher, shareId });
      if (listKey === undefined) return undefined;
      return createSharePayloadCipher({
        current: { shareId, keyEpoch: entry.keyEpoch, listKey },
      });
    },
    storage: createStorageShareLog(deps.storage),
    currentUserId: () => deps.userId,
    clientId: deps.clientId,
    schemaVersion: deps.schemaVersion,
    isSignedIn: () => deps.token.trim() !== '',
  });

  // 路由数据从 op-log 的当前状态读（任务 → 清单 → shareId），与任务动作同源。
  const ctx: ActionContext = {
    dispatch: (intent) => dispatchIntent(intent),
    dispatchChecked: (build) => dispatchChecked(build),
    getState: currentState,
  };

  // 🔴 判据 C 数的那一处：端壳里真的构造评论动作（判断全在 app-host 里）。
  const actions = createCommentActions(ctx, {
    dispatchShareOp: dispatch.dispatchShareOp,
    currentUserId: () => deps.userId,
  });

  return { actions, commentsForTask: dispatch.commentsForTask };
}
