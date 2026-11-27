/**
 * Web 日历的**档位表**（含滴答的「课程表」一档）
 * ==============================================
 *
 * 共享层 `CalendarViewKind` 只有 month/week/day/year —— 那四个是 Web 与移动端共渲染的档。
 * 「课程表」是 Web 这一端本次补上的档，**不进共享联合类型**：往里加一档会波及共享板的
 * 渲染分支、`stepCalendarCursor`、两端的 `Record` 映射（移动端同样把它扩在本地
 * `MobileCalendarView` 里、共享 `CalendarViewKind` 原样不动 —— 见 `calendar-mobile-views.ts`）。
 *
 * 所以这里只在 Web 本地扩一档，走同一条 `view` 管线渲染；共享组件
 * `CalendarViewTabs` 已改成泛型、能接收本端自己的档。
 */

import { CALENDAR_VIEW_ORDER, type CalendarViewKind } from '@heyta/ui';

export type CalendarWebView = CalendarViewKind | 'timetable';

/** 可见分段控件的顺序：日 → 周 → 月 → 年 → 课程表（课程表放最后，像滴答把垂直场景附在末尾）。 */
export const CALENDAR_WEB_VIEW_ORDER: readonly CalendarWebView[] = [...CALENDAR_VIEW_ORDER, 'timetable'];
