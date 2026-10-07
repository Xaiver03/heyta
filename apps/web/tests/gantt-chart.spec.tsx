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

import { parseLocalDate, type LocalDate } from '@heyta/domain';
import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { App } from '../src/App.js';
import { LocaleHost } from '../src/lib/locale-host.js';
import { __resetOpLogForTests, initOpLog } from '../src/lib/oplog.js';
import { buildTimeline, type TimelineBlock, type TimelineEntry } from '@heyta/domain';
import { GanttChart, HeytaUiProvider, type GanttChartProps } from '@heyta/ui';
import { ChecklistPlanPreview } from '@heyta/ui';
import { planTimelineBlock } from '@heyta/app-host';
import { useTimelineLabels } from '../src/features/timeline/labels.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

/** 渲染任意节点到一块新的容器里；同一测试里多次调用是安全的。 */
function renderElement(node: React.ReactNode): HTMLDivElement {
  if (root !== undefined) {
    act(() => {
      root?.unmount();
    });
    container?.remove();
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(node);
  });
  return container;
}

/**
 * 🔴 直接渲染**共享** `GanttChart` 要自己补两样：文案（`labels`）与 theme（Provider）。
 * 文案用**真的** `useTimelineLabels()`，不在测试里抄一份中文字符串 ——
 * 抄的那份不会跟着词条表变，断言就变成了自证。
 */
function GanttHarness(props: Omit<GanttChartProps, 'labels'>): React.JSX.Element {
  const labels = useTimelineLabels();
  // 🔴 2026-10-01 重画后 `useTimelineLabels()` 返回 `{ board, plan }`：
  // 甘特图归**详情预览**（`ChecklistPlanLabels.gantt`）。取错分支会拿到 undefined，
  // 下面的测试会以 `Cannot read properties of undefined (reading 'hours')` 成片红。
  return (
    <HeytaUiProvider>
      <GanttChart {...props} labels={labels.plan.gantt} />
    </HeytaUiProvider>
  );
}

function render(props: Omit<GanttChartProps, 'labels'>): HTMLDivElement {
  return renderElement(<GanttHarness {...props} />);
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

/**
 * 本地日历日 → 时间戳。**必须走领域层的 `parseLocalDate`。**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 不要写 `Date.parse('2026-09-26')` —— 那是 **UTC 午夜**，
 * 而 `formatCompactDate` 用的是**本地** getter（`getMonth` / `getDate` /
 * `getFullYear`）。在 UTC-5 下 UTC 午夜会被读成**前一天 19:00**，
 * 于是 "09-26" 变成 "09-25"。
 *
 * 本机（UTC+8）永远看不出来 —— 这正是"本地绿、CI 红"的典型成因。
 * `parseLocalDate` 给的是**本地**午夜，与领域层、与 `formatCompactDate`
 * 同一套约定，所以在任何时区都落在同一个日历日上。
 * ─────────────────────────────────────────────────────────────────────────
 */
function localStartOfDay(date: LocalDate): number {
  return parseLocalDate(date).getTime();
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
      { title: 'A', startOffsetMinutes: 0, durationMinutes: 60, durationSource: 'manual' },
      { title: 'B', startOffsetMinutes: 60, durationMinutes: 60, durationSource: 'manual' },
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
    { title: '短的', startOffsetMinutes: 0, durationMinutes: 30, durationSource: 'manual' },
    { title: '长的', startOffsetMinutes: 0, durationMinutes: 90, durationSource: 'manual' },
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
    // ⚠️ 换装共享组件后 `minWidth` 走 RN 的 StyleSheet（不再内联到 `style`），
    // 所以判据改成"**计算出来的**最小宽度足够小"（≤ 2px），而不是比对内联字符串 ——
    // 若有人把它换成一个像样的最小宽度，这里照样会红。
    const thin = getComputedStyle(short).minWidth;
    expect(Number.parseFloat(thin === '' ? '0' : thin)).toBeLessThanOrEqual(2);
    // 静态兜底宽度两条来自同一个 class，必须一致。
    expect(getComputedStyle(long).minWidth).toBe(thin);
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
      { title: '前置', startOffsetMinutes: 0, durationMinutes: 180, durationSource: 'manual' },
      {
        title: '后继',
        startOffsetMinutes: 60,
        durationMinutes: 60,
        dependsOn: '前置',
        durationSource: 'manual',
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
      { title: 'A', startOffsetMinutes: 0, durationMinutes: 120, durationSource: 'manual' },
      { title: 'B', startOffsetMinutes: 120, durationMinutes: 120, durationSource: 'manual' },
    ];
    const el = render({
      entries,
      startDate: '2026-09-26',
      startTimeMinutes: 570, // 9:30
      now: localStartOfDay('2026-09-26'),
    });

    // 跨度 240 分钟 → 每 60 分钟一格。
    // ⚠️ testid 用的是**偏移**（0 / 60 / …），钟点只是**标签**。
    expect(el.querySelector('[data-testid="gantt-tick-0"]')?.textContent).toBe('9:30');
    expect(el.querySelector('[data-testid="gantt-tick-60"]')?.textContent).toBe('10:30');
    expect(el.querySelector('[data-testid="gantt-tick-240"]')?.textContent).toBe('13:30');
    // 一天内不该出现"第 N 天"的分隔带
    expect(el.querySelector('[data-testid="gantt-day-1"]')).toBeNull();
  });

  it('🔴 没有起始日时，刻度退化成相对偏移（不硬编一个钟点）', () => {
    const entries: TimelineEntry[] = [
      { title: 'A', startOffsetMinutes: 0, durationMinutes: 240, durationSource: 'manual' },
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
    const el = render({ entries, startDate: '2026-09-26', now: localStartOfDay('2026-09-26') });

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
      { title: 'A', startOffsetMinutes: 0, durationMinutes: 900, durationSource: 'manual' },
    ];
    const el = render({
      entries,
      startDate: '2026-09-26',
      startTimeMinutes: 570,
      now: localStartOfDay('2026-09-26'),
    });

    // 9:30 → 次日 0:30，所以第 1 天只有 870 分钟（14.5 小时），第 2 天 30 分钟。
    const first = el.querySelector('[data-testid="gantt-day-1"]') as HTMLElement;
    const second = el.querySelector('[data-testid="gantt-day-2"]') as HTMLElement;
    expect(Number.parseFloat(first.style.width)).toBeCloseTo((870 / 900) * 100, 3);
    expect(Number.parseFloat(second.style.width)).toBeCloseTo((30 / 900) * 100, 3);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴 测试自己不许假设本机时区
// ─────────────────────────────────────────────────────────────────────────

describe('🔴 测试夹具不假设本机时区', () => {
  it('🔴 localStartOfDay 落在**本地**日历日上（不是 UTC 午夜）', () => {
    // 这条是护栏：谁要是把夹具换回 `Date.parse('2026-09-26')`，
    // 在 UTC-5 之类的时区下这三行会立刻红 —— 而不是等到 CI 上才红。
    const d = new Date(localStartOfDay('2026-09-26'));
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8); // 0-based：9 月
    expect(d.getDate()).toBe(26);
    expect(d.getHours()).toBe(0);
  });

  it('🔴 与领域层同一套约定：toLocalDate(parseLocalDate(x)) === x', () => {
    for (const date of ['2026-01-30', '2026-09-26', '2026-12-31'] as const) {
      expect(new Date(localStartOfDay(date)).getDate()).toBe(Number(date.slice(8, 10)));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 日期（复用 @heyta/domain）
// ─────────────────────────────────────────────────────────────────────────

describe('日期显示', () => {
  const entries: TimelineEntry[] = [
    { title: 'A', startOffsetMinutes: 0, durationMinutes: 60, durationSource: 'manual' },
    { title: 'B', startOffsetMinutes: 60, durationMinutes: 60, durationSource: 'manual' },
  ];

  it('给了起始日就显示真实日期与钟点', () => {
    const el = render({
      entries,
      startDate: '2026-09-26',
      startTimeMinutes: 570,
      now: localStartOfDay('2026-09-26'),
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
          durationSource: 'manual',
        },
      ],
      startDate: '2026-01-30',
      now: localStartOfDay('2026-01-30'),
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
      now: localStartOfDay('2026-09-26'),
    });
    expect(el.querySelector('[data-testid="gantt-chart"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="gantt-dates-0"]')?.textContent).toContain('09-26');
  });
});

describe('今天标线', () => {
  const entries: TimelineEntry[] = [
    { title: 'A', startOffsetMinutes: 0, durationMinutes: 1440, durationSource: 'manual' },
    { title: 'B', startOffsetMinutes: 1440, durationMinutes: 1440, durationSource: 'manual' },
  ];

  it('今天在计划内 → 有文字标注与标线', () => {
    const el = render({
      entries,
      startDate: '2026-09-26',
      today: '2026-09-27',
      now: localStartOfDay('2026-09-26'),
    });
    expect(el.querySelector('[data-testid="gantt-today"]')?.textContent).toContain('第 2 天');
    expect(el.querySelector('[data-testid="gantt-today-line"]')).toBeTruthy();
  });

  it('今天在计划外 → 不画（画出来只会误导）', () => {
    const el = render({
      entries,
      startDate: '2026-09-26',
      today: '2026-12-31',
      now: localStartOfDay('2026-09-26'),
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
        { title: 'A', startOffsetMinutes: 0, durationMinutes: 120, durationSource: 'manual' },
      ],
      startDate: '2026-09-26',
      startTimeMinutes: 570,
      today: '2026-09-26',
      now: localStartOfDay('2026-09-26'),
    });
    expect(el.querySelector('[data-testid="gantt-today"]')?.textContent).toContain('第 1 天');
    expect(el.querySelector('[data-testid="gantt-today-line"]')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴 多图共用一把尺子（否则每张图各自占满整行，比不出长短）
// ─────────────────────────────────────────────────────────────────────────

describe('🔴 spanMinutes：多张图对齐到同一个尺度', () => {
  const entries: TimelineEntry[] = [
    { title: '短的', startOffsetMinutes: 0, durationMinutes: 30, durationSource: 'manual' },
    { title: '长的', startOffsetMinutes: 0, durationMinutes: 90, durationSource: 'manual' },
  ];

  it('不给 spanMinutes → 按本图跨度归一化（长条占满）', () => {
    const el = render({ entries });
    expect(barWidthPercent(el, 0)).toBeCloseTo(100 / 3, 3);
    expect(barWidthPercent(el, 1)).toBeCloseTo(100, 5);
  });

  it('🔴 给了更大的 spanMinutes → 两条一起按同一尺度缩小，比例仍是 3:1', () => {
    const el = render({ entries, spanMinutes: 180 });
    const short = barWidthPercent(el, 0);
    const long = barWidthPercent(el, 1);
    expect(short).toBeCloseTo((30 / 180) * 100, 3);
    expect(long).toBeCloseTo((90 / 180) * 100, 3);
    expect(long / short).toBeCloseTo(3, 5);
  });

  it('🔴 给的 spanMinutes 比本图还小 → 只放宽不截断（条不会溢出容器）', () => {
    const el = render({ entries, spanMinutes: 10 });
    // 本图跨度 90 更大，所以仍然按 90 归一化
    expect(barWidthPercent(el, 1)).toBeCloseTo(100, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────
// 🔴🔴 ChecklistPlanPreview：清单排程降级进详情（2026-10-01 重画）
// ─────────────────────────────────────────────────────────────────────────

/**
 * 板上不再画任务内部的清单甘特图（那是"每任务一把尺"的根源）。
 * 原来钉在 TimelinePanel 上的三条「如实说明」判据**一条没删**，全部改钉在详情预览上 ——
 * 它们保护的是"不编造"，与画在哪个面无关：
 *
 *   1. 没有可排期内容的任务**不静默跳过**（预览里仍有一条整任务）；
 *   2. 估时摊不到子条目上时**明说**，绝不按比例编工期；
 *   3. 工期来源（AI / 手填 / 未估时）永远是**文字**。
 */

describe('🔴🔴 ChecklistPlanPreview（任务内部坐标系，已标明）', () => {
  /** 详情预览的壳：真词条 + 真 Provider，与 GanttHarness 同一条纪律。 */
  function PreviewHarness(props: {
    block: TimelineBlock;
  }): React.JSX.Element {
    const labels = useTimelineLabels();
    return (
      <HeytaUiProvider>
        <ChecklistPlanPreview block={props.block} labels={labels.plan} />
      </HeytaUiProvider>
    );
  }

  it('区块开头标明「不是同一个坐标系」（不标明用户就会拿它和板对位置）', () => {
    const block = planTimelineBlock({ id: 't1', title: '上线', note: '- [ ] 全量发布' });
    const el = renderElement(<PreviewHarness block={block} />);
    const caption = el.querySelector('[data-testid="checklist-plan-caption"]');
    expect(caption).toBeTruthy();
    expect(caption?.textContent).toContain('不是同一个坐标系');
  });

  it('🔴 没有可排期清单**不静默跳过**：说明文字在场，整条任务照样排一条', () => {
    const block = planTimelineBlock({ id: 't1', title: '还没拆的任务' });
    const el = renderElement(<PreviewHarness block={block} />);
    expect(el.querySelector('[data-testid="checklist-plan-no-checklist"]')?.textContent).toContain(
      '还没有可排期的清单',
    );
    // 整条任务自己是一条，不是空图
    expect(el.querySelector('[data-testid="checklist-plan-gantt"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="gantt-row-0"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="gantt-title-0"]')?.textContent).toBe('还没拆的任务');
  });

  it('🔴 清单只有 1 条时，整条任务的估时直接落在那一条上（AI 来源是文字）', () => {
    const block = planTimelineBlock({
      id: 't1',
      title: '上线',
      note: '- [ ] 全量发布\n预计耗时：90 分钟',
    });
    const el = renderElement(<PreviewHarness block={block} />);
    expect(el.querySelector('[data-testid="gantt-duration-0"]')?.textContent).toContain(
      '约 1 小时 30 分 · AI 估时',
    );
    expect(el.querySelector('[data-testid="gantt-unestimated-summary"]')).toBeNull();
  });

  it('🔴 清单 N>1 条时估时**不分摊**：明说摊不了，且绝不出现"每条 30 分钟"', () => {
    const note = ['- [ ] 甲', '- [ ] 乙', '- [ ] 丙', '预计耗时：90 分钟'].join('\n');
    const block = planTimelineBlock({ id: 't1', title: '多步任务', note });
    const el = renderElement(<PreviewHarness block={block} />);

    // 三条都是默认时长（没有偷偷把 90 分钟摊成 30 分钟）
    for (const index of [0, 1, 2]) {
      const text = el.querySelector(`[data-testid="gantt-duration-${String(index)}"]`)?.textContent;
      expect(text).toContain('未估时');
      expect(text).not.toContain('AI 估时');
    }
    // 备注里那行估时**不是**一个清单条目
    expect(el.querySelector('[data-testid="gantt-row-3"]')).toBeNull();
  });

  it('🔴 没估过（undefined）说「未估时」，与"估了 0 分钟"分得开', () => {
    const never = planTimelineBlock({ id: 'a', title: '没估过' });
    const elA = renderElement(<PreviewHarness block={never} />);
    expect(elA.querySelector('[data-testid="gantt-duration-0"]')?.textContent).toContain('未估时');

    const zero = planTimelineBlock({ id: 'b', title: '估了零', note: '预计耗时：0 分钟' });
    const elB = renderElement(<PreviewHarness block={zero} />);
    expect(elB.querySelector('[data-testid="gantt-duration-0"]')?.textContent).toContain(
      'AI 估时',
    );
  });

  it('🔴 空标题 / 空备注也不炸', () => {
    const block = planTimelineBlock({ id: 'x', title: '', note: '' });
    const el = renderElement(<PreviewHarness block={block} />);
    expect(el.querySelector('[data-testid="checklist-plan-preview"]')).toBeTruthy();
  });
});


// 🔴🔴 真实可达性：挂真 App，点真导航
// ─────────────────────────────────────────────────────────────────────────

/**
 * 这一组补的是本仓库最高发的失效形状：**能力实现了、单测全绿、生产里零调用点。**
 *
 * 上面所有测试都能在"没人挂载"的情况下全绿 —— 它们只证明组件本身对。
 * 所以这里挂**真的 `App`**（不是单独挂 `TimelinePanel`），点真的导航按钮。
 * 一旦有人把 `App.tsx` 里的 `'timeline'` 分支或导航项删掉，这一组立刻红。
 */

/**
 * 按看得见的文字点 rail 上的目的地（W1 之后 rail 上段 = 主段 ≤4 + 「更多」菜单）。
 *
 * 🔴 低频视图（番茄钟/时间线/成长/便签/倒数日）现在住在「更多」菜单里，而菜单
 * 只在点开「更多」后才进 DOM —— 所以主段找不到时先点 `.ht-rail__more button`
 * 再在 `[role="menuitem"]` 里找、点它。这一组测的正是"时间线真的能点到"：
 * 菜单项也是写着时间线的那颗，点它仍然证"挂载 + 接线"，判据没放松。
 */
async function clickRailDestination(el: HTMLElement, label: string): Promise<void> {
  const mainTab = [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) =>
    (b.textContent ?? '').includes(label),
  );
  if (mainTab !== undefined) {
    await act(async () => {
      mainTab.click();
    });
    return;
  }
  const more = el.querySelector<HTMLButtonElement>('.ht-rail__more button');
  expect(more, `rail 主段没有「${label}」、也没有「更多」入口`).not.toBeNull();
  await act(async () => {
    more!.click();
  });
  const item = [...el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) =>
    (b.textContent ?? '').includes(label),
  );
  expect(item, `「更多」菜单里没有「${label}」`).not.toBeUndefined();
  await act(async () => {
    item!.click();
  });
}

describe('🔴🔴 时间线真的能点到（不是"写好了没人挂载"）', () => {
  beforeEach(async () => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    localStorage.clear();
    __resetOpLogForTests();
    await initOpLog();
  });

  it('🔴 App 的视图切换里有「时间线」，点了能看到时间线视图', async () => {
    // 🔴 必须包 `LocaleHost`：外壳里现在挂了语言切换器，而
    // `useLocalePreference()` 在 Provider 之外**刻意抛错**（"点了没反应"更难查）。
    // 包法与线上 `main.tsx` 完全一致 —— 这正是把 LocaleHost 抽出来的原因。
    const el = renderElement(
      <LocaleHost>
        <App />
      </LocaleHost>,
    );

    await clickRailDestination(el, '时间线');

    expect(el.querySelector('[data-testid="timeline-view"]')).toBeTruthy();
  });
});
