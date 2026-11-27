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
    risk: 'read',
    defaultEnabled: false,
  },
  {
    name: 'get_task',
    // 🔴 含正文（`LocalApiItem.body`）—— 这是目录里**出境面最大**的一个工具，
    // 披露必须把它单独说出来：多步循环会把这份正文回送给模型。
    egressFields: ['task.id', 'task.title', 'task.dueDate', 'task.priority', 'task.completed', 'task.readable', 'task.body', 'task.checklist'],
    description: '读取单个任务的完整内容（含备注正文）。',
    kind: 'read',
    risk: 'read',
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
    risk: 'read',
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
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'update_task',
    egressFields: [],
    description: '修改任务字段（标题、截止日期、优先级）。只能改显式给定的字段。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'append_task_checklist',
    egressFields: [],
    description: '把一组未完成清单追加到任务备注末尾，保留已有备注。一次最多 20 条。',
    kind: 'write',
    risk: 'write',
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
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'set_task_priorities',
    egressFields: [],
    description: `一次给多条任务设置优先级。每条都要给 taskId 与 priority（none / low / medium / high），最多 ${String(MAX_TASKS_PER_BATCH_PRIORITY)} 条。`,
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'set_task_estimate',
    egressFields: [],
    description: '设置任务的预计耗时（整数分钟，5–480；超出范围会夹到边界）。这项改动必须确认。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'trash_task',
    egressFields: [],
    description: '把任务移进回收站（软删除，之后可用 restore_task 恢复）。参数：taskId（要删除的任务 id）。',
    kind: 'write',
    risk: 'destructive-reversible',
    defaultEnabled: false,
  },
  {
    name: 'restore_task',
    egressFields: [],
    description: '把回收站里的任务恢复到原处。参数：taskId（要恢复的任务 id）。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'abandon_task',
    egressFields: [],
    description: '放弃任务（第五状态 abandonedAt，可逆，之后可用 unabandon_task 取消放弃）。参数：taskId（要放弃的任务 id）。',
    kind: 'write',
    risk: 'destructive-reversible',
    defaultEnabled: false,
  },
  {
    name: 'unabandon_task',
    egressFields: [],
    description: '取消放弃（把 abandonedAt 清掉，任务回到进行中）。参数：taskId。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'move_task',
    egressFields: [],
    description:
      '把任务移到另一个清单。参数：taskId（要移动的任务 id）、projectId（目标清单 id；省略表示移出清单、不归属任何清单）。',
    kind: 'write',
    risk: 'destructive-reversible',
    defaultEnabled: false,
  },
  {
    name: 'uncomplete_task',
    egressFields: [],
    description: '把已完成的任务标记回未完成。参数：taskId（要改回未完成的任务 id）。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'set_task_parent',
    egressFields: [],
    description:
      '把任务挂到另一个父任务下，建立层级。参数：taskId（要移动的任务 id）、parentId' +
      '（新的父任务 id；省略表示提为顶级、不挂在任何任务下）。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'trash_tasks',
    egressFields: [],
    description:
      '把多条任务一次性移进回收站（软删除，之后可用 restore_tasks 恢复）。' +
      '参数：taskIds（要删除的任务 id 列表，至少一条）。',
    kind: 'write',
    risk: 'destructive-reversible',
    defaultEnabled: false,
  },
  {
    name: 'restore_tasks',
    egressFields: [],
    description: '把回收站里的多条任务一次性恢复到原处。参数：taskIds（要恢复的任务 id 列表，至少一条）。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'reorder_task',
    egressFields: [],
    description: '调整任务在清单里的排序位置。参数：taskId（要排序的任务 id）、order（排序序号，有限数字）。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'create_subtask',
    // 写工具只产出提案、结果不回送模型 ⇒ 出境面是**提案里那几个字段**。
    egressFields: [],
    description: '在某个父任务下新建子任务。参数：parentId（父任务 id）、title（子任务标题，不能是空白）。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'set_task_note',
    egressFields: [],
    description: '设置任务的备注。参数：taskId（任务 id）、note（备注正文；省略表示清除备注）。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'set_task_repeat',
    egressFields: [],
    description:
      '设置任务的重复规则。参数：taskId（任务 id）、rule（重复规则字符串，原样交给动作层校验；省略表示清除重复）。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'set_task_important',
    egressFields: [],
    description: '把任务标记为重要或取消重要。参数：taskId（任务 id）、important（布尔值，true 标记重要、false 取消）。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'set_task_pinned',
    egressFields: [],
    description: '把任务置顶或取消置顶。参数：taskId（任务 id）、pinned（布尔值，true 置顶、false 取消）。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'move_tasks',
    egressFields: [],
    description:
      '把多条任务一次性移到另一个清单。参数：taskIds（要移动的任务 id 列表，至少一条）、' +
      'projectId（目标清单 id；省略表示移出清单、不归属任何清单）。',
    kind: 'write',
    risk: 'destructive-reversible',
    defaultEnabled: false,
  },
  {
    name: 'skip_task_occurrence',
    egressFields: [],
    description: '跳过重复任务的「这一次」（把当前到期日推进到下一次）。只对有重复规则的任务有效。参数：taskId。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'set_task_repeat_after_completion',
    egressFields: [],
    description: '设置重复任务是「按截止日顺延」还是「按完成日顺延」。参数：taskId、on（true=完成后顺延，false=按截止日）。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'set_task_quadrant',
    egressFields: [],
    description:
      '把任务一键放进四象限的某一格（1=重要且紧急 2=重要不紧急 3=紧急不重要 4=不重要不紧急）。' +
      '内部翻译成对「重要」与「截止日」两个字段的写入（象限是派生视图，不是独立字段）。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'postpone_task_to_today',
    egressFields: [],
    description:
      '把一条任务「推迟到今天」：把已过去的截止日顺延到今天同一时刻。已完成、或已今天到期的任务不做改变。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'set_task_checklist',
    egressFields: [],
    description:
      '整组设置任务的结构化子项清单（checklist）。items 是 [{text, done?}]；覆盖式（不在列表里的旧子项会被删除）。' +
      '空数组 = 清空。全勾时正常任务的父任务会自动完成。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'toggle_checklist_item',
    egressFields: [],
    description:
      '勾选 / 取消任务里某一条结构化子项（按文本匹配）。子项必须是结构化清单(先用 set_task_checklist 建立)；' +
      '文本需唯一，重名会拒绝。全勾时正常任务的父任务会自动完成。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'set_checklist_item_reminder',
    egressFields: [],
    description:
      '给任务里某一条结构化子项（检查项）单独设 / 清一个提醒时刻。按文本唯一匹配该子项；' +
      '设置用 date（YYYY-MM-DD）+ time（HH:MM）给绝对时刻，清除用 clear=true（二者二选一）。' +
      '这是**检查项级**提醒，与整条任务的提醒（create_reminder）是两回事。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'set_task_assignee',
    egressFields: [],
    description:
      '设置或清除任务的指派人。参数：taskId（任务 id）、assigneeUserId（指派成员的 id；省略或空串表示清除指派）。' +
      '仅在共享清单内有意义；个人任务缺席即未指派。',
    kind: 'write',
    risk: 'write',
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
  trash_task: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要移进回收站的任务 id。' },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  restore_task: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要从回收站恢复的任务 id。' },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  abandon_task: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要归档的任务 id。' },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  unabandon_task: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要取消放弃的任务 id。' },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  move_task: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要移动的任务 id。' },
      projectId: {
        type: 'string',
        description: '目标清单 id；省略表示移出清单、不归属任何清单。',
      },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  uncomplete_task: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要改回未完成的任务 id。' },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  set_task_parent: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要移动的任务 id。' },
      parentId: {
        type: 'string',
        description: '新的父任务 id；省略表示提为顶级、不挂在任何任务下。',
      },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  trash_tasks: {
    type: 'object',
    properties: {
      taskIds: {
        type: 'array',
        items: { type: 'string' },
        description: '要移进回收站的任务 id 列表，至少一条。',
      },
    },
    required: ['taskIds'],
    additionalProperties: false,
  },
  restore_tasks: {
    type: 'object',
    properties: {
      taskIds: {
        type: 'array',
        items: { type: 'string' },
        description: '要从回收站恢复的任务 id 列表，至少一条。',
      },
    },
    required: ['taskIds'],
    additionalProperties: false,
  },
  reorder_task: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要排序的任务 id。' },
      order: { type: 'number', description: '排序序号，有限数字。' },
    },
    required: ['taskId', 'order'],
    additionalProperties: false,
  },
  create_subtask: {
    type: 'object',
    properties: {
      parentId: { type: 'string', description: '父任务 id。' },
      title: { type: 'string', description: '子任务标题，不能是空白。' },
    },
    required: ['parentId', 'title'],
    additionalProperties: false,
  },
  set_task_note: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要设置备注的任务 id。' },
      note: { type: 'string', description: '备注正文；省略表示清除备注。' },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  set_task_repeat: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要设置重复规则的任务 id。' },
      rule: { type: 'string', description: '重复规则字符串，原样交给动作层校验；省略表示清除重复。' },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  set_task_important: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要标记的任务 id。' },
      important: { type: 'boolean', description: 'true 标记为重要，false 取消重要。' },
    },
    required: ['taskId', 'important'],
    additionalProperties: false,
  },
  set_task_pinned: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要置顶的任务 id。' },
      pinned: { type: 'boolean', description: 'true 置顶，false 取消置顶。' },
    },
    required: ['taskId', 'pinned'],
    additionalProperties: false,
  },
  move_tasks: {
    type: 'object',
    properties: {
      taskIds: {
        type: 'array',
        items: { type: 'string' },
        description: '要移动的任务 id 列表，至少一条。',
      },
      projectId: {
        type: 'string',
        description: '目标清单 id；省略表示移出清单、不归属任何清单。',
      },
    },
    required: ['taskIds'],
    additionalProperties: false,
  },
  skip_task_occurrence: {
    type: 'object',
    properties: { taskId: { type: 'string', description: '要跳过这一次的重复任务 id。' } },
    required: ['taskId'],
    additionalProperties: false,
  },
  set_task_repeat_after_completion: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '重复任务 id。' },
      on: { type: 'boolean', description: 'true=完成后顺延（按完成日）；false=按截止日顺延。' },
    },
    required: ['taskId', 'on'],
    additionalProperties: false,
  },
  set_task_quadrant: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要放进象限的任务 id。' },
      quadrant: {
        type: 'number',
        description: '象限编号：1 重要且紧急 / 2 重要不紧急 / 3 紧急不重要 / 4 不重要不紧急。',
      },
    },
    required: ['taskId', 'quadrant'],
    additionalProperties: false,
  },
  postpone_task_to_today: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要推迟到今天的任务 id。' },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  set_task_checklist: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要设置子项的任务 id。' },
      items: {
        type: 'array',
        description: '子项列表（覆盖式；空数组=清空）。每项 {text, done?, id?}。',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '子项文本，非空。' },
            done: { type: 'boolean', description: '是否已勾选，默认 false。' },
            id: { type: 'string', description: '可选：保留已有子项 id；省略则新建。' },
          },
          required: ['text'],
          additionalProperties: false,
        },
      },
    },
    required: ['taskId', 'items'],
    additionalProperties: false,
  },
  toggle_checklist_item: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '任务 id。' },
      itemText: { type: 'string', description: '要勾选/取消的子项文本（需唯一）。' },
      done: { type: 'boolean', description: 'true=勾选，false=取消。' },
    },
    required: ['taskId', 'itemText', 'done'],
    additionalProperties: false,
  },
  set_checklist_item_reminder: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '任务 id。' },
      itemText: { type: 'string', description: '要设/清提醒的检查项文本（需唯一）。' },
      date: {
        type: 'string',
        description: '提醒的哪一天：YYYY-MM-DD（本地日历日）。必须和 time 一起给，与 clear 互斥。',
      },
      time: {
        type: 'string',
        description: '提醒的几点：HH:MM，24 小时制且补零。必须和 date 一起给。',
      },
      clear: {
        type: 'boolean',
        description: 'true = 清除这条检查项的提醒（与 date / time 互斥）。',
      },
    },
    required: ['taskId', 'itemText'],
    additionalProperties: false,
  },
  set_task_assignee: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要指派的任务 id。' },
      assigneeUserId: {
        type: 'string',
        description: '指派给这个成员 id；省略或空串表示清除指派（个人任务缺席 = 未指派）。',
      },
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

    case 'trash_task': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskId');
      if (unknown.length > 0) {
        return { ok: false, message: `trash_task 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['taskId'] !== 'string' || a['taskId'].trim() === '') {
        return { ok: false, message: 'trash_task 需要 taskId。' };
      }
      return { ok: true, intent: { action: 'trash-task', taskId: a['taskId'].trim() } };
    }

    case 'restore_task': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskId');
      if (unknown.length > 0) {
        return { ok: false, message: `restore_task 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['taskId'] !== 'string' || a['taskId'].trim() === '') {
        return { ok: false, message: 'restore_task 需要 taskId。' };
      }
      return { ok: true, intent: { action: 'restore-task', taskId: a['taskId'].trim() } };
    }

    case 'abandon_task': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskId');
      if (unknown.length > 0) {
        return { ok: false, message: `abandon_task 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['taskId'] !== 'string' || a['taskId'].trim() === '') {
        return { ok: false, message: 'abandon_task 需要 taskId。' };
      }
      return { ok: true, intent: { action: 'abandon-task', taskId: a['taskId'].trim() } };
    }

    case 'unabandon_task': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskId');
      if (unknown.length > 0) {
        return { ok: false, message: `unabandon_task 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['taskId'] !== 'string' || a['taskId'].trim() === '') {
        return { ok: false, message: 'unabandon_task 需要 taskId。' };
      }
      return { ok: true, intent: { action: 'unabandon-task', taskId: a['taskId'].trim() } };
    }

    case 'move_task': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskId' && key !== 'projectId');
      if (unknown.length > 0) {
        return { ok: false, message: `move_task 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['taskId'] !== 'string' || a['taskId'].trim() === '') {
        return { ok: false, message: 'move_task 需要 taskId。' };
      }
      if ('projectId' in a && (typeof a['projectId'] !== 'string' || a['projectId'].trim() === '')) {
        return { ok: false, message: 'move_task 的 projectId 必须是字符串；要移出清单请省略它。' };
      }
      const projectId = typeof a['projectId'] === 'string' ? a['projectId'].trim() : undefined;
      return {
        ok: true,
        intent: {
          action: 'move-task',
          taskId: a['taskId'].trim(),
          ...(projectId === undefined ? {} : { projectId }),
        },
      };
    }

    case 'uncomplete_task': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskId');
      if (unknown.length > 0) {
        return { ok: false, message: `uncomplete_task 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['taskId'] !== 'string' || a['taskId'].trim() === '') {
        return { ok: false, message: 'uncomplete_task 需要 taskId。' };
      }
      return { ok: true, intent: { action: 'uncomplete-task', taskId: a['taskId'].trim() } };
    }

    case 'set_task_parent': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskId' && key !== 'parentId');
      if (unknown.length > 0) {
        return { ok: false, message: `set_task_parent 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['taskId'] !== 'string' || a['taskId'].trim() === '') {
        return { ok: false, message: 'set_task_parent 需要 taskId。' };
      }
      // parentId 省略 = 提为顶级（intent 不带该键）；给了就必须是非空字符串。
      if ('parentId' in a && (typeof a['parentId'] !== 'string' || a['parentId'].trim() === '')) {
        return {
          ok: false,
          message: 'set_task_parent 的 parentId 必须是非空字符串；要提为顶级请省略它。',
        };
      }
      const parentId = typeof a['parentId'] === 'string' ? a['parentId'].trim() : undefined;
      return {
        ok: true,
        intent: {
          action: 'set-task-parent',
          taskId: a['taskId'].trim(),
          ...(parentId === undefined ? {} : { parentId }),
        },
      };
    }

    case 'trash_tasks': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskIds');
      if (unknown.length > 0) {
        return { ok: false, message: `trash_tasks 不支持这些参数：${unknown.join('、')}。` };
      }
      const raw = a['taskIds'];
      if (!Array.isArray(raw) || raw.length === 0) {
        return { ok: false, message: 'trash_tasks 需要至少一条 taskIds。' };
      }
      const ids: string[] = [];
      for (const entry of raw) {
        if (typeof entry !== 'string' || entry.trim() === '') {
          return { ok: false, message: 'trash_tasks 的 taskIds 必须全是非空字符串。' };
        }
        ids.push(entry.trim());
      }
      return { ok: true, intent: { action: 'trash-tasks', taskIds: [...new Set(ids)] } };
    }

    case 'restore_tasks': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskIds');
      if (unknown.length > 0) {
        return { ok: false, message: `restore_tasks 不支持这些参数：${unknown.join('、')}。` };
      }
      const raw = a['taskIds'];
      if (!Array.isArray(raw) || raw.length === 0) {
        return { ok: false, message: 'restore_tasks 需要至少一条 taskIds。' };
      }
      const ids: string[] = [];
      for (const entry of raw) {
        if (typeof entry !== 'string' || entry.trim() === '') {
          return { ok: false, message: 'restore_tasks 的 taskIds 必须全是非空字符串。' };
        }
        ids.push(entry.trim());
      }
      return { ok: true, intent: { action: 'restore-tasks', taskIds: [...new Set(ids)] } };
    }

    case 'reorder_task': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskId' && key !== 'order');
      if (unknown.length > 0) {
        return { ok: false, message: `reorder_task 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['taskId'] !== 'string' || a['taskId'].trim() === '') {
        return { ok: false, message: 'reorder_task 需要 taskId。' };
      }
      if (typeof a['order'] !== 'number' || !Number.isFinite(a['order'])) {
        return { ok: false, message: 'reorder_task 的 order 必须是有限数字。' };
      }
      return {
        ok: true,
        intent: { action: 'reorder-task', taskId: a['taskId'].trim(), order: a['order'] },
      };
    }

    case 'create_subtask': {
      const unknown = Object.keys(a).filter((key) => key !== 'parentId' && key !== 'title');
      if (unknown.length > 0) {
        return { ok: false, message: `create_subtask 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['parentId'] !== 'string' || a['parentId'].trim() === '') {
        return { ok: false, message: 'create_subtask 需要 parentId。' };
      }
      if (typeof a['title'] !== 'string' || a['title'].trim() === '') {
        return { ok: false, message: 'create_subtask 需要 title（不能是空白）。' };
      }
      return {
        ok: true,
        intent: { action: 'create-subtask', parentId: a['parentId'].trim(), title: a['title'] },
      };
    }

    case 'set_task_note': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskId' && key !== 'note');
      if (unknown.length > 0) {
        return { ok: false, message: `set_task_note 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['taskId'] !== 'string' || a['taskId'].trim() === '') {
        return { ok: false, message: 'set_task_note 需要 taskId。' };
      }
      // note 省略 = 清除备注（intent 不带该键）；给了就必须是字符串（空串也算给了）。
      if ('note' in a && typeof a['note'] !== 'string') {
        return { ok: false, message: 'set_task_note 的 note 必须是字符串；要清除备注请省略它。' };
      }
      return {
        ok: true,
        intent: {
          action: 'set-task-note',
          taskId: a['taskId'].trim(),
          ...(typeof a['note'] === 'string' ? { note: a['note'] } : {}),
        },
      };
    }

    case 'set_task_repeat': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskId' && key !== 'rule');
      if (unknown.length > 0) {
        return { ok: false, message: `set_task_repeat 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['taskId'] !== 'string' || a['taskId'].trim() === '') {
        return { ok: false, message: 'set_task_repeat 需要 taskId。' };
      }
      // rule 省略 = 清除重复（intent 不带该键）；给了就原样传，合法性由动作层判。
      if ('rule' in a && typeof a['rule'] !== 'string') {
        return { ok: false, message: 'set_task_repeat 的 rule 必须是字符串；要清除重复请省略它。' };
      }
      return {
        ok: true,
        intent: {
          action: 'set-task-repeat',
          taskId: a['taskId'].trim(),
          ...(typeof a['rule'] === 'string' ? { rule: a['rule'] } : {}),
        },
      };
    }

    case 'set_task_important': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskId' && key !== 'important');
      if (unknown.length > 0) {
        return { ok: false, message: `set_task_important 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['taskId'] !== 'string' || a['taskId'].trim() === '') {
        return { ok: false, message: 'set_task_important 需要 taskId。' };
      }
      if (typeof a['important'] !== 'boolean') {
        return { ok: false, message: 'set_task_important 的 important 必须是布尔值。' };
      }
      return {
        ok: true,
        intent: {
          action: 'set-task-important',
          taskId: a['taskId'].trim(),
          important: a['important'],
        },
      };
    }

    case 'set_task_pinned': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskId' && key !== 'pinned');
      if (unknown.length > 0) {
        return { ok: false, message: `set_task_pinned 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['taskId'] !== 'string' || a['taskId'].trim() === '') {
        return { ok: false, message: 'set_task_pinned 需要 taskId。' };
      }
      if (typeof a['pinned'] !== 'boolean') {
        return { ok: false, message: 'set_task_pinned 的 pinned 必须是布尔值。' };
      }
      return {
        ok: true,
        intent: {
          action: 'set-task-pinned',
          taskId: a['taskId'].trim(),
          pinned: a['pinned'],
        },
      };
    }

    case 'move_tasks': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskIds' && key !== 'projectId');
      if (unknown.length > 0) {
        return { ok: false, message: `move_tasks 不支持这些参数：${unknown.join('、')}。` };
      }
      const raw = a['taskIds'];
      if (!Array.isArray(raw) || raw.length === 0) {
        return { ok: false, message: 'move_tasks 需要至少一条 taskIds。' };
      }
      const ids: string[] = [];
      for (const entry of raw) {
        if (typeof entry !== 'string' || entry.trim() === '') {
          return { ok: false, message: 'move_tasks 的 taskIds 必须全是非空字符串。' };
        }
        ids.push(entry.trim());
      }
      if ('projectId' in a && (typeof a['projectId'] !== 'string' || a['projectId'].trim() === '')) {
        return { ok: false, message: 'move_tasks 的 projectId 必须是非空字符串；要移出清单请省略它。' };
      }
      const projectId = typeof a['projectId'] === 'string' ? a['projectId'].trim() : undefined;
      return {
        ok: true,
        intent: {
          action: 'move-tasks',
          taskIds: [...new Set(ids)],
          ...(projectId === undefined ? {} : { projectId }),
        },
      };
    }

    case 'skip_task_occurrence': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskId');
      if (unknown.length > 0) {
        return { ok: false, message: `skip_task_occurrence 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['taskId'] !== 'string' || a['taskId'].trim() === '') {
        return { ok: false, message: 'skip_task_occurrence 需要 taskId。' };
      }
      return { ok: true, intent: { action: 'skip-task-occurrence', taskId: a['taskId'].trim() } };
    }

    case 'set_task_repeat_after_completion': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskId' && key !== 'on');
      if (unknown.length > 0) {
        return { ok: false, message: `set_task_repeat_after_completion 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['taskId'] !== 'string' || a['taskId'].trim() === '') {
        return { ok: false, message: 'set_task_repeat_after_completion 需要 taskId。' };
      }
      if (typeof a['on'] !== 'boolean') {
        return { ok: false, message: 'set_task_repeat_after_completion 的 on 必须是布尔。' };
      }
      return {
        ok: true,
        intent: { action: 'set-task-repeat-after-completion', taskId: a['taskId'].trim(), on: a['on'] },
      };
    }

    case 'set_task_quadrant': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskId' && key !== 'quadrant');
      if (unknown.length > 0) {
        return { ok: false, message: `set_task_quadrant 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['taskId'] !== 'string' || a['taskId'].trim() === '') {
        return { ok: false, message: 'set_task_quadrant 需要 taskId。' };
      }
      const q = a['quadrant'];
      if (typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > 4) {
        return { ok: false, message: 'set_task_quadrant 的 quadrant 必须是 1–4 的整数。' };
      }
      return {
        ok: true,
        intent: { action: 'set-task-quadrant', taskId: a['taskId'].trim(), quadrant: q },
      };
    }

    case 'postpone_task_to_today': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskId');
      if (unknown.length > 0) {
        return { ok: false, message: `postpone_task_to_today 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['taskId'] !== 'string' || a['taskId'].trim() === '') {
        return { ok: false, message: 'postpone_task_to_today 需要 taskId。' };
      }
      return {
        ok: true,
        intent: { action: 'postpone-task-to-today', taskId: a['taskId'].trim() },
      };
    }

    case 'set_task_checklist': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskId' && key !== 'items');
      if (unknown.length > 0) {
        return { ok: false, message: `set_task_checklist 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['taskId'] !== 'string' || a['taskId'].trim() === '') {
        return { ok: false, message: 'set_task_checklist 需要 taskId。' };
      }
      if (!Array.isArray(a['items'])) {
        return { ok: false, message: 'set_task_checklist 的 items 必须是数组。' };
      }
      const items: { id?: string; text: string; done?: boolean }[] = [];
      for (const raw of a['items']) {
        if (typeof raw !== 'object' || raw === null) {
          return { ok: false, message: 'set_task_checklist 的每个子项必须是对象。' };
        }
        const it = raw as Record<string, unknown>;
        const extra = Object.keys(it).filter((k) => k !== 'id' && k !== 'text' && k !== 'done');
        if (extra.length > 0) {
          return { ok: false, message: `set_task_checklist 子项不支持这些字段：${extra.join('、')}。` };
        }
        if (typeof it['text'] !== 'string' || it['text'].trim() === '') {
          return { ok: false, message: 'set_task_checklist 每个子项的 text 必须是非空字符串。' };
        }
        if (it['done'] !== undefined && typeof it['done'] !== 'boolean') {
          return { ok: false, message: 'set_task_checklist 子项的 done 必须是布尔值。' };
        }
        if (it['id'] !== undefined && (typeof it['id'] !== 'string' || it['id'] === '')) {
          return { ok: false, message: 'set_task_checklist 子项的 id 必须是非空字符串。' };
        }
        items.push({
          ...(typeof it['id'] === 'string' ? { id: it['id'] } : {}),
          text: it['text'],
          ...(typeof it['done'] === 'boolean' ? { done: it['done'] } : {}),
        });
      }
      return {
        ok: true,
        intent: { action: 'set-task-checklist', taskId: a['taskId'].trim(), items },
      };
    }

    case 'toggle_checklist_item': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskId' && key !== 'itemText' && key !== 'done');
      if (unknown.length > 0) {
        return { ok: false, message: `toggle_checklist_item 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['taskId'] !== 'string' || a['taskId'].trim() === '') {
        return { ok: false, message: 'toggle_checklist_item 需要 taskId。' };
      }
      if (typeof a['itemText'] !== 'string' || a['itemText'].trim() === '') {
        return { ok: false, message: 'toggle_checklist_item 需要 itemText（非空）。' };
      }
      if (typeof a['done'] !== 'boolean') {
        return { ok: false, message: 'toggle_checklist_item 的 done 必须是布尔值。' };
      }
      return {
        ok: true,
        intent: {
          action: 'toggle-checklist-item',
          taskId: a['taskId'].trim(),
          itemText: a['itemText'],
          done: a['done'],
        },
      };
    }

    case 'set_checklist_item_reminder': {
      const unknown = Object.keys(a).filter(
        (key) => key !== 'taskId' && key !== 'itemText' && key !== 'date' && key !== 'time' && key !== 'clear',
      );
      if (unknown.length > 0) {
        return { ok: false, message: `set_checklist_item_reminder 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['taskId'] !== 'string' || a['taskId'].trim() === '') {
        return { ok: false, message: 'set_checklist_item_reminder 需要 taskId。' };
      }
      if (typeof a['itemText'] !== 'string' || a['itemText'].trim() === '') {
        return { ok: false, message: 'set_checklist_item_reminder 需要 itemText（非空）。' };
      }
      const taskId = a['taskId'].trim();
      const itemText = a['itemText'];
      const hasDate = a['date'] !== undefined;
      const hasTime = a['time'] !== undefined;
      const wantsClear = a['clear'] === true;
      if (a['clear'] !== undefined && typeof a['clear'] !== 'boolean') {
        return { ok: false, message: 'set_checklist_item_reminder 的 clear 必须是布尔值。' };
      }
      if (wantsClear && (hasDate || hasTime)) {
        return { ok: false, message: 'clear=true（清除）与 date / time（设置）只能二选一。' };
      }
      if (wantsClear) {
        return { ok: true, intent: { action: 'set-checklist-item-reminder', taskId, itemText, clear: true } };
      }
      if (!hasDate && !hasTime) {
        return {
          ok: false,
          message: 'set_checklist_item_reminder 要说清做什么：给 date + time 设提醒，或 clear=true 清除。',
        };
      }
      if (hasDate && typeof a['date'] !== 'string') {
        return { ok: false, message: 'date 应为 YYYY-MM-DD 字符串。' };
      }
      if (hasTime && typeof a['time'] !== 'string') {
        return { ok: false, message: 'time 应为 HH:MM 字符串。' };
      }
      if (!hasDate || !hasTime) {
        return { ok: false, message: 'date 与 time 必须一起给 —— 只给一个就定不下一刻。' };
      }
      return {
        ok: true,
        intent: {
          action: 'set-checklist-item-reminder',
          taskId,
          itemText,
          date: a['date'] as string,
          time: a['time'] as string,
        },
      };
    }

    case 'set_task_assignee': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskId' && key !== 'assigneeUserId');
      if (unknown.length > 0) {
        return { ok: false, message: `set_task_assignee 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['taskId'] !== 'string' || a['taskId'].trim() === '') {
        return { ok: false, message: 'set_task_assignee 需要 taskId。' };
      }
      if ('assigneeUserId' in a && typeof a['assigneeUserId'] !== 'string') {
        return { ok: false, message: 'set_task_assignee 的 assigneeUserId 必须是字符串（空串表示清除）。' };
      }
      // 空串/全空白/缺省 = 清除（intent 不带该键，宿主归一成 `null`）。
      const raw = typeof a['assigneeUserId'] === 'string' ? a['assigneeUserId'].trim() : '';
      const taskId = a['taskId'].trim();
      return {
        ok: true,
        intent: raw === ''
          ? { action: 'set-task-assignee', taskId }
          : { action: 'set-task-assignee', taskId, assigneeUserId: raw },
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
