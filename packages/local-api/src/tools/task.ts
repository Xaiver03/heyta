/**
 * TASK 实体工具包
 * ================
 *
 * 任务的读工具（`list_tasks` / `get_task`）与写工具（`create_task` / `update_task` /
 * `complete_task`）的**全部**落点：目录条目、给模型看的参数 schema、读分支、写分支。
 * 以前这四件事散在 `tools.ts` / `mcp.ts` / `server.ts` 三个文件里，
 * 加一个工具要同时改对它们，漏一处的症状统一是"这个工具不存在"。
 *
 * ⚠️ `tools` 数组里读与写**按今天的目录顺序**排（先三个读、再三个写）。
 * 目录聚合会重排成"所有 pack 的读 + 所有 pack 的写"，所以这里的相对顺序
 * 就是 `LOCAL_API_TOOLS` 里 `get_task` 排在 `list_projects` 之前的原因。
 */

import type { McpToolDefinition } from '../mcp.js';
import type { LocalApiHost, ToolReadOutcome, ToolWriteIntentOutcome } from '../server.js';
import {
  projectListForTool,
  readItemForTool,
  readListTasksDueArgs,
  type LocalApiTool,
} from './shared.js';
import type { EntityToolPack } from './pack.js';

const TOOLS: readonly LocalApiTool[] = [
  {
    name: 'list_tasks',
    egressFields: ['task.id', 'task.title', 'task.dueDate', 'task.priority', 'task.completed', 'task.readable'],
    description:
      '列出任务。返回标题、截止日期、优先级、完成状态。' +
      '可按清单、完成状态、截止日期筛；按日期查时范围最多 14 天。' +
      '不返回备注正文 —— 备注要单独用 get_task 取。',
    kind: 'read',
    defaultEnabled: false,
  },
  {
    name: 'get_task',
    // 🔴 含正文（`LocalApiItem.body`）—— 这是目录里**出境面最大**的一个工具，
    // 披露必须把它单独说出来：多步循环会把这份正文回送给模型。
    egressFields: ['task.id', 'task.title', 'task.dueDate', 'task.priority', 'task.completed', 'task.readable', 'task.body'],
    description: '读取单个任务的完整内容（含备注正文）。',
    kind: 'read',
    defaultEnabled: false,
  },
  {
    name: 'create_task',
    // 写工具只产出提案、结果不回送模型 ⇒ 出境面是**提案里那几个字段**。
    // 写工具的结果**不回送模型**（循环在提案那一刻就停了），所以它不贡献出境字段。
    // 它产出的是待确认提案，那是本地渲染给用户看的东西，不在出境集合里。
    egressFields: [],
    description: '新建一个任务。必须走 heyta 的正常写入路径（op-log）。',
    kind: 'write',
    defaultEnabled: false,
  },
  {
    name: 'update_task',
    egressFields: [],
    description: '修改任务字段（标题、截止日期、优先级）。只能改显式给定的字段。',
    kind: 'write',
    defaultEnabled: false,
  },
  {
    name: 'complete_task',
    egressFields: [],
    description: '把任务标记为完成。',
    kind: 'write',
    defaultEnabled: false,
  },
];

/** 参数 schema（给模型看的字段清单）。 */
const SCHEMAS: Readonly<Record<string, McpToolDefinition['inputSchema']>> = {
  list_tasks: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: '只列某个清单里的任务。' },
      completed: {
        type: 'boolean',
        description: 'true 只列已完成的，false 只列未完成的，不传则都要。',
      },
      dueOn: {
        type: 'string',
        description:
          '只要截止日正好是这一天的任务，格式 YYYY-MM-DD，与返回里的 dueDate 同一口径。' +
          '与 dueFrom / dueTo 互斥。没有截止日的任务不属于任何一天，不会出现在结果里。',
      },
      dueFrom: {
        type: 'string',
        description:
          '日期范围起点（包含这一天），格式 YYYY-MM-DD，必须与 dueTo 一起给。' +
          '与 dueOn 互斥。范围含两端，最多 14 天。',
      },
      dueTo: {
        type: 'string',
        description:
          '日期范围终点（包含这一天），格式 YYYY-MM-DD，必须与 dueFrom 一起给。' +
          '与 dueOn 互斥。范围含两端，最多 14 天。',
      },
      limit: {
        type: 'number',
        description: '最多返回多少条，默认 50。在按清单 / 完成状态 / 截止日期筛完之后才生效。',
      },
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
 * 读分支。
 *
 * 🔴 三条不容商量的规则（以前住在 `server.ts` 的 switch 里，语义一字未改地搬过来）：
 *
 * 1. **读列表时逐条投影** —— 受保护的条目只出元数据，且**列表里正文一律不出**（`projectListForTool`）
 * 2. **读单条时明确拒绝** —— 不是返回空（`readItemForTool`）
 * 3. **`list_tasks` 的参数不成立就报错** —— 不降级成"当这个参数没传"。
 *    日期形状与 14 天跨度上限由 `readListTasksDueArgs` 判（契约见 `shared.ts`）。
 *
 * ⚠️ `get_task` 找不到时**不是错误**，而是一个带 `error` 字段的正常结果 ——
 * 这是既有行为，测试钉着它。别顺手改成 `ok: false`。
 */
async function runRead(
  host: LocalApiHost,
  name: string,
  a: Record<string, unknown>,
): Promise<ToolReadOutcome | undefined> {
  switch (name) {
    case 'list_tasks': {
      // 🔴 日期参数**先校验再传给宿主**。校验不成立时报 `invalid-args`，
      // 而不是"忽略这个参数照样列" —— 后者会把拼错的日期伪装成
      // "今天什么都没有了"，与本条缺陷的原形同源。
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

    default:
      // 不是 TASK 的工具名 —— 交给别的 pack，不是"读失败"。
      return undefined;
  }
}

/**
 * 写分支：参数 → 写入意图。**纯函数，不碰 host，因此不可能改数据。**
 *
 * 🔴 这条映射被两个调用方共用（MCP 立刻 `submit`、内置 AI 先出提案），
 * 抄成两份就会出现"同一个 `create_task` 在两条路径上建出不同字段的任务"，
 * 而且**不会报错**。
 */
function toIntent(name: string, a: Record<string, unknown>): ToolWriteIntentOutcome | undefined {
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

    case 'complete_task_MUTATED': {
      if (typeof a['taskId'] !== 'string') {
        return { ok: false, message: 'complete_task 需要 taskId。' };
      }
      return { ok: true, intent: { action: 'complete-task', taskId: a['taskId'] } };
    }

    default:
      return undefined;
  }
}

export const taskToolPack: EntityToolPack = {
  entityType: 'TASK',
  tools: TOOLS,
  schemas: SCHEMAS,
  runRead,
  toIntent,
};
