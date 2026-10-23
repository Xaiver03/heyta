/**
 * 共享清单的**写通道与评论动作** —— 端壳侧装配（ADR-0062 W4-0；`check:reachability` 断言 C 的转绿点）。
 * =========================================================================
 *
 * 判据 C 只在 `apps/<端>/src/**` 里数 `\b<家族>\s*\(` 的调用面（`check-reachability.mjs:360-361`），
 * 所以"宿主真的调用得到"这句话必须落在这里 —— 而**判断一个字都不在这里**：
 * - 「这条清单是不是共享的、该不该走共享通道」在 `@heyta/app-host` 的 `share-routing.ts`
 *   （`decideShareWrite`，M2 起任务/便签/评论三族共用这一份）；"发到哪、什么条件下不发、
 *   发完怎么落本地"在 `createShareCommentDispatch`（同一个包）。
 * - 本文件只做**注入**：baseUrl/token（同步设置与登录态）、vault 的载荷密钥、
 *   本地 share 密钥库、以及一个 `Storage` 上的 share 日志。
 * - 交出去的 `channel` 不只给评论用：`lib/oplog.ts` 的路由派发器拿它写共享清单里的任务与便签，
 *   而 `features/share/share-session.ts` 保证**这台设备上一个会话只有一份**（那份重放缓存
 *   就是合并视图的数据源，两份实例会各看到一份内容）。
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
  type ShareSignatureRejection,
  type ShareConflict,
  type ShareWriteChannel,
} from '@heyta/app-host';
import type { CommentLike } from '@heyta/domain';
import { createSharePayloadCipher, ShareApiClient, type SyncPayloadCipher } from '@heyta/sync-client';

import { emitEngineChange, currentState, dispatchChecked, dispatchIntent } from '../../lib/oplog.js';
import { emitShareRepaint } from '../../lib/share-signal-sink.js';
import { createWebAuthFetch } from '../../lib/central-fetch.js';
import { createWebShareKeyRotation } from './share-rotation.js';
import { readShareOwnIdentity, unwrapShareKeyRing } from './share-key-store.js';

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
  /**
   * 共享写通道（ADR-0067 裁决一那本 log 的唯一出口）+ 它的已重放状态。
   *
   * 🔴 M2 之后这一枚不只服务于评论：`dispatchIntent` 的路由要把**任务/便签**的写也交给它。
   * 交出去的是"发到哪、怎么落本地"这件既有实现（`createShareCommentDispatch`），
   * 端壳不许再写第二份 —— 那正是这条线一直在防的漂移。
   */
  readonly channel: ShareWriteChannel;
  /**
   * 这台设备上**待用户裁决**的共享冲突（ADR-0067 裁决三"必须可见"那半句的落点）。
   *
   * 清单非空时用户不点就等于**静默丢内容**，所以界面上那一枚入口不许留空；
   * 清单为空时它不该出现 —— 判据在 `tests/share-conflict-wiring.spec.tsx`。
   */
  conflicts(): ShareConflict[];
  /** 用户点完「保留这一版」：往那份 share 日志发**一条** op（一个意图 = 一个 op）。 */
  resolveConflict(conflict: ShareConflict, choice: 'keep-local' | 'keep-remote'): Promise<void>;
  /** 从重放出来的共享域状态读某条任务的活评论。 */
  commentsForTask(taskId: string): CommentLike[];
  /**
   * 把这条任务所属那份 share 的远端评论拉回本地（M1 下行）。
   * 个人清单 ⇒ `undefined`（没有可拉的，不是错误）。
   */
  pullForTask(taskId: string): Promise<SharePullResult | undefined>;
  /**
   * 最近一轮**验签被拒**的共享 op（ADR-0069 裁决五：具名报警的落点）。
   *
   * ⚠️ 空数组只意味着"这一轮没有需要报警的行"，**不**等于"这些都验过了"
   * （M4 之前的存量行没有作者列，本来就不进这一档）。
   */
  signatureRejections(): ShareSignatureRejection[];
  /**
   * 按 **shareId** 拉（M5 的实时信号走这一条：信号里给的就是 shareId）。
   * 与 `pullForTask` 同一个 dispatch，只是少一次"任务→清单"的解析。
   */
  pullShareOps(shareId: string): Promise<SharePullResult>;
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
    /*
     * 读侧验签用的名单（ADR-0069 裁决五）：成员行 id → 在册签名公钥。
     *
     * 🔴 取不到就交 `undefined`，**不要**退成空对象：空名单会把每一行都读成
     * "查无此人"，那是把一次网络抖动画成一堆伪造警报。宿主那边会抛具名错误、
     * 这一轮不推进游标（判据在 `share-read-verify.spec.ts`）。
     * 拉取只发生在真出现署名行时（存量日志不多打这一枪）。
     */
    verifiersFor: async (shareId) => {
      try {
        const { members } = await api.listMembers(shareId);
        const roster: Record<string, string> = {};
        for (const m of members) {
          if (typeof m.signingPublicKey === 'string' && m.signingPublicKey.length > 0) roster[m.memberId] = m.signingPublicKey;
        }
        return roster;
      } catch {
        return undefined;
      }
    },
    storage: createStorageShareLog(deps.storage),
    /*
     * 本机签名件（ADR-0069 裁决一/二）：成员行 id + 那份身份种子派生出的 Ed25519 私钥。
     *
     * 🔴 私钥**不出这一层**：它只在 `signShareOpWire` 里被用一次，不上线、不进日志、
     * 不进任何 store（种子的存储形态是 wrap 过的，见 `share-key-store.ts`）。
     * 没有身份（未解锁 / 这台设备没有自己的成员行）⇒ `undefined`，
     * 宿主据此具名失败、一个请求都不发 —— 不是"先发一条无签的试试"。
     */
    signerFor: async (shareId) => {
      const own = await readShareOwnIdentity({ storage: deps.storage, cipher: vaultCipher, shareId });
      if (own === undefined) return undefined;
      return { memberId: own.memberId, ed25519SecretKey: own.ed25519SecretKey };
    },
    currentUserId: () => deps.userId,
    clientId: deps.clientId,
    schemaVersion: deps.schemaVersion,
    isSignedIn: () => deps.token.trim() !== '',
  });

  // 路由数据从 op-log 的当前状态读（任务 → 清单 → shareId），与任务动作同源。
  // 🔴 交出去的是 `currentState()`（M2 起那是**合并视图**），不是引擎的个人状态：
  // 判据与界面必须读同一份，两处各读一份就一定会漂（ADR-0068 裁决二）。
  const ctx: ActionContext = {
    dispatch: (intent) => dispatchIntent(intent),
    dispatchChecked: (build) => dispatchChecked(build),
    getState: currentState,
  };

  /*
   * 共享内容能在**个人 op-log 一动没动**的前提下变：这条写进的是 share log，
   * 而各 store 是被 op-log 的通知驱动的。不敲这一下，症状是
   * "评论发出去了 / 别人写的任务拉回来了，界面却停在打开那一刻"。
   * ⚠️ 拉取只在**真拿到新内容**时敲：`added = 0` 时状态引用没变，敲一次是白重渲染一遍。
   */
  const dispatchShareOp = async (shareId: string, intent: Parameters<typeof dispatch.dispatchShareOp>[1]): Promise<void> => {
    await dispatch.dispatchShareOp(shareId, intent);
    emitEngineChange();
  };
  const pullShareOps = async (shareId: string): Promise<SharePullResult> => {
    const result = await dispatch.pullShareOps(shareId);
    if (result.added > 0) emitEngineChange();
    /*
     * 🔴 验签拒了也要敲重画，而且**不能等 added > 0**：被拒那一条根本没落盘，
     * `added` 很可能就是 0 —— 只看"有没有新内容"的话，症状恰好是这一整条线要防的静默：
     * 同事写了东西，这台设备悄悄拒收，界面上什么都没发生。
     * 这一枚是**所有** web 拉取的唯一出口（评论区那趟与 M5 信号那趟都经过它），
     * 所以报警的触发条件只有一处，不会分叉。
     */
    if ((result.rejections?.length ?? 0) > 0) emitShareRepaint();
    return result;
  };

  // 🔴 判据 C 数的那一处：端壳里真的构造评论动作（判断全在 app-host 里）。
  const actions = createCommentActions(ctx, {
    dispatchShareOp,
    currentUserId: () => deps.userId,
  });

  return {
    actions,
    conflicts: dispatch.conflicts,
    // 🔴 裁完也敲一下通知：不敲的话用户点完按钮看到的还是自己刚点掉的那个样子。
    resolveConflict: async (conflict, choice) => {
      await dispatch.resolveConflict(conflict, choice);
      emitEngineChange();
    },
    channel: {
      dispatch: dispatchShareOp,
      stateFor: dispatch.stateFor,
      conflicts: dispatch.conflicts,
      resolveConflict: async (conflict, choice) => {
        await dispatch.resolveConflict(conflict, choice);
        emitEngineChange();
      },
    },
    commentsForTask: dispatch.commentsForTask,
    signatureRejections: dispatch.signatureRejections,
    pullForTask: createShareTaskPuller({
      shareIdOfTask: actions.shareIdOfTask,
      pullShareOps,
    }),
    pullShareOps,
  };
}
