/**
 * @heyta/local-api
 *
 * heyta 的**入站**面：让本机其他程序（Claude Code / Cursor / Raycast / 脚本）
 * 通过本地 API 或 MCP 读写任务。
 *
 * ## 🔴 它与 `@heyta/ai` 是**相反**的两个包
 *
 * | | `@heyta/ai` | `@heyta/local-api` |
 * |---|---|---|
 * | 方向 | **出站**（我们发给模型） | **入站**（别的程序打进来） |
 * | 主要风险 | 把用户数据送出去 | 别的程序把数据读走、乱写 |
 * | 默认 | 关 | 关 |
 *
 * 分成两个包不是洁癖：放一起会让"允许远程 AI"与"允许本机程序访问"
 * 这两个**完全不同的开关**在类型层面容易混用。分开后各自只有一个地方能出错。
 *
 * ## 四条不可商量的规则
 *
 * 1. **默认关** —— 总开关关、且每个工具单独默认关（照抄 Joplin 的 11 个工具全默认关）
 * 2. **只监听回环** —— `bindAddress` 非回环一律拒绝（`0.0.0.0` 也拒）
 * 3. **显式 token** —— 防的**不是**网络攻击，是**本机其他程序**
 * 4. **加密条目可列举、不可读** —— Bear 的底线：
 *    「Encrypted notes stay encrypted. They can be listed, but never read
 *     or modified by any of these tools.」
 *
 * ## 本包不做的事
 *
 * - **不监听端口、不解析 HTTP/JSON-RPC。** 那是壳的事（ADR-0003：`apps/*` 只放平台差异）。
 *   本包只定义契约与授权判定，所以"授权规则"只有一份实现。
 * - **不构造 op。** 写入必须经 `LocalApiWritePort`（形状即 `dispatch`）。
 *   本包**没有**任何 op 构造函数，所以它**造不出**一个 op。
 * - **不读钥匙串、不碰磁盘。**
 *
 * ## 依据
 *
 * - [ADR-0011](../../../docs/adr/0011-local-api-mcp.md)
 * - [`e2ee-apps-ai.md`](../../../docs/research/e2ee-apps-ai.md)（Bear / Joplin 的原文证据）
 */

export {
  DEFAULT_LOCAL_API_CONFIG,
  LOCAL_API_TOOLS,
  TOOL_ENVELOPE_EGRESS_FIELDS,
  authorizeToolCall,
  findTool,
  isLoopbackAddress,
  isToolGranted,
  projectAllForTool,
  projectEventListForTool,
  projectListForTool,
  projectForTool,
  readEventForTool,
  readItemForTool,
  toolNames,
  validateLocalApiConfig,
  type EventReadVerdict,
  type LocalApiConfig,
  type LocalApiConfigError,
  type LocalApiConfigVerdict,
  type LocalApiEventItem,
  type LocalApiItem,
  type LocalApiTool,
  type LocalApiWriteIntent,
  type LocalApiWritePort,
  type LocalApiWriteResult,
  type ReadVerdict,
  type ToolCallDenialReason,
  type ToolCallVerdict,
  type ToolKind,
} from './tools.js';

export {
  JSON_RPC_ERRORS,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  errorCodeForDenial,
  handleToolsCall,
  hasInputSchemaFor,
  listAuthorizedTools,
  listMcpTools,
  recordedInputSchemaNames,
  type AuthorizedToolDefinition,
  type JsonRpcError,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type McpToolDefinition,
  type ToolCallOutcome,
} from './mcp.js';

export {
  LOCAL_API_METHODS,
  createLocalApiHandler,
  runReadTool,
  toWriteIntent,
  type LocalApiHandler,
  type LocalApiHandlerDeps,
  type LocalApiHost,
  type LocalApiProject,
  type ListEventsQuery,
  type ListTasksQuery,
  type ToolReadOutcome,
  type ToolWriteIntentOutcome,
} from './server.js';
