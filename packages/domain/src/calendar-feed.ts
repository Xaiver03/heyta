/**
 * 任务 → iCalendar（`.ics`）导出
 * ============================
 *
 * 纯函数：把一组 `Task` 投影成一份 VCALENDAR 文本。用于两条路：
 *   1. **下载**：用户在设置里导出 `.ics`；
 *   2. **订阅源**：服务端 `GET /calendar/<token>.ics` 用同一份函数动态生成，
 *      让 Google / Outlook / Apple 订阅 heyta。
 *
 * ## 只导出什么（对标滴答"订阅滴答"的口径）
 *
 * · **未完成**（`completedAt` 缺席）且**有日期**（`dueDate` 或 `dueDateLocal`）的任务。
 *   已完成/无日期的任务不进日历订阅 —— 否则日历里全是做完的历史，没人看得下去。
 * · 全天 vs 定时：`dueDateLocal` 存在且 `dueDate` 是本地零点 ⇒ 全天事件（`VALUE=DATE`）；
 *   否则按 `dueDate` 的时刻建定时事件（默认时长 1 小时，任务没有"时长"字段）。
 * · `repeatRule`（RFC 5545 RRULE，不带前缀）原样带出。
 *
 * 🔴 确定性：`UID` 由任务 id + host 派生，`DTSTAMP` 由 `now` 提供（测试注入固定值），
 * 这样同一批任务两次生成的字节一致（便于 diff / 缓存）。
 */

import type { Task } from './entities.js';

export interface TasksToIcsOptions {
  /** `DTSTAMP` 用的时刻，默认 `Date.now()`。测试注入固定值。 */
  readonly now?: number;
  /** 事件 UID 的域后缀，默认 `heyta`。 */
  readonly domain?: string;
  /** `PRODID`，默认 `-//heyta//calendar-feed//EN`。 */
  readonly prodId?: string;
  /** 定时事件的默认时长（分钟），默认 60。 */
  readonly defaultDurationMinutes?: number;
}

/** 文本值转义（iCalendar §3.3.11）。 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\n|\r/g, '\\n');
}

/** 折行：每行不超过 ~73 字节（RFC 5545 建议 75 字节，续行以空格开头）。按 UTF-8 字节切，不劈开多字节字符。 */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 73) return line;
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > 73) {
      out.push(current);
      current = ` ${ch}`;
      bytes = 1 + size;
    } else {
      current += ch;
      bytes += size;
    }
  }
  if (current !== '') out.push(current);
  return out.join('\r\n');
}

/** `YYYY-MM-DD` → `YYYYMMDD`。 */
function compactDate(date: string): string {
  return date.replace(/-/g, '');
}

/** epoch ms → `YYYYMMDDTHHMMSSZ`（UTC）。 */
function compactUtc(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getUTCFullYear())}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** 本地午夜判定（用于"全天 vs 定时"）。 */
function isLocalMidnight(ms: number): boolean {
  const d = new Date(ms);
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
}

/** 本地日期 + 1 天（用于全天事件的排他 DTEND）。 */
function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + 1));
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(next.getUTCFullYear())}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`;
}

interface EventDates {
  readonly allDay: boolean;
  readonly startLine: string;
  readonly endLine: string;
}

/** 由任务的日期字段算事件起止行；没有日期返回 `undefined`。 */
function eventDates(task: Task, defaultDurationMinutes: number): EventDates | undefined {
  const dateOnly = task.dueDateLocal;
  const due = task.dueDate;
  if (dateOnly !== undefined && (due === undefined || isLocalMidnight(due))) {
    // 全天（单日）。
    return {
      allDay: true,
      startLine: `DTSTART;VALUE=DATE:${compactDate(dateOnly)}`,
      endLine: `DTEND;VALUE=DATE:${nextDay(dateOnly)}`,
    };
  }
  if (due !== undefined && Number.isFinite(due)) {
    const end = due + defaultDurationMinutes * 60_000;
    return {
      allDay: false,
      startLine: `DTSTART:${compactUtc(due)}`,
      endLine: `DTEND:${compactUtc(end)}`,
    };
  }
  if (dateOnly !== undefined) {
    return {
      allDay: true,
      startLine: `DTSTART;VALUE=DATE:${compactDate(dateOnly)}`,
      endLine: `DTEND;VALUE=DATE:${nextDay(dateOnly)}`,
    };
  }
  return undefined;
}

/** 一条任务是否该进日历订阅：未完成 + 有日期。 */
export function taskToCalendarEvent(task: Task): boolean {
  if (task.completedAt !== undefined) return false;
  return task.dueDate !== undefined || task.dueDateLocal !== undefined;
}

/**
 * 生成整份 `.ics`。返回以 CRLF 连接的文本（没有任务时也给一份合法的空 VCALENDAR）。
 */
export function tasksToIcs(tasks: readonly Task[], options: TasksToIcsOptions = {}): string {
  const now = options.now ?? Date.now();
  const domain = options.domain ?? 'heyta';
  const prodId = options.prodId ?? '-//heyta//calendar-feed//EN';
  const duration = options.defaultDurationMinutes ?? 60;

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${prodId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:heyta`,
  ];

  for (const task of tasks) {
    if (!taskToCalendarEvent(task)) continue;
    const dates = eventDates(task, duration);
    if (dates === undefined) continue;
    const dtstamp = compactUtc(now);
    const uid = `${task.id}@${domain}`;
    const description = task.note !== undefined && task.note.trim() !== '' ? foldLine(`DESCRIPTION:${escapeText(task.note)}`) : undefined;
    lines.push('BEGIN:VEVENT');
    lines.push(foldLine(`UID:${uid}`));
    lines.push(foldLine(`DTSTAMP:${dtstamp}`));
    lines.push(foldLine(dates.startLine));
    lines.push(foldLine(dates.endLine));
    lines.push(foldLine(`SUMMARY:${escapeText(task.title)}`));
    if (description !== undefined) lines.push(description);
    const rule = task.repeatRule;
    if (rule !== undefined && rule.trim() !== '') lines.push(foldLine(`RRULE:${rule.trim()}`));
    lines.push('STATUS:CONFIRMED');
    lines.push('TRANSP:TRANSPARENT');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

/** 一个任务的日期字段（供 UI 过滤"可导出的任务"）。 */
export function hasExportableDate(task: Task): boolean {
  return task.dueDate !== undefined || task.dueDateLocal !== undefined;
}
