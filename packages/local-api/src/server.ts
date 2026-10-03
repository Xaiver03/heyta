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
  findTool,
  projectEventListForTool,
  projectListForTool,
  readEventForTool,
  readItemForTool,
  readListTasksDueArgs,
  type LocalApiConfig,
  type LocalApiEventItem,
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
 * `list_tasks` 的查询条件（日期已经过 `readListTasksDueArgs` 校验）。
 *
 * ⚠️ 三个日期参数是 `YYYY-MM-DD` 的**日历日字符串**，不是时刻 —— 本包刻意不产生时刻：
 * "这一天在本机是哪一个时刻"只允许有一处回答（`packages/domain/src/date.ts`
 * 与宿主侧的 `fromLocalDateString`），否则同一句"今天"会在两层算成两个日子。
 */
export interface ListTasksQuery {
  projectId?: string;
  completed?: boolean;
  limit?: number;
  /** 截止日正好是这一天。与 `dueFrom` / `dueTo` **互斥**。 */
  dueOn?: string;
  /** 范围起点（**含**这一天），与 `dueTo` **成对**出现。 */
  dueFrom?: string;
  /** 范围终点（**含**这一天），与 `dueFrom` **成对**出现。 */
  dueTo?: string;
}

/**
 * `list_events` 的查询条件（W10）。
 *
 * ⚠️ 刻意**只有** `limit`，没有日期筛选：倒数日的"哪一天"有三种口径
 * （锚点日 / 下一次发生日 / 农历换算后的公历日），而这三段的判断
 * 全在 `packages/domain/src/events.ts` 一处。协议层要是接受 `dueOn` 之类的参数，
 * 就等于在这里长出**第二套**"下一次是哪天" —— 那正是 AGENTS §3.5 记着两次学费的形状。
 * 要按日期筛，现在的做法是列出来让调用方读 `nextOccurrence` 字段。
 */
export interface ListEventsQuery {
  limit?: number;
}

/**
 * 宿主端口 —— 由壳实现。
 *
 * 🔴 `submit` 的注释里写着它必须是 `dispatch()`，但**类型上无法强制**。
 * 能强制的是**形状**（`LocalApiWriteIntent` 是封闭的五种动作），
 * 以及**没有别的写入口**（本文件只调 `host.submit`，绝不自己写）。
 *
 * 剩下那一半靠门禁：`check:layering` 应该拦下 `apps/*` 里绕过
 * `LocalApiWritePort` 直接构造 op 的代码（见 ADR-0011 §5 的待办）。
 */
export interface LocalApiHost {
  /**
   * 列任务。**壳负责按 `readable` 标注每条能不能读正文。**
   *
   * 🔴🔴 **过滤必须发生在 `limit` 之前** —— 这条顺序是契约的一部分，
   * 不是实现细节：先截断再筛，"今天的任务"只要排在第 N 条之后就查不到，
   * 而返回的是一个**空列表**（不是错误）。那与"把全量前 N 条当成今天的任务"
   * 是同一个 bug 的两副面孔：都在给用户一个**看起来像答案**的东西。
   *
   * ⚠️ 顺序只能由**实现**负责（截断发生在实现里，本包看不见也补不回来），
   * 所以写在这里，让每一个实现者第一眼就看到它。
   */
  listTasks(args: ListTasksQuery): Promise<readonly LocalApiItem[]>;
  /** 取单条任务。取不到返回 `undefined`（不是抛错）。 */
  getTask(taskId: string): Promise<LocalApiItem | undefined>;
  /** 列清单。 */
  listProjects(): Promise<readonly LocalApiProject[]>;
  /**
   * 列倒数日 / 纪念日（W10）。**同样由壳逐条标注 `readable`。**
   *
   * ⚠️ **为什么是可选的（`?`），而 `listTasks` 不是** —— 这是一次权衡，不是偷懒：
   * `LocalApiHost` 目前有 6 个真实/测试实现点，其中 5 个在 `apps/**` 的测试假宿主里，
   * 而本工单的文件边界不许我改它们。把这两个方法做成必填会让整个仓库编译不过，
   * 做成可选则**必须**保证"没接"这件事是**响亮**的：见下面 `runReadTool` 里
   * 的 `hostDoesNotSupport()` —— 它返回的是 `ok: false`，**不会**退化成
   * "返回一个空列表"，那正是 `list_tasks` 那条缺陷的形状（把筛不出伪装成筛出来的是这些）。
   * 🔴 三个真实宿主（web store / node-host CLI / MCP stdio）都走
   * `createLocalApiHost()`，也就是**全部已经实现**了这两个方法。
   * 等 `apps/**` 的假宿主补齐后应当把这层 `?` 去掉。
   */
  listEvents?(args: ListEventsQuery): Promise<readonly LocalApiEventItem[]>;
  /** 取单个倒数日。取不到返回 `undefined`（不是抛错）。同 `listEvents` 的可选理由。 */
  getEvent?(eventId: string): Promise<LocalApiEventItem | undefined>;
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
 * 把参数收成一个普通对象。
 *
 * 非对象（`null` / 字符串 / 数组）一律当作"没有参数"，
 * 于是缺必填字段会在下面各自的分支里被拒 —— **不猜**。
 */
function asRecord(args: unknown): Record<string, unknown> {
  return typeof args === 'object' && args !== null && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};
}

/**
 * 只读工具的执行结果（**已投影**，还没包成协议形状）。
 *
 * 🔴 与 `executeTool` 分开，是为了让**第二个调用方**（heyta 自己的 AI）复用
 * 同一份语义。AI 那条路径在进程内、不走 JSON-RPC，但它必须和 MCP 侧
 * 得到**逐字相同**的受保护条目处理 —— 否则同一份保护在两个入口有两种行为。
 */
export type ToolReadOutcome =
  | { ok: true; payload: unknown }
  | { ok: false; kind: 'invalid-args' | 'not-readable' | 'not-a-read-tool'; message: string };

/**
 * 执行一个**只读**工具。
 *
 * 🔴 三条不容商量的规则在这里落地：
 *
 * 1. **读列表时逐条投影** —— 受保护的条目只出元数据，且**列表里正文一律不出**（`projectListForTool`）
 * 2. **读单条时明确拒绝** —— 不是返回空（`readItemForTool`）
 * 3. **`list_tasks` 的参数不成立就报错** —— 不降级成"当这个参数没传"。
 *    日期形状与 14 天跨度上限由 `readListTasksDueArgs` 判（契约见 `tools.ts`）。
 *
 * ⚠️ `get_task` 找不到时**不是错误**，而是一个带 `error` 字段的正常结果 ——
 * 这是既有行为，测试钉着它。别顺手改成 `ok: false`。
 */
export async function runReadTool(
  host: LocalApiHost,
  name: string,
  args: unknown,
): Promise<ToolReadOutcome> {
  const a = asRecord(args);

  switch (name) {
    case 'list_tasks': {
      // 🔴 日期参数**先校验再传给宿主**。校验不成立时报 `invalid-args`，
      // 而不是"忽略这个参数照样列" —— 后者会把拼错的日期伪装成
      // "今天什么都没有了"，与本文件要修的那条缺陷同源。
      const due = readListTasksDueArgs(a);
      if (!due.ok) {
        return { ok: false, kind: 'invalid-args', message: due.message };
      }
      const items = await host.listTasks({
        ...(typeof a['projectId'] === 'string' ? { projectId: a['projectId'] } : {}),
        ...(typeof a['completed'] === 'boolean' ? { completed: a['completed'] } : {}),
        // ⚠️ `limit` 只是**递过去**，截断发生在宿主里，且在过滤**之后**。
        // 不要把任何过滤挪到这里来配合它（见 `LocalApiHost.listTasks` 的注释）。
        ...(typeof a['limit'] === 'number' ? { limit: a['limit'] } : {}),
        ...due.args,
      });
      // 🔴 投影：受保护条目只留元数据，而且**列表里正文一律不出**
      // （`projectListForTool` —— 目录描述与 `egressFields` 都这么承诺）。
      return { ok: true, payload: projectListForTool(items) };
    }

    case 'get_task': {
      if (typeof a['taskId'] !== 'string') {
        return { ok: false, kind: 'invalid-args', message: 'get_task 需要 taskId。' };
      }
      const item = await host.getTask(a['taskId']);
      if (item === undefined) {
        return { ok: true, payload: { error: '没有找到这个任务。' } };
      }
      const read = readItemForTool(item);
      // 🔴 受保护 → **错误**，不是空结果。调用方必须知道"读失败"而不是"没内容"。
      if (!read.ok) {
        return { ok: false, kind: 'not-readable', message: read.message };
      }
      return { ok: true, payload: read.item };
    }

    case 'list_projects': {
      return { ok: true, payload: await host.listProjects() };
    }

    case 'list_events': {
      // 🔴 宿主**没接**倒数日 ⇒ 响亮报错，**不是**"返回一个空列表"。
      // 后者会把"这个壳没有这个能力"伪装成"你一个倒数日都没有"，
      // 与 `list_tasks` 那条"把筛不出伪装成筛出来的是这些"是同一个 bug 的形状。
      if (host.listEvents === undefined) return hostDoesNotSupport(name);
      const items = await host.listEvents({
        ...(typeof a['limit'] === 'number' ? { limit: a['limit'] } : {}),
      });
      // 🔴 列表里备注一律不出（`projectEventListForTool` —— 与 `list_tasks` 同一刀）。
      return { ok: true, payload: projectEventListForTool(items) };
    }

    case 'get_event': {
      if (host.getEvent === undefined) return hostDoesNotSupport(name);
      if (typeof a['eventId'] !== 'string') {
        return { ok: false, kind: 'invalid-args', message: 'get_event 需要 eventId。' };
      }
      const item = await host.getEvent(a['eventId']);
      // ⚠️ 找不到时**不是错误**，而是带 `error` 字段的正常结果 —— 与 `get_task` 同一形状
      // （那是既有行为，`tool-egress-fields` 的 `{error}` 信封声明就是为它写的）。
      if (item === undefined) {
        return { ok: true, payload: { error: '没有找到这个倒数日。' } };
      }
      const read = readEventForTool(item);
      // 🔴 受保护 → **错误**，不是空结果。
      if (!read.ok) {
        return { ok: false, kind: 'not-readable', message: read.message };
      }
      return { ok: true, payload: read.item };
    }

    default:
      return { ok: false, kind: 'not-a-read-tool', message: `「${name}」不是只读工具。` };
  }
}

/**
 * 宿主没有实现这一段能力时的回答。
 *
 * 🔴 单独成一个函数，是为了让**两个**入口（内置 AI 与 MCP）说的是同一句话 ——
 * 两个前端一份判断（不变量 19）。
 * ⚠️ `kind` 取 `invalid-args` 而不是新造一档：新增一档会牵动
 * `ai-tool-run.ts` 的失败映射与 `apps/web` 的失败文案表，而那两处不在本工单范围内
 * （W10 的验收明确要求 `ai-tool-run.ts` 零改动）。真正的信息在 `message` 里。
 */
function hostDoesNotSupport(name: string): ToolReadOutcome {
  return {
    ok: false,
    kind: 'invalid-args',
    message:
      `这个宿主没有接倒数日（${name} 需要宿主实现对应的读方法），` +
      '所以一个字节都没有读到 —— 不是"你没有倒数日"。',
  };
}

/**
 * 工具参数 → 写入意图。**纯函数，不碰 host，因此不可能改数据。**
 *
 * 🔴 抽出来是这次改动的核心：写工具现在有两个下场，而两者必须用**同一份**
 * 参数解释（不变量 19）：
 *
 * | 调用方 | 拿到 intent 之后 |
 * |---|---|
 * | MCP / 本机 API | 立刻 `host.submit(intent)` |
 * | **heyta 自己的 AI** | **不 submit** —— 包成"提案"交给用户确认；确认后才 `submit` |
 *
 * 如果这条映射被抄成两份，"同一个 `create_task` 调用在两条路径上建出不同字段
 * 的任务"就会发生，而且**不会报错** —— 正是本仓库反复栽过的那类漂移。
 */
export type ToolWriteIntentOutcome =
  | { ok: true; intent: LocalApiWriteIntent }
  | { ok: false; message: string };

export function toWriteIntent(name: string, args: unknown): ToolWriteIntentOutcome {
  const a = asRecord(args);

  switch (name) {
    case 'create_task': {
      if (typeof a['title'] !== 'string' || a['title'].trim() === '') {
        return { ok: false, message: 'create_task 需要 title。' };
      }
      return {
        ok: true,
        intent: {
          action: 'create-task',
          title: a['title'],
          ...(typeof a['dueDate'] === 'string' ? { dueDate: a['dueDate'] } : {}),
          ...(typeof a['priority'] === 'string' ? { priority: a['priority'] } : {}),
          ...(typeof a['projectId'] === 'string' ? { projectId: a['projectId'] } : {}),
        },
      };
    }

    case 'update_task': {
      if (typeof a['taskId'] !== 'string' || typeof a['fields'] !== 'object' || a['fields'] === null) {
        return { ok: false, message: 'update_task 需要 taskId 与 fields。' };
      }
      return {
        ok: true,
        intent: {
          action: 'update-task',
          taskId: a['taskId'],
          fields: a['fields'] as Record<string, unknown>,
        },
      };
    }

    case 'complete_task': {
      if (typeof a['taskId'] !== 'string') {
        return { ok: false, message: 'complete_task 需要 taskId。' };
      }
      return { ok: true, intent: { action: 'complete-task', taskId: a['taskId'] } };
    }

    case 'create_event': {
      // ⚠️ 这里只做**形状**检查（有没有这个键、是不是字符串）。
      // "这个日期是不是真实存在的一天""这个 kind 在不在封闭词表里"由**宿主**判
      // （`packages/domain` 的 `eventRejection` 是唯一归属）——
      // 在本包再判一遍就是第二套日历判断，而那正是 AGENTS §3.5 记着学费的形状。
      if (typeof a['title'] !== 'string' || a['title'].trim() === '') {
        return { ok: false, message: 'create_event 需要 title。' };
      }
      if (typeof a['date'] !== 'string' || a['date'].trim() === '') {
        return { ok: false, message: 'create_event 需要 date（锚点日期，YYYY-MM-DD）。' };
      }
      return {
        ok: true,
        intent: {
          action: 'create-event',
          title: a['title'],
          date: a['date'],
          ...(typeof a['kind'] === 'string' ? { kind: a['kind'] } : {}),
          ...(typeof a['isLunar'] === 'boolean' ? { isLunar: a['isLunar'] } : {}),
          ...(typeof a['recurrence'] === 'string' ? { recurrence: a['recurrence'] } : {}),
          ...(typeof a['notes'] === 'string' ? { notes: a['notes'] } : {}),
        },
      };
    }

    case 'update_event': {
      if (typeof a['eventId'] !== 'string' || typeof a['fields'] !== 'object' || a['fields'] === null) {
        return { ok: false, message: 'update_event 需要 eventId 与 fields。' };
      }
      return {
        ok: true,
        intent: {
          action: 'update-event',
          eventId: a['eventId'],
          fields: a['fields'] as Record<string, unknown>,
        },
      };
    }

    default:
      return { ok: false, message: `「${name}」不是会改数据的工具。` };
  }
}

/**
 * 执行一个已授权的工具（MCP / 本机 API 路径）。
 *
 * 🔴 三条不容商量的规则在这里落地：
 *
 * 1. **读列表时逐条投影** —— 见 `runReadTool`
 * 2. **读单条时明确拒绝** —— 见 `runReadTool`
 * 3. **写只走 `host.submit`** —— 本函数是**唯一**调 `submit` 的地方
 *
 * 本函数只是把上面两个导出件拼起来；**语义都在它们里面**，
 * 所以第二个调用方（AI）用同样的两个件，行为必然一致。
 */
async function executeTool(
  host: LocalApiHost,
  name: string,
  args: unknown,
): Promise<{ result: unknown } | { error: JsonRpcError }> {
  const tool = findTool(name);
  if (tool === undefined) return { error: METHOD_NOT_FOUND };

  if (tool.kind === 'read') {
    const read = await runReadTool(host, name, args);
    if (!read.ok) {
      const code =
        read.kind === 'invalid-args' ? JSON_RPC_ERRORS.invalidParams : JSON_RPC_ERRORS.invalidRequest;
      return { error: { code, message: read.message } };
    }
    return { result: toolText(read.payload) };
  }

  const write = toWriteIntent(name, args);
  if (!write.ok) {
    return { error: { code: JSON_RPC_ERRORS.invalidParams, message: write.message } };
  }
  return writeResult(await host.submit(write.intent));
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
