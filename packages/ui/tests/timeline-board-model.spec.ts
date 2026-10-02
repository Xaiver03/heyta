/**
 * `TimelineBoard` 的**纯函数**判据（board-model）
 * ================================================
 *
 * 与 `timeline-model.spec.ts` 同一分层：组件渲染的判据在宿主
 * （`apps/web/tests/timeline-board.spec.tsx`），这里钉数学 ——
 * 全部是「错了不会报错、只会把界面画成谎话」的那一类：
 *
 *   1. **窗口**：本周（周一起）∪ 全部已排期任务；**不截断** —— 截断就是
 *      把真实的截止画丢（R4 判据 5 的反面：可见性）；
 *   2. **位置**：同一窗口内 `percentAt` 单调 —— R4 判据 2 的数学侧
 *      （旧实现里它恒 0，位置不携带任何信息）；
 *   3. **落笔**：全天截止画在**当天正午**（日格中央），不画在日界线上；
 *   4. **刻度**：粒度自适应、数量封顶；日期算术全部走领域层（夏令时不炸）。
 */

import { describe, expect, it } from 'vitest';

import {
  DAY_MS,
  addDays,
  isoWeekday,
  parseLocalDate,
  startOfDay,
  toLocalDate,
  type LocalDate,
  type TimelineBoardRow,
} from '@heyta/domain';

import {
  axisTicksForWindow,
  boardWindow,
  dueText,
  isAllDayMs,
  isOverdue,
  markerMs,
  msAtRegionX,
  moveStartMs,
  percentAt,
  resizeMinutes,
  sortRowsForBoard,
  tickText,
  todayPercent,
  type TimelineBoardLabels,
} from '../src/timeline/board-model.js';

/** 2026-10-01 是周四（isoWeekday === 4）——用固定日期，测试不读时钟。 */
const THU: LocalDate = '2026-10-01';
const MON = addDays(THU, -(isoWeekday(THU) - 1)); // 2026-09-28，本周周一
const NEXT_MON = addDays(MON, 7);

function ms(date: LocalDate, hour = 0): number {
  return parseLocalDate(date).getTime() + hour * 60 * 60 * 1000;
}

function pointRow(taskId: string, atMs: number): TimelineBoardRow {
  return { taskId, title: taskId, position: { kind: 'point', atMs }, aiMinutes: undefined };
}

function unscheduledRow(taskId: string): TimelineBoardRow {
  return { taskId, title: taskId, position: { kind: 'unscheduled' }, aiMinutes: undefined };
}

/** 文案桩：断言只看拼接形状，不关心中英文。 */
const labels: TimelineBoardLabels = {
  empty: 'empty',
  ariaEmpty: 'timeline',
  ariaGroup: (count) => `board ${String(count)}`,
  weekdayNames: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  monthNames: [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ],
  todayWord: 'Today',
  unscheduledLane: (count) => `unscheduled ${String(count)}`,
  aiBadge: (minutes) => `ai ${String(minutes)}`,
  overdue: 'OVERDUE',
  untitledTask: 'untitled',
};

// ─────────────────────────────────────────────────────────────────────────

describe('窗口（boardWindow）', () => {
  it('无任务时就是今天所在的一周（周一起，下周一 0 点为排他端点）', () => {
    const w = boardWindow(THU, []);
    expect(w.startMs).toBe(ms(MON));
    expect(w.endMs).toBe(ms(NEXT_MON));
  });

  it('🔴 更早的截止把窗口向**过去**延伸（逾期必须可见，截断 = 画丢）', () => {
    const w = boardWindow(THU, [pointRow('old', ms('2026-08-10', 15))]);
    expect(w.startMs).toBe(ms('2026-08-10'));
    expect(w.endMs).toBe(ms(NEXT_MON));
  });

  it('🔴 更晚的截止把窗口向**未来**延伸到那一天结束', () => {
    const w = boardWindow(THU, [pointRow('far', ms('2026-11-20', 15))]);
    expect(w.endMs).toBe(ms('2026-11-21'));
  });

  it('🔴 未排期的行**不参与**窗口：有它没它，窗口逐字节相同（它没有时间数据可拉）', () => {
    const withLane = boardWindow(THU, [unscheduledRow('x')]);
    const without = boardWindow(THU, []);
    expect(withLane.startMs).toBe(without.startMs);
    expect(withLane.endMs).toBe(without.endMs);
  });
});

describe('位置（percentAt / todayPercent）—— R4 判据 2 的数学侧', () => {
  const w = boardWindow(THU, []);

  it('🔴 单调：时刻晚 ⇒ 百分比大（差值与时间差同号，且不全为 0）', () => {
    const earlier = percentAt(ms(THU, 14), w);
    const later = percentAt(ms(THU, 16), w);
    expect(later - earlier).toBeGreaterThan(0);
    expect(earlier).toBeGreaterThan(0); // 正向对照：不是"都是 0"也能绿
  });

  it('窗口起点 → 0，排他端点 → 100；窗口外夹紧不越界', () => {
    expect(percentAt(w.startMs, w)).toBe(0);
    expect(percentAt(w.endMs, w)).toBe(100);
    expect(percentAt(w.endMs + 10 * DAY_MS, w)).toBe(100);
    expect(percentAt(w.startMs - 10 * DAY_MS, w)).toBe(0);
  });

  it('今天在窗口内 ⇒ 有值；在窗口外 ⇒ undefined（画出来只会误导）', () => {
    expect(todayPercent(w, ms(THU, 12))).toBeDefined();
    expect(todayPercent(w, ms(NEXT_MON) + DAY_MS)).toBeUndefined();
    expect(todayPercent(w, ms(MON) - DAY_MS)).toBeUndefined();
  });
});

describe('落笔（markerMs / isAllDayMs / isOverdue）', () => {
  it('🔴 全天截止（0 点整）画在**当天正午**，不落在日界线上', () => {
    const allDay = startOfDay(ms(THU));
    expect(isAllDayMs(allDay)).toBe(true);
    expect(markerMs({ kind: 'point', atMs: allDay })).toBe(allDay + DAY_MS / 2);
  });

  it('有时刻的按原时刻落笔（不挪）', () => {
    const at = ms(THU, 15);
    expect(isAllDayMs(at)).toBe(false);
    expect(markerMs({ kind: 'point', atMs: at })).toBe(at);
  });

  it('unscheduled 没有落笔点', () => {
    expect(markerMs({ kind: 'unscheduled' })).toBeUndefined();
  });

  it('逾期：全天看**日**（今天 0 点截止还不算逾期），有时刻看**时刻**', () => {
    const now = ms(THU, 12);
    expect(isOverdue({ kind: 'point', atMs: startOfDay(ms(THU)) }, now)).toBe(false);
    expect(isOverdue({ kind: 'point', atMs: startOfDay(ms(THU)) + 1 }, now)).toBe(true);
    expect(isOverdue({ kind: 'point', atMs: ms(THU, 11) }, now)).toBe(true);
    expect(isOverdue({ kind: 'point', atMs: ms(THU, 15) }, now)).toBe(false);
    expect(isOverdue({ kind: 'unscheduled' }, now)).toBe(false);
  });
});

describe('刻度（axisTicksForWindow）', () => {
  it('一周窗口 → **日**刻度，落在每天 0 点，今天被标出', () => {
    const ticks = axisTicksForWindow(boardWindow(THU, []), THU);
    expect(ticks.every((t) => t.granularity === 'day')).toBe(true);
    // 排他端点不画（下周一 0 点是分母，不是刻度）
    expect(ticks).toHaveLength(7);
    expect(ticks[0]?.atMs).toBe(ms(MON));
    expect(ticks.find((t) => t.isToday)?.atMs).toBe(ms(THU));
  });

  it('🔴 一个半月 → **周**刻度（落在周一），数量封顶', () => {
    const w = boardWindow(THU, [pointRow('far', ms('2026-11-20', 15))]);
    const ticks = axisTicksForWindow(w, THU);
    expect(ticks.every((t) => t.granularity === 'week')).toBe(true);
    for (const tick of ticks) {
      expect(isoWeekday(toLocalDate(tick.atMs))).toBe(1);
    }
  });

  it('🔴 一年以上 → **月**刻度（落在 1 号），且绝不超 MAX 般爆炸', () => {
    const w = boardWindow(THU, [pointRow('far', ms('2028-06-01', 15))]);
    const ticks = axisTicksForWindow(w, THU);
    expect(ticks.every((t) => t.granularity === 'month')).toBe(true);
    expect(ticks.length).toBeLessThanOrEqual(60);
    for (const tick of ticks) {
      expect(new Date(tick.atMs).getDate()).toBe(1);
    }
  });
});

describe('排序（sortRowsForBoard）', () => {
  it('按落笔时刻升序；同刻保持输入序（稳定）', () => {
    const a = pointRow('a', ms(THU, 16));
    const b = pointRow('b', ms(THU, 9));
    const c = pointRow('c', ms(THU, 9));
    const sorted = sortRowsForBoard([a, b, c]);
    expect(sorted.map((row) => row.taskId)).toEqual(['b', 'c', 'a']);
  });
});

describe('文字（dueText / tickText）—— 判据 4 的数据来源', () => {
  const now = ms(THU, 12);

  it('🔴 行头的日期文字来自 dueDate：全天只有日期，有时刻补钟点', () => {
    expect(dueText(ms(THU), now)).not.toContain('15:00');
    expect(dueText(ms(THU, 15), now)).toContain('15:00');
  });

  it('日刻度 = 星期名 + 日期；今天的刻度是「Today + 日期」（周几由"今天"隐含）；紧凑档只留日期', () => {
    const todayTick = { atMs: ms(THU), granularity: 'day' as const, isToday: true };
    const full = tickText(todayTick, labels, false, now);
    expect(full).toContain('Today');
    expect(full).not.toContain('Thu');
    const otherTick = { atMs: ms(MON), granularity: 'day' as const, isToday: false };
    expect(tickText(otherTick, labels, false, now)).toContain('Mon');
    // 紧凑档（窄屏）：只留日期
    expect(tickText(otherTick, labels, true, now)).not.toContain('Mon');
  });

  it('月刻度用月名', () => {
    const tick = { atMs: ms('2026-11-01'), granularity: 'month' as const, isToday: false };
    expect(tickText(tick, labels, false, now)).toBe('Nov');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 拖拽几何（P2）：像素 ↔ 时间。Responder 只是搬运数字，数学全在这里被钉死。
// ─────────────────────────────────────────────────────────────────────────

describe('拖拽几何（msAtRegionX / moveStartMs / resizeMinutes）', () => {
  const w = boardWindow(THU, []);
  const span = w.endMs - w.startMs;
  const REGION_W = 1000;

  it('🔴 行区像素 → 时间：行头列折算进比例，落点夹在窗口内', () => {
    // 行头占 40%：regionX = 400px 恰好是轨道的 0 点
    expect(msAtRegionX(400, REGION_W, w)).toBe(w.startMs);
    // regionX = 1000px（行区右缘）= 轨道 100% = 排他端点
    expect(msAtRegionX(1000, REGION_W, w)).toBe(w.endMs);
    // 越界夹紧（拖出两端不产生窗外坐标）
    expect(msAtRegionX(-50, REGION_W, w)).toBe(w.startMs);
    expect(msAtRegionX(1500, REGION_W, w)).toBe(w.endMs);
  });

  it('🔴 单调：落点靠右 ⇒ 时间更晚（换算错方向会立刻被它抓住）', () => {
    const a = msAtRegionX(500, REGION_W, w);
    const b = msAtRegionX(700, REGION_W, w);
    expect(b - a).toBeGreaterThan(0);
  });

  it('🔴 拖条移动：换算是**除**（px÷pxPerMs=毫秒），整分钟对齐；方向对一周窗口一屏 ≈ 数小时', () => {
    const orig = ms(THU, 9);
    const pxPerMs = REGION_W / span; // 每毫秒的像素数（周视图 ~1e-6）
    const moved = moveStartMs(orig, 10, pxPerMs);
    expect((moved - orig) % 60_000).toBe(0); // 整分钟
    // 一周窗口 600px 轨道：10px ≈ 168 分钟 —— 不是"乘除写反后"的 ≈0
    const minutes = (moved - orig) / 60_000;
    expect(minutes).toBeGreaterThan(60);
    expect(minutes).toBeLessThan(300);
  });

  it('🔴 拖边改时长：夹取到 [5, 480] 整分钟（垃圾像素时长不进 op）', () => {
    expect(resizeMinutes(90, 0, 1e-6)).toBe(90);
    expect(resizeMinutes(3, 0, 1e-6)).toBe(5); // 下限
    expect(resizeMinutes(10_000, 0, 1e-6)).toBe(480); // 上限
    // 1e-6 px/ms ⇒ 1px ≈ 16.7 分钟；3.6px 恰好 60 分钟
    expect(resizeMinutes(60, 3.6, 1e-6)).toBe(120);
    expect(resizeMinutes(60, 1.8, 1e-6)).toBe(90);
    expect((resizeMinutes(60, 3.6, 1e-6) * 10) % 10).toBe(0); // 整数分钟
  });
});
