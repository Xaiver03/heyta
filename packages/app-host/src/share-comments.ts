/**
 * 共享清单的**评论宿主**（ADR-0062 W3-T2）—— 把三片接成端壳可以直接调的东西。
 * =========================================================================
 *
 * 到这一片为止，共享域的三块拼图各自都在、但**互相不认识**：
 * - `share-client.ts`：一条意图 → 加密 → 签名位 → 上行（W2-T1）；
 * - `share-op-log.ts` / `share-replay.ts`：share 日志的折叠与物化（W3-T1）；
 * - `comment-actions.ts`：评论的建/改/删/还原 + **路由**（本仓唯一一处
 *   `shareIdForTask`：从 `ctx.getState()` 读任务 → 清单的 `shareId` 在不在册）。
 *
 * 本文件只做**装配**，不加业务规则：
 * - `dispatchShareOp(shareId, intent)` 的真实现：未登录 ⇒ 抛类型化错误（零请求）；
 *   密钥没解锁 ⇒ 抛类型化错误（零请求）；否则加密 → 上行 → **就地折进本地 share 日志**；
 * - `commentsForTask(taskId)`：从**重放出来的**那份状态读（不是从 ctx 读）——
 *   因为评论只存在于共享域，个人 op-log 会永久拒它（`op-log/src/state.ts` 写着这条）。
 *
 * 🔴 两条刻意留下的缝（都写给下一位，不藏）：
 * 1. **路由数据仍从 `ctx.getState()` 读**（任务 → 清单的 `shareId`）。按计划 §2.2，
 *    共享清单里的 TASK 本身也在 share 日志里 ⇒ 等宿主（W4）把 share 域状态与个人状态
 *    合并成一份 `MaterializedState` 之后，这里应当改成读合并后的那一份；
 *    现在读 ctx 是**如实**的中间态：任务还在个人日志里的那些清单，路由照样成立。
 * 2. **本地日志存明文**（`payload` 用意图里的原始载荷），密文只在线上。
 *    理由是物化不可能拿密文过 reducer；代价是"本地库泄露 = 评论泄露"——
 *    与仓里既有的本地明文存储同一档（本地库本来就有 vault 之外的数据），
 *    真要收紧就得整体上本地加密，那是另一件事，不在本片里假装解决。
 */

import { aliveCommentsForTask, type CommentLike } from '@heyta/domain';
import { emptyState, type MaterializedState } from '@heyta/op-log';

import type { ActionContext } from './actions.js';
import {
  createCommentActions,
  type CommentActions,
  type ShareOpIntent,
} from './comment-actions.js';
import {
  createShareOpDispatcher,
  type ShareOpUploadPort,
  type SharePayloadCipherPort,
} from './share-client.js';
import { emptyShareLogState, foldShareOps, type ShareLogState } from './share-op-log.js';
import { replayShareOps, type DecryptedShareOp } from './share-replay.js';

/**
 * share 日志的落盘端口（端壳用真 SQLite 实现；测试用内存）。
 *
 * 🔴 `list()` 不是可有可无的：读路径（`commentsForTask`）必须知道**这台设备上有哪些
 * share**，否则冷启动之后内存缓存是空的，评论就"看不见"了 —— 这正是本片第一版
 * 被冷启动那条判据抓出来的 bug（只读缓存、从不问存储）。
 */
export interface ShareLogStorage {
  load(shareId: string): ShareLogState | undefined;
  save(shareId: string, state: ShareLogState): void;
  /** 这台设备已经落过盘的 share id（顺序无关，读路径只用它来枚举）。 */
  list(): readonly string[];
}

/** 未登录：共享清单写不了（**零请求**，不静默写本地）。 */
export class ShareNotSignedInError extends Error {
  readonly code = 'share-not-signed-in' as const;
  constructor() {
    super('共享清单要登录后才能写入');
    this.name = 'ShareNotSignedInError';
  }
}

/** 这一份 share 的 listKey 还没解锁（宿主还没拿到钥匙）：**零请求**。 */
export class ShareKeyUnavailableError extends Error {
  readonly code = 'share-key-unavailable' as const;
  constructor(readonly shareId: string) {
    super(`共享清单「${shareId}」的密钥还没解锁`);
    this.name = 'ShareKeyUnavailableError';
  }
}

export interface ShareCommentsHostOptions {
  /** 路由数据（任务 → 清单 → `shareId`）从它读；判断本体在 `comment-actions.ts`。 */
  readonly ctx: ActionContext;
  readonly api: ShareOpUploadPort;
  /**
   * 按 shareId 取加解密端口；**没解锁就返回 undefined**（不要在这里造钥匙）。
   *
   * 声明成异步是因为真实现要**解包** listKey（`unwrapShareListKey` 走 vault，本来异步）；
   * 早先写成同步会把实现逼成"先塞进一个内存缓存再读"，那是第二条真相来源。
   */
  readonly cipherFor: (shareId: string) => Promise<SharePayloadCipherPort | undefined>;
  readonly storage: ShareLogStorage;
  readonly currentUserId: () => string;
  readonly clientId: string;
  readonly schemaVersion: number;
  readonly isSignedIn: () => boolean;
  readonly newCommentId?: (() => string) | undefined;
  readonly now?: (() => number) | undefined;
  readonly newOpId?: (() => string) | undefined;
}

/**
 * 重放出来的**一条评论**（读路径给界面的形状）。
 *
 * ⚠️ 它比 `CommentLike`（领域层的过滤器只认 id/taskId/墓碑）多了界面真正要画的三样：
 * 作者、正文、编辑时刻。少一样界面就只能"猜"，而猜出来的作者名一旦不对，
 * 是那种没人会报的错。类型定义在 app-host（不是 UI 包），因为读路径住这里。
 *
 * 🔴 2026-10-17：这个接口在上一批**漏插**过一次（`s.replace` 的锚点没匹配、又没断言 ⇒ 静默没落），
 * 而 `vitest` 不做类型检查、`tsc -p tsconfig.spec.json` 也没拦住 ⇒ 一路隐身，
 * **最后由 `tsup` 的 DTS 构建抓住**（`error TS2304: Cannot find name 'ShareCommentRecord'`，
 * 连带把第 88 道 `check:privacy-consent-e2e` 弄红——因为 web 的 `tsc -b` 读不到 app-host 的 `index.d.ts`）。
 * 教训：**补丁要断言**（Python 里用 `assert old in s`），**验证要跑到会做类型检查的那一步**。
 */
export interface ShareCommentRecord extends CommentLike {
  readonly authorUserId: string;
  readonly body: string;
  readonly editedAt?: number;
}

export interface ShareCommentsHost {
  /** 评论的四个写动作（建/改/删/还原）—— 宿主递进来的只有"对哪条任务说什么"。 */
  readonly actions: CommentActions;
  /** 从**重放出来的**共享域状态读某条任务的活评论（墓碑已滤、按评论序排好）。 */
  commentsForTask(taskId: string): ShareCommentRecord[];
  /** 某一份 share 的物化状态（宿主合并/调试用；未加载时是空状态）。 */
  stateFor(shareId: string): MaterializedState;
}

/**
 * `dispatchShareOp` 的**唯一实现**（端壳装配 `createCommentActions` 时直接拿它用）。
 *
 * 抽出来是因为端壳必须**自己**调用 `createCommentActions(ctx, …)` —— 判据 C
 * （`check-reachability.mjs` 的宿主调用点）只在 `apps/<端>/src/**` 里数那个调用。
 * 如果让端壳自己再写一份 dispatch，就会出现第二份"什么条件下发、发到哪、怎么落本地"，
 * 那正是这条线一直在防的漂移。⇒ 端壳装配、app-host 定逻辑。
 */
export function createShareCommentDispatch(
  options: Omit<ShareCommentsHostOptions, 'ctx' | 'newCommentId'>,
): {
  dispatchShareOp: (shareId: string, intent: ShareOpIntent) => Promise<void>;
  commentsForTask: (taskId: string) => ShareCommentRecord[];
  stateFor: (shareId: string) => MaterializedState;
} {
  const cache = new Map<string, { log: ShareLogState; state: MaterializedState; shareId: string }>();

  const entryFor = (shareId: string): { log: ShareLogState; state: MaterializedState } => {
    const cached = cache.get(shareId);
    if (cached !== undefined) return cached;
    // 冷启动：从落盘读回这条 share 的日志，**整条重放**（不是增量）——
    // 全序由 fold+replay 保证，重放整条比维护增量状态更难出错。
    const log = options.storage.load(shareId) ?? emptyShareLogState();
    const { state } = replayShareOps(emptyState(), [log.ops as readonly DecryptedShareOp[]]);
    const entry = { log, state };
    cache.set(shareId, { ...entry, shareId });
    return entry;
  };

  const dispatchShareOp = async (shareId: string, intent: ShareOpIntent): Promise<void> => {
    if (!options.isSignedIn()) throw new ShareNotSignedInError();
    const cipher = await options.cipherFor(shareId);
    if (cipher === undefined) throw new ShareKeyUnavailableError(shareId);

    const dispatcher = createShareOpDispatcher({
      api: options.api,
      cipher,
      clientId: options.clientId,
      schemaVersion: options.schemaVersion,
      isSignedIn: options.isSignedIn,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.newOpId === undefined ? {} : { newId: options.newOpId }),
    });
    const result = await dispatcher.dispatch(shareId, {
      entityType: intent.entityType,
      entityId: intent.entityId,
      opType: intent.opType,
      ...(intent.payload === undefined ? {} : { payload: intent.payload }),
    });
    if (result.op === undefined) return;

    const entry = entryFor(shareId);
    /*
     * 落本地的那条 = 线上那条的**身份字段** + **明文载荷**：
     * 线上 `payload` 是密文，而物化不可能拿密文过 reducer。
     * 身份字段直接复用（不重拼），这样线上/本地两份不会漂移。
     */
    const localOp: DecryptedShareOp = {
      ...result.op,
      payload: intent.payload,
    };
    const log = foldShareOps(entry.log, [localOp]);
    const { state } = replayShareOps(emptyState(), [log.ops as readonly DecryptedShareOp[]]);
    cache.set(shareId, { log, state, shareId });
    options.storage.save(shareId, log);
  };

  const commentsForTask = (taskId: string): ShareCommentRecord[] => {
    const rows: ShareCommentRecord[] = [];
    // 先确保**存储里已有的每一份 share 都进了缓存**（冷启动那条判据钉的就是这里）。
    for (const shareId of options.storage.list()) entryFor(shareId);
    for (const { state } of cache.values()) {
      const bucket = (state as unknown as { comments?: Record<string, ShareCommentRecord> }).comments ?? {};
      rows.push(...Object.values(bucket));
    }
    return aliveCommentsForTask(rows, taskId);
  };

  const stateFor = (shareId: string): MaterializedState => entryFor(shareId).state;

  return { dispatchShareOp, commentsForTask, stateFor };
}

export function createShareCommentsHost(options: ShareCommentsHostOptions): ShareCommentsHost {
  const inner = createShareCommentDispatch(options);

  const actions = createCommentActions(options.ctx, {
    dispatchShareOp: inner.dispatchShareOp,
    currentUserId: options.currentUserId,
    ...(options.newCommentId === undefined ? {} : { newCommentId: options.newCommentId }),
  });

  return {
    actions,
    commentsForTask: inner.commentsForTask,
    stateFor: inner.stateFor,
  };
}
