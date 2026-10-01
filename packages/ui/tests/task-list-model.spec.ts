/**
 * `model.ts` 的行为测试
 * =====================
 *
 * 这里刻意挑的都是**不报错、只会画错**的那类边界：
 * `completedAt: 0`、`dueDate: 0`、空标题、排序稳定性。
 * 它们全都不会在类型检查或运行时报错 —— 只会在屏幕上呈现成别的东西。
 */

import { describe, expect, it } from 'vitest';
import { Priority } from '@heyta/domain';
import type { Task } from '@heyta/domain';
import {
  flattenSections,
  sortTasksForDisplay,
  toTaskRow,
  toTaskRows,
} from '../src/task-list/model.js';

/** 造一条任务。默认未完成、无截止 —— 每条用例只覆盖它真正关心的字段。 */
function mkTask(id: string, overrides: Partial<Task> = {}): Task {
  return { id, title: id, createdAt: 0, updatedAt: 0, ...overrides };
}

const ids = (tasks: readonly Task[]): string[] => tasks.map((t) => t.id);

describe('toTaskRow', () => {
  it('把 Task 映射成渲染所需的最小字段集', () => {
    const task = mkTask('a', { title: '写周报', important: true, dueDate: 1_700_000_000_000 });
    const row = toTaskRow(task);
    // 断言**派生**出来的那几个字段。`source` 是原样透传的任务本体
    //（宿主插槽要用它取 priority / repeat 之类），单独验它是不是同一个引用。
    expect(row).toMatchObject({
      id: 'a',
      title: '写周报',
      done: false,
      important: true,
      dueAt: 1_700_000_000_000,
    });
    expect(row.source).toBe(task);
  });

  it('🔴 completedAt 判的是"存不存在"而不是真值 —— 0 也是已完成', () => {
    // domain 里 completedAt 是 epoch ms。理论上 0 不会自然出现，
    // 但它是一个**合法数字**，而 `if (task.completedAt)` 会把它当成未完成。
    // 这类"用真值判断代替存在性判断"的写法，是同一族 bug 里最常见的一种。
    expect(toTaskRow(mkTask('a', { completedAt: 0 })).done).toBe(true);
    expect(toTaskRow(mkTask('a')).done).toBe(false);
  });

  it('🔴 dueDate: 0 要得到 0，不能变成 null', () => {
    // 用 `||` 写就会得到 null，于是"1970-01-01 到期"这条会被排进"无截止"里。
    // 用 `??` 才是对的：null/undefined 才代表"没有截止时间"。
    expect(toTaskRow(mkTask('a', { dueDate: 0 })).dueAt).toBe(0);
    expect(toTaskRow(mkTask('a')).dueAt).toBeNull();
  });

  it('important 只在真的是 true 时才算重要', () => {
    expect(toTaskRow(mkTask('a', { important: true })).important).toBe(true);
    expect(toTaskRow(mkTask('a', { important: false })).important).toBe(false);
    expect(toTaskRow(mkTask('a')).important).toBe(false);
  });

  it('标题首尾空白被去掉；空标题用 fallbackTitle 兜住', () => {
    expect(toTaskRow(mkTask('a', { title: '  写周报  ' })).title).toBe('写周报');
    expect(toTaskRow(mkTask('a', { title: '   ' }), { fallbackTitle: '（无标题）' }).title).toBe(
      '（无标题）',
    );
  });

  it('不给 fallbackTitle 时空标题退化成空串（而不是 undefined）', () => {
    // 组件直接把这个值渲染进 <Text>。给 undefined 会让 RN 渲染出
    // "undefined" 字样吗？——不会，但类型上就不该允许这种事发生。
    expect(toTaskRow(mkTask('a', { title: '' })).title).toBe('');
  });
});

describe('sortTasksForDisplay', () => {
  it('未完成在前，已完成在后', () => {
    const done = mkTask('done', { completedAt: 1 });
    const todo = mkTask('todo');
    expect(ids(sortTasksForDisplay([done, todo]))).toEqual(['todo', 'done']);
  });

  it('未完成之间按截止时间升序', () => {
    const late = mkTask('late', { dueDate: 200 });
    const early = mkTask('early', { dueDate: 100 });
    expect(ids(sortTasksForDisplay([late, early]))).toEqual(['early', 'late']);
  });

  it('🔴 没有截止时间的排最后 —— 不是最前', () => {
    // 用 0 当"无截止"的哨兵值就会排到最前面（0 < 任何真实时间戳），
    // 于是整个收集箱会顶在列表最上方。这是没有截止时间的任务里
    // 最常见的一种实现错误。
    const none = mkTask('none');
    const has = mkTask('has', { dueDate: 100 });
    expect(ids(sortTasksForDisplay([none, has]))).toEqual(['has', 'none']);
  });

  it('已完成之间同样按截止时间排', () => {
    const doneLate = mkTask('done-late', { completedAt: 1, dueDate: 200 });
    const doneEarly = mkTask('done-early', { completedAt: 1, dueDate: 100 });
    expect(ids(sortTasksForDisplay([doneLate, doneEarly]))).toEqual(['done-early', 'done-late']);
  });

  it('🔴 同键时保持原顺序（稳定排序）', () => {
    // 顺序若无故变化，每次重排列表都会自己抖一下 ——
    // 而"列表会自己换位置"是用户最直接的不信任来源。
    const a = mkTask('a', { dueDate: 100 });
    const b = mkTask('b', { dueDate: 100 });
    const c = mkTask('c', { dueDate: 100 });
    expect(ids(sortTasksForDisplay([a, b, c]))).toEqual(['a', 'b', 'c']);
    expect(ids(sortTasksForDisplay([c, a, b]))).toEqual(['c', 'a', 'b']);
  });

  it('不修改传入的数组', () => {
    const input = [mkTask('b', { dueDate: 200 }), mkTask('a', { dueDate: 100 })];
    const snapshot = ids(input);
    sortTasksForDisplay(input);
    expect(ids(input)).toEqual(snapshot);
  });

  it('空数组与单元素是安全的', () => {
    expect(sortTasksForDisplay([])).toEqual([]);
    expect(ids(sortTasksForDisplay([mkTask('only')]))).toEqual(['only']);
  });
});

describe('toTaskRows', () => {
  it('排序与映射一步完成，顺序与 sortTasksForDisplay 一致', () => {
    const rows = toTaskRows(
      [
        mkTask('done', { completedAt: 1 }),
        mkTask('none'),
        mkTask('soon', { dueDate: 100 }),
      ],
      { fallbackTitle: '（无标题）' },
    );
    expect(rows.map((r) => r.id)).toEqual(['soon', 'none', 'done']);
  });

  it('把 fallbackTitle 透传给每一行', () => {
    const rows = toTaskRows([mkTask('a', { title: '' })], { fallbackTitle: '（无标题）' });
    expect(rows[0]?.title).toBe('（无标题）');
  });
});

describe('flattenSections', () => {
  const sec = (key: string, tasks: Task[], meta?: string) => ({ key, tasks, meta });

  it('展平成 [头, 任务…, 头, 任务…]', () => {
    const rows = flattenSections([
      sec('today', [mkTask('a'), mkTask('b')], '今天'),
      sec('done', [mkTask('c')], '已完成'),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['header', 'task', 'task', 'header', 'task']);
    expect(rows.map((r) => r.key)).toEqual(['h-today', 'a', 'b', 'h-done', 'c']);
  });

  it('🔴 空分组**不产生头** —— 一个写着"已完成 0"的标题是纯噪音', () => {
    const rows = flattenSections([
      sec('today', [mkTask('a')]),
      sec('overdue', []),
      sec('done', [mkTask('b')]),
    ]);
    expect(rows.map((r) => r.key)).toEqual(['h-today', 'a', 'h-done', 'b']);
    expect(rows.some((r) => r.kind === 'header' && r.section.key === 'overdue')).toBe(false);
  });

  it('全部为空时得到空数组', () => {
    expect(flattenSections([sec('a', []), sec('b', [])])).toEqual([]);
  });

  it('🔴 `keepEmpty` 时保留空组 —— 固定槽位布局（四象限矩阵）需要它', () => {
    // 矩阵里"这一格是空的"本身就是信息：藏掉会让人以为那个象限不存在，
    // 而矩阵的价值恰恰在于四个格子**同时**在那儿。所以这是唯一的例外。
    const rows = flattenSections([sec('q1', []), sec('q2', [mkTask('a')])], { keepEmpty: true });
    expect(rows.map((r) => r.key)).toEqual(['h-q1', 'h-q2', 'a']);
  });

  it('meta 原样交回（共享层不解释它）', () => {
    const rows = flattenSections([sec('today', [mkTask('a')], '今天')]);
    const header = rows[0];
    expect(header?.kind === 'header' && header.section.meta).toBe('今天');
  });

  it('组内顺序**不**被重排 —— 不传 `sort` 时老宿主行为逐字节不变', () => {
    // "今天 / 逾期 / 收集箱" 这种**分组**次序不是按截止时间能推出来的。
    // 组内次序在以前也完全由宿主决定（四象限矩阵、日历格都没有排序档位），
    // 所以"没传 sort 就不动"是它们不被这次改动波及的唯一保证。
    const late = mkTask('late', { dueDate: 900 });
    const early = mkTask('early', { dueDate: 100 });
    const rows = flattenSections([sec('today', [late, early])]);
    expect(rows.slice(1).map((r) => r.key)).toEqual(['late', 'early']);
  });

  it('🔴 传了 `sort` 就**每一组各自**排，分组之间的次序仍是宿主的', () => {
    // 排的是组内，不是整表：如果实现把两组拼起来再排，"已完成"组会跑到
    // "今天"组前面去 —— 而分组次序是这一屏的产品语义，共享层无权决定。
    const rows = flattenSections(
      [
        sec('today', [mkTask('t-late', { dueDate: 900 }), mkTask('t-early', { dueDate: 100 })]),
        sec('done', [mkTask('d-late', { completedAt: 1, dueDate: 500 })]),
      ],
      { sort: 'display' },
    );
    expect(rows.map((r) => r.key)).toEqual(['h-today', 't-early', 't-late', 'h-done', 'd-late']);
  });

  it('🔴 `addedAt` 就是 mobile 原来手写 `reverse()` 的那个语义', () => {
    // mobile 任务屏以前在屏幕里 `groups.x.reverse()`，而领域给的规范顺序是
    // `createdAt` 升序 —— 合起来就是"新的在上"。这次把 reverse 删掉、换成传档名，
    // 所以这条用例钉的是**等价性**：不成立就说明换实现顺带改了行为。
    const rows = flattenSections(
      [
        sec(
          'inbox',
          [
            mkTask('first', { createdAt: 1 }),
            mkTask('second', { createdAt: 2 }),
            mkTask('third', { createdAt: 3 }),
          ],
        ),
      ],
      { sort: 'addedAt' },
    );
    expect(rows.slice(1).map((r) => r.key)).toEqual(['third', 'second', 'first']);
  });

  it('分节形态下已完成仍然沉底（不是某一档的可选项）', () => {
    // 这一条在 `sort: 'priority'` 下最容易露馅：已完成那条给个 High 就会顶到最上。
    const rows = flattenSections(
      [
        sec(
          'today',
          [
            mkTask('done-high', { completedAt: 1, priority: Priority.High }),
            mkTask('low', { priority: Priority.Low }),
          ],
        ),
      ],
      { sort: 'priority' },
    );
    expect(rows.slice(1).map((r) => r.key)).toEqual(['low', 'done-high']);
  });

  it('排完不改动分节头：头的 `section` 仍是宿主那一个', () => {
    // 组头的计数与色调读的是 `section`。若实现把排好序的数组写回 section，
    // 头的 meta 就会带着被改过的对象出去（宿主下次渲染拿到不同引用 ⇒ 白重渲染）。
    const tasks = [mkTask('b', { dueDate: 900 }), mkTask('a', { dueDate: 100 })];
    const section = sec('today', tasks, '今天');
    const rows = flattenSections([section], { sort: 'display' });
    const header = rows[0];
    expect(header?.kind === 'header' && header.section).toBe(section);
    expect(section.tasks.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('`keepEmpty` 与 `sort` 同时给：空组仍然留头，不因排序被吃掉', () => {
    const rows = flattenSections([sec('q1', []), sec('q2', [mkTask('a', { dueDate: 1 })])], {
      keepEmpty: true,
      sort: 'display',
    });
    expect(rows.map((r) => r.key)).toEqual(['h-q1', 'h-q2', 'a']);
  });

  it('任务行仍然是 toTaskRow 的产物（fallbackTitle 生效）', () => {
    const rows = flattenSections([sec('today', [mkTask('a', { title: '' })])], {
      fallbackTitle: '（无标题）',
    });
    const taskRow = rows[1];
    expect(taskRow?.kind === 'task' && taskRow.row.title).toBe('（无标题）');
  });
});
