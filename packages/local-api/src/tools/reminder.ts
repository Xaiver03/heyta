/**
 * REMINDER（提醒）实体工具包
 * ===========================
 *
 * 读：`list_reminders`；写：`create_reminder`。
 *
 * 🔴 这个 pack 是"本包不产生时刻"这条纪律最难落的一个：提醒的本质是一个未来时刻，
 * 而 `Reminder.triggerAt` 是 epoch ms —— 让工具自己拼毫秒，就意味着"这一天这一分钟
 * 在本机是哪个时刻"在两处各算一遍（`packages/domain/src/date.ts` 与这里的偏移量），
 * 而算错的方向是**整整一天**（UTC+8 晚上 8 点后"今天"变成"明天"）。
 * 所以这里传的是 `YYYY-MM-DD` + `HH:MM`，换算只在宿主那一处。
 *
 * ⚠️ 两种形态**二选一**：绝对时刻（date + time）或"比截止早 N 分钟"（minutesBeforeDue）。
 * 后者不是糖：重复任务的截止日每次顺延，只有"提前 30 分"这种写法能在下一次顺延后仍然指对，
 * 而绝对时刻会留在旧的那一天上 —— 领域层为这件事专门留了 `offsetMs`。
 *
 * ⚠️ 界面上还能顺延（snooze）、改时刻、删除、忽略一条提醒，现在都没有工具：
 * 顺延的输入是"顺延多久"而模型对时间跨度最容易算错，改/删一条已有提醒要先让用户看清是哪一条 ——
 * 这些要单独论证，不是漏写。
 */

import { parseCalendarDay, parseTimeOfDay } from './shared.js';
import type { McpToolDefinition } from '../mcp.js';
import type { LocalApiHost, ToolReadOutcome, ToolWriteIntentOutcome } from '../server.js';
import type { LocalApiTool } from './shared.js';
import type { EntityToolPack } from './pack.js';

const TOOLS: readonly LocalApiTool[] = [
  {
    name: 'list_reminders',
    egressFields: ['reminder.id', 'reminder.taskId', 'reminder.triggerAt', 'reminder.phase'],
    description:
      '列出提醒（哪条任务、哪一刻、现在走到哪一步：还没到 / 已顺延 / 该响了 / 已响过 / 已忽略），' +
      '按提醒时刻从早到晚。可以只看某一条任务的。' +
      '时刻是机器时间，界面上显示的是本地日期时间。',
    kind: 'read',
    defaultEnabled: false,
  },
  {
    name: 'create_reminder',
    // 写工具只产出提案、结果不回送模型 ⇒ 出境面是提案里那几个字段（同 TASK / PROJECT 的写工具）。
    egressFields: [],
    description:
      '给一条任务加一条提醒。要么给绝对时刻（date + time，两者一起给），' +
      '要么给"比截止时间早多少分钟"（minutesBeforeDue，此时任务必须有截止时间）。两种形态互斥。' +
      '时刻不能在过去、也不能远于一年；一条任务超过界面上限会被拒绝而不是截着收下。',
    kind: 'write',
    defaultEnabled: false,
  },
];

/** 参数 schema（给模型看的字段清单）。 */
const SCHEMAS: Readonly<Record<string, McpToolDefinition['inputSchema']>> = {
  list_reminders: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '只看这一条任务的提醒；省略就是全部。' },
    },
    additionalProperties: false,
  },
  create_reminder: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '提醒哪一条任务。' },
      date: {
        type: 'string',
        description: '哪一天：YYYY-MM-DD（本地日历日）。必须和 time 一起给，与 minutesBeforeDue 互斥。',
      },
      time: {
        type: 'string',
        description: '几点：HH:MM，24 小时制且补零（下午两点一刻是 14:15）。必须和 date 一起给。',
      },
      minutesBeforeDue: {
        type: 'number',
        description:
          '比任务的截止时间早多少分钟（不小于 0 的有限数，0 就是"到点提醒"）。' +
          '与 date / time 互斥，且任务必须有截止时间。',
      },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
};

async function runRead(
  host: LocalApiHost,
  name: string,
  a: Record<string, unknown>,
): Promise<ToolReadOutcome | undefined> {
  switch (name) {
    case 'list_reminders': {
      const raw = a['taskId'];
      if (raw !== undefined && (typeof raw !== 'string' || raw.trim() === '')) {
        // 🔴 空串不当成"全部"：那会把用户没要的所有提醒一起送出去。
        return {
          ok: false,
          kind: 'invalid-args',
          message: 'list_reminders 的 taskId 要么不给，要么是非空字符串。',
        };
      }
      return { ok: true, payload: await host.listReminders(typeof raw === 'string' ? raw : undefined) };
    }

    default:
      return undefined;
  }
}

/**
 * 写分支：参数 → 写入意图。**纯函数，不碰 host，因此不可能改数据。**
 *
 * ⚠️ "过去/太远""这条任务有没有截止""超过不超过上限"都归宿主与领域层 ——
 * 那三件事需要知道**现在几点**和物化状态，本包两样都没有。
 */
function toIntent(name: string, a: Record<string, unknown>): ToolWriteIntentOutcome | undefined {
  switch (name) {
    case 'create_reminder': {
      if (typeof a['taskId'] !== 'string' || a['taskId'].trim() === '') {
        return { ok: false, message: 'create_reminder 需要 taskId。' };
      }
      const hasDate = a['date'] !== undefined;
      const hasTime = a['time'] !== undefined;
      const hasOffset = a['minutesBeforeDue'] !== undefined;

      if ((hasDate || hasTime) && hasOffset) {
        return {
          ok: false,
          message: '绝对时刻（date + time）与"提前多少分钟"（minutesBeforeDue）只能二选一。',
        };
      }
      if (!hasDate && !hasTime && !hasOffset) {
        // 🔴 不是"那就用默认"：一条没有时间锚点的提醒没法落地，
        // 而猜一个（"那就一小时前"）会当场变成一条已经过期的提醒。
        return {
          ok: false,
          message: 'create_reminder 要说清什么时候提醒：给 date + time，或者给 minutesBeforeDue。',
        };
      }

      if (hasDate || hasTime) {
        // 先逐个验**给出来的**那一个，再验成对：否则"date 拼对、time 没给"
        // 会被报成"要一起给"，把人指向错的地方（同 `readListTasksDueArgs` 的次序理由）。
        if (hasDate && parseCalendarDay(a['date']) === undefined) {
          return { ok: false, message: 'date 应为 YYYY-MM-DD（且是真实存在的一天）。' };
        }
        if (hasTime && parseTimeOfDay(a['time']) === undefined) {
          return { ok: false, message: 'time 应为 HH:MM（24 小时制、补零）。' };
        }
        if (!hasDate || !hasTime) {
          return { ok: false, message: 'date 与 time 必须一起给 —— 只给一个就定不下一刻。' };
        }
        return {
          ok: true,
          intent: {
            action: 'create-reminder',
            taskId: a['taskId'],
            date: a['date'] as string,
            time: a['time'] as string,
          },
        };
      }

      const minutes = a['minutesBeforeDue'];
      if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0) {
        return { ok: false, message: 'minutesBeforeDue 必须是不小于 0 的有限数。' };
      }
      return { ok: true, intent: { action: 'create-reminder', taskId: a['taskId'], minutesBeforeDue: minutes } };
    }

    default:
      // 不是 REMINDER 的工具名 —— 交给别的 pack，不是"写失败"。
      return undefined;
  }
}

export const reminderToolPack: EntityToolPack = {
  entityType: 'REMINDER',
  tools: TOOLS,
  schemas: SCHEMAS,
  runRead,
  toIntent,
};
