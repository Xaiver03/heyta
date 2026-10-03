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
 */
export type LocalApiWriteIntent =
  | { action: 'create-task'; title: string; dueDate?: string; priority?: string; projectId?: string }
  | { action: 'update-task'; taskId: string; fields: Readonly<Record<string, unknown>> }
  | { action: 'complete-task'; taskId: string };

export type LocalApiWriteResult =
  | { ok: true; taskId: string }
  | { ok: false; reason: 'rejected' | 'not-found' | 'invalid'; message: string };
