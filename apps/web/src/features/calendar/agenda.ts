/**
 * 「今天 / 最近 7 天」议程的**纯投影**（Web 壳）
 * ==============================================
 *
 * 输入是一组 `CALENDAR_EVENT` 和一组**日期**，输出是"每一天画哪几条"。
 *
 * ## 为什么这一步必须能单独测
 *
 * 它同时回答两个很容易各自错一半的问题：
 *
 *   1. **跨天日程算哪一天**：昨天 22:00 到今天 01:00 的会，今天那一组里必须看得见
 *      （按"开始日"分组的实现在这类日程上会让它从今天凭空消失，而没有任何一层报错）；
 *   2. **全天日程用哪个日期**：`startDate` / `endDateExclusive` 是**事件时区**的日期
 *      （`entities.ts` 的注释），拿 `start` 的本地时间再推一遍会在时区边界上差一天。
 *
 * 所以这里是**日期 → 条**的映射，不含"哪些天算最近 7 天"之外的判断：
 * 那 7 天由调用方用 `agendaDays(today, range)` 给出来，而 `today` 只有一个来源
 * （`useTaskStore().now`，与日历主区同一份）。`range` 只是"取几天"，不是新的时间观。
 *
 * ## 不画母事件
 *
 * Hub 在 `expand=true` 下列出**实例行**（`eventId` 带 `#起点毫秒` 后缀），同时也返回
 * `recurrence` 非空的**母事件**（不受窗口限制）。阶段 A 不在渲染期展开 RRULE
 * （ADR-0089 §2：展开会让无限重复的日程往 op-log 里写进上千条），所以母事件在这里
 * 不是"一次发生" —— 把它画出来只会让第一条实例与它重合。等渲染期展开落地时，
 * 改的是这一处过滤，而不是分组。
 */

import { addDays, dueDateToEpoch, type CalendarEvent, type LocalDate } from '@heyta/domain';

/** 面板上那两个切换档。 */
export type AgendaRange = 'today' | 'next7';

/** 每一档覆盖的天数（含今天）。 */
export const AGENDA_RANGE_LENGTH: Readonly<Record<AgendaRange, number>> = {
  today: 1,
  next7: 7,
};

/** 这一档覆盖的日期，今天在前。 */
export function agendaDays(today: LocalDate, range: AgendaRange): LocalDate[] {
  const length = AGENDA_RANGE_LENGTH[range];
  return Array.from({ length }, (_, index) => addDays(today, index));
}

/** 一天一组。`events` 已排序（见 `agendaGroups`）。 */
export interface AgendaGroup {
  readonly date: LocalDate;
  readonly events: readonly CalendarEvent[];
}

/**
 * 把日程摊到给定日期上。**没有日程的那一天不出现**（空态由调用方判"整组为空"，
 * 而不是让面板画七行"今天没有日程"—— 那七行里只有一行有信息）。
 */
export function agendaGroups(
  events: readonly CalendarEvent[],
  days: readonly LocalDate[],
): AgendaGroup[] {
  const groups: AgendaGroup[] = [];
  for (const date of days) {
    const fromMs = dueDateToEpoch(date);
    const toMs = dueDateToEpoch(addDays(date, 1));
    const matched = events.filter((event) => occursOn(event, date, fromMs, toMs));
    if (matched.length === 0) continue;
    groups.push({ date, events: matched.sort(compareAgendaEvents) });
  }
  return groups;
}

/** 这条日程在 `[fromMs, toMs)` 这一天里有没有占用时间。 */
function occursOn(event: CalendarEvent, date: LocalDate, fromMs: number, toMs: number): boolean {
  // 墓碑与彻底删除都不画；阶段 A 的读侧没有"回收站里的日程"这一屏。
  if (event.deletedAt !== undefined || event.purgedAt !== undefined) return false;
  // 母事件不是一次发生（见文件头最后一节）。
  if ((event.recurrence ?? '') !== '') return false;

  // 全天：**只在有 `startDate` 时才按日期串判**。缺 `startDate`（事件时区缺失）
  // 时退回时间重叠 —— 那是"算不出日历日"的降级，不是另一种分法。
  if (event.allDay === true && event.startDate !== undefined) {
    const endExclusive = event.endDateExclusive ?? addDays(event.startDate, 1);
    return event.startDate <= date && date < endExclusive;
  }

  if (event.start === undefined || event.end === undefined) return false;
  // 与 Hub 的窗口判据同形：`start < to && end > from`。
  // ⚠️ 零长度日程（`start === end`）永远不重叠，因此不画 —— 它没有"占用哪一天"可言。
  return event.start < toMs && event.end > fromMs;
}

/**
 * 同一天内的顺序：**全天在前 → 开始早的在前 → 标题 → id**。
 *
 * 最后两档不是为了好看：`sort` 在相等时不保证稳定跨引擎，而日程列表每次同步都可能
 * 重排 —— 没有确定性的兜底会出现"没改任何东西，行序变了"。
 */
function compareAgendaEvents(left: CalendarEvent, right: CalendarEvent): number {
  const leftAllDay = left.allDay === true ? 0 : 1;
  const rightAllDay = right.allDay === true ? 0 : 1;
  if (leftAllDay !== rightAllDay) return leftAllDay - rightAllDay;

  const leftStart = left.start ?? 0;
  const rightStart = right.start ?? 0;
  if (leftStart !== rightStart) return leftStart - rightStart;

  const leftTitle = left.summary ?? '';
  const rightTitle = right.summary ?? '';
  if (leftTitle !== rightTitle) return leftTitle < rightTitle ? -1 : 1;

  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
