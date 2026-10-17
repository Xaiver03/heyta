/**
 * 任务评论的领域规则 —— **"哪些评论、按什么序、正文能有多长"只有一个定义**
 * ======================================================================
 *
 * 实体形状在 `entities.ts` 的 {@link Comment}（ADR-0062 W3 定案：
 * **一条评论 = 一个实体**），op 的构造在 `packages/app-host/src/comment-actions.ts`；
 * 这里只有**纯函数**。
 *
 * ## 为什么纯逻辑必须住在这里（而不是组件里）
 *
 * 这份逻辑原先住在 `packages/ui/src/sync/comments-model.ts`。它不是"展示细节"，
 * 而是三条**跨端必须一致**的判定 —— 住在组件/宿主模型层就意味着第二个宿主
 * （node-host CLI、本机 API、移动端）要用就得抄一遍。理由与 `notes.ts` 的
 * `notesInGroup` / `assistant-turn.ts` 的 `assistantTurnsOfSession` 是同一套：
 *
 * 1. **软删的评论不进线程**（{@link aliveCommentsForTask} 的过滤那一半）。
 *    它是四态语义（ADR-0048）在评论上的落点：`deletedAt` 在 = 不可见。
 *    过滤写在两处，就会出现"电脑上删掉的评论在手机上还在"，
 *    而 op-log 里两条记录都是对的。
 * 2. **排序确定**（`createdAt` 升序、同刻按 id 字典序）。`createdAt` 由 reducer
 *    从 **op 时间戳**派生（见 `entities.ts` 的 `EntityBase.createdAt`），
 *    两设备的到达顺序可以不同却落到同一毫秒里 —— 少了 id 那一段，
 *    同一份数据在两台设备上顺序不同，用户读成"同步把评论顺序搞乱了"。
 *    ⚠️ `createdAt` 在这里是**可选**读取（缺席按 0），因为调用方除了实体本身，
 *    还会递进 `CommentView` 那种"只带视图字段"的形状（见下面 `CommentLike`）。
 *    这个 `?? 0` 是**沿用**旧实现的语义，不是新规则 —— 改它会让既有顺序变一次。
 * 3. **正文校验是闸门不是玩法**（{@link COMMENT_MAX_LENGTH}）：上限拦的是病态数据
 *    （一次粘贴一整本书 → 每次同步都要带上它），不是产品规格。
 *
 * ## 为什么 `inTrash` / `byDeletedOrder` 在这里**没有**被复用
 *
 * 它们在 `entities.ts` 里管的是**回收站**（有墓碑、未被彻底删除、最近删除在前）。
 * 评论这一段没有回收站出口（本轮的接口只有线程读 + 软删/还原，见
 * `comment-actions.ts` 的接口清单），线程要的是**存活 + 按创建时刻正序**，
 * 与回收站那两个判据方向都相反。硬套会让"回收站顺序"这个语义
 * 悄悄变成线程顺序 —— 所以这里只复用实体级的 {@link isLive}，
 * 并在此写明**不复用**的那两个为什么不该复用（免得下一个人以为漏了）。
 *
 * 🔴 **彻底删除（`purgedAt`）不需要在这里另判一次**：purge 只允许作用在
 * 已软删的实体上（`comment-actions.ts` 与 `note-actions.ts` / `actions.ts`
 * 同一条契约），所以 `purgedAt !== undefined` 必然伴随 `deletedAt !== undefined`，
 * 被 {@link isLive} 一并滤掉。这条依赖写在这是为了让它**可被检查** ——
 * 如果哪天有人做出"活着就 purge"的动作，这里的第一条判定就漏了。
 */

import { isLive } from './entities.js';

/**
 * 单条评论正文的长度上限（字符数）。
 *
 * 🔴 **常量只有这一份定义**：`packages/ui/src/sync/comments-model.ts` 从
 * `@heyta/domain` **转发**它，不再自己写一遍。两份 `2000` 的表现是
 * "界面允许提交、动作层拒绝"（或反过来），而两边都不会报错。
 *
 * 与 `NOTE_MAX_CONTENT_LENGTH` 的区别是有意的：评论是**短交流**，不是文档。
 */
export const COMMENT_MAX_LENGTH = 2000;

/** 建评论 / 改正文的拒绝原因。**返回原因而不是抛错** —— 调用方要能给出提示。 */
export type CommentRejection = 'empty' | 'too-long';

/**
 * 校验正文。合法则返回 `undefined`。
 *
 * 🔴 **空白算空**（`trim()` 后判断）：一条内容全是空格的评论在对话串里
 * 是一行看不见的字，而它会占掉一个作者头像与一个时间戳。
 *
 * ⚠️ 这里**返回的是领域词表**（`'empty'` / `'too-long'`），**不是 i18n key**。
 * 翻成界面词条是宿主的事（`packages/ui/src/sync/comments-model.ts` 做那层映射）——
 * 领域层不认识 `common.share.comment.*` 这类键，也不该认识。
 */
export function commentRejection(body: string): CommentRejection | undefined {
  if (body.trim().length === 0) return 'empty';
  if (body.length > COMMENT_MAX_LENGTH) return 'too-long';
  return undefined;
}

/**
 * 评论的**最小读面**：线程的过滤与排序只用到这几格。
 *
 * 泛型参数宽到 `CommentLike` 而不是死盯 `Comment`，是因为调用方递进来的是
 * `MaterializedState['comments']` 的值（真实体）与 UI 的 `CommentView`
 * （同样的几格 + 正文/作者）两种形状 —— 让它们共用同一个排序，
 * 正是这个文件存在的理由。**多出来的字段一律不读。**
 */
export interface CommentLike {
  id: string;
  /** 被评论的任务 id。 */
  taskId: string;
  /** 创建时刻（epoch ms）。缺席按 0 —— 见文件头第 2 条的 ⚠️。 */
  createdAt?: number;
  /** 软删除墓碑。在 = 这条评论不进线程。 */
  deletedAt?: number;
}

/**
 * 线程顺序：`createdAt` 升序，同刻按 id 字典序。
 *
 * 单独导出（而不是只藏在下面那个函数里）是为了让"同一份评论、两个出口"
 * 也能拿到同一个比较器 —— 与 `entities.ts` 的 `byCreatedAtOrder` /
 * `byDeletedOrder` 同一个理由：比较器写两遍，两遍的决胜项就可能不一样。
 */
export function byCommentOrder(a: CommentLike, b: CommentLike): number {
  const at = a.createdAt ?? 0;
  const bt = b.createdAt ?? 0;
  if (at !== bt) return at - bt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 某个任务下的评论线程：**软删的不在**，`createdAt` 升序（同刻按 id）。
 *
 * ⚠️ 这是一个**读**函数：它不做任何写入路由判断。任务不在共享清单里时
 * 它的返回是 `[]`（"这条清单上没有评论"），**不是抛错** —— 见
 * `comment-actions.ts` 的 `commentsForTask`。
 */
export function aliveCommentsForTask<T extends CommentLike>(
  comments: readonly T[],
  taskId: string,
): T[] {
  return comments
    .filter((comment) => comment.taskId === taskId && isLive(comment))
    .sort(byCommentOrder);
}
