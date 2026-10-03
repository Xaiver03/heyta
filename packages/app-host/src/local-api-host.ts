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
  LocalApiHost,
  LocalApiItem,
  LocalApiProject,
  LocalApiWriteIntent,
  LocalApiWriteResult,
} from '@heyta/local-api';
import {
  localTimeOf,
  Priority,
  eventDaysFromToday,
  eventKindOf,
  eventRejection,
  isEventPinned,
  isEventRepeating,
  isValidRecurrenceRule,
  nextEventOccurrence,
  today as todayOf,
  type CountdownEvent,
  type CountdownEventKind,
  type LocalDate,
  type Task,
} from '@heyta/domain';

import type { ActionContext, TaskActions } from './actions.js';
import { createEventActions, type EventActions } from './event-actions.js';
import { createProjectActions } from './project-actions.js';

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
   * 墙上时钟，只用于"今天"这个**读侧锚点**（倒数日的"还有几天"必须有参照日）。
   *
   * ⚠️ 与 `isReadable` 不同，这个**有**默认值（`Date.now`）：
   * 它不是隐私开关，忘了传的后果是"少算一天"而不是"多读数据"，
   * 方向完全不同（见 `ai-breakdown.ts` 里对这两种失败方向的区别）。
   */
  now?: () => number;
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
  if (task.dueDate !== undefined) item.dueDate = toLocalApiDueString(task.dueDate);
  if (task.priority !== undefined) item.priority = PRIORITY_TO_NAME[task.priority] ?? 'none';
  // 🔴 正文只在可读时挂上。不可读时**连字段都不存在** ——
  // 与 `projectForTool` 的白名单重建是同一条纪律的两个执行点。
  if (readable && task.note !== undefined) item.body = task.note;
  return item;
}

/**
 * `CountdownEvent` → `LocalApiEventItem`。**备注只在 `readable` 时带。**
 *
 * 🔴 全部日历判断都**问领域层**（`eventKindOf` / `nextEventOccurrence` /
 * `eventDaysFromToday` / `isEventRepeating` / `isEventPinned`），本函数一个都不自己算 ——
 * "下一次是哪天"如果在协议层再算一遍，就会出现"卡片说还有 3 天、AI 说还有 4 天"，
 * 而这两句话同一屏里都能出现（AGENTS §3.5 记着这类漂移两次学费）。
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
  // 协议层还会再窄一层（`projectEventListForTool`），两个执行点都要在。
  if (readable && event.notes !== undefined) item.notes = event.notes;
  return item;
}

/**
 * 倒数日 `kind` 的**校验点**。
 *
 * 🔴 形状是 `Record<CountdownEventKind, true>` 而**不是**一个数组，理由是这条判断
 * 必须**跟着领域层的词表走**：`packages/domain` 加一档而这里没补，
 * `tsc` 当场报"缺属性"—— 一份数组抄件则是**永远静默少一档**（新值被当成非法而拒绝，
 * 或更糟：老实现继续放行未知值）。反向也一样：删掉一档，这里也会红。
 *
 * ⚠️ `packages/domain` 目前**没有**运行时的词表清单（`CountdownEventKind` 只是类型），
 * 而本工单的文件边界不许我改 `packages/domain/src/**` ⇒ 这份 `Record` 是
 * **当前唯一**能同时满足"编译期跟着类型走"和"运行时可判定"的形状。
 * 领域层哪天导出 `EVENT_KIND_TYPES`，这里就该改成 `Object.fromEntries(...)` 派生。
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
  const now = options.now ?? ((): number => Date.now());

  // 🔴 倒数日的动作层**在这里自己建**，不是让壳再传一个参数：
  // 它需要的只有 `ActionContext`（本函数第一个参数已经有了）。
  // 把它做成第 4 个入参会让每个宿主都要记得传 —— 而"记得传"不是判据。
  // op 的构造仍然只在 `event-actions.ts` 一处（本文件一行 `dispatch` 都没有）。
  const eventActions = createEventActions(ctx);

  // 🔴 用**同一个动作层**读清单，不在这里重推"哪些清单算活的"（见下面 `listProjects`）。
  const projectActions = createProjectActions(ctx);

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
          if (task.dueDate === undefined) return false;
          // 用的是**投影那一个换算的前半段**（`taskToItem` → `toLocalApiDueString`
          // → `toLocalDateString`），所以"拿来比的日子"与"返回里显示的日子"
          // 必然是同一个日子 —— 不会出现"筛 15 号，而返回里写着 15 号的那条被漏掉"。
          // ⚠️ 过滤**按日**、不按分钟，这是刻意的：`dueOn` 的契约就是"截止日正好是这一天"
          //   （`server.ts:69-72`），带时刻的任务属于它那一天的 00:00–23:59。
          const day = toLocalDateString(task.dueDate);
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

    /**
     * 列倒数日。**顺序、集合成员、正文判定全部问领域层。**
     *
     * 🔴 `limit` 与 `listTasks` 同一条纪律：**先筛后截**。
     * 这里"筛"就是 `listEvents(today)` 已经做完的那一层（未删除 + 未归档 + 规范顺序），
     * 所以截断只能发生在它**之后** —— 反过来会变成"倒数日排在第 50 条之后就查不到"。
     */
    listEvents: (args) => {
      const day = todayOf(now());
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
      return Promise.resolve(eventToItem(event, isReadable(event), todayOf(now())));
    },

    submit: (intent) => submitIntent(actions, eventActions, intent),
  };
}

/**
 * 把一个写入意图翻译成动作调用。
 *
 * 🔴 **这是 `LocalApiWriteIntent` 唯一被解释的地方。**
 * 译不出来（或参数不合法）就返回 `invalid`，**绝不"尽力而为"地猜**。
 */
async function submitIntent(
  actions: TaskActions,
  eventActions: EventActions,
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
      const task = actions.findTask(intent.taskId);
      if (task === undefined) {
        return { ok: false, reason: 'not-found', message: '没有找到这个任务。' };
      }
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
      if (typeof f['title'] === 'string') await actions.rename(intent.taskId, f['title']);
      if (typeof f['completed'] === 'boolean') await actions.setCompleted(intent.taskId, f['completed']);
      if (typeof f['priority'] === 'string') {
        const p = NAME_TO_PRIORITY[f['priority'].toLowerCase()];
        if (p === undefined) {
          return { ok: false, reason: 'invalid', message: `未知优先级「${f['priority']}」。` };
        }
        await actions.setPriority(intent.taskId, p);
      }
      if (typeof f['dueDate'] === 'string') {
        const epoch = fromLocalDateString(f['dueDate']);
        if (epoch === undefined) {
          return { ok: false, reason: 'invalid', message: `截止日期格式应为 ${LOCAL_API_DUE_FORMAT_HINT}。` };
        }
        await actions.setDueDate(intent.taskId, epoch);
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

    // ── 倒数日 / 纪念日（W10）────────────────────────────────────────
    //
    // 🔴 这一整段**一行 op 都不构造**：写全部经 `eventActions.*`，
    // 也就是全部经 `ctx.dispatch()`。这正是 `check:ai-tools` 规则 3 与
    // `check:layering` 的 `no-op-construction-in-apps` 要的形状 ——
    // 而"AI 提案 → 用户确认 → 这里落地"这条链上，确认之前不可能有写。
    //
    // ⚠️ 与任务那三条同一取舍：**先判、后写**，判不出来返回 `invalid`，
    // 不"尽力而为地猜一个日期"。`event-actions.ts` 对不合法输入是**抛异常**的
    // （界面走的那条路），而工具走的是返回值 —— 所以这里把异常翻译成 `invalid`，
    // 而不是让一个 throw 顺着 JSON-RPC 变成 `-32603 internal error`。
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
      // ⚠️ 返回值的字段名是 `taskId`，但它承载的是"这次写入的实体 id"。
      // 见 `LocalApiWriteResult` 的注释 —— 不改名是为了不牵动 `apps/**` 的调用点。
      return { ok: true, taskId: id };
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
      // 🔴 日期与 `isLunar` **合起来一条 op**（领域层的裁决，见上面那段注释）。
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
      return { ok: true, taskId: intent.eventId };
    }
  }
}

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
