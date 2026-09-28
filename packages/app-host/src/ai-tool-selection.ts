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
    args: () => ({}),
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
