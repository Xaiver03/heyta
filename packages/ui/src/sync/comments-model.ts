/**
 * 任务评论的**界面模型**（ADR-0062 W3/W4）。
 * ===========================================
 *
 * 输入是 op-log 物化桶 `MaterializedState['comments']` 的值视图。
 *
 * 🔴 **这个文件从 2026-10-16 起不再自己持有判定** —— 排序、"软删不进线程"、
 * 正文上限与空白拒绝都**下沉**到 `@heyta/domain` 的 `comments.ts`，这里只剩
 * 两件**界面专属**的事：
 *
 * 1. **领域词表 → i18n key 的映射**（`validateCommentDraft`）。领域层返回
 *    `'empty' | 'too-long'`，界面要说的是词条键 —— 让 domain 认识
 *    `common.share.comment.*` 会把文案绑进纯业务逻辑（下一端就得搬一次）。
 * 2. **作者兜底**（`commentAuthorFallbackVars`）：per-share 名片（清单密钥域）
 *    落地前用兜底 key；🔴 不显示裸数字 id（`share-model.ts` 的
 *    `memberFallbackLabel` 同一条纪律）。
 *
 * 为什么下沉而不是留在这：第二个宿主（node-host CLI / 本机 API / 移动端）
 * 要读线程时**不能依赖 `@heyta/ui`**，留在 ui 的话它只会把过滤与排序抄一遍 ——
 * 那正是"同一条评论在两个端顺序不同"的成因（理由全文在 `domain/src/comments.ts`
 * 的文件头）。
 */

import {
  COMMENT_MAX_LENGTH,
  aliveCommentsForTask,
  commentRejection,
  type CommentLike,
} from '@heyta/domain';

/**
 * 评论的视图形状。字段与 `Comment`（`@heyta/domain`）一致的那几格直接继承
 * `CommentLike` —— 排序与过滤读的就是那几格，**不许在这里再声明一遍**
 * （声明两遍就会漂移：这一份多一个 `createdAt?`、那一份少一个，而 TS 只在新数据上保护）。
 */
export interface CommentView extends CommentLike {
  taskId: string;
  authorUserId: string;
  body: string;
}

/**
 * 正文上限 —— **转发** `@heyta/domain` 的那一份，不在这里写第二遍数字。
 *
 * 保留这个名字的导出是刻意的：它是界面侧既有的引用点（组件与测试都 import 它），
 * 删掉它只会让调用方改去直接 import domain —— 那本身没错，但会让"上限只有一个定义"
 * 这件事少一个显式的中转说明。
 */
export { COMMENT_MAX_LENGTH };

/** 线程（已过滤墓碑、已按 `createdAt` 升序 + 同刻 id 兜底）——判据在领域层。 */
export function commentsForTask(
  comments: readonly CommentView[],
  taskId: string,
): CommentView[] {
  return aliveCommentsForTask(comments, taskId);
}

export type CommentDraftError = 'common.share.comment.empty' | 'common.share.comment.tooLong';

/**
 * 草稿校验：领域判定 → 词条键。
 *
 * 🔴 **上限边界必须与领域层逐字一致**（恰好 2000 字合法）。这里只做翻译，
 * 不做第二次判断 —— 出现 `body.length > 2000` 这种字面量就等于上限有了第二份定义。
 */
export function validateCommentDraft(body: string): CommentDraftError | undefined {
  const rejection = commentRejection(body);
  if (rejection === undefined) return undefined;
  return rejection === 'empty' ? 'common.share.comment.empty' : 'common.share.comment.tooLong';
}

/** 作者兜底 key + 参数：卡片落地前显示「成员 + id 前缀」，永不显示裸数字。 */
export type CommentAuthorFallbackKey = 'common.share.comment.fallbackAuthor';

export const commentAuthorFallbackVars = (
  authorUserId: string,
): { key: CommentAuthorFallbackKey; vars: { id: string } } => ({
  key: 'common.share.comment.fallbackAuthor',
  vars: { id: authorUserId.slice(0, 8) },
});
