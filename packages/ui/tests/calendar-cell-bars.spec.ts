/**
 * 月格任务条的**分条与折叠**（跑在 node，不 render 组件）
 * ======================================================
 *
 * R11 批一（产品负责人 2026-10-02 对标滴答）把月格从"最多 3 个圆点"改成
 * "最多 3 条任务条 + `+N`"。这里钉的是 `calendarCellBars` 的四条判断：
 *
 *   1. **可见条数封顶、`hidden` 从数据算**（不是界面回头数 DOM）；
 *   2. **顺序**：未做的在前、已做的沉到最后；
 *   3. **已完成不算逾期**（给做完的事标红是噪音）；
 *   4. 条上带的是**标题本身** —— 这条是整个改造的立论：格子里必须有一个字可读。
 *
 * 🔴 为什么"没有一条被裁一半"不在这里测：jsdom 里所有 rect 都是 0，
 * 那种几何判据**只能在真浏览器里量**（见 `e2e/tests/calendar-cells.spec.ts`）。
 * 在这一层写"高度足够"会得到一条永远通过的判据 —— 比没有判据更糟。
 */

import { describe, expect, it } from 'vitest';
import type { Task } from '@heyta/domain';

import { calendarCellBars, MAX_CALENDAR_BARS, MAX_WEEK_CALENDAR_BARS } from '../src/calendar/model.js';

function task(over: Partial<Task> & { id: string }): Task {
  return { title: over.id, createdAt: 0, updatedAt: 0, ...over };
}

const TODAY = '2026-10-03';
const PAST = '2026-10-01';
const FUTURE = '2026-10-08';
/** 一个"做完了"的时间戳：`done` 只看 `completedAt` 存不存在，不看它是哪天。 */
const COMPLETED_AT = new Date(2026, 9, 1).getTime();

describe('月格任务条：封顶与折叠', () => {
  it('恰好到上限：全部可见，hidden 为 0（界面上就不会出现「+0」）', () => {
    const tasks = Array.from({ length: MAX_CALENDAR_BARS }, (_, i) =>
      task({ id: `t${String(i)}` }),
    );
    const { bars, hidden } = calendarCellBars(tasks, TODAY, FUTURE);
    expect(bars).toHaveLength(MAX_CALENDAR_BARS);
    expect(hidden).toBe(0);
  });

  it('🔴 超出上限：可见条封顶，hidden = 总数 − 可见数（那个差是从数据算的）', () => {
    const total = MAX_CALENDAR_BARS + 2;
    const tasks = Array.from({ length: total }, (_, i) => task({ id: `t${String(i)}` }));
    const { bars, hidden } = calendarCellBars(tasks, TODAY, FUTURE);
    expect(bars).toHaveLength(MAX_CALENDAR_BARS);
    expect(hidden).toBe(total - MAX_CALENDAR_BARS);
    // 一条都不许凭空消失：可见 + 折叠 == 总数。
    expect(bars.length + hidden).toBe(total);
  });

  it('这一天没有任务：空数组、hidden 0 —— 格子照样要在（月历的价值是整月同时在场）', () => {
    const { bars, hidden } = calendarCellBars([], TODAY, FUTURE);
    expect(bars).toEqual([]);
    expect(hidden).toBe(0);
  });

  it('上限可以由宿主改小（窄屏要更少行），折叠量跟着重算', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' })];
    const { bars, hidden } = calendarCellBars(tasks, TODAY, FUTURE, 1);
    expect(bars).toHaveLength(1);
    expect(hidden).toBe(2);
  });

  it('上限给 0 或负数不会崩：只是全折起来（hidden 等于总数）', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' })];
    const { bars, hidden } = calendarCellBars(tasks, TODAY, FUTURE, 0);
    expect(bars).toEqual([]);
    expect(hidden).toBe(2);
  });
});

describe('月格任务条：哪条看得见（顺序是产品语义）', () => {
  /**
   * 🔴 `overdue` 是"这一格在过去"这个**格子级**事实（同一格里每条未完成任务一起逾期），
   * 所以格内比较真正起作用的只有"未做 / 已做"两档。写清这一点是为了下一个读的人
   * 不去找第三档 —— 它在数据上不存在。
   */
  it('格子只放得下 1 条时，留下的必须是还没做的', () => {
    const { bars } = calendarCellBars(
      [task({ id: 'done', completedAt: COMPLETED_AT }), task({ id: 'todo' })],
      TODAY,
      PAST,
      1,
    );
    expect(bars.map((b) => b.id)).toEqual(['todo']);
  });

  it('🔴 已完成排在最后（但不消失）：格子装得下时它照样在场', () => {
    const { bars } = calendarCellBars(
      [task({ id: 'done', completedAt: COMPLETED_AT }), task({ id: 'todo' })],
      TODAY,
      FUTURE,
    );
    expect(bars.map((b) => b.id)).toEqual(['todo', 'done']);
  });

  it('同等级的多条不因排序而丢：输入顺序原样保留', () => {
    const tasks = [task({ id: 'x' }), task({ id: 'y' }), task({ id: 'z' })];
    expect(calendarCellBars(tasks, TODAY, FUTURE).bars.map((b) => b.id)).toEqual(['x', 'y', 'z']);
  });

  it('折叠掉的是**尾部**（等级最低的那几条），不是头部', () => {
    const { bars, hidden } = calendarCellBars(
      [
        task({ id: 'todo-1' }),
        task({ id: 'todo-2' }),
        task({ id: 'done-1', completedAt: COMPLETED_AT }),
        task({ id: 'done-2', completedAt: COMPLETED_AT }),
      ],
      TODAY,
      FUTURE,
      2,
    );
    expect(bars.map((b) => b.id)).toEqual(['todo-1', 'todo-2']);
    expect(hidden).toBe(2);
  });
});

describe('月格任务条：条上的两个状态', () => {
  it('🔴 每条都带标题 —— 这次改造的立论就是"格子里必须有一个字可读"', () => {
    const { bars } = calendarCellBars([task({ id: 'rev', title: '评审登录页' })], TODAY, FUTURE);
    expect(bars[0]?.title).toBe('评审登录页');
    expect(bars.every((b) => b.title.trim() !== '')).toBe(true);
  });

  it('过去那天的每条**未做完**的任务都标逾期', () => {
    const { bars } = calendarCellBars([task({ id: 'a' }), task({ id: 'b' })], TODAY, PAST);
    expect(bars.every((b) => b.overdue)).toBe(true);
    expect(bars.every((b) => !b.done)).toBe(true);
  });

  it('已完成的逾期任务**不标红**：红色在这个界面里只表示"要注意"', () => {
    const { bars } = calendarCellBars(
      [task({ id: 'a', dueDate: new Date(2026, 8, 20).getTime(), completedAt: COMPLETED_AT })],
      TODAY,
      PAST,
    );
    expect(bars[0]?.done).toBe(true);
    expect(bars[0]?.overdue).toBe(false);
  });

  it('今天与未来的日子都不算逾期', () => {
    expect(calendarCellBars([task({ id: 'a' })], TODAY, TODAY).bars[0]?.overdue).toBe(false);
    expect(calendarCellBars([task({ id: 'a' })], TODAY, FUTURE).bars[0]?.overdue).toBe(false);
  });
});


describe('两个档位的上限之间的关系（R11 批三）', () => {
  it('🔴 周档上限必须**严格大于**月档 —— 否则"切到周视图"什么都没换来', () => {
    // 这条看起来像废话，它是 e2e 那条"画满了上限"的**唯一非恒真来源**：
    // e2e 里 `drawn === 周档上限` 两边都从同一份源码读，把上限改回 3 它照样绿
    // （变异臂 H 实测存活过一次）。真正有牙齿的是"两档不相等且周档更大"。
    expect(MAX_WEEK_CALENDAR_BARS).toBeGreaterThan(MAX_CALENDAR_BARS);
  });
});
