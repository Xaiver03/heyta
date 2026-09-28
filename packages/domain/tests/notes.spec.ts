/**
 * 便签领域规则的测试（幻觉 #12「笔记模块」的领域层）
 * ====================================================
 *
 * 重点盯**排序**这一类静默失效：顺序不确定时，两端画的是同一批便签却顺序不同，
 * 用户读成"同步把顺序搞乱了" —— 而本机状态明明是对的。
 *
 * 另外钉住一条**类型契约**：`Note.projectId` 缺省 = 未归属，而领域访问器
 * `noteProjectId()` 是唯一把 `undefined` 归一成 `null` 的地方。
 * 它的必要性来自 reducer 的语义（`null` = 删除该字段，见
 * `packages/op-log/src/state.ts`）—— 所以裸字段读回来是 `undefined`。
 */

import { describe, expect, it } from 'vitest';

import {
  NOTE_MAX_CONTENT_LENGTH,
  aliveNotes,
  isNoteHighlighted,
  noteExcerpt,
  noteProjectId,
  noteRejection,
  notesInGroup,
  sortNotesForDisplay,
  type Note,
} from '../src/index.js';

const NOW = 1_700_000_000_000;

const note = (over: Partial<Note> = {}): Note => ({
  id: 'n1',
  content: '买菜',
  isPinnedToToday: false,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

describe('正文校验', () => {
  it.each(['', '   ', '\n', '\t \n'])('空白内容 %j 被拒绝', (content) => {
    expect(noteRejection(content)).toBe('empty');
  });

  it('超长被拒绝，正好到上限通过', () => {
    expect(noteRejection('x'.repeat(NOTE_MAX_CONTENT_LENGTH))).toBeUndefined();
    expect(noteRejection('x'.repeat(NOTE_MAX_CONTENT_LENGTH + 1))).toBe('too-long');
  });

  it('普通内容通过', () => {
    expect(noteRejection('买菜')).toBeUndefined();
  });
});

describe('归属归一', () => {
  it('🔴 字段缺失（reducer 清值后的真实形态）与显式 null 都归一成 null', () => {
    expect(noteProjectId(note())).toBeNull();
    expect(noteProjectId(note({ projectId: undefined }))).toBeNull();
    expect(noteProjectId(note({ projectId: 'p1' }))).toBe('p1');
  });
});

describe('排序', () => {
  it('钉到「今天」的在前，然后按 updatedAt 降序', () => {
    const pinnedOld = note({ id: 'a', isPinnedToToday: true, updatedAt: NOW - 100 });
    const pinnedNew = note({ id: 'b', isPinnedToToday: true, updatedAt: NOW });
    const plainNew = note({ id: 'c', isPinnedToToday: false, updatedAt: NOW });

    expect(sortNotesForDisplay([plainNew, pinnedOld, pinnedNew]).map((n) => n.id)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('🔴 同刻更新的两条按 id 字典序 —— 决胜规则必须确定，否则两端顺序不同', () => {
    const b = note({ id: 'b', updatedAt: NOW });
    const a = note({ id: 'a', updatedAt: NOW });
    expect(sortNotesForDisplay([b, a]).map((n) => n.id)).toEqual(['a', 'b']);
    // 反过来输入，结果必须一样（确定性）。
    expect(sortNotesForDisplay([a, b]).map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('不改动入参数组（纯函数）', () => {
    const input = [note({ id: 'b' }), note({ id: 'a' })];
    const snapshot = input.map((n) => n.id);
    sortNotesForDisplay(input);
    expect(input.map((n) => n.id)).toEqual(snapshot);
  });
});

describe('读取过滤', () => {
  it('aliveNotes 滤掉墓碑', () => {
    const alive = note({ id: 'a' });
    const dead = note({ id: 'b', deletedAt: NOW });
    expect(aliveNotes([alive, dead]).map((n) => n.id)).toEqual(['a']);
  });

  it('notesInGroup(null) 只给未归属的（含字段缺失那种）', () => {
    const loose = note({ id: 'a' });
    const attached = note({ id: 'b', projectId: 'p1' });
    expect(notesInGroup([loose, attached], null).map((n) => n.id)).toEqual(['a']);
    expect(notesInGroup([loose, attached], 'p1').map((n) => n.id)).toEqual(['b']);
  });

  it('notesInGroup 也过滤墓碑并排序', () => {
    const old = note({ id: 'a', projectId: 'p1', updatedAt: NOW - 1 });
    const fresh = note({ id: 'b', projectId: 'p1', updatedAt: NOW });
    const dead = note({ id: 'c', projectId: 'p1', deletedAt: NOW });
    expect(notesInGroup([old, dead, fresh], 'p1').map((n) => n.id)).toEqual(['b', 'a']);
  });

  it('isNoteHighlighted 只看 isPinnedToToday 一个字段', () => {
    expect(isNoteHighlighted(note({ isPinnedToToday: true }))).toBe(true);
    expect(isNoteHighlighted(note({ isPinnedToToday: false }))).toBe(false);
  });
});

describe('摘要', () => {
  it('取第一段非空行（便签第一行常常就是标题）', () => {
    expect(noteExcerpt(note({ content: '\n\n第一行\n第二行' }), 60)).toBe('第一行');
  });

  it('超长截断并带省略号（U+2026，不是三个点）', () => {
    const excerpt = noteExcerpt(note({ content: 'x'.repeat(100) }), 10);
    expect(excerpt).toHaveLength(10);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt.slice(0, 9)).toBe('x'.repeat(9));
  });

  it('正好到长度不截断', () => {
    expect(noteExcerpt(note({ content: 'x'.repeat(10) }), 10)).toBe('x'.repeat(10));
  });

  it('全空白内容给空串（不抛错）', () => {
    expect(noteExcerpt(note({ content: '   \n  ' }), 10)).toBe('');
  });
});
