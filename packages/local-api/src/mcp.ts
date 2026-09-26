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
 * 所以如果用户只授权了 `list_tasks` 却把 6 个工具全报过去：
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
  LOCAL_API_TOOLS,
  authorizeToolCall,
  type LocalApiConfig,
  type LocalApiTool,
} from './tools.js';

/** 我们按这个版本的 MCP 形状输出。 */
export const MCP_PROTOCOL_VERSION = '2025-06-18';

/** 本服务的名字，出现在 MCP 握手里。 */
export const MCP_SERVER_NAME = 'heyta';

/**
 * MCP 工具定义。
 *
 * `inputSchema` 用 JSON Schema（MCP 的规定），**在我们这边是手工写的** ——
 * 因为 `@heyta/local-api` 是零依赖包，不引 schema 生成库；
 * 而且工具只有 6 个，手写比引入一套生成器更清楚。
 */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Readonly<Record<string, unknown>>;
    required?: readonly string[];
    additionalProperties: false;
  };
}

/** 每个工具的参数 schema。 */
const INPUT_SCHEMAS: Readonly<Record<string, McpToolDefinition['inputSchema']>> = {
  list_tasks: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: '只列某个清单里的任务。' },
      completed: {
        type: 'boolean',
        description: 'true 只列已完成的，false 只列未完成的，不传则都要。',
      },
      limit: { type: 'number', description: '最多返回多少条，默认 50。' },
    },
    additionalProperties: false,
  },
  get_task: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '任务 id。' },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  list_projects: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  create_task: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '任务标题。' },
      dueDate: { type: 'string', description: '截止日期，`YYYY-MM-DD`。' },
      priority: { type: 'string', description: '优先级：high / medium / low。' },
      projectId: { type: 'string', description: '放进哪个清单。' },
    },
    required: ['title'],
    additionalProperties: false,
  },
  update_task: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要改的任务 id。' },
      fields: {
        type: 'object',
        description: '要改的字段。只改这里给出的字段，其余不动。',
      },
    },
    required: ['taskId', 'fields'],
    additionalProperties: false,
  },
  complete_task: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要标记完成的任务 id。' },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
};

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
  const granted = LOCAL_API_TOOLS.filter((tool) => config.grants?.[tool.name] === true);

  return granted.map((tool) => {
    const schema = INPUT_SCHEMAS[tool.name];
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
  const kindNote =
    tool.kind === 'write'
      ? '（会修改数据：必须经 heyta 的正常写入路径）'
      : '（只读，不会修改任何数据）';
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
