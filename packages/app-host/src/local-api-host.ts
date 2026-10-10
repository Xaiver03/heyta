/**
 * 本地 API 宿主适配器
 * ====================
 *
 * 把 `LocalApiHost` 端口接到**真实的** op-log 写入路径与物化状态上。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么这个适配器在 `packages/app-host` 而不是 `apps/node-host`
 *
 * ADR-0003 的判据是："这一行在决定**业务上该怎么做**吗？"
 *
 * - `intent.action === 'complete-task'` 该调 `setCompleted` 还是 `rename`
 *   → **是业务决定**，它属于 packages
 * - `dueDate` 是 epoch ms，而 MCP 传的是 `YYYY-MM-DD`，怎么换
 *   → **是业务决定**（而且是个有时区陷阱的决定，见下）
 *
 * 壳那边因此只剩"怎么收字节"。这也让这套语义**同时被三个平台复用**，
 * 而不是每端写一遍然后漂移（本仓库已经发生过两次这种漂移，见 AGENTS.md §3.5）。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 🔴 写入只经 `TaskActions` —— 而它内部走 `dispatch`
 *
 * 本文件**不构造 op**，只调 `actions.*`。op 的构造在 `actions.ts` 里，
 * 那是唯一的地方（`check-layering` 的 `no-op-construction-in-apps` 钉着外壳）。
 *
 * ## ⚠️ 时区：本地 API 说的是**本地日期**
 *
 * `Task.dueDate` 是 epoch ms，`LocalApiItem.dueDate` 是 `YYYY-MM-DD`。
 * 这个转换**必须选一个时区**，而选错会安静地差一天 ——
 * 这正是本仓库已经在"模型算错日期"上踩过一次的同一类错误（见计划 §9.8）。
 *
 * 选择：**本地时区**。理由是本地 API 的消费者（编辑器、脚本、AI 助手）
 * 都跑在**同一台机器**上，用同一个本地时区；而用户在界面上看到的也是本地日期。
 * 用 UTC 会让"今天到期"在 UTC+8 的晚上 8 点后变成"明天"。
 */

import type {
  LocalApiEventItem,
  LocalApiFocusSession,
  LocalApiHabit,
  LocalApiHabitLog,
  LocalApiHost,
  LocalApiItem,
  LocalApiNote,
  LocalApiNoteRow,
  LocalApiProject,
  LocalApiReminder,
  LocalApiTag,
  LocalApiTaskEstimateContext,
  LocalApiWriteIntent,
  LocalApiWriteResult,
} from '@heyta/local-api';
import {
  DAY_MS,
  MAX_REMINDER_LEAD_MS,
  MAX_REMINDERS_PER_TASK,
  NOTE_MAX_CONTENT_LENGTH,
  Priority,
  aliveReminders,
  eventDaysFromToday,
  eventKindOf,
  eventRejection,
  isEventPinned,
  isEventRepeating,
  isValidRecurrenceRule,
  nextEventOccurrence,
  localDateTimeToEpoch,
  dueLocalDateOf,
  localTimeOf,
  noteProjectId,
  noteRejection,
  reminderPhase,
  reminderRejection,
  today,
  type CountdownEvent,
  type CountdownEventKind,
  type FocusSession,
  type LocalDate,

  type Habit,
  type HabitGoalType,
  type HabitLog,
  type Note,
  type Reminder,
  type Task,
} from '@heyta/domain';

import type { ActionContext, TaskActions, TaskDetailsPatch } from './actions.js';
import { createFocusActions, focusLogFailureCode, type FocusActions } from './focus-actions.js';
import {
  createHabitActions,
  habitLogId,
  type HabitActions,
  type NewHabitFields,
} from './habit-actions.js';
import { createNoteActions, type NoteActions } from './note-actions.js';
import { createProjectActions, type ProjectActions } from './project-actions.js';
import { createReminderActions, type ReminderActions } from './reminder-actions.js';
import { createEventActions, type EventActions } from './event-actions.js';
import { readDurationFromNote } from './duration-note.js';
import { selectDurationHistory } from './ai-duration.js';

export interface LocalApiHostOptions {
  /**
   * 这条条目的正文能不能被本机工具读。
   *
   * 🔴 **必填，没有默认值。**
   *
   * 它原本缺省为 `() => true`，而"壳没传"和"壳传了 true"于是无法区分 ——
   * 真实产品里 `readable` 恒为 `true`，Bear 范式那条路径**从不执行**，
   * 且没有任何信号。现在壳必须自己回答这个问题。
   *
   * heyta 目前**没有**"受保护条目"这个产品概念（ADR-0011 §6.1 列为唯一产品空白），
   * 所以 `cli-mcp.ts` 现在显式传 `() => true` 并注明理由。
   * 将来有了"标记为受保护"的字段，只需要改**那一处**，协议层一行都不用改。
   *
   * ⚠️ 不要因为"现在恒为 true"就删掉它 —— 删掉之后那段契约
   * （`projectForTool` / `readItemForTool`）就完全没有生产调用点，
   * 而它恰恰是 ADR-0011 最重要的一条。
   *
   * 🔴 **W10 把参数放宽成 `Task | CountdownEvent`**：倒数日的备注与任务的备注
   * 是**同一件事**（正文类内容），所以"能不能读正文"必须问**同一个**钩子。
   * 另加一个 `isEventReadable` 会造出第二个隐私开关 ——
   * 而两个开关的默认值方向可以不一致，那正是这里已经踩过一次的坑。
   * 两个实体都有 `id` 与 `title`，够钩子做判断了；要按实体区分，
   * 在钩子里判 `'date' in item` 即可（倒数日有 `date`，任务没有）。
   */
  isReadable: (item: Task | CountdownEvent) => boolean;

  /**
   * The assistant's memory switch is deliberately separate from tool grants.
   * It defaults closed; hints are read only when this flag is explicitly true.
   */
  memoryEnabled?: boolean;
  /** Narrow prompt hints supplied by the host that owns preference inference. */
  getDurationPreferenceHints?: () => readonly { id: string; text: string }[];

  /**
   * 现在几点。**只在两处用**：给新落的专注记录填 `createdAt`，以及算提醒的
   * `phase`（还没到 / 该响了 / 已响过 —— 那个判定本身在领域层，这里只是把"现在"递给它）。
   *
   * ⚠️ 缺省 `Date.now()` 是有意的：宿主端口是给三个宿主共用的，而"现在"在生产里
   * 就是墙上时钟。测试要确定性就注入一个固定时钟 —— 不注入也不会漏接，
   * 因为这条**不是**隐私开关（上一条 `isReadable` 必须是必填的理由只适用于它）。
   */
  now?: () => number;
}

// ─────────────────────────────────────────────────────────────────────────
// 倒数日 / 纪念日（`EVENT`）→ `LocalApiEventItem`（W10，合流时随 pack 结构迁移）
// ─────────────────────────────────────────────────────────────────────────

/**
 * `CountdownEvent` → `LocalApiEventItem`。**备注只在 `readable` 时带。**
 *
 * 🔴 全部日历判断都**问领域层**，本函数一个都不自己算 ——
 * "下一次是哪天"如果在协议层再算一遍，就会出现"卡片说还有 3 天、AI 说还有 4 天"。
 */
export function eventToItem(
  event: CountdownEvent,
  readable: boolean,
  today: LocalDate,
): LocalApiEventItem {
  const item: LocalApiEventItem = {
    id: event.id,
    title: event.title,
    date: event.date,
    kind: eventKindOf(event, today),
    daysFromToday: eventDaysFromToday(event, today),
    repeating: isEventRepeating(event),
    isLunar: event.isLunar === true,
    pinned: isEventPinned(event),
    readable,
  };
  // 一次性且已过 ⇒ **缺席**（不是 `null`、不是"今天"）。界面与工具读同一个 undefined。
  const next = nextEventOccurrence(event, today);
  if (next !== undefined) item.nextOccurrence = next;
  // 🔴 正文只在可读时挂上（与 `taskToItem` 逐字同一条纪律）。
  if (readable && event.notes !== undefined) item.notes = event.notes;
  return item;
}

/**
 * 倒数日 `kind` 的**校验点**。形状是 `Record<CountdownEventKind, true>`：
 * 领域层加一档而这里没补，`tsc` 当场报"缺属性"—— 一份数组抄件则是永远静默少一档。
 */
const EVENT_KIND_BY_NAME: Readonly<Record<CountdownEventKind, true>> = {
  countdown: true,
  anniversary: true,
  birthday: true,
  festival: true,
};

/** 词表的**派生**清单（给测试与描述对账用，不是第二份定义）。 */
export const EVENT_KIND_NAMES = Object.keys(EVENT_KIND_BY_NAME) as readonly CountdownEventKind[];

/** 这个字符串是不是一个合法档位。**唯一的判定入口。** */
export function isEventKindName(value: unknown): value is CountdownEventKind {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(EVENT_KIND_BY_NAME, value)
  );
}

/** `update_event.fields` 认识的键。不认识的**一律拒绝**，不静默忽略。 */
const EVENT_UPDATABLE_FIELDS = [
  'title',
  'date',
  'kind',
  'isLunar',
  'recurrence',
  'pinned',
  'notes',
] as const;

/** 把领域层的拒绝翻成一句给调用方看的话。**措辞在这里，判定不在这里。** */
function eventRejectionMessage(
  rejection: 'empty-title' | 'too-long-title' | 'invalid-date',
  title: string,
  date: string,
): string {
  if (rejection === 'empty-title') return '标题不能为空（空白也算空）。';
  if (rejection === 'too-long-title') return `标题 ${String(title.length)} 字，超过上限。`;
  return `日期「${date}」不是有效的 YYYY-MM-DD（且必须是真实存在的一天）。`;
}

/** `Priority` 枚举 ↔ MCP 字符串。 */
const PRIORITY_TO_NAME: Readonly<Record<number, string>> = {
  [Priority.None]: 'none',
  [Priority.Low]: 'low',
  [Priority.Medium]: 'medium',
  [Priority.High]: 'high',
};

const NAME_TO_PRIORITY: Readonly<Record<string, Priority>> = {
  none: Priority.None,
  low: Priority.Low,
  medium: Priority.Medium,
  high: Priority.High,
};

/**
 * epoch ms → `YYYY-MM-DD`（**本地时区**）。
 *
 * ⚠️ 刻意不用 `toISOString().slice(0,10)` —— 那是 UTC，
 * 会在 UTC+8 的下午之后整体差一天。
 */
export function toLocalDateString(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 报错与工具说明里的那一句格式，**只有一份**。
 * 两处 `invalid` 各写一遍是抄件 —— 而抄件一定会漂（加 `THH:MM` 这一次就是第三处要改的地方）。
 */
export const LOCAL_API_DUE_FORMAT_HINT = 'YYYY-MM-DD 或 YYYY-MM-DDTHH:MM（本地时区）';

/**
 * `YYYY-MM-DD`，或 `YYYY-MM-DDTHH:MM`（本地时区）→ epoch ms。
 *
 * 返回 `undefined` 表示格式不合法 —— 由调用方决定怎么报，而不是猜一个日期。
 *
 * 🔴 为什么这里**接受** `T16:00`：R14 之后任务可以带时刻，而本机工具（MCP / 脚本 /
 *   编辑器）是唯一在应用外面写 `dueDate` 的入口。只收日等于对外说
 *   "本机能设的时刻，你不能用"，而那是一条没人宣布过的降级。
 * ⚠️ 换算仍然只有这一处（`server.ts:69-72` 那条立场没被推翻：本包**不**自己算
 *   "这一天在本机是哪一个时刻"，它把串交回这里）。带秒、带 `Z`、用空格分隔
 *   一律拒 —— 形状规范只有一份，`toLocalApiDueString` 写出来的就是这里唯一收的两种。
 */
export function fromLocalDateString(text: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(text.trim());
  if (m === null) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const hour = m[4] === undefined ? 0 : Number(m[4]);
  const minute = m[5] === undefined ? 0 : Number(m[5]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  if (hour > 23 || minute > 59) return undefined;
  const date = new Date(y, mo - 1, d, hour, minute, 0, 0);
  // 反查一遍，挡掉 2026-02-31 这类"格式对但不存在"的日期
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return undefined;
  }
  return date.getTime();
}

/**
 * 一个 `dueDate` → **本机工具看到的那一个串**。
 *
 * 🔴 有时刻的必须带着时刻。以前这里直接 `toLocalDateString(...)`（只留日），
 *   于是"16:00 接孩子"在 MCP 眼里与"今天接孩子"**是同一个值** —— 和人工导出那份
 *   清单同一个"有损读数"（`export-dump.ts` 的 `dueTime` 那一栏就是为它写的）。
 *
 * ⚠️ 刻意**不新增字段**：`dueDate` 这一个键已经在两个工具的 `egressFields`
 *   出境披露清单里（`tools.ts:97` / `:109`），也在两处白名单投影里
 *   （`tools.ts:411` / `:448`）与 MCP 输出 schema 里（`mcp.ts:128`）。
 *   加一个 `dueTime` 要同时改这五处，**少改最后一处就是"把没披露过的字段送出去"**。
 *   同一个键多带一段 `T16:00` 一次绕开这五处，代价只有一个：格式说明要改（已改）。
 */
export function toLocalApiDueString(epochMs: number): string {
  const day = toLocalDateString(epochMs);
  const time = localTimeOf(epochMs);
  return time === undefined ? day : `${day}T${time}`;
}

/** `Task` → `LocalApiItem`。**正文只有 `readable` 时才带。** */
export function taskToItem(task: Task, readable: boolean): LocalApiItem {
  const item: LocalApiItem = {
    id: task.id,
    title: task.title,
    completed: task.completedAt !== undefined,
    readable,
  };
  const dueDay = dueLocalDateOf(task);
  if (dueDay !== undefined) item.dueDate = task.dueDateLocal ?? toLocalApiDueString(task.dueDate!);
  if (task.priority !== undefined) item.priority = PRIORITY_TO_NAME[task.priority] ?? 'none';
  // 🔴 正文只在可读时挂上。不可读时**连字段都不存在** ——
  // 与 `projectForTool` 的白名单重建是同一条纪律的两个执行点。
  if (readable && task.note !== undefined) item.body = task.note;
  return item;
}

/**
 * 达成口径的闭集。与 `@heyta/domain` 的 `HabitGoalType` **同集合 —— 两边一起改**
 * （同 `focus-actions.ts` 的 `KINDS` 那条先例）。
 *
 * 🔴 为什么在**这里**验而不是在协议层：本包零依赖，写不出这个类型；而"不认识的
 * 值"如果原样进 `createHabit` 的载荷，会被 `isAchieved` 当成**默认口径**处理 ——
 * 症状是"我要的是今天一次都不碰，结果它按至少一次算"，而任何一层都不报错。
 */
const GOAL_TYPES: ReadonlySet<string> = new Set<string>(['atLeast', 'atMost', 'exactly']);

/**
 * `Habit` → `LocalApiHabit`。**白名单重建**（同 `taskToItem` / `projectForTool`）：
 * `color` / `icon` / `frequency` / `backfillDays` 一律不出 ——
 * 它们不在 `list_habits` 的 `egressFields` 里，多搬一个字段就是让出境声明说谎。
 */
export function habitToItem(habit: Habit): LocalApiHabit {
  const item: LocalApiHabit = { id: habit.id, name: habit.name };
  if (habit.target !== undefined) item.target = habit.target;
  if (habit.unit !== undefined) item.unit = habit.unit;
  if (habit.goalType !== undefined) item.goalType = habit.goalType;
  return item;
}

/**
 * `Tag` → `LocalApiTag`。白名单重建，只有两个字段。
 *
 * ⚠️ `color` 不搬：不是"暂时没接"，而是**全仓库没有任何一条路径往 `Tag.color` 写值**
 * （落在 `TAG` 上的 op 只有 Create 与 Delete）。搬一个永远为空的字段进出境清单，
 * 等于给"将来顺手填上"留一条已经声明过的通道。
 */
export function tagToRow(tag: { id: string; name: string }): LocalApiTag {
  return { id: tag.id, name: tag.name };
}

/**
 * `Note` → 列表行。**正文在这里被剥掉** —— 这一行是 `list_notes`
 * "不返回正文"那句承诺的唯一执行点（同 `projectListForTool` 的位置）。
 *
 * `projectId` 用领域层的 `noteProjectId` 归一成 `null`：实体里"未归属"是**缺字段**，
 * 而界面上它是一个真的分组。原样搬 `undefined` 会让 `JSON.stringify` 把这个键整个吞掉，
 * 于是"未归属"和"这次没算出来"在出境的数据里长得一样。
 */
export function noteToRow(note: Note): LocalApiNoteRow {
  return {
    id: note.id,
    projectId: noteProjectId(note),
    isPinnedToToday: note.isPinnedToToday,
    updatedAt: note.updatedAt,
  };
}

/** `Note` → 单条（列表行的全部字段 + 正文）。 */
export function noteToItem(note: Note): LocalApiNote {
  return { ...noteToRow(note), content: note.content };
}

/**
 * `HabitLog` → `LocalApiHabitLog`。
 *
 * ⚠️ `note` 不搬：`checkIn` 从来不写它，而自由文本一旦进白名单就是一条出境通道。
 */
export function habitLogToItem(log: HabitLog): LocalApiHabitLog {
  const item: LocalApiHabitLog = { habitId: log.habitId, date: log.date };
  if (log.value !== undefined) item.value = log.value;
  return item;
}

/**
 * `FocusSession` → `LocalApiFocusSession`。字段名与实体逐字一致（毫秒）。
 *
 * 可选字段**缺席时连键都不写**：出境的 JSON 里不该出现 `"taskId": null` ——
 * 那会被模型读成"有一个任务，但没说清是哪个"，而它本来的意思是"没挂任务"。
 * （物化状态里也不会有 `null`：reducer 把 payload 的 `null` 翻译成**删除键**，
 * 见 `packages/op-log/src/state.ts:279-285`。所以这里的判据只看 `undefined`；
 * 那个"不出现 null"由下面的用例钉住，不靠这里的第二道过滤。）
 *
 * ⚠️ `createdAt` / `updatedAt` / `endedAt` 不搬：`endedAt` 与 `startedAt + actualMs`
 * 是同一件事的两份抄件，多给一份就是让模型自己挑一个来算时长。
 */
export function focusToItem(session: FocusSession): LocalApiFocusSession {
  const item: LocalApiFocusSession = {
    kind: session.kind,
    plannedMs: session.plannedMs,
  };
  if (session.taskId !== undefined) item.taskId = session.taskId;
  if (session.actualMs !== undefined) item.actualMs = session.actualMs;
  if (session.completed !== undefined) item.completed = session.completed;
  if (session.startedAt !== undefined) item.startedAt = session.startedAt;
  return item;
}

/**
 * `Reminder` → `LocalApiReminder`。
 *
 * 🔴 `phase` 是**领域层算的**（`reminderPhase`），不是这里拼的：三个原始时间戳
 * （`firedAt` / `snoozedUntil` / `dismissedAt`）合成一个封闭词表这件事只有一个所有者。
 * 把三个时间戳原样搬出去，等于让每个调用方各自重算一遍这个判定 —— 那正是漂移的形状。
 */
export function reminderToItem(reminder: Reminder, at: number): LocalApiReminder {
  return {
    id: reminder.id,
    taskId: reminder.taskId,
    triggerAt: reminder.triggerAt,
    phase: reminderPhase(reminder, at),
  };
}

/** 分钟 → 毫秒。单位换算，不是产品规则，所以只需要一份。 */
const MINUTE_MS = 60_000;

export function createLocalApiHost(
  ctx: ActionContext,
  actions: TaskActions,
  // 🔴🔴 **第三个参数是必填的，不是可选的 —— 这是刻意的。**
  //
  // 它原本是 `options: LocalApiHostOptions = {}`，而 `isReadable` 缺省为
  // `() => true`。后果：**真实运行的程序里 `readable` 永远是 `true`**，
  // Bear 范式（可列举但不可读）那条路径**从来不执行**，
  // 而任何地方都不会提示这件事。
  //
  // 全仓库只有 `cli-mcp.ts` 一个真实调用点，且它**从来没有传过** `isReadable`
  // —— 也就是说这条隐私特性在产品里是死的。
  //
  // 一个隐私相关的开关**不允许静默地失败在"open"那一侧**。
  // 现在壳必须**显式**回答"哪些条目读不出来"，答不出来就编译不过。
  options: LocalApiHostOptions,
): LocalApiHost {
  const isReadable = options.isReadable;
  const memoryEnabled = options.memoryEnabled === true;
  const now = options.now ?? ((): number => Date.now());

  // 🔴 各实体的动作**在这里内部构造**，不从壳注入 —— 这些动作集只需要
  // `ActionContext`（`dispatch` + `getState`），而 `ctx` 已经在参数里。
  // 为什么不做成 `options.noteActions`：那样每个宿主都要多接一根线，
  // 而**漏接的那一个只会让 `submit` 少一条分支**（AGENTS §3.5 的"每端一份、
  // 各自漂移"就是这么长出来的）。内部构造 ⇒ 三个宿主（Web / node-host CLI / MCP stdio）
  // 接到的行为逐字相同，且 op 的构造仍然只在各 `*-actions.ts` 里有一份。
  const projectActions = createProjectActions(ctx);
  const habitActions = createHabitActions(ctx);
  const noteActions = createNoteActions(ctx);
  const focusActions = createFocusActions(ctx);
  const reminderActions = createReminderActions(ctx, { now });
  const eventActions = createEventActions(ctx);

  return {
    listTasks: (args) => {
      let tasks = actions.listTasks();
      if (args.projectId !== undefined) {
        tasks = tasks.filter((t) => t.projectId === args.projectId);
      }
      if (args.completed !== undefined) {
        tasks = tasks.filter((t) => (t.completedAt !== undefined) === args.completed);
      }

      // 🔴🔴 日期过滤**必须排在 limit 之前**。这条顺序就是 `list.today` 那条缺陷的
      // 另一半：先 `slice(0, 50)` 再筛，"今天的任务"只要排在第 50 条之后就查不到，
      // 而用户拿到的是一个**空列表** —— 那不是"今天没任务"，那是筛错了。
      // 契约把这件事写在 `LocalApiHost.listTasks` 的注释上（本包看不见截断，
      // 也补不回来），这里就是它唯一的执行点。
      //
      // ⚠️ 过滤发生在**内存里已物化的状态**上，所以它是本地操作 ——
      // 不该退回协议层再做一遍（那会出现"同一句『今天』两层各筛一次"）。
      const { dueOn, dueFrom, dueTo } = args;
      if (dueOn !== undefined || dueFrom !== undefined || dueTo !== undefined) {
        tasks = tasks.filter((task) => {
          // 没有截止日的任务**不属于任何一天**（"今天有什么任务"不该把收件箱倒出来）。
          const day = dueLocalDateOf(task);
          if (day === undefined) return false;
          // 用的是**投影那一个换算的前半段**（`taskToItem` → `toLocalApiDueString`
          // → `toLocalDateString`），所以"拿来比的日子"与"返回里显示的日子"
          // 必然是同一个日子 —— 不会出现"筛 15 号，而返回里写着 15 号的那条被漏掉"。
          // ⚠️ 过滤**按日**、不按分钟，这是刻意的：`dueOn` 的契约就是"截止日正好是这一天"
          //   （`server.ts:69-72`），带时刻的任务属于它那一天的 00:00–23:59。
          // 🔴 `YYYY-MM-DD` 的字典序就是时间序（四位年 + 补零月日），
          // 所以闭区间比较不需要再做任何日历算术。两端都**含**。
          if (dueOn !== undefined) return day === dueOn;
          if (dueFrom !== undefined && day < dueFrom) return false;
          if (dueTo !== undefined && day > dueTo) return false;
          return true;
        });
      }

      // 上限默认 50：列表是给模型看的，一次几百条会直接吃掉上下文。
      const limit = args.limit ?? 50;
      return Promise.resolve(tasks.slice(0, Math.max(0, limit)).map((t) => taskToItem(t, isReadable(t))));
    },

    getTask: (taskId) => {
      const task = actions.findTask(taskId);
      if (task === undefined) return Promise.resolve(undefined);
      return Promise.resolve(taskToItem(task, isReadable(task)));
    },

    getTaskEstimateContext: (taskId): Promise<LocalApiTaskEstimateContext | undefined> => {
      const task = actions.findTask(taskId);
      if (task === undefined) return Promise.resolve(undefined);
      const readable = isReadable(task);
      if (!readable) {
        return Promise.resolve({ taskId: task.id, title: task.title, readable: false });
      }

      const history = selectDurationHistory(
        focusActions
          .listSessions()
          .filter((session) => session.taskId === task.id)
          .map((session) => ({ plannedMs: session.plannedMs, actualMs: session.actualMs ?? 0 })),
      );
      const preferences =
        memoryEnabled && options.getDurationPreferenceHints !== undefined
          ? options.getDurationPreferenceHints()
          : undefined;
      return Promise.resolve({
        taskId: task.id,
        title: task.title,
        readable: true,
        ...(task.note === undefined ? {} : { body: task.note }),
        ...(readDurationFromNote(task.note) === undefined
          ? {}
          : { currentMinutes: readDurationFromNote(task.note) }),
        ...(history.length === 0 ? {} : { history }),
        ...(preferences === undefined || preferences.length === 0 ? {} : { preferences }),
      });
    },

    listProjects: () => {
      // 🔴 清单的"哪些能出现在出口里"来自 `ProjectActions.listProjects()`，
      // 不是这里自己滤（W9 / P-9 / I5）。原先这行写的是
      // `Object.values(state.projects).filter((p) => p.deletedAt === undefined)` ——
      // 那是动作层那条判据的**第二份**，而它只答了"未删除"这一半，
      // **没有答"未归档"**：用户在界面上把清单收起来之后，助手与 CLI
      // 仍然把它当活的推荐目标。
      //
      // ⚠️ 计数走 `actions.listTasks()` 而不是原始表，同一个理由：
      // "什么算一条活的任务"也只该有一处判据。
      const counts = new Map<string, number>();
      for (const task of actions.listTasks()) {
        if (task.projectId === undefined) continue;
        counts.set(task.projectId, (counts.get(task.projectId) ?? 0) + 1);
      }
      const projects: LocalApiProject[] = projectActions.listProjects().map((p) => ({
        id: p.id,
        name: p.name,
        taskCount: counts.get(p.id) ?? 0,
      }));
      return Promise.resolve(projects);
    },

    // 顺序与 `listTasks()` 同一条规则（`habit-actions.ts` 的 `listHabits` 已经排过），
    // 所以"AI 看到的第 N 个习惯"与界面上的第 N 个是同一个 —— 不是实现细节，
    // 是跨端一致的那条（见 `actions.ts` 的 `byCanonicalOrder`）。
    listHabits: () => Promise.resolve(habitActions.listHabits().map(habitToItem)),

    // 下面六条同一条纪律：**排序所有者在动作层，这里一律不重排**
    // （`listTags` / `listNotes` / `listLogs` / `listSessions` 各自已经有确定性顺序，
    // 再排一遍就是第二个所有者，而两端顺序会漂 —— 那类 bug 没有报错，只有"第 3 条不一样"）。
    // 唯一的例外是 `listReminders`：它的顺序所有者**没有**承诺过"按时刻"，
    // 而工具描述对用户承诺了，所以这里按 `triggerAt` 重排（理由写在那条里）。
    listTags: () => Promise.resolve(projectActions.listTags().map(tagToRow)),

    listNotes: (limit) => Promise.resolve(noteActions.listNotes().slice(0, Math.max(0, limit)).map(noteToRow)),

    getNote: (noteId) => {
      // `aliveNotes` 的语义在这里是"删掉的便签读不到正文"，与 `getTask` 同一条：
      // 取不到就是 `undefined`（不是抛错，也不是返回一个空的便签）。
      const note = noteActions.listNotes().find((x) => x.id === noteId);
      return Promise.resolve(note === undefined ? undefined : noteToItem(note));
    },

    listHabitLogs: (habitId, limit) => {
      const logs = habitActions.listLogs();
      const filtered = habitId === undefined ? logs : logs.filter((l) => l.habitId === habitId);
      return Promise.resolve(filtered.slice(0, Math.max(0, limit)).map(habitLogToItem));
    },

    listFocusSessions: (limit) =>
      Promise.resolve(focusActions.listSessions().slice(0, Math.max(0, limit)).map(focusToItem)),

    listReminders: (taskId) => {
      const all = aliveReminders(Object.values(ctx.getState().reminders));
      const filtered = taskId === undefined ? all : all.filter((r) => r.taskId === taskId);
      // `aliveReminders` 的顺序是 id 字典序，而提醒的 id 是 `任务:时刻` 拼出来的 ——
      // 那读起来像时间序、实际按任务分组。这里按 `triggerAt` 从早到晚重排，
      // 因为工具描述对用户承诺的是"按提醒时刻从早到晚"。
      const ordered = [...filtered].sort(
        (a, b) => a.triggerAt - b.triggerAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
      return Promise.resolve(ordered.map((r) => reminderToItem(r, now())));
    },

    /**
     * 列倒数日。**顺序、集合成员、正文判定全部问领域层。**
     *
     * 🔴 `limit` 与 `listTasks` 同一条纪律：**先筛后截**。
     * 这里"筛"就是 `listEvents(today)` 已经做完的那一层（未删除 + 未归档 + 规范顺序），
     * 所以截断只能发生在它**之后** —— 反过来会变成"倒数日排在第 50 条之后就查不到"。
     */
    listEvents: (args) => {
      const day = today(now());
      const events = eventActions.listEvents(day);
      const limit = args.limit ?? 50;
      return Promise.resolve(
        events
          .slice(0, Math.max(0, limit))
          .map((event) => eventToItem(event, isReadable(event), day)),
      );
    },

    getEvent: (eventId) => {
      const event = eventActions.eventOf(eventId);
      if (event === undefined) return Promise.resolve(undefined);
      return Promise.resolve(eventToItem(event, isReadable(event), today(now())));
    },

    submit: (intent) =>
      submitIntent(
        ctx,
        actions,
        projectActions,
        habitActions,
        noteActions,
        focusActions,
        reminderActions,
        eventActions,
        now,
        intent,
      ),
  };
}

/**
 * 把一个写入意图翻译成动作调用。
 *
 * 🔴 **这是 `LocalApiWriteIntent` 唯一被解释的地方。**
 * 译不出来（或参数不合法）就返回 `invalid`，**绝不"尽力而为"地猜**。
 *
 * ⚠️ 联合类型**没有 `default` 分支**是刻意的：加一个写入动作而不在这里表态，
 * 编译就过不去（那正是"每个宿主都被逼着表态"的落点，而三个宿主共用这一个实现）。
 *
 * 🔴 **领域规则一律不在这里重写第二遍**：正文合法性问 `noteRejection`，
 * 时刻合不合法问 `reminderRejection`，上限问 `MAX_REMINDERS_PER_TASK`（导入的那个常量），
 * 专注类型与时长问 `focusActions.log()` 自己抛的那三种码。
 * 这里只做两件事：**把不存在的东西挡在门口**（任务/习惯/清单/标签的存在性 ——
 * 那是读物化状态，领域层没有这个函数），以及**把抛出来的错翻成一句用户看得懂的话**。
 * 把规则抄一份进来的代价不是"重复"，是两条路对同一句输入给两种答案 ——
 * 本仓库已经为这一条付过三次学费（AGENTS §3.5）。
 */
async function submitIntent(
  ctx: ActionContext,
  actions: TaskActions,
  projectActions: ProjectActions,
  habitActions: HabitActions,
  noteActions: NoteActions,
  focusActions: FocusActions,
  reminderActions: ReminderActions,
  eventActions: EventActions,
  now: () => number,
  intent: LocalApiWriteIntent,
): Promise<LocalApiWriteResult> {
  switch (intent.action) {
    case 'create-task': {
      if (intent.title.trim() === '') {
        return { ok: false, reason: 'invalid', message: '标题不能为空。' };
      }
      const over: {
        dueDate?: number;
        priority?: Priority;
        projectId?: string;
      } = {};
      if (intent.dueDate !== undefined) {
        const epoch = fromLocalDateString(intent.dueDate);
        if (epoch === undefined) {
          return {
            ok: false,
            reason: 'invalid',
            message: `截止日期格式应为 ${LOCAL_API_DUE_FORMAT_HINT}，收到「${intent.dueDate}」。`,
          };
        }
        over.dueDate = epoch;
      }
      if (intent.priority !== undefined) {
        const p = NAME_TO_PRIORITY[intent.priority.toLowerCase()];
        if (p === undefined) {
          return {
            ok: false,
            reason: 'invalid',
            message: `优先级应为 none / low / medium / high，收到「${intent.priority}」。`,
          };
        }
        over.priority = p;
      }
      if (intent.projectId !== undefined) over.projectId = intent.projectId;

      const id = await actions.create(intent.title, over);
      return { ok: true, taskId: id };
    }

    case 'update-task': {
      // 逐字段处理，**不认识的一律拒绝而不是忽略** ——
      // 静默忽略会让调用方以为改成功了。
      const unknown = Object.keys(intent.fields).filter(
        (k) => !['title', 'completed', 'dueDate', 'priority'].includes(k),
      );
      if (unknown.length > 0) {
        return {
          ok: false,
          reason: 'invalid',
          message: `不支持修改这些字段：${unknown.join('、')}。`,
        };
      }

      const f = intent.fields;
      const patch: TaskDetailsPatch = {};
      if ('title' in f) {
        if (typeof f['title'] !== 'string') {
          return { ok: false, reason: 'invalid', message: '标题必须是字符串。' };
        }
        if (f['title'].trim() === '') {
          return { ok: false, reason: 'invalid', message: '标题不能为空。' };
        }
        patch.title = f['title'];
      }
      if ('completed' in f) {
        if (typeof f['completed'] !== 'boolean') {
          return { ok: false, reason: 'invalid', message: 'completed 必须是布尔值。' };
        }
        patch.completed = f['completed'];
      }
      if ('priority' in f) {
        if (typeof f['priority'] !== 'string') {
          return { ok: false, reason: 'invalid', message: '优先级必须是字符串。' };
        }
        const p = NAME_TO_PRIORITY[f['priority'].toLowerCase()];
        if (p === undefined) {
          return { ok: false, reason: 'invalid', message: `未知优先级「${f['priority']}」。` };
        }
        patch.priority = p;
      }
      if ('dueDate' in f) {
        if (typeof f['dueDate'] !== 'string') {
          return { ok: false, reason: 'invalid', message: '截止日期必须是日期字符串。' };
        }
        const epoch = fromLocalDateString(f['dueDate']);
        if (epoch === undefined) {
          return { ok: false, reason: 'invalid', message: `截止日期格式应为 ${LOCAL_API_DUE_FORMAT_HINT}。` };
        }
        patch.dueDate = epoch;
      }
      if (actions.findTask(intent.taskId) === undefined) {
        return { ok: false, reason: 'not-found', message: '没有找到这个任务。' };
      }
      await actions.patchDetails(intent.taskId, patch);
      return { ok: true, taskId: intent.taskId };
    }

    case 'append-task-checklist': {
      const result = await actions.appendChecklist(intent.taskId, intent.items);
      if (result === 'not-found') {
        return { ok: false, reason: 'not-found', message: '没有找到这个任务。' };
      }
      return { ok: true, taskId: intent.taskId };
    }

    case 'complete-task': {
      const task = actions.findTask(intent.taskId);
      if (task === undefined) {
        return { ok: false, reason: 'not-found', message: '没有找到这个任务。' };
      }
      await actions.setCompleted(intent.taskId, true);
      return { ok: true, taskId: intent.taskId };
    }

    case 'complete-tasks': {
      // 🔴 **先全部预检，再一条都不写**：op-log 里没有跨 op 事务（一批就是 N 条 op），
      // 所以"要么全改、要么全不改"唯一的实现方式是把校验整个放在写之前。
      // 中途才失败（例如第 7 条不存在）会留下"改了 6 条"的状态，而用户看到的是一句报错 ——
      // 那是这套确认机制最坏的失效形状。
      const taskIds = [...new Set(intent.taskIds)];
      const missing = taskIds.filter((id) => actions.findTask(id) === undefined);
      if (missing.length > 0) {
        const shown = missing.slice(0, 3).join('、');
        return {
          ok: false,
          reason: 'not-found',
          message: `这批里有 ${String(missing.length)} 条任务已经不在了（${shown}${missing.length > 3 ? ' 等' : ''}），一条都没有改。`,
        };
      }
      const repeating = taskIds.filter((id) => actions.findTask(id)?.repeatRule !== undefined);
      if (repeating.length > 0) {
        return {
          ok: false,
          reason: 'invalid',
          message: `这批里有重复任务（${repeating.slice(0, 3).join('、')}${repeating.length > 3 ? ' 等' : ''}），重复任务请逐条完成。`,
        };
      }
      // 已经是完成态的**不重复写**（照 `createReminder` 那条幂等口径：已在该状态就不再发一条 op）。
      // ⚠️ 于是"确认卡上的条数"（用户要提交的范围）与"实际写了几条"可以不相等；
      // 差值只在结果里可见 —— 它不是用户要看的那件事，但 MCP 那侧的外部程序要能算出来。
      const changed: string[] = [];
      for (const id of taskIds) {
        const task = actions.findTask(id);
        if (task === undefined || task.completedAt !== undefined) continue;
        changed.push(id);
      }
      if (changed.length > 0) await actions.bulkSetCompleted(changed, true);
      const [first] = changed;
      if (first === undefined) {
        // 只有"绕过了 `toWriteIntent` 直接构造意图"才可能走到这里（空数组在参数层就被拒）。
        // 不许回一句 `ok` 加一个空 id —— 那是把"什么都没做"报成"做完了"。
        if (taskIds.length === 0) {
          return { ok: false, reason: 'invalid', message: 'taskIds 是空的：没有要完成的任务。' };
        }
        return { ok: true, taskId: taskIds[0] ?? '', taskIds: [] };
      }
      return { ok: true, taskId: first, taskIds: changed };
    }

    case 'set-task-priorities': {
      // 先完整预检，保证批量优先级写入不会留下半批状态。
      const mapped: { id: string; priority: Priority }[] = [];
      const taskIds: string[] = [];
      const seen = new Set<string>();
      for (const entry of intent.entries) {
        if (typeof entry.taskId !== 'string' || entry.taskId.trim() === '') {
          return { ok: false, reason: 'invalid', message: '任务 id 不能为空。' };
        }
        const taskId = entry.taskId.trim();
        if (seen.has(taskId)) {
          return { ok: false, reason: 'invalid', message: `不能重复修改任务「${taskId}」。` };
        }
        if (actions.findTask(taskId) === undefined) {
          return { ok: false, reason: 'not-found', message: '没有找到这个任务。' };
        }
        if (typeof entry.priority !== 'string') {
          return { ok: false, reason: 'invalid', message: '优先级必须是字符串。' };
        }
        const priority = NAME_TO_PRIORITY[entry.priority.trim().toLowerCase()];
        if (priority === undefined) {
          return {
            ok: false,
            reason: 'invalid',
            message: `优先级应为 none / low / medium / high，收到「${entry.priority}」。`,
          };
        }
        seen.add(taskId);
        taskIds.push(taskId);
        mapped.push({ id: taskId, priority });
      }
      const [first] = taskIds;
      if (first === undefined) {
        return { ok: false, reason: 'invalid', message: 'entries 是空的：没有要修改的任务。' };
      }
      await actions.bulkSetPriorities(mapped);
      return {
        ok: true,
        taskId: first,
        taskIds,
      };
    }

    case 'set-task-estimate': {
      const result = await actions.setTaskEstimate(intent.taskId, intent.minutes);
      if (result === 'not-found') {
        return { ok: false, reason: 'not-found', message: '没有找到这个任务。' };
      }
      return { ok: true, taskId: intent.taskId };
    }

    case 'create-project': {
      const name = intent.name.trim();
      // 空名**不落到 `projectActions.createProject`** —— 它会 throw，而 throw 会顺着
      // 两个壳的 catch 变成一句"工具执行失败"。这里返回 `invalid`，用户看到的是原因。
      // （同 `create-task` 那条"标题不能为空"。）
      if (name === '') {
        return { ok: false, reason: 'invalid', message: '清单名称不能为空。' };
      }
      if (intent.parentId !== undefined) {
        // 经动作层读（I5 门禁：出口层不碰原始表 —— 归档与否由层负责，这里只问"存在且非墓碑"）。
        const parent = projectActions.listAllProjects().find((p) => p.id === intent.parentId);
        if (parent === undefined || parent.deletedAt !== undefined) {
          return {
            ok: false,
            reason: 'not-found',
            message: `找不到要放进的那个清单（parentId「${intent.parentId}」）。`,
          };
        }
        // 🔴 领域层明确**只支持一层**（`Project.parentId` 的注释 + `packages/ui/src/projects/model.ts:72`），
        // 而界面只渲染"顶层 + 其下一级"。挂到一个本身已是子级的清单下面，
        // 建出来的清单在四个端上**都看不见** —— 写成功、读不出、不报错。
        if (parent.parentId !== undefined) {
          return {
            ok: false,
            reason: 'invalid',
            message: `「${parent.name}」已经在一个清单下面了，清单只支持一层。`,
          };
        }
      }
      const id = await projectActions.createProject(name, intent.parentId);
      return { ok: true, taskId: id, entityId: id, entityType: 'PROJECT' };
    }

    case 'create-habit': {
      const name = intent.name.trim();
      if (name === '') {
        return { ok: false, reason: 'invalid', message: '习惯名称不能为空。' };
      }

      const over: NewHabitFields = {};

      if (intent.target !== undefined) {
        // 下界是 **0 而不是 1**：`goalType: 'atMost'` 时"目标 0 次"是合法习惯
        // （"今天一次都不碰"）。同 `setHabitGoal` 那条判定 —— 两边必须同口径，
        // 否则"AI 能建、界面不能改"这种分裂就会出现。
        if (!Number.isFinite(intent.target) || intent.target < 0) {
          return {
            ok: false,
            reason: 'invalid',
            message: `目标数值必须是不小于 0 的有限数，收到「${String(intent.target)}」。`,
          };
        }
        over.target = intent.target;
      }

      if (intent.unit !== undefined) {
        const unit = intent.unit.trim();
        if (unit === '') {
          // 空单位**拒绝**而不是落成空串：界面上会渲染成「8 」（少一个字的观感），
          // 而 `setHabitGoal` 对同一个输入的处理是"清除单位"—— 两条路对同一句话
          // 给两种结果就是漂移。要单位就别给空的。
          return { ok: false, reason: 'invalid', message: '单位不能是空白；要没有单位就别传这个字段。' };
        }
        over.unit = unit;
      }

      if (intent.goalType !== undefined) {
        if (!GOAL_TYPES.has(intent.goalType)) {
          return {
            ok: false,
            reason: 'invalid',
            message: `达成口径应为 atLeast / atMost / exactly，收到「${intent.goalType}」。`,
          };
        }
        over.goalType = intent.goalType as HabitGoalType;
      }

      const id = await habitActions.createHabit(name, over);
      return { ok: true, taskId: id, entityId: id, entityType: 'HABIT' };
    }

    case 'create-tag': {
      const name = intent.name.trim();
      if (name === '') {
        return { ok: false, reason: 'invalid', message: '标签名称不能为空。' };
      }
      const id = await projectActions.createTag(name);
      return { ok: true, taskId: id, entityId: id, entityType: 'TAG' };
    }

    case 'set-task-tags': {
      const task = actions.findTask(intent.taskId);
      if (task === undefined) {
        return { ok: false, reason: 'not-found', message: '没有找到这个任务。' };
      }
      // 🔴 逐个标签验存在且活着，并把**第一个**不成立的报出来。
      // `setTags` 自己也会 throw，但它 throw 的是整句"找不到标签「id」"——
      // 而这里的读者是用户，他要的是"哪一个"。存在性不是领域规则，是读物化状态，
      // 所以这一条不算抄第二遍。
      const state = ctx.getState();
      for (const tagId of intent.tagIds) {
        const tag = state.tags[tagId];
        if (tag === undefined || tag.deletedAt !== undefined) {
          return {
            ok: false,
            reason: 'not-found',
            message: `找不到标签「${tagId}」——先列一下现有标签，再把你确实想挂的那几个一起交过来。`,
          };
        }
      }
      await actions.setTags(intent.taskId, [...intent.tagIds]);
      return { ok: true, taskId: intent.taskId };
    }

    case 'create-note': {
      // 正文的规则问领域层（`noteRejection`）：空 / 超长两码，**数字不住在这里**。
      const rejection = noteRejection(intent.content);
      if (rejection === 'empty') {
        return { ok: false, reason: 'invalid', message: '便签正文不能为空（只有空格也算空）。' };
      }
      if (rejection === 'too-long') {
        return {
          ok: false,
          reason: 'invalid',
          message: `便签正文最长 ${String(NOTE_MAX_CONTENT_LENGTH)} 个字符。`,
        };
      }
      if (intent.projectId !== undefined) {
        const parent = projectActions.listAllProjects().find((p) => p.id === intent.projectId);
        if (parent === undefined || parent.deletedAt !== undefined) {
          return {
            ok: false,
            reason: 'not-found',
            message: `找不到要放进去的那个清单（「${intent.projectId}」）。`,
          };
        }
      }
      const id = await noteActions.createNote(intent.content, {
        ...(intent.projectId === undefined ? {} : { projectId: intent.projectId }),
        ...(intent.isPinnedToToday === undefined
          ? {}
          : { isPinnedToToday: intent.isPinnedToToday }),
      });
      return { ok: true, taskId: id, entityId: id, entityType: 'NOTE' };
    }

    case 'update-note': {
      const note = noteActions.listNotes().find((x) => x.id === intent.noteId);
      if (note === undefined) {
        return { ok: false, reason: 'not-found', message: '没有找到这条便签。' };
      }
      const rejection = noteRejection(intent.content);
      if (rejection === 'empty') {
        return { ok: false, reason: 'invalid', message: '便签正文不能为空（只有空格也算空）。' };
      }
      if (rejection === 'too-long') {
        return {
          ok: false,
          reason: 'invalid',
          message: `便签正文最长 ${String(NOTE_MAX_CONTENT_LENGTH)} 个字符。`,
        };
      }
      await noteActions.updateNoteContent(intent.noteId, intent.content);
      return { ok: true, taskId: intent.noteId, entityId: intent.noteId, entityType: 'NOTE' };
    }

    case 'record-checkin': {
      const habit = ctx.getState().habits[intent.habitId];
      if (habit === undefined || habit.deletedAt !== undefined) {
        return { ok: false, reason: 'not-found', message: `找不到习惯「${intent.habitId}」。` };
      }
      const day = intent.date ?? today(now());
      if (intent.value !== undefined && (!Number.isFinite(intent.value) || intent.value < 0)) {
        return {
          ok: false,
          reason: 'invalid',
          message: `打卡数值必须是不小于 0 的有限数，收到「${String(intent.value)}」。`,
        };
      }
      // 🔴 那一天已经打过卡时，本工具**报的仍是成功**（同 ADR-0009 对精确重复 op 的裁决）：
      // 打卡记录的标识是 `习惯:日期` 组合，重复调用不会多出第二条。
      // 报 `ok: false` 会让用户以为没打上，而再点一次也不会变成"打上"。
      // ⚠️ 详情面 W6 之后 `checkIn` 多了一米：**给了与当日当前量不同的 value 就改那条的量**
      //（一条 `UPD`，实体 id 不变）。所以这里的承诺是"不多出一条记录"，
      // 不是"重复调用一条 op 都不写" —— 后者只在值没变时成立。
      await habitActions.checkIn(intent.habitId, day, intent.value);
      const logId = habitLogId(intent.habitId, day);
      return { ok: true, taskId: logId, entityId: logId, entityType: 'HABIT_LOG' };
    }

    case 'log-focus': {
      const at = now();
      try {
        const id = await focusActions.log({
          // 标识由 `log()` 自己生成，它**从不读**传进来的这个字段。留空串是刻意的：
          // 填一个看起来像真的假标识，将来谁误用它就是一条落在别人身上的记录。
          id: '',
          createdAt: at,
          updatedAt: at,
          kind: intent.kind as FocusSession['kind'],
          plannedMs: Math.round(intent.plannedMinutes * MINUTE_MS),
          ...(intent.actualMinutes === undefined
            ? {}
            : { actualMs: Math.round(intent.actualMinutes * MINUTE_MS) }),
          ...(intent.taskId === undefined ? {} : { taskId: intent.taskId }),
          ...(intent.completed === undefined ? {} : { completed: intent.completed }),
        });
        return { ok: true, taskId: id, entityId: id, entityType: 'FOCUS_SESSION' };
      } catch (error) {
        // 那三种失败各有码（`focusLogFailureCode` 是它为此导出的），所以这里不猜、
        // 也不把词表抄一遍："这种类型不认识"就够了，三种取值已经写在工具描述里。
        const code = focusLogFailureCode(error);
        if (code === 'unknown-kind') {
          return { ok: false, reason: 'invalid', message: '专注类型不认识（只有工作 / 短休息 / 长休息）。' };
        }
        if (code === 'non-positive-planned-ms') {
          return { ok: false, reason: 'invalid', message: '计划时长必须大于 0 分钟。' };
        }
        if (code === 'missing-created-at') {
          // 落不到这条：`createdAt` 由这里填 `now()`。留着是因为**宿主换了一个不动的时钟**
          // （测试里传 `() => 0`）就会走到这里 —— 那是一条该响亮报出来的接线错，
          // 不能让它变成"写成功了但记录是坏的"。
          return { ok: false, reason: 'invalid', message: '宿主时钟给不出有效的记录时刻。' };
        }
        throw error;
      }
    }

    case 'create-reminder': {
      const task = actions.findTask(intent.taskId);
      if (task === undefined) {
        return { ok: false, reason: 'not-found', message: '没有找到这个任务。' };
      }
      // 上限问领域层导入的那个常量，**数字不住在这里**（同 `GOAL_TYPES` 那条先例的理由：
      // 抄一个数字，漂的时候没有任何一层会报错）。
      const alive = aliveReminders(Object.values(ctx.getState().reminders)).filter(
        (r) => r.taskId === intent.taskId,
      );
      if (alive.length >= MAX_REMINDERS_PER_TASK) {
        return {
          ok: false,
          reason: 'invalid',
          message: `这条任务的提醒已经有 ${String(alive.length)} 条，到上限了（写入层按同一个数拦，` +
            '界面没有另设一套）。',
        };
      }

      if (intent.minutesBeforeDue !== undefined) {
        if (task.dueDate === undefined) {
          return {
            ok: false,
            reason: 'invalid',
            message: '这条任务没有截止时间，"提前多少分钟提醒"没有依据 —— 要提醒就给它一个截止日。',
          };
        }
        const offsetMs = intent.minutesBeforeDue * MINUTE_MS;
        // 走 `createReminderBeforeDue` 而不是自己算 `dueDate - offsetMs`：
        // 它会把 `offsetMs` 一起落进 payload，重复任务每次顺延都还能按"提前 30 分"重排。
        // 自己算那个减法，落出来的记录就没有 offset，下一次顺延会留在旧时刻上。
        try {
          const id = await reminderActions.createReminderBeforeDue(intent.taskId, offsetMs);
          return { ok: true, taskId: id, entityId: id, entityType: 'REMINDER' };
        } catch (error) {
          return {
            ok: false,
            reason: 'invalid',
            message: error instanceof Error && error.message !== '' ? error.message : '这条提醒落不下来。',
          };
        }
      }

      if (intent.date === undefined || intent.time === undefined) {
        // pack 已经挡过一次；这里是**第二条腿**（MCP 侧的调用方不经过助手的形状检查）。
        return {
          ok: false,
          reason: 'invalid',
          message: '要提醒就得说清时刻：给 date + time，或者给 minutesBeforeDue。',
        };
      }
      const triggerAt = localDateTimeToEpoch(`${intent.date}T${intent.time}`);
      if (triggerAt === undefined) {
        return {
          ok: false,
          reason: 'invalid',
          message: `无法理解这个时刻「${intent.date} ${intent.time}」。日期应为 YYYY-MM-DD，时间应为 HH:MM。`,
        };
      }
      const rejection = reminderRejection(triggerAt, now());
      if (rejection === 'not-a-time') {
        return { ok: false, reason: 'invalid', message: '这个提醒时刻不是一个可用的时间。' };
      }
      if (rejection === 'in-the-past') {
        return { ok: false, reason: 'invalid', message: '提醒时刻已经过了 —— 要么往前调，要么这条就不必了。' };
      }
      if (rejection === 'too-far') {
        return {
          ok: false,
          reason: 'invalid',
          message: `这个提醒太远（超过最长提前量 ${String(Math.round(MAX_REMINDER_LEAD_MS / DAY_MS))} 天）。`,
        };
      }
      const id = await reminderActions.createReminder(intent.taskId, triggerAt);
      return { ok: true, taskId: id, entityId: id, entityType: 'REMINDER' };
    }

    case 'create-event': {
      const rejection = eventRejection(intent.title, intent.date as LocalDate);
      if (rejection !== undefined) {
        return { ok: false, reason: 'invalid', message: eventRejectionMessage(rejection, intent.title, intent.date) };
      }
      if (intent.kind !== undefined && !isEventKindName(intent.kind)) {
        return {
          ok: false,
          reason: 'invalid',
          message:
            `类型档位应为 ${EVENT_KIND_NAMES.join(' / ')} 之一，收到「${intent.kind}」。` +
            '（词表归 `packages/domain` 的 `CountdownEventKind` 所有，这里只是拒绝未知值。）',
        };
      }
      if (intent.recurrence !== undefined && !isValidRecurrenceRule(intent.recurrence)) {
        return {
          ok: false,
          reason: 'invalid',
          message: `重复规则「${intent.recurrence}」不是合法 RRULE。`,
        };
      }
      const id = await eventActions.createEvent(
        intent.title,
        intent.date as LocalDate,
        {
          ...(intent.kind === undefined || !isEventKindName(intent.kind)
            ? {}
            : { kind: intent.kind }),
          ...(intent.isLunar === undefined ? {} : { isLunar: intent.isLunar }),
          ...(intent.recurrence === undefined ? {} : { recurrence: intent.recurrence }),
          ...(intent.notes === undefined ? {} : { notes: intent.notes }),
        },
      );
      // ⚠️ 返回值的字段名是 `taskId`，但它承载的是"这次写入的实体 id"（既有形状，见
      // `LocalApiWriteResult` 的注释）。另给 `entityType: 'EVENT'` 让外部程序知道落的是什么。
      return { ok: true, taskId: id, entityId: id, entityType: 'EVENT' };
    }

    case 'update-event': {
      const event = eventActions.eventOf(intent.eventId);
      if (event === undefined) {
        return { ok: false, reason: 'not-found', message: '没有找到这个倒数日。' };
      }
      // 与 `update-task` 同一条纪律：不认识就**拒绝**，静默忽略会让调用方以为改成功了。
      const unknown = Object.keys(intent.fields).filter(
        (k) => !(EVENT_UPDATABLE_FIELDS as readonly string[]).includes(k),
      );
      if (unknown.length > 0) {
        return {
          ok: false,
          reason: 'invalid',
          message: `不支持修改这些字段：${unknown.join('、')}。`,
        };
      }

      const f = intent.fields;
      const nextTitle = typeof f['title'] === 'string' ? f['title'] : event.title;
      const nextDate = typeof f['date'] === 'string' ? f['date'] : event.date;
      // 🔴 校验的是**改完之后**的那一条（标题 + 日期），不是逐字段各判各的：
      // `event-actions.ts` 的文件头第 1 条就是"日期与历法同一条 op"，
      // 而 `setEventDate` 内部会拿**当前标题**再判一次 —— 先在这里判掉，
      // 才不会把一个 `throw` 漏到协议层。
      const rejection = eventRejection(nextTitle, nextDate as LocalDate);
      if (rejection !== undefined) {
        return { ok: false, reason: 'invalid', message: eventRejectionMessage(rejection, nextTitle, nextDate) };
      }
      if (f['kind'] !== undefined && f['kind'] !== null && !isEventKindName(f['kind'])) {
        return {
          ok: false,
          reason: 'invalid',
          message:
            `类型档位应为 ${EVENT_KIND_NAMES.join(' / ')} 之一（或 null 表示"不选，回到按日期方向"），` +
            `收到「${String(f['kind'])}」。`,
        };
      }
      const recurrence = f['recurrence'];
      if (typeof recurrence === 'string' && !isValidRecurrenceRule(recurrence)) {
        return {
          ok: false,
          reason: 'invalid',
          message: `重复规则「${recurrence}」不是合法 RRULE。`,
        };
      }

      if (typeof f['title'] === 'string') await eventActions.renameEvent(intent.eventId, f['title']);
      // 🔴 日期与 `isLunar` **合起来一条 op**（领域层的裁决）。
      // 只改农历不改日期时，锚点仍写回**它自己** —— 那不是"顺手多写一个字段"，
      // 是因为 `setEventDate` 是这条 op 的唯一构造点，绕开它就得在这里自己拼 payload。
      if (typeof f['date'] === 'string' || typeof f['isLunar'] === 'boolean') {
        await eventActions.setEventDate(
          intent.eventId,
          (typeof f['date'] === 'string' ? f['date'] : event.date) as LocalDate,
          typeof f['isLunar'] === 'boolean' ? f['isLunar'] : undefined,
        );
      }
      if (f['kind'] === null) await eventActions.setEventKind(intent.eventId, null);
      else if (isEventKindName(f['kind'])) {
        await eventActions.setEventKind(intent.eventId, f['kind']);
      }
      if (typeof recurrence === 'string' || recurrence === null) {
        await eventActions.setEventRecurrence(
          intent.eventId,
          recurrence === null ? null : (recurrence as string),
        );
      }
      if (typeof f['pinned'] === 'boolean') {
        await eventActions.setEventPinned(intent.eventId, f['pinned']);
      }
      if (typeof f['notes'] === 'string' || f['notes'] === null) {
        await eventActions.setEventNotes(
          intent.eventId,
          f['notes'] === null ? null : (f['notes'] as string),
        );
      }
      return { ok: true, taskId: intent.eventId, entityId: intent.eventId, entityType: 'EVENT' };
    }
  }
}
