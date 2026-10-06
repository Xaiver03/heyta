/**
 * FOCUS_SESSION（专注记录）实体工具包
 * ====================================
 *
 * 读：`list_focuses`；写：`log_focus`。
 *
 * 🔴 写的是**一段已经结束的专注**，不是"开始一个番茄钟"：
 * 计时是一个要等它跑完的动作，而助手没有那 25 分钟 —— 让 AI"开始专注"会产生一个
 * 永远等不到结果的提案，而用户在界面上看到的是一条正在走的计时器。
 * 所以这一档能改的是**记录**，不是**运行中的计时器**；界面上的开始/中止仍然是按出来的。
 *
 * ⚠️ 单位换算：写的一侧用**分钟**，读的一侧用实体本来的**毫秒**（`plannedMs` / `actualMs`）。
 * 那不是不一致，是两件事 —— 读要忠实于落盘的字段名（改名等于造第二个词表），
 * 写要能让模型算对（`45 * 60000` 算错的方向是把 45 分钟记成 45 毫秒，
 * 界面上就是一条长度近乎 0 的记录，而**没有任何一层会报错**）。
 * 换算只发生在 `packages/app-host/src/local-api-host.ts` 的一处。
 */

import { DEFAULT_LIST_LIMIT, clampListLimit } from './shared.js';
import type { McpToolDefinition } from '../mcp.js';
import type { LocalApiHost, ToolReadOutcome, ToolWriteIntentOutcome } from '../server.js';
import type { LocalApiTool } from './shared.js';
import type { EntityToolPack } from './pack.js';

const TOOLS: readonly LocalApiTool[] = [
  {
    name: 'list_focuses',
    egressFields: [
      'focus_session.kind',
      'focus_session.taskId',
      'focus_session.plannedMs',
      'focus_session.actualMs',
      'focus_session.completed',
      'focus_session.startedAt',
    ],
    description:
      '列出专注记录（哪一类、计划多久、实际多久、有没有走完、从哪一刻开始），按记录写进去的先后排。' +
      `默认最多 ${String(DEFAULT_LIST_LIMIT)} 条。时间单位是毫秒，和记录里存的一样。`,
    kind: 'read',
    defaultEnabled: false,
  },
  {
    name: 'log_focus',
    // 写工具只产出提案、结果不回送模型 ⇒ 出境面是提案里那几个字段（同 TASK / PROJECT 的写工具）。
    egressFields: [],
    description:
      '补记一段已经结束的专注：要写它是哪种（工作 / 短休息 / 长休息）、计划多少分钟、实际多少分钟。' +
      '可以挂在一条任务上。开始或中止一个正在走的计时器不是这个工具能做的事。',
    kind: 'write',
    defaultEnabled: false,
  },
];

/** 参数 schema（给模型看的字段清单）。 */
const SCHEMAS: Readonly<Record<string, McpToolDefinition['inputSchema']>> = {
  list_focuses: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: `最多返回几条，默认 ${String(DEFAULT_LIST_LIMIT)}。作用在筛完之后的列表上。`,
      },
    },
    additionalProperties: false,
  },
  log_focus: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        description: '这一段是哪种：work（工作）/ shortBreak（短休息）/ longBreak（长休息）。' +
          '只有这三个取值，写错会被拒绝而不是当成工作。',
      },
      plannedMinutes: {
        type: 'number',
        description: '计划时长，单位分钟，大于 0 的数（25 分钟就是 25）。',
      },
      actualMinutes: {
        type: 'number',
        description: '实际时长，单位分钟，不小于 0。省略表示没记（界面上显示为未填）。',
      },
      taskId: { type: 'string', description: '挂在哪条任务上；省略就是不挂。' },
      completed: {
        type: 'boolean',
        description:
          '这一段有没有走完。省略就是没走完 —— 它**不会**按"实际时长够不够"推算，' +
          '因为中途停掉但坐满了时间的记录在界面上确实存在。',
      },
    },
    required: ['kind', 'plannedMinutes'],
    additionalProperties: false,
  },
};

async function runRead(
  host: LocalApiHost,
  name: string,
  a: Record<string, unknown>,
): Promise<ToolReadOutcome | undefined> {
  switch (name) {
    case 'list_focuses': {
      return { ok: true, payload: await host.listFocusSessions(clampListLimit(a['limit'])) };
    }

    default:
      return undefined;
  }
}

/**
 * 写分支：参数 → 写入意图。**纯函数，不碰 host，因此不可能改数据。**
 *
 * ⚠️ 只做**形状**检查；"是不是那三种之一""毫秒数合不合法"归宿主与领域层
 * （本包零依赖、写不出 `FocusSessionKind` 这个词表，而界面上计时器的形状只有那边知道）。
 */
function toIntent(name: string, a: Record<string, unknown>): ToolWriteIntentOutcome | undefined {
  switch (name) {
    case 'log_focus': {
      if (typeof a['kind'] !== 'string' || a['kind'].trim() === '') {
        return { ok: false, message: 'log_focus 需要 kind（work / shortBreak / longBreak）。' };
      }
      const planned = a['plannedMinutes'];
      if (typeof planned !== 'number' || !Number.isFinite(planned) || planned <= 0) {
        return { ok: false, message: 'plannedMinutes 必须是大于 0 的有限数。' };
      }
      const actual = a['actualMinutes'];
      if (actual !== undefined && (typeof actual !== 'number' || !Number.isFinite(actual) || actual < 0)) {
        return { ok: false, message: 'actualMinutes 如果给了，必须是不小于 0 的有限数。' };
      }
      const taskId = a['taskId'];
      if (taskId !== undefined && (typeof taskId !== 'string' || taskId.trim() === '')) {
        // 🔴 空串不当成"不挂任务"：那是省略的含义。
        return { ok: false, message: 'log_focus 的 taskId 要么不给，要么是一个非空字符串。' };
      }

      return {
        ok: true,
        intent: {
          action: 'log-focus',
          kind: a['kind'],
          plannedMinutes: planned,
          ...(typeof actual === 'number' ? { actualMinutes: actual } : {}),
          ...(typeof taskId === 'string' ? { taskId } : {}),
          ...(typeof a['completed'] === 'boolean' ? { completed: a['completed'] } : {}),
        },
      };
    }

    default:
      // 不是 FOCUS_SESSION 的工具名 —— 交给别的 pack，不是"写失败"。
      return undefined;
  }
}

export const focusToolPack: EntityToolPack = {
  entityType: 'FOCUS_SESSION',
  tools: TOOLS,
  schemas: SCHEMAS,
  runRead,
  toIntent,
};
