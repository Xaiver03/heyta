/**
 * `@任务` 的候选与标签
 * ====================
 *
 * 这份测试守的是一件事：**每个标签都能唯一还原成一个 taskId，且用户能看见区别**。
 * 同名任务是这个功能唯一的真难点 —— 而"挑第一个"是最省事、也最坑的做法。
 */

import { describe, expect, it } from 'vitest';

import {
  mentionCandidates,
  mentionCandidatesFor,
  mentionLookupFor,
} from '../src/mention-tasks.js';

const T = (id: string, title: string, dueDate?: string, projectTitle?: string) => ({
  id,
  title,
  ...(dueDate === undefined ? {} : { dueDate }),
  ...(projectTitle === undefined ? {} : { projectTitle }),
});

describe('标签：没有重名就不加后缀', () => {
  it('普通任务标签就是标题', () => {
    expect(mentionCandidatesFor([T('a', '买牛奶')])[0]).toEqual({
      taskId: 'a',
      title: '买牛奶',
      label: '买牛奶',
    });
  });

  it('标题两端的空白被去掉', () => {
    expect(mentionCandidatesFor([T('a', '  买牛奶  ')])[0]?.label).toBe('买牛奶');
  });
});

describe('🔴 重名任务：必须能区分，且两条都能 @ 到', () => {
  it('有日期就用日期消歧（只取 月-日）', () => {
    const out = mentionCandidatesFor([
      T('a', '开会', '2026-08-13'),
      T('b', '开会', '2026-08-15'),
    ]);
    expect(out.map((c) => c.label)).toEqual(['开会（08-13）', '开会（08-15）']);
    expect(out.map((c) => c.title)).toEqual(['开会', '开会']);
  });

  it('没有日期就用清单名', () => {
    const out = mentionCandidatesFor([T('a', '开会', undefined, '工作'), T('b', '开会', undefined, '个人')]);
    expect(out.map((c) => c.label)).toEqual(['开会（工作）', '开会（个人）']);
  });

  it('两者都没有时退回序号（数据本身没给区分依据）', () => {
    const out = mentionCandidatesFor([T('a', '开会'), T('b', '开会')]);
    expect(out.map((c) => c.label)).toEqual(['开会（#1）', '开会（#2）']);
  });

  it('🔴 消歧之后每个标签都能唯一还原', () => {
    const tasks = [T('a', '开会', '2026-08-13'), T('b', '开会', '2026-08-15')];
    const lookup = mentionLookupFor(tasks);
    expect(lookup('开会（08-13）')).toBe('a');
    expect(lookup('开会（08-15）')).toBe('b');
    // 裸标题**不能**解析 —— 那正是"猜一个错的任务"的入口
    expect(lookup('开会')).toBeUndefined();
  });
});

describe('候选：可 @ 的范围与排序', () => {
  const tasks = [T('a', '买牛奶'), T('b', '买咖啡豆'), T('c', '整理买菜的清单'), T('d', '   ')];

  it('空标题不进候选（点了没反应的项不该出现）', () => {
    expect(mentionCandidates(tasks, '').map((c) => c.taskId)).not.toContain('d');
  });

  it('前缀优先于子串', () => {
    expect(mentionCandidates(tasks, '买').map((c) => c.title)).toEqual([
      '买牛奶',
      '买咖啡豆',
      '整理买菜的清单',
    ]);
  });

  it('limit 生效', () => {
    expect(mentionCandidates(tasks, '', 2)).toHaveLength(2);
  });
});

describe('lookup：精确匹配，不做模糊', () => {
  it('查得到就给出 id', () => {
    expect(mentionLookupFor([T('a', '买牛奶')])('买牛奶')).toBe('a');
  });

  it('🔴 不模糊：前缀不算命中', () => {
    const lookup = mentionLookupFor([T('a', '买牛奶')]);
    expect(lookup('买')).toBeUndefined();
    expect(lookup('牛奶')).toBeUndefined();
  });

  it('空标签与查不到都给 undefined', () => {
    const lookup = mentionLookupFor([T('a', '买牛奶')]);
    expect(lookup('')).toBeUndefined();
    expect(lookup('不存在')).toBeUndefined();
  });

  it('标签两端空白被忽略（用户可能照着候选手打）', () => {
    expect(mentionLookupFor([T('a', '买牛奶')])(' 买牛奶 ')).toBe('a');
  });
});
