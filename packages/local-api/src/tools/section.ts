/**
 * SECTION（清单内分组）实体工具包
 * =================================
 *
 * 读：`list_sections`（某条清单下的分组 + 组内任务数）。
 * 写：`create_section` / `rename_section` / `reorder_section` /
 *     `set_task_section` / `delete_section`。
 *
 * 全部落在这里 —— 目录条目、给模型看的参数 schema、读分支、写分支**一处不落**。
 * 语义（排序、悬空归未分组、标题上限）归 `@heyta/domain` 的 `sections.ts`
 * 与 `packages/app-host/src/section-actions.ts`；本包零依赖，只做**形状**检查，
 * 存在性 / 归属由宿主（`local-api-host.ts`）翻成用户看得懂的话。
 *
 * 🔴 删除 = 软删除（`DEL` → 墓碑），可逆；**不级联删任务**。任务归组是
 * 改任务的 `sectionId`（`set_task_section`），不是删分组。
 */

import type { McpToolDefinition } from '../mcp.js';
import type { LocalApiHost, ToolReadOutcome, ToolWriteIntentOutcome } from '../server.js';
import type { LocalApiTool } from './shared.js';
import type { EntityToolPack } from './pack.js';

const ROW_FIELDS = [
  'section.id',
  'section.projectId',
  'section.name',
  'section.order',
  'section.taskCount',
] as const;

const TOOLS: readonly LocalApiTool[] = [
  {
    name: 'list_sections',
    egressFields: ROW_FIELDS,
    description:
      '列出一条清单下的分组（标识、所属清单、名称、排序键、组内任务数），按分组顺序。' +
      '本宿主没有分组读取能力时，会明确告诉你读不到，而不是给一个空列表。',
    kind: 'read',
    risk: 'read',
    defaultEnabled: false,
  },
  {
    name: 'create_section',
    egressFields: [],
    description:
      '在一条已有的清单下新建一个分组（清单内二级分块）。名称不能为空；' +
      '清单不存在会被拒绝。分组只是容器，不会移动任何任务。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'rename_section',
    egressFields: [],
    description: '给一个分组改名。名称不能为空，也不能只有空格。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'reorder_section',
    egressFields: [],
    description: '调整一个分组在清单内的顺序：写入它的排序键（非负整数）。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'set_task_section',
    egressFields: [],
    description:
      '把一条任务移进某个分组，或移出分组（省略 sectionId = 未分组）。' +
      '分组必须与任务属于同一条清单，否则会被拒绝。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'delete_section',
    egressFields: [],
    description: '删除一个分组（软删除，可恢复）。其下任务**不会**被删除，会显示在未分组里。',
    kind: 'write',
    risk: 'destructive-reversible',
    defaultEnabled: false,
  },
];

const SCHEMAS: Readonly<Record<string, McpToolDefinition['inputSchema']>> = {
  list_sections: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: '要读哪条清单下的分组。' },
    },
    required: ['projectId'],
    additionalProperties: false,
  },
  create_section: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: '在哪个清单下建分组。' },
      name: { type: 'string', description: '分组名称，不能是空白。' },
    },
    required: ['projectId', 'name'],
    additionalProperties: false,
  },
  rename_section: {
    type: 'object',
    properties: {
      sectionId: { type: 'string', description: '要改名的分组标识。' },
      name: { type: 'string', description: '新的分组名称，不能是空白。' },
    },
    required: ['sectionId', 'name'],
    additionalProperties: false,
  },
  reorder_section: {
    type: 'object',
    properties: {
      sectionId: { type: 'string', description: '要调序的分组标识。' },
      order: { type: 'number', description: '新的排序键，非负整数（小的在前）。' },
    },
    required: ['sectionId', 'order'],
    additionalProperties: false,
  },
  set_task_section: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要移动的任务标识。' },
      sectionId: { type: 'string', description: '移到哪个分组；省略就是移出到未分组。' },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  delete_section: {
    type: 'object',
    properties: {
      sectionId: { type: 'string', description: '要删除（软删）的分组标识。' },
    },
    required: ['sectionId'],
    additionalProperties: false,
  },
};

/** 非空字符串检查（id 类参数）。 */
function nonEmptyId(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  return raw;
}

async function runRead(
  host: LocalApiHost,
  name: string,
  a: Record<string, unknown>,
): Promise<ToolReadOutcome | undefined> {
  switch (name) {
    case 'list_sections': {
      const projectId = nonEmptyId(a['projectId']);
      if (projectId === undefined) {
        return { ok: false, kind: 'invalid-args', message: 'list_sections 需要 projectId。' };
      }
      if (host.listSections === undefined) {
        return {
          ok: false,
          kind: 'invalid-args',
          message: '当前宿主没有分组读取能力',
        };
      }
      const rows = await host.listSections(projectId);
      // 白名单重建（同 `note.ts` 的纪律）：出境只在声明过的那几格。
      const projected = rows.map((row) => ({
        id: row.id,
        projectId: row.projectId,
        name: row.name,
        ...(row.order === undefined ? {} : { order: row.order }),
        taskCount: row.taskCount,
      }));
      return { ok: true, payload: projected };
    }
    default:
      return undefined;
  }
}

function toIntent(name: string, a: Record<string, unknown>): ToolWriteIntentOutcome | undefined {
  switch (name) {
    case 'create_section': {
      const unknown = Object.keys(a).filter((key) => key !== 'projectId' && key !== 'name');
      if (unknown.length > 0) {
        return { ok: false, message: `create_section 不支持这些参数：${unknown.join('、')}。` };
      }
      const projectId = nonEmptyId(a['projectId']);
      if (projectId === undefined) return { ok: false, message: 'create_section 需要 projectId。' };
      if (typeof a['name'] !== 'string' || a['name'].trim() === '') {
        return { ok: false, message: 'create_section 需要 name（不能是空白）。' };
      }
      return { ok: true, intent: { action: 'create-section', projectId, name: a['name'] } };
    }
    case 'rename_section': {
      const unknown = Object.keys(a).filter((key) => key !== 'sectionId' && key !== 'name');
      if (unknown.length > 0) {
        return { ok: false, message: `rename_section 不支持这些参数：${unknown.join('、')}。` };
      }
      const sectionId = nonEmptyId(a['sectionId']);
      if (sectionId === undefined) return { ok: false, message: 'rename_section 需要 sectionId。' };
      if (typeof a['name'] !== 'string' || a['name'].trim() === '') {
        return { ok: false, message: 'rename_section 需要 name（不能是空白）。' };
      }
      return { ok: true, intent: { action: 'rename-section', sectionId, name: a['name'] } };
    }
    case 'reorder_section': {
      const unknown = Object.keys(a).filter((key) => key !== 'sectionId' && key !== 'order');
      if (unknown.length > 0) {
        return { ok: false, message: `reorder_section 不支持这些参数：${unknown.join('、')}。` };
      }
      const sectionId = nonEmptyId(a['sectionId']);
      if (sectionId === undefined) return { ok: false, message: 'reorder_section 需要 sectionId。' };
      const order = a['order'];
      if (typeof order !== 'number' || !Number.isInteger(order) || order < 0) {
        return { ok: false, message: 'reorder_section 的 order 必须是非负整数。' };
      }
      return { ok: true, intent: { action: 'reorder-section', sectionId, order } };
    }
    case 'set_task_section': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskId' && key !== 'sectionId');
      if (unknown.length > 0) {
        return { ok: false, message: `set_task_section 不支持这些参数：${unknown.join('、')}。` };
      }
      const taskId = nonEmptyId(a['taskId']);
      if (taskId === undefined) return { ok: false, message: 'set_task_section 需要 taskId。' };
      if ('sectionId' in a) {
        const sectionId = nonEmptyId(a['sectionId']);
        if (sectionId === undefined) {
          return { ok: false, message: 'set_task_section 的 sectionId 必须是非空字符串（移出到未分组请省略它）。' };
        }
        return { ok: true, intent: { action: 'set-task-section', taskId, sectionId } };
      }
      return { ok: true, intent: { action: 'set-task-section', taskId } };
    }
    case 'delete_section': {
      const unknown = Object.keys(a).filter((key) => key !== 'sectionId');
      if (unknown.length > 0) {
        return { ok: false, message: `delete_section 不支持这些参数：${unknown.join('、')}。` };
      }
      const sectionId = nonEmptyId(a['sectionId']);
      if (sectionId === undefined) return { ok: false, message: 'delete_section 需要 sectionId。' };
      return { ok: true, intent: { action: 'delete-section', sectionId } };
    }
    default:
      return undefined;
  }
}

export const sectionToolPack: EntityToolPack = {
  entityType: 'SECTION',
  tools: TOOLS,
  schemas: SCHEMAS,
  runRead,
  toIntent,
};
