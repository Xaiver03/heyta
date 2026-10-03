/**
 * 日历档位的**游标算术**（R11 批三）
 * ===================================
 *
 * `stepCalendarCursor` 回答的是那件在三个地方被问到的事：
 * 「`>` / 滚一格之后，我在看哪一段」。三个消费者 ——
 * 共享工具栏的两个箭头、Web 页头那份、Web 的滚轮手势 —— 必须给同一个答案。
 *
 * 🔴 这一层为什么值得单独钉：它的失效形状**不是崩溃**，是
 *   "点箭头翻一周、滚轮翻一月"（两边各自都自洽）。
 *   而周视图只画一行，翻错档位时界面仍然像个日历。
 */

import { isoWeekday } from '@heyta/domain';
import { describe, expect, it } from 'vitest';

import {
  CALENDAR_VIEW_LABEL_KEYS,
  CALENDAR_VIEW_ORDER,
  calendarCursorFor,
  calendarSelectedForCursor,
  stepCalendarCursor,
} from '../src/calendar/model.js';

/**
 * 「有哪些档」与「每档叫什么」现在只有一份（R17）。
 *
 * 🔴 这两条判据要抓的**不是**"顺序写错了"，而是那件界面上完全看不见的坏：
 *   web 的下拉与移动端的切换器原来各写一份表，加一档要人记着改两处 ——
 *   R13 那年就是这么过去的。合起来之后仍然有两种失配：
 *   ① 顺序表与键表**集合不同**（顺序里多一档 ⇒ 界面画出一个 `t(undefined)` 的空标签；
 *     键表里多一档 ⇒ 那一档谁也切不过去）；
 *   ② 宿主里**又长回一份本地表**（那由 `apps/web/tests/calendar-view-tabs.spec.tsx`
 *     的反抄件腿守，那里能看到宿主源码与两本词条表）。
 * ⚠️ 两条都从共享那两份事实**自己推导**，不在测试里再抄一遍四档字面量 —— 抄了就成第三份。
 */
describe('档位表的单一事实源（`CALENDAR_VIEW_ORDER` / `CALENDAR_VIEW_LABEL_KEYS`）', () => {
  it('🔴 顺序表与键表的集合**互为子集**（谁多谁少都红）', () => {
    const keyed = Object.keys(CALENDAR_VIEW_LABEL_KEYS);
    expect([...CALENDAR_VIEW_ORDER].sort()).toEqual([...keyed].sort());
  });

  it('顺序里没有重复项，也没有空档（重复会让 `<select>` 出两个同值 option）', () => {
    expect(new Set(CALENDAR_VIEW_ORDER).size).toBe(CALENDAR_VIEW_ORDER.length);
    expect(CALENDAR_VIEW_ORDER.length).toBeGreaterThan(0);
  });

  it('🔴 「时间线」**不是**一档：顺序表与键表里都不许出现它', () => {
    // 它是外壳的另一个视图（web 走 `goToView` 分叉、移动端另有一张屏）。
    // 混进来就是"同一个视图两个入口、两份当前态"，而那两头的 store 都不认它。
    expect(CALENDAR_VIEW_ORDER).not.toContain('timeline');
    expect(Object.keys(CALENDAR_VIEW_LABEL_KEYS)).not.toContain('timeline');
  });

  it('每一档的键都指向档位那一族（防止把 `…view.aria` 那种组标签当成档名）', () => {
    for (const [kind, key] of Object.entries(CALENDAR_VIEW_LABEL_KEYS)) {
      expect(key).toBe(`common.calendar.view.${kind}`);
    }
  });

  it('每一档都能被游标算术回答（**"真的能用"的最小可证形式**）', () => {
    // `stepCalendarCursor` 的 default 那一支是"按月走"，所以"这一档存在但没人实现"
    // 在算术上是安静的：翻一格画面没换、标题也没换。这里要求每档都给出**该档自己的**
    // 段长证据 —— 年档漏写 `case` 时它会变成"加一个月"，那条正是 R13 的变异臂抓过的一支。
    expect(stepCalendarCursor('year', '2026-01-15', 1)).toBe('2027-01-15');
    expect(stepCalendarCursor('day', '2026-01-15', 1)).toBe('2026-01-16');
    expect(stepCalendarCursor('week', '2026-01-15', 1)).toBe('2026-01-22');
    expect(stepCalendarCursor('month', '2026-01-15', 1)).toBe('2026-02-15');
    // 每一档都要有"游标放哪"的答案，且落在自己那一档的语义上。
    expect(calendarCursorFor('month', '2026-10-17')).toBe('2026-10-01');
    for (const kind of CALENDAR_VIEW_ORDER) {
      expect(typeof calendarCursorFor(kind, '2026-10-17')).toBe('string');
    }
  });
});

describe('stepCalendarCursor', () => {
  it('月档：一段 = 一个**自然月**（10-03 → 11-03，不是 +31 天）', () => {
    expect(stepCalendarCursor('month', '2026-10-03', 1)).toBe('2026-11-03');
    expect(stepCalendarCursor('month', '2026-10-03', -1)).toBe('2026-09-03');
    // 月末那条最容易错成"加 30 天"：1-31 加一个月在 JS 的 Date 里会溢出到 3 月，
    // 领域层的 `addMonths` 刻意夹到月末 —— 这里钉的是"档位没绕过它自己算"。
    expect(stepCalendarCursor('month', '2026-01-31', 1)).toBe('2026-02-28');
  });

  it('周档：一段 = **整整 7 天**，且落在同一个星期几上', () => {
    expect(stepCalendarCursor('week', '2026-10-03', 1)).toBe('2026-10-10');
    expect(stepCalendarCursor('week', '2026-10-03', -1)).toBe('2026-09-26');
    expect(stepCalendarCursor('week', '2026-10-03', 4)).toBe('2026-10-31');
    // 同星期几：周视图的游标永远指在同一列上，否则"翻一周"会顺手换一天。
    expect(isoWeekday(stepCalendarCursor('week', '2026-10-03', 3))).toBe(isoWeekday('2026-10-03'));
  });

  it('🔴 跨月与跨年那一周：走 7 天就是走 7 天，不"进位到下一月"', () => {
    expect(stepCalendarCursor('week', '2026-10-31', 1)).toBe('2026-11-07');
    expect(stepCalendarCursor('week', '2026-12-29', 1)).toBe('2027-01-05');
  });

  it('0 段 = 原地不动（两档都是）—— 防止"step 传 0 也 ±1"的写法', () => {
    expect(stepCalendarCursor('month', '2026-10-03', 0)).toBe('2026-10-03');
    expect(stepCalendarCursor('week', '2026-10-03', 0)).toBe('2026-10-03');
  });

});

describe('游标放哪（`calendarCursorFor`）', () => {
  // 🔴 这条规则原来在 `apps/web` 的 store 里有一份、共享板的 `pickDay` 里有一份。
  //    移动端补上档位入口就是"第三份"的时刻 —— 现在两端都从这里取。
  it('月档：归到**那个月的 1 号**（游标是"该月里任意一天"的表示，归一化才不跳月）', () => {
    expect(calendarCursorFor('month', '2026-10-17')).toBe('2026-10-01');
    // 幂等：已经是月首时不许再动（工具的 `›` 走的就是这条）。
    expect(calendarCursorFor('month', calendarCursorFor('month', '2026-10-17'))).toBe('2026-10-01');
  });

  it('周档与日档：**就是那一天本身**（归到月初会把画面跳走）', () => {
    expect(calendarCursorFor('week', '2026-10-17')).toBe('2026-10-17');
    expect(calendarCursorFor('day', '2026-10-17')).toBe('2026-10-17');
    // 跨月边界尤其不许"顺手进位到月初"。
    expect(calendarCursorFor('day', '2026-10-31')).toBe('2026-10-31');
  });
});

describe('选中跟不跟着游标走（`calendarSelectedForCursor`）', () => {
  it('🔴 日档：游标一动，选中的那天必须一起动（否则轴与侧栏高亮各指一天，且没人报错）', () => {
    expect(calendarSelectedForCursor('day', '2026-10-05', '2026-10-03')).toBe('2026-10-05');
  });

  it('🔴 月档与周档：**不许**跟着动（点一次箭头就把用户要写任务的那天换掉，是另一件事）', () => {
    expect(calendarSelectedForCursor('month', '2026-11-01', '2026-10-03')).toBe('2026-10-03');
    expect(calendarSelectedForCursor('week', '2026-10-10', '2026-10-03')).toBe('2026-10-03');
  });
});
