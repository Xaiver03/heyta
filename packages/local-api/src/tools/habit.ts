/**
 * HABIT（习惯）实体工具包
 * =========================
 *
 * 读：`list_habits`（列习惯**定义**，不含打卡记录）；写：`create_habit`（新建习惯）、
 * `rename_habit`（改名）、`delete_habit`（移入回收站）、`restore_habit`（从回收站恢复）。
 * 与 `task.ts` / `project.ts` 同形状：目录条目 + 参数 schema + 读分支 + 写分支
 * 全在这一个文件里。
 *
 * 🔴 为什么打卡（`HABIT_LOG`）的工具不在这里：它是**另一个实体**，认领它的工具要
 * 另开一个 pack —— `registry.ts` 会拒绝"两个 pack 认领同一个工具名"，而按名字判定
 * 实体时 `checkin` / `habit_log` 都归 `HABIT_LOG`
 * （见 `scripts/gen-ai-capability-manifest.mjs` 的 `ENTITY_NOUNS`）。
 * 把打卡工具写进这个文件会让"哪个实体被覆盖了"这件事在两个地方各说一遍。
 *
 * 🔴 2026-11-23（批6）补齐了改目标 / 颜色 / 图标 / 频率：`set_habit_goal`、
 * `set_habit_color`、`set_habit_icon`、`set_habit_frequency`。颜色/图标的**产品口径**：
 * AI 只在用户**明确点名**某个色号/图标时执行、不主动替用户选（见
 * `docs/plans/ai-event-tool-contract.md` §5.4，已按此更新）。HABIT 现用 9 席。
 */

import type { McpToolDefinition } from '../mcp.js';
import type { LocalApiHost, ToolReadOutcome, ToolWriteIntentOutcome } from '../server.js';
import type { LocalApiTool } from './shared.js';
import type { EntityToolPack } from './pack.js';

const TOOLS: readonly LocalApiTool[] = [
  {
    name: 'list_habits',
    egressFields: ['habit.id', 'habit.name', 'habit.target', 'habit.unit', 'habit.goalType'],
    description:
      '列出习惯及其打卡目标（目标数值、单位、达成口径）。' +
      '只列习惯的定义，不列每天的打卡记录。',
    kind: 'read',
    risk: 'read',
    defaultEnabled: false,
  },
  {
    name: 'create_habit',
    // 写工具只产出提案、结果不回送模型 ⇒ 出境面是**提案里那几个字段**（同 TASK / PROJECT 的写工具）。
    egressFields: [],
    description:
      '新建一个习惯。可指定每天的目标数值、单位与达成口径（至少 / 至多 / 恰好）。' +
      '不传目标就是"每天做过一次"。名称不能为空。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'rename_habit',
    // 写工具只产出提案、结果不回送模型 ⇒ 出境面是**提案里那几个字段**（同 `create_habit`）。
    egressFields: [],
    description: '给一个习惯改名。名称不能为空，也不能只有空格。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'delete_habit',
    // 删除 → 回收站（软删除），可逆、可撤销 ⇒ `destructive-reversible`，不是 purge。
    egressFields: [],
    description: '把一个习惯删除到回收站。可撤销，不是彻底删除；之后可用 restore_habit 恢复。',
    kind: 'write',
    risk: 'destructive-reversible',
    defaultEnabled: false,
  },
  {
    name: 'restore_habit',
    // 从回收站恢复只翻墓碑、不销毁数据 ⇒ `write`。
    egressFields: [],
    description: '把回收站里的习惯恢复到原处。习惯不存在或不在回收站会被拒绝。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'set_habit_color',
    egressFields: [],
    description:
      '给一个习惯设置颜色槽位（1–8），或清除颜色。' +
      '🔴 仅在用户明确要求某个颜色时调用；不要自行替用户决定习惯该是什么颜色。省略 color = 清除颜色。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'set_habit_icon',
    egressFields: [],
    description:
      '给一个习惯指定图标（闭集里的 key，如 drop / book / moon / sun），或清除回到默认图标。' +
      '🔴 仅在用户明确要求某个图标时调用；不要自行替用户选图标。省略 icon = 清除。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'set_habit_goal',
    egressFields: [],
    description:
      '改一个习惯的目标：目标数值 target、单位 unit、达成口径 goalType（atLeast / atMost / exactly），三者都可单独改。' +
      '至少给一个字段；unit 传空串表示清除单位。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'set_habit_frequency',
    egressFields: [],
    description:
      '改一个习惯的重复频率。frequency 是结构对象：{type:"daily"} / {type:"weekly",daysOfWeek:[1-7]} / ' +
      '{type:"interval",everyNDays:N} / {type:"spaced",offsets:[...],anchor:"YYYY-MM-DD"}。省略 = 退回每天。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
];

/** 参数 schema（给模型看的字段清单）。 */
const SCHEMAS: Readonly<Record<string, McpToolDefinition['inputSchema']>> = {
  list_habits: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  create_habit: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '习惯名称，不能是空白。' },
      target: {
        type: 'number',
        description: '每天的目标数值，不小于 0 的数（如 8 杯水就是 8）。省略就是 1（做过一次即达成）。',
      },
      unit: {
        type: 'string',
        description: '目标单位，如「杯」「页」「分钟」。与 target 配套；省略就没有单位。',
      },
      goalType: {
        type: 'string',
        description:
          '达成口径：atLeast（至少，默认）/ atMost（至多，如"今天一次都不碰"）/ exactly（恰好）。' +
          '只有这三个取值，写错会被拒绝而不是当成默认值。',
      },
    },
    required: ['name'],
    additionalProperties: false,
  },
  rename_habit: {
    type: 'object',
    properties: {
      habitId: { type: 'string', description: '要改名的习惯 id。' },
      name: { type: 'string', description: '新的习惯名称，不能是空白。' },
    },
    required: ['habitId', 'name'],
    additionalProperties: false,
  },
  delete_habit: {
    type: 'object',
    properties: {
      habitId: { type: 'string', description: '要删除到回收站的习惯 id。' },
    },
    required: ['habitId'],
    additionalProperties: false,
  },
  restore_habit: {
    type: 'object',
    properties: {
      habitId: { type: 'string', description: '要从回收站恢复的习惯 id。' },
    },
    required: ['habitId'],
    additionalProperties: false,
  },
  set_habit_color: {
    type: 'object',
    properties: {
      habitId: { type: 'string', description: '要设色的习惯 id。' },
      color: { type: 'number', description: '颜色槽位 1–8 的整数；省略表示清除颜色。' },
    },
    required: ['habitId'],
    additionalProperties: false,
  },
  set_habit_icon: {
    type: 'object',
    properties: {
      habitId: { type: 'string', description: '要设图标的习惯 id。' },
      icon: { type: 'string', description: '图标 key（闭集）；省略表示清除。' },
    },
    required: ['habitId'],
    additionalProperties: false,
  },
  set_habit_goal: {
    type: 'object',
    properties: {
      habitId: { type: 'string', description: '要改目标的习惯 id。' },
      target: { type: 'number', description: '新的目标数值，不小于 0 的有限数。' },
      unit: { type: 'string', description: '新的单位；空串表示清除单位。' },
      goalType: { type: 'string', description: '达成口径：atLeast / atMost / exactly。' },
    },
    required: ['habitId'],
    additionalProperties: false,
  },
  set_habit_frequency: {
    type: 'object',
    properties: {
      habitId: { type: 'string', description: '要改频率的习惯 id。' },
      frequency: {
        type: 'object',
        description: '频率对象；省略表示退回每天。type 取值 daily / weekly / interval / spaced。',
        additionalProperties: true,
      },
    },
    required: ['habitId'],
    additionalProperties: false,
  },
};

/**
 * 读分支。
 *
 * 🔴 这里**不需要** `projectListForTool` 那类投影：习惯名不是敏感正文
 * （与 `list_projects` 同一条判断，理由写在 `server.ts` 的 `LocalApiHabit` 上）。
 * 白名单在**宿主侧**的 `habitToItem` 里做（只搬四个字段），所以这个分支
 * 原样回宿主给的东西不会多带字段。
 */
async function runRead(
  host: LocalApiHost,
  name: string,
  _a: Record<string, unknown>,
): Promise<ToolReadOutcome | undefined> {
  switch (name) {
    case 'list_habits': {
      return { ok: true, payload: await host.listHabits() };
    }

    default:
      return undefined;
  }
}

/**
 * 写分支：参数 → 写入意图。**纯函数，不碰 host，因此不可能改数据。**
 *
 * ⚠️ 只做**形状**检查；"达成口径是不是那三个之一""目标数值合不合法"归宿主
 * （它才知道 `HabitGoalType` 的词表，而本包零依赖、不能 import domain）。
 */
function toIntent(name: string, a: Record<string, unknown>): ToolWriteIntentOutcome | undefined {
  switch (name) {
    case 'create_habit': {
      // 空白名在这里就拒（同 `create_task` / `create_project`）。
      if (typeof a['name'] !== 'string' || a['name'].trim() === '') {
        return { ok: false, message: 'create_habit 需要 name。' };
      }
      return {
        ok: true,
        intent: {
          action: 'create-habit',
          name: a['name'],
          ...(typeof a['target'] === 'number' ? { target: a['target'] } : {}),
          ...(typeof a['unit'] === 'string' ? { unit: a['unit'] } : {}),
          ...(typeof a['goalType'] === 'string' ? { goalType: a['goalType'] } : {}),
        },
      };
    }

    case 'rename_habit': {
      const unknown = Object.keys(a).filter((key) => key !== 'habitId' && key !== 'name');
      if (unknown.length > 0) {
        return { ok: false, message: `rename_habit 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['habitId'] !== 'string' || a['habitId'].trim() === '') {
        return { ok: false, message: 'rename_habit 需要 habitId。' };
      }
      if (typeof a['name'] !== 'string' || a['name'].trim() === '') {
        return { ok: false, message: 'rename_habit 需要 name（不能是空白）。' };
      }
      return {
        ok: true,
        intent: { action: 'rename-habit', habitId: a['habitId'], name: a['name'] },
      };
    }

    case 'delete_habit': {
      const unknown = Object.keys(a).filter((key) => key !== 'habitId');
      if (unknown.length > 0) {
        return { ok: false, message: `delete_habit 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['habitId'] !== 'string' || a['habitId'].trim() === '') {
        return { ok: false, message: 'delete_habit 需要 habitId。' };
      }
      return { ok: true, intent: { action: 'delete-habit', habitId: a['habitId'] } };
    }

    case 'restore_habit': {
      const unknown = Object.keys(a).filter((key) => key !== 'habitId');
      if (unknown.length > 0) {
        return { ok: false, message: `restore_habit 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['habitId'] !== 'string' || a['habitId'].trim() === '') {
        return { ok: false, message: 'restore_habit 需要 habitId。' };
      }
      return { ok: true, intent: { action: 'restore-habit', habitId: a['habitId'] } };
    }

    case 'set_habit_color': {
      const unknown = Object.keys(a).filter((key) => key !== 'habitId' && key !== 'color');
      if (unknown.length > 0) {
        return { ok: false, message: `set_habit_color 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['habitId'] !== 'string' || a['habitId'].trim() === '') {
        return { ok: false, message: 'set_habit_color 需要 habitId。' };
      }
      const color = a['color'];
      if (color !== undefined && (typeof color !== 'number' || !Number.isInteger(color) || color < 1 || color > 8)) {
        return { ok: false, message: 'set_habit_color 的 color 必须是 1–8 的整数；要清除颜色请省略它。' };
      }
      return {
        ok: true,
        intent: {
          action: 'set-habit-color',
          habitId: a['habitId'],
          ...(typeof color === 'number' ? { color } : {}),
        },
      };
    }

    case 'set_habit_icon': {
      const unknown = Object.keys(a).filter((key) => key !== 'habitId' && key !== 'icon');
      if (unknown.length > 0) {
        return { ok: false, message: `set_habit_icon 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['habitId'] !== 'string' || a['habitId'].trim() === '') {
        return { ok: false, message: 'set_habit_icon 需要 habitId。' };
      }
      if (a['icon'] !== undefined && (typeof a['icon'] !== 'string' || a['icon'].trim() === '')) {
        return { ok: false, message: 'set_habit_icon 的 icon 必须是非空字符串（要清除请省略）。' };
      }
      return {
        ok: true,
        intent: {
          action: 'set-habit-icon',
          habitId: a['habitId'],
          ...(typeof a['icon'] === 'string' ? { icon: a['icon'] } : {}),
        },
      };
    }

    case 'set_habit_goal': {
      const unknown = Object.keys(a).filter(
        (key) => key !== 'habitId' && key !== 'target' && key !== 'unit' && key !== 'goalType',
      );
      if (unknown.length > 0) {
        return { ok: false, message: `set_habit_goal 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['habitId'] !== 'string' || a['habitId'].trim() === '') {
        return { ok: false, message: 'set_habit_goal 需要 habitId。' };
      }
      if (a['target'] === undefined && a['unit'] === undefined && a['goalType'] === undefined) {
        return { ok: false, message: 'set_habit_goal 至少要给 target / unit / goalType 之一。' };
      }
      if (a['target'] !== undefined && typeof a['target'] !== 'number') {
        return { ok: false, message: 'set_habit_goal 的 target 必须是数字。' };
      }
      if (a['unit'] !== undefined && typeof a['unit'] !== 'string') {
        return { ok: false, message: 'set_habit_goal 的 unit 必须是字符串。' };
      }
      if (a['goalType'] !== undefined && typeof a['goalType'] !== 'string') {
        return { ok: false, message: 'set_habit_goal 的 goalType 必须是字符串。' };
      }
      return {
        ok: true,
        intent: {
          action: 'set-habit-goal',
          habitId: a['habitId'],
          ...(typeof a['target'] === 'number' ? { target: a['target'] } : {}),
          ...(typeof a['unit'] === 'string' ? { unit: a['unit'] } : {}),
          ...(typeof a['goalType'] === 'string' ? { goalType: a['goalType'] } : {}),
        },
      };
    }

    case 'set_habit_frequency': {
      const unknown = Object.keys(a).filter((key) => key !== 'habitId' && key !== 'frequency');
      if (unknown.length > 0) {
        return { ok: false, message: `set_habit_frequency 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['habitId'] !== 'string' || a['habitId'].trim() === '') {
        return { ok: false, message: 'set_habit_frequency 需要 habitId。' };
      }
      const freq = a['frequency'];
      if (freq !== undefined && (typeof freq !== 'object' || freq === null || Array.isArray(freq))) {
        return { ok: false, message: 'set_habit_frequency 的 frequency 必须是对象（省略表示退回每天）。' };
      }
      return {
        ok: true,
        intent: {
          action: 'set-habit-frequency',
          habitId: a['habitId'],
          ...(freq !== undefined ? { frequency: freq as Record<string, unknown> } : {}),
        },
      };
    }

    default:
      // 不是 HABIT 的工具名 —— 交给别的 pack，不是"写失败"。
      return undefined;
  }
}

export const habitToolPack: EntityToolPack = {
  entityType: 'HABIT',
  tools: TOOLS,
  schemas: SCHEMAS,
  runRead,
  toIntent,
};
