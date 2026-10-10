/**
 * TASK 实体工具包
 * ================
 *
 * 任务的读工具（`list_tasks` / `get_task`）与写工具（`create_task` / `update_task` /
 * `append_task_checklist` / `complete_task` / `set_task_priorities`）的**全部**落点：目录条目、给模型看的参数 schema、读分支、写分支。
 * 以前这四件事散在 `tools.ts` / `mcp.ts` / `server.ts` 三个文件里，
 * 加一个工具要同时改对它们，漏一处的症状统一是"这个工具不存在"。
 *
 * ⚠️ `tools` 数组里读与写**按今天的目录顺序**排（先三个读、再三个写）。
 * 目录聚合会重排成"所有 pack 的读 + 所有 pack 的写"，所以这里的相对顺序
 * 就是 `LOCAL_API_TOOLS` 里 `get_task` 排在 `list_projects` 之前的原因。
 */

import type { McpToolDefinition } from '../mcp.js';
import type {
  LocalApiHost,
  ToolReadOutcome,
  ToolWriteIntentOutcome,
  LocalApiTaskEstimateContext,
} from '../server.js';
import {
  MAX_TASK_CHECKLIST_ITEM_LENGTH,
  MAX_TASK_CHECKLIST_ITEMS,
  MAX_TASKS_PER_BATCH_COMPLETE,
  MAX_TASKS_PER_BATCH_PRIORITY,
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
    name: 'get_task_estimate_context',
    egressFields: [
      'task.id',
      'task.taskId',
      'task.title',
      'task.readable',
      'task.body',
      'task.currentMinutes',
      'task.history',
      'task.plannedMs',
      'task.actualMs',
      'task.preferences',
      'task.text',
    ],
    description:
      '读取一条任务的估时上下文：标题、可读时的备注、最近至多 20 条有效专注历史和已授权的估时偏好。',
    kind: 'read',
    defaultEnabled: false,
  },
  {
    name: 'create_task',
    // 写工具只产出提案、结果不回送模型 ⇒ 出境面是**提案里那几个字段**。
    // 写工具的结果**不回送模型**（循环在提案那一刻就停了），所以它不贡献出境字段。
    // 它产出的是待确认提案，那是本地渲染给用户看的东西，不在出境集合里。
    egressFields: [],
    // 原来这里写着「必须走 heyta 的正常写入路径（op-log）」—— 那是**给开发者的提醒**
    // 被印进了出境数据里：模型既读不懂 `op-log`，也不需要知道落库机制
    // （机制由本包"产不出 op"的类型形状保证，不靠告诉模型）。
    description: '新建一个任务。',
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
    name: 'append_task_checklist',
    egressFields: [],
    description: '把一组未完成清单追加到任务备注末尾，保留已有备注。一次最多 20 条。',
    kind: 'write',
    defaultEnabled: false,
  },
  {
    name: 'complete_task',
    egressFields: [],
    // ⚠️ 这个数字来自 `MAX_TASKS_PER_BATCH_COMPLETE`，不是抄的：描述会出境给模型，
    // 一个和实际拒判不一致的上限，症状是"模型以为能给 30 条、每次都被告知太多"。
    description:
      '把任务标记为完成。单条给 taskId；要一次完成多条给 taskIds' +
      `（一次最多 ${String(MAX_TASKS_PER_BATCH_COMPLETE)} 条，按去重后的条数算）。`,
    kind: 'write',
    defaultEnabled: false,
  },
  {
    name: 'set_task_priorities',
    egressFields: [],
    description: `一次给多条任务设置优先级。每条都要给 taskId 与 priority（none / low / medium / high），最多 ${String(MAX_TASKS_PER_BATCH_PRIORITY)} 条。`,
    kind: 'write',
    defaultEnabled: false,
  },
  {
    name: 'set_task_estimate',
    egressFields: [],
    description: '设置任务的预计耗时（整数分钟，5–480；超出范围会夹到边界）。这项改动必须确认。',
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
  get_task_estimate_context: {
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
  append_task_checklist: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要追加清单的任务 id。' },
      items: {
        type: 'array',
        items: { type: 'string' },
        description: `要追加的清单条目，每条最多 ${String(MAX_TASK_CHECKLIST_ITEM_LENGTH)} 个字符，最多 ${String(MAX_TASK_CHECKLIST_ITEMS)} 条。`,
      },
    },
    required: ['taskId', 'items'],
    additionalProperties: false,
  },
  complete_task: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要标记完成的那一条任务 id。' },
      taskIds: {
        type: 'array',
        items: { type: 'string' },
        description:
          `要一次标记完成的多条任务 id（最多 ${String(MAX_TASKS_PER_BATCH_COMPLETE)} 条）。` +
          '与 taskId 二选一，都给会被拒绝而不是挑一个用 —— 一次意图只能有一个范围。',
      },
    },
    // ⚠️ 这里刻意**没有** `required`：单条与批量是同一件事的两种范围，
    // "两个都没给"由 `toWriteIntent` 判（判据在那里，症状是一条说得出原因的报错，
    // 不是模型收到一个协议层的 schema 拒绝）。
    additionalProperties: false,
  },
  set_task_priorities: {
    type: 'object',
    properties: {
      entries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: '要改优先级的任务 id。' },
            priority: { type: 'string', description: '优先级：none / low / medium / high。' },
          },
          required: ['taskId', 'priority'],
          additionalProperties: false,
        },
        description: `要设置的任务优先级，最多 ${String(MAX_TASKS_PER_BATCH_PRIORITY)} 条。`,
      },
    },
    required: ['entries'],
    additionalProperties: false,
  },
  set_task_estimate: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要设置预计耗时的任务 id。' },
      minutes: {
        type: 'number',
        description: '整数分钟。5–480；低于 5 夹到 5，高于 480 夹到 480。',
      },
    },
    required: ['taskId', 'minutes'],
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

    case 'get_task_estimate_context': {
      if (typeof a['taskId'] !== 'string' || a['taskId'].trim() === '') {
        return { ok: false, kind: 'invalid-args', message: 'get_task_estimate_context 需要 taskId。' };
      }
      if (host.getTaskEstimateContext === undefined) {
        return {
          ok: false,
          kind: 'invalid-args',
          message: '这个宿主没有接任务估时上下文，因此没有读取任何任务内容。',
        };
      }
      const context = await host.getTaskEstimateContext(a['taskId'].trim());
      if (context === undefined) return { ok: true, payload: { error: '没有找到这个任务。' } };
      return { ok: true, payload: context satisfies LocalApiTaskEstimateContext };
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
      const allowed = new Set(['title', 'dueDate', 'priority', 'projectId']);
      const unknown = Object.keys(a).filter((key) => !allowed.has(key));
      if (unknown.length > 0) {
        return { ok: false, message: `create_task 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['title'] !== 'string' || a['title'].trim() === '') {
        return { ok: false, message: 'create_task 需要 title。' };
      }
      for (const key of ['dueDate', 'priority', 'projectId'] as const) {
        if (key in a && typeof a[key] !== 'string') {
          return { ok: false, message: `create_task 的 ${key} 必须是字符串。` };
        }
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

    case 'append_task_checklist': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskId' && key !== 'items');
      if (unknown.length > 0) {
        return { ok: false, message: `append_task_checklist 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['taskId'] !== 'string' || a['taskId'].trim() === '') {
        return { ok: false, message: 'append_task_checklist 需要 taskId。' };
      }
      const rawItems = a['items'];
      if (!Array.isArray(rawItems) || rawItems.length === 0) {
        return { ok: false, message: 'append_task_checklist 需要至少一条 items。' };
      }
      if (rawItems.length > MAX_TASK_CHECKLIST_ITEMS) {
        return {
          ok: false,
          message: `append_task_checklist 一次最多 ${String(MAX_TASK_CHECKLIST_ITEMS)} 条。`,
        };
      }
      const items: string[] = [];
      for (const raw of rawItems) {
        if (typeof raw !== 'string') {
          return { ok: false, message: 'append_task_checklist 的 items 必须全是字符串。' };
        }
        const item = raw.trim();
        if (item === '') {
          return { ok: false, message: 'append_task_checklist 的清单条目不能为空。' };
        }
        if (item.length > MAX_TASK_CHECKLIST_ITEM_LENGTH) {
          return {
            ok: false,
            message: `append_task_checklist 的单条清单最多 ${String(MAX_TASK_CHECKLIST_ITEM_LENGTH)} 个字符。`,
          };
        }
        items.push(item);
      }
      return { ok: true, intent: { action: 'append-task-checklist', taskId: a['taskId'].trim(), items } };
    }

    case 'complete_task': {
      const single = a['taskId'];
      const batch = a['taskIds'];
      if (single !== undefined && batch !== undefined) {
        return {
          ok: false,
          message: 'complete_task 的 taskId 与 taskIds 只能给一个：一次意图的范围要么是一条，要么是多条。',
        };
      }
      if (single !== undefined) {
        if (typeof single !== 'string' || single === '') {
          return { ok: false, message: 'complete_task 的 taskId 应是非空字符串。' };
        }
        return { ok: true, intent: { action: 'complete-task', taskId: single } };
      }
      if (batch === undefined) {
        return { ok: false, message: 'complete_task 需要 taskId（单条）或 taskIds（批量）。' };
      }
      if (
        !Array.isArray(batch) ||
        batch.some((id) => typeof id !== 'string' || (id as string) === '')
      ) {
        return { ok: false, message: 'taskIds 必须是由非空 id 字符串组成的数组。' };
      }
      // 先去重再判上限：否则"同一份清单点了 25 次"会因为重复被拒，而它实际只有几条。
      const ids = [...new Set(batch as readonly string[])];
      if (ids.length === 0) {
        return { ok: false, message: 'taskIds 是空的：没有要完成的任务。' };
      }
      if (ids.length > MAX_TASKS_PER_BATCH_COMPLETE) {
        return {
          ok: false,
          message:
            `一次最多完成 ${String(MAX_TASKS_PER_BATCH_COMPLETE)} 条，去重后收到 ${String(ids.length)} 条。` +
            '要再多就得分成几次，每次都要单独确认 —— 这个上限守的是"那一次确认"本身。',
        };
      }
      const [only] = ids;
      if (ids.length === 1 && only !== undefined) {
        // 去重后只剩一条就走单条形状：确认卡上"这条"和"这 1 条"是两句话，
        // 而批量形状会让用户以为还有一件别的事发生。
        return { ok: true, intent: { action: 'complete-task', taskId: only } };
      }
      return { ok: true, intent: { action: 'complete-tasks', taskIds: ids } };
    }

    case 'set_task_priorities': {
      const rawEntries = a['entries'];
      const unknown = Object.keys(a).filter((key) => key !== 'entries');
      if (unknown.length > 0) {
        return { ok: false, message: `set_task_priorities 不支持这些参数：${unknown.join('、')}。` };
      }
      if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
        return { ok: false, message: 'set_task_priorities 需要至少一条 entries。' };
      }
      if (rawEntries.length > MAX_TASKS_PER_BATCH_PRIORITY) {
        return {
          ok: false,
          message: `set_task_priorities 一次最多 ${String(MAX_TASKS_PER_BATCH_PRIORITY)} 条。`,
        };
      }
      const entries: { taskId: string; priority: string }[] = [];
      const seen = new Set<string>();
      for (const raw of rawEntries) {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
          return { ok: false, message: 'set_task_priorities 的 entries 必须全是对象。' };
        }
        const entry = raw as Record<string, unknown>;
        const entryUnknown = Object.keys(entry).filter((key) => key !== 'taskId' && key !== 'priority');
        if (entryUnknown.length > 0) {
          return { ok: false, message: `set_task_priorities 的条目不支持这些参数：${entryUnknown.join('、')}。` };
        }
        if (!('taskId' in entry) || !('priority' in entry)) {
          return { ok: false, message: 'set_task_priorities 的每个条目都需要 taskId 与 priority。' };
        }
        if (typeof entry['taskId'] !== 'string' || entry['taskId'].trim() === '') {
          return { ok: false, message: 'set_task_priorities 的 taskId 必须是非空字符串。' };
        }
        const taskId = entry['taskId'].trim();
        if (seen.has(taskId)) {
          return { ok: false, message: `set_task_priorities 不能重复 taskId「${taskId}」。` };
        }
        if (typeof entry['priority'] !== 'string') {
          return { ok: false, message: 'set_task_priorities 的 priority 必须是字符串。' };
        }
        const priority = entry['priority'].trim().toLowerCase();
        if (!['none', 'low', 'medium', 'high'].includes(priority)) {
          return {
            ok: false,
            message: `优先级应为 none / low / medium / high，收到「${entry['priority']}」。`,
          };
        }
        seen.add(taskId);
        entries.push({ taskId, priority });
      }
      return { ok: true, intent: { action: 'set-task-priorities', entries } };
    }

    case 'set_task_estimate': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskId' && key !== 'minutes');
      if (unknown.length > 0) {
        return { ok: false, message: `set_task_estimate 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['taskId'] !== 'string' || a['taskId'].trim() === '') {
        return { ok: false, message: 'set_task_estimate 需要 taskId。' };
      }
      if (typeof a['minutes'] !== 'number' || !Number.isFinite(a['minutes']) || !Number.isInteger(a['minutes'])) {
        return { ok: false, message: 'set_task_estimate 的 minutes 必须是有限整数。' };
      }
      if (a['minutes'] < 0) {
        return { ok: false, message: 'set_task_estimate 的 minutes 不能是负数。' };
      }
      // The app-host action owns the canonical clamp implementation. Keeping the
      // raw integer here lets it reuse that function before the proposal is
      // submitted, while the contract still rejects fractional input locally.
      return {
        ok: true,
        intent: { action: 'set-task-estimate', taskId: a['taskId'].trim(), minutes: a['minutes'] },
      };
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
