/**
 * 评论动作（宿主无关）—— 共享清单写路径的**路由**与 `COMMENT` op 的构造
 * =========================================================================
 *
 * 这个文件补的是**共享清单协作线的最后一米**（ADR-0062 W3/W4）。
 * 在此之前 `COMMENT` 是一个完整的实体：`shared-schema` 里有名字、`entities.ts`
 * 里有形状与四态语义、`op-log` 里有物化桶 `comments`、`packages/ui` 里有
 * 线程模型与组件 —— 但 `packages/app-host/src` 里**没有任何一处**
 * `entityType: 'COMMENT'`，即**没有任何 action 能生成它**
 *（`scripts/check-reachability.mjs` 判据 B 抓的就是这个形状）。
 * 与 `note-actions.ts` 是同一个理由、同一个判据。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 六条由这里**独占**的语义决定：
 *
 * 1. 🔴 **写入路由住在这一层**（ADR-0062 决策 4 原文：
 *    「写入路由住在 `packages/app-host`（AGENTS §3.5），`apps/*` 不出现这个判断」）。
 *    判断本体是 {@link createCommentActions} 里的 `shareIdForTask`：
 *    从 `ctx.getState()` 读任务 → 它的 `Project.shareId` 是否在册。
 *    宿主递进来的只有"用户想对哪条任务说什么"，**不许**在壳里判断
 *    "这条清单是不是共享的" —— 那种代码一旦有两份就会漂移，症状是
 *    "同一台设备的一个入口能发评论、另一个入口静默失败"。
 *
 * 2. 🔴 **未共享 ⇒ 抛类型化错误 + 零 op，绝不静默写进个人日志。**
 *    ADR-0062 与 `entities.ts` 的 {@link Comment} 都写死了这句话：
 *    「只存在于共享清单（`Project.shareId` 在册）——**个人清单没有评论**」。
 *    退化成"那就写个人 op-log"不会立刻报错，但**会永久坏掉**：
 *    `op-log/src/state.ts` 明写「个人 op-log 里不会有 COMMENT op
 *    （白名单 + role 门都在服务端）」—— 个人同步通道会**永久拒绝**这条 op，
 *    于是用户看到一条"发出去了但永远不出现"的评论。所以这里的失败是
 *    `ListNotSharedError`（`code: 'list-not-shared'`），调用方可以 `instanceof`
 *    或读 `code` 说一句人话。
 *
 * 3. 🔴 **`ctx.dispatch` 一次都不许走**（见第 2 条）。所有写入都经注入端口
 *    `options.dispatchShareOp(shareId, intent)` 出去。这个文件**只定义端口并调用，
 *    不实现传输** —— share op-log 引擎、加密、逐 op 签名是下一段（ADR-0062 决策 4/5），
 *    本段的价值在于把"一条评论 op 长什么样"钉死在一处，让下一段没有第二份形状可抄。
 *
 * 4. **一个用户意图 = 一个 op，载荷只有该带的东西**（AGENTS.md §3.4）：
 *      · 建评论 —— `{ taskId, authorUserId, body }`。**没有 `createdAt`**：
 *        `createdAt` / `updatedAt` 由 reducer 从 **op 时间戳**派生
 *        （`EntityBase` 的注释），客户端自己写一遍就是第二个时间真相来源。
 *      · 改正文 —— `{ body }`。只此一格：LWW 覆盖 `body`（与任务标题同语义），
 *        不可变字段 `taskId` / `authorUserId` 一个都不重写。
 *      · 删 —— `DEL` + 空载荷。**墓碑语义，不 fan-out**（也不 fan-out 到任务上：
 *        评论是独立实体，删一条评论不碰任务）。
 *      · 还原 —— `UPD` + `{ deletedAt: null }`（`null` 能穿过 JSON 表达"清除"，
 *        `undefined` 会被 `JSON.stringify` 丢掉 ⇒ 对端既不清也不设，静默失效）。
 *
 * 5. **删除是软删（`DEL`），不是物理删**（同 `note-actions.ts` 文件头第 4 条）。
 *    物理删掉本地记录不会让别的成员也删 —— 他们下次一同步就把这条评论
 *    **推回来**，用户看到自己删掉的评论自己复活。
 *
 * 6. **`purgedAt` 之后 `restoreComment` 抛错，不是返回 `false`**
 *    （与 `restoreNote` / `restore` / `restoreProject` 同形状）：
 *    "这条现在不用恢复"与"这条永远恢复不了"是两句不同的话，
 *    界面对第二句要说"不可恢复"而不是"没反应"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 两个**接口形状**上的决定，理由都在这里：
 *
 * · 🔴 **作者 id 必须由宿主注入**（`options.currentUserId()`），不从 `ctx` 里猜。
 *   `ActionContext` 只有 `dispatch` / `dispatchChecked` / `getState` —— 里面
 *   **没有账号身份**。可选的替代方案都更坏：读 `MaterializedState` 里某个
 *   带 `originClientId` 的实体（那是**设备** id、且是 reducer 元数据，
 *   与账号 id 不是一件事）、或者发明一个全局变量（本仓库对"隐式全局身份"的
 *   态度见 `ids.ts` 的文件头：它已经因为"每个宿主各写一份"付过一次代价）。
 *   先例是 `assistant-session-actions.ts` 的 `options.clientId`：**必填** +
 *   构造时拒绝空值，因为这条判据的全部依据就是那个字符串，
 *   它是空的，"作者是谁"就会退化成"谁都不是"或"谁都行"，而两种退化都不报错。
 *   ⚠️ 它是**自报**（与 `AssistantTurn.originClientId` 同一威胁模型）：
 *   拦的是"另一台设备误认"，不是攻击者 —— 真正的身份证明在 op 的 Ed25519 签名
 *   （ADR-0062 决策 5）。
 *
 * · 🔴 **这个文件里没有 `now` 选项**，这是刻意的，不是漏了。本段的四个写动作
 *   **一个时间戳都不写**（第 4 条：`createdAt` 由 reducer 从 op 时间戳派生），
 *   所以时钟无处可用。留一个不被读的注入点就是"基础设施做完了、最后一米没接"
 *   的缩小版。等 `purgeComment`（要往载荷里写 `purgedAt`）真的需要它时再加 ——
 *   那时它有一个读得到的落点，而不是一个形状上好看的参数。
 *   同理，`ShareOpIntent` **不带时间戳**：op 的时间戳是 share 传输层的事。
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  COMMENT_MAX_LENGTH,
  aliveCommentsForTask,
  commentRejection,
  type Comment,
} from '@heyta/domain';
import { OpType } from '@heyta/sync-core';

import type { ActionContext } from './actions.js';
import { randomId } from './ids.js';

/**
 * 共享域里允许从这个端口出去的实体名。
 *
 * 🔴 它是**别名而不是裸字面量**，理由是门禁的诚实性，不是风格：
 * `scripts/check-reachability.mjs` 的判据 B 认的是源码里的 `entityType: 'X'`，
 * 而**类型声明也算一处** —— 也就是说不写成别名的话，一个纯接口就能让
 * "这个实体有写路径"变绿，而一条 op 都发不出去。写成别名之后，
 * 这个文件匹配 B **只可能是因为真的在构造 op**（**四处** `dispatchShareOp` 调用 —— 2026-10-16 更正：原文写"三处"，实测 `grep -c "await options.dispatchShareOp("` = **4**）。
 */
export type SharedCommentEntityType = 'COMMENT';

/**
 * 交给 **share op-log 通道**的一条意图。
 *
 * ⚠️ 它**不是** `OpIntent`（`@heyta/op-log`）：那个走个人 op-log，
 * 而 COMMENT 在个人通道上会被永久拒绝（见文件头第 2 条）。这里是**另一个域**
 * 的同形意图，由下一段的 share 引擎加密、签名、上行。
 *
 * `opType` 用 `@heyta/sync-core` 的 `OpType`（`CRT`/`UPD`/`DEL`）——
 * **不要自造 `'CREATE'`**：线协议词表只有一份定义，两套并行词表迟早漂移
 * （`op-log/src/engine.ts` 的 `OpIntent.opType` 上记着这条教训的完整代价）。
 */
export interface ShareOpIntent {
  entityType: SharedCommentEntityType;
  entityId: string;
  opType: OpType;
  payload?: unknown;
}

/**
 * "这条任务的清单为什么不是共享的"（封闭词表，供宿主说不同的话）。
 *
 * ⚠️ 清单记录缺失（悬空 `projectId`）或已软删，与"没挂 `shareId`"**归为同一档**：
 * 对用户而言是同一句话（"这条清单不在共享册里"），
 * 分开反而会让宿主两边都要写一遍提示。
 */
export type UnsharedListReason = 'task-has-no-project' | 'project-not-shared';

/**
 * 往个人清单（或没有清单的任务）写评论时抛的类型化错误。
 *
 * 🔴 单独成一个类而不是 `Error` + 文案：宿主需要**判断**（"这条清单不共享，
 * 界面不该画评论入口 / 该提示去共享"），而不是把中文串喂给 `includes`。
 */
export class ListNotSharedError extends Error {
  readonly code = 'list-not-shared' as const;

  constructor(
    readonly taskId: string,
    readonly reason: UnsharedListReason,
  ) {
    super(
      reason === 'task-has-no-project'
        ? `任务「${taskId}」没有归属清单，评论只存在于共享清单里（ADR-0062：个人清单没有评论）`
        : `任务「${taskId}」所属清单不在共享册里，评论只存在于共享清单里（ADR-0062：个人清单没有评论）`,
    );
    this.name = 'ListNotSharedError';
  }
}

export interface CommentActionsOptions {
  /**
   * 🔴 **把一条 COMMENT op 交给 share op-log 通道**（必需）。
   *
   * 本段只定义这个端口。实现（share 引擎、`uploadOps`、listKey 加密、
   * 逐 op 签名）在同目录的 `share-comments.ts`（装成一条 op）与 `share-client.ts`
   * （加密 + 签名 + 上行）—— 不是"还没建"，但**也不在这一层**：测试里注入假端口就能把
   * "载荷只有该带的东西"与"路由送对了 shareId"两条判据钉死，不需要真的搭起传输。
   *
   * `shareId` 由本层解析（文件头第 1 条）——调用方**不需要**、也不该自己算。
   */
  dispatchShareOp(shareId: string, intent: ShareOpIntent): Promise<unknown>;
  /**
   * 🔴 **当前账号 id**（评论作者）。必需，理由见文件头「接口形状」第 1 条。
   */
  currentUserId(): string;
  /** 评论 id 生成器。可注入，理由与 `TaskActionsOptions.newTaskId` 相同。 */
  newCommentId?: () => string;
}

/** 两跳解析的结果：要么给出 `shareId`，要么给出**为什么这份清单不算共享**。 */
type ShareRoute =
  | { readonly shareId: string }
  | { readonly blocked: 'task-has-no-project' | 'project-not-shared' };

export interface CommentActions {
  /**
   * 建一条评论，返回新实体 id。
   *
   * @throws {ListNotSharedError} 任务没有归属清单，或所属清单不在共享册里
   *   —— **此时一条 op 都不写**（文件头第 2 条）。
   * @throws 任务不存在或已软删；正文空白或超过 {@link COMMENT_MAX_LENGTH}
   */
  addComment(taskId: string, body: string): Promise<string>;
  /**
   * 改正文（同 id 的一条 `UPD`，LWW 覆盖 `body`）。
   *
   * ⚠️ 与 `updateNoteContent` 不同，这里**不做"内容没变就不写 op"的短路**：
   * 那条短路住在便签动作里是因为 `updatedAt` 是便签的排序键
   * （`sortNotesForDisplay`），一次空保存会让便签跳位；评论线程按 `createdAt`
   * 排序，空保存不改变任何可见顺序。多写一条 op 的代价由 LWW 吸收
   * （载荷收敛到同一个 `body`），而少写一条的代价是"用户点了保存但没写进去"
   * 这种要另立判据的语义。
   */
  editComment(commentId: string, body: string): Promise<void>;
  /** 软删除（`DEL` op，文件头第 5 条）。 */
  removeComment(commentId: string): Promise<void>;
  /**
   * 撤销删除：写一条 `UPD` 清墓碑。
   *
   * · 本来就没删除 ⇒ 返回 `false` 且**不写 op**（不产生空 op）；
   * · 🔴 已被彻底删除（`purgedAt`）⇒ **抛错**（文件头第 6 条）。
   *
   * ⚠️ 返回 `boolean` 而不是 `void`（工单给的形状是 `void`，这里按"与便签/任务
   * 同形状"的要求**收窄成同一个契约**）：`false` 不是失败，是"没产生 op"，
   * 宿主（CLI 是第一个消费者）要凭它决定说"已恢复"还是"本来就是活的"。
   * 只看 `void` 的话这两句话只能合成一句。
   */
  restoreComment(commentId: string): Promise<boolean>;
  /**
   * 某任务下的评论线程（未删除，`createdAt` 升序、同刻按 id）——判据在领域层
   * `aliveCommentsForTask`，这里不重写。
   *
   * ⚠️ **读不做路由判断**：任务不在共享清单里时返回 `[]`（"这里没有评论"），
   * 不是抛错。抛错是**写**的门（文件头第 2 条）——
   * 界面上要看一条个人清单的任务时，没有任何理由炸。
   */
  commentsForTask(taskId: string): Comment[];
  /**
   * 这条任务**属于哪一份共享清单**；不属于任何一份就返回 `undefined`。
   *
   * 🔴 它是"两跳解析"的**读侧出口**（`Task.projectId` → `Project.shareId`），
   * 与写侧的 `shareIdForTask` 共用同一个解析函数 —— 一份路由逻辑、两种错误语义：
   * 写要告诉用户"这条清单没共享"，读（要不要去拉远端 op）只需要知道"没有可拉的"。
   * 有了它，宿主就不必自己再去 `getState()` 里翻这两跳（那会长出第二份路由判断）。
   */
  shareIdOfTask(taskId: string): string | undefined;
}

export function createCommentActions(
  ctx: ActionContext,
  options: CommentActionsOptions,
): CommentActions {
  const authorUserId = options.currentUserId();
  // 🔴 空作者 id 直接拒绝**构造**（先例：`assistant-session-actions.ts` 的 clientId）。
  // 它是"这条评论是谁写的"的**唯一**依据；空值会让它退化成"谁都不是"或"谁都行"，
  // 两种退化都不会报错，只会让线程里出现一条署名不出来的评论。
  if (typeof authorUserId !== 'string' || authorUserId.trim() === '') {
    throw new Error('评论动作需要当前账号 id（空值会让评论的作者栏失效）');
  }
  const makeCommentId = options.newCommentId ?? ((): string => `comment-${randomId()}`);

  /**
   * 🔴 **ADR-0062 决策 4 的落点**：从本地物化状态解析"这条任务所属清单是否在册共享"，
   * 返回它的 `shareId`；不在册一律抛 {@link ListNotSharedError}。
   *
   * 读的是**两跳**：`Task.projectId` → `Project.shareId`。两跳都要查存在性，
   * 因为 `projectId` 可以指向一条已删除（或根本不存在的）清单 ——
   * 那时它不是"共享清单"，不能让它悄悄走到端口上。
   * `shareId` 空串按"没有"处理：`setProjectShareId` 会拒绝空串，但
   * 物化状态可能来自远端 op，不能假定它守规矩。
   */
  /**
   * 两跳解析（`Task.projectId` → `Project.shareId`）—— 这条线**唯一**的一份。
   *
   * 🔴 它只解析、不决定说什么：写侧拿它抛 {@link ListNotSharedError}（要给用户原因），
   * 读侧（`shareIdOfTask`）拿它返回 `undefined`（"这里没有共享评论可拉"不是错误）。
   * 分成两份判断的话，两份迟早对"什么算共享"给出不同的答案。
   */
  const routeShareId = (taskId: string): ShareRoute => {
    const state = ctx.getState();
    const task = state.tasks[taskId];
    if (task === undefined || task.deletedAt !== undefined) {
      throw new Error(`找不到任务「${taskId}」`);
    }
    const projectId = task.projectId;
    if (projectId === undefined) return { blocked: 'task-has-no-project' };
    const project = state.projects[projectId];
    if (project === undefined || project.deletedAt !== undefined) return { blocked: 'project-not-shared' };
    const shareId = project.shareId;
    if (shareId === undefined || shareId.trim() === '') return { blocked: 'project-not-shared' };
    return { shareId: shareId.trim() };
  };

  const shareIdForTask = (taskId: string): string => {
    const route = routeShareId(taskId);
    if ('blocked' in route) throw new ListNotSharedError(taskId, route.blocked);
    return route.shareId;
  };

  /** 未删除的评论；不存在或已软删都当"找不到"。 */
  const liveCommentOf = (commentId: string): Comment => {
    const comment = ctx.getState().comments[commentId];
    if (comment === undefined || comment.deletedAt !== undefined) {
      throw new Error(`找不到评论「${commentId}」`);
    }
    return comment;
  };

  /** 领域校验（单一来源：`@heyta/domain#commentRejection`）。 */
  const assertBody = (body: string): void => {
    const rejection = commentRejection(body);
    if (rejection === undefined) return;
    const detail =
      rejection === 'empty'
        ? '正文不能为空（空白也算空）'
        : `正文超过 ${String(body.length)} 字符，上限见 domain/src/comments.ts（${String(COMMENT_MAX_LENGTH)}）`;
    throw new Error(`评论正文不合法：${detail}`);
  };

  return {
    async addComment(taskId, body) {
      // 🔴 **路由先于正文校验**，顺序是有语义的：在个人清单上这条意图**根本不存在**，
      // 该告诉用户的是那个事实，而不是"正文不能为空"这种在别处才成立的话。
      // 两条路都不写 op，所以这个顺序只影响提示，不影响副作用。
      const shareId = shareIdForTask(taskId);
      assertBody(body);
      const entityId = makeCommentId();
      await options.dispatchShareOp(shareId, {
        entityType: 'COMMENT',
        entityId,
        opType: OpType.Create,
        // 只有这三格（文件头第 4 条）：`createdAt` 由 reducer 从 op 时间戳派生。
        payload: { taskId, authorUserId, body: body.trim() },
      });
      return entityId;
    },

    async editComment(commentId, body) {
      const comment = liveCommentOf(commentId);
      // 路由跟着**评论自己的任务**走，而不是让调用方再传一次 shareId ——
      // 调用方多传一个参数，就多一次传错的机会（评论挂错清单是最难查的那种）。
      const shareId = shareIdForTask(comment.taskId);
      assertBody(body);
      await options.dispatchShareOp(shareId, {
        entityType: 'COMMENT',
        entityId: commentId,
        opType: OpType.Update,
        // 只有 `body`：`taskId` / `authorUserId` 是不可变字段，一个都不重写。
        payload: { body: body.trim() },
      });
    },

    async removeComment(commentId) {
      const comment = liveCommentOf(commentId);
      const shareId = shareIdForTask(comment.taskId);
      await options.dispatchShareOp(shareId, {
        entityType: 'COMMENT',
        entityId: commentId,
        opType: OpType.Delete,
        // 空载荷：墓碑本身由 reducer 落。**不**在同一意图里顺带改正文/作者。
        payload: {},
      });
    },

    async restoreComment(commentId) {
      // 读**含墓碑**的原始记录：`liveCommentOf` 会把墓碑当"不存在"，
      // 而"撤销删除"要处理的恰恰是墓碑。
      const raw = ctx.getState().comments[commentId];
      if (raw === undefined) throw new Error(`找不到评论「${commentId}」`);
      // 🔴 不可逆必须在动作层真的拦住，而不是只靠界面不画那个按钮
      //（本机 API / CLI 也会调到这个方法）。
      if (raw.purgedAt !== undefined) {
        throw new Error(`评论「${commentId}」已被彻底删除，无法恢复`);
      }
      // 本来就没删除：不产生 op（也就**不需要**路由 —— 没有要写的东西）。
      if (raw.deletedAt === undefined) return false;
      const shareId = shareIdForTask(raw.taskId);
      await options.dispatchShareOp(shareId, {
        entityType: 'COMMENT',
        entityId: commentId,
        opType: OpType.Update,
        // 清墓碑写 `null`：`undefined` 会被 JSON 丢掉，对端既不清除也不设置
        //（同 `note-actions.ts` 的 `restoreNote`）。
        payload: { deletedAt: null },
      });
      return true;
    },

    commentsForTask(taskId) {
      // 过滤 + 排序都在领域层（单点定义，见 `domain/src/comments.ts`）。
      return aliveCommentsForTask(Object.values(ctx.getState().comments), taskId);
    },
    shareIdOfTask(taskId) {
      // 读侧不抛：个人清单/已删清单只是"没有共享可拉"，不是一个需要用户处理的状态。
      const route = routeShareId(taskId);
      return 'blocked' in route ? undefined : route.shareId;
    },
  };
}
