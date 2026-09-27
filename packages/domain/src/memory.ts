/**
 * 记忆层：从事件历史里算出「事实」
 * ==================================
 *
 * ## 这一层为什么存在
 *
 * AI 要说出「你把这 3 件事标成高优先级，但过去两周的专注时间全花在别处了」
 * 这句话，需要先有人算出那个**落差**。落差是**事实**，不是语言问题 ——
 * 事实用规则算，人话才交给模型（见 `docs/plans/ai-strategy.md` §4）。
 *
 * ## 🔴 最重要的一条设计事实：推迟次数**算不出来**，除非有事件流
 *
 * 物化状态（`MaterializedState`）只有**当前值** —— 一条任务的 `dueDate` 是
 * "下周三"。它**不含**「这个日期被往后推过 6 次」这个信息，
 * 因为这个信息**不在当前状态里，只在历史里**。
 *
 * 所以本模块的输入必须同时有 `operations`（op-log 事件流）和当前状态。
 * 这不是实现细节，这是「**op-log 就是记忆**」的直接证据：
 * 换掉 op-log 去用一个只存当前值的库，这个能力就**不复存在**。
 *
 * ## 纯函数、零依赖
 *
 * 不 import 任何框架、不发网络请求、不读时钟（`now` 由调用方传入）。
 * 于是它可以在浏览器、Hermes、Node 三端跑，也可以被单测穷尽。
 *
 * 这也是对"要不要上向量数据库"的回答的一部分：本层需要的全是
 * **聚合**（计数、求和、取最大），而聚合是 SQL/数组一趟扫描就能做的，
 * 与向量检索无关。
 */

/** 一天毫秒数。 */
const MS_PER_DAY = 86_400_000;

/**
 * 本模块需要的 op 形状。
 *
 * 🔴 **故意用结构化类型，不 import `@heyta/sync-core` 的 `Operation`。**
 * 领域层要保持零框架依赖（见 `index.ts` 的说明）；而且真实 `Operation` 里
 * 只有这几个字段是这里需要的。结构化类型让"传真的 Operation 进来"天然成立，
 * 同时不让 domain 多一条包依赖。
 */
export interface MemoryOp {
  opType: string;
  entityType: string;
  entityId?: string;
  payload: unknown;
  timestamp: number;
}

/** 任务在本层需要的最小字段集（`Task` 的结构化子集）。 */
export interface MemoryTask {
  id: string;
  title: string;
  priority?: number;
  important?: boolean;
  dueDate?: number;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

/** 专注记录的最小字段集（`FocusSession` 的结构化子集）。 */
export interface MemoryFocusSession {
  taskId?: string;
  plannedMs: number;
  actualMs?: number;
  startedAt?: number;
  endedAt?: number;
}

export interface MemoryInput {
  tasks: readonly MemoryTask[];
  focusSessions: readonly MemoryFocusSession[];
  /** op-log 事件流。**推算推迟次数必需** —— 见文件头。 */
  operations: readonly MemoryOp[];
  /** 当前时间（epoch ms）。由调用方传入，保证可测。 */
  now: number;
}

/** 单条任务的记忆（全部由历史算出）。 */
export interface TaskMemory {
  taskId: string;
  /** `dueDate` 被改到**更晚**的次数。只能从事件流算。 */
  postponements: number;
  /** 最近一次推迟的时间（epoch ms）。 */
  lastPostponedAt?: number;
  /** 全部推迟累计往后挪了多少毫秒。 */
  postponedTotalMs: number;
  /** 逾期天数；未完成、有截止、且已过才算。 */
  overdueDays: number | null;
  /** 距上次被修改多少天（向下取整）。 */
  daysSinceTouched: number;
  /** 实际专注分钟（`actualMs` 优先，缺失时退到 `plannedMs`）。 */
  focusMinutes: number;
  /**
   * 「建了、有截止、从没专注过一次、还没完成」。
   *
   * 这是"**从未开始**"，与"**开始过但停了**"是两种不同的病：
   * 前者多半是任务本身太大或太模糊，后者往往是动力问题。
   * 混在一起会让后面的建议方向完全跑偏，所以分开。
   */
  neverStarted: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 从事件流里按时间顺序重放每条任务的 `dueDate`，数出推迟次数。
 *
 * ## 判定规则
 * - `CRT` / `UPD` 且 payload 是对象、`entityType === 'TASK'`、有 `entityId`
 * - `payload.dueDate` 是**数字** → 与当前值比较：**更大**才算推迟
 * - `payload.dueDate === null` → 显式清除（`applyOperation` 的语义），记为"未设截止"
 * - 其余字段忽略（我们只关心截止日期的移动）
 *
 * ## ⚠️ 已知近似（不要当成精确审计）
 *
 * 真实写入还会过 `applyOperation` 里的 LWW 闸门（按向量时钟 + `op.id` 判胜负），
 * 被拒的 op **不改变状态**。本函数只按 `timestamp` 排序重放，**没有**实现那道
 * 闸门 —— 因此在一端真的发生过并发冲突时，这里的次数可能与状态不一致。
 *
 * 之所以可以接受：冲突罕见，且这里的用途是**给出一个量级**
 * （"推过很多次" vs "从没推过"），不是财务级审计。
 * 如果将来要用它做用户可见的精确计数，**必须先补上闸门**。
 */
function computePostponements(
  operations: readonly MemoryOp[],
): Map<string, { count: number; lastAt?: number; totalMs: number }> {
  const result = new Map<string, { count: number; lastAt?: number; totalMs: number }>();

  // 只取会影响 dueDate 的 op，并按时间升序重放。
  const relevant = operations
    .filter(
      (op) =>
        op.entityType === 'TASK' &&
        op.entityId !== undefined &&
        (op.opType === 'CRT' || op.opType === 'UPD'),
    )
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp);

  /** 每条任务"当前"的截止时间，随重放推进。 */
  const currentDue = new Map<string, number | undefined>();

  for (const op of relevant) {
    const taskId = op.entityId as string;
    if (!isRecord(op.payload)) continue;
    if (!('dueDate' in op.payload)) continue;

    const raw = op.payload.dueDate;
    const prev = currentDue.get(taskId);

    if (raw === null) {
      // 显式清除截止日期：不算推迟（是"不再限定时间"，不是"往后拖"）。
      currentDue.set(taskId, undefined);
      continue;
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;

    currentDue.set(taskId, raw);

    // 只有"从有到有"且变晚才算推迟。
    // 从"没有截止"到"设了个截止"是**第一次排期**，不是推迟 —— 这个区分很重要，
    // 否则新任务只要带个截止日期就会被记成"推迟过一次"。
    if (prev === undefined || raw <= prev) continue;

    const entry = result.get(taskId) ?? { count: 0, totalMs: 0 };
    entry.count += 1;
    entry.totalMs += raw - prev;
    entry.lastAt = op.timestamp;
    result.set(taskId, entry);
  }

  return result;
}

/** 单条任务的实际专注分钟。 */
function focusMinutesByTask(
  sessions: readonly MemoryFocusSession[],
): Map<string, number> {
  const minutes = new Map<string, number>();
  for (const s of sessions) {
    if (s.taskId === undefined) continue;
    // `actualMs` 更能代表真实投入；只有未完成/被中止时才可能缺失。
    const ms = s.actualMs ?? s.plannedMs;
    if (!Number.isFinite(ms) || ms <= 0) continue;
    minutes.set(s.taskId, (minutes.get(s.taskId) ?? 0) + ms / 60_000);
  }
  return minutes;
}

/**
 * 算出全部未删除任务的记忆。**按 `taskId` 升序**，保证确定性输出。
 */
export function computeTaskMemory(input: MemoryInput): TaskMemory[] {
  const { tasks, focusSessions, operations, now } = input;
  const postponements = computePostponements(operations);
  const focus = focusMinutesByTask(focusSessions);

  return tasks
    .filter((t) => t.deletedAt === undefined)
    .map((t): TaskMemory => {
      const post = postponements.get(t.id);
      const focusMinutes = focus.get(t.id) ?? 0;

      const overdueDays =
        t.completedAt === undefined && t.dueDate !== undefined && t.dueDate < now
          ? Math.floor((now - t.dueDate) / MS_PER_DAY)
          : null;

      const memory: TaskMemory = {
        taskId: t.id,
        postponements: post?.count ?? 0,
        postponedTotalMs: post?.totalMs ?? 0,
        overdueDays,
        daysSinceTouched: Math.max(0, Math.floor((now - t.updatedAt) / MS_PER_DAY)),
        focusMinutes,
        neverStarted:
          t.completedAt === undefined && t.dueDate !== undefined && focusMinutes === 0,
      };
      if (post?.lastAt !== undefined) memory.lastPostponedAt = post.lastAt;
      return memory;
    })
    .sort((a, b) => (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0));
}

// ─────────────────────────────────────────────────────────────
// 专注落差 —— 本层的产出物，也是 AI 护城河的事实基础
// ─────────────────────────────────────────────────────────────

export interface FocusGap {
  taskId: string;
  title: string;
  /**
   * **声明的重要性**：0–4。用户自己说的（优先级 / 重要标记 / 逾期）。
   * 这是"嘴上说的"。
   */
  declared: number;
  /** **实际注意力**：专注分钟。这是"实际做的"。 */
  focusMinutes: number;
  /**
   * 落差分：声明越高、注意力越少，分越大。`> 0` 才算落差。
   * 现在还没用的最小注意力阈值。
   */
  gap: number;
  overdueDays: number | null;
  postponements: number;
}

export interface FocusGapOptions {
  /** 声明重要性达到多少才纳入观察。默认 2（约"中优先级"）。 */
  minDeclared?: number;
  /** 专注分钟少于多少算"几乎没有投入"。默认 25（一个番茄钟）。 */
  lowAttentionMinutes?: number;
}

/**
 * 声明重要性 → 数值。
 *
 * ⚠️ 这是一个**产品判断**，不是客观量纲。它的作用是排序与过滤，
 * 不是"真实重要性"。改变它会改变谁被点名，所以它是显式参数化的。
 */
function declaredWeight(task: MemoryTask): number {
  let score = 0;
  // 优先级 0–3（实体定义里数值越大越优先）
  score += Math.min(Math.max(task.priority ?? 0, 0), 3);
  if (task.important === true) score += 1;
  if (task.dueDate !== undefined && task.completedAt === undefined) {
    // 有截止日期本身就是一种声明（未逾期的"承诺"）。
    score += 1;
  }
  return score;
}

/**
 * 算出「说的 vs 做的」落差。
 *
 * 只返回**确实存在落差**的条目，按落差从大到小排序。
 * 未完成、未删除的任务才纳入。
 */
export function computeFocusGaps(
  input: MemoryInput,
  options: FocusGapOptions = {},
): FocusGap[] {
  const minDeclared = options.minDeclared ?? 2;
  const lowAttention = options.lowAttentionMinutes ?? 25;

  const memories = new Map(computeTaskMemory(input).map((m) => [m.taskId, m]));

  const gaps: FocusGap[] = [];
  for (const task of input.tasks) {
    if (task.deletedAt !== undefined || task.completedAt !== undefined) continue;

    const declared = declaredWeight(task);
    if (declared < minDeclared) continue;

    const memory = memories.get(task.id);
    const focusMinutes = memory?.focusMinutes ?? 0;
    if (focusMinutes >= lowAttention) continue;

    // 落差 = 声明得分 − 注意力折算分（注意力封顶在"低投入"阈值上，
    // 免得一个专注很久的任务"负落差"把排序搅乱）。
    const attentionCredit = Math.min(focusMinutes, lowAttention) / lowAttention;
    const gap = declared - attentionCredit;

    gaps.push({
      taskId: task.id,
      title: task.title,
      declared,
      focusMinutes,
      gap,
      overdueDays: memory?.overdueDays ?? null,
      postponements: memory?.postponements ?? 0,
    });
  }

  // 落差降序；平局用 taskId 保证确定性（不要依赖 sort 的稳定性契约）。
  return gaps.sort((a, b) =>
    b.gap !== a.gap ? b.gap - a.gap : a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0,
  );
}

/**
 * 把落差**事实**写成一句人话。
 *
 * 🔴 **这里刻意不调用模型。**
 *
 * 这是"事实用规则算，人话让模型说"里的**前半句**：句子骨架由确定性模板给出，
 * 因此它**离线可用、可单测、零隐私成本**。模型（当用户配置了）可以在它之上
 * 做润色或改写 —— 那是**增强**，不是**前提**。
 *
 * 这条设计的直接好处：没有配置任何 AI 端点时，这个功能**依然有输出**。
 * 少了它，"AI 未配置"就退化成"整个功能是灰的"。
 *
 * ⚠️ **返回的是中文投影，壳不得直接渲染**：用 `FocusGap` 的**结构化字段** +
 * 本地化词条自己拼句子。直接把这句话塞进界面，英文界面就会露出中文
 * （同 `PreferenceEvidence` / `WithheldPreference.detail` 已经踩过两次的坑）。
 * 它保留在这里是因为它是**领域层的确定性模板**（导出/通知等非 UI 场景可用），
 * 不是"界面文案源"。
 */
export function describeFocusGaps(gaps: readonly FocusGap[]): string {
  if (gaps.length === 0) return '没有发现明显的落差 —— 你在重要的事上花了时间。';

  const top = gaps[0] as FocusGap;
  const parts: string[] = [];

  parts.push(
    `你有 ${gaps.length} 件标为重要的事，但几乎没有投入时间。最明显的是「${top.title}」`,
  );

  const reasons: string[] = [];
  if (top.postponements > 0) reasons.push(`已经推迟过 ${top.postponements} 次`);
  if (top.overdueDays !== null) reasons.push(`已逾期 ${top.overdueDays} 天`);
  if (reasons.length > 0) parts.push(`，它${reasons.join('、')}`);
  parts.push('。');

  return parts.join('');
}
