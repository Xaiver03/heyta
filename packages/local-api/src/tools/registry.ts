/**
 * 工具目录的**聚合处**
 * =====================
 *
 * `LOCAL_API_TOOLS` 现在是从 pack 生成的，不再是手抄的清单。这个文件是那条
 * "加一个工具要改五处" 里唯一还需要存在的中枢 —— 而且它只做聚合与查找，
 * 不含任何产品语义（产品语义在各 `tools/<entity>.ts` 里）。
 *
 * 🔴 注册不齐在这里就**炸**，不等用户点 AI：
 * 两个 pack 认领同一个工具名、或某个 pack 给**不是自己的**工具登记了参数 schema，
 * 都在模块求值时抛错。理由与 AGENTS.md §3.5 同一条：**"抽出了共享实现"不等于
 * "重复被消除了"** —— 如果两处能写同一个工具名，第一份重复就从这里长出来。
 */

import type { McpToolDefinition } from '../mcp.js';
import type { EntityToolPack } from './pack.js';
import type { LocalApiTool } from './shared.js';
import { focusToolPack } from './focus.js';
import { habitToolPack } from './habit.js';
import { habitLogToolPack } from './habit-log.js';
import { noteToolPack } from './note.js';
import { projectToolPack } from './project.js';
import { reminderToolPack } from './reminder.js';
import { eventToolPack } from './event.js';
import { tagToolPack } from './tag.js';
import { taskToolPack } from './task.js';

/**
 * 已注册的实体工具包。**数组顺序就是目录顺序的一部分，改动要按下面这条规则验。**
 *
 * ⚠️ 顺序**只许追加到末尾**（新实体排在最后），不要在中间插入。
 * 理由不是"某个界面就是这个顺序"（不是），而是这条顺序会原样进
 * `tools/list` 与模型看到的 `tools` 数组，两处判据把它钉成**有序子序列**；
 * 中间插一段 = 那些判据红，而红的原因只有"顺序变了"。
 * 判据在 `tests/tool-pack-coverage.spec.ts`。
 */
export const LOCAL_API_TOOL_PACKS: readonly EntityToolPack[] = [
  taskToolPack,
  projectToolPack,
  habitToolPack,
  tagToolPack,
  noteToolPack,
  habitLogToolPack,
  focusToolPack,
  reminderToolPack,
  eventToolPack,
];

export interface ToolPackRegistry {
  /** 目录（按下面的"读在前写在后"规则生成）。 */
  readonly tools: readonly LocalApiTool[];
  /** 工具名 → 认领它的 pack。未注册的工具名返回 `undefined`。 */
  packFor(name: string): EntityToolPack | undefined;
  /** 工具名 → 它的 MCP 参数 schema。**没登记就是 `undefined`**（不编一个空的）。 */
  inputSchemaFor(name: string): McpToolDefinition['inputSchema'] | undefined;
  /** 全部工具名（顺序与 `tools` 一致）。 */
  readonly names: readonly string[];
}

/**
 * 从 pack 列表建出注册表。**纯函数**（不在求值路径上读全局），
 * 所以 `tests/tool-pack-coverage.spec.ts` 能拿一份假 pack 直接验它的三条失败。
 */
export function buildToolPackRegistry(packs: readonly EntityToolPack[]): ToolPackRegistry {
  // 🔴 **读工具全部排在写工具之前**，组内按 pack 注册顺序 —— 这是**顺序不变量**，
  // 不是聚合的巧合，也不是"今天恰好这样"。
  //
  // 为什么它承重：`LOCAL_API_TOOLS` 的顺序就是 `tools/list` 给 MCP 客户端的顺序，
  // 也是内置 AI 喂给模型的 `tools` 数组顺序，而 `listAuthorizedTools()` 的返回顺序
  // 被测试逐字钉着（`apps/node-host/tests/mcp-stdio-server.spec.ts:188` 断言
  // `['list_tasks', 'get_task', 'create_task']`，`packages/local-api/tests/server.spec.ts:189`
  // 断言四个名字的数组）。把它们按"实体"而不是"读写"分组，这两处立刻红。
  //
  // 所以：**新增实体时不要为了"一个实体的工具挨着"去改这里的分组。**
  const read: LocalApiTool[] = [];
  const write: LocalApiTool[] = [];
  const byName = new Map<string, EntityToolPack>();
  const schemas = new Map<string, McpToolDefinition['inputSchema']>();

  for (const pack of packs) {
    for (const tool of pack.tools) {
      const owner = byName.get(tool.name);
      if (owner !== undefined) {
        throw new Error(
          `工具「${tool.name}」被 ${owner.entityType} 和 ${pack.entityType} 两个 pack 认领 —— ` +
            '一个工具只许有一个家，否则目录里会出现两份可以各自漂移的声明。',
        );
      }
      byName.set(tool.name, pack);
      (tool.kind === 'read' ? read : write).push(tool);
    }

    for (const [toolName, schema] of Object.entries(pack.schemas)) {
      const toolOwner = byName.get(toolName);
      if (toolOwner === undefined || toolOwner !== pack) {
        throw new Error(
          `pack「${pack.entityType}」给工具「${toolName}」登记了参数 schema，` +
            (toolOwner === undefined
              ? '但没有任何 pack 在目录里声明它 —— 这是第二份定义，删掉这段 schema。'
              : `它属于 pack「${toolOwner.entityType}」 —— schema 必须长在**拥有这个工具的实体文件**里。`),
        );
      }
      schemas.set(toolName, schema);
    }
  }

  const tools = [...read, ...write];

  return {
    tools,
    names: tools.map((t) => t.name),
    packFor: (name) => byName.get(name),
    inputSchemaFor: (name) => schemas.get(name),
  };
}

const registry = buildToolPackRegistry(LOCAL_API_TOOL_PACKS);

/**
 * 工具目录。
 *
 * ⚠️ 每一个工具都会让"逐工具默认关"那张清单长一条，而用户要逐个理解它的风险 ——
 * 所以容量是**按实体**判的，不是按总数：见 `shared.ts` 的 `MAX_TOOLS_PER_ENTITY`
 * 与 `tests/local-api.spec.ts` 那条按实体分组的断言。
 * 总数上限由覆盖面门禁从"分母里有几个实体"推出来（`scripts/check-ai-coverage.mjs` §10）。
 *
 * 导出名 / 类型 / 成员集合 / 成员顺序都是既有的（`tests/local-api.spec.ts` 钉着
 * "名字唯一"与"每实体不超额"，`tests/server.spec.ts` 与 node-host 的 stdio 用例钉着顺序）。
 */
export const LOCAL_API_TOOLS: readonly LocalApiTool[] = registry.tools;

/** 按名字取工具。 */
export function findTool(name: string): LocalApiTool | undefined {
  return registry.tools.find((t) => t.name === name);
}

/** 全部工具名。UI 用它渲染"逐工具开关"列表。 */
export function toolNames(): readonly string[] {
  return registry.names;
}

/** 工具名 → 认领它的 pack（读与写都查这一张表 —— 目录由 pack 生成，所以这是唯一一份真源）。 */
export function packForTool(name: string): EntityToolPack | undefined {
  return registry.packFor(name);
}

/** 工具名 → MCP 参数 schema。没登记返回 `undefined`（由调用层决定怎么兜）。 */
export function inputSchemaForTool(name: string): McpToolDefinition['inputSchema'] | undefined {
  return registry.inputSchemaFor(name);
}
