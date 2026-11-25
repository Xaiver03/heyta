/**
 * 移动端日历的**档位表**（含滴答的「3日」「课表」两档）
 * ====================================================
 *
 * 共享层 `CalendarViewKind` 只有 month/week/day/year —— 那四个是 Web 也渲染的档，
 * 往里加档会波及 Web 的 `<select>`（每个 option 都得有对应板子）。所以这里只在
 * **移动端**扩出两档：`3day` 与 `timetable`，用独立状态在 `CalendarScreen` 里渲染，
 * 共享 `view` 管线保持原样、Web 零改动。
 *
 * 词条走 `mobile.calendar.view.*`；图标沿用 `calendar.*` 字形。
 */

import type { CalendarViewKind } from '@heyta/ui';

import type { IconName } from '../ui/icons';

export type MobileCalendarView = CalendarViewKind | 'list' | '3day' | 'timetable';

/** 顺序照滴答：月 → 周 → 日 → 3日 → 课表 → 年（年放最后，理由同共享表）。 */
export const MOBILE_VIEW_ORDER: readonly MobileCalendarView[] = [
  'list',
  'year',
  'month',
  'week',
  '3day',
  'day',
  'timetable',
];

export const MOBILE_VIEW_LABEL_KEY: Record<MobileCalendarView, string> = {
  list: 'mobile.calendar.view.list',
  month: 'mobile.calendar.view.month',
  week: 'mobile.calendar.view.week',
  day: 'mobile.calendar.view.day',
  '3day': 'mobile.calendar.view.3day',
  timetable: 'mobile.calendar.view.timetable',
  year: 'common.calendar.view.year',
};

export const MOBILE_VIEW_ICON: Record<MobileCalendarView, IconName> = {
  list: 'calendar.day',
  month: 'calendar.month',
  week: 'calendar.week',
  day: 'calendar.day',
  '3day': 'calendar.week',
  timetable: 'calendar.month',
  year: 'calendar.year',
};

/** 是否共享板能渲染的档（month/week/day/year）。 */
export function isSharedView(v: MobileCalendarView): v is CalendarViewKind {
  return v === 'month' || v === 'week' || v === 'day' || v === 'year';
}
