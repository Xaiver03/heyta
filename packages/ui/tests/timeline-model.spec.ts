/**
 * 共享时间线的**纯函数**判据
 * ==============================
 *
 * 共享层只放纯函数与组件；组件渲染的判据在**宿主**（`apps/web` 渲染共享组件、
 * `apps/mobile` 真模拟器），与仓库既有约定一致（`packages/ui/tests/*-model.spec.ts`）。
 *
 * 这里钉的是三件最容易错、且错了不会报错的事：
 *   1. **单位**：`90 分钟` / `1 小时 30 分` 的换算与"0 也是有效值"；
 *   2. **日界**：跨天分隔带必须落在**真实午夜**上，而不是每 1440 分钟切一刀；
 *   3. **尺度**：`chartSpan` 只放宽不截断，且空数组不会除零。
 */

import { describe, expect, it } from 'vitest';

import type { TimelineEntry } from '@heyta/domain';

import {
  MINUTES_PER_DAY,
  MULTI_DAY_THRESHOLD_MINUTES,
  axisTicks,
  chartSpan,
  dayBands,
  formatClock,
  formatDuration,
  formatRange,
  formatRelativeRange,
  indexByTitle,
  normalizeClock,
  safeLocalDate,
  todayWindow,
  type GanttLabels,
} from '../src/timeline/model.js';

/** 文案桩：单位用缩写，断言因此不必关心中英文案。 */
const labels: GanttLabels = {
  title: 'Timeline',
  empty: 'empty',
  minutes: (count) => `${String(count)}m`,
  hours: (count) => `${String(count)}h`,
  hoursMinutes: (hours, minutes) => `${String(hours)}h${String(minutes)}m`,
  day: (day) => `D${String(day)}`,
  span: (count, total) => `${String(count)}/${total}`,
  rangeFrom: (when) => `from ${when}`,
  today: (day) => `today${String(day)}`,
  unestimated: (count, duration) => `${String(count)} unest ${duration}`,
  aiSummary: (count) => `${String(count)} ai`,
  durationDefault: (duration) => `def ${duration}`,
  durationAi: (duration) => `ai ${duration}`,
  durationManual: (duration) => `man ${duration}`,
  dependsOn: (title) => `dep ${title}`,
  overlap: 'overlap',
  ariaGroup: (count, total) => `${String(count)} ${total}`,
};

const TODAY = '2026-09-28';
const NOW = new Date(2026, 8, 28, 12, 0, 0).getTime();

describe('formatDuration：单位换算', () => {
  it('不足一小时说分钟，整小时说小时，其余说 x 小时 y 分', () => {
    expect(formatDuration(0, labels)).toBe('0m');
    expect(formatDuration(59, labels)).toBe('59m');
    expect(formatDuration(60, labels)).toBe('1h');
    expect(formatDuration(90, labels)).toBe('1h30m');
    expect(formatDuration(480, labels)).toBe('8h');
  });
});

describe('safeLocalDate：坏日期当作没给，而不是把整块视图炸掉', () => {
  it('undefined 原样返回；合法日期返回自身', () => {
    expect(safeLocalDate(undefined)).toBeUndefined();
    expect(safeLocalDate(TODAY)).toBe(TODAY);
  });

  it('🔴 越界日期（2 月 30 日 / 13 月）返回 undefined —— parseLocalDate 会抛', () => {
    expect(safeLocalDate('2026-02-30')).toBeUndefined();
    expect(safeLocalDate('2026-13-01')).toBeUndefined();
  });
});

describe('normalizeClock：把起始钟点夹进 [0, 1439]', () => {
  it('负数 / NaN / 越界都落回合法值', () => {
    expect(normalizeClock(undefined)).toBe(0);
    expect(normalizeClock(-5)).toBe(0);
    expect(normalizeClock(Number.NaN)).toBe(0);
    expect(normalizeClock(570)).toBe(570);
    expect(normalizeClock(MINUTES_PER_DAY)).toBe(MINUTES_PER_DAY - 1);
  });
});

describe('formatClock：当天第几分钟 → HH:MM，且绕回一天之内', () => {
  it('常规与跨日', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(570)).toBe('9:30');
    expect(formatClock(1380)).toBe('23:00');
    // 24:00 绕回 0:00；负值也绕回。
    expect(formatClock(MINUTES_PER_DAY)).toBe('0:00');
    expect(formatClock(-30)).toBe('23:30');
  });
});

describe('formatRange：给了起始日才有绝对日期', () => {
  it('同一天：只写一次日期', () => {
    const text = formatRange(TODAY, 0, 0, 90, NOW);
    expect(text).toMatch(/09-28 0:00 → 1:30/);
  });

  it('跨天：两侧都写日期', () => {
    const text = formatRange(TODAY, 0, 0, MINUTES_PER_DAY, NOW);
    expect(text).toMatch(/09-28 0:00 → 09-29 0:00/);
  });

  it('计划从 9:30 开始时，第一天只到当天午夜', () => {
    const text = formatRange(TODAY, 570, 0, 60, NOW);
    expect(text).toMatch(/09-28 9:30 → 10:30/);
  });
});

describe('formatRelativeRange：没有起始日时用相对偏移', () => {
  it('两侧都是人话', () => {
    expect(formatRelativeRange(0, 90, labels)).toBe('0m → 1h30m');
  });
});

describe('indexByTitle：依赖按 title 引用', () => {
  it('同名后者覆盖前者（与 buildTimeline 的去重口径一致）', () => {
    const a: TimelineEntry = { title: 'A', startOffsetMinutes: 0, durationMinutes: 30, durationSource: 'manual' };
    const b: TimelineEntry = { title: 'A', startOffsetMinutes: 60, durationMinutes: 30, durationSource: 'manual' };
    const map = indexByTitle([a, b]);
    expect(map.get('A')).toBe(b);
  });
});

describe('dayBands：跨天分隔带落在**真实午夜**上', () => {
  it('从 9:30 开始时，第一天只有 14.5 小时', () => {
    const bands = dayBands(MINUTES_PER_DAY, 570);
    expect(bands[0]?.start).toBe(0);
    expect(bands[0]?.end).toBe(MINUTES_PER_DAY - 570);
    expect(bands[1]?.dayIndex).toBe(2);
  });

  it('从午夜开始时，每段恰好一天', () => {
    const bands = dayBands(MINUTES_PER_DAY * 2, 0);
    expect(bands.map((b) => b.end - b.start)).toEqual([MINUTES_PER_DAY, MINUTES_PER_DAY]);
  });
});

describe('axisTicks：按跨度选步长', () => {
  it('短跨度 30 分钟一格，6 小时以内 60，更长 120', () => {
    expect(axisTicks(120, 0, false, labels).map((t) => t.offset)).toEqual([0, 30, 60, 90, 120]);
    expect(axisTicks(240, 0, false, labels).map((t) => t.offset)).toEqual([0, 60, 120, 180, 240]);
    expect(axisTicks(8 * 60, 0, false, labels).map((t) => t.offset)).toEqual([
      0, 120, 240, 360, 480,
    ]);
  });

  it('给了起始日就显示真实钟点，否则显示相对人话', () => {
    expect(axisTicks(60, 570, true, labels)[0]?.label).toBe('9:30');
    expect(axisTicks(60, 0, false, labels)[0]?.label).toBe('0m');
  });
});

describe('chartSpan：只放宽不截断，且空数组不除零', () => {
  const entry = (start: number, duration: number): TimelineEntry => ({
    title: `t${String(start)}`,
    startOffsetMinutes: start,
    durationMinutes: duration,
    durationSource: 'manual',
  });

  it('空数组落到最短工期（否则百分比会除零）', () => {
    expect(chartSpan([])).toBeGreaterThan(0);
  });

  it('spanMinutes 更大时取它（多图对齐）', () => {
    expect(chartSpan([entry(0, 30)], 240)).toBe(240);
  });

  it('🔴 本图比 spanMinutes 更长时**取本图** —— 否则条会溢出容器', () => {
    expect(chartSpan([entry(0, 600)], 240)).toBe(600);
  });
});

describe('todayWindow：与计划区间相交才画今天', () => {
  it('没给日期就是 undefined', () => {
    expect(todayWindow(undefined, TODAY, 0)).toBeUndefined();
    expect(todayWindow(TODAY, undefined, 0)).toBeUndefined();
  });

  it('🔴 计划从今天 9:30 开始时，今天那一天的起点是**负数**（仍应与区间相交）', () => {
    expect(todayWindow(TODAY, TODAY, 570)).toBe(-570);
  });

  it('日期差 × 一天，再减去起始钟点', () => {
    expect(todayWindow('2026-09-27', TODAY, 0)).toBe(MINUTES_PER_DAY);
  });
});

describe('MULTI_DAY_THRESHOLD_MINUTES：12 小时是跨天的分界', () => {
  it('阈值本身不跨天，超过才跨', () => {
    expect(MULTI_DAY_THRESHOLD_MINUTES).toBe(720);
  });
});
