/**
 * iCalendar（RFC 5545 子集）解析 · 订阅拉取 · 连接器实现
 * ======================================================
 *
 * 只解析 heyta 需要的部分：`VEVENT` 里的 `UID / SUMMARY / DESCRIPTION / LOCATION /
 * DTSTART / DTEND / DURATION / RRULE / STATUS`。**不引第三方库**（许可证与维护性门槛，
 * AGENTS §3.1/3.2），手写行级解析，够用且可测。
 *
 * ## 为什么自己写解析
 *
 * ICS 是行协议：`NAME;PARAM=V:value`，折行用「行首一个空格/Tab」续行。这点语法自己实现
 * 比引一个大库更可控；而真正的坑（时区、全天、DTEND 排他、折行）都在下面的单元测试里钉住。
 *
 * ## 明确的边界（v1）
 *
 * · **不展开 RRULE**：带 `RRULE` 的事件按母事件本身的 `DTSTART` 收一条，`recurrence`
 *   原样带给上层（上层若将来支持展开再处理）。这不是"悄悄丢掉"，见返回值 `skipped` 外
 *   的 `recurring` 计数。
 * · 时区换算只做 `TZID` 的「本地墙钟 → UTC」，用 `Intl` 迭代求偏移，无额外依赖。
 * · 全天事件以 `YYYYMMDD` 表达；`DTEND` 沿用 ICS **排他**语义。
 */

import { ConnectorError } from './types.js';
import type {
  Connector,
  ConnectorMetadata,
  ConnectorResource,
  FetchedItem,
  SyncCursor,
} from './types.js';

/** 一行解析出的属性。 */
interface IcsProperty {
  readonly name: string;
  readonly params: Readonly<Record<string, string>>;
  readonly value: string;
}

/** 归一后的事件（时间均已转成 epoch ms）。 */
export interface IcsEvent {
  readonly uid?: string;
  readonly summary: string;
  readonly description?: string;
  readonly location?: string;
  readonly start: number;
  readonly end: number;
  readonly allDay: boolean;
  readonly timezone?: string;
  /** RRULE 原文（**不带** `RRULE:` 前缀）；有值说明是重复事件。 */
  readonly rrule?: string;
  readonly status?: 'confirmed' | 'tentative' | 'cancelled';
}

export type IcsParseResult =
  | { readonly ok: true; readonly events: readonly IcsEvent[]; readonly skipped: number; readonly recurring: number }
  | { readonly ok: false; readonly reason: 'not-calendar' | 'empty' };

/** 把折行（行首空格/Tab）还原成逻辑行。 */
function unfold(text: string): string[] {
  const raw = text.split(/\r\n|\n|\r/);
  const lines: string[] = [];
  for (const line of raw) {
    if (line.startsWith(' ') || line.startsWith('\t')) {
      lines[lines.length - 1] = (lines[lines.length - 1] ?? '') + line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

/** 解析 `NAME;P=V;P=V:value`。冒号取**第一个不在引号内**的位置。 */
function parseProperty(line: string): IcsProperty | undefined {
  let colon = -1;
  let inQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ':' && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return undefined;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = head.split(';');
  const name = (parts[0] ?? '').trim().toUpperCase();
  if (name === '') return undefined;
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    params[part.slice(0, eq).trim().toUpperCase()] = part.slice(eq + 1).trim().replace(/^"|"$/g, '');
  }
  return { name, params, value };
}

/** 反转义 iCalendar 文本值。 */
function unescapeText(value: string): string {
  return value
    .replace(/\\[nN]/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/** 某时区在某 UTC 时刻的偏移（毫秒）。用 `Intl` 求，无第三方依赖。 */
function tzOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // `hour` 在 hour12:false 下可能给出 24，归一到 0。
  const hour = get('hour') % 24;
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return asUtc - utcMs;
}

/** 把「某时区的墙钟时间」换算成 UTC 毫秒（迭代两次求偏移，覆盖 DST 边界）。 */
function zonedWallToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  timeZone: string,
): number {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  let guess = wall;
  for (let i = 0; i < 2; i += 1) {
    const offset = tzOffsetMs(guess, timeZone);
    guess = wall - offset;
  }
  return guess;
}

interface ParsedDate {
  readonly ms: number;
  readonly allDay: boolean;
  readonly timeZone?: string;
}

/** 解析 `DTSTART` / `DTEND` 的值。 */
function parseDate(prop: IcsProperty): ParsedDate | undefined {
  const value = prop.value.trim();
  const tzid = prop.params['TZID'];
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly !== null) {
    const ms = Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return { ms, allDay: true, ...(tzid === undefined ? {} : { timeZone: tzid }) };
  }
  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (dateTime !== null) {
    const [y, mo, d, h, mi, s] = [
      Number(dateTime[1]),
      Number(dateTime[2]),
      Number(dateTime[3]),
      Number(dateTime[4]),
      Number(dateTime[5]),
      Number(dateTime[6]),
    ];
    if (dateTime[7] === 'Z') {
      return { ms: Date.UTC(y, mo - 1, d, h, mi, s), allDay: false, ...(tzid === undefined ? {} : { timeZone: tzid }) };
    }
    if (tzid !== undefined) {
      return { ms: zonedWallToUtc(y, mo, d, h, mi, s, tzid), allDay: false, timeZone: tzid };
    }
    // 浮动时间没有时区：按 UTC 处理（确定性优先），并记成 UTC 供上层派生日期。
    return { ms: Date.UTC(y, mo - 1, d, h, mi, s), allDay: false, timeZone: 'UTC' };
  }
  return undefined;
}

/** 解析 ISO-8601 duration（`P1W` / `PT1H30M` …）为毫秒。 */
function parseDuration(value: string): number | undefined {
  const match = /^(-)?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (match === null) return undefined;
  const sign = match[1] === '-' ? -1 : 1;
  const [w, d, h, mi, s] = [match[2], match[3], match[4], match[5], match[6]].map((part) =>
    part === undefined ? 0 : Number(part),
  );
  const ms = (((Number(w) * 7 + Number(d)) * 24 + Number(h)) * 60 + Number(mi)) * 60_000 + Number(s) * 1000;
  return sign * ms;
}

function statusOf(value: string | undefined): IcsEvent['status'] {
  switch ((value ?? '').trim().toUpperCase()) {
    case 'CONFIRMED':
      return 'confirmed';
    case 'TENTATIVE':
      return 'tentative';
    case 'CANCELLED':
      return 'cancelled';
    default:
      return undefined;
  }
}

/** 解析一份 ICS 文本。 */
export function parseIcs(text: string): IcsParseResult {
  if (!/BEGIN:VCALENDAR/i.test(text)) return { ok: false, reason: 'not-calendar' };
  const lines = unfold(text);

  const events: IcsEvent[] = [];
  let skipped = 0;
  let recurring = 0;
  let props: IcsProperty[] = [];
  let inEvent = false;

  const flush = (): void => {
    if (props.length === 0) return;
    const byName = new Map<string, IcsProperty>();
    for (const prop of props) byName.set(prop.name, prop);
    const summaryProp = byName.get('SUMMARY');
    const startProp = byName.get('DTSTART');
    const endProp = byName.get('DTEND');
    const durationProp = byName.get('DURATION');

    if (summaryProp === undefined || startProp === undefined) {
      skipped += 1;
      return;
    }
    const summary = unescapeText(summaryProp.value).trim();
    const start = parseDate(startProp);
    if (summary === '' || start === undefined) {
      skipped += 1;
      return;
    }

    const end = endProp !== undefined ? parseDate(endProp) : undefined;
    let endMs: number;
    if (end !== undefined) {
      endMs = end.ms;
    } else if (durationProp !== undefined) {
      const duration = parseDuration(durationProp.value);
      endMs = start.ms + (duration ?? (start.allDay ? 86_400_000 : 0));
    } else {
      endMs = start.ms + (start.allDay ? 86_400_000 : 0);
    }

    const rrule = byName.get('RRULE')?.value.trim();
    if (rrule !== undefined && rrule !== '') recurring += 1;

    const uid = byName.get('UID')?.value.trim();
    const description = byName.get('DESCRIPTION');
    const location = byName.get('LOCATION');

    const event: IcsEvent = {
      summary,
      start: start.ms,
      end: endMs,
      allDay: start.allDay,
      // 全天且无 TZID：显式给 UTC，上层才能按"事件时区"派生 startDate（否则会漏）。
      timezone: start.timeZone ?? (start.allDay ? 'UTC' : undefined),
      ...(uid === undefined || uid === '' ? {} : { uid }),
      ...(description === undefined ? {} : { description: unescapeText(description.value) }),
      ...(location === undefined ? {} : { location: unescapeText(location.value) }),
      ...(rrule === undefined || rrule === '' ? {} : { rrule }),
      ...(statusOf(byName.get('STATUS')?.value) === undefined
        ? {}
        : { status: statusOf(byName.get('STATUS')?.value) }),
    };
    events.push(event);
    props = [];
  };

  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper === 'BEGIN:VEVENT') {
      inEvent = true;
      props = [];
      continue;
    }
    if (upper === 'END:VEVENT') {
      inEvent = false;
      flush();
      continue;
    }
    if (!inEvent) continue;
    const prop = parseProperty(line);
    if (prop !== undefined) props.push(prop);
  }

  if (events.length === 0 && skipped === 0) return { ok: false, reason: 'empty' };
  return { ok: true, events, skipped, recurring };
}

/** 拉取一份 ICS 文本（GET，不带本应用 cookie）。 */
export async function fetchIcsText(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; text: string } | { ok: false; cause: 'network' | 'http-status' | 'bad-shape' }> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'text/calendar, text/plain, */*' },
      credentials: 'omit',
    });
  } catch {
    return { ok: false, cause: 'network' };
  }
  if (!response.ok) return { ok: false, cause: 'http-status' };
  let text: string;
  try {
    text = await response.text();
  } catch {
    return { ok: false, cause: 'bad-shape' };
  }
  if (!/BEGIN:VCALENDAR/i.test(text)) return { ok: false, cause: 'bad-shape' };
  return { ok: true, text };
}

export interface IcsConnectorConfig {
  readonly feedUrl: string;
}

/** 一个 ICS 订阅的 `FetchedItem`：`content` 是 `IcsEvent` 的 JSON。 */
function toItem(event: IcsEvent, index: number): FetchedItem {
  const externalId = event.uid ?? `${String(event.start)}:${event.summary}:${String(index)}`;
  return {
    externalId,
    title: event.summary,
    content: JSON.stringify(event),
    contentType: 'application/json',
    updatedAt: event.start,
  };
}

/**
 * ICS 连接器（实现通用 `Connector`）。
 *
 * `fetchAll` / `fetchIncremental` 都是「拉整份 feed 再投影」—— feed 天然是全量快照，
 * 增量只是上层去抖的辅助（真正去抖由日历管道按内容比完成）。
 */
export function createIcsConnector(
  options: { readonly fetchImpl?: typeof fetch } = {},
): Connector<IcsConnectorConfig> & { metadata: ConnectorMetadata } {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const load = async (config: IcsConnectorConfig): Promise<readonly IcsEvent[]> => {
    const url = config.feedUrl.trim();
    if (url === '') throw new ConnectorError('invalid_config', 'feedUrl is empty');
    const fetched = await fetchIcsText(url, fetchImpl);
    if (!fetched.ok) {
      throw new ConnectorError(
        fetched.cause === 'network' ? 'fetch_failed' : fetched.cause === 'http-status' ? 'invalid_credentials' : 'bad_shape',
      );
    }
    const parsed = parseIcs(fetched.text);
    if (!parsed.ok) throw new ConnectorError('bad_shape', parsed.reason);
    return parsed.events;
  };

  const connector: Connector<IcsConnectorConfig> = {
    type: 'ics',
    async validate(config): Promise<void> {
      await load(config);
    },
    async listResources(config): Promise<readonly ConnectorResource[]> {
      return [{ externalId: 'feed', name: config.feedUrl, type: 'calendar', hasChildren: false }];
    },
    async fetchAll(config): Promise<readonly FetchedItem[]> {
      const events = await load(config);
      return events.map((event, index) => toItem(event, index));
    },
    async fetchIncremental(
      config,
      cursor,
    ): Promise<{ readonly items: readonly FetchedItem[]; readonly cursor: SyncCursor }> {
      const events = await load(config);
      const items = events.map((event, index) => toItem(event, index));
      const previous = (cursor?.connectorCursor['byId'] as Record<string, string> | undefined) ?? {};
      const byId: Record<string, string> = {};
      const changed: FetchedItem[] = [];
      for (const item of items) {
        const fingerprint = item.content;
        byId[item.externalId] = fingerprint;
        if (previous[item.externalId] !== fingerprint) changed.push(item);
      }
      return {
        items: changed,
        cursor: { lastSyncTime: Date.now(), connectorCursor: { byId }, schemaVersion: 1 },
      };
    },
  };

  return Object.assign(connector, {
    metadata: {
      type: 'ics',
      name: 'iCalendar 订阅（ICS/URL）',
      description: '订阅一个 .ics / webcal 日历链接，只读同步到 heyta 日历',
      authType: 'custom',
      capabilities: ['incremental'],
      priority: 20,
    } satisfies ConnectorMetadata,
  });
}
