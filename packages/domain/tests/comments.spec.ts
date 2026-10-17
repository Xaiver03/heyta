/**
 * 评论领域规则的测试（ADR-0062 W3 的领域层）
 * ============================================
 *
 * 盯的是三类**静默失效**（本地看起来都对，用户看到的却不对）：
 *   1. 软删的评论进了线程 → 用户以为"删不掉"。
 *   2. 顺序不确定 → 两端画的是同一批评论却顺序不同，读成"同步乱了"。
 *   3. 上限/空白判定在两处各写一遍 → "界面允许提交、动作层拒绝"。
 *
 * 🔴 第三条还有一层：这份逻辑原先住在 `packages/ui/src/sync/comments-model.ts`，
 * 本文件与 `packages/app-host/tests/comment-actions.spec.ts` 一起钉住
 * **它只有一份** —— ui 的那份现在是转发。
 */

import { describe, expect, it } from 'vitest';

import {
  COMMENT_MAX_LENGTH,
  aliveCommentsForTask,
  byCommentOrder,
  commentRejection,
  isLive,
  type CommentLike,
} from '../src/index.js';

const comment = (id: string, over: Partial<CommentLike> = {}): CommentLike => ({
  id,
  taskId: 'task-1',
  createdAt: 1_000,
  ...over,
});

describe('正文校验（闸门不是玩法）', () => {
  it.each(['', '   ', '\n', '\t \n'])('空白正文 %j 被拒绝（trim 后判断）', (body) => {
    expect(commentRejection(body)).toBe('empty');
  });

  it('上限边界：恰好 2000 字合法，2001 字拒绝', () => {
    expect(commentRejection('好'.repeat(COMMENT_MAX_LENGTH))).toBeUndefined();
    expect(commentRejection('好'.repeat(COMMENT_MAX_LENGTH + 1))).toBe('too-long');
  });

  it('普通正文通过', () => {
    expect(commentRejection('看起来不错 👍')).toBeUndefined();
  });

  it('🔴 上限是 2000 —— 这个数字只有一份定义（ui 的那份转发它）', () => {
    expect(COMMENT_MAX_LENGTH).toBe(2000);
  });
});

describe('线程：过滤与顺序', () => {
  it('只给该任务的评论', () => {
    const all = [comment('a'), comment('b', { taskId: 'task-2' })];
    expect(aliveCommentsForTask(all, 'task-1').map((c) => c.id)).toEqual(['a']);
  });

  it('软删的评论不进线程（四态语义 ADR-0048）', () => {
    const all = [comment('a'), comment('gone', { deletedAt: 2_000 })];
    expect(aliveCommentsForTask(all, 'task-1').map((c) => c.id)).toEqual(['a']);
  });

  it('🔴 已彻底删除的也不进线程（purge 只作用在软删实体上，isLive 一并滤掉）', () => {
    // 这条断言钉的是 `comments.ts` 文件头里那句"不需要另判 purgedAt"的**依赖**：
    // purge 保留墓碑。如果哪天有人做出"活着就 purge"的动作，这条会红。
    // ⚠️ `purgedAt` 故意不在 `CommentLike` 上：线程读面不读它 —— 这里多带一格，
    //    正是要证明"多出来的字段不影响判定"。
    const purged: CommentLike & { purgedAt: number } = {
      id: 'purged',
      taskId: 'task-1',
      createdAt: 1_000,
      deletedAt: 2_000,
      purgedAt: 3_000,
    };
    const all: (CommentLike & { purgedAt?: number })[] = [comment('a'), purged];
    expect(aliveCommentsForTask(all, 'task-1').map((c) => c.id)).toEqual(['a']);
    // 前提本身也断言一次：purge 过的记录确实带着墓碑。
    expect(isLive(purged)).toBe(false);
  });

  it('createdAt 升序 — 最新的在最后（对话串从上往下读）', () => {
    const all = [
      comment('late', { createdAt: 3_000 }),
      comment('early', { createdAt: 1_000 }),
      comment('mid', { createdAt: 2_000 }),
    ];
    expect(aliveCommentsForTask(all, 'task-1').map((c) => c.id)).toEqual(['early', 'mid', 'late']);
  });

  it('🔴 同刻按 id 字典序兜底 —— 少了这一段，两端会换位', () => {
    const all = [
      comment('c', { createdAt: 2_000 }),
      comment('b', { createdAt: 2_000 }),
      comment('a', { createdAt: 2_000 }),
    ];
    expect(aliveCommentsForTask(all, 'task-1').map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('createdAt 缺席按 0（沿用旧实现的语义，不是新规则）', () => {
    const all = [comment('has', { createdAt: 5 }), comment('missing', { createdAt: undefined })];
    expect(aliveCommentsForTask(all, 'task-1').map((c) => c.id)).toEqual(['missing', 'has']);
  });

  it('不修改入参（排序发生在过滤出来的新数组上）', () => {
    const all = [comment('b', { createdAt: 2_000 }), comment('a', { createdAt: 1_000 })];
    const before = all.map((c) => c.id);
    aliveCommentsForTask(all, 'task-1');
    expect(all.map((c) => c.id)).toEqual(before);
  });

  it('比较器单独可用，且与线程函数同一份（不是第二份实现）', () => {
    const all = [comment('b', { createdAt: 900 }), comment('a', { createdAt: 100 })];
    const viaComparator = [...all].sort(byCommentOrder).map((c) => c.id);
    expect(viaComparator).toEqual(aliveCommentsForTask(all, 'task-1').map((c) => c.id));
  });

  it('没有评论 / 没有匹配任务时返回空数组（读不是门，不抛错）', () => {
    expect(aliveCommentsForTask([], 'task-1')).toEqual([]);
    expect(aliveCommentsForTask([comment('a')], 'task-9')).toEqual([]);
  });
});
