/**
 * AI 工具执行（单步）
 * ====================
 *
 * 把 `ai-tool-selection.ts` 选出来的工具**执行一步**。它是"AI 调工具"这条链的
 * 最后一环，也是最需要写清边界的一环。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴🔴 全案最重要的一条：**写工具在这里永远不会被执行**
 *
 * 本文件里 `host.submit` 只出现在 `confirmAiToolProposal()` 里，
 * 而那个函数**只能由用户确认之后调用**。`runSelectedTool()` 对写工具的唯一动作是
 * 用 `toWriteIntent()` 造一个**提案**（`LocalApiWriteIntent`）然后返回 ——
 * 它和 op 之间还隔着"用户看见、改过、点确认"这三步。
 *
 * 这是 ADR-0005 §3.1 在工具层的落地：**AI 只产出建议，写入必须过
 * `dispatch()` + 用户确认。** 有人要在这里加一行"顺手 submit 一下"，
 * 那就是把"模型可以自己改用户的数据"这件事放进了产品。
 *
 * ⚠️ `ai-tool-run.spec.ts` 有一条测试**数 `submit` 被调了几次**：
 * 跑完所有只读与提案路径后必须是 **0**。不是看返回值，是数调用 ——
 * 一个"报告说没写、其实写了"的实现，只看返回值抓不到。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 🔴 两个闸，与 MCP 侧**逐条对齐**
 *
 * 工具权限只有一份（`localApi.grants`），但**两个调用方各自都要关两次**：
 *
 * | | 候选过滤（"看不看得见"） | 执行前复查（"调不调得动"） |
 * |---|---|---|
 * | MCP / 本机 API | `listMcpTools()` | `authorizeToolCall()` |
 * | **本模块** | `resolveToolSelection()` 里按 grants 过滤 | `runSelectedTool()` 里的 `isToolGranted()` |
 *
 * ⚠️ 这一行**以前写的是 `runAiTool()`，那是错的**（不是笔误，是一张会说谎的对照表）：
 * `isToolGranted()` 一直住在 `runSelectedTool()` 里，而 `runAiTool()` 只是
 * "规则选择 + 执行"的薄壳且零生产调用点。表指向一个不含该判断的函数，
 * 后果是"我以为复查在 A 里，改 A 就改了两个闸" —— 而真正承重的那扇门在 B。
 * 同一个模块里的另一张表（`ai-tool-call.ts` 头部）当时是对的，
 * 说明这不是"没人知道"，是**抄件一定会漂**。2026-10-03 删掉薄壳并把表改对。
 *
 * 两次不是冗余：候选可能在**选择之后、执行之前**被用户撤销授权，
 * 而这里是进程内调用、没有会话可依赖。只有一条规则：**fail-closed**。
 *
 * ## 🔴 与 MCP 侧共用同一份执行语义
 *
 * 读写两条路都直接调 `@heyta/local-api` 的导出件（`runReadTool` /
 * `toWriteIntent`），**不在这里重新实现投影、参数校验或字段映射**。
 * 于是"同一个工具在两个入口有两种行为"这件事不可能发生 ——
 * 受保护条目的投影、`get_task` 找不到时的返回形状，两边逐字相同。
 */

import {
  findTool,
  isToolGranted,
  runReadTool,
  toWriteIntent,
  type LocalApiConfig,
  type LocalApiHost,
  type LocalApiWriteIntent,
  type LocalApiWriteResult,
} from '@heyta/local-api';

import {
  type ToolArgs,
  type ToolCandidate,
  type ToolSelection,
  type ToolSelectionNoneReason,
  type ToolSelectionRule,
} from './ai-tool-selection.js';

/**
 * 一条**待确认的**写入提案。
 *
 * 🔴 它**不是 op**，也变不成 op：`intent` 是封闭的三种动作，
 * 交给 op-log 解释的唯一地方是 `@heyta/app-host` 的 `local-api-host`。
 * 界面拿它渲染"将要发生什么"，用户确认后才 `confirmAiToolProposal()`。
 */
export interface AiToolProposal {
  ruleId: string;
  tool: string;
  /** 人话摘要所需的结构化字段。措辞由壳按词条渲染，本层不拼中文句子。 */
  intent: LocalApiWriteIntent;
}

export type AiToolRunOutcome =
  /** 只读工具执行成功。`data` 已按 Bear 范式投影过。 */
  | { kind: 'observation'; ruleId: string; tool: string; data: unknown }
  /** 写工具**只产出提案**，没有落库。 */
  | { kind: 'proposal'; proposal: AiToolProposal }
  | { kind: 'ambiguous'; candidates: readonly ToolCandidate[] }
  | { kind: 'none'; reason: ToolSelectionNoneReason }
  /** 用户没授权这个工具。**执行前复查**抓到的。 */
  | { kind: 'denied'; tool: string; message: string }
  | { kind: 'failed'; tool: string; reason: 'unknown-tool' | 'invalid-args' | 'not-readable'; message: string };

export interface AiToolRunnerDeps {
  /** 工具宿主。复用 `createLocalApiHost()`（壳侧），这里是进程内端口。 */
  readonly host: LocalApiHost;
  /** 已授权的工具范围。**就是 AI 设置里那份 `localApi.grants`**。 */
  readonly grants: LocalApiConfig['grants'];
  /** 规则集。默认只读（见 `ai-tool-selection.ts`）。 */
  readonly rules?: readonly ToolSelectionRule[];
  /** 时间源。默认 `Date.now`。 */
  readonly now?: () => number;
}

/**
 * 执行一个**已经选好的**工具。
 *
 * 🔴 单独导出有两个理由，都不是洁癖：
 *
 * 1. **P2 的模型路径会直接产出选择结果**（模型给出 `tool` + `args`），
 *    而不是走规则 —— 那时它调的就是本函数，不必伪造一句自然语言去骗规则。
 *    （已经落地：`ai-tool-call.ts` 的模型分支就是这么调的。）
 * 2. 它让"选择"与"执行"可以**分别**被测试：`no-match` / `ambiguous`
 *    是选择的问题，`not-readable` / `invalid-args` 是执行的问题。
 *
 * ⚠️ 它接受的正是 `resolveToolSelection()` 的返回 —— 调用方**不该**手搓一个
 * 选择结果绕过规则的目录过滤。P2 的模型路径必须先过一个"工具在不在目录里 +
 * 有没有授权"的校验，那个校验函数与 `resolveToolSelection` 共用（见 P2 计划）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这里**故意没有**"text → 执行一步"的便利前门。
 *
 * 原来有一个 `runAiTool()`（六行：`resolveToolSelection` 再转调本函数）。
 * 它**零生产调用点** —— 界面走 `requestToolCall`（模型前门）与
 * `resolveToolSelection`（规则前门）那两条，而 `requestToolCall` 的规则分支
 * **本来就做着同一件事**。于是产品里有两个名字指向同一条组合，
 * 测试却只认那个没人用的 —— 这是 AGENTS §3.5 那条教训的形状：
 * **"抽出了共享实现"不等于"重复被消除了"，收尾动作是删掉旧的那份。**
 * 2026-10-03 删除（工单 W7），8 处测试调用改成本地组合，断言一条没动。
 * ⚠️ 不要再加回来：需要"text → 执行"就调 `requestToolCall`，它是唯一的前门。
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function runSelectedTool(
  selection: ToolSelection,
  deps: AiToolRunnerDeps,
): Promise<AiToolRunOutcome> {
  switch (selection.kind) {
    case 'none':
      return { kind: 'none', reason: selection.reason };
    case 'ambiguous':
      return { kind: 'ambiguous', candidates: selection.candidates };
    case 'tool':
      break;
  }

  const { ruleId, tool, args } = selection;

  const spec = findTool(tool);
  // `resolveToolSelection` 已经按目录过滤过，正常到不了这里；
  // 但 `runSelectedTool` 是导出的，直接调用方可能传入目录外的工具 → 不猜，明确失败。
  if (spec === undefined) {
    return { kind: 'failed', tool, reason: 'unknown-tool', message: `没有名为「${tool}」的工具。` };
  }

  // 🔴 执行前复查：选择到执行之间用户可能撤销了授权。
  if (!isToolGranted(deps.grants, tool)) {
    return {
      kind: 'denied',
      tool,
      message: `工具「${tool}」没有被授权。本机工具默认全部关闭，需要在设置里逐个打开。`,
    };
  }

  if (spec.kind === 'read') {
    const read = await runReadTool(deps.host, tool, args);
    if (!read.ok) {
      // `not-a-read-tool` 在 `kind === 'read'` 分支里不可能出现 → 归到 invalid-args。
      const reason = read.kind === 'not-readable' ? 'not-readable' : 'invalid-args';
      return { kind: 'failed', tool, reason, message: read.message };
    }
    return { kind: 'observation', ruleId, tool, data: read.payload };
  }

  const write = toWriteIntent(tool, args);
  if (!write.ok) {
    return { kind: 'failed', tool, reason: 'invalid-args', message: write.message };
  }
  return { kind: 'proposal', proposal: { ruleId, tool, intent: write.intent } };
}

/**
 * 用户确认之后，才把提案落地。
 *
 * 🔴 这是本模块**唯一**调用 `host.submit` 的地方，也是"AI 不能自己改数据"
 * 这条约束的执行点。它必须是**显式的一步**，不能藏在执行函数里。
 * ⚠️ `check:ai-tools` 静态钉住"`RUN_FILE` 里 `.submit(` 恰好 1 次且在本函数内"，
 * 所以这里不是靠注释守着的。
 */
export async function confirmAiToolProposal(
  host: LocalApiHost,
  proposal: AiToolProposal,
): Promise<LocalApiWriteResult> {
  return host.submit(proposal.intent);
}

/** 类型再导出，省得调用方两处 import。 */
export type { ToolArgs, ToolCandidate, ToolSelectionNoneReason, ToolSelectionRule };
