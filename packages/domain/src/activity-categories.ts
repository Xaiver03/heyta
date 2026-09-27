/**
 * 活动分类与分类时长归因
 * ========================
 *
 * 回答的问题：**这周那 40 小时，分别花在哪些活动上了？**
 *
 * 这一层是"分类着色"这个特性的**全部工程量**（见 `docs/plans/activity-categories-and-colors.md` §4）：
 * 颜色只是最后的表面 —— 没有归因，颜色无处可上。
 *
 * ## 归因链（**零新增字段**，全部复用既有可选字段）
 *
 * ```
 * FOCUS_SESSION.taskId  →  TASK.projectId  →  PROJECT.color
 * HABIT_LOG(habitId) + HABIT.unit='分钟'  →  HABIT.color
 * ```
 *
 * ⚠️ 归不了类的（`taskId` 为空、或任务不属于任何清单）**不计入任何分类**，
 * 但也不假装它不存在 —— 汇总里的 `unassignedMs` 就是它，界面可以如实说出来。
 * 把它塞进某个分类才是真的丢信息。
 *
 * ## 🔴 三条口径，全部与既有模块对齐（漂移的两个数字比一个不准的数字糟得多）
 *
 * 1. **只有 `kind === 'work'` 的专注算数**（休息不是专注成果）—— 与 `focus.ts` 一致。
 * 2. **落在哪一天看 `focusSessionDay`（结束时刻）** —— 与 `focus.ts` 一致。
 * 3. **软删除的实体不算数**（撤回了就是没发生）—— 与 `milestones.ts` 一致。
 *
 * ## 🔴 这一层不产出任何文案
 *
 * 返回的是**毫秒数**。措辞（「1 小时 20 分钟」「这周 12 小时」）归各壳的词条表 ——
 * 否则中英双语无法落地，而且会让"统计口径"和"怎么念它"焊死在一起。
 */

import type { FocusSession, Habit, HabitLog, Project, Task } from './entities.js';
import { addDays, diffDays, isoWeekday, toLocalDate, type LocalDate } from './date.js';
import { focusSessionDay } from './focus.js';

// ─────────────────────────────────────────────────────────────
// 色槽位
// ─────────────────────────────────────────────────────────────

/**
 * 可用的色槽位。
 *
 * **数据里存的是这个数字，不是颜色。** 存的必须是**不变量**（"第 3 号槽位"），
 * 而不是"长什么样"（`#dc2626`）—— 后者跟不了暗色主题、过不了对比度保证，
 * 还会把用户数据焊死在某一版调色板上。改调色板不该动磁盘上的旧数据。
 *
 * 为什么是 8 个：少于此不足以满足"分很细致"，多于此无法保证两两可区分
 * （区分性由 `@heyta/design-system` 的测试实算保证，不是靠眼睛）。
 */
export const CATEGORY_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export type CategorySlot = (typeof CATEGORY_SLOTS)[number];

/**
 * 把持久化字段里的值读成槽位号。
 *
 * 🔴 **不认识的值一律当作"没有颜色"**，不是回退到 1 号槽位、也不抛错：
 * 磁盘上已经有、且将来还会有别的写入方（更老的版本、别的壳、别人手改的数据）。
 * 回退到 1 号会让一堆互不相关的活动悄悄变成同一个颜色 —— 那比无色糟得多。
 *
 * 只认裸槽位号（`"3"` 或 `3`）。`"#dc2626"`、`"red"`、`"03"` 全都返回 `undefined`。
 */
export function parseCategorySlot(raw: unknown): CategorySlot | undefined {
  if (typeof raw === 'number') {
    return CATEGORY_SLOTS.find((slot) => slot === raw);
  }
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!/^[1-8]$/.test(trimmed)) return undefined;
  return CATEGORY_SLOTS.find((slot) => slot === Number(trimmed));
}

// ─────────────────────────────────────────────────────────────
// 归因
// ─────────────────────────────────────────────────────────────

/** 分类的来源：清单（经任务）或习惯。**标签不参与时长归类**（见下）。 */
export type CategoryKind = 'project' | 'habit';

/**
 * 习惯的哪些单位算"分钟"。
 *
 * `Habit.unit` 是用户自由填的文本（`entities.ts` 里就是这么写的），
 * 所以这里只能认一组已知写法。**不认识的单位 = 不贡献时长**，不是猜。
 *
 * ⚠️ 刻意**不**把「秒」「小时」放进来：那需要一张换算表，而换算表一旦开始
 * 就会有人想加「页」「杯 → 分钟」这种需要额外假设的换算。宁可少一种，
 * 也不要一个猜出来的数 —— 猜出来的数会直接进用户的周报。
 */
const MINUTE_UNITS: ReadonlySet<string> = new Set([
  '分钟',
  '分',
  'min',
  'mins',
  'minute',
  'minutes',
]);

export function isMinuteUnit(unit: string | undefined): boolean {
  if (unit === undefined) return false;
  return MINUTE_UNITS.has(unit.trim().toLowerCase());
}

/** 一条打卡记录贡献多少分钟。单位不是分钟、或没有值可算时为 `undefined`。 */
export function habitLogMinutes(habit: Habit, log: HabitLog): number | undefined {
  if (!isMinuteUnit(habit.unit)) return undefined;
  // 没填 value 时退到 target（与 `focusStatsForDay` 里 `actualMs ?? plannedMs` 同一手法：
  // 缺省当 0 会把"打了卡"显示成"没打"，退到目标值更接近真相）。
  const minutes = log.value ?? habit.target;
  if (minutes === undefined || !Number.isFinite(minutes) || minutes <= 0) return undefined;
  return minutes;
}

// ─────────────────────────────────────────────────────────────
// 报告
// ─────────────────────────────────────────────────────────────

/** 报告窗口里的一周（周一起算，与 `weekWindowOf` 同口径）。 */
export interface CategoryWeek {
  /** 周一，`YYYY-MM-DD`（本地）。 */
  start: LocalDate;
  /** 周日，`YYYY-MM-DD`（本地）。 */
  end: LocalDate;
  /** 这一周所有分类的时长合计（ms），不含 `unassignedMs`。 */
  totalMs: number;
}

/** 一个分类（一个清单或一个习惯）在窗口内的时长。 */
export interface CategorySeries {
  /** 稳定的键，用于 React key 与测试断言：`project:<id>` / `habit:<id>`。 */
  key: string;
  kind: CategoryKind;
  id: string;
  /**
   * 用户自己起的名字。
   *
   * 🔴 **不翻译、不改写。** 它是用户的字 —— 同一个词在不同人那里意思不同，
   * 我们没有任何依据把它映射成别的词。
   */
  name: string;
  /** 槽位号；没设过色、或值不认识时为 `undefined`（界面给中性样式，不是丢掉这行）。 */
  slot?: CategorySlot;
  totalMs: number;
  /** 其中来自番茄钟的部分。 */
  focusMs: number;
  /** 其中来自「分钟」类习惯打卡的部分。 */
  habitMs: number;
  /**
   * 与 `weeks` **逐格对齐**：第 `i` 格 = 第 `i` 周该分类的时长（ms）。
   *
   * 长度永远等于 `weeks.length`（没有数据的周是 0）——
   * 短数组会让泳道图的格子与周标签错位，而错位**看起来像"这周没做"**。
   */
  weeklyMs: number[];
}

export interface CategoryReport {
  /** 从最早的周开始，最后一格是**本周**。 */
  weeks: CategoryWeek[];
  /** 按总时长降序；时长相同按 `key` 升序（确定性，两次渲染不会换位置）。 */
  series: CategorySeries[];
  /** 归不到任何分类的时长（无任务的纯计时、不属于任何清单的任务）。 */
  unassignedMs: number;
  /** 所有分类的合计 = `series[].totalMs` 之和。**不含** `unassignedMs`。 */
  totalMs: number;
  /**
   * 泳道图的分档基准：窗口内**单格的最大值**。
   *
   * 🔴 它是**跨行共享**的，不是每行各自的峰值。理由见计划 §5.2：
   * 泳道图要回答的是「哪一行满、哪一行空」，每行各自归一化会让
   * 一周 20 分钟的行和一周 20 小时的行**长得一模一样**。
   */
  peakWeeklyMs: number;
}

export interface CategoryReportInput {
  projects: readonly Project[];
  tasks: readonly Task[];
  habits: readonly Habit[];
  habitLogs: readonly HabitLog[];
  focusSessions: readonly FocusSession[];
  /** 决定"本周"是哪一周。**注入**，不读系统时间。 */
  now: number;
  /** 窗口周数，默认 12（约一个季度：够看出趋势，又不至于每格细到看不清）。 */
  weeks?: number;
}

export const DEFAULT_CATEGORY_WEEKS = 12;

/** 含 `today` 的那一周的周一。 */
export function weekStartOf(date: LocalDate): LocalDate {
  return addDays(date, -(isoWeekday(date) - 1));
}

interface SeriesAccumulator {
  series: CategorySeries;
}

function emptySeries(
  kind: CategoryKind,
  id: string,
  name: string,
  slot: CategorySlot | undefined,
  weekCount: number,
): CategorySeries {
  return {
    key: `${kind}:${id}`,
    kind,
    id,
    name,
    ...(slot === undefined ? {} : { slot }),
    totalMs: 0,
    focusMs: 0,
    habitMs: 0,
    weeklyMs: new Array<number>(weekCount).fill(0),
  };
}

/**
 * 汇总窗口内**按分类**的时长。
 *
 * 纯函数：同样的输入永远同样的输出，不读系统时间、不读时区数据库。
 */
export function computeCategoryReport(input: CategoryReportInput): CategoryReport {
  const weekCount = Math.max(1, Math.floor(input.weeks ?? DEFAULT_CATEGORY_WEEKS));
  const thisWeekStart = weekStartOf(toLocalDate(input.now));
  const windowStart = addDays(thisWeekStart, -7 * (weekCount - 1));

  const weeks: CategoryWeek[] = [];
  for (let i = 0; i < weekCount; i += 1) {
    const start = addDays(windowStart, 7 * i);
    weeks.push({ start, end: addDays(start, 6), totalMs: 0 });
  }

  const seriesByKey = new Map<string, SeriesAccumulator>();
  let unassignedMs = 0;

  /**
   * 落在窗口内就记一笔；窗口外（更早的历史）**一格都不算**。
   *
   * ⚠️ 遍历顺序很重要：**先判窗口，再建分类行**。反过来会留下一条
   * `totalMs: 0` 的空行 —— 界面于是画出一整行的空格子 + 一个「0 分钟」的分类，
   * 而那个分类在这段时间里**根本没有任何记录**。窗口外的历史不是"这个分类是空的"，
   * 它压根不该出现在这张图里。
   */
  const record = (
    makeSeries: () => CategorySeries,
    date: LocalDate,
    ms: number,
    source: CategoryKind,
  ): void => {
    const offset = diffDays(windowStart, date);
    // 未来的记录（时钟错乱、或用户手动改过系统时间）同样不进任何一格：
    // 一个不可能发生的时刻，比一个对不上账的格子安全。
    if (offset < 0 || offset >= weekCount * 7) return;
    const series = makeSeries();
    const weekIndex = Math.floor(offset / 7);
    const cell = series.weeklyMs[weekIndex] ?? 0;
    series.weeklyMs[weekIndex] = cell + ms;
    series.totalMs += ms;
    if (source === 'project') series.focusMs += ms;
    else series.habitMs += ms;
    const week = weeks[weekIndex];
    if (week !== undefined) week.totalMs += ms;
  };

  const ensureSeries = (
    kind: CategoryKind,
    id: string,
    name: string,
    slot: CategorySlot | undefined,
  ): CategorySeries => {
    const key = `${kind}:${id}`;
    const existing = seriesByKey.get(key);
    if (existing !== undefined) return existing.series;
    const created = emptySeries(kind, id, name, slot, weekCount);
    seriesByKey.set(key, { series: created });
    return created;
  };

  // ── 专注：任务 → 清单 ──────────────────────────────────────
  const projectById = new Map<string, Project>();
  for (const project of input.projects) {
    if (project.deletedAt !== undefined) continue;
    projectById.set(project.id, project);
  }
  const taskById = new Map<string, Task>();
  for (const task of input.tasks) {
    if (task.deletedAt !== undefined) continue;
    taskById.set(task.id, task);
  }

  for (const session of input.focusSessions) {
    if (session.kind !== 'work') continue;
    const date = toLocalDate(focusSessionDay(session));
    // 与 `focus.ts` 同一条：`actualMs` 缺省时退到 `plannedMs`，不当 0。
    const ms = session.actualMs ?? session.plannedMs;
    if (!Number.isFinite(ms) || ms <= 0) continue;

    const task = session.taskId === undefined ? undefined : taskById.get(session.taskId);
    const projectId = task?.projectId;
    const project = projectId === undefined ? undefined : projectById.get(projectId);
    if (task === undefined || project === undefined) {
      unassignedMs += ms;
      continue;
    }
    record(
      () => ensureSeries('project', project.id, project.name, parseCategorySlot(project.color)),
      date,
      ms,
      'project',
    );
  }

  // ── 习惯：只有"分钟"类习惯贡献时长 ─────────────────────────
  const habitById = new Map<string, Habit>();
  for (const habit of input.habits) {
    if (habit.deletedAt !== undefined) continue;
    habitById.set(habit.id, habit);
  }

  for (const log of input.habitLogs) {
    if (log.deletedAt !== undefined) continue;
    const habit = habitById.get(log.habitId);
    if (habit === undefined) continue;
    const minutes = habitLogMinutes(habit, log);
    if (minutes === undefined) continue;

    const habitSeries = (): CategorySeries =>
      ensureSeries('habit', habit.id, habit.name, parseCategorySlot(habit.color));
    record(habitSeries, log.date, minutes * 60_000, 'habit');
  }

  const series = [...seriesByKey.values()]
    .map((accumulator) => accumulator.series)
    .sort((a, b) => b.totalMs - a.totalMs || a.key.localeCompare(b.key));

  let totalMs = 0;
  let peakWeeklyMs = 0;
  for (const row of series) {
    totalMs += row.totalMs;
    for (const cell of row.weeklyMs) {
      if (cell > peakWeeklyMs) peakWeeklyMs = cell;
    }
  }

  return { weeks, series, unassignedMs, totalMs, peakWeeklyMs };
}

/**
 * 泳道图的一格该用第几档强度。
 *
 * 分档是**相对于窗口峰值**的四等分：`(0, 25%] → 1 … (75%, 100%] → 4`。
 * 0 表示这一格没有记录（与"有一点"必须明显不同，见设计系统里 `heat-0` 的存在理由）。
 *
 * ⚠️ 返回的是**档位**，不是颜色：颜色由界面从 token 取（本层不认识 CSS）。
 */
export function intensityLevel(ms: number, peakMs: number): 0 | 1 | 2 | 3 | 4 {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  if (!Number.isFinite(peakMs) || peakMs <= 0) return 0;
  const ratio = Math.min(1, ms / peakMs);
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

/**
 * 时长的**语义分档**（不认识语言）。
 *
 * 分类时长要在三处显示成文字（Web 泳道、移动端分类屏、以及以后的任何宿主），
 * 而"多长才算一小时""几点几分四舍五入"是**语义**，不是文案：
 * 三个地方各写一遍，早晚出现同一个 5400000ms 在一端是「1 小时 30 分」、
 * 在另一端是「90 分钟」。
 *
 * 所以这里只回答"该说哪一档、数字是几"，**具体措辞留给各端的词条表**
 * （`web.categories.duration.*` / `mobile.categories.duration.*`）——
 * 领域层不认识 i18n，也不该认识。
 *
 * 口径（与 Web 端迁移前逐字相同，故意保持）：
 * - **先四舍五入到分钟**，再分档。所以 30 秒 = 1 分钟、59 分 31 秒 = 60 分钟
 *   （不是「1 小时」—— 60 分钟这一档的边界是"整 60 分钟及以上"）；
 * - 负数与 `NaN` 当 0（计时器出错时宁可显示 0，也不要显示 `NaN 分钟`）。
 */
export type DurationParts =
  | { kind: 'minutes'; minutes: number }
  | { kind: 'hours'; hours: number }
  | { kind: 'hoursMinutes'; hours: number; minutes: number };

export function durationParts(ms: number): DurationParts {
  const safe = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const totalMinutes = Math.round(safe / 60000);
  if (totalMinutes < 60) return { kind: 'minutes', minutes: totalMinutes };
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return { kind: 'hours', hours };
  return { kind: 'hoursMinutes', hours, minutes };
}
