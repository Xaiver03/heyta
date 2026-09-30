/**
 * 时间线展厅件的**登记处**
 * ==========================
 *
 * 与 `habit-shape.ts` / `quadrant-shape.ts` 同一个理由：复刻件与它的判据
 * 必须**从同一份数据派生**。手抄一份的结果是"改了一处、另一处没改"，
 * 而两处都仍然"看起来像时间线" —— 没有任何东西会红。
 *
 * 🔴 这里最要紧的一条：**每一个宽度修饰类都必须在 `mockup.css` 里真的存在**。
 * 登记处说 `w-60` 而 CSS 里没有 `.mk-timeline__bar--w-60` 时，条的宽度是
 * `auto`（约等于 0）—— 图上那条任务**凭空消失**，而页面照样渲染成功。
 * 这条不变量的判据在 `apps/landing/tests/mockup-timeline-shape.spec.tsx`。
 */

import type { MessageKey } from '@heyta/i18n/provider';

/**
 * 条的宽度档。**只有这几档**（对应 CSS 里的四个修饰类）。
 *
 * ⚠️ 档位刻意是"粗粒度"的：展厅要的是"一眼看出长短差异"，
 * 而不是精确到分钟 —— 精确比例由真视图的 `GanttChart` 负责（它按百分比定位）。
 */
export const MOCK_TIMELINE_BAR_WIDTHS = ['w-15', 'w-30', 'w-45', 'w-60'] as const;

export type MockTimelineBarWidth = (typeof MOCK_TIMELINE_BAR_WIDTHS)[number];

/**
 * 行 → 条。`width` 是相对**四天轨道**的占比；`ai` 表示"这条时长是 AI 估的"
 * （真视图里用虚线边区分，见 `mockup.css` 的 `--ai`）。
 */
export interface MockTimelineRow {
  readonly titleKey: MessageKey;
  readonly width: MockTimelineBarWidth;
  readonly ai: boolean;
}

/**
 * 三行样例。任务标题**复用 `landing.mock.task.*`**（展厅其它块已经在用同一批
 * 样例任务）—— 新增一串同义标题只会让两处慢慢说不同的话。
 *
 * 宽度刻意不等（60% / 30% / 45%）：等宽的话"按估时排布"这件事在图上根本看不出来，
 * 而那是这个复刻件存在的全部理由。
 */
export const MOCK_TIMELINE_ROWS: readonly MockTimelineRow[] = [
  { titleKey: 'landing.mock.task.q4Draft', width: 'w-60', ai: false },
  { titleKey: 'landing.mock.task.weeklyReport', width: 'w-30', ai: true },
  { titleKey: 'landing.mock.task.quarterlyReview', width: 'w-45', ai: false },
];

/**
 * 轨道上方的日刻度。**四列**，与 CSS 的 `repeat(4, …)` 和 `--w-*` 的百分比基准
 * 必须同一个数 —— 这里是"几天"的唯一定义。
 *
 * 前两格复用已有的「今天 / 明天」，后两格是本刀新增的。
 */
export const MOCK_TIMELINE_DAY_COUNT = 4;

export const MOCK_TIMELINE_AXIS_KEYS: readonly MessageKey[] = [
  'landing.mock.today',
  'landing.mock.due.tomorrow',
  'landing.mock.timeline.axis3',
  'landing.mock.timeline.axis4',
];

/** 宽度档 + 是否 AI → className。**唯一一处拼类名的地方**。 */
export function mockTimelineBarClass(width: MockTimelineBarWidth, ai: boolean): string {
  return `mk-timeline__bar mk-timeline__bar--${width}${ai ? ' mk-timeline__bar--ai' : ''}`;
}
