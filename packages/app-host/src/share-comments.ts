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
 * - `pullShareOps(shareId)`（M1 下行）：读游标 → 分页拉 → 用**线上那份身份**解密 →
 *   折进同一份日志 → **日志落盘之后**才推进游标；
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
  type ShareOpDownloadPort,
  type ShareOpUploadPort,
  type SharePayloadCodecPort,
  type ShareOpWireIdentity,
  type ShareOpWireRow,
  type SharePullResult,
} from './share-client.js';
import { emptyShareLogState, foldShareOps, type ShareLogState } from './share-op-log.js';
import { replayShareOps, type DecryptedShareOp } from './share-replay.js';

/**
 * share 日志的落盘端口（端壳用真 SQLite 实现；测试用内存）。
 *
 * 🔴 `list()` 不是可有可无的：读路径（`commentsForTask`）必须知道**这台设备上有哪些
 * share**，否则冷启动之后内存缓存是空的，评论就"看不见"了 —— 这正是本片第一版
 * 被冷启动那条判据抓出来的 bug（只读缓存、从不问存储）。
 *
 * 🔴 `cursor/setCursor` 是**下行**（M1）的游标：这台设备已经吃到服务端哪一条。
 * 它刻意**不在** `ShareLogState` 里 —— 那份状态是纯折叠产物（`foldShareOps` 的输出），
 * 把传输序塞进去等于让纯核认识 HTTP。
 */
export interface ShareLogStorage {
  load(shareId: string): ShareLogState | undefined;
  save(shareId: string, state: ShareLogState): void;
  /** 这台设备已经落过盘的 share id（顺序无关，读路径只用它来枚举）。 */
  list(): readonly string[];
  /** 已吃到服务端哪一条；从没拉过 ⇒ 0。 */
  cursor(shareId: string): number;
  setCursor(shareId: string, seq: number): void;
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
  /** 同一个客户端满足两条：上行 `uploadOps`（写）与下行 `downloadOps`（M1 拉）。 */
  readonly api: ShareOpUploadPort & ShareOpDownloadPort;
  /**
   * 按 shareId 取加解密端口；**没解锁就返回 undefined**（不要在这里造钥匙）。
   *
   * 声明成异步是因为真实现要**解包** listKey（`unwrapShareListKey` 走 vault，本来异步）；
   * 早先写成同步会把实现逼成"先塞进一个内存缓存再读"，那是第二条真相来源。
   */
  readonly cipherFor: (shareId: string) => Promise<SharePayloadCodecPort | undefined>;
  readonly storage: ShareLogStorage;
  readonly currentUserId: () => string;
  readonly clientId: string;
  readonly schemaVersion: number;
  readonly isSignedIn: () => boolean;
  readonly newCommentId?: (() => string) | undefined;
  readonly now?: (() => number) | undefined;
  readonly newOpId?: (() => string) | undefined;
  /** 一页拉多少条（默认 200，与服务端默认一致）。 */
  readonly pullPageSize?: number;
  /**
   * 一次 `pullShareOps` 最多翻几页（默认 25）。
   *
   * 🔴 它不是性能旋钮，是**收敛判据**：分页循环必须有上界，否则服务端只要一直给非空页
   * （游标不推进的 bug、或一份特别大的日志）就会把浏览器钉在一个无限请求循环里。
   * 撞上界时**抛错**而不是静默返回部分结果 —— 半截结果看起来是绿的。
   */
  readonly pullMaxPages?: number;
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
  /**
   * 把这份 share 的**远端** op 拉到本地（M1 下行链路）。
   *
   * 四条形状约束（每条都有判据，见 `tests/share-comments-pull.spec.ts`）：
   * 未登录 / 密钥没解锁 ⇒ **零请求**；游标只在日志落盘**之后**推进；
   * 同一批重复拉不会长出第二条评论；解密用的 identity 是**线上那份**的字段。
   */
  pullShareOps(shareId: string): Promise<SharePullResult>;
  /**
   * 按**任务**拉：先解析它属于哪份共享清单，再拉那一份。
   *
   * 🔴 存在的理由只有一个：路由判断（"这条任务的清单是不是共享的"）不许在壳里长第二份。
   * 个人清单 ⇒ `undefined`（"这里没有共享评论可拉"，不是错误 —— 与 `commentsForTask`
   * 那条"读不抛"同一条纪律）。
   */
  pullForTask(taskId: string): Promise<SharePullResult | undefined>;
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
  pullShareOps: (shareId: string) => Promise<SharePullResult>;
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

  /**
   * 下行（M1）：`downloadOps` → 用**线上那份身份**解密 → 折进本地日志 → 推进游标。
   *
   * 🔴 三处顺序是判据本体，不是风格：
   * 1. **先落日志，再推进游标**。反过来做的话，中途崩/断网会留下"游标说吃到了、
   *    日志里却没有"的状态，而那批 op 再也不会被重新拉 —— 那是**静默丢数据**，
   *    比重复拉一次（折叠是幂等的，`foldShareOps` 按 op id 去重）坏得多。
   * 2. **解密用 `row.clientTimestamp`**，不是 `now()`（纪律 1 的反方向）。
   * 3. **一页一页翻到追平**，且有页数上界：上界撞上时**抛错**，
   *    不返回半截结果 —— 半截结果在界面上长得跟"同步好了"一样。
   */
  const pullShareOps = async (shareId: string): Promise<SharePullResult> => {
    if (!options.isSignedIn()) throw new ShareNotSignedInError();
    const cipher = await options.cipherFor(shareId);
    if (cipher === undefined) throw new ShareKeyUnavailableError(shareId);

    const pageSize = options.pullPageSize ?? 200;
    const maxPages = options.pullMaxPages ?? 25;

    let after = options.storage.cursor(shareId);
    /**
     * 🔴 `consumed` 与 `serverLatest` 是两件事，混了就会**静默丢 op**：
     * 游标只能推进到**我已经收下并落盘**的那一条；服务端报的 `latestServerSeq` 是
     * "这份日志现在到哪了"，它只能用来判断"还要不要继续翻页"。
     * 第一版把两者写成同一个变量，于是"页里只有 1、2 两条而服务端头在 3"时
     * 游标被推到 3 ⇒ 第 3 条**永远不会再被拉** —— 这条判据是那个 bug 挣来的。
     */
    let consumed = after;
    let pages = 0;
    const rows: ShareOpWireRow[] = [];
    for (;;) {
      pages += 1;
      const batch = await options.api.downloadOps(shareId, after, pageSize);
      rows.push(...batch.ops);
      for (const row of batch.ops) if (row.serverSeq > consumed) consumed = row.serverSeq;
      const serverLatest = batch.cursor?.latestServerSeq;
      const head = typeof serverLatest === 'number' ? serverLatest : consumed;
      after = Math.max(after, consumed);
      // 追平了（或者这一页什么都没给 —— 后者防的是服务端把头报高、而 ops 一直为空时死循环）。
      if (batch.ops.length === 0 || after >= head) break;
      if (pages >= maxPages) {
        throw new Error(
          `共享清单「${shareId}」下行没在 ${String(maxPages)} 页内收敛（停在 serverSeq=${String(after)}，` +
            `服务端头在 ${String(head)}）` +
            ' —— 宁可抛错，也不返回一份看起来同步完了的半截日志',
        );
      }
    }

    const decrypted: DecryptedShareOp[] = [];
    for (const row of rows) {
      // 边界检查：传输层给的是 `unknown`，而解密只吃字符串密文。
      // 抛在这里 = 游标不推进 = 这一批下一轮还会再试（不是"跳过这一条"）。
      if (typeof row.payload !== 'string') {
        throw new Error(
          `共享清单「${shareId}」的 op ${row.id} 载荷不是字符串密文（拿到 ${typeof row.payload}）` +
            ' —— 抛错而不是跳过：跳过会让那条评论永远不出现，而界面会说"已同步"',
        );
      }
      // 🔴 写侧从不送空时刻，所以拿到 `null` 就是"这条 op 我没法忠实重建 AAD" ⇒
      // 抛错、不推进游标，而不是拿本地时间猜一份（猜出来的只会是 GCM 拒绝，
      // 而那条 op 因为游标已经推过去了，永远出不来）。
      if (row.clientTimestamp === null) {
        throw new Error(
          `共享清单「${shareId}」的 op ${row.id} 线上没有作者时刻（clientTimestamp=null）`,
        );
      }
      const identity: ShareOpWireIdentity = {
        id: row.id,
        clientId: row.clientId,
        actionType: row.actionType,
        opType: row.opType,
        entityType: row.entityType,
        ...(row.entityId === undefined || row.entityId === null ? {} : { entityId: row.entityId }),
        ...(row.entityIds === undefined ? {} : { entityIds: row.entityIds }),
        // 🔴 线上那份时刻（见上面纪律 2）
        timestamp: row.clientTimestamp,
        schemaVersion: row.schemaVersion,
      };
      // 解不开 = 这把钥匙读不了这份 share（密钥状态错了），不是"这一条跳过"：
      // 静默跳过的代价是某条评论永远不出现，而界面会说"已同步"。
      const plaintext = await cipher.decrypt(row.payload, identity);
      decrypted.push({
        // 身份字段**整份复用**（含 `timestamp = row.clientTimestamp`）—— 与上行那条同一条纪律：
        // 同一件事在两个地方各拼一遍，迟早和线上那份漂移。
        ...identity,
        payload: JSON.parse(plaintext) as unknown,
        ...(row.vectorClock === undefined ? {} : { vectorClock: row.vectorClock }),
      });
    }

    const entry = entryFor(shareId);
    const before = entry.log.ops.length;
    const log = foldShareOps(entry.log, decrypted);
    const { state } = replayShareOps(emptyState(), [log.ops as readonly DecryptedShareOp[]]);
    cache.set(shareId, { log, state, shareId });
    options.storage.save(shareId, log);
    // 🔴 游标在日志之后（见上面纪律 1），且推的是**已消费**的那条，不是服务端的头。
    options.storage.setCursor(shareId, after);

    return { fetched: rows.length, added: log.ops.length - before, cursor: after, pages };
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

  return { dispatchShareOp, pullShareOps, commentsForTask, stateFor };
}

/**
 * 「按任务拉」这一小段装配的**唯一**实现。
 *
 * 为什么单独抽出来而不是各端自己写那三行：端壳必须**自己**调 `createCommentActions`
 * （判据 C 数的是 `apps/<端>/src` 里那个调用点），于是它手里是 `actions` + `dispatch`
 * 两件东西，而不是 `createShareCommentsHost` 的整体。如果 web 与 host 各写一遍
 * "先解析归属、再拉那一份"，这两份迟早对"什么时候不用拉"给出不同答案。
 */
export function createShareTaskPuller(ports: {
  shareIdOfTask: (taskId: string) => string | undefined;
  pullShareOps: (shareId: string) => Promise<SharePullResult>;
}): (taskId: string) => Promise<SharePullResult | undefined> {
  return async (taskId) => {
    const shareId = ports.shareIdOfTask(taskId);
    if (shareId === undefined) return undefined;
    return ports.pullShareOps(shareId);
  };
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
    pullShareOps: inner.pullShareOps,
    pullForTask: createShareTaskPuller({
      shareIdOfTask: actions.shareIdOfTask,
      pullShareOps: inner.pullShareOps,
    }),
    commentsForTask: inner.commentsForTask,
    stateFor: inner.stateFor,
  };
}
