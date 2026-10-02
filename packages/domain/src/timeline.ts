/**
 * ⚠️ **这个文件是从 `apps/web/src/features/timeline/buildTimeline.ts` 搬过来的**（2026-10-05）。
 *
 * 搬运理由是**分层**，不是整理：本文件**零 import**、全是纯函数、不含任何框架或 DOM ——
 * 也就是说它是**业务语义**，按 AGENTS.md §3.5 就该在 `packages/` 里，而不是住在
 * `apps/web` 的一个 feature 目录下。
 *
 * 它此前的位置有一个具体后果：**移动端与桌面端拿不到排程能力**，而它恰恰是
 * "时间线/甘特图"这一刀里唯一**跨端必须一致**的部分（顺序与起止算错，两端会画出
 * 不同的甘特图，而且不会让任何判据变红）。搬到这里之后，UI 那一刀（`packages/ui`）
 * 才有条件把它当成唯一的排程来源。
 *
 * ⚠️ 搬运时**一个字符都没有改**（除了本段注释）：先让它在新位置行为完全相同，
 * 再在后续的 UI 那一刀里动它 —— 两件事混在一起会让"搬错了"和"改错了"分不开。
 */
/**
 * 确定性时间线（功能 ③「自动生成甘特图」的**排程**半边）
 * ======================================================
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这个文件里**没有一行 AI，也不该有。**
 *
 * `docs/plans/ai-strategy.md` §3 的裁决写得很直白：
 *
 * > ③ 自动生成甘特图 | ❌ **纯计算**：依赖图 + 拓扑排序 | 不是 AI
 * > 给甘特图套一个模型，是最典型的"AI 当装饰"……这条线必须守住。
 *
 * `docs/reference/ai-architecture.md` §14 第 20 条把它钉成了硬规则：
 *
 * > 🔴 `AiFeature` 不得加入可视化；甘特图与倒计时**不是 AI**
 *
 * 所以时间线的**顺序与起止**完全由本文件的纯函数算出来：
 * 给定清单条目与一份「标题 → 工期」的映射，输出排好序的条目。
 *
 * AI 的正当位置**只有一处**：估工期（已有的 `'duration-estimate'`）。
 * 而那份映射是**通过参数传进来的** —— 谁来填它、要不要调模型，
 * 都不属于本文件。于是本文件**在没有 AI 的情况下可以独立测试**，
 * 这正是裁决想要的性质。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 🔴 单位是「分钟」，与 `ai-duration.ts` **同一个单位**
 *
 * 这是被实测逼出来的选择，不是随手定的。
 *
 * `@heyta/app-host` 的估时（`ai-duration.ts`）返回的是**分钟**
 * （`MIN_DURATION_MINUTES = 5` / `MAX_DURATION_MINUTES = 480`），
 * 备注里那一行也是 `预计耗时：N 分钟`。
 *
 * 如果这里按**天**排，会发生一件很安静的事：480 分钟 = 8 小时 < 1 天，
 * 于是**每一条 AI 估时都会被压成"1 天"** —— AI 这条信号被完全抹平，
 * 时间线退化成"只剩清单顺序"。那等于让 AI 估时也变成装饰，
 * 而本仓库的裁决恰恰是反对"AI 当装饰"。
 *
 * 所以内部统一用分钟：**换算在链路上根本不需要发生**。
 * 选项名 `durationsInMinutes` 自带单位，是为了让"这是分钟"这件事
 * 在类型层面就不可能被忘掉（不带单位的映射，一定会有人塞错东西）。
 *
 * ## 🔴 工期缺失：确定性 + 如实标注，不编一个像模像样的数
 *
 * 模型没估、用户也没填时，工期是**未知**的。这里只有两条路：
 * 要么拒绝排（把不确定性丢给用户），要么按一个**写明的默认值**排。
 *
 * 选后者，但有一个硬条件：**必须能看出来它是默认值**。
 * 所以每个条目都带 `durationSource`，`GanttChart` 会把 `'default'`
 * 显示成「未估时（按 1 小时排）」而不是「1 小时」。
 *
 * 默认值取 **60 分钟（1 小时）** 而不是 1 天：8 小时与 24 小时的差距
 * 会让未估时的条目在图上夸张到失真，反而看不出计划真正卡在哪。
 *
 * ⚠️ **绝不偷偷编一个"看起来合理"的工期**（比如按标题长度猜）。
 * 那种数字既不是用户的、也不是模型给的，却会以事实的样子出现在甘特图上 ——
 * 用户没法分辨，也就没法纠正。
 *
 * ## 🔴 环依赖：先丢边，再兜底，绝不空转
 *
 * 依赖图来自用户的输入，而用户（和任何上游）都可能给出 A→B→A。
 * 拓扑排序遇到环会**空转或栈溢出**，甘特图布局则会死循环。
 *
 * 两道防线：
 *   1. 构造前驱边时，**丢掉会成环的那一条**（并计数，界面如实说）；
 *   2. 拓扑排序里即便一个就绪节点都没有也**按原顺序补齐**，不 while(true)。
 *
 * ## 🔴 纯函数
 *
 * 不读时钟、不读环境、不联网、不碰 store。同样的输入必须产生**同样的输出**
 * （有测试逐字节比对），否则甘特图每次渲染都会跳。
 */

/** 工期缺失时使用的默认时长（分钟）。**刻意是"明确的 1 小时"**，见文件头。 */
export const DEFAULT_DURATION_MINUTES = 60;

/** 单条工期的下限（分钟）。与 `ai-duration.ts` 对齐：5 分钟以下没有排程意义。 */
export const MIN_DURATION_MINUTES = 5;

/** 单条工期的上限（分钟）。与 `ai-duration.ts` 的 `MAX_DURATION_MINUTES` 对齐（8 小时）。 */
export const MAX_DURATION_MINUTES = 480;

/** 一次最多排多少条。超出截断并如实标记 —— 与 AI 侧的封顶同一个理由。 */
export const MAX_TIMELINE_ENTRIES = 100;

/** 单个条目名的最大长度。超出截断。 */
export const MAX_TITLE_LENGTH = 200;

/**
 * 一条清单条目。
 *
 * ⚠️ 它**不是**持久化模型 —— `Task` 没有 `parentId`，也没有 `duration`。
 * 条目来自备注里的 Markdown 清单（`parseChecklistFromNote`），
 * 或者由调用方在内存里构造。**本功能不新增任何持久化字段**
 * （见 `docs/plans/ai-capability-branches.md` §5.1）。
 */
export interface ChecklistItem {
  /** 条目名。同一个计划内**必须唯一** —— 依赖就是按它引用的。 */
  title: string;
  /**
   * 显式前置条目的 `title`。
   *
   * 缺省 = 没有显式依赖。**全部条目都没有显式依赖时，清单顺序即先后顺序**
   * （见 `buildTimeline` 的模式说明）。
   */
  dependsOn?: string;
  /** 已完成的条目不参与排期（做完了的事不需要再排时间）。 */
  done?: boolean;
}

/** 排好的一条：起止都用**相对计划起始时刻的分钟数**表示。 */
export interface TimelineEntry {
  title: string;
  /** 起始偏移（分钟），从计划第 0 分钟算起。**整数，>= 0**。 */
  startOffsetMinutes: number;
  /** 占用时长（分钟）。**整数，且已夹到 [MIN, MAX]**。 */
  durationMinutes: number;
  /** 真正被采纳的前置条目（不存在的/自引用的/成环的**已被丢弃**）。 */
  dependsOn?: string;
  /**
   * 这个工期是**哪来的**。
   *
   * 🔴 界面必须据此区分三种情况 —— 否则用户会把默认值当成真实估计：
   *
   *   - `'ai'`      → 来自 AI 估时（`readDurationFromNote` 读回的那一行），界面说「AI 估时」
   *   - `'manual'`  → 调用方直接给的（用户手填 / 测试桩），界面说「约 N 分钟」
   *   - `'default'` → 谁都没给，按默认值排，界面**必须**说「未估时（按 1 小时排）」
   */
  durationSource: 'ai' | 'manual' | 'default';
}

/** 一份排好的计划。 */
export interface TimelinePlan {
  entries: readonly TimelineEntry[];
  /** 计划总时长（分钟）：最后一条的结束偏移。空计划为 0。 */
  totalMinutes: number;
  /** 退回默认工期的条数（界面要如实说）。 */
  unestimatedCount: number;
  /** 因为指向不存在 / 自引用 / 成环而被丢弃的依赖条数。 */
  droppedDependencyCount: number;
  /** 是否因为 `MAX_TIMELINE_ENTRIES` 被截断。 */
  truncated: boolean;
}

/**
 * **一条任务**在时间线里的位置（`timeline` 整刀第 1 步）。
 *
 * 🔴 为什么它定义在**领域层**、而不是共享 UI 或某个宿主里：
 * 它是 `planTimelineBlocks()`（app-host）的**返回值**，也是共享
 * `TimelineView`（`packages/ui`）的**入参** —— 两端都依赖 `@heyta/domain`，
 * 而 `packages/ui` 与 `packages/app-host` **互不依赖**。
 * 定义在任何一侧都会逼另一侧抄一份结构类型，而两份类型必然漂移。
 *
 * ⚠️ 只有数据，没有行为：**怎么算出来**在 app-host，**怎么画**在 ui。
 */
export interface TimelineBlock {
  readonly taskId: string;
  readonly title: string;
  /** 这个任务排好的计划（可能只有一条 —— 没有清单时整条任务自己算一条）。 */
  readonly plan: TimelinePlan;
  /**
   * 备注里 AI 估的分钟数（原样，**未夹到上下限**）。
   * `undefined` = 没估过；`0` 是"估了 0 分钟" —— 两者不是一回事。
   */
  readonly aiMinutes: number | undefined;
  /** 备注里有没有可排期的清单条目。 */
  readonly hasChecklist: boolean;
  /** 参与排程的单元数（没有清单时是 1）。 */
  readonly unitCount: number;
  /**
   * 整条任务的估时**无法分摊**到多个子条目。
   *
   * 界面据此如实说明"这个估时是整条的，没有摊到子条目上"，
   * 而不是按比例编一个用户没给过的工期。
   */
  readonly unattributable: boolean;
}

/**
 * 🔴 `sharedTimelineSpan` 已删除（2026-10-01 重画）：它是旧「每任务一张图」形态的
 * 共尺补丁，且**名字比实现大**（只共了长度单位、没共坐标原点 —— R4 §5.1 的判定）。
 * 新板（`TimelineBoard`）用一根共轴 + 全视图窗口（`boardWindow`）取代了这个问题本身。
 */

/**
 * 「标题 → 工期」的映射。**单位是分钟**（见 `BuildTimelineOptions.durationsInMinutes`）。
 *
 * 两种形状都收：`Map` 适合任意标题，普通对象适合从 JSON / store 直接拿来。
 * **它由调用方填**（AI 估时、用户手填、或测试桩）—— 本文件不关心来源。
 *
 * 🔴 与 `ai-duration.ts` 同单位，所以接线时**不需要任何换算**：
 * `readDurationFromNote(note)` 拿到的分钟数可以直接放进来。
 */
export type TimelineDurations = ReadonlyMap<string, number> | Readonly<Record<string, number>>;

export interface BuildTimelineOptions {
  /**
   * 标题 → 工期，**单位：分钟**。
   *
   * 缺失或非法时退回默认工期。与 `@heyta/app-host` 的估时同单位，
   * 所以从 AI 估时接线时**直接传即可，不要乘 1440 也不要除 480**。
   */
  durationsInMinutes?: TimelineDurations;
  /**
   * 这份映射是**谁给的**，会原样落到每条 `TimelineEntry.durationSource`。
   *
   * - `'ai'`（时间线视图走的就是这条）→ 界面能说出「AI 估时」
   * - `'manual'`（默认）→ 调用方自己给的数，界面不说成 AI
   *
   * 🔴 默认 `'manual'` 而不是 `'ai'`：**参数默认值指向更保守的一侧** ——
   * 把来源不明的数字说成"AI 估的"是一种虚构，反过来只是少说一句话。
   */
  durationOrigin?: 'ai' | 'manual';
  /** 覆盖默认工期（**分钟**）。非法值忽略（退回 `DEFAULT_DURATION_MINUTES`）。 */
  defaultDurationMinutes?: number;
}

// ─────────────────────────────────────────────────────────────────────────
// 从备注里读清单
// ─────────────────────────────────────────────────────────────────────────

/**
 * Markdown 复选框行：`- [ ] 甲` / `* [x] 乙`。
 *
 * ⚠️ 不用 lookbehind（Hermes 上高风险，见 AGENTS.md）。也不认 `\p{...}`。
 *
 * 🔴 勾选标记**单独捕获**（第 1 组），不要在整行上再 `test` 一次 `[x]` ——
 * 那会把标题里带 `[x]` 的条目（`- [ ] 修 [x] 解析`）误判成已完成。
 */
const CHECKBOX_LINE = /^\s*[-*]\s+\[( |x|X)\]\s*(.*)$/;

/** 普通列表行：`- 甲`（没有复选框也收，用户的备注不一定规范）。 */
const BULLET_LINE = /^\s*[-*]\s+(.*)$/;

/**
 * 行尾的**显式依赖**标记：`全量发布（依赖：灰度）`。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这是**当前阶段的过渡语法，不是最终交互。**
 *
 * 之所以现在就得有一个：依赖是"确定性排程"的核心 —— 没有它，时间线
 * 永远退化成一条串行链，看不出并行；而我们已经决定**不新增持久化字段**
 * （`Task` 没有 `parentId`/`dependsOn`，见 `ai-capability-branches.md` §5.1）。
 * "从备注里读一个约定的标记"因此是当前唯一不碰 schema 的表达方式。
 *
 * ⚠️ 等产品定了"依赖到底怎么让用户表达"（拖拽连线 / 选择器 / AI 提议），
 * **这个正则应当被替换掉，而不是继续长大。** 它只读不写、只在这一处，
 * 去掉它不影响其余任何功能 —— 这三条是它现在足够安全的理由。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ **用户写错了会怎样：认不出的标记 = 没有依赖，且不报错。**
 * 备注是用户的自由文本，不是表单。`（依赖 灰度）`（漏了冒号）不会被识别，
 * 于是整段留在标题里；`（依赖：不存在的条目）` 指向一个不存在的标题，
 * 会在 `buildTimeline` 里被当作"依赖不存在"丢掉并计入 `droppedDependencyCount`。
 * 两种情况都**不抛错** —— 永远不要因为一行备注没读懂就让整个视图失败。
 */
const DEPENDENCY_MARKER = /[（(]\s*依赖\s*[：:]\s*([^）)]+?)\s*[）)]\s*$/;

/** 去掉行内 markdown 强调与代码标记，并裁掉行尾空白。 */
function cleanItemText(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/[`~]/g, '')
    .replace(/\s+$/, '')
    .trim();
}

/** 收窄一个标题：非字符串 / 空白 → `undefined`；超长截断。 */
function narrowTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  return trimmed.length > MAX_TITLE_LENGTH ? trimmed.slice(0, MAX_TITLE_LENGTH).trim() : trimmed;
}

/**
 * 把任务备注解析成清单条目。
 *
 * 规则：
 * - 只认**列表行**（`- [ ]` / `- [x]` / `-`）。散文、标题、空行一律跳过 ——
 *   备注里通常还有用户自己写的段落，那些**不是**待排的条目。
 * - `[x]` 的行收进来但标 `done`，由 `buildTimeline` 跳过（这里不丢，
 *   是为了让"哪条已完成"这件事在调用方仍然可见）。
 * - 同名条目**只保留第一条**：依赖是按标题引用的，重名会让引用有歧义。
 * - 数量封顶 `MAX_TIMELINE_ENTRIES`。
 * - 行尾认不出的依赖标记**不报错**，只是没有依赖（见 `DEPENDENCY_MARKER`）。
 */
export function parseChecklistFromNote(note: string | undefined): ChecklistItem[] {
  if (note === undefined || note.trim() === '') return [];

  const items: ChecklistItem[] = [];
  const seen = new Set<string>();

  for (const line of note.split('\n')) {
    const checkbox = CHECKBOX_LINE.exec(line);
    const bullet = checkbox === null ? BULLET_LINE.exec(line) : null;
    if (checkbox === null && bullet === null) continue;

    // `done` 只能从复选框的勾选标记读出来；普通列表行没有这个信息。
    const done = checkbox !== null && checkbox[1] !== ' ';
    const body = cleanItemText((checkbox?.[2] ?? bullet?.[1] ?? '').trim());

    // 依赖标记在**行尾**；取出来之后标题里不该再留着它。
    const depMatch = DEPENDENCY_MARKER.exec(body);
    const dependsOn = depMatch === null ? undefined : narrowTitle(depMatch[1]);
    const title = narrowTitle(depMatch === null ? body : body.slice(0, depMatch.index));

    if (title === undefined) continue;
    if (seen.has(title)) continue;
    if (items.length >= MAX_TIMELINE_ENTRIES) break;

    seen.add(title);
    items.push({
      title,
      ...(dependsOn === undefined ? {} : { dependsOn }),
      ...(done ? { done: true } : {}),
    });
  }

  return items;
}

// ─────────────────────────────────────────────────────────────────────────
// 排程
// ─────────────────────────────────────────────────────────────────────────

/** 取一条工期。非法值（NaN / Infinity / <= 0 / 非数字）一律当"没有"。 */
function lookupDuration(
  durationsInMinutes: TimelineDurations | undefined,
  title: string,
): number | undefined {
  if (durationsInMinutes === undefined) return undefined;
  // 鸭子类型：`Map` 有 `get`，普通对象没有。两种形状都要支持。
  const asMap = durationsInMinutes as ReadonlyMap<string, number>;
  if (typeof asMap.get === 'function') return asMap.get(title);
  return (durationsInMinutes as Readonly<Record<string, number>>)[title];
}

/** 夹到 [MIN, MAX] 的整数分钟。 */
function clampDuration(minutes: number): number {
  return Math.min(MAX_DURATION_MINUTES, Math.max(MIN_DURATION_MINUTES, Math.round(minutes)));
}

/**
 * 解析一条条目的工期：能用就用，不能用就退回默认值并**标记来源**。
 *
 * 🔴 判据是 `raw >= 0`，**不是 `raw > 0`** —— `0` 是"估了 0 分钟"，
 * 与"没估过"（`undefined`）是两件事（见 `duration-note.ts` 的同名注释）。
 * 0 会被 `clampDuration` 夹到下限（0 分钟的条在图上没有宽度），
 * 但它**仍然是"估过"的**，界面不会把它说成「未估时」。
 *
 * 负数是模型/上游搞错了语义 → 一律当"没有"（fail closed），不夹住。
 */
function resolveDuration(
  title: string,
  durationsInMinutes: TimelineDurations | undefined,
  defaultMinutes: number,
  origin: 'ai' | 'manual',
): { minutes: number; source: 'ai' | 'manual' | 'default' } {
  const raw = lookupDuration(durationsInMinutes, title);
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return { minutes: clampDuration(raw), source: origin };
  }
  return { minutes: defaultMinutes, source: 'default' };
}

/**
 * `from` 是否已经**（传递地）依赖** `target`。
 *
 * 加边 `target → from` 之前用它判环：若 `from` 已经依赖 `target`，
 * 这条边会让两者成环，必须丢掉。
 *
 * ⚠️ `visited` 不只是优化 —— 它保证**即便图里已经有环也一定终止**。
 * 判环的函数自己死循环，是最讽刺也最难查的一种。
 */
function dependsTransitivelyOn(
  predecessor: readonly (number | undefined)[],
  from: number,
  target: number,
): boolean {
  let current: number | undefined = from;
  const visited = new Set<number>();
  while (current !== undefined) {
    if (current === target) return true;
    if (visited.has(current)) return false;
    visited.add(current);
    current = predecessor[current];
  }
  return false;
}

/**
 * 稳定拓扑排序：每一步都取**原下标最小**的就绪节点。
 *
 * 稳定性不是装饰：同样的输入必须给出同样的顺序，否则甘特图每渲染一次
 * 行序就可能变，用户会以为计划被改了。
 *
 * 🔴 每条最多一个前驱，所以入度只有 0/1，实现用最朴素的选点即可（n ≤ 100）。
 *
 * 🔴 兜底：若某一步**没有任何就绪节点**（理论上被防环挡住了，不该发生），
 * 直接把剩余节点按原顺序补齐 —— **绝不 `while (true)` 空转**。
 */
function topologicalOrder(
  predecessor: readonly (number | undefined)[],
  count: number,
): number[] {
  const emitted = new Array<boolean>(count).fill(false);
  const order: number[] = [];

  for (let step = 0; step < count; step += 1) {
    let pick = -1;
    for (let i = 0; i < count; i += 1) {
      if (emitted[i] === true) continue;
      if (predecessor[i] !== undefined && emitted[predecessor[i] as number] !== true) continue;
      pick = i;
      break;
    }

    if (pick === -1) {
      for (let i = 0; i < count; i += 1) {
        if (emitted[i] !== true) {
          order.push(i);
          emitted[i] = true;
        }
      }
      break;
    }

    order.push(pick);
    emitted[pick] = true;
  }

  return order;
}

/**
 * 把清单条目排成一条时间线。
 *
 * ## 两种模式（这是本文件最需要说清楚的一件事）
 *
 * - **没有任何有效的显式依赖** → **清单顺序即先后顺序**：第 i 条排在第 i-1 条
 *   结束之后。清单是"一步一步做"的东西，串行是它最自然的读法。
 * - **存在至少一条有效的显式依赖** → 只认显式依赖：没有前置的条目**从第 0 分钟
 *   开始**（并行），有前置的排在它结束之后。
 *
 * ⚠️ 这是一个**刻意的模式开关**，不是"混着来"。混着来会产生"为什么这两条并行、
 * 那两条串行"的不可解释结果 —— 而不可解释的排期用户没法纠正。
 */
export function buildTimeline(
  items: readonly ChecklistItem[],
  options: BuildTimelineOptions = {},
): TimelinePlan {
  const defaultDuration = ((): number => {
    const raw = options.defaultDurationMinutes;
    return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
      ? clampDuration(raw)
      : DEFAULT_DURATION_MINUTES;
  })();

  // ── ① 收窄条目：跳过已完成、去重、封顶 ──────────────────────────────
  const kept: { title: string; dependsOn: string | undefined }[] = [];
  const indexByTitle = new Map<string, number>();
  let truncated = false;

  for (const item of items) {
    if (item.done === true) continue;
    const title = narrowTitle(item.title);
    if (title === undefined) continue;
    if (indexByTitle.has(title)) continue;
    if (kept.length >= MAX_TIMELINE_ENTRIES) {
      truncated = true;
      break;
    }
    indexByTitle.set(title, kept.length);
    kept.push({ title, dependsOn: narrowTitle(item.dependsOn) });
  }

  if (kept.length === 0) {
    return {
      entries: [],
      totalMinutes: 0,
      unestimatedCount: 0,
      droppedDependencyCount: 0,
      truncated,
    };
  }

  // ── ② 收窄依赖：不存在 / 自引用 → 丢弃并计数 ────────────────────────
  const candidate: (number | undefined)[] = kept.map(() => undefined);
  let droppedDependencyCount = 0;

  for (let i = 0; i < kept.length; i += 1) {
    const dep = kept[i]?.dependsOn;
    if (dep === undefined) continue;
    if (dep === kept[i]?.title) {
      droppedDependencyCount += 1;
      continue;
    }
    const j = indexByTitle.get(dep);
    if (j === undefined) {
      droppedDependencyCount += 1;
      continue;
    }
    candidate[i] = j;
  }

  // ── ③ 定前驱：显式模式（防环）或清单顺序模式 ────────────────────────
  const predecessor: (number | undefined)[] = kept.map(() => undefined);
  const hasExplicit = candidate.some((value) => value !== undefined);

  if (hasExplicit) {
    for (let i = 0; i < kept.length; i += 1) {
      const j = candidate[i];
      if (j === undefined) continue;
      // 加 `i → j` 之前先看 j 是否已经（传递地）依赖 i；是则这条边成环，丢掉。
      if (dependsTransitivelyOn(predecessor, j, i)) {
        droppedDependencyCount += 1;
        continue;
      }
      predecessor[i] = j;
    }
  } else {
    for (let i = 1; i < kept.length; i += 1) predecessor[i] = i - 1;
  }

  // ── ④ 拓扑序 → 逐个排时间 ──────────────────────────────────────────
  const order = topologicalOrder(predecessor, kept.length);

  const start = new Array<number>(kept.length).fill(0);
  const duration = new Array<number>(kept.length).fill(defaultDuration);
  const source = new Array<'ai' | 'manual' | 'default'>(kept.length).fill('default');
  let unestimatedCount = 0;

  for (const i of order) {
    const resolved = resolveDuration(
      kept[i]?.title ?? '',
      options.durationsInMinutes,
      defaultDuration,
      options.durationOrigin ?? 'manual',
    );
    duration[i] = resolved.minutes;
    source[i] = resolved.source;
    if (resolved.source === 'default') unestimatedCount += 1;

    const j = predecessor[i];
    start[i] = j === undefined ? 0 : (start[j] ?? 0) + (duration[j] ?? 0);
  }

  const entries: TimelineEntry[] = order.map((i) => {
    const j = predecessor[i];
    return {
      title: kept[i]?.title ?? '',
      startOffsetMinutes: start[i] ?? 0,
      durationMinutes: duration[i] ?? defaultDuration,
      ...(j === undefined ? {} : { dependsOn: kept[j]?.title }),
      durationSource: source[i] ?? 'default',
    };
  });

  let totalMinutes = 0;
  for (const entry of entries) {
    totalMinutes = Math.max(totalMinutes, entry.startOffsetMinutes + entry.durationMinutes);
  }

  return { entries, totalMinutes, unestimatedCount, droppedDependencyCount, truncated };
}

/**
 * 一步到位：任务备注 → 时间线。
 *
 * 就是 `parseChecklistFromNote` + `buildTimeline`，存在的理由是
 * **让"从备注到甘特图"这条路径只有一个入口**，避免每个调用点各拼一次。
 */
export function buildTimelineFromNote(
  note: string | undefined,
  options: BuildTimelineOptions = {},
): TimelinePlan {
  return buildTimeline(parseChecklistFromNote(note), options);
}
