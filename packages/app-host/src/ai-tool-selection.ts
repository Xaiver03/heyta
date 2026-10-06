/**
 * AI 工具选择（自然语言 → 工具）
 * ================================
 *
 * 回答一个问题：**用户这句话，该调哪个工具？**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 它不是"第三个 intent"
 *
 * 本仓库已经有两个叫 intent 的东西，各自含义明确：
 *
 * | 名字 | 是什么 | 在哪 |
 * |---|---|---|
 * | `OpIntent` | **要写进 op-log 的意图**（op 的构造输入） | `@heyta/op-log` |
 * | `WidgetIntent` | 小组件点击产生的**待落地意图**（纯数据队列） | `@heyta/widget-core` |
 *
 * 本模块产出的是**第三个阶段之前**的东西：连"要不要动数据"都还没定，
 * 只是"该用哪把工具"。所以它叫 `ToolSelection`，**不叫 intent** ——
 * 三个 intent 只会让下一个读代码的人分不清哪个能落库。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 🔴 为什么是纯规则，不是模型
 *
 * 与 `capture.ts` 同一个道理，而且这里的理由更硬：
 *
 * 1. **零出境**：规则路由不发任何数据出去。模型路由每次都要过出境闸门，
 *    而"用户想干什么"这句话往往就是任务内容本身。
 * 2. **可测且可复现**：规则命中就是命中，不会随模型版本漂移。
 * 3. **模型该留给它擅长的**：把"这句话里提到的是哪条已有任务"这类
 *    需要语义理解的交给模型（P2）；"是查任务还是建任务"用规则就够。
 *
 * ⚠️ 因此本文件**不做**这两件事，它们是 P2 的模型路径：
 * - 需要**已有实体 id** 的工具（`get_task` / `update_task` / `complete_task`）：
 *   自然语言给的是标题不是 id，单步规则填不出来。
 * - 从自由文本里抽**任务标题**（`create_task`）：那是 `capture.ts` 的工作，
 *   而它已经在别的路径上做了（见 `ai-capture.ts`）。本模块的默认规则集
 *   因此**只读**，与"先只读"的落地顺序一致。
 *
 * ## 🔴 未授权的工具不进入候选
 *
 * 与 `listMcpTools()` 同一条立场：**未授权即不可见**，不是"看得见但调不动"。
 * 所以本模块先跑规则、再按 `grants` 过滤，并在"规则命中但全都没授权"时
 * 明确区分出 `no-tool-granted` —— 那和"没听懂"是**两种不同的失败**，
 * 界面要说的话完全不同。
 */

import { today } from '@heyta/domain';
import { LOCAL_API_TOOLS, isToolGranted, type LocalApiConfig, type LocalApiTool } from '@heyta/local-api';

/** 工具参数。形状由各工具的 `INPUT_SCHEMAS` 决定，本层不解释。 */
export type ToolArgs = Readonly<Record<string, unknown>>;

/** 被规则选中的一个候选。 */
export interface ToolCandidate {
  /** 规则 id。用于诊断与测试断言，**不是**给用户看的文案。 */
  ruleId: string;
  tool: string;
}

/** 规则拿到的上下文。 */
export interface ToolSelectionContext {
  /** 今天（epoch ms）。注入而非读真实时钟：否则测试会"过几天变红"。 */
  now: number;
  /** 原始输入。规则需要回看整句时可以读它。 */
  text: string;
}

/**
 * 一条选择规则。
 *
 * 🔴 `pattern` 必须是**无状态**的：本模块每次 `new RegExp(pattern)`，
 * 不用共享的 `/g` 正则 —— 那是"第一次对、第二次错"的经典形状
 * （对照 `capture.ts` 里同样的处理）。
 */
export interface ToolSelectionRule {
  readonly id: string;
  /** 命中时调用的工具名。 */
  readonly tool: string;
  readonly pattern: RegExp;
  /**
   * 从命中结果里抽参数。
   *
   * 返回 `undefined` 表示"这条规则命中了但参数不成立"（例如缺必要片段）——
   * 该候选**被丢弃**，不是"用空参数硬调"。不猜。
   */
  readonly args?: (match: RegExpExecArray, context: ToolSelectionContext) => ToolArgs | undefined;
}

/**
 * 默认规则集：**只读**。
 *
 * ⚠️ 刻意保持很小，且每条都写清"命中什么样的话"。宁可漏（回 `no-match` 让用户
 * 明说），不要错 —— 一个误命中的读工具会去读用户没想让它读的东西。
 */
export const DEFAULT_TOOL_SELECTION_RULES: readonly ToolSelectionRule[] = [
  {
    id: 'list.projects',
    tool: 'list_projects',
    pattern: /(有哪些|有哪几个|列出|列一下|看看|看一下|查看)[^。！？\n]{0,6}(清单|项目|列表)/,
    args: () => ({}),
  },
  {
    id: 'list.today',
    tool: 'list_tasks',
    pattern: /(今天|今日)[^。！？\n]{0,6}(要做什么|有什么|待办|任务|安排)/,
    // 🔴 这条规则**存在的理由就是带日期参数**。曾经它传的是 `{}` ——
    // 于是问"今天有什么任务"拿到的是**全量前 N 条**，与问"列出任务"逐字相同：
    // 界面全绿、答案在说谎。参数现在有了（`list_tasks` 的 `dueOn`，见 `tools.ts`），
    // 不许再退回空对象。
    //
    // ⚠️ `today` 用**注入的 `ctx.now`**，不是 `Date.now()` ——
    // 后者会让这条用例在几天之后自己变红（`ToolSelectionContext.now` 的注释就是为这个）。
    // 🔴 也不许在这里读"模型说的今天"：`packages/ai/src/index.ts` 文件头记着实测 ——
    // 模型曾把"明天"算错四个半月（ADR-0045 关联的 W4 判据）。
    args: (_match, ctx) => ({ dueOn: today(ctx.now) }),
  },
  {
    id: 'list.completed',
    tool: 'list_tasks',
    pattern: /(已完成|做完|完成了)[^。！？\n]{0,4}(哪些|的任务|多少)?/,
    args: () => ({ completed: true }),
  },
  {
    id: 'list.tasks',
    tool: 'list_tasks',
    pattern: /(列出|列一下|看看|看一下|查看|有哪些)[^。！？\n]{0,8}(任务|待办|todo)/i,
    args: () => ({}),
  },
  // ── 倒数日 / 纪念日（W10）──────────────────────────────────────────
  //
  // 🔴 这两条**必须和目录条目同批**。少了它们，`EVENT` 会处在最坏的那种状态：
  // 目录里有工具、授权界面里有开关、能力清单里也写着"读和写都有"，
  // 但**规则前门永远选不到它** —— 于是"今天有什么任务"能答，
  // "我生日还有几天"回 `no-match`，而 MCP 侧（模型自己挑工具）是好的。
  // 两个前端一个能用一个不能用，且**没有任何一层会红**（W10 标它是⚠️静默）。
  //
  // ⚠️ 仍然**只做读**：与上面四条同一落地顺序（写工具需要实体 id，规则填不出来）。
  {
    id: 'list.events',
    tool: 'list_events',
    // 「有哪些倒数日」「列一下纪念日」「最近的倒数日」「快到了哪些日子」
    pattern:
      /(有哪些|有哪几个|列出|列一下|看看|看一下|查看|最近的|快到了|快到了的|快到)[^。！？\n]{0,8}(倒数日|倒数纪念日|纪念日|倒计时|生日|anniversary|countdown)/i,
    args: () => ({}),
  },
  {
    id: 'list.events.soon',
    tool: 'list_events',
    // 「有什么日子快到了」「这阵子有纪念的吗」—— 宾语在后、没有"倒数日"这个词的那副面孔。
    pattern: /(有什么|有哪些|有没有)[^。！？\n]{0,6}(日子|纪念|倒数)[^。！？\n]{0,6}(快|最近|这阵|要到了)/,
    args: () => ({}),
  },

  // ── 六个实体列表（W11 补齐的目录；2026-10-03 合流时补的前门）────────────
  // 判据（ai-tool-selection.spec「目录驱动」）要求：不需要必填参数的读工具，
  // 每条都至少有一条规则能选中它 —— 否则那个工具在助手前门永远选不到，
  // 目录里就长出了一个"看得见、用不了"的工具。
  {
    id: 'list.habits',
    tool: 'list_habits',
    // 「我有哪些习惯」「列一下习惯」
    pattern: /(有哪些|有哪几个|列出|列一下|看看|看一下|查看)[^。！？\n]{0,6}(习惯)/,
    args: () => ({}),
  },
  {
    id: 'list.tags',
    tool: 'list_tags',
    pattern: /(有哪些|有哪几个|列出|列一下|看看|看一下|查看)[^。！？\n]{0,6}(标签)/,
    args: () => ({}),
  },
  {
    id: 'list.notes',
    tool: 'list_notes',
    pattern: /(有哪些|有哪几个|列出|列一下|看看|看一下|查看)[^。！？\n]{0,6}(便签|笔记|备忘)/,
    args: () => ({}),
  },
  {
    id: 'list.checkins',
    tool: 'list_checkins',
    // 「最近的打卡记录」「这周打卡了吗」
    pattern: /(最近|这周|这阵|看看|看一下|查看|列出|列一下)[^。！？\n]{0,8}(打卡|签到)/,
    args: () => ({}),
  },
  {
    id: 'list.focuses',
    tool: 'list_focuses',
    pattern: /(最近|这周|这阵|看看|看一下|查看|列出|列一下)[^。！？\n]{0,8}(专注|番茄钟)/,
    args: () => ({}),
  },
  {
    id: 'list.reminders',
    tool: 'list_reminders',
    pattern: /(有哪些|有哪几个|列出|列一下|看看|看一下|查看)[^。！？\n]{0,6}(提醒)/,
    args: () => ({}),
  },
];

/** 选择失败的原因。**分成两档是有意义的**：修复动作不同。 */
export type ToolSelectionNoneReason =
  /** 空输入。 */
  | 'empty'
  /** 规则一条都没命中 —— "没听懂这句话"。 */
  | 'no-match'
  /** 规则命中了，但命中的工具用户一个都没授权 —— "先回去开授权"。 */
  | 'no-tool-granted';

export type ToolSelection =
  | { kind: 'tool'; ruleId: string; tool: string; args: ToolArgs }
  /** 多条规则命中不同工具 → **问用户**，不挑一个。 */
  | { kind: 'ambiguous'; candidates: readonly ToolCandidate[] }
  | { kind: 'none'; reason: ToolSelectionNoneReason };

export interface ResolveToolSelectionOptions {
  /** 已授权的工具范围。**复用 `AiSettings` 里那份 `localApi.grants`**，不另发明权限。 */
  readonly grants: LocalApiConfig['grants'];
  /** 规则集。默认 {@link DEFAULT_TOOL_SELECTION_RULES}。 */
  readonly rules?: readonly ToolSelectionRule[];
  /** 时间源。默认 `Date.now`。 */
  readonly now?: () => number;
}

/**
 * 选一个工具。
 *
 * 顺序（每一步都存在理由）：
 *
 * 1. 空输入 → `empty`（不做任何匹配）
 * 2. 跑全部规则，收集命中
 * 3. 命中集合**先按工具目录过滤**（规则里写了一个不存在的工具 → 丢掉，不让它进候选）
 * 4. 再按 `grants` 过滤（未授权不可见）；若因此清零而第 2 步非空 → `no-tool-granted`
 * 5. 去重（同一工具被多条规则命中算一个候选）
 * 6. 恰好一个 → `tool`；多于一个 → `ambiguous`（**不挑**）
 */
export function resolveToolSelection(
  text: string,
  options: ResolveToolSelectionOptions,
): ToolSelection {
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'none', reason: 'empty' };

  const rules = options.rules ?? DEFAULT_TOOL_SELECTION_RULES;
  const now = options.now?.() ?? Date.now();
  const context: ToolSelectionContext = { now, text: trimmed };

  const matched: { rule: ToolSelectionRule; args: ToolArgs }[] = [];
  for (const rule of rules) {
    // 🔴 每次新建正则：共享 `/g` 正则的 `lastIndex` 会跨调用泄漏。
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    const m = re.exec(trimmed);
    if (m === null) continue;
    const args = rule.args === undefined ? {} : rule.args(m, context);
    // 参数不成立 → 丢弃这条候选，不用空参数硬调。
    if (args === undefined) continue;
    matched.push({ rule, args });
  }

  if (matched.length === 0) return { kind: 'none', reason: 'no-match' };

  // 规则里可能写了目录里没有的工具（拼错、或工具被删）—— 丢掉。
  const known = matched.filter((x) => findCatalogTool(x.rule.tool) !== undefined);
  if (known.length === 0) return { kind: 'none', reason: 'no-match' };

  const granted = known.filter((x) => isToolGranted(options.grants, x.rule.tool));
  if (granted.length === 0) return { kind: 'none', reason: 'no-tool-granted' };

  // 同一工具被多条规则命中 = 一个候选（按首次出现定序）。
  const byTool = new Map<string, { rule: ToolSelectionRule; args: ToolArgs }>();
  for (const hit of granted) {
    if (!byTool.has(hit.rule.tool)) byTool.set(hit.rule.tool, hit);
  }

  if (byTool.size > 1) {
    return {
      kind: 'ambiguous',
      candidates: [...byTool.values()].map((hit) => ({ ruleId: hit.rule.id, tool: hit.rule.tool })),
    };
  }

  const [only] = [...byTool.values()];
  // `size === 1` 保证这里非空；写出来是为了让类型收窄，不是防御性编程。
  if (only === undefined) return { kind: 'none', reason: 'no-match' };

  return { kind: 'tool', ruleId: only.rule.id, tool: only.rule.tool, args: only.args };
}

/** 在既有工具目录里找一个工具。**这是唯一的目录来源**（不变量 19）。 */
export function findCatalogTool(name: string): LocalApiTool | undefined {
  return LOCAL_API_TOOLS.find((tool) => tool.name === name);
}
