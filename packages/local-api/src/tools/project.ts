/**
 * PROJECT（清单）实体工具包
 * ==========================
 *
 * 目前只有 `list_projects` 一个**读**工具 —— 清单的写入（建/改名/删）还没有工具，
 * 那是下一批的事。这个文件的存在本身就是那件事的落点：加 `create_project`
 * 只需要在这里多写一条目录条目 + 一段 schema + 一个 `toIntent` 分支，
 * 不需要再回到 `mcp.ts` / `server.ts` 各改一处。
 *
 * ⚠️ `toIntent()` 现在**恒返回 `undefined`**，不是"写失败"：目录里没有 PROJECT 的
 * 写工具，所以委托层永远不会走到这里。真加了写工具却没在这里认领，
 * `tests/tool-pack-coverage.spec.ts` 会当场红（拿到 `tool-not-implemented`）。
 */

import type { McpToolDefinition } from '../mcp.js';
import type { LocalApiHost, ToolReadOutcome, ToolWriteIntentOutcome } from '../server.js';
import type { LocalApiTool } from './shared.js';
import type { EntityToolPack } from './pack.js';

const TOOLS: readonly LocalApiTool[] = [
  {
    name: 'list_projects',
    egressFields: ['project.id', 'project.name', 'project.taskCount'],
    description: '列出清单/项目及其任务数量。',
    kind: 'read',
    defaultEnabled: false,
  },
];

/** 参数 schema（给模型看的字段清单）。 */
const SCHEMAS: Readonly<Record<string, McpToolDefinition['inputSchema']>> = {
  list_projects: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

async function runRead(
  host: LocalApiHost,
  name: string,
  _a: Record<string, unknown>,
): Promise<ToolReadOutcome | undefined> {
  switch (name) {
    case 'list_projects': {
      // 清单没有"可读性"问题：名字不是敏感正文（`LocalApiProject` 与 `LocalApiItem`
      // 的区别就在这个字段上），所以这里不投影 —— 与搬走之前的行为逐字相同。
      return { ok: true, payload: await host.listProjects() };
    }

    default:
      return undefined;
  }
}

function toIntent(_name: string, _a: Record<string, unknown>): ToolWriteIntentOutcome | undefined {
  return undefined;
}

export const projectToolPack: EntityToolPack = {
  entityType: 'PROJECT',
  tools: TOOLS,
  schemas: SCHEMAS,
  runRead,
  toIntent,
};
