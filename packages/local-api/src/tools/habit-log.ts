/**
 * HABIT_LOG（打卡记录）实体工具包
 * ================================
 *
 * 读：`list_checkins`；写：`record_checkin`。
 *
 * 🔴 它和 `habit.ts` 是两个实体，不是一个：HABIT 是**定义**（名称、目标、单位、口径），
 * HABIT_LOG 是**某一天做过没有**那条记录。把打卡工具写进 `habit.ts`，
 * "哪个实体被覆盖了"这件事就会在两个地方各说一遍 —— 而 `registry.ts` 会直接拒绝
 * 两个 pack 认领同一个工具名（那是第二份声明的形状，不是风格问题）。
 *
 * ⚠️ 界面上还能**撤销**某一天的打卡（`undoCheckIn`），现在没有工具：
 * 撤销的输入是"哪一天"，而模型对"用户说的是哪天"的错误率远高于对"今天"，
 * 撤销落错的那天又不会报错（那条记录本来就可能存在）。
 * 这是要单独论证的一条，不是漏写 —— 已登记。
 *
 * ⚠️ `HabitLog.note` 那个字段**不出现在读结果里**：`checkIn` 从来不写它，
 * 而把一条永远为空的自由文本放进白名单，等于放一条将来的出境通道。
 */

import { DEFAULT_LIST_LIMIT, clampListLimit, parseCalendarDay } from './shared.js';
import type { McpToolDefinition } from '../mcp.js';
import type { LocalApiHost, ToolReadOutcome, ToolWriteIntentOutcome } from '../server.js';
import type { LocalApiTool } from './shared.js';
import type { EntityToolPack } from './pack.js';

const TOOLS: readonly LocalApiTool[] = [
  {
    name: 'list_checkins',
    egressFields: ['habit_log.habitId', 'habit_log.date', 'habit_log.value'],
    description:
      '列出打卡记录（哪个习惯、哪一天、这一次的数值），按记录写进去的先后排。' +
      '可以只看某一个习惯的。' +
      `默认最多 ${String(DEFAULT_LIST_LIMIT)} 条，筛完才截断。` +
      '注意它列的是记录，不是习惯有哪些：习惯的定义用 list_habits。',
    kind: 'read',
    defaultEnabled: false,
  },
  {
    name: 'record_checkin',
    // 写工具只产出提案、结果不回送模型 ⇒ 出境面是提案里那几个字段（同 TASK / PROJECT 的写工具）。
    egressFields: [],
    description:
      '给一个习惯记一次打卡。不写日期就是今天；不写数值就是该习惯的目标数值' +
      '（没目标就是 1，即"做过一次"）。同一天重复记不会多出第二条。',
    kind: 'write',
    defaultEnabled: false,
  },
];

/** 参数 schema（给模型看的字段清单）。 */
const SCHEMAS: Readonly<Record<string, McpToolDefinition['inputSchema']>> = {
  list_checkins: {
    type: 'object',
    properties: {
      habitId: { type: 'string', description: '只看这一个习惯的打卡记录；省略就是全部习惯。' },
      limit: {
        type: 'number',
        description: `最多返回几条，默认 ${String(DEFAULT_LIST_LIMIT)}。作用在筛完之后的列表上。`,
      },
    },
    additionalProperties: false,
  },
  record_checkin: {
    type: 'object',
    properties: {
      habitId: { type: 'string', description: '打的是哪个习惯。' },
      date: {
        type: 'string',
        description: '哪一天：YYYY-MM-DD（本地日历日）。省略就是今天。',
      },
      value: {
        type: 'number',
        description: '这一次的数量，不小于 0 的有限数（如喝了 3 杯就是 3）。省略就用该习惯的目标数值。',
      },
    },
    required: ['habitId'],
    additionalProperties: false,
  },
};

async function runRead(
  host: LocalApiHost,
  name: string,
  a: Record<string, unknown>,
): Promise<ToolReadOutcome | undefined> {
  switch (name) {
    case 'list_checkins': {
      const raw = a['habitId'];
      if (raw !== undefined && (typeof raw !== 'string' || raw.trim() === '')) {
        // 🔴 空串不当成"全部"：那是 `undefined` 的含义。写成空串的人应该收到错误，
        // 而不是拿到一份"比他要的更大"的数据。
        return { ok: false, kind: 'invalid-args', message: 'list_checkins 的 habitId 要么不给，要么是非空字符串。' };
      }
      const logs = await host.listHabitLogs(
        typeof raw === 'string' ? raw : undefined,
        clampListLimit(a['limit']),
      );
      return { ok: true, payload: logs };
    }

    default:
      return undefined;
  }
}

/**
 * 写分支：参数 → 写入意图。**纯函数，不碰 host，因此不可能改数据。**
 *
 * ⚠️ "这个习惯存不存在""这一天在补录范围内吗"归宿主 —— 本包看不见物化状态。
 * 打卡的**幂等**也不在这里做：`checkIn` 按 `习惯:日期` 组合作标识，同一天重复记只回同一个标识。
 */
function toIntent(name: string, a: Record<string, unknown>): ToolWriteIntentOutcome | undefined {
  switch (name) {
    case 'record_checkin': {
      if (typeof a['habitId'] !== 'string' || a['habitId'].trim() === '') {
        return { ok: false, message: 'record_checkin 需要 habitId。' };
      }
      const intent: {
        action: 'record-checkin';
        habitId: string;
        date?: string;
        value?: number;
      } = { action: 'record-checkin', habitId: a['habitId'] };

      if (a['date'] !== undefined) {
        if (parseCalendarDay(a['date']) === undefined) {
          return { ok: false, message: 'date 应为 YYYY-MM-DD（且是真实存在的一天）。' };
        }
        intent.date = a['date'] as string;
      }

      if (a['value'] !== undefined) {
        const v = a['value'];
        // 下界是 0 而不是 1：与 `create_habit` 的 `target`、界面的 `setHabitGoal` 同口径
        // —— "目标 0 次"在 `atMost` 口径下是合法习惯，打卡值也要能落 0。
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
          return { ok: false, message: 'value 必须是不小于 0 的有限数。' };
        }
        intent.value = v;
      }

      return { ok: true, intent };
    }

    default:
      // 不是 HABIT_LOG 的工具名 —— 交给别的 pack，不是"写失败"。
      return undefined;
  }
}

export const habitLogToolPack: EntityToolPack = {
  entityType: 'HABIT_LOG',
  tools: TOOLS,
  schemas: SCHEMAS,
  runRead,
  toIntent,
};
