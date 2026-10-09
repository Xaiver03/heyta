import { describe, expect, it } from 'vitest';

import {
  commentAuthorFallbackVars,
  commentsForTask,
  COMMENT_MAX_LENGTH,
  validateCommentDraft,
  type CommentView,
} from '../src/sync/comments-model';

const comment = (id: string, overrides: Partial<CommentView> = {}): CommentView => ({
  id,
  taskId: 'task-1',
  authorUserId: '42',
  body: `评论 ${id}`,
  createdAt: 1_000,
  ...overrides,
});

describe('commentsForTask', () => {
  it('按任务过滤 + createdAt 升序 + 同刻按 id 兜底（两端不换位）', () => {
    const all = [
      comment('b', { createdAt: 2_000 }),
      comment('a', { taskId: 'task-2' }),
      comment('c', { createdAt: 2_000 }),
      comment('d', { createdAt: 500 }),
    ];
    const thread = commentsForTask(all, 'task-1');
    expect(thread.map((c) => c.id)).toEqual(['d', 'b', 'c']);
  });

  it('软删（deletedAt）的评论不进线程', () => {
    const all = [comment('a'), comment('gone', { deletedAt: 2_000 })];
    expect(commentsForTask(all, 'task-1').map((c) => c.id)).toEqual(['a']);
  });
});

describe('validateCommentDraft', () => {
  it('空/纯空白 → empty', () => {
    expect(validateCommentDraft('')).toBe('common.share.comment.empty');
    expect(validateCommentDraft('   ')).toBe('common.share.comment.empty');
  });

  it('超长 → tooLong', () => {
    expect(validateCommentDraft('好'.repeat(COMMENT_MAX_LENGTH + 1)))
      .toBe('common.share.comment.tooLong');
  });

  it('正常内容 → 无错误', () => {
    expect(validateCommentDraft('看起来不错 👍')).toBeUndefined();
  });

  it('上限边界：恰好 2000 字合法', () => {
    expect(validateCommentDraft('好'.repeat(COMMENT_MAX_LENGTH))).toBeUndefined();
  });
});

describe('作者兜底', () => {
  it('显示 id 前缀而不是裸数字', () => {
    const { key, vars } = commentAuthorFallbackVars('42424242');
    expect(key).toBe('common.share.comment.fallbackAuthor');
    expect(vars.id).toBe('42424242');
  });
});
