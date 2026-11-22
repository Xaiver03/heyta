/**
 * 倒数日 / 纪念日（`EVENT`）的工具包 —— W10 移植进 pack 结构
 * ============================================================
 *
 * 这份文件是 2026-10-03 合流时从批次二的旧结构（schema 住在 `mcp.ts`、
 * 目录住在 `tools.ts`、读写在 `server.ts` 的两个 switch）移植过来的。
 * 行为与判据逐字保留；落点改为“一个实体一个文件”（见 `pack.ts` 文件头）。
 *
 * 与任务那六条**同一套纪律**：默认关、逐条 `egressFields`、
 * 正文只出现在单条读、写只产出提案。
 *
 * 写工具：`create_event`、`update_event`、`delete_event`（删除到回收站）、
 * `restore_event`（从回收站恢复）、`archive_event`（归档）。
 * 🔴 删除 = 软删除（`DEL`→墓碑），可逆、可撤销；`purge`/清空回收站**永不**做成工具（契约 §0）。
 */

import type { McpToolDefinition } from '../mcp.js';
import {
  projectEventListForTool,
  readEventForTool,
  type LocalApiEventItem,
} from '../tools.js';
import type { LocalApiHost, ToolReadOutcome, ToolWriteIntentOutcome } from '../server.js';
import type { EntityToolPack } from './pack.js';
import type { LocalApiTool } from './shared.js';

const TOOLS: readonly LocalApiTool[] = [
  {
    name: 'list_events',
    egressFields: [
      'event.id',
      'event.title',
      'event.date',
      'event.kind',
      'event.nextOccurrence',
      'event.daysFromToday',
      'event.repeating',
      'event.isLunar',
      'event.pinned',
      'event.readable',
    ],
    description:
      '列出倒数日与纪念日（未删除、未归档），按界面同一套顺序排：置顶在前、距下一次近的在前。' +
      '每条给出锚点日期、类型档位、下一次发生日与相差天数。' +
      '不返回备注正文 —— 备注要单独用 get_event 取。归档过的倒数日不在这里。',
    kind: 'read',
    risk: 'read',
    defaultEnabled: false,
  },
  {
    name: 'get_event',
    // 🔴 含备注正文（`LocalApiEventItem.notes`）—— 与 `get_task` 同一档出境面。
    egressFields: [
      'event.id',
      'event.title',
      'event.date',
      'event.kind',
      'event.nextOccurrence',
      'event.daysFromToday',
      'event.repeating',
      'event.isLunar',
      'event.pinned',
      'event.readable',
      'event.notes',
    ],
    description: '读取单个倒数日/纪念日的完整内容（含备注正文）。',
    kind: 'read',
    risk: 'read',
    defaultEnabled: false,
  },
  {
    name: 'create_event',
    // 写工具只产出提案、结果不回送模型 ⇒ 出境面是**提案里那几个字段**（= 空表）。
    egressFields: [],
    description:
      '新建一个倒数日/纪念日。日期是 `YYYY-MM-DD` 的**锚点日期**（倒数日没有“几点”）。' +
      '可给类型档位（countdown / anniversary / birthday / festival 四档之一）、' +
      '是否按农历每年重复、RRULE 重复规则、备注。' +
      '写入只是提案：你在界面上确认之后才会真正保存。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'update_event',
    egressFields: [],
    description:
      '修改倒数日字段（标题、日期、类型档位、农历、重复规则、置顶、备注）。只能改显式给定的字段。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'delete_event',
    // 删除 → 回收站（软删除），可逆、可撤销 ⇒ `destructive-reversible`，不是 purge（契约 §0）。
    egressFields: [],
    description: '把一个倒数日/纪念日删除到回收站。可撤销，不是彻底删除。',
    kind: 'write',
    risk: 'destructive-reversible',
    defaultEnabled: false,
  },
  {
    name: 'restore_event',
    egressFields: [],
    description: '把回收站里的一个倒数日/纪念日恢复回来。它不在回收站会被拒绝。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'archive_event',
    // 归档 = 可逆的破坏性动作：直接执行，靠 op-log 版本回溯兜底（契约 §0 / `ToolRisk`）。
    egressFields: [],
    description: '把一个倒数日/纪念日归档。归档后不再出现在列表里，可再取消归档。',
    kind: 'write',
    risk: 'destructive-reversible',
    defaultEnabled: false,
  },
];

const SCHEMAS: Readonly<Record<string, McpToolDefinition['inputSchema']>> = {
  list_events: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: '最多返回多少条，默认 50。顺序与界面一致（置顶在前、距下一次近的在前）。',
      },
    },
    additionalProperties: false,
  },
  get_event: {
    type: 'object',
    properties: {
      eventId: { type: 'string', description: '倒数日 id（来自 list_events）。' },
    },
    required: ['eventId'],
    additionalProperties: false,
  },
  create_event: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '倒数日标题。' },
      date: {
        type: 'string',
        description: '锚点日期，格式 YYYY-MM-DD。倒数日没有“几点”，不要传时间戳。',
      },
      kind: {
        type: 'string',
        description:
          '类型档位：countdown（还没到的）/ anniversary（已发生的）/ birthday / festival 四档之一。' +
          '不传 = 用户没选过，界面按日期方向显示。App 不替他决定含义。',
      },
      isLunar: {
        type: 'boolean',
        description: 'true = 每年重复时按农历那一天推（默认 false = 公历）。',
      },
      recurrence: {
        type: 'string',
        description: 'RRULE 重复规则，例如 "FREQ=YEARLY;INTERVAL=1"。不传 = 一次性倒数日。',
      },
      notes: { type: 'string', description: '备注（卡片上的那行小字）。' },
    },
    required: ['title', 'date'],
    additionalProperties: false,
  },
  update_event: {
    type: 'object',
    properties: {
      eventId: { type: 'string', description: '要改的倒数日 id。' },
      fields: {
        type: 'object',
        description:
          '要改的字段：title / date / kind / isLunar / recurrence / pinned / notes。' +
          '只改这里给出的字段，其余不动；要把某项清空请显式传 null。',
      },
    },
    required: ['eventId', 'fields'],
    additionalProperties: false,
  },
  delete_event: {
    type: 'object',
    properties: {
      eventId: { type: 'string', description: '要删除（移到回收站）的倒数日 id。' },
    },
    required: ['eventId'],
    additionalProperties: false,
  },
  restore_event: {
    type: 'object',
    properties: {
      eventId: { type: 'string', description: '要恢复的倒数日 id。' },
    },
    required: ['eventId'],
    additionalProperties: false,
  },
  archive_event: {
    type: 'object',
    properties: {
      eventId: { type: 'string', description: '要归档的倒数日 id。' },
    },
    required: ['eventId'],
    additionalProperties: false,
  },
};

async function runRead(
  host: LocalApiHost,
  name: string,
  a: Record<string, unknown>,
): Promise<ToolReadOutcome | undefined> {
  switch (name) {
    case 'list_events': {
      const items = await host.listEvents({
        ...(typeof a['limit'] === 'number' ? { limit: a['limit'] } : {}),
      });
      // 🔴 列表里备注一律不出（与 `list_tasks` 同一刀）。
      return { ok: true, payload: projectEventListForTool(items) };
    }
    case 'get_event': {
      if (typeof a['eventId'] !== 'string') {
        return { ok: false, kind: 'invalid-args', message: 'get_event 需要 eventId。' };
      }
      const item = await host.getEvent(a['eventId']);
      // ⚠️ 找不到时**不是错误**，而是带 `error` 字段的正常结果 —— 与 `get_task` 同一形状
      // （`tool-egress-fields` 的 `{error}` 信封声明就是为它写的）。
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
      return undefined;
  }
}

function toIntent(name: string, a: Record<string, unknown>): ToolWriteIntentOutcome | undefined {
  switch (name) {
    case 'create_event': {
      // ⚠️ 这里只做**形状**检查。“这个日期是不是真实存在的一天”“这个 kind 在不在
      // 封闭词表里”由**宿主**判（`packages/domain` 的 `eventRejection` 是唯一归属）。
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
    case 'delete_event': {
      const unknown = Object.keys(a).filter((key) => key !== 'eventId');
      if (unknown.length > 0) {
        return { ok: false, message: `delete_event 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['eventId'] !== 'string' || a['eventId'].trim() === '') {
        return { ok: false, message: 'delete_event 需要 eventId。' };
      }
      return { ok: true, intent: { action: 'delete-event', eventId: a['eventId'] } };
    }
    case 'restore_event': {
      const unknown = Object.keys(a).filter((key) => key !== 'eventId');
      if (unknown.length > 0) {
        return { ok: false, message: `restore_event 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['eventId'] !== 'string' || a['eventId'].trim() === '') {
        return { ok: false, message: 'restore_event 需要 eventId。' };
      }
      return { ok: true, intent: { action: 'restore-event', eventId: a['eventId'] } };
    }
    case 'archive_event': {
      const unknown = Object.keys(a).filter((key) => key !== 'eventId');
      if (unknown.length > 0) {
        return { ok: false, message: `archive_event 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['eventId'] !== 'string' || a['eventId'].trim() === '') {
        return { ok: false, message: 'archive_event 需要 eventId。' };
      }
      return { ok: true, intent: { action: 'archive-event', eventId: a['eventId'] } };
    }
    default:
      return undefined;
  }
}

export const eventToolPack: EntityToolPack = {
  entityType: 'EVENT',
  tools: TOOLS,
  schemas: SCHEMAS,
  runRead,
  toIntent,
};
