/**
 * 工具契约的**底层件**：类型 · 投影 · `list_tasks` 的日期参数 · 写入意图
 * ======================================================================
 *
 * 这些定义原来住在 `../tools.ts` 里。搬到这里只有一个原因，而那个原因是结构性的：
 *
 * ```text
 * tools.ts（目录 + 授权）──imports──▶ tools/<entity>.ts（pack）
 *                                         └──imports──▶ tools.ts  ← 环
 * ```
 *
 * pack 需要 `projectListForTool` / `readListTasksDueArgs` 这些**真件**来实现自己的读分支，
 * 而目录又要从 pack 聚合出来。把 pack 要用的那一层单独放到底下，方向就只剩一条：
 * `shared ← pack ← registry ← tools.ts/mcp.ts/server.ts`。
 * **没有循环 import** —— 循环在 ESM 里不报错，它只是让"某个 const 在求值时还是 undefined"
 * 变成随入口顺序漂移的东西，那是最难查的一类红。
 *
 * ⚠️ 本文件的定义**一处都不许复制到别处**（包括注释里）。要新字段先想清楚它属于哪个实体。
 */

// ─────────────────────────────────────────────────────────────────────────
// 工具目录的条目形状
// ─────────────────────────────────────────────────────────────────────────

/** 工具是只读还是会改数据。**这个区分决定它需不需要过 `dispatch()`**。 */
export type ToolKind = 'read' | 'write';

export interface LocalApiTool {
  name: string;
  /** 给模型看的说明。写清楚"做什么"和"不做什么"。 */
  description: string;
  kind: ToolKind;
  /**
   * 🔴 这个工具的**返回值**里，哪些字段可能被送上模型（对话式助手的多步循环用）。
   *
   * 为什么必须在目录里声明，而不是在循环里现算：多步循环把工具观察结果**回送给模型**，
   * 而那些观察结果是用户数据 —— 用户按下"我同意"时看到的披露，必须**已经**包含它们。
   * 靠运行时拼披露就是"先发出去再解释"。（ADR-0045 §2.3 第 1 步：
   * 循环开始前按可达工具集算字段并集，**一次性**披露。）
   *
   * ⚠️ 声明**只多不少**是安全的（披露会更宽），**少了**才是事故：
   * 投影层将来给结果加一个字段而这里没写，披露就说谎了。
   * 所以有一条判据把两边钉在一起 —— 见 `readToolResultFields()`：
   * 它从执行器的**真实投影**取字段，与这里的声明逐项比对，不一致就报错。
   *
   * ⚠️ 命名口径：`<实体>.<字段>`，与 `packages/shared-schema` 的字段名一致。
   * 这不是 zod schema 路径，是**给人和模型看的出境清单**，所以刻意不带类型信息。
   */
  egressFields: readonly string[];
  /**
   * 🔴 **默认值永远是 `false`。**
   *
   * 这不是"暂时没空写默认值"，是**刻意的**：本机工具访问一旦默认打开，
   * 任何本机程序（包括用户不知道自己在装的）都能读走全部任务。
   * Joplin 的 11 个工具全是这个形状。
   */
  defaultEnabled: false;
}

/**
 * 工具层的**信封字段**：不属于任何实体，但确实会出现在观察结果里、
 * 因而会被多步循环回送给模型。
 *
 * 🔴 这条是被**运行时判据抓出来的**，不是设计时想到的：`get_task` 找不到任务时
 * 回的是 `{ ok: true, payload: { error: '没有找到这个任务。' } }`
 * （`tools/task.ts` 的读分支），而 `error` 不在任何 `egressFields` 里 ⇒
 * 助手的"披露集合外就停"那道复查在第一轮运行时就把它拦下来了。
 * 把它单独列成信封而不是塞进每个工具，是因为**每个工具**都可能带它 ——
 * 逐工具声明会变成六份抄件。
 */
export const TOOL_ENVELOPE_EGRESS_FIELDS = ['tool.error'] as const;

/**
 * 一个实体在目录里**至多**能有几个工具。
 *
 * 🔴 这个数字不是拍的，是从界面动作词表推出来的 —— 一个实体在四个端上能被用户
 * 做出来的事只有这七档：
 *
 * | 档 | 例 |
 * |---|---|
 * | 列表读 | `list_tasks` |
 * | 单条读（带正文那一档） | `get_task` |
 * | 新建 | `create_task` |
 * | 修改 | `update_task` |
 * | 追加清单 | `append_task_checklist` |
 * | 该实体专属的那一个动作 | `complete_task` |
 * | 批量改优先级 | `set_task_priorities` |
 * | 估时上下文读 | `get_task_estimate_context` |
 * | 写入估时 | `set_task_estimate` |
 *
 * TASK 单独是 9 的预算。估时上下文与通用 `get_task` 的正文读取有不同的
 * 历史/记忆出境闸门，写入估时也必须单独强制确认，因此不能做成两个可选参数：
 * 那会把两个不同的授权与风险动作伪装成一个工具。
 *
 * ⚠️ 这条取代了原来的 `LOCAL_API_TOOLS.length <= 10`。那句的理由写的是
 * "超过 10 个就先问『真的需要吗』"，而它把**八个实体**逼进同一个 10 席里：
 * 每实体一读一写的下限就要 16 席，所以它会在覆盖面真的补齐时把**最后一个**实体
 * 挡在门外，而那正是"问都不问就拒绝"。总量现在由 `每实体上限 × 覆盖分母` 承接
 * （见 `scripts/check-ai-coverage.mjs` §10），分母扩一席、目录才多一席的预算。
 */
export const MAX_TOOLS_PER_ENTITY = 7;

/**
 * 少数实体可以在默认容量之外登记额外工具；没有登记的实体一律回到默认值。
 *
 * 🔴 这是目录容量的唯一例外表。目录测试与覆盖面门禁都从这个 typed lookup
 * 取数，不能各自再写一份 `TASK → 9` 的判断。
 */
export const MAX_TOOLS_PER_ENTITY_BY_TYPE = {
  TASK: 9,
} as const satisfies Readonly<Partial<Record<string, number>>>;

export type ToolBudgetEntityType = keyof typeof MAX_TOOLS_PER_ENTITY_BY_TYPE;

/** 返回实体的工具预算；未知实体按默认预算处理。 */
export function maxToolsPerEntity(entityType: string): number {
  const override = MAX_TOOLS_PER_ENTITY_BY_TYPE[entityType as ToolBudgetEntityType];
  return override ?? MAX_TOOLS_PER_ENTITY;
}

/**
 * 列表类读工具一次最多回多少条。**默认值只有一份**（原来 `50` 这个字面量
 * 只出现在 `list_tasks` 的宿主实现里；新加的四个列表如果各抄一个数字，
 * "AI 看到的第 N 条"就会在不同实体之间变成不同的意思）。
 *
 * 为什么是 50：列表是喂给模型的，一次几百条会直接吃掉上下文窗口。
 * ⚠️ 它是**出境条数**的上界，不是"截断后再筛"的那个上界 ——
 * 筛一定发生在截断之前（`LocalApiHost.listTasks` 的契约）。
 */
export const DEFAULT_LIST_LIMIT = 50;

/** 把调用方给的 `limit` 收进 `[0, 500]`；非数字或负数按默认值。 */
export function clampListLimit(raw: unknown, fallback: number = DEFAULT_LIST_LIMIT): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return fallback;
  return Math.min(Math.floor(raw), 500);
}

// ─────────────────────────────────────────────────────────────────────────
// `list_tasks` 的日期参数：形状 · 互斥 · **跨度上限**
// ─────────────────────────────────────────────────────────────────────────

/**
 * 按日期查任务时的**跨度上限**（含两端）。
 *
 * 🔴 这个数字不是性能参数，是**三重上界**（ADR-0045 §2.5，形状参考滴答官方表
 * 的 `list_undone_tasks_by_date` —— 它同样是 14 天）：
 *
 * 1. **出境数据量的上界** —— 没有它，一次调用能读走的条目数只受 `limit` 约束，
 *    而"哪个 14 天"由模型说了算；
 * 2. **一次确认的认知负荷上界**；
 * 3. "**用范围上限代替自由查询**"这个形状本身 —— 自由查询意味着契约无法回答
 *    "这次最多会带走多少数据"。
 *
 * ⚠️ 因此**只给 `dueFrom`（不给 `dueTo`）也是被拒的**：那是一条向未来无限开放的
 * 范围，上界直接消失。成对要求是从这条理由推出来的，不是随手加的严格。
 */
export const LIST_TASKS_MAX_DUE_SPAN_DAYS = 14;

/**
 * 一次批量完成最多带多少条 id（W11）。上限的来源与 `LIST_TASKS_MAX_DUE_SPAN_DAYS`
 * 同一条理由，逐字对齐 ADR-0045 §2.5：
 *
 * 1. **一次确认的认知负荷上界** —— 提案卡上只有数量，用户点的是一次"这 N 条都完成"，
 *    N 没有上界就等于让用户在看不见内容的情况下签一张空白支票；
 * 2. **向量时钟的上界** —— 每条变更各占一个刻度（`complete-tasks` 落 N 条 op），
 *    而 `limitVectorClockSize` 的 100 是"把墙挪远不是拆掉"（ADR-0008），
 *    所以"一次意图能推进多少刻度"必须是一个可算的数；
 * 3. **它是"一个提案内含多条"的唯一合法表达方式** —— 超出上限**必须整批拒绝**，
 *    不许偷偷拆成两批（拆了就等于把一次确认变成两次，而那正是 §2.4 要避免的事）。
 *
 * 数字取 20：与竞品的 `complete_tasks_in_project` 单次上限同档（见 gap 分析 AI-G7）。
 */
export const MAX_TASKS_PER_BATCH_COMPLETE = 20;

/** A priority batch is one confirmation card; keep its explicit entries readable. */
export const MAX_TASKS_PER_BATCH_PRIORITY = 20;

/** A checklist append is one user intent; keep the confirmation card readable. */
export const MAX_TASK_CHECKLIST_ITEMS = 20;
export const MAX_TASK_CHECKLIST_ITEM_LENGTH = 200;

/** `YYYY-MM-DD`：四位数年 + **补零**的月/日。规范形只有一份，所以必须补零。 */
const CALENDAR_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 一个日历日的三个字段。 */
export interface CalendarDay {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/**
 * 解析 `YYYY-MM-DD` 并**验证这一天真的存在**；不成立返回 `undefined`（不猜、不修正）。
 *
 * 🔴 为什么不复用 `@heyta/domain` 的 `parseLocalDate`：本包是**零依赖**的入站契约包
 * （`@heyta/domain` 会连带把 `ical.js` 拖进来），而且两者**回答的不是同一个问题**：
 * `parseLocalDate` 决定「这一天在本机是哪一个时刻」，这里只回答
 * 「这两天之间隔着几个自然日」—— **不产生时刻、不做时区换算**。
 * "哪个时刻算这一天"的唯一实现仍然只在 `packages/domain/src/date.ts`
 * 与 `packages/app-host` 的 `fromLocalDateString`。
 *
 * 用 `Date.UTC` 而不是本地构造，正是为了**不引入时区**：UTC 没有夏令时，
 * 相邻两个日历日的日序数恒差 1。
 *
 * ⚠️ 已知且**故意接受**的边界：`Date.UTC` 对 0–99 年有两位数字年的特殊映射，
 * 于是公元 100 年以前的日期会被回读校验判成"不存在"而拒绝。
 * 误判的方向是**拒绝**，不是猜一个日子。
 */
export function parseCalendarDay(text: unknown): CalendarDay | undefined {
  if (typeof text !== 'string') return undefined;
  if (!CALENDAR_DAY_RE.test(text)) return undefined;

  const [year, month, day] = text.split('-').map(Number) as [number, number, number];
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  // 回读校验：越界的月/日会被**自动进位**而不是报错（2 月 30 日 → 3 月 2 日），
  // 只看格式挡不住它。同 `parseLocalDate` 的那条纪律。
  if (
    asUtc.getUTCFullYear() !== year ||
    asUtc.getUTCMonth() !== month - 1 ||
    asUtc.getUTCDate() !== day
  ) {
    return undefined;
  }
  return { year, month, day };
}

/** 日序数（自 1970-01-01 起的天数）。只用于**作差**，绝对值没有含义。 */
function dayOrdinal(d: CalendarDay): number {
  return Math.floor(Date.UTC(d.year, d.month - 1, d.day) / 86_400_000);
}

/**
 * 两个**已验证存在**的日历日之间相差的自然日数（`b - a`；负数 = `b` 早于 `a`）。
 *
 * ⚠️ 不做时区、不产生时刻 —— 见 `parseCalendarDay` 的说明。
 */
export function calendarDaysBetween(a: CalendarDay, b: CalendarDay): number {
  return dayOrdinal(b) - dayOrdinal(a);
}

/** `list_tasks` 的日期参数：通过校验后交给宿主的形状。 */
export interface ListTasksDueArgs {
  readonly dueOn?: string;
  readonly dueFrom?: string;
  readonly dueTo?: string;
}

export type ListTasksDueArgsVerdict =
  | { ok: true; args: ListTasksDueArgs }
  | { ok: false; message: string };

/**
 * 校验 `list_tasks` 的三个日期参数，并回答"这次到底按哪几天筛"。
 *
 * 规则（每一条都写进给模型看的描述，不让它猜）：
 *
 * 1. 三者都必须**存在**（格式 + 真实的一天）；
 * 2. `dueOn` 与 `dueFrom` / `dueTo` **互斥**；
 * 3. `dueFrom` 与 `dueTo` **成对**（半开区间 = 没有上界）；
 * 4. `dueFrom` 不得晚于 `dueTo`；
 * 5. 闭区间跨度（含两端）不超过 {@link LIST_TASKS_MAX_DUE_SPAN_DAYS} 天。
 *
 * 🔴 不合法就返回 `ok: false` —— **不是**"忽略这个参数照样列"。
 * 后者会让"今天有什么任务"在拼错日期时返回**全量前 N 条**，
 * 正是本条缺陷的原形（把"筛不出"伪装成"筛出来的是这些"）。
 */
export function readListTasksDueArgs(
  args: Readonly<Record<string, unknown>>,
): ListTasksDueArgsVerdict {
  const keys = ['dueOn', 'dueFrom', 'dueTo'] as const;

  // 先把**给出来的**每个键解析掉：任何一个不成立就直接拒，
  // 不进入后面的组合判断（否则"dueOn 拼错 + dueFrom 拼对"会报成"互斥"，
  // 把用户指向完全错误的方向）。
  const days: Partial<Record<(typeof keys)[number], CalendarDay>> = {};
  for (const key of keys) {
    const raw = args[key];
    if (raw === undefined) continue;
    const parsed = parseCalendarDay(raw);
    if (parsed === undefined) {
      return {
        ok: false,
        message: `${key} 应为 YYYY-MM-DD（且是真实存在的一天），收到「${formatRejected(raw)}」。`,
      };
    }
    days[key] = parsed;
  }

  const dueOn = days.dueOn;
  const dueFrom = days.dueFrom;
  const dueTo = days.dueTo;

  if (dueOn !== undefined && (dueFrom !== undefined || dueTo !== undefined)) {
    return { ok: false, message: 'dueOn 与 dueFrom / dueTo 只能二选一（要某一天，或者要一段范围）。' };
  }

  if (dueOn !== undefined) {
    return { ok: true, args: { dueOn: formatCalendarDay(dueOn) } };
  }

  // 三个都没给 = 不按日期筛（这是**最常见的**调用形态，不是错误）。
  if (dueFrom === undefined && dueTo === undefined) {
    return { ok: true, args: {} };
  }

  // 🔴 只给一端 = 拒绝（**不是**"当成开区间"）：半开的那一端没有上界，
  // 而"这次最多能读走多少条"必须由契约回答（见 `LIST_TASKS_MAX_DUE_SPAN_DAYS`）。
  if (dueFrom === undefined || dueTo === undefined) {
    return {
      ok: false,
      message: 'dueFrom 与 dueTo 必须一起给 —— 只给一端就是一条没有上界的范围。',
    };
  }

  const forward = calendarDaysBetween(dueFrom, dueTo);
  if (forward < 0) {
    return { ok: false, message: `dueFrom「${formatCalendarDay(dueFrom)}」不能晚于 dueTo「${formatCalendarDay(dueTo)}」。` };
  }

  // 🔴 **含两端**：相邻两天是 2 天，不是 1 天。上限的口径必须和描述里写的一致。
  const span = forward + 1;
  if (span > LIST_TASKS_MAX_DUE_SPAN_DAYS) {
    return {
      ok: false,
      message:
        `按日期查任务最多覆盖 ${String(LIST_TASKS_MAX_DUE_SPAN_DAYS)} 天（含两端），` +
        `「${formatCalendarDay(dueFrom)}」到「${formatCalendarDay(dueTo)}」是 ${String(span)} 天。`,
    };
  }

  return { ok: true, args: { dueFrom: formatCalendarDay(dueFrom), dueTo: formatCalendarDay(dueTo) } };
}

/** 规范化回字符串（校验已保证它是补零的 `YYYY-MM-DD`）。 */
function formatCalendarDay(day: CalendarDay): string {
  return `${String(day.year).padStart(4, '0')}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
}

/** 一天里的时刻：24 小时制的时与分。 */
export interface TimeOfDay {
  readonly hour: number;
  readonly minute: number;
}

/**
 * 解析 `HH:MM`（24 小时制、必须补零），不成立返回 `undefined`。
 *
 * 🔴 它**不产生时刻**，与 {@link parseCalendarDay} 同一个立场：
 * "这一天这一分钟在本机是哪一个 epoch ms"只允许有一处回答
 * （`@heyta/domain` 的 `localDateTimeToEpoch`，`packages/domain/src/date.ts:96`，由宿主调用）。
 *
 * ⚠️ 之所以导出给两边用（工具的形状检查 + 宿主的换算）：
 * 同一个格式在两处各写一遍正则，就是抄件 —— 而它漂的时候症状是
 * "工具收下了 `9:5`，宿主算不出时刻"，报错落在用户已经按下确认之后。
 */
export function parseTimeOfDay(text: unknown): TimeOfDay | undefined {
  if (typeof text !== 'string') return undefined;
  const m = /^(\d{2}):(\d{2})$/.exec(text.trim());
  if (m === null) return undefined;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return undefined;
  return { hour, minute };
}

/** 把被拒的输入打成**一行**放进错误消息：非字符串只报类型，不让对象把内部结构带出去。 */
function formatRejected(raw: unknown): string {
  if (typeof raw === 'string') return raw === '' ? '（空串）' : raw;
  return typeof raw;
}

// ─────────────────────────────────────────────────────────────────────────
// 🔴 加密条目：可列举，不可读
// ─────────────────────────────────────────────────────────────────────────

/**
 * 喂给工具去看的一条数据。
 *
 * 🔴 `readable` 是**关键字段**：它由壳在解密失败 / 用户标记为保护 / 
 * 该条目不在本机可解密范围内时置为 `false`。
 *
 * ⚠️ 注意这是**逐条**的，不是逐库的：同一个任务列表里可以有的可读、
 * 有的不可读。所以判定必须在**每一个**返回数据的地方做，
 * 而不是在"打开数据库"时做一次。
 */
export interface LocalApiItem {
  id: string;
  /** 元数据：这些**即使不可读也返回**（这正是 Bear 说的 "can be listed"）。 */
  title: string;
  dueDate?: string;
  priority?: string;
  completed?: boolean;
  /** 备注正文等**正文类**内容。不可读时必须是 `undefined`。 */
  body?: string;
  /**
   * 🔴 这条数据能不能被本机工具读到正文。
   *
   * `false` 的含义是"**存在**一个任务，但**不给你看它写了什么**"。
   */
  readable: boolean;
}

/**
 * 把一条数据投影成工具能看到的样子。
 *
 * 🔴🔴 **这是 Bear 那条底线的唯一实现点。**
 *
 * 规则：
 * - `readable === false` → **正文类字段一律剥掉**，元数据保留
 * - `readable === true`  → 原样返回
 *
 * 为什么元数据保留：Bear 明确说 "They can be listed"。
 * 让工具知道"这里有个受保护的任务"是有用的（否则用户会以为数据丢了、
 * 或者工具会以为自己查错了）。**"存在"与"内容"是两件事。**
 *
 * ⚠️ 实现上刻意用**白名单重建**（而不是 `delete` 掉敏感字段）：
 * 黑名单永远会漏掉将来新增的字段，白名单不会 ——
 * 新字段默认**不暴露**，要暴露得显式加进来。
 */
export function projectForTool(item: LocalApiItem): LocalApiItem {
  if (item.readable) return item;

  // 白名单重建：只保留元数据。新字段默认不出现。
  const projected: LocalApiItem = {
    id: item.id,
    title: item.title,
    readable: false,
  };
  if (item.dueDate !== undefined) projected.dueDate = item.dueDate;
  if (item.priority !== undefined) projected.priority = item.priority;
  if (item.completed !== undefined) projected.completed = item.completed;
  // 🔴 `body` 在这里**故意不被复制** —— 这就是整件事的目的。
  return projected;
}

/** 批量投影。**所有返回数据的地方都必须经过它。** */
export function projectAllForTool(items: readonly LocalApiItem[]): readonly LocalApiItem[] {
  return items.map(projectForTool);
}

/**
 * `list_tasks` 专用的**再窄一层**投影：连可读条目的正文也不出。
 *
 * 🔴 这不是新规则，是把目录里已经写着的两句承诺落到唯一执行点：
 * - 工具描述："不返回备注正文 —— 备注要单独用 `get_task` 取"
 * - `egressFields`：`list_tasks` 里**没有** `task.body`
 *
 * 而这两句以前**没人执行**：宿主侧 `listTasks` 与 `getTask` 用的是同一个
 * `taskToItem`（`packages/app-host/src/local-api-host/task.ts` 只在不可读时剥正文），
 * 所以只要任务有备注，正文就会跟着列表一起出去。
 * 助手的"披露集合外就停"那道复查是它**唯一的观测点** —— 单步路径不看载荷形状，
 * MCP 客户端也不会抱怨"多给了"。2026-10-03 由多步循环的第一次真实运行抓出。
 *
 * ⚠️ 为什么不直接改 `projectForTool`：那条路径 `get_task` 也在用，
 * 而 `get_task` 的**存在理由就是取正文**。两个视图两种形状，分开表达。
 */
export function projectListForTool(items: readonly LocalApiItem[]): readonly LocalApiItem[] {
  return projectAllForTool(items).map((item) => {
    if (item.body === undefined) return item;
    // 白名单重建（同 `projectForTool` 的纪律）：将来新增的字段默认不出现。
    const listShaped: LocalApiItem = {
      id: item.id,
      title: item.title,
      readable: item.readable,
    };
    if (item.dueDate !== undefined) listShaped.dueDate = item.dueDate;
    if (item.priority !== undefined) listShaped.priority = item.priority;
    if (item.completed !== undefined) listShaped.completed = item.completed;
    return listShaped;
  });
}

/**
 * `get_task` 专用：不可读的条目**不是"返回 null"，而是明确报错**。
 *
 * 为什么和列表不同：列表返回"有我但不给你看"是**正确**的；
 * 而 `get_task` 被要求读正文，正确答案是**拒绝**，不是返回一个
 * 看起来像"这个任务没有备注"的空结果 ——
 * 后者会让调用方以为读成功了。
 */
export type ReadVerdict =
  | { ok: true; item: LocalApiItem }
  | { ok: false; reason: 'not-readable'; message: string };

export function readItemForTool(item: LocalApiItem): ReadVerdict {
  if (item.readable) return { ok: true, item };
  return {
    ok: false,
    reason: 'not-readable',
    message:
      `任务「${item.title}」受保护，本机工具只能看到它存在，不能读取内容。` +
      '这是设计如此，不是错误。',
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 写入路径
// ─────────────────────────────────────────────────────────────────────────

/**
 * 写入端口 —— **唯一**允许本机工具改数据的方式。
 *
 * 🔴 它的形状就是 `dispatch`：一次调用 = 一个 `OpIntent`。
 *
 * 为什么这么设计：ADR-0005 §3.1 规定 **op-log 是唯一写入口**。
 * 本机 API 如果直接改状态、或自己拼 op，就会绕过：
 * - 向量时钟（→ 同步冲突解不开）
 * - 幂等（→ 重试产生重复任务）
 * - 冲突检测
 *
 * ⚠️ 本包**不 `import` `@heyta/op-log`**，原因是它会让
 * "AI/工具不写 op"这条约束在类型上失效（见 `@heyta/ai` 的 `AiSuggestion`）。
 * 这里用一个**结构化的最小接口**：形状对得上就能接，
 * 但本包自己**造不出**一个 op（没有构造函数）。
 *
 * 壳负责把它接到真的 `dispatch()` 上。有测试断言这个端口的形状。
 */
export interface LocalApiWritePort {
  /**
   * 提交一次写入。
   *
   * `intent` 是**不透明的**：本包不解释它，只传递。
   * 这保证了解释 op 的地方只有一处（`packages/op-log`）。
   */
  submit(intent: LocalApiWriteIntent): Promise<LocalApiWriteResult>;
}

/**
 * 交给 `dispatch` 的意图。
 *
 * 🔴 **刻意不是 `OpIntent`**，也没有任何 op 构造函数：
 * 工具能表达的只有下面这几种动作，且**必须由壳翻译成 op**。
 * 这样"本机工具只能通过既定动作写"就成了类型层面的保证。
 *
 * ⚠️ 加一个新实体的写入动作 = 在这里加一个联合成员 **且**在
 * `tools/<entity>.ts` 的 `toIntent()` 里认领它。两边对不上时
 * `runReadTool` / `toWriteIntent` 会回 `tool-not-implemented`（响亮失败，
 * 不是"这个工具不存在"），而 `tests/tool-pack-coverage.spec.ts` 遍历整份目录
 * 逐个驱动一遍 —— 漏认领的红就在那一条测试里，不在生产路径上。
 *
 * 🔴 每加一个成员，**每个宿主都必须把它翻译成动作**：`LocalApiHost.submit` 的
 * 实现里那个 `switch` 没有 `default`，漏一条就编译不过。这不是不便，是
 * ADR-0035 / AGENTS §3.5 要的"逼每个宿主表态" —— 反过来（把新实体塞进既有
 * 成员，例如用 `create-task` 假装建习惯）会让界面与统计一起说谎。
 */
export type LocalApiWriteIntent =
  | { action: 'create-task'; title: string; dueDate?: string; priority?: string; projectId?: string }
  | { action: 'update-task'; taskId: string; fields: Readonly<Record<string, unknown>> }
  | { action: 'append-task-checklist'; taskId: string; items: readonly string[] }
  | { action: 'complete-task'; taskId: string }
  | {
      action: 'set-task-priorities';
      entries: readonly { taskId: string; priority: string }[];
    }
  /** 估时写入备注里的可替换行；分钟必须是整数，夹取由 app-host 统一执行。 */
  | { action: 'set-task-estimate'; taskId: string; minutes: number }
  /**
   * 批量完成（W11 / ADR-0045 §2.5）：**一个提案内含多条**，不是一提案一确认地 fan-out。
   *
   * 🔴 落 N 条 op 而不是 1 条：`entityIds` / `BATCH` 那两条"单 op 承载多实体"的路
   * 在这个仓库里是**装饰**（reducer `packages/op-log/src/state.ts` 只读 `op.entityId`，
   * 实体 2..N 没人应用），而服务端 `op-replay.ts` 却按全部成员处理 —— 一旦真发批量 op，
   * 快照重建与 op-log 重放就会不一致。所以批量住在**提案/确认这一层**（§2.5 的原文是
   * "一个提案、一次确认、一次 `submit` 里落多条"，它没有规定"一条 op"），
   * 不住在线协议层。上限与它为什么存在见 `MAX_TASKS_PER_BATCH_COMPLETE`。
   */
  | { action: 'complete-tasks'; taskIds: readonly string[] }
  /** 新建清单（PROJECT）。`parentId` 省略 = 顶层；由宿主验它真的存在。 */
  | { action: 'create-project'; name: string; parentId?: string }
  /**
   * 新建习惯（HABIT）。
   *
   * ⚠️ 这里只有**名称 + 目标三件事**（数值 / 单位 / 达成口径），刻意不含
   * `color` / `icon` / `backfillDays`：那些是用户在界面上挑的身份标记，
   * "AI 替用户选一个图标"不是产品语义。要加就得先回答"谁赋它的义"。
   */
  | {
      action: 'create-habit';
      name: string;
      target?: number;
      unit?: string;
      goalType?: string;
    }
  /**
   * 新建标签（TAG）。只有名称：`Tag.color` 在界面上**没有任何写入路径**
   * （全仓只有 `OpType.Create` / `OpType.Delete` 落在 `TAG` 上），给它上色不是产品语义。
   */
  | { action: 'create-tag'; name: string }
  /**
   * 给一条任务**整组覆盖**标签（TAG）。空数组 = 清空 —— 这是界面里的那个动作，
   * 不是"追加"：追加要由调用方先把现有 id 读回来再交全集。
   *
   * 🔴 刻意不是 `add-tag`：`setTags` 是字段级 LWW，"追加"语义在两个设备上会各自
   * 算出不同的并集（AGENTS §3.4 的并发形状），而界面上也没有"追加一个标签"这个动作。
   */
  | { action: 'set-task-tags'; taskId: string; tagIds: readonly string[] }
  /** 新建便签（NOTE）。`projectId` 省略 = 不归属；`isPinnedToToday` 省略 = 不钉。 */
  | { action: 'create-note'; content: string; projectId?: string; isPinnedToToday?: boolean }
  /** 改便签正文（NOTE）。改的是正文这一件事；归属与钉今天各有各的动作。 */
  | { action: 'update-note'; noteId: string; content: string }
  /**
   * 记一次打卡（HABIT_LOG）。`date` 是 `YYYY-MM-DD` 本地日历日，省略 = 今天；
   * `value` 省略 = 用该习惯自己的目标数值。
   *
   * ⚠️ 它**不是** `check-in-habit`：打卡落地的是那条**记录**（HABIT_LOG），
   * 不是习惯定义（HABIT）—— 按名字判定实体时 `checkin` 归 HABIT_LOG，
   * 而把工具挂到 HABIT 上会让"哪个实体被覆盖了"在两个地方各说一遍。
   */
  | { action: 'record-checkin'; habitId: string; date?: string; value?: number }
  /**
   * 记一段专注（FOCUS_SESSION）。分钟数而不是毫秒：模型算 `45 * 60000` 会算错，
   * 而算错的方向是**把 45 分钟记成 45 毫秒**，界面上就是一条长度为 0 的记录。
   */
  | {
      action: 'log-focus';
      kind: string;
      plannedMinutes: number;
      actualMinutes?: number;
      taskId?: string;
      completed?: boolean;
    }
  /**
   * 给一条任务加提醒（REMINDER）。两种形态**二选一**（互斥在本包的 `toIntent` 判）：
   * `date` + `time` 是绝对时刻，`minutesBeforeDue` 是"比截止早 N 分钟"。
   *
   * 🔴 这里没有 `triggerAt` 毫秒：本包不产生时刻，"这一天这一分钟在本机是哪个时刻"
   * 只允许有一处回答（`@heyta/domain` 的 `localDateTimeToEpoch`，由宿主调用）。
   * 互斥由**本包的 `toIntent`** 判（两个都给 = 拒绝），宿主只补"两个都没给"那条腿
   * —— MCP 侧的调用方不经过助手。
   */
  | {
      action: 'create-reminder';
      taskId: string;
      date?: string;
      time?: string;
      minutesBeforeDue?: number;
    }
  /**
   * 新建倒数日/纪念日（EVENT，W10）。`date` 是锚点日 `YYYY-MM-DD`（没有"几点"）；
   * `kind` 的封闭词表归 `packages/domain` 的 `CountdownEventKind` 所有，
   * 宿主侧 `isEventKindName` 是唯一判定入口。
   */
  | {
      action: 'create-event';
      title: string;
      date: string;
      kind?: string;
      isLunar?: boolean;
      recurrence?: string;
      notes?: string;
    }
  /** 修改倒数日字段（W10）。只改显式给定的字段；要把某项清空请显式传 `null`。 */
  | { action: 'update-event'; eventId: string; fields: Readonly<Record<string, unknown>> };

/**
 * 一条写入落地的实体类型。
 *
 * 🔴 它是 `packages/shared-schema` 的 `ENTITY_TYPES` 的**子集**（不是"逐字一致"：
 * `TASK_REPEAT_CFG` / `AI_FEEDBACK` / `GLOBAL_CONFIG` 这些没有、也不该有工具写入通道）。
 * 本包零依赖，**看不见**那个清单，所以这里是一份手抄的封闭集合。
 *
 * ⚠️ 手抄就有漂移风险，所以 `packages/app-host/tests/entity-type-parity.spec.ts` 把它
 * 在**编译期**钉成 `ENTITY_TYPES` 的子集，并在运行期钉"每个成员都真有一个 pack 能产出它"
 * （钉它的那一层必须同时看得见两边 —— 本包看不见，就不能在本包里加这条判据）。
 * 这条是类型级的 ⇒ 它由 `pnpm -r typecheck` 执行，不是运行期门禁；写在这里是为了让
 * 下一个加成员的人知道有一处会替他报错，而不是"抄错了等运行时看运气"。
 *
 * 🔴 加成员的顺序：**先有 pack 和写入动作，再有这个成员**。反过来（先声明一个还没有
 * 实体的类型）会让这个类型读起来像"刚发生的事"而它其实是计划 —— 而 `applyOperation`
 * 对未建模的 entityType **静默忽略**，落一条那样的 op 是"写进去了、四个端都看不见"。
 *
 * 🔴 它为什么必须存在：`LocalApiWriteResult.taskId` 是既有的必填字段名，来自
 * 目录里只有任务写入的年代。清单/习惯的写入如果照它回一个 id，
 * MCP 客户端与模型就会以为**刚建了一条任务** —— 那是"界面在说谎"那一类，
 * 而这次说谎的对象是外部程序。
 */
export type LocalApiWrittenEntityType =
  | 'TASK'
  | 'PROJECT'
  | 'HABIT'
  | 'TAG'
  | 'NOTE'
  | 'HABIT_LOG'
  | 'FOCUS_SESSION'
  | 'REMINDER'
  | 'EVENT';

export type LocalApiWriteResult =
  | {
      ok: true;
      /**
       * 🔴 **既有形状**：任务写入时它就是任务 id，别的写入也必须填（填的是
       * 那条落地实体的 id），因为三个宿主与既有判据都按 `result.taskId` 读它。
       * 出协议时它**不会**单独代表非任务实体 —— 那种情况回的是
       * `entityId` + `entityType`（见 `server.ts` 的 `writeResult()`）。
       */
      taskId: string;
      /**
       * 🔴 批量写入时填**全部**落地 id（顺序与提交的一致）。
       *
       * 为什么不是"只回 `taskId` 就行"：`taskId` 在批量场景里只是第一条，
       * 而调用方（外部程序经 MCP、以及界面上的确认卡）必须能知道"哪几条真的被改了" ——
       * 只回一条等于对调用方说"就改了这一条"，那是说谎而不是省略。
       * ⚠️ 单条写入**不许**填它：留空就是"这是一次单条写入"，
       * 判据据此区分两条路径，不需要再加一个布尔字段。
       */
      taskIds?: readonly string[];
      /** 落地的是**别的实体**时必填（与 `entityType` 成对出现）。 */
      entityId?: string;
      /** 给了它就必须给 `entityId`；任务写入留空 = 既有形状。 */
      entityType?: LocalApiWrittenEntityType;
    }
  | { ok: false; reason: 'rejected' | 'not-found' | 'invalid'; message: string };
