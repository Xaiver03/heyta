/**
 * 甘特图组件测试
 * =================
 *
 * 🔴 本文件最重要的三组：
 *
 *   1. 🔴🔴 **条的宽度必须看得出差别** —— 90 分钟的条要比 30 分钟的**明显宽**
 *      （3 倍）。这是这次改动的验收点：如果给条设了一个"看起来还行"的最小宽度，
 *      短条会被抬到同一宽度，时间线唯一要表达的东西就没了。
 *   2. 🔴 **不许只用颜色表达信息** —— 工期、依赖、"未估时"都必须是**文字**，
 *      彩色条只是装饰（`aria-hidden`）。色觉障碍用户读不到颜色。
 *   3. 🔴 **空态要有一句人话**，并告诉用户下一步去哪做。
 *
 * ⚠️ 组件是**纯展示**的：这里不 mock fetch，也没有 routing/consents ——
 * 一旦需要它们，就说明 AI 又漏进可视化层了（`ai-architecture.md` §14 第 20 条）。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTimeline, type TimelineEntry } from '../src/features/timeline/buildTimeline.js';
import { GanttChart } from '../src/features/timeline/GanttChart.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(props: Parameters<typeof GanttChart>[0]): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<GanttChart {...props} />);
  });
  return container;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

/** 一份真实排出来的计划（走 `buildTimeline`，不是手写的假数据）。 */
function threeEntries(): TimelineEntry[] {
  return [
    ...buildTimeline([{ title: '灰度' }, { title: '全量' }, { title: '复盘' }], {
      durationsInMinutes: { 灰度: 120, 全量: 180 },
    }).entries,
  ];
}

/** 读一条 bar 的宽度百分比（`style.width` 形如 `"33.33%"`）。 */
function barWidthPercent(el: HTMLElement, index: number): number {
  const bar = el.querySelector(`[data-testid="gantt-bar-${String(index)}"]`) as HTMLElement;
  return Number.parseFloat(bar.style.width);
}

// ─────────────────────────────────────────────────────────────────────────

describe('渲染条目', () => {
  it('渲染 N 条，行序与输入一致', () => {
    const el = render({ entries: threeEntries() });

    expect(el.querySelector('[data-testid="gantt-chart"]')).toBeTruthy();
    expect(el.querySelectorAll('[data-testid^="gantt-row-"]')).toHaveLength(3);
    expect(el.querySelector('[data-testid="gantt-title-0"]')?.textContent).toBe('灰度');
    expect(el.querySelector('[data-testid="gantt-title-1"]')?.textContent).toBe('全量');
    expect(el.querySelector('[data-testid="gantt-title-2"]')?.textContent).toBe('复盘');
  });

  it('表头写出总条数与总时长', () => {
    const el = render({ entries: threeEntries() });
    // 灰度 120 + 全量 180 + 复盘 60（未估时默认）= 360 分钟 = 6 小时
    expect(el.querySelector('[data-testid="gantt-span"]')?.textContent).toContain('3 条');
    expect(el.querySelector('[data-testid="gantt-span"]')?.textContent).toContain('6 小时');
  });

  it('时间条的横向位置反映偏移与工期', () => {
    const entries: TimelineEntry[] = [
      { title: 'A', startOffsetMinutes: 0, durationMinutes: 60, durationSource: 'provided' },
      { title: 'B', startOffsetMinutes: 60, durationMinutes: 60, durationSource: 'provided' },
    ];
    const el = render({ entries });

    const first = el.querySelector('[data-testid="gantt-bar-0"]') as HTMLElement;
    const second = el.querySelector('[data-testid="gantt-bar-1"]') as HTMLElement;
    expect(first.style.left).toBe('0%');
    expect(first.style.width).toBe('50%');
    expect(second.style.left).toBe('50%');
    expect(second.style.width).toBe('50%');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴🔴 验收点：宽度必须看得出差别
// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 90 分钟的条必须比 30 分钟的明显宽', () => {
  /** 30 分钟与 90 分钟并行起步 → 总跨度 90 分钟。 */
  const entries: TimelineEntry[] = [
    { title: '短的', startOffsetMinutes: 0, durationMinutes: 30, durationSource: 'provided' },
    { title: '长的', startOffsetMinutes: 0, durationMinutes: 90, durationSource: 'provided' },
  ];

  it('🔴 宽度比是 3:1（30 分钟 : 90 分钟）', () => {
    const el = render({ entries });
    const short = barWidthPercent(el, 0);
    const long = barWidthPercent(el, 1);

    expect(long).toBeGreaterThan(short);
    expect(long / short).toBeCloseTo(3, 5);
  });

  it('🔴 差距是肉眼可分辨的量级（不是几个百分点）', () => {
    const el = render({ entries });
    const short = barWidthPercent(el, 0);
    const long = barWidthPercent(el, 1);

    // 跨度 90 分钟：短条 33.3%、长条 100%，相差 66.7 个百分点。
    expect(long - short).toBeGreaterThan(50);
    expect(long).toBeCloseTo(100, 5);
    expect(short).toBeCloseTo(100 / 3, 3);
  });

  it('🔴 90 / 30 的差别不是靠一个"最小宽度"撑出来的', () => {
    const el = render({ entries });
    const short = el.querySelector('[data-testid="gantt-bar-0"]') as HTMLElement;
    const long = el.querySelector('[data-testid="gantt-bar-1"]') as HTMLElement;

    // 兜底宽度只能是**发丝线**（`border-width.thin` 这个 token）。
    // 若有人把它换成一个像样的最小宽度，短条会被抬起来，这条测试会红。
    expect(short.style.minWidth).toBe('var(--ht-border-width-thin)');
    expect(long.style.minWidth).toBe(short.style.minWidth);
    // 而且两条的宽度确实不同 —— 说明没有一起被下限抬平。
    expect(long.style.width).not.toBe(short.style.width);
  });

  it('🔴 走过真实排程（buildTimeline）之后差别依然存在', () => {
    // 不只手写数据：真实链路（清单 + 估时 → 排程 → 渲染）也要成立。
    const plan = buildTimeline([{ title: '写文案' }, { title: '做设计' }], {
      durationsInMinutes: { 写文案: 30, 做设计: 90 },
    });
    const el = render({ entries: [...plan.entries] });

    const byTitle = plan.entries.map((e) => e.title);
    const shortIndex = byTitle.indexOf('写文案');
    const longIndex = byTitle.indexOf('做设计');
    expect(barWidthPercent(el, longIndex) / barWidthPercent(el, shortIndex)).toBeCloseTo(3, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('空态', () => {
  it('🔴 空数组 → 一句人话，而且没有行', () => {
    const el = render({ entries: [] });
    const empty = el.querySelector('[data-testid="gantt-empty"]');
    expect(empty).toBeTruthy();
    expect((empty?.textContent ?? '').length).toBeGreaterThan(10);
    // 告诉用户下一步去哪做，而不是只说"暂无数据"
    expect(empty?.textContent).toContain('备注');
    expect(el.querySelectorAll('[data-testid^="gantt-row-"]')).toHaveLength(0);
  });

  it('空态文案可覆盖', () => {
    const el = render({ entries: [], emptyHint: '还没有条目。' });
    expect(el.querySelector('[data-testid="gantt-empty"]')?.textContent).toBe('还没有条目。');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴🔴 不依赖颜色
// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 信息不能只靠颜色', () => {
  it('🔴 工期是文字', () => {
    const el = render({ entries: threeEntries() });
    expect(el.querySelector('[data-testid="gantt-duration-0"]')?.textContent).toContain('约 2 小时');
    expect(el.querySelector('[data-testid="gantt-duration-1"]')?.textContent).toContain(
      '约 3 小时',
    );
  });

  it('🔴 未估时的条目明说「未估时」，不说成一个确切的工期', () => {
    const el = render({ entries: threeEntries() });
    const text = el.querySelector('[data-testid="gantt-duration-2"]')?.textContent ?? '';
    expect(text).toContain('未估时');
    // 默认值是 1 小时（不是 1 天）
    expect(text).toContain('按 1 小时排');
    // 表头也如实汇总
    expect(el.querySelector('[data-testid="gantt-unestimated-summary"]')?.textContent).toContain(
      '1 条未估时',
    );
  });

  it('🔴 依赖关系是文字，不是箭头颜色', () => {
    const entries = [
      ...buildTimeline([{ title: '灰度' }, { title: '全量', dependsOn: '灰度' }], {
        durationsInMinutes: { 灰度: 120, 全量: 60 },
      }).entries,
    ];
    const el = render({ entries });
    expect(el.querySelector('[data-testid="gantt-dep-1"]')?.textContent).toContain('依赖：灰度');
  });

  it('🔴 彩色时间条本身是装饰（aria-hidden），屏幕阅读器读到的是文字', () => {
    const el = render({ entries: threeEntries() });
    const bar = el.querySelector('[data-testid="gantt-bar-0"]');
    expect(bar?.parentElement?.getAttribute('aria-hidden')).toBe('true');
  });

  it('🔴 容器有可读的 aria-label（条数与总时长）', () => {
    const el = render({ entries: threeEntries() });
    const label = el.querySelector('[data-testid="gantt-chart"]')?.getAttribute('aria-label') ?? '';
    expect(label).toContain('时间线');
    expect(label).toContain('3 条');
    expect(label).toContain('6 小时');
  });

  it('🔴 每一行的文字里都能读到标题与工期（不依赖任何颜色）', () => {
    const el = render({ entries: threeEntries() });
    for (const [index, title] of ['灰度', '全量', '复盘'].entries()) {
      const row = el.querySelector(`[data-testid="gantt-row-${String(index)}"]`);
      const text = row?.textContent ?? '';
      expect(text).toContain(title);
      expect(text).toMatch(/小时|分钟/);
    }
  });

  it('依赖被违反时给出文字警告（不只是一条错位的色块）', () => {
    const entries: TimelineEntry[] = [
      { title: '前置', startOffsetMinutes: 0, durationMinutes: 180, durationSource: 'provided' },
      {
        title: '后继',
        startOffsetMinutes: 60,
        durationMinutes: 60,
        dependsOn: '前置',
        durationSource: 'provided',
      },
    ];
    const el = render({ entries });
    expect(el.querySelector('[data-testid="gantt-overlap-1"]')?.textContent).toContain('重叠');
  });

  it('正常的排期不出现重叠警告', () => {
    const entries = [
      ...buildTimeline([{ title: '前置' }, { title: '后继', dependsOn: '前置' }], {
        durationsInMinutes: { 前置: 120, 后继: 60 },
      }).entries,
    ];
    const el = render({ entries });
    expect(el.querySelector('[data-testid="gantt-overlap-1"]')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴 轴：自适应（钟点 vs 跨天）
// ─────────────────────────────────────────────────────────────────────────

describe('🔴 轴自适应', () => {
  it('🔴 跨度在一天内 → 按钟点画刻度（9:30 / 10:30 …）', () => {
    const entries: TimelineEntry[] = [
      { title: 'A', startOffsetMinutes: 0, durationMinutes: 120, durationSource: 'provided' },
      { title: 'B', startOffsetMinutes: 120, durationMinutes: 120, durationSource: 'provided' },
    ];
    const el = render({
      entries,
      startDate: '2026-09-26',
      startTimeMinutes: 570, // 9:30
      now: Date.parse('2026-09-26'),
    });

    // 跨度 240 分钟 → 每 60 分钟一格
    expect(el.querySelector('[data-testid="gantt-tick-570"]')?.textContent).toBe('9:30');
    expect(el.querySelector('[data-testid="gantt-tick-630"]')?.textContent).toBe('10:30');
    expect(el.querySelector('[data-testid="gantt-tick-810"]')?.textContent).toBe('13:30');
    // 一天内不该出现"第 N 天"的分隔带
    expect(el.querySelector('[data-testid="gantt-day-1"]')).toBeNull();
  });

  it('🔴 没有起始日时，刻度退化成相对偏移（不硬编一个钟点）', () => {
    const entries: TimelineEntry[] = [
      { title: 'A', startOffsetMinutes: 0, durationMinutes: 240, durationSource: 'provided' },
    ];
    const el = render({ entries });
    expect(el.querySelector('[data-testid="gantt-tick-0"]')?.textContent).toBe('0 分钟');
    expect(el.querySelector('[data-testid="gantt-tick-60"]')?.textContent).toBe('1 小时');
  });

  it('🔴 跨度跨天 → 画日期分隔带并标「第 N 天」', () => {
    // 4 条 × 480 分钟串行 = 1920 分钟（32 小时）→ 跨天
    const entries = [
      ...buildTimeline([{ title: '甲' }, { title: '乙' }, { title: '丙' }, { title: '丁' }], {
        durationsInMinutes: { 甲: 480, 乙: 480, 丙: 480, 丁: 480 },
      }).entries,
    ];
    const el = render({ entries, startDate: '2026-09-26', now: Date.parse('2026-09-26') });

    expect(el.querySelector('[data-testid="gantt-day-1"]')?.textContent).toContain('第 1 天');
    expect(el.querySelector('[data-testid="gantt-day-1"]')?.textContent).toContain('09-26');
    expect(el.querySelector('[data-testid="gantt-day-2"]')?.textContent).toContain('第 2 天');
    expect(el.querySelector('[data-testid="gantt-day-2"]')?.textContent).toContain('09-27');
    // 跨天时不再画钟点刻度
    expect(el.querySelector('[data-testid="gantt-tick-0"]')).toBeNull();
  });

  it('🔴 计划从 9:30 开始时，"第 1 天"只到当天午夜（不按 24 小时硬切）', () => {
    // 从 9:30 起，跨天阈值 12 小时 → 需要 > 720 分钟。取 900 分钟（15 小时）。
    const entries: TimelineEntry[] = [
      { title: 'A', startOffsetMinutes: 0, durationMinutes: 900, durationSource: 'provided' },
    ];
    const el = render({
      entries,
      startDate: '2026-09-26',
      startTimeMinutes: 570,
      now: Date.parse('2026-09-26'),
    });

    // 9:30 → 次日 0:30，所以第 1 天只有 870 分钟（14.5 小时），第 2 天 30 分钟。
    const first = el.querySelector('[data-testid="gantt-day-1"]') as HTMLElement;
    const second = el.querySelector('[data-testid="gantt-day-2"]') as HTMLElement;
    expect(Number.parseFloat(first.style.width)).toBeCloseTo((870 / 900) * 100, 3);
    expect(Number.parseFloat(second.style.width)).toBeCloseTo((30 / 900) * 100, 3);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 日期（复用 @heyta/domain）
// ─────────────────────────────────────────────────────────────────────────

describe('日期显示', () => {
  const entries: TimelineEntry[] = [
    { title: 'A', startOffsetMinutes: 0, durationMinutes: 60, durationSource: 'provided' },
    { title: 'B', startOffsetMinutes: 60, durationMinutes: 60, durationSource: 'provided' },
  ];

  it('给了起始日就显示真实日期与钟点', () => {
    const el = render({
      entries,
      startDate: '2026-09-26',
      startTimeMinutes: 570,
      now: Date.parse('2026-09-26'),
    });
    // 9:30 → 10:30
    const text = el.querySelector('[data-testid="gantt-dates-0"]')?.textContent ?? '';
    expect(text).toContain('09-26');
    expect(text).toContain('9:30');
    expect(text).toContain('10:30');
    expect(el.querySelector('[data-testid="gantt-range"]')?.textContent).toContain('09-26');
    expect(el.querySelector('[data-testid="gantt-range"]')?.textContent).toContain('9:30');
  });

  it('不给起始日就只显示相对偏移（不硬编一个日期）', () => {
    const el = render({ entries });
    const text = el.querySelector('[data-testid="gantt-dates-0"]')?.textContent ?? '';
    expect(text).toContain('0 分钟');
    expect(text).toContain('1 小时');
    expect(el.querySelector('[data-testid="gantt-range"]')).toBeNull();
  });

  it('跨月由领域层的 addDays 处理（不自己加毫秒）', () => {
    const el = render({
      entries: [
        {
          title: 'A',
          startOffsetMinutes: 5 * 1440,
          durationMinutes: 3 * 1440,
          durationSource: 'provided',
        },
      ],
      startDate: '2026-01-30',
      now: Date.parse('2026-01-30'),
    });
    // 01-30 + 5 天 = 02-04；结束 = 起点 + 3 天 = 02-07
    const text = el.querySelector('[data-testid="gantt-dates-0"]')?.textContent ?? '';
    expect(text).toContain('02-04');
    expect(text).toContain('02-07');
  });

  it('🔴 坏日期不炸，只是不显示日期', () => {
    const el = render({ entries, startDate: '2026-13-40' });
    expect(el.querySelector('[data-testid="gantt-chart"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="gantt-range"]')).toBeNull();
    // 退化成相对偏移，而不是崩掉或显示一个假日期
    expect(el.querySelector('[data-testid="gantt-dates-0"]')?.textContent).toContain('0 分钟');
  });

  it('🔴 坏起始钟点被夹住，不会算出 NaN', () => {
    const el = render({
      entries,
      startDate: '2026-09-26',
      startTimeMinutes: Number.NaN,
      now: Date.parse('2026-09-26'),
    });
    expect(el.querySelector('[data-testid="gantt-chart"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="gantt-dates-0"]')?.textContent).toContain('09-26');
  });
});

describe('今天标线', () => {
  const entries: TimelineEntry[] = [
    { title: 'A', startOffsetMinutes: 0, durationMinutes: 1440, durationSource: 'provided' },
    { title: 'B', startOffsetMinutes: 1440, durationMinutes: 1440, durationSource: 'provided' },
  ];

  it('今天在计划内 → 有文字标注与标线', () => {
    const el = render({
      entries,
      startDate: '2026-09-26',
      today: '2026-09-27',
      now: Date.parse('2026-09-26'),
    });
    expect(el.querySelector('[data-testid="gantt-today"]')?.textContent).toContain('第 2 天');
    expect(el.querySelector('[data-testid="gantt-today-line"]')).toBeTruthy();
  });

  it('今天在计划外 → 不画（画出来只会误导）', () => {
    const el = render({
      entries,
      startDate: '2026-09-26',
      today: '2026-12-31',
      now: Date.parse('2026-09-26'),
    });
    expect(el.querySelector('[data-testid="gantt-today"]')).toBeNull();
    expect(el.querySelector('[data-testid="gantt-today-line"]')).toBeNull();
  });

  it('没有起始日时不画今天标线（算不出偏移）', () => {
    const el = render({ entries, today: '2026-09-27' });
    expect(el.querySelector('[data-testid="gantt-today"]')).toBeNull();
  });

  it('🔴 计划从今天 9:30 开始 → 今天照样算在计划内（区间相交，不是起点包含）', () => {
    const el = render({
      entries: [
        { title: 'A', startOffsetMinutes: 0, durationMinutes: 120, durationSource: 'provided' },
      ],
      startDate: '2026-09-26',
      startTimeMinutes: 570,
      today: '2026-09-26',
      now: Date.parse('2026-09-26'),
    });
    expect(el.querySelector('[data-testid="gantt-today"]')?.textContent).toContain('第 1 天');
    expect(el.querySelector('[data-testid="gantt-today-line"]')).toBeTruthy();
  });
});
