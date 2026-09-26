/**
 * 本地 API —— 协议处理
 * ======================
 *
 * 把 `tools.ts`（契约）、`mcp.ts`（定义）接成一个**可调用的处理器**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 它是**与传输无关**的：收一个 `JsonRpcRequest`，回一个 `JsonRpcResponse`。
 *    不碰 socket、不碰 stdio、不碰 HTTP。
 *
 * 为什么这样分（ADR-0003）："怎么收字节"是平台差异（桌面用本地 HTTP、
 * 将来可能用 stdio 或别的），而"这次调用允不允许、该回什么"是**产品语义**。
 * 后者只写一遍。
 *
 * 于是壳那边永远只剩这十几行：
 * ```ts
 * const handle = createLocalApiHandler({ host, getConfig });
 * // HTTP 壳
 * http.createServer((req, res) => { ... handle(parse(req.body), req.headers['x-heyta-token']) ... })
 * ```
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 🔴 本文件**不读数据库、不写状态**
 *
 * 所有数据访问都经 `LocalApiHost` 端口。这不是洁癖，是因为：
 * - 读：本包零依赖，不能连 SQLite
 * - 写：**必须经壳接到真的 `dispatch()`**（ADR-0011 §3.5）——
 *   本包如果自己写，就绕过了向量时钟、幂等、冲突检测
 *
 * 有测试断言：**写操作只通过 `host.submit` 发生**（注入一个会记账的假 host）。
 */

import {
  LOCAL_API_TOOLS,
  authorizeToolCall,
  projectAllForTool,
  readItemForTool,
  type LocalApiConfig,
  type LocalApiItem,
  type LocalApiWriteIntent,
  type LocalApiWriteResult,
} from './tools.js';
import {
  JSON_RPC_ERRORS,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  listMcpTools,
  type JsonRpcError,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './mcp.js';

// ─────────────────────────────────────────────────────────────────────────
// 宿主端口
// ─────────────────────────────────────────────────────────────────────────

/** 清单/项目。与 `LocalApiItem` 不同，它没有"可读性"问题（名字不是敏感正文）。 */
export interface LocalApiProject {
  id: string;
  name: string;
  taskCount: number;
}

/**
 * 宿主端口 —— 由壳实现。
 *
 * 🔴 `submit` 的注释里写着它必须是 `dispatch()`，但**类型上无法强制**。
 * 能强制的是**形状**（`LocalApiWriteIntent` 是封闭的三种动作），
 * 以及**没有别的写入口**（本文件只调 `host.submit`，绝不自己写）。
 *
 * 剩下那一半靠门禁：`check:layering` 应该拦下 `apps/*` 里绕过
 * `LocalApiWritePort` 直接构造 op 的代码（见 ADR-0011 §5 的待办）。
 */
export interface LocalApiHost {
  /** 列任务。**壳负责按 `readable` 标注每条能不能读正文。** */
  listTasks(args: { projectId?: string; completed?: boolean; limit?: number }): Promise<readonly LocalApiItem[]>;
  /** 取单条任务。取不到返回 `undefined`（不是抛错）。 */
  getTask(taskId: string): Promise<LocalApiItem | undefined>;
  /** 列清单。 */
  listProjects(): Promise<readonly LocalApiProject[]>;
  /**
   * 🔴 **必须是 `dispatch()`。**
   *
   * 壳在这一层把 `LocalApiWriteIntent` 翻译成真正的 op 并交给 op-log。
   * 本包不解释 intent，只传递 —— 所以"解释 op 的地方"永远只有一处。
   */
  submit(intent: LocalApiWriteIntent): Promise<LocalApiWriteResult>;
}

export interface LocalApiHandlerDeps {
  host: LocalApiHost;
  /**
   * 取当前配置。
   *
   * 🔴 用**函数**而不是值：用户随时可能在设置里改授权，
   * 而处理器是长活的。传值的话改了要重启服务才生效 ——
   * 那会让"撤销授权"变成一件不可靠的事。
   */
  getConfig: () => LocalApiConfig;
  /** 时钟，注入以便测试确定性地断言授权时间。 */
  now?: () => number;
}

/** 处理器签名。**传输层只依赖它。** */
export type LocalApiHandler = (
  request: JsonRpcRequest,
  presentedToken: string | undefined,
) => Promise<JsonRpcResponse | undefined>;

// ─────────────────────────────────────────────────────────────────────────
// 处理器
// ─────────────────────────────────────────────────────────────────────────

const METHOD_NOT_FOUND: JsonRpcError = {
  code: JSON_RPC_ERRORS.methodNotFound,
  message: '没有这个方法。',
};

export function createLocalApiHandler(deps: LocalApiHandlerDeps): LocalApiHandler {
  const { host, getConfig } = deps;

  return async function handle(request, presentedToken) {
    // 🔴🔴 **没有 `id` 就是通知（notification），必须不回复。**
    //
    // JSON-RPC 2.0 明确规定通知**不得**有响应。而 MCP 客户端在 `initialize`
    // 之后**立刻**会发 `notifications/initialized` —— 如果这里回一条
    // `-32601 Method not found`，真实的客户端会认为服务端行为不合法。
    //
    // ⚠️ 这是"自己发给自己"的测试**永远测不出来**的那类问题：
    // 我自己的测试只发了有 id 的请求，所以一直是绿的。
    if (request.id === undefined) {
      return undefined;
    }

    const id = request.id;

    // 🔴 先验身份，再看方法名。
    // 顺序与 `authorizeToolCall` 内部一致，理由也一样：
    // 反过来的话，没带 token 的调用方可以靠"方法不存在"与"工具未授权"
    // 的不同响应把能力面枚举出来。
    const guard = authorizeSession(getConfig(), presentedToken);
    if (guard !== undefined) {
      return { jsonrpc: '2.0', id, error: guard };
    }

    switch (request.method) {
      case 'initialize':
        return { jsonrpc: '2.0', id, result: initializeResult(getConfig()) };

      case 'tools/list':
        // 🔴 只列已授权的工具 —— 未授权的对客户端**完全不可见**
        return { jsonrpc: '2.0', id, result: { tools: listMcpTools(getConfig()) } };

      case 'tools/call':
        return { jsonrpc: '2.0', id, ...(await callTool(deps, request.params, presentedToken)) };

      default:
        return { jsonrpc: '2.0', id, error: METHOD_NOT_FOUND };
    }
  };
}

/**
 * 会话级闸门：总开关 + token。
 *
 * 返回 `undefined` 表示放行。
 *
 * ⚠️ 它**不检查具体工具的授权** —— 那是 `tools/call` 内部的事。
 * 因为 `tools/list` 不需要"某个工具的授权"，它需要的是"会话本身合法"。
 */
function authorizeSession(
  config: LocalApiConfig,
  presentedToken: string | undefined,
): JsonRpcError | undefined {
  // 复用 authorizeToolCall 的会话部分：用一个一定存在的工具名去问，
  // 只关心它给出的"会话级"错误。
  // ⚠️ 这里刻意**不**直接写一遍 token 比较 —— 会话规则只有一处实现。
  const probe = authorizeToolCall(config, '__session_probe__', presentedToken);
  if (probe.allowed) return undefined;

  switch (probe.reason) {
    case 'api-disabled':
    case 'token-missing':
      return { code: JSON_RPC_ERRORS.invalidRequest, message: '本机 API 未启用。' };
    case 'token-mismatch':
      return { code: JSON_RPC_ERRORS.invalidRequest, message: '访问 token 不正确。' };
    // 会话是合法的，只是探测用的工具名不存在 —— 说明闸门通过了
    case 'tool-unknown':
    case 'tool-not-granted':
      return undefined;
  }
}

/** `initialize` 的返回。MCP 客户端靠它判断服务端能力。 */
function initializeResult(config: LocalApiConfig): unknown {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    serverInfo: { name: MCP_SERVER_NAME, version: '0.0.0' },
    capabilities: { tools: { listChanged: false } },
    instructions:
      'heyta 任务管理器。默认只开放少数工具，且受保护的任务只能看到标题、读不到内容。' +
      (config.grants === undefined || Object.keys(config.grants).length === 0
        ? '当前没有任何工具被授权。'
        : ''),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// tools/call
// ─────────────────────────────────────────────────────────────────────────

async function callTool(
  deps: LocalApiHandlerDeps,
  params: unknown,
  presentedToken: string | undefined,
): Promise<{ result: unknown } | { error: JsonRpcError }> {
  const { host, getConfig } = deps;

  if (typeof params !== 'object' || params === null) {
    return { error: { code: JSON_RPC_ERRORS.invalidParams, message: 'tools/call 需要一个对象参数。' } };
  }
  const p = params as { name?: unknown; arguments?: unknown };
  if (typeof p.name !== 'string') {
    return { error: { code: JSON_RPC_ERRORS.invalidParams, message: '缺少工具名。' } };
  }

  const verdict = authorizeToolCall(getConfig(), p.name, presentedToken);
  if (!verdict.allowed) {
    // 未授权与不存在给出**同一种**错误（见 mcp.ts 的说明）
    return { error: toolDenial(verdict.reason) };
  }

  return executeTool(host, p.name, p.arguments);
}

function toolDenial(reason: string): JsonRpcError {
  switch (reason) {
    case 'api-disabled':
    case 'token-missing':
    case 'token-mismatch':
      return { code: JSON_RPC_ERRORS.invalidRequest, message: '本机 API 未启用或 token 不正确。' };
    default:
      return METHOD_NOT_FOUND;
  }
}

/**
 * 执行一个已授权的工具。
 *
 * 🔴 三条不容商量的规则在这里落地：
 *
 * 1. **读列表时逐条投影** —— 受保护的条目只出元数据（`projectAllForTool`）
 * 2. **读单条时明确拒绝** —— 不是返回空（`readItemForTool`）
 * 3. **写只走 `host.submit`** —— 本函数里没有任何别的地方能改数据
 */
async function executeTool(
  host: LocalApiHost,
  name: string,
  args: unknown,
): Promise<{ result: unknown } | { error: JsonRpcError }> {
  const a = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>;

  switch (name) {
    case 'list_tasks': {
      const items = await host.listTasks({
        ...(typeof a['projectId'] === 'string' ? { projectId: a['projectId'] } : {}),
        ...(typeof a['completed'] === 'boolean' ? { completed: a['completed'] } : {}),
        ...(typeof a['limit'] === 'number' ? { limit: a['limit'] } : {}),
      });
      // 🔴 投影：受保护条目只留元数据
      return { result: toolText(projectAllForTool(items)) };
    }

    case 'get_task': {
      if (typeof a['taskId'] !== 'string') {
        return { error: { code: JSON_RPC_ERRORS.invalidParams, message: 'get_task 需要 taskId。' } };
      }
      const item = await host.getTask(a['taskId']);
      if (item === undefined) {
        return { result: toolText({ error: '没有找到这个任务。' }) };
      }
      const read = readItemForTool(item);
      // 🔴 受保护 → **错误**，不是空结果。调用方必须知道"读失败"而不是"没内容"。
      if (!read.ok) {
        return { error: { code: JSON_RPC_ERRORS.invalidRequest, message: read.message } };
      }
      return { result: toolText(read.item) };
    }

    case 'list_projects': {
      const projects = await host.listProjects();
      return { result: toolText(projects) };
    }

    case 'create_task': {
      if (typeof a['title'] !== 'string' || a['title'].trim() === '') {
        return { error: { code: JSON_RPC_ERRORS.invalidParams, message: 'create_task 需要 title。' } };
      }
      return writeResult(
        await host.submit({
          action: 'create-task',
          title: a['title'],
          ...(typeof a['dueDate'] === 'string' ? { dueDate: a['dueDate'] } : {}),
          ...(typeof a['priority'] === 'string' ? { priority: a['priority'] } : {}),
          ...(typeof a['projectId'] === 'string' ? { projectId: a['projectId'] } : {}),
        }),
      );
    }

    case 'update_task': {
      if (typeof a['taskId'] !== 'string' || typeof a['fields'] !== 'object' || a['fields'] === null) {
        return {
          error: { code: JSON_RPC_ERRORS.invalidParams, message: 'update_task 需要 taskId 与 fields。' },
        };
      }
      return writeResult(
        await host.submit({
          action: 'update-task',
          taskId: a['taskId'],
          fields: a['fields'] as Record<string, unknown>,
        }),
      );
    }

    case 'complete_task': {
      if (typeof a['taskId'] !== 'string') {
        return { error: { code: JSON_RPC_ERRORS.invalidParams, message: 'complete_task 需要 taskId。' } };
      }
      return writeResult(await host.submit({ action: 'complete-task', taskId: a['taskId'] }));
    }

    default:
      return { error: METHOD_NOT_FOUND };
  }
}

/** 把结果包成 MCP 的 `content` 形状。 */
function toolText(payload: unknown): unknown {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

/** 写入结果 → MCP 结果。失败也走 `content`（因为它是"工具执行结果失败"，不是协议错误）。 */
function writeResult(result: LocalApiWriteResult): { result: unknown } {
  if (result.ok) {
    return { result: toolText({ ok: true, taskId: result.taskId }) };
  }
  const payload = toolText({ ok: false, reason: result.reason, message: result.message }) as {
    content: readonly { type: string; text: string }[];
  };
  return { result: { content: payload.content, isError: true } };
}

/** 供壳与测试用：这份处理器认哪些方法。 */
export const LOCAL_API_METHODS = ['initialize', 'tools/list', 'tools/call'] as const;

/** 工具名清单（转发），壳用它做启动自检。 */
export { LOCAL_API_TOOLS };
