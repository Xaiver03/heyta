/**
 * AI 工具调用（模型路径，单步）
 * ================================
 *
 * 「用户这句话 → 让模型挑一个工具 → 执行一步」。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 顺序是硬的：**规则先跑，命中就不出境**
 *
 *   1. 先用 `resolveToolSelection()`（纯规则、本机、零出境）试一次；
 *   2. 只有规则给出 `no-match` / `ambiguous` 时，才把话发给模型。
 *
 * 理由不是省钱，是**隐私**：用户那句话往往就是任务内容本身，
 * 而规则能独立处理的比例不低。能在本机定下来的事，不送给任何端点。
 * 这与 `ai-capture.ts` 的"规则内核与模型路径并存、不互相兜底"是同一条立场。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 🔴 出境字段里有 `tools`
 *
 * 发给模型的除了那句话，还有**已授权工具的名字与说明**。
 * 工具名是"这台机器有什么能力"的信息（对照 `mcp.ts` 里"未授权即不可见"的立场），
 * 所以它**必须**出现在披露字段里 —— `fields` 少写一项，用户就会在不知情下多送一份数据。
 * 有测试逐字段对照 `buildToolCallInvocation()` 的 `user`/`tools` 与 `fields`。
 *
 * ## 🔴 模型说的不算数：校验与执行都复用既有件
 *
 * 模型给回来的 `tool` + `arguments` 是**不可信输入**。本文件不自己写第二套校验：
 *
 * | 关切 | 由谁负责 |
 * |---|---|
 * | 工具在不在目录里 | `runSelectedTool()` → `findTool()` |
 * | 用户授没授权 | `runSelectedTool()` → `isToolGranted()` |
 * | 参数合不合法 | `runReadTool()` / `toWriteIntent()`（**唯一的参数语义**） |
 * | 写要不要确认 | `runSelectedTool()` 只产出提案；`confirmAiToolProposal()` 才落库 |
 *
 * 本文件只多做一件既有件做不到的事：**把 `arguments` 从 JSON 字符串解析成对象**，
 * 且解析失败时**回问而不是猜**（`tool-call-malformed`）。
 *
 * ⚠️ 本文件不 import `@heyta/op-log`，也不含任何 `fetch` ——
 * 出境必须经 `@heyta/ai` 的 `invokeRouted()`（由 `check:ai-tools` 静态钉住）。
 */

import {
  invokeRouted,
  type AiFailureReason,
  type AiRoutingConfig,
  type AiRoutingPolicy,
  type AiToolDescriptor,
  type EgressConsent,
  type EgressDestination,
  type HealthMap,
  type RoutedDeps,
} from '@heyta/ai';
import { listAuthorizedTools, type LocalApiConfig, type LocalApiHost } from '@heyta/local-api';

import {
  resolveToolSelection,
  type ToolArgs,
  type ToolSelection,
  type ToolSelectionRule,
} from './ai-tool-selection.js';
import { runSelectedTool, type AiToolRunOutcome } from './ai-tool-run.js';

/** 单句输入上限。工具选择只处理短命令，长文不是它的场景。 */
export const MAX_TOOL_CALL_TEXT_LENGTH = 500;

/**
 * 这条链路**会出境**的字段。
 *
 * 🔴 `tools` 是承重的：工具名与说明会进模型上下文，
 * 少写它 = 用户授权时看不到"能力范围也会被发出去"。
 */
export const TOOL_CALL_EGRESS_FIELDS = ['text', 'tools'] as const;

/** 给模型的系统提示。刻意短、只讲边界。 */
const TOOL_CALL_SYSTEM_PROMPT = [
  '你是 heyta 任务管理器的工具选择器。',
  '根据用户这句话，从提供的工具里选**一个**最合适的调用；如果都不合适，就直接用一句话说明。',
  '不要编造工具名，不要一次调用多个工具。',
].join('\n');

export interface ToolCallSource {
  text: string;
}

/**
 * 构造调用（纯函数）。
 *
 * 🔴 `fields` 与 `user`/`tools` 必须逐项对应 —— 有测试钉住。
 */
export function buildToolCallInvocation(
  source: ToolCallSource,
  tools: readonly AiToolDescriptor[],
): {
  feature: 'tool-calling';
  system: string;
  user: string;
  fields: readonly string[];
  tools: readonly AiToolDescriptor[];
} {
  return {
    feature: 'tool-calling',
    system: TOOL_CALL_SYSTEM_PROMPT,
    user: `用户这句话：${source.text}`,
    fields: TOOL_CALL_EGRESS_FIELDS,
    tools,
  };
}

/**
 * 把 `@heyta/local-api` 的中性工具定义映射成 `@heyta/ai` 的工具描述。
 *
 * 🔴 **只映射，不筛**：筛选（"未授权即不可见"）已经在 `listAuthorizedTools()` 里做了，
 * 这里再来一遍就是第二份判据。
 */
export function toToolDescriptors(grants: LocalApiConfig['grants']): readonly AiToolDescriptor[] {
  return listAuthorizedTools(grants).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }));
}

export type ToolCallFailureReason =
  | 'empty-text'
  | 'text-too-long'
  | 'no-granted-tools'
  /** 路由层失败。具体原因在 `cause`（来自 `packages/ai`，**不要在这里重新概括**）。 */
  | 'ai-unavailable'
  /** 模型只回了话、没要求调工具。 */
  | 'model-returned-text'
  /** 单步只接受一个工具调用；模型给多了就**回问**，不挑一个。 */
  | 'multiple-tool-calls'
  /** `arguments` 不是合法 JSON 对象 —— 不猜，回问。 */
  | 'tool-call-malformed';

export type ToolCallOutcome =
  | {
      ok: true;
      /** `rule` = 规则命中，**一次网络请求都没发**；`model` = 走了端点。 */
      via: 'rule' | 'model';
      result: AiToolRunOutcome;
      /** 仅 `via: 'model'` 时有：这次调用去了哪个目的地。 */
      destination?: EgressDestination;
      /** 熔断状态，**调用方负责落盘**。规则路径为 `{}`（没碰端点）。 */
      health: HealthMap;
    }
  | {
      ok: false;
      reason: ToolCallFailureReason;
      message: string;
      /** 路由层给的具体原因码，供壳取词条。 */
      cause?: AiFailureReason;
      /** 模型只回了话时，把它带出来（界面可以照原样显示）。 */
      text?: string;
      health: HealthMap;
    };

export interface RequestToolCallDeps {
  routing: AiRoutingConfig;
  consents: readonly EgressConsent[];
  /** 已授权工具范围 —— **就是 AI 设置里那份 `localApi.grants`**。 */
  grants: LocalApiConfig['grants'];
  /** 工具宿主（进程内）。 */
  host: LocalApiHost;
  /** 规则集。默认只读（见 `ai-tool-selection.ts`）。 */
  rules?: readonly ToolSelectionRule[];
  policy?: AiRoutingPolicy;
  routed?: RoutedDeps;
  now?: () => number;
}

/**
 * 走完整条路：**规则优先 → （必要时）出境让模型选 → 严格校验 → 执行一步**。
 *
 * 失败一律返回可展示的原因，绝不抛错给 UI。
 */
export async function requestToolCall(
  source: ToolCallSource,
  deps: RequestToolCallDeps,
): Promise<ToolCallOutcome> {
  const text = source.text.trim();
  if (text === '') {
    return { ok: false, reason: 'empty-text', message: '还没有输入内容。', health: {} };
  }
  if (text.length > MAX_TOOL_CALL_TEXT_LENGTH) {
    return {
      ok: false,
      reason: 'text-too-long',
      message: `这句话太长了（${String(text.length)} 个字，上限 ${String(MAX_TOOL_CALL_TEXT_LENGTH)}）。`,
      health: {},
    };
  }

  const localDeps = {
    host: deps.host,
    grants: deps.grants,
    ...(deps.rules === undefined ? {} : { rules: deps.rules }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  };

  // ── 第一步：规则（本机、零出境）──────────────────────────────────────
  const local = resolveToolSelection(text, {
    grants: deps.grants,
    ...(deps.rules === undefined ? {} : { rules: deps.rules }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });

  if (local.kind === 'tool') {
    const result = await runSelectedTool(local, localDeps);
    return { ok: true, via: 'rule', result, health: {} };
  }

  // 规则没命中，且原因是"一个工具都没授权" → 送模型也没用（它会看到空工具集）。
  if (local.kind === 'none' && local.reason === 'no-tool-granted') {
    return {
      ok: false,
      reason: 'no-granted-tools',
      message: '还没有授权任何工具。本机工具默认全部关闭，需要在设置里逐个打开。',
      health: {},
    };
  }

  // ── 第二步：模型（出境）──────────────────────────────────────────────
  const tools = toToolDescriptors(deps.grants);
  if (tools.length === 0) {
    return {
      ok: false,
      reason: 'no-granted-tools',
      message: '还没有授权任何工具。本机工具默认全部关闭，需要在设置里逐个打开。',
      health: {},
    };
  }

  const invocation = buildToolCallInvocation({ text }, tools);
  const outcome = await invokeRouted(
    deps.routing,
    invocation,
    deps.consents,
    deps.policy,
    deps.routed ?? {},
  );

  const result = outcome.result;
  if (!result.ok) {
    // 🔴 用 `packages/ai` 给出的具体句子，不在这里重新概括（那会漂移）。
    return {
      ok: false,
      reason: 'ai-unavailable',
      cause: result.reason,
      message: result.message,
      health: outcome.health,
    };
  }

  const calls = result.suggestion.toolCalls;
  if (calls === undefined || calls.length === 0) {
    return {
      ok: false,
      reason: 'model-returned-text',
      message: '模型没有选择工具，只回了一句话。',
      text: result.suggestion.text,
      health: outcome.health,
    };
  }

  if (calls.length > 1) {
    return {
      ok: false,
      reason: 'multiple-tool-calls',
      message: `模型一次要求调用 ${String(calls.length)} 个工具，而当前只支持单步。请说得更具体一点。`,
      health: outcome.health,
    };
  }

  const call = calls[0];
  if (call === undefined) {
    return {
      ok: false,
      reason: 'model-returned-text',
      message: '模型没有选择工具。',
      health: outcome.health,
    };
  }

  const parsed = parseToolArguments(call.arguments);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: 'tool-call-malformed',
      message: `模型给的参数读不出来（${parsed.message}），请重试或手动操作。`,
      health: outcome.health,
    };
  }

  // 🔴 校验与执行都交给 `runSelectedTool()`（唯一的目录 / 授权 / 参数语义）。
  const selection: ToolSelection = {
    kind: 'tool',
    ruleId: `model:${call.name}`,
    tool: call.name,
    args: parsed.args,
  };
  const run = await runSelectedTool(selection, localDeps);

  return {
    ok: true,
    via: 'model',
    result: run,
    destination: result.suggestion.destination,
    health: outcome.health,
  };
}

/** `arguments` 解析结果。**不抛错**：坏 JSON 要变成一句可展示的回问。 */
export type ParsedToolArguments =
  | { ok: true; args: ToolArgs }
  | { ok: false; message: string };

/**
 * 把模型给的 `arguments` 字符串解析成参数对象。
 *
 * 规则（与 `ai-capture.ts` 的解析同一纪律）：
 * - 空串 → `{}`（无参工具，如 `list_projects`）
 * - 必须是 JSON **对象**；数组 / 标量 / 坏 JSON → 失败
 *
 * ⚠️ 这里**不做 schema 校验** —— 那是 `runReadTool()` / `toWriteIntent()` 的事，
 * 再来一份就是第二份参数语义。
 */
export function parseToolArguments(raw: string): ParsedToolArguments {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, args: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '不是合法 JSON',
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: '参数必须是一个对象' };
  }
  return { ok: true, args: parsed as ToolArgs };
}
