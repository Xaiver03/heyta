/**
 * `CALENDAR_EVENT` 的投影 / 幂等键 / 删除判定（**纯函数**，无 HTTP、无 React）
 * =========================================================================
 *
 * 这个文件回答四个问题，每一个都有一种"实现错了但什么都不报"的失败形态：
 *
 *   1. **这条外部行到底是谁**（`calendarEventId`）：同一行在两台设备上必须算出
 *      同一个 id，否则"内容相同就不写 op"根本不成立 —— 每台设备都会写一条新的，
 *      然后 LWW 让两边互相覆盖，界面上是同一次会议闪两下。
 *   2. **这一行能不能变成实体**（`calendarEventFromHub`）：Hub 的行是**上游形状**，
 *      不是我们的载荷。窄映射 + 带 code 的拒绝（不抛），因为一行坏数据不该让
 *      整轮同步失败 —— 那会把"某条日程标题为空"放大成"日历整块不更新"。
 *   3. **内容有没有变**（`calendarEventEquivalent` / `calendarEventPatch`）：
 *      "相同就不写 op"是这条通道**唯一的去抖机制**（ADR-0089 §3.2）。没有它，
 *      每 5 分钟一轮、每轮几十条 op，op-log 会被一份只读镜像淹掉。
 *   4. **这一行该不该判删**（`calendarEventWindowIntersection` /
 *      `calendarEventShouldDelete`）：窗口每滑一格就有日程移出视野，按"上轮在、
 *      这轮不在即删"会**每天误删边界上的一天**，而界面上只表现为"昨天还在的
 *      会议今天没了"（Hub 设计稿 §4.3）。
 *
 * 🔴 **上游形状只在 `calendarEventFromHub` 这一处被读到**。别的地方（宿主管道、
 * 界面、以后的 Google / CalDAV connector）都不许出现 `orgId` / `startMs` /
 * `attendee_id` 这类上游键名 —— 一旦泄漏，"飞书加了个字段"就会变成"实体载荷变形"，
 * 而 op 载荷要长期躺在磁盘与快照里（`entities.ts` 的 `CalendarAttendee` 注释同一条）。
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type { LocalDate } from './date.js';
import type {
  CalendarAttendee,
  CalendarEvent,
  CalendarEventFreeBusy,
  CalendarEventStatus,
  CalendarEventVisibility,
  CalendarReminder,
} from './entities.js';

// ─────────────────────────────────────────────────────────────
// 内容字段清单（"内容有没有变"与"载荷要不要清空"都只认这一份）
// ─────────────────────────────────────────────────────────────

/**
 * 参与"内容比较"的字段。
 *
 * 🔴 三格刻意**不在**里面，各有理由：
 *   · `updatedAt` / `createdAt`：那是"这条 op 什么时候被写入"，由 reducer 从 op
 *     时间戳派生（`entities.ts` 的 `EntityBase`）。把它算进比较，两条内容相同、
 *     写入时刻不同的行就永远"不等" ⇒ 每轮都写 op，去抖完全失效。
 *   · `sourceUpdatedAt`：**源侧**更新时间，而 Hub 今天根本不输出它（设计稿 §1.2 U10），
 *     现阶段只能由 connector 填写入时刻。它每轮必然变，算进比较同样是"永远不等"。
 *   · `deletedAt` / `purgedAt`：生命周期，不是内容。判"要不要复活"是宿主管道
 *     单独一条判定（`deletedAt !== undefined` ⇒ 发一条 `{deletedAt: null}`），
 *     把它混进内容比较会让"复活"和"内容更新"变成同一种 op。
 */
export const CALENDAR_EVENT_CONTENT_FIELDS = [
  'accountId',
  'calendarId',
  'sourceEventId',
  'uid',
  'summary',
  'description',
  'location',
  'start',
  'end',
  'startDate',
  'endDateExclusive',
  'allDay',
  'timezone',
  'status',
  'visibility',
  'freeBusy',
  'recurrence',
  'recurringEventId',
  'originalTime',
  'attendees',
  'reminders',
  'tagIds',
] as const satisfies readonly (keyof CalendarEvent)[];

export type CalendarEventContentField = (typeof CALENDAR_EVENT_CONTENT_FIELDS)[number];

/**
 * 一次投影的产物：**实体字段，没有 `createdAt` / `updatedAt`**。
 *
 * 🔴 这不是 `CalendarEvent` 的子集写法偷懒。op 载荷里出现 `updatedAt` 会让
 * "这条数据什么时候被写入"有两个来源（载荷里的值 vs reducer 从 op 时间戳派生的值），
 * 而它们在离线重放、时钟回拨、跨设备并发三种情形下必然不一致（`entities.ts`
 * 的 `sourceUpdatedAt` 注释就是为这件事写的）。`createdAt` 同理由 reducer 在
 * CREATE 那条 op 上派生。
 */
export type CalendarEventFields = Pick<CalendarEvent, 'id' | CalendarEventContentField>;

// ─────────────────────────────────────────────────────────────
// 幂等键 → 实体 id
// ─────────────────────────────────────────────────────────────

/** 幂等键前缀。加版本号是为了"键的组成变了"时能一次性换代，而不是静默改 id。 */
const ID_SEED_PREFIX = 'heyta:calendar-event:v1';

/** 幂等键各段之间的分隔符：`\u0000` 不可能出现在任何一段里，拼接不会串位。 */
const ID_SEED_SEPARATOR = '\u0000';

/**
 * 把 `originalTime` 归一成毫秒（**0 表示"不是例外"**）。
 *
 * ⚠️ 单位必须归一，不能原样进哈希：Hub 的文档写"Unix 秒"，而它的解析正则同时接受
 * 10 位与 13 位，`expand.ts` 自己也按 `> 1e12` 猜单位（Hub 设计稿 §1.3 S1）。
 * 若一条例外在两种读法下分别算出 `1794632400` 与 `1794632400000`，同一个实例就会
 * 得到两个 id —— 症状是"被改过的那次会议在日历上出现两次，且改一次多一次"。
 * 这里采用与 Hub `expand.ts:57-60` **逐字相同**的判据，两边对同一条数据的读数一致。
 */
function originalTimeMs(originalTime: number | undefined | null): number {
  if (typeof originalTime !== 'number' || !Number.isFinite(originalTime) || originalTime <= 0) return 0;
  return originalTime > 1e12 ? Math.trunc(originalTime) : Math.trunc(originalTime) * 1000;
}

/**
 * 幂等键 `(accountId, calendarId, sourceEventId, originalTime)` → 稳定的实体 id。
 *
 * 四段都在实体字段里，所以不必反解哈希就能认出"这条是谁"（ADR-0089 §4）。
 * 规范化只做**不改变身份**的两件事：
 *   · 去首尾空白（手填/透传上游时最常见的差异，而它不改变身份）；
 *   · `originalTime` 归一成毫秒、`0` 与缺席同一种写法（Hub 非例外行恒为 `0`）。
 *
 * 🔴 **不做大小写折叠**：`eventId` 是飞书侧的不透明字符串，`ABC` 与 `abc` 是否同一条
 * 只有飞书知道。猜错了就是把两条不同的日程合并成一条 —— 而这类错误在界面上表现为
 * "有两个会只剩一个"，没有任何一层会报错。
 */
export function calendarEventId(
  accountId: string,
  calendarId: string,
  sourceEventId: string,
  originalTime?: number | null,
): string {
  const seed = [
    ID_SEED_PREFIX,
    accountId.trim(),
    calendarId.trim(),
    sourceEventId.trim(),
    String(originalTimeMs(originalTime)),
  ].join(ID_SEED_SEPARATOR);
  return `cev-${bytesToHex(sha256(new TextEncoder().encode(seed)))}`;
}

// ─────────────────────────────────────────────────────────────
// 上游行 → 实体字段（窄映射 + 带 code 的拒绝）
// ─────────────────────────────────────────────────────────────

/**
 * 拒绝原因。
 *
 * 🔴 用**枚举字符串**而不是异常：一轮里一行坏数据不该让整轮失败（Hub 设计稿 §4.6
 * 最后一行："80 行里 1 行缺键 ⇒ 79 行入库，日志报 1"）。抛出去的症状是"某条日程
 * 没有标题 ⇒ 日历再也不更新"，而那正是这条通道最该避免的形态。
 */
export type CalendarEventRejectionCode =
  | 'missing-account-id'
  | 'missing-calendar-id'
  | 'missing-source-event-id'
  | 'missing-summary'
  | 'missing-start'
  | 'missing-end';

export interface CalendarEventRejection {
  readonly ok: false;
  readonly code: CalendarEventRejectionCode;
  /**
   * 身份键够用的时候，这条**本来会是**哪个 id。
   *
   * 宿主管道用它做一件具体的事：把"这一行坏了"记成"这次它不算消失"，
   * 于是下一轮它修好之后是 UPDATE 而不是"先删再建"（后者会让它从日历上
   * 消失一轮，还会在回收站里留一条）。身份键都凑不齐时这里是 `undefined`。
   */
  readonly id?: string;
}

export type CalendarEventProjection =
  | { readonly ok: true; readonly event: CalendarEventFields }
  | CalendarEventRejection;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** 非空字符串，否则 `undefined`。Hub 用空串表示"没有这个值"，不能当有。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * 取一个时刻：优先 Hub 的 `*Ms`（它已经是数字，没有解析歧义），退回 ISO 字符串。
 *
 * ⚠️ 两者都给时**信 `*Ms`**：同一个响应里两个字段来自同一个 `startMs`（`api.ts`
 * 的 `apiEvent` 就是 `new Date(e.startMs).toISOString()`），没有取舍问题；
 * 而没有 `*Ms` 的旧响应只可能是更早的 Hub 版本。
 */
function epochMs(record: Record<string, unknown>, msKey: string, isoKey: string): number | undefined {
  const direct = finiteNumber(record[msKey]);
  if (direct !== undefined) return Math.trunc(direct);
  const iso = text(record[isoKey]);
  if (iso === undefined) return undefined;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

/**
 * 某个 UTC 时刻在**给定 IANA 时区**里是哪一天（`YYYY-MM-DD`）。
 *
 * 为什么领域层要碰 `Intl`：全天日程的"哪一天"是**事件所在时区**的哪一天，不是看的人
 * 所在时区的哪一天。只存 epoch ms 时，上海的全天日程在纽约会画到前一天，而
 * `entities.ts` 的 `startDate` 注释已经把这一格定为"全天归属的唯一判据"。
 * `Intl` 是标准库、不是框架，也没有 I/O —— 这里没有引入新的运行时依赖。
 *
 * 时区名不合法（Hub 透传上游、理论上可能给出奇怪字符串）时返回 `undefined` 而不是抛：
 * 一格派生字段算不出来，不该让整条日程被丢掉。
 */
function dayInTimeZone(epochMsValue: number, timeZone: string): LocalDate | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(epochMsValue));
    const field = (type: string): string | undefined => parts.find((part) => part.type === type)?.value;
    const year = field('year');
    const month = field('month');
    const day = field('day');
    if (year === undefined || month === undefined || day === undefined) return undefined;
    if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) return undefined;
    return `${year}-${month}-${day}`;
  } catch {
    return undefined;
  }
}

/** 参会人：飞书原始对象（`snake_case`）→ 本实体窄形状（`entities.ts` 的 `CalendarAttendee`）。 */
function attendeesOf(value: unknown): CalendarAttendee[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const mapped: CalendarAttendee[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const attendee: CalendarAttendee = {};
    const id = text(entry['attendee_id']);
    if (id !== undefined) attendee.id = id;
    const name = text(entry['display_name']);
    if (name !== undefined) attendee.name = name;
    const rsvp = text(entry['rsvp_status']);
    if (rsvp !== undefined) attendee.rsvpStatus = rsvp;
    if (typeof entry['is_optional'] === 'boolean') attendee.optional = entry['is_optional'];
    if (typeof entry['is_organizer'] === 'boolean') attendee.organizer = entry['is_organizer'];
    // 一个键都不认识的元素直接丢：保留 `{}` 会让"参会人列表"里出现看不见的行。
    if (Object.keys(attendee).length > 0) mapped.push(attendee);
  }
  return mapped;
}

/** 提醒：Hub 只给"提前多少分钟"，别的键一概不收。 */
function remindersOf(value: unknown): CalendarReminder[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const mapped: CalendarReminder[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const minutes = finiteNumber(entry['minutes']);
    if (minutes !== undefined) mapped.push({ minutesBefore: minutes });
  }
  return mapped;
}

const CALENDAR_EVENT_STATUSES: readonly CalendarEventStatus[] = ['confirmed', 'tentative', 'cancelled'];
const CALENDAR_EVENT_VISIBILITIES: readonly CalendarEventVisibility[] = ['default', 'public', 'private'];
const CALENDAR_EVENT_FREE_BUSY: readonly CalendarEventFreeBusy[] = ['free', 'busy'];

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  const given = text(value);
  return given !== undefined && (allowed as readonly string[]).includes(given) ? (given as T) : undefined;
}

/**
 * Hub `GET /api/v1/events?expand=true` 的一行 → 实体字段。
 *
 * 窄映射只收**认识的键**（Hub 设计稿 §1.2 U2/U11 列出的那些），并且只取本实体有的
 * 字段。上游 `attachments` / `meetingUrl` / `organizer` / `tags` / `orgLabel` 一律不进载荷：
 * 实体没有对应的格子，收进来就只能是"载荷里多几个没人读的键"，而它们每轮都会跟着
 * 全量快照重传（ADR-0089 §3 第 6 条的同一条推理）。
 *
 * 🔴 **本实体的 `sourceEventId` 取 Hub 的 `eventId`，不取 Hub 的 `sourceEventId`。**
 * 两者在 `expand=true` 下含义相反：Hub 把实例的 `eventId` 做成 `母id#实例起点毫秒`，
 * 而它新增的 `sourceEventId` 恰恰是**母事件**的 id（`api.ts` 的 `apiEvent`、
 * `docs/api.md`「重复日程展开」）。用后者当身份，一条周会的 20 个实例会全部落到
 * 同一个 id 上 —— 每轮互相覆盖，最后日历上只剩一个实例，且没有任何一层报错。
 *
 * 拒绝（`ok: false`）只覆盖"没有它这条就定位不了 / 画不出来"的六件事；
 * 其余（缺时区、缺参会人、缺忙闲……）都是**正常缺席**，读侧各有降级（`entities.ts`）。
 */
export function calendarEventFromHub(row: unknown): CalendarEventProjection {
  const record: Record<string, unknown> = isRecord(row) ? row : {};

  // Hub 的账户键叫 `orgId`；`accountId` 只是我们这一侧的字段名，顺带认它是为了
  // 让"以后 Hub 改名"或"测试夹具直接用实体名"都不必分叉两个函数。
  const accountId = text(record['orgId']) ?? text(record['accountId']);
  if (accountId === undefined) return { ok: false, code: 'missing-account-id' };

  const calendarId = text(record['calendarId']);
  if (calendarId === undefined) return { ok: false, code: 'missing-calendar-id' };

  const sourceEventId = text(record['eventId']);
  if (sourceEventId === undefined) return { ok: false, code: 'missing-source-event-id' };

  const originalTime = finiteNumber(record['originalTime']);
  const exceptionOriginalTime = originalTime !== undefined && originalTime > 0 ? originalTime : undefined;

  // 身份齐了就先算出 id：后面每一条拒绝都带上它，宿主管道才能把"这行坏了"与
  // "这行消失了"区分开（见 `CalendarEventRejection.id` 的注释）。
  const id = calendarEventId(accountId, calendarId, sourceEventId, exceptionOriginalTime);

  const summary = text(record['summary']);
  if (summary === undefined) return { ok: false, code: 'missing-summary', id };

  const start = epochMs(record, 'startMs', 'start');
  if (start === undefined) return { ok: false, code: 'missing-start', id };

  const end = epochMs(record, 'endMs', 'end');
  if (end === undefined) return { ok: false, code: 'missing-end', id };

  const allDay = typeof record['allDay'] === 'boolean' ? record['allDay'] : undefined;
  const timezone = text(record['timezone']);

  const event: CalendarEventFields = { id, accountId, calendarId, sourceEventId, summary, start, end };
  if (descriptionOf(record) !== undefined) event.description = descriptionOf(record);
  if (locationOf(record) !== undefined) event.location = locationOf(record);
  if (allDay !== undefined) event.allDay = allDay;
  if (timezone !== undefined) event.timezone = timezone;

  // 全天日程的"属于哪一天"只能由事件时区决定（`entities.ts` 的 `startDate` 注释）。
  // 时区缺失时**不猜**：猜成设备本地时区，就是"上海的全天日程在纽约画到前一天"。
  if (allDay === true && timezone !== undefined) {
    const startDate = dayInTimeZone(start, timezone);
    if (startDate !== undefined) event.startDate = startDate;
    // Hub 的 `endMs` 已经是 ICS 的排他语义（最后一天的次日零点，`normalize.ts:131-136`），
    // 所以它的日期**就是**排他结束日，不需要再 +1 天。
    const endDateExclusive = dayInTimeZone(end, timezone);
    if (endDateExclusive !== undefined) event.endDateExclusive = endDateExclusive;
  }

  const status = oneOf(record['status'], CALENDAR_EVENT_STATUSES);
  if (status !== undefined) event.status = status;

  const visibility = oneOf(record['visibility'], CALENDAR_EVENT_VISIBILITIES);
  if (visibility !== undefined) event.visibility = visibility;

  const freeBusy = oneOf(record['freeBusyStatus'], CALENDAR_EVENT_FREE_BUSY);
  if (freeBusy !== undefined) event.freeBusy = freeBusy;

  const recurrence = text(record['recurrence']);
  if (recurrence !== undefined) event.recurrence = recurrence;

  const recurringEventId = text(record['recurringEventId']);
  if (recurringEventId !== undefined) event.recurringEventId = recurringEventId;

  // Hub 用 `0` 表示"不是例外"（`normalize.ts:107-115`）；载荷里写 `0` 会让读侧
  // 以为"这是一条例外，原始起点是 1970 年"。
  if (exceptionOriginalTime !== undefined) event.originalTime = exceptionOriginalTime;

  // Hub 的 JSON 今天没有 `uid`（设计稿 §1.2 U10）：有就收，没有就留空。
  const uid = text(record['uid']);
  if (uid !== undefined) event.uid = uid;

  const attendees = attendeesOf(record['attendees']);
  if (attendees !== undefined) event.attendees = attendees;

  const reminders = remindersOf(record['reminders']);
  if (reminders !== undefined) event.reminders = reminders;

  return { ok: true, event };
}

function descriptionOf(record: Record<string, unknown>): string | undefined {
  return text(record['description']);
}

function locationOf(record: Record<string, unknown>): string | undefined {
  return text(record['location']);
}

// ─────────────────────────────────────────────────────────────
// 内容比较（"相同就不写 op"）
// ─────────────────────────────────────────────────────────────

/**
 * 归一成可比较的形状。
 *
 * · `null` 与"没有这个键"视为同一种：op 载荷用 `null` 表示"清掉这一格"，
 *   而 reducer 落库后那个键就**不存在**了（`op-log/src/state.ts:659-663`）。
 *   两者在这里不等价，就会每轮都判"变了"、每轮发一条空更新。
 * · 数组保序：参会人 / 提醒的顺序来自上游，重排就是内容变化（读侧按顺序画）。
 */
function canonicalValue(value: unknown): unknown {
  if (value === null) return undefined;
  if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry) ?? null);
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => [key, canonicalValue(entry)] as const)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return entries;
  }
  return value;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

/**
 * 两份投影的**内容**是否相同（忽略写入时刻与源侧时间，见字段清单的注释）。
 *
 * 🔴 这一条是"5 分钟一轮"的全部成本控制：每轮都是窗口全量快照（Hub 没有增量，
 * 设计稿 §1.2 U1），没有它，20 条日程 × 每 5 分钟 = 一天 5760 条 op。
 */
export function calendarEventEquivalent(current: CalendarEvent, next: CalendarEventFields): boolean {
  return CALENDAR_EVENT_CONTENT_FIELDS.every((field) => sameValue(current[field], next[field]));
}

/**
 * 逐字段差异 → 一条 UPDATE 的载荷；没有差异时返回 `undefined`（**不要发 op**）。
 *
 * 🔴 清空必须写 `null`，不能写 `undefined`：`undefined` 会被 `JSON.stringify` 丢掉，
 * 于是载荷里那个键**根本不存在**，对端既不会设置也不会清除 —— 源侧删掉了地点，
 * 本机与其它设备会一直显示旧地点（`app-host/src/actions.ts` 文件头第 2 条）。
 *
 * 只带改动字段（不是整行重写）：reducer 是**字段级** LWW，整行重写会让每一次
 * 无关字段的到达都把其它字段的时间戳一起推高，跨设备并发时更难收敛。
 */
export function calendarEventPatch(
  current: CalendarEvent,
  next: CalendarEventFields,
): Record<string, unknown> | undefined {
  const patch: Record<string, unknown> = {};
  for (const field of CALENDAR_EVENT_CONTENT_FIELDS) {
    const before: unknown = current[field];
    const after: unknown = next[field];
    if (sameValue(before, after)) continue;
    patch[field] = after === undefined ? null : after;
  }
  return Object.keys(patch).length === 0 ? undefined : patch;
}

// ─────────────────────────────────────────────────────────────
// 窗口与删除判定
// ─────────────────────────────────────────────────────────────

/** 一个拉取窗口（`[fromMs, toMs)`，与 Hub 的 `start_ms < to AND end_ms > from` 同语义）。 */
export interface CalendarEventWindow {
  readonly fromMs: number;
  readonly toMs: number;
}

/**
 * 默认窗口：过去 14 天、未来 60 天（Hub 设计稿 §4.2）。
 *
 * ⚠️ 由 heyta 自己给，**不依赖 Hub 的默认值**（它今天恰好也是 14/60，
 * 但那是一份会自己漂的抄件）。
 */
export const CALENDAR_EVENT_WINDOW_PAST_MS = 14 * 86_400_000;
export const CALENDAR_EVENT_WINDOW_FUTURE_MS = 60 * 86_400_000;

/**
 * 窗口的稳定字符串键。
 *
 * 两个用处，都是"别把上一轮的结论用到这一轮"：① 存 META 时标识"上一轮窗口是哪一段"；
 * ② 条件请求前比对 —— 窗口一变，上一轮那个 ETag 就不再代表"这份内容"，
 * 拿它去 `If-None-Match` 只会得到一个不属于本窗口的 304。
 */
export function calendarEventWindowKey(window: CalendarEventWindow): string {
  return `${String(window.fromMs)}:${String(window.toMs)}`;
}

/**
 * 两轮窗口的交集 —— 删除判定的**唯一**范围（Hub 设计稿 §4.3）。
 *
 * 没有上一轮窗口（第一次运行 / 缓存被清）时返回 `undefined`：那时"上轮没见过"
 * 是**没有信息**，不是"上一轮它不在"，所以一轮都不许删。
 */
export function calendarEventWindowIntersection(
  previous: CalendarEventWindow | undefined,
  current: CalendarEventWindow,
): CalendarEventWindow | undefined {
  if (previous === undefined) return undefined;
  const fromMs = Math.max(previous.fromMs, current.fromMs);
  const toMs = Math.min(previous.toMs, current.toMs);
  return toMs > fromMs ? { fromMs, toMs } : undefined;
}

/** META 里存下来的窗口（JSON）→ 窗口；坏形状或坏 JSON 都当"没有上一轮"。 */
export function parseCalendarEventWindow(value: unknown): CalendarEventWindow | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = typeof value === 'string' ? safeParse(value) : value;
  if (!isRecord(raw)) return undefined;
  const fromMs = finiteNumber(raw['fromMs']);
  const toMs = finiteNumber(raw['toMs']);
  if (fromMs === undefined || toMs === undefined || toMs <= fromMs) return undefined;
  return { fromMs, toMs };
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

/** 判删需要的上下文。 */
export interface CalendarEventPruneContext {
  /**
   * 本轮**确实见过**的 id（含"这一行坏了但身份凑齐了"的那些）。
   *
   * 含后者的理由是具体的：一条日程的标题被清空 ⇒ 本轮它过不了投影校验 ⇒
   * 若不在这个集合里，它会被判"消失"并进回收站。而真相是它还在，只是这一轮
   * 读不成实体。下一轮标题修好，它又出现 —— 用户看到的是"这条会议反复进回收站"。
   */
  readonly presentIds: ReadonlySet<string>;
  /** 上一轮与本轮窗口的**交集**。判删只在这段里做。 */
  readonly window: CalendarEventWindow;
}

/**
 * 这一条该不该写 `deletedAt`。
 *
 * 三条前提，缺一条就**不删**（宁可留一条旧的，也不误删一条真的）：
 *
 *   1. 本轮没见过它（`presentIds` 里没有）；
 *   2. 它**与交集窗口有重叠**（`start < to && end > from`，与 Hub 的
 *      `store.listEvents` 同一判据）。这一条是整段逻辑的关键：凡是与交集重叠的行，
 *      在两轮里**都必然被返回**（交集 ⊆ 两轮窗口），所以"这轮没返回"才等价于
 *      "源侧真的没了"。而窗口边缘滑出去的那些日程与交集不重叠 ⇒ 一律不判删 ——
 *      这正是"每天误删边界上的一天"那个 bug 的正面判据；
 *   3. 它不是母事件。Hub 对 `recurrence <> ''` 的行**不受窗口限制地总是返回**
 *      （设计稿 §1.2 U5），所以"这轮没返回"对母事件只可能是别的原因；拿它当删除
 *      证据，一次窗口滑动就会把整条重复日程判死。
 *
 * 另外两条**不删**：已经带 `deletedAt` 的（幂等，别每轮刷新墓碑时间），以及
 * 起止缺失的（定位不了，不能拿"算不出来"当"没了"）。
 */
export function calendarEventShouldDelete(
  event: CalendarEvent,
  context: CalendarEventPruneContext,
): boolean {
  if (context.presentIds.has(event.id)) return false;
  if (event.deletedAt !== undefined) return false;
  if ((event.recurrence ?? '') !== '') return false;
  if (event.start === undefined || event.end === undefined) return false;
  return event.start < context.window.toMs && event.end > context.window.fromMs;
}
