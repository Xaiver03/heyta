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

import { stepCalendarCursor } from '../src/calendar/model.js';

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
