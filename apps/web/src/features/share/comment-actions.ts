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
  createShareTaskPuller,
  type ActionContext,
  type CommentActions,
  type ShareLogStorage,
  type SharePullResult,
} from '@heyta/app-host';
import type { CommentLike } from '@heyta/domain';
import { createSharePayloadCipher, ShareApiClient, type SyncPayloadCipher } from '@heyta/sync-client';

import { currentState, dispatchChecked, dispatchIntent } from '../../lib/oplog.js';
import { createWebAuthFetch } from '../../lib/central-fetch.js';
import { createWebShareKeyRotation } from './share-rotation.js';
import { unwrapShareKeyRing } from './share-key-store.js';

/** share 日志在本地 `Storage` 上的键（一份 share 一条日志 + 一张索引 + 一份下行游标）。 */
const LOG_PREFIX = 'heyta.share-log.';
const LOG_INDEX_KEY = 'heyta.share-log.index';
const CURSOR_PREFIX = 'heyta.share-log.cursor.';

/**
 * `Storage` 上的 share 日志实现。
 *
 * ⚠️ 存的是**已解密的 op**（见 `share-comments.ts` 文件头缝②）：
 * 物化不可能拿密文过 reducer。索引单独存是因为读路径要能枚举
 * "这台设备上有哪些 share"（冷启动那条判据钉的就是它）。
 *
 * 🔴 游标（M1 下行）单独一条键、**不塞进日志那份 JSON**：日志是 `foldShareOps` 的产物，
 * 混进传输序就等于让纯核认识 HTTP；而且改一份已有 JSON 的形状要面对"老用户盘上那份
 * 没有这个字段"，拆成两条键则天然向后兼容（读不到 = 0 = 从头拉）。
 * 坏值一律退到 0（退到 0 只会多拉一次，折叠是幂等的；退到别的值会**少拉**）。
 */
/** 这台设备上落过盘的 share id 索引（读路径要能枚举，见 `ShareLogStorage.list`）。 */
function readShareIndex(store: Storage): string[] {
  const raw = store.getItem(LOG_INDEX_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeShareIndex(store: Storage, ids: readonly string[]): void {
  store.setItem(LOG_INDEX_KEY, JSON.stringify([...new Set(ids)]));
}

/**
 * 清掉一份共享在本机的**下行数据**：折叠出来的日志 + 下行游标 + 索引里的这一格。
 *
 * 🔴 密钥不在这里删（那是 `share-key-store.deleteShareKey` 的账）。两件都做才叫离场：
 * 只删钥不删日志，界面上别人的评论还在（读的就是这份明文）；只删日志不删钥，
 * 下一轮拉取会把同一批内容又拉回来。两端一起走 app-host 的 `forgetShareLocally`。
 */
export function clearStorageShareLog(store: Storage, shareId: string): void {
  store.removeItem(`${LOG_PREFIX}${shareId}`);
  store.removeItem(`${CURSOR_PREFIX}${shareId}`);
  writeShareIndex(store, readShareIndex(store).filter((id) => id !== shareId));
}

export function createStorageShareLog(store: Storage): ShareLogStorage {
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
      writeShareIndex(store, [...readShareIndex(store), shareId]);
    },
    list: () => readShareIndex(store),
    cursor: (shareId) => {
      const raw = store.getItem(`${CURSOR_PREFIX}${shareId}`);
      const n = raw === null ? Number.NaN : Number(raw);
      return Number.isInteger(n) && n >= 0 ? n : 0;
    },
    setCursor: (shareId, seq) => {
      store.setItem(`${CURSOR_PREFIX}${shareId}`, String(seq));
    },
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
  /**
   * 把这条任务所属那份 share 的远端评论拉回本地（M1 下行）。
   * 个人清单 ⇒ `undefined`（没有可拉的，不是错误）。
   */
  pullForTask(taskId: string): Promise<SharePullResult | undefined>;
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
      // 🔴 先问一句"这台设备还追得上服务端的世代吗"（M3）。换钥发生在别人的设备上，
      // 本机唯一的发现途径就是这一问；收不到新信封不算错（owner 还没发到人），
      // 收不到就把当前环照用——旧世代的密文本来也解得开（`previous` 在环里）。
      const rotation = createWebShareKeyRotation({
        baseUrl: deps.baseUrl, token: deps.token, authTransport: deps.authTransport,
        vaultCipher: deps.vaultCipher, storage: deps.storage,
      });
      if (rotation !== undefined) {
        try { await rotation.adoptRotatedShareKey(shareId); } catch { /* 未登录/没解锁：下面读环会给出 undefined */ }
      }
      // 🔴 交出去的是**整个密钥环**，不是当前那把（M3）。换钥之后日志里是混合世代的密文：
      // 只喂当前那把，旧评论会解不开，而按下行纪律"解不开 ⇒ 抛错且不推进游标"，
      // 症状不是"少一条评论"而是**评论区整块卡死**。
      const ring = await unwrapShareKeyRing({ storage: deps.storage, cipher: vaultCipher, shareId });
      if (ring === undefined) return undefined;
      return createSharePayloadCipher(ring);
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

  return {
    actions,
    commentsForTask: dispatch.commentsForTask,
    pullForTask: createShareTaskPuller({
      shareIdOfTask: actions.shareIdOfTask,
      pullShareOps: dispatch.pullShareOps,
    }),
  };
}
