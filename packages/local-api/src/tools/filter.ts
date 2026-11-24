/**
 * FILTER（自定义保存筛选 / 智能清单）实体工具包
 * =============================================
 *
 * 读：`list_filters`（目录 + 规则）；写：`create_filter`、`update_filter_rule`、
 * `rename_filter`、`delete_filter`。
 *
 * 🔴 **为什么规则在工具层按不透明 JSON 透传**：规则的结构（判别联合）与语义只由
 * `@heyta/domain/src/filter-rule.ts` 解释 —— 写侧 `filterRuleRejection`、读侧
 * `compileFilterRule`。本包零运行时依赖，看不见领域类型；在这里再写一份 `kind` 白名单
 * 就是第二份判据，而它漂了以后的症状是"AI 建出来的筛选在界面上打不开且不报错"。
 * 所以本层只检查"是个对象"，**结构合法性交给动作层**（它会把拒绝翻成一句人话、零 op）。
 *
 * 🔴 **未知 kind 的降级不在本层**：那是读侧 `compileFilterRule` 的职责（老客户端读到
 * 更新的版本写的规则）。工具只是老实把规则原样交出去。
 *
 * ⚠️ 规则里的 `keyword` 是用户写的自由文本（会出现在 `list_filters` 的返回里）——
 * 所以 `rule` 整格必须写进 `egressFields`（出境逐字段披露，隐私不变量第四条）。
 */

import type { McpToolDefinition } from '../mcp.js';
import type { LocalApiHost, ToolReadOutcome, ToolWriteIntentOutcome } from '../server.js';
import type { LocalApiTool } from './shared.js';
import type { EntityToolPack } from './pack.js';

const ROW_FIELDS = ['filter.id', 'filter.name', 'filter.rule', 'filter.color', 'filter.order'] as const;

const TOOLS: readonly LocalApiTool[] = [
  {
    name: 'list_filters',
    egressFields: ROW_FIELDS,
    description:
      '列出用户保存的筛选（智能清单）：标识、名字、规则、色槽、排序。顺序与界面上一样。',
    kind: 'read',
    risk: 'read',
    defaultEnabled: false,
  },
  {
    name: 'create_filter',
    // 写工具只产出提案、结果不回送模型 ⇒ 出境面是提案里那几个字段。
    egressFields: [],
    description:
      '新建一条保存筛选（智能清单）。名字不能为空；规则必须是结构化对象（match: all|any + conditions 数组）。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'update_filter_rule',
    egressFields: [],
    description: '改写一条已有保存筛选的规则（整条替换，不是追加）。规则结构不合法会被拒绝。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'rename_filter',
    egressFields: [],
    description: '给一条保存筛选改名。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'delete_filter',
    // 软删除 → 回收站，可逆、可撤销 ⇒ destructive-reversible（不是 purge）。
    egressFields: [],
    description: '把一条保存筛选删除到回收站。可撤销，不是彻底删除。',
    kind: 'write',
    risk: 'destructive-reversible',
    defaultEnabled: false,
  },
];

const SCHEMAS: Readonly<Record<string, McpToolDefinition['inputSchema']>> = {
  list_filters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  create_filter: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '这条筛选的名字（用户会看到，不能为空）。' },
      rule: {
        type: 'object',
        description:
          '结构化规则：{ match: "all" | "any", conditions: [...] }。' +
          'conditions 的 kind 取 all / today / tomorrow / next7Days / project / tag / priority / due / status / keyword。',
      },
    },
    required: ['name', 'rule'],
    additionalProperties: false,
  },
  update_filter_rule: {
    type: 'object',
    properties: {
      filterId: { type: 'string', description: '要改哪一条筛选。' },
      rule: { type: 'object', description: '新的规则（整条替换）。' },
    },
    required: ['filterId', 'rule'],
    additionalProperties: false,
  },
  rename_filter: {
    type: 'object',
    properties: {
      filterId: { type: 'string', description: '要改名的筛选。' },
      name: { type: 'string', description: '新的名字。' },
    },
    required: ['filterId', 'name'],
    additionalProperties: false,
  },
  delete_filter: {
    type: 'object',
    properties: {
      filterId: { type: 'string', description: '要删除（移到回收站）的筛选。' },
    },
    required: ['filterId'],
    additionalProperties: false,
  },
};

async function runRead(
  host: LocalApiHost,
  name: string,
  _a: Record<string, unknown>,
): Promise<ToolReadOutcome | undefined> {
  if (name !== 'list_filters') return undefined;
  const rows = await host.listFilters();
  // 白名单重建（同 `listNotes` 的纪律）：将来给行里挂一个字段也不会跟着出境。
  const projected = rows.map((row) => ({
    id: row.id,
    name: row.name,
    rule: row.rule,
    ...(row.color === undefined ? {} : { color: row.color }),
    ...(row.order === undefined ? {} : { order: row.order }),
  }));
  return { ok: true, payload: projected };
}

function asRule(raw: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined;
}

function toIntent(name: string, a: Record<string, unknown>): ToolWriteIntentOutcome | undefined {
  switch (name) {
    case 'create_filter': {
      if (typeof a['name'] !== 'string' || a['name'].trim() === '') {
        return { ok: false, message: 'create_filter 需要非空的 name。' };
      }
      const rule = asRule(a['rule']);
      if (rule === undefined) {
        return { ok: false, message: 'create_filter 的 rule 必须是一个对象。' };
      }
      return { ok: true, intent: { action: 'create-filter', name: a['name'], rule } };
    }

    case 'update_filter_rule': {
      if (typeof a['filterId'] !== 'string' || a['filterId'].trim() === '') {
        return { ok: false, message: 'update_filter_rule 需要 filterId。' };
      }
      const rule = asRule(a['rule']);
      if (rule === undefined) {
        return { ok: false, message: 'update_filter_rule 的 rule 必须是一个对象。' };
      }
      return { ok: true, intent: { action: 'update-filter-rule', filterId: a['filterId'], rule } };
    }

    case 'rename_filter': {
      if (typeof a['filterId'] !== 'string' || a['filterId'].trim() === '') {
        return { ok: false, message: 'rename_filter 需要 filterId。' };
      }
      if (typeof a['name'] !== 'string' || a['name'].trim() === '') {
        return { ok: false, message: 'rename_filter 需要非空的 name。' };
      }
      return { ok: true, intent: { action: 'rename-filter', filterId: a['filterId'], name: a['name'] } };
    }

    case 'delete_filter': {
      const unknown = Object.keys(a).filter((key) => key !== 'filterId');
      if (unknown.length > 0) {
        return { ok: false, message: `delete_filter 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['filterId'] !== 'string' || a['filterId'].trim() === '') {
        return { ok: false, message: 'delete_filter 需要 filterId。' };
      }
      return { ok: true, intent: { action: 'delete-filter', filterId: a['filterId'] } };
    }

    default:
      return undefined;
  }
}

export const filterToolPack: EntityToolPack = {
  entityType: 'FILTER',
  tools: TOOLS,
  schemas: SCHEMAS,
  runRead,
  toIntent,
};
