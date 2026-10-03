/**
 * 本地 API / MCP —— 工具契约
 * ============================
 *
 * ADR-0011 的实现。这是 heyta 的**入站**面：让本机的其他程序
 * （Claude Code / Cursor / Raycast / 用户自己的脚本）读写 heyta 里的任务。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么这是**独立于 `@heyta/ai` 的一个包**
 *
 * 两个包的方向是**相反**的，信任模型也相反：
 *
 * | 包 | 方向 | 谁在请求 | 主要风险 | 默认 |
 * |---|---|---|---|---|
 * | `@heyta/ai` | **出站** | 我们发给模型 | 把用户数据送出去 | 关 |
 * | `@heyta/local-api` | **入站** | 本机其他程序打进来 | 别的程序把数据读走 / 乱写 | 关 |
 *
 * 把两者放进同一个包会**在类型层面把"我们发数据出去"和"别人拉数据进来"混在一起** ——
 * 那正是最容易配错的地方（例如把 AI 的"允许远程"开关误当成"允许本机程序访问"）。
 * 分开之后，"回退不得跨越隐私边界"（ADR-0010）与"加密条目不可读"（本文件）
 * 各自只有一个地方能出错。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 设计照抄自 Joplin 与 Bear（证据见 research/e2ee-apps-ai.md）
 *
 * **Joplin 给的是一条可执行的形状**：
 * - 两个开关都**默认关**（AI 与本机工具访问分开控制）
 * - MCP 的 11 个工具**全部默认关**，逐个开
 * - 只监听 `127.0.0.1`
 * - 用 token 防**本机其他程序**（不是防网络攻击 —— 它压根不出机器）
 *
 * **Bear 给的是一条不可商量的底线**：
 * > "Encrypted notes stay encrypted. They can be listed, but never read or
 * >  modified by any of these tools."
 *
 * 也就是：**能看见"有这条"，看不见"这条写了什么"。**
 *
 * ⚠️ 本文件**不实现 HTTP 服务**。按 ADR-0003，`apps/*` 只放平台差异，
 * 业务逻辑在 `packages/`。这里只定义**契约与授权判定**，
 * 真正监听端口、解析 JSON-RPC 的是壳。这样"授权规则"只有一份实现，
 * 而"怎么暴露"可以每个平台不同。
 */

// ─────────────────────────────────────────────────────────────────────────
// 工具目录
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
   * 所以有一条判据把两边钉在一起 —— `packages/local-api/tests/tool-egress-fields.spec.ts`
   * **实际跑一遍 `runReadTool`**、收集载荷里出现过的每一个键，要求它们都在这里的声明里。
   * （判据不是"读代码比名字"，那会跟着代码一起漂；这条对照当场抓出过 `list_tasks`
   * 把正文带进列表那件事。）
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
 * 工具目录。
 *
 * ⚠️ 刻意**保持很小**。Joplin 有 11 个工具，但那是一个笔记应用。
 * 这里是任务管理，够用就停 —— **工具每多一个，"默认关"的清单就长一条，
 * 而用户不可能逐个理解它们的风险**。
 *
 * 所以只留 6 个：3 读 + 3 写。宁可将来加，不要现在删。
 */
export const LOCAL_API_TOOLS: readonly LocalApiTool[] = [
  {
    name: 'list_tasks',
    egressFields: ['task.id', 'task.title', 'task.dueDate', 'task.priority', 'task.completed', 'task.readable'],
    description:
      '列出任务。返回标题、截止日期、优先级、完成状态。' +
      '可按清单、完成状态、截止日期筛；按日期查时范围最多 14 天。' +
      '不返回备注正文 —— 备注要单独用 get_task 取。',
    kind: 'read',
    defaultEnabled: false,
  },
  {
    name: 'get_task',
    // 🔴 含正文（`LocalApiItem.body`）—— 这是目录里**出境面最大**的一个工具，
    // 披露必须把它单独说出来：多步循环会把这份正文回送给模型。
    egressFields: ['task.id', 'task.title', 'task.dueDate', 'task.priority', 'task.completed', 'task.readable', 'task.body'],
    description: '读取单个任务的完整内容（含备注正文）。',
    kind: 'read',
    defaultEnabled: false,
  },
  {
    name: 'list_projects',
    egressFields: ['project.id', 'project.name', 'project.taskCount'],
    description: '列出清单/项目及其任务数量。',
    kind: 'read',
    defaultEnabled: false,
  },
  {
    name: 'create_task',
    // 写工具只产出提案、结果不回送模型 ⇒ 出境面是**提案里那几个字段**。
    // 写工具的结果**不回送模型**（循环在提案那一刻就停了），所以它不贡献出境字段。
    // 它产出的是待确认提案，那是本地渲染给用户看的东西，不在出境集合里。
    egressFields: [],
    description: '新建一个任务。必须走 heyta 的正常写入路径（op-log）。',
    kind: 'write',
    defaultEnabled: false,
  },
  {
    name: 'update_task',
    egressFields: [],
    description: '修改任务字段（标题、截止日期、优先级）。只能改显式给定的字段。',
    kind: 'write',
    defaultEnabled: false,
  },
  {
    name: 'complete_task',
    egressFields: [],
    description: '把任务标记为完成。',
    kind: 'write',
    defaultEnabled: false,
  },
];

/**
 * 工具层的**信封字段**：不属于任何实体，但确实会出现在观察结果里、
 * 因而会被多步循环回送给模型。
 *
 * 🔴 这条是被**运行时判据抓出来的**，不是设计时想到的：`get_task` 找不到任务时
 * 回的是 `{ ok: true, payload: { error: '没有找到这个任务。' } }`
 * （`server.ts:347`），而 `error` 不在任何 `egressFields` 里 ⇒
 * 助手的"披露集合外就停"那道复查在第一轮运行时就把它拦下来了。
 * 把它单独列成信封而不是塞进每个工具，是因为**每个工具**都可能带它 ——
 * 逐工具声明会变成六份抄件。
 */
export const TOOL_ENVELOPE_EGRESS_FIELDS = ['tool.error'] as const;

/** 按名字取工具。 */
export function findTool(name: string): LocalApiTool | undefined {
  return LOCAL_API_TOOLS.find((t) => t.name === name);
}

/** 全部工具名。UI 用它渲染"逐工具开关"列表。 */
export function toolNames(): readonly string[] {
  return LOCAL_API_TOOLS.map((t) => t.name);
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
 * `taskToItem`（`packages/app-host/src/local-api-host.ts:128` 只在不可读时剥正文），
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
// 配置与授权
// ─────────────────────────────────────────────────────────────────────────

/**
 * 本机 API 配置。
 *
 * 三个字段各有一次"默认必须是安全值"：
 * - `enabled: false` —— 不打开就不存在这个面
 * - `bindAddress` 只允许回环（见 `validateLocalApiConfig`）
 * - `token` 打开时**必须非空**（见下）
 */
export interface LocalApiConfig {
  enabled: boolean;
  /**
   * 监听地址。
   *
   * ⚠️ 默认 `127.0.0.1`。**类型上不阻止写别的，但 `validateLocalApiConfig`
   * 会拒绝一切非回环地址** —— 因为监听 `0.0.0.0` 等于把用户全部任务
   * 暴露给同一网络里的任何人，而"本机 API"这个名字会让用户以为它是本机的。
   */
  bindAddress: string;
  port: number;
  /**
   * 🔴 显式 token，**打开时必须非空**。
   *
   * 它防的**不是**网络攻击（服务不出机器），而是**本机其他程序**：
   * 没有 token 的话，用户装的任何一个程序、浏览器里的任何一个页面
   * 都能直接打 `http://127.0.0.1:PORT` 读走任务。
   *
   * 对照 Joplin：同样"token guards against local programs"。
   */
  token?: string;
  /** 逐工具授权。**未列出的工具一律视为关闭。** */
  grants?: Readonly<Record<string, boolean>>;
}

export const DEFAULT_LOCAL_API_CONFIG: LocalApiConfig = {
  enabled: false,
  bindAddress: '127.0.0.1',
  port: 47_119,
};

/** 配置被拒绝的原因。 */
export type LocalApiConfigError = {
  ok: false;
  reason: 'not-loopback' | 'token-required' | 'bad-port';
  message: string;
};

export type LocalApiConfigVerdict = { ok: true } | LocalApiConfigError;

/**
 * 校验配置。
 *
 * 🔴 它**只在 `enabled === true` 时**校验 token 与地址 ——
 * 关着的时候允许配置不完整（用户可以先填一半再打开）。
 * 这避免了"想先存个草稿却被拦"的烦人体验，同时保证
 * **真正开始监听的那一刻配置一定是安全的**。
 */
export function validateLocalApiConfig(config: LocalApiConfig): LocalApiConfigVerdict {
  if (!config.enabled) return { ok: true };

  // 端口范围：0 是"随机端口"，对固定 token 的服务没意义，拒绝掉。
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535) {
    return {
      ok: false,
      reason: 'bad-port',
      message: `端口必须是 1–65535 的整数，当前是 ${String(config.port)}。`,
    };
  }

  if (config.token === undefined || config.token.trim() === '') {
    return {
      ok: false,
      reason: 'token-required',
      message:
        '打开本机 API 必须设置一个访问 token。' +
        '没有 token 的话，这台机器上的任何程序都能读走你的全部任务。',
    };
  }

  if (!isLoopbackAddress(config.bindAddress)) {
    return {
      ok: false,
      reason: 'not-loopback',
      message:
        `只允许监听回环地址（127.0.0.1 / ::1 / localhost），拒绝了「${config.bindAddress}」。` +
        '监听其他地址会把你的任务暴露给同一网络里的其他人 —— ' +
        '如果你确实想这样，正确的做法是用你自己的反向代理，而不是让 heyta 直接对外监听。',
    };
  }

  return { ok: true };
}

/**
 * 判断一个监听地址是不是回环。
 *
 * ⚠️ 与 `@heyta/ai` 的 `isLoopbackEndpoint` **刻意不共用**：
 * 那个函数处理的是**完整 URL**（端点是 `http://host:port/path`），
 * 这个处理的是**裸主机/地址**。共用会诱使某一方放宽自己的规则
 * （例如为了复用而允许 `localhost:11434` 这种带端口的字符串），
 * 而放宽的方向通常是**不安全**的那一边。
 *
 * 🔴 特别处理 `0.0.0.0` 与 `::`：它们是"绑定所有网卡"，
 * 最容易被误当成"本机"（字面上像"所有地址"，直觉上像"随便"）。
 * 必须显式拒绝。
 */
export function isLoopbackAddress(address: string): boolean {
  const host = address.trim().toLowerCase().replace(/^\[|\]$/g, '');

  if (host === '0.0.0.0' || host === '::' || host === '*') return false;
  if (host === 'localhost' || host === '::1') return true;

  // 127.0.0.0/8 全部是回环，不只是 127.0.0.1
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4 !== null) {
    const octets = [ipv4[1], ipv4[2], ipv4[3], ipv4[4]].map(Number);
    if (octets.some((o) => o > 255)) return false;
    return octets[0] === 127;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────
// 工具调用授权
// ─────────────────────────────────────────────────────────────────────────

export type ToolCallDenialReason =
  | 'api-disabled'
  | 'token-missing'
  | 'token-mismatch'
  | 'tool-unknown'
  | 'tool-not-granted';

export type ToolCallVerdict =
  | { allowed: true; tool: LocalApiTool }
  | { allowed: false; reason: ToolCallDenialReason; message: string };

/**
 * 判定一次工具调用能不能执行。
 *
 * 顺序即**检查顺序**，且顺序是有意义的：
 * 1. 总开关 —— 关着就什么都不存在
 * 2. 配置合法性（token 必须存在）—— 配置坏了不该继续
 * 3. token 匹配 —— **在知道"哪个工具"之前就验**，避免通过错误信息探测工具是否存在
 * 4. 工具存在
 * 5. 该工具被授权
 *
 * 🔴 第 3 步放在第 4 步之前是刻意的：先验身份、再谈权限。
 * 反过来的话，一个没带 token 的调用方可以通过"未知工具"与"未授权工具"
 * 两种不同错误，**枚举出 heyta 到底提供了哪些工具**。
 *
 * ⚠️ token 比较用**定长比较**（`timingSafeEqual` 风格的逐字符累积），
 * 不用 `===`：后者会在第一个不同字符处提前返回，理论上可被计时探测。
 * 对 localhost 场景这是偏执，但它的成本是零。
 */
export function authorizeToolCall(
  config: LocalApiConfig,
  toolName: string,
  presentedToken: string | undefined,
): ToolCallVerdict {
  if (!config.enabled) {
    return {
      allowed: false,
      reason: 'api-disabled',
      message: '本机 API 未启用。',
    };
  }

  // 🔴 这里**刻意只查 token**，不查整个配置。
  //
  // 第一版调的是 `validateLocalApiConfig(config)`，于是**端口也参与了鉴权**：
  // 一份 token 完全正确、但端口写成 0 的配置会让**每一次工具调用都被拒**，
  // 而报错说的是"未启用"—— 排查方向完全被带偏。
  //
  // 端口是**监听**的属性，不是**鉴权**的属性；它只该在
  // `startLocalApiServer` 里被检查一次（那里查错了才是真的起不来）。
  if (config.token === undefined || config.token.trim() === '') {
    return {
      allowed: false,
      reason: 'token-missing',
      message: '本机 API 需要访问 token。',
    };
  }

  const expected = config.token;
  if (presentedToken === undefined || !constantTimeEquals(presentedToken, expected)) {
    return {
      allowed: false,
      reason: 'token-mismatch',
      message: '访问 token 不正确。',
    };
  }

  const tool = findTool(toolName);
  if (tool === undefined) {
    return {
      allowed: false,
      reason: 'tool-unknown',
      message: `没有名为「${toolName}」的工具。`,
    };
  }

  if (!isToolGranted(config.grants, toolName)) {
    return {
      allowed: false,
      reason: 'tool-not-granted',
      message: `工具「${toolName}」没有被授权。本机工具默认全部关闭，需要在设置里逐个打开。`,
    };
  }

  return { allowed: true, tool };
}

/**
 * 工具是否被用户授权。**未列出 = 关闭。**
 *
 * 🔴 抽出来是因为**判据只能有一份**（不变量 19）。
 * 现在有**两个调用方**要用这条判断：
 *
 * | 调用方 | 为什么不能直接复用 `authorizeToolCall` |
 * |---|---|
 * | MCP / 本机 API | 它还要验会话：总开关、token、工具是否存在 |
 * | **heyta 自己的 AI**（`@heyta/app-host` 的 AI 工具路径） | 那是**进程内**调用：没有 listener、没有 token —— 那两道闸在这里不成立，硬套就得伪造一个 token |
 *
 * 所以把「授权」这一条单独拿出来给两边共用；`authorizeToolCall` 仍然是
 * 它加会话闸的组合。这样"同一个工具在两个入口被两套规则判定"这件事**不会发生**。
 *
 * ⚠️ **它不检查工具是否存在** —— 不存在的工具在 `grants` 里也不会是 `true`，
 * 所以返回 `false` 是安全的（fail-closed）。调用方若要区分"不存在"与"未授权"，
 * 得自己先 `findTool()`：MCP 侧刻意这么做，为的是**不泄露工具目录**。
 */
export function isToolGranted(grants: LocalApiConfig['grants'], toolName: string): boolean {
  return grants?.[toolName] === true;
}

/**
 * 定长比较。
 *
 * 长度不同时**不提前返回** —— 先累积全部差异再判断，
 * 让耗时与"第几个字符不同"无关。
 */
function constantTimeEquals(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
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
 * 工具能表达的只有下面三种动作，且**必须由壳翻译成 op**。
 * 这样"本机工具只能通过既定动作写"就成了类型层面的保证。
 */
export type LocalApiWriteIntent =
  | { action: 'create-task'; title: string; dueDate?: string; priority?: string; projectId?: string }
  | { action: 'update-task'; taskId: string; fields: Readonly<Record<string, unknown>> }
  | { action: 'complete-task'; taskId: string };

export type LocalApiWriteResult =
  | { ok: true; taskId: string }
  | { ok: false; reason: 'rejected' | 'not-found' | 'invalid'; message: string };
