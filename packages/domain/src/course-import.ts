/**
 * 课表导入 —— 纯解析（ICS / CSV → CourseRow[]）+ 稳定 key + Habit 载荷映射
 * ========================================================================
 *
 * 只做"文本 → 归一化行"的纯函数，不碰 IO、不碰 op-log、不碰 i18n。
 * 落库由 `@heyta/app-host` 的导入动作负责（一个导入 = 一串 HABIT Create，稳定去重）。
 *
 * 设计对齐仓库已有的「滴答导入」形状：解析层产出中间行，导入层算计划+报告（守恒律），
 * 写入口唯一。课表来源按调研优先级：**ICS（账号无关、合规最好）→ CSV（WakeUp/教务导出）**；
 * 不做教务账号密码抓取（合规/维护地狱），也更不做绕过验证码。
 *
 * 🔴 许可证：ICS 解析复用仓库已依赖的 `ical.js`（MPL-2.0，白名单允许）；
 *   未复制任何无 LICENSE / GPL 的课表项目代码（WakeUp 等仅作"字段口径"参考）。
 */

import ICAL from 'ical.js';

import { isoWeek, type LocalDate } from './date.js';

/** 归一化后的一门课（可能对应一周里的多个星期）。 */
export interface CourseRow {
  readonly name: string;
  readonly teacher?: string;
  readonly location?: string;
  /** 1=周一 … 7=周日（ISO）。 */
  readonly daysOfWeek: number[];
  /** 起始时刻 `HH:mm`；无则视为全天课。 */
  readonly startTime?: string;
  readonly endTime?: string;
  /** 周次范围，1 起算、含端点。 */
  readonly weeks?: { start: number; end: number };
  readonly parity?: 'all' | 'odd' | 'even';
}

const BYDAY_TO_ISO: Record<string, number> = {
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
  SU: 7,
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function hhmm(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}
function icalTimeToDate(t: ICAL.Time): LocalDate {
  return `${t.year}-${pad2(t.month)}-${pad2(t.day)}` as LocalDate;
}

/**
 * 解析 ICS/iCalendar 文本 → 课程行。逐 VEVENT 取：SUMMARY(课程名)、LOCATION(教室)、
 * DESCRIPTION(教师，若含「教师/老师:」前缀)、DTSTART(首节课时刻)、DTEND(下课时刻)、
 * RRULE(BYDAY/INTERVAL/UNTIL)。解析失败抛错（由导入层转成报告里的跳过）。
 */
export function parseCourseICS(text: string): CourseRow[] {
  const jcal = ICAL.parse(text);
  const root = new ICAL.Component(jcal);
  const comps: ICAL.Component[] = root.name === 'vcalendar' ? root.getAllSubcomponents('vevent') : [root];
  const rows: CourseRow[] = [];
  for (const ve of comps) {
    if (ve.name !== 'vevent') continue;
    const summary = (ve.getFirstPropertyValue('summary') as string | null) ?? '';
    const name = String(summary).trim();
    if (name === '') continue;
    const locationRaw = ve.getFirstPropertyValue('location');
    const location = locationRaw === null || locationRaw === undefined ? undefined : String(locationRaw).trim() || undefined;
    const desc = ve.getFirstPropertyValue('description');
    const teacher = extractTeacher(desc === null || desc === undefined ? undefined : String(desc));

    const start = ve.getFirstPropertyValue('dtstart');
    if (!(start instanceof ICAL.Time)) continue;
    const startTime = hhmm(start.hour, start.minute);
    const endProp = ve.getFirstPropertyValue('dtend');
    const endTime = endProp instanceof ICAL.Time ? hhmm(endProp.hour, endProp.minute) : undefined;

    const rruleRaw = ve.getFirstPropertyValue('rrule');
    let daysOfWeek: number[] = [icalDowToIso(start.dayOfWeek())];
    let weeks: { start: number; end: number } | undefined;
    let parity: 'all' | 'odd' | 'even' = 'all';
    if (rruleRaw instanceof ICAL.Recur) {
      const byday = (rruleRaw.parts && (rruleRaw.parts.BYDAY as string[] | undefined)) ?? undefined;
      if (byday !== undefined && byday.length > 0) {
        const mapped = byday.map((d) => BYDAY_TO_ISO[String(d).slice(-2).toUpperCase()]).filter((x): x is number => x !== undefined);
        if (mapped.length > 0) daysOfWeek = mapped;
      }
      const startWeek = isoWeek(icalTimeToDate(start));
      const until = rruleRaw.until;
      if (until instanceof ICAL.Time) {
        weeks = { start: startWeek, end: Math.max(startWeek, isoWeek(icalTimeToDate(until))) };
      }
      if (rruleRaw.interval === 2) parity = startWeek % 2 === 1 ? 'odd' : 'even';
    }

    rows.push({
      name,
      ...(teacher === undefined ? {} : { teacher }),
      ...(location === undefined ? {} : { location }),
      daysOfWeek: [...new Set(daysOfWeek)].sort((a, b) => a - b),
      ...(startTime === undefined ? {} : { startTime }),
      ...(endTime === undefined ? {} : { endTime }),
      ...(weeks === undefined ? {} : { weeks }),
      ...(parity === 'all' ? {} : { parity }),
    });
  }
  return rows;
}

function icalDowToIso(dow: number): number {
  // ICAL.Time.dayOfWeek(): 1=周日 … 7=周六 → ISO 1=周一 … 7=周日
  return ((dow + 5) % 7) + 1;
}

function extractTeacher(desc: string | undefined): string | undefined {
  if (desc === undefined) return undefined;
  const m = /(?:教师|老师|teacher)\s*[:：]\s*([^\n,，;；]+)/i.exec(desc);
  return m ? m[1]!.trim() : undefined;
}

/** 星期列（`1`/`一`/`Mon`/`星期一`）→ ISO 1–7。无法识别返回 undefined。 */
function parseWeekdayCell(raw: string): number | undefined {
  const s = raw.trim();
  const num = Number(s);
  if (Number.isInteger(num) && num >= 1 && num <= 7) return num; // 1=周一…7=周日
  const zh = s.replace(/^(星期|周)/, '');
  const zhMap: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
  if (zhMap[zh] !== undefined) return zhMap[zh];
  const en = s.slice(0, 3).toUpperCase();
  const enMap: Record<string, number> = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 7 };
  return enMap[en];
}

/** 时间列（`08:00` / `8:00` / `0800`）→ `HH:mm`。 */
function normalizeHm(raw: string): string | undefined {
  const s = raw.trim();
  let m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m) {
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) return hhmm(h, mi);
    return undefined;
  }
  m = /^(\d{2})(\d{2})$/.exec(s);
  if (m) {
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) return hhmm(h, mi);
  }
  return undefined;
}

/** 周次列（`1-16` / `1-16周` / `3-15单周`）→ weeks + parity。 */
function parseWeeksCell(raw: string): { weeks?: { start: number; end: number }; parity?: 'all' | 'odd' | 'even' } {
  const s = raw.trim();
  if (s === '') return {};
  const m = /(\d{1,2})\s*[-~—]\s*(\d{1,2})/.exec(s);
  let weeks: { start: number; end: number } | undefined;
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a >= 1 && b >= a) weeks = { start: a, end: b };
  }
  let parity: 'all' | 'odd' | 'even' | undefined;
  if (/单/.test(s)) parity = 'odd';
  else if (/双/.test(s)) parity = 'even';
  return { ...(weeks === undefined ? {} : { weeks }), ...(parity === undefined ? {} : { parity }) };
}

/**
 * 解析 CSV 文本 → 课程行。表头按常见中文/英文列名识别（课程名/教师/教室/星期/开始/结束/周次），
 * 缺列时按位置兜底（name, teacher, location, weekday, start, end, weeks）。空名行跳过。
 */
export function parseCourseCSV(text: string): CourseRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  return matrixToCourseRows(lines.map((line) => parseCsvLine(line)));
}

/** 把二维表（首行表头）→ 课程行。CSV 与 XLSX 共用这一份，避免"两种格式两种列口径"。 */
function matrixToCourseRows(matrix: string[][]): CourseRow[] {
  const lines = matrix.filter((r) => r.some((c) => c.trim() !== ''));
  if (lines.length === 0) return [];
  const split = (row: string[]): string[] => row;
  const header = split(lines[0]!).map((h) => h.trim().toLowerCase());
  const idx = {
    name: findCol(header, ['课程名称', '课程名', '课程', 'name', 'course', 'subject']),
    teacher: findCol(header, ['教师', '老师', 'teacher']),
    location: findCol(header, ['教室', '地点', 'location', 'room']),
    day: findCol(header, ['星期', '周几', 'day', 'weekday']),
    start: findCol(header, ['开始时间', '开始', '起始时间', 'start']),
    end: findCol(header, ['结束时间', '结束', 'end']),
    weeks: findCol(header, ['周次', '周数', 'weeks', 'week']),
  };
  const hasHeader = idx.name >= 0 && idx.day >= 0;
  const body = hasHeader ? lines.slice(1) : lines;
  const rows: CourseRow[] = [];
  for (const line of body) {
    const cells = split(line);
    const get = (col: number, fallbackPos: number): string => {
      const i = col >= 0 ? col : fallbackPos;
      return (cells[i] ?? '').trim();
    };
    // 有表头按列取；无表头按位置：name,teacher,location,weekday,start,end,weeks
    const name = hasHeader ? get(idx.name, 0) : (cells[0] ?? '').trim();
    if (name === '') continue;
    const teacher = hasHeader ? get(idx.teacher, 1) : (cells[1] ?? '').trim();
    const location = hasHeader ? get(idx.location, 2) : (cells[2] ?? '').trim();
    const dayCell = hasHeader ? get(idx.day, 3) : (cells[3] ?? '').trim();
    const startCell = hasHeader ? get(idx.start, 4) : (cells[4] ?? '').trim();
    const endCell = hasHeader ? get(idx.end, 5) : (cells[5] ?? '').trim();
    const weeksCell = hasHeader ? get(idx.weeks, 6) : (cells[6] ?? '').trim();
    const day = parseWeekdayCell(dayCell);
    const startTime = startCell === '' ? undefined : normalizeHm(startCell);
    const endTime = endCell === '' ? undefined : normalizeHm(endCell);
    const { weeks, parity } = parseWeeksCell(weeksCell);
    rows.push({
      name,
      ...(teacher === '' ? {} : { teacher }),
      ...(location === '' ? {} : { location }),
      daysOfWeek: day === undefined ? [] : [day],
      ...(startTime === undefined ? {} : { startTime }),
      ...(endTime === undefined ? {} : { endTime }),
      ...(weeks === undefined ? {} : { weeks }),
      ...(parity === undefined ? {} : { parity }),
    });
  }
  return rows;
}

function findCol(header: string[], names: string[]): number {
  for (let i = 0; i < header.length; i += 1) {
    if (names.some((n) => header[i] === n.toLowerCase() || header[i]!.includes(n.toLowerCase()))) return i;
  }
  return -1;
}

/** 简单 CSV 拆分（支持双引号包裹与 `""` 转义）。 */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** 稳定去重 key：name|teacher|days|startTime —— 同一文件导两次不产生重复。 */
export function courseKey(row: CourseRow): string {
  const norm = [row.name.trim().toLowerCase(), (row.teacher ?? '').trim().toLowerCase(), row.daysOfWeek.join('.'), row.startTime ?? '', row.location ?? ''].join('|');
  // djb2
  let h = 5381;
  for (let i = 0; i < norm.length; i += 1) h = ((h << 5) + h + norm.charCodeAt(i)) >>> 0;
  return `course-${h.toString(16)}`;
}

export interface CourseImportReport {
  readonly total: number;
  readonly ok: number;
  readonly skipped: number;
  /** 跳过的原因（逐行），用于预览页如实报告。 */
  readonly skipReasons: readonly string[];
}

export interface CourseImportPlan {
  readonly rows: readonly CourseRow[];
  readonly report: CourseImportReport;
}

/**
 * 把解析结果整理成导入计划：去掉无名/无星期行，按 `courseKey` 去重（保留首次出现），
 * 报告里满足守恒律 `total = ok + skipped`。
 */
export function planCourseImport(rawRows: readonly CourseRow[]): CourseImportPlan {
  const seen = new Set<string>();
  const rows: CourseRow[] = [];
  const skipReasons: string[] = [];
  for (const row of rawRows) {
    if (row.name.trim() === '') {
      skipReasons.push('缺少课程名');
      continue;
    }
    if (row.daysOfWeek.length === 0) {
      skipReasons.push(`「${row.name}」缺少星期`);
      continue;
    }
    const key = courseKey(row);
    if (seen.has(key)) {
      skipReasons.push(`「${row.name}」重复`);
      continue;
    }
    seen.add(key);
    rows.push(row);
  }
  const total = rawRows.length;
  const ok = rows.length;
  return { rows, report: { total, ok, skipped: total - ok, skipReasons } };
}

/**
 * 从**教务系统网页 HTML**里"一键识别"课程行（应用内浏览器登录后，抓到当前 DOM 交给这里）。
 *
 * 只做一个通用提取：找出含「课程/星期」表头的 `<table>`，把每行每格文本拼成二维表，
 * 再走与 CSV/XLSX 同一套 `matrixToCourseRows`。各校页面结构差异大，命中不了的返回空数组
 * （由导入层如实报"0 行"），**不做**任何猜测式填充。密码/登录态由应用内浏览器持有，不经过这里。
 */
export function parseCourseHTML(html: string): CourseRow[] {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  const candidates = tables.length > 0 ? tables : [html];
  let best: CourseRow[] = [];
  for (const table of candidates) {
    const matrix = htmlTableToMatrix(table);
    if (matrix.length === 0) continue;
    const looksLikeTimetable = matrix.some((row) => {
      const joined = row.join(' ');
      return /课程|科目|course/i.test(joined) && /星期|周几|节次|时段|day|time/i.test(joined);
    });
    if (!looksLikeTimetable) continue;
    const rows = matrixToCourseRows(matrix);
    if (rows.length > best.length) best = rows;
  }
  return best;
}

/** `<table>` → 二维文本表（按 `<tr>`/`<td|th>` 拆，剥标签、解常见实体、去空白）。 */
function htmlTableToMatrix(tableHtml: string): string[][] {
  const rows = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const out: string[][] = [];
  for (const rowHtml of rows) {
    const cells = rowHtml.match(/<(td|th)[\s\S]*?<\/\1>/gi) ?? [];
    if (cells.length === 0) continue;
    out.push(cells.map((c) => cellText(c)));
  }
  return out;
}

function cellText(cellHtml: string): string {
  return cellHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
