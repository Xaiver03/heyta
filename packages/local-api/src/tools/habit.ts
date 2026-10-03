/**
 * HABIT（习惯）实体工具包
 * =========================
 *
 * 读：`list_habits`（列习惯**定义**，不含打卡记录）；写：`create_habit`（新建习惯）。
 * 与 `task.ts` / `project.ts` 同形状：目录条目 + 参数 schema + 读分支 + 写分支
 * 全在这一个文件里。
 *
 * 🔴 为什么打卡（`HABIT_LOG`）的工具不在这里：它是**另一个实体**，认领它的工具要
 * 另开一个 pack —— `registry.ts` 会拒绝"两个 pack 认领同一个工具名"，而按名字判定
 * 实体时 `checkin` / `habit_log` 都归 `HABIT_LOG`
 * （见 `scripts/gen-ai-capability-manifest.mjs` 的 `ENTITY_NOUNS`）。
 * 把打卡工具写进这个文件会让"哪个实体被覆盖了"这件事在两个地方各说一遍。
 *
 * ⚠️ 界面上还能改目标（`setHabitGoal`）、换颜色/图标、归档与删除习惯，这四个动作
 * 现在**没有工具**：目录有一条容量判据（`tests/local-api.spec.ts` 的
 * `LOCAL_API_TOOLS.length <= 10`）。要补就先重新拍那条上限。
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
