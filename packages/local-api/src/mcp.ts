/**
 * MCP 工具定义
 * ==============
 *
 * 把 `tools.ts` 的工具目录翻译成 **MCP（Model Context Protocol）能懂的形状**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这一层最容易犯的错：**把全部工具都报给 MCP 客户端**
 *
 * MCP 客户端（Claude Code / Cursor 等）会把服务端返回的工具列表
 * **整个塞进模型的上下文**，模型于是知道"有这么个工具可以调"。
 *
 * 所以如果用户只授权了 `list_tasks` 却把全部 10 个工具报过去：
 * - 模型会去调没授权的工具 → 每次都撞权限错误 → 用户以为是 bug
 * - 更糟的是，**工具的"存在"本身就是信息**：
 *   "有个 create_task 工具"告诉模型这台机器上有什么能力
 *
 * 因此 `listMcpTools` **只返回已授权的工具**。
 * 未授权的工具对 MCP 客户端**完全不可见** —— 不是"看得见但调不动"。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 与 `authorizeToolCall` 的关系
 *
 * 两者是**两道不同的关**，都要有：
 *
 * | | 时机 | 作用 |
 * |---|---|---|
 * | `listMcpTools` | 客户端握手时 | **不暴露**未授权的工具 |
 * | `authorizeToolCall` | 每次调用时 | **拒绝**未授权的调用 |
 *
 * 只有前者 → 客户端拿到旧列表后仍能调（列表会过期）
 * 只有后者 → 模型会看到一堆它永远调不动的工具
 */

import {
  authorizeToolCall,
  type LocalApiConfig,
  type LocalApiTool,
} from './tools.js';
import { LOCAL_API_TOOLS, inputSchemaForTool } from './tools/registry.js';

/** 我们按这个版本的 MCP 形状输出。 */
export const MCP_PROTOCOL_VERSION = '2025-06-18';

/** 本服务的名字，出现在 MCP 握手里。 */
export const MCP_SERVER_NAME = 'heyta';

/**
 * MCP 工具定义。
 *
 * `inputSchema` 用 JSON Schema（MCP 的规定），**在我们这边是手工写的** ——
 * 因为 `@heyta/local-api` 是零依赖包，不引 schema 生成库；
 * 而且工具数量有限，手写比引入一套生成器更清楚。
 * 写的位置是各个 `src/tools/<entity>.ts`（一个工具一处声明），本文件只做投影。
 */
export interface AuthorizedToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Readonly<Record<string, unknown>>;
    required?: readonly string[];
    additionalProperties: false;
  };
}

/**
 * MCP 形状的工具定义。
 *
 * 🔴 **它就是 `AuthorizedToolDefinition`，不是第二份。**
 * 内置 AI 的工具路径（`@heyta/app-host` 的 `ai-tool-call.ts`）用的是同一个函数
 * （`listAuthorizedTools`）—— 于是"未授权即不可见"这条立场、
 * 以及给模型看的描述，两个调用方**逐字相同**（不变量 19）。
 */
export type McpToolDefinition = AuthorizedToolDefinition;

/**
 * 每个工具的参数 schema 现在住在 `src/tools/<entity>.ts` 的 `schemas` 里
 * （一个工具一处声明）。这里只留**投影**，不再有一份按工具名手抄的清单。
 */

/**
 * 这个工具的参数 schema **有没有被登记过**。
 *
 * 🔴 存在的唯一理由是把 `listAuthorizedTools()` 那个**静默回退**变得可测：
 * 没登记的工具会拿到 `{ type:'object', properties:{}, additionalProperties:false }`，
 * 而它与"这个工具真的不接参数"（`list_projects`）在两个前端上**长得一模一样** ——
 * 于是"忘了写 schema"表现为"模型以为这个工具什么都传不了"，不报错、不崩溃。
 * 能力清单那边也只会给一个 `schemaRecorded:false` 的**标记**（清单照出，不红）。
 * ⚠️ 所以判据必须**目录驱动**：`LOCAL_API_TOOLS` 里每一条都得答"是"，
 * 新增工具时不登记就红（见 `tests/mcp.spec.ts`），而不是逐工具抄名字。
 */
export function hasInputSchemaFor(toolName: string): boolean {
  return Object.prototype.hasOwnProperty.call(INPUT_SCHEMAS, toolName);
}

/** `INPUT_SCHEMAS` 里登记过的工具名（用于查"孤儿抄件"：有 schema、目录里却没这个工具）。 */
export function recordedInputSchemaNames(): readonly string[] {
  return Object.keys(INPUT_SCHEMAS);
}

/**
 * 组装 MCP 工具定义。
 *
 * 🔴 **只包含已授权的工具**（见文件头说明）。
 * 未授权 = 对客户端不可见。
 *
 * `additionalProperties: false` 是刻意的：MCP 客户端会照着 schema 拼参数，
 * 放开的话模型可能塞进来我们不认识的字段，而"忽略未知字段"和
 * "猜到用户想干什么"之间的界限很容易糊掉。
 */
export function listMcpTools(config: LocalApiConfig): readonly McpToolDefinition[] {
  return listAuthorizedTools(config.grants);
}

/**
 * 已授权工具的**中性定义**——MCP 与内置 AI **共用同一份投影**。
 *
 * 🔴 抽出来不是为了少写几行，而是为了让两个调用方**不可能漂移**：
 *
 * | 调用方 | 用途 |
 * |---|---|
 * | `listMcpTools()`（MCP 握手） | 告诉外部客户端"有哪些工具" |
 * | `@heyta/app-host` 的 `ai-tool-call.ts` | 把工具喂给模型（`tools` 数组） |
 *
 * 两边都必须守**同一条立场**："未授权即不可见"（不是"看得见但调不动"），
 * 且必须给模型**同一份描述**。如果各写一份，就会出现
 * "模型看到的工具集与 MCP 客户端看到的不一样"这种静默分裂。
 *
 * ⚠️ 它**不看** `enabled` / `token`：列表是"这个用户授权过哪些工具"，
 * 与"服务有没有在监听"无关（后者由 `authorizeToolCall` 在调用时管）。
 *
 * 🔴 最后那个 `??` 兜底**别删**：pack 的 `schemas` 是**按工具名**登记的，
 * 一个 pack 完全可以先在 `tools` 里声明工具、还没来得及写 schema —— 这条路径今天
 * 仍然可达（`scripts/gen-ai-capability-manifest.mjs` 靠它把 `schemaRecorded:false`
 * 写进给模型看的能力清单，并在 stderr 里点名）。
 * 有了 pack 接缝之后，"漏登记 schema"不再需要跨三个文件同步，但它**仍然会被写错**，
 * 而"字段清单不完整"这件事只在这条回退还在的时候才可观察。
 */
export function listAuthorizedTools(
  grants: LocalApiConfig['grants'],
): readonly AuthorizedToolDefinition[] {
  const granted = LOCAL_API_TOOLS.filter((tool) => grants?.[tool.name] === true);

  return granted.map((tool) => {
    const schema = inputSchemaForTool(tool.name);
    return {
      name: tool.name,
      description: describeForMcp(tool),
      inputSchema: schema ?? { type: 'object', properties: {}, additionalProperties: false },
    };
  });
}

/**
 * 给模型看的描述。
 *
 * 🔴 在工具自己的说明后面**追加一句权限提醒**，因为模型的上下文里
 * 没有"哪些工具被授权了"这个概念 —— 它只有这份列表。
 * 写清楚能减少"请求没授权的能力"这类无用往返。
 */
function describeForMcp(tool: LocalApiTool): string {
  // 🔴 这句提醒里不许出现内部架构词（`op-log` / `dispatch` / ADR 编号…）：
  // 它是**出境数据**，模型读不懂的行话只会变成错调用 —— 而它原来写的正是
  // 「必须经 heyta 的正常写入路径（op-log）」，被 `tests/mcp.spec.ts` 那条
  // "整份目录无黑话"的判据扫出来（那条判据原来只看 `list_tasks`，所以这句话活了很久）。
  // 对 MCP 的调用方，真正相关的事实是**这条调用会不会改数据、什么时候生效**：
  // 外部工具调用是直接落库的（`executeTool` 的写分支 `host.submit`），
  // 而"要用户在界面上确认"是 heyta **内置助手**那条路，不是这条。
  const kindNote =
    tool.kind === 'write' ? '（会修改数据：调用即生效）' : '（只读，不会修改任何数据）';
  return `${tool.description} ${kindNote}`;
}

// ─────────────────────────────────────────────────────────────────────────
// JSON-RPC
// ─────────────────────────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: unknown;
}

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: JsonRpcError };

export interface JsonRpcError {
  code: number;
  message: string;
}

/**
 * JSON-RPC 标准错误码（MCP 直接用它们）。
 *
 * ⚠️ 注意 `-32601`（方法不存在）与 `-32602`（参数不合法）**不能合并**：
 * 客户端靠它们区分"服务端版本不对"和"我参数拼错了"。
 */
export const JSON_RPC_ERRORS = {
  parseError: -32_700,
  invalidRequest: -32_600,
  methodNotFound: -32_601,
  invalidParams: -32_602,
  internalError: -32_603,
} as const;

/**
 * 授权失败对应的 MCP 错误码。
 *
 * 🔴 用 `invalidParams` 还是 `methodNotFound` 是有讲究的：
 * **未授权的工具必须报 `methodNotFound`（"没有这个方法"），
 * 不能报"你没权限"** —— 后者等于确认了"这个工具存在"，
 * 与我们"未授权即不可见"的立场自相矛盾（见文件头）。
 *
 * 而 token 错误报 `invalidRequest`：那是**会话级**问题，
 * 与具体哪个工具无关，不泄露任何工具信息。
 */
export function errorCodeForDenial(
  reason: 'api-disabled' | 'token-missing' | 'token-mismatch' | 'tool-unknown' | 'tool-not-granted',
): JsonRpcError {
  switch (reason) {
    case 'api-disabled':
    case 'token-missing':
    case 'token-mismatch':
      return {
        code: JSON_RPC_ERRORS.invalidRequest,
        message: '本机 API 未启用或 token 不正确。',
      };
    case 'tool-unknown':
    case 'tool-not-granted':
      // 🔴 两者**必须给出完全相同的错误**，否则能靠错误码枚举出工具目录
      return {
        code: JSON_RPC_ERRORS.methodNotFound,
        message: '没有这个方法。',
      };
  }
}

/**
 * 处理一次 `tools/call`。
 *
 * 这是把授权与 MCP 协议粘起来的地方。**它不执行工具** ——
 * 执行由壳做（壳才知道怎么读数据、怎么 dispatch）。
 * 这里只回答"这次调用允许不允许，不允许的话回什么错误"。
 */
export type ToolCallOutcome =
  | { allowed: true; toolName: string; args: unknown }
  | { allowed: false; error: JsonRpcError };

export function handleToolsCall(
  config: LocalApiConfig,
  toolName: string,
  args: unknown,
  presentedToken: string | undefined,
): ToolCallOutcome {
  const verdict = authorizeToolCall(config, toolName, presentedToken);
  if (!verdict.allowed) {
    return { allowed: false, error: errorCodeForDenial(verdict.reason) };
  }
  return { allowed: true, toolName: verdict.tool.name, args };
}
