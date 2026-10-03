/**
 * PROJECT（清单）实体工具包
 * ==========================
 *
 * 读：`list_projects`（列清单与任务数）；写：`create_project`（新建清单）。
 * 两条都在这里 —— 目录条目、给模型看的参数 schema、读分支、写分支**一处不落**，
 * 加第三个工具（改名 / 归档 / 删除）不需要再回到 `mcp.ts` / `server.ts` 各改一处。
 *
 * ⚠️ 界面上还能**改名、设颜色、归档、删除**清单（`ProjectsPanel`），这四个动作
 * 现在**没有工具**：工具目录有一条容量判据（`tests/local-api.spec.ts` 的
 * `LOCAL_API_TOOLS.length <= 10`，"每多一个工具，'默认关'的清单就长一条"），
 * 所以一次只能挑"用户最常让 AI 做的那一件"。这里是建清单。
 * 要补其余动作，先重新拍那条上限 —— 不要为了塞进去而删掉别的工具。
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
  {
    name: 'create_project',
    // 写工具只产出提案、结果不回送模型 ⇒ 出境面是**提案里那几个字段**（同 TASK 的写工具）。
    egressFields: [],
    description:
      '新建一个清单（项目）。可选放进某个已有清单的下层，最多一层。' +
      '名称不能为空；放在哪个清单下面由宿主核对，认不出就整条拒绝而不是建到看不见的地方。',
    kind: 'write',
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
  create_project: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '清单名称，不能是空白。' },
      parentId: {
        type: 'string',
        description: '放进哪个清单的下层（可选）。省略就是顶层清单。',
      },
    },
    required: ['name'],
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

/**
 * 写分支：参数 → 写入意图。**纯函数，不碰 host，因此不可能改数据。**
 *
 * ⚠️ 这里只做**形状**检查（有没有、是不是字符串）。"这个 parentId 真的存在吗"
 * 归宿主（`packages/app-host/src/local-api-host.ts`），因为它才知道当前状态里有什么 ——
 * 与 `create_task` 的日期格式检查分在两层是同一个理由。
 */
function toIntent(name: string, a: Record<string, unknown>): ToolWriteIntentOutcome | undefined {
  switch (name) {
    case 'create_project': {
      // 空白名在这里就拒（与 `create_task` 对 `title` 的处理同一条规则）：
      // 让"没有名字的清单"变成一个提案，界面上就会渲染出一条空提案 ——
      // 而用户连"要建什么"都看不见，只能盲点确认。
      if (typeof a['name'] !== 'string' || a['name'].trim() === '') {
        return { ok: false, message: 'create_project 需要 name。' };
      }
      return {
        ok: true,
        intent: {
          action: 'create-project',
          name: a['name'],
          ...(typeof a['parentId'] === 'string' ? { parentId: a['parentId'] } : {}),
        },
      };
    }

    default:
      // 不是 PROJECT 的工具名 —— 交给别的 pack，不是"写失败"。
      return undefined;
  }
}

export const projectToolPack: EntityToolPack = {
  entityType: 'PROJECT',
  tools: TOOLS,
  schemas: SCHEMAS,
  runRead,
  toIntent,
};

