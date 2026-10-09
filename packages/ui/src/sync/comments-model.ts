/**
 * 任务评论的**纯逻辑**（ADR-0062 W3/W4；`COMMENT` 实体一条一实体）。
 * =====================================================
 *
 * 输入是 op-log 物化桶 `MaterializedState['comments']` 的值视图——
 * 排序、校验、作者兜底都在这里，组件保持薄壳。
 *
 * 作者展示：per-share 名片（清单密钥域）落地前用兜底 key；
 * 🔴 不显示裸数字 id（`share-model.ts` 的 `memberFallbackLabel` 同一条纪律）。
 */

export interface CommentView {
  id: string;
  taskId: string;
  authorUserId: string;
  body: string;
  createdAt?: number;
  deletedAt?: number;
}

/** 软删的评论不进线程（四态语义，ADR-0048）；排序：createdAt 升序、同刻按 id 兜底。 */
export function commentsForTask(
  comments: readonly CommentView[],
  taskId: string,
): CommentView[] {
  return comments
    .filter((c) => c.taskId === taskId && c.deletedAt === undefined)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || (a.id < b.id ? -1 : 1));
}

export type CommentDraftError = 'common.share.comment.empty' | 'common.share.comment.tooLong';

/** 评论正文上限。与任务的 title/note 不同源——评论是短交流，不是文档。 */
export const COMMENT_MAX_LENGTH = 2000;

export function validateCommentDraft(body: string): CommentDraftError | undefined {
  if (body.trim().length === 0) return 'common.share.comment.empty';
  if (body.length > COMMENT_MAX_LENGTH) return 'common.share.comment.tooLong';
  return undefined;
}

/** 作者兜底 key + 参数：卡片落地前显示「成员 + id 前缀」，永不显示裸数字。 */
export type CommentAuthorFallbackKey = 'common.share.comment.fallbackAuthor';

export const commentAuthorFallbackVars = (
  authorUserId: string,
): { key: CommentAuthorFallbackKey; vars: { id: string } } => ({
  key: 'common.share.comment.fallbackAuthor',
  vars: { id: authorUserId.slice(0, 8) },
});
