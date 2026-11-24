/**
 * PROJECT（清单）实体工具包
 * ==========================
 *
 * 读：`list_projects`（列清单与任务数）；写：`create_project`（新建清单）、
 * `rename_project`（改名）、`archive_project`（归档/取消归档）、`delete_project`（移入回收站）、
 * `move_project`（层级移动 / 提为顶层）、`restore_project`（从回收站恢复）。
 * 全部在这里 —— 目录条目、给模型看的参数 schema、读分支、写分支**一处不落**，
 * 加工具不需要再回到 `mcp.ts` / `server.ts` 各改一处。
 *
 * 🔴 删除 = 软删除（`DEL`→墓碑），可逆、可撤销；`purge`/清空回收站**永不**做成工具
 * （见契约 §0）。改名与归档的「清单是否存在 / 名字是否为空」由宿主判，
 * 这里只做形状检查。
 * 🔴 不要为了塞进去而删掉别的工具 —— 删一个工具 = 让一个实体从"能读能写"退回"只读"，
 * 覆盖面会跟着掉。
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
    risk: 'read',
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
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'rename_project',
    // 写工具只产出提案、结果不回送模型 ⇒ 出境面是提案里那几个字段（同 `create_project`）。
    egressFields: [],
    description: '给一个清单（项目）改名。名称不能为空，也不能只有空格。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'archive_project',
    // 归档 = 可逆的破坏性动作：直接执行，靠 op-log 版本回溯兜底（契约 §0 / `ToolRisk`）。
    egressFields: [],
    description:
      '归档一个清单（项目），或把已归档的清单恢复为未归档。' +
      '省略 archived 就是归档；archived 为 false 即恢复。清单不存在会被拒绝。',
    kind: 'write',
    risk: 'destructive-reversible',
    defaultEnabled: false,
  },
  {
    name: 'delete_project',
    // 删除 → 回收站（软删除），可逆、可撤销 ⇒ `destructive-reversible`，不是 purge。
    egressFields: [],
    description: '把一个清单（项目）删除到回收站。可撤销，不是彻底删除。',
    kind: 'write',
    risk: 'destructive-reversible',
    defaultEnabled: false,
  },
  {
    name: 'move_project',
    // 层级移动只改父子关系，不删数据 ⇒ `write`（环/超深由宿主同步抛错翻成 invalid）。
    egressFields: [],
    description:
      '把一个清单（项目）移动到另一个清单的下层，或移出下层成为顶层清单。' +
      '省略 parentId 就是提为顶层。目标清单不存在、或移动会形成环/超过允许层数会被拒绝。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'restore_project',
    // 恢复 = 把回收站里的清单取回来，不产生新的删除 ⇒ `write`。
    egressFields: [],
    description: '把一个在回收站里的清单（项目）恢复回来。清单不存在或不在回收站会被拒绝。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'set_project_color',
    // 颜色 = 用户赋义的身份标记。AI 只在用户**明确点名**某个色号时执行，不主动替用户选色
    //（口径见 `docs/plans/ai-event-tool-contract.md` §5.4，已按此更新）。
    egressFields: [],
    description:
      '给一个清单（项目）设置颜色槽位（1–8），或清除颜色。' +
      '🔴 仅在用户明确要求某个颜色时调用；不要自行替用户决定清单该是什么颜色。省略 color = 清除颜色。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'set_project_icon',
    // 图标 = 用户赋义的身份标记。AI 只在用户**明确点名**某个图标时执行（§5.4）。
    egressFields: [],
    description:
      '给一个清单（项目）指定图标（闭集里的 key，如 list / star / briefcase / home），或清除回到默认。' +
      '🔴 仅在用户明确要求某个图标时调用；不要自行替用户选图标。省略 icon = 清除。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'set_project_view_mode',
    // 视图是展示方式，不删数据 ⇒ `write`。
    egressFields: [],
    description:
      '设置一个清单（项目）的默认视图：list（列表）/ board（看板）/ calendar（日历）/ timeline（时间线）。' +
      '仅改变展示排布，不改变任务本身。省略 viewMode = 清除回到 list。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'set_project_kind',
    egressFields: [],
    description:
      '设置一个清单（项目）的类型：tasks（默认展示任务）/ notes（默认展示便签）。' +
      '它只表达"打开这条清单先看到什么"，不限制内容、不合并便签实体。省略 kind = 清除回到 tasks。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'set_project_show_in_smart_list',
    egressFields: [],
    description:
      '设置一个清单（项目）是否在智能清单 / 汇总里显示。缺省为 true（显示）；传 false 即隐藏。',
    kind: 'write',
    risk: 'write',
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
  rename_project: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: '要改名的清单标识。' },
      name: { type: 'string', description: '新的清单名称，不能是空白。' },
    },
    required: ['projectId', 'name'],
    additionalProperties: false,
  },
  archive_project: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: '要归档或恢复的清单标识。' },
      archived: {
        type: 'boolean',
        description: 'true / 省略 = 归档；false = 恢复为未归档。',
      },
    },
    required: ['projectId'],
    additionalProperties: false,
  },
  delete_project: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: '要删除到回收站的清单标识。' },
    },
    required: ['projectId'],
    additionalProperties: false,
  },
  move_project: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: '要移动的清单标识。' },
      parentId: {
        type: 'string',
        description: '移动到哪个清单的下层（可选）。省略就是提为顶层清单。',
      },
    },
    required: ['projectId'],
    additionalProperties: false,
  },
  restore_project: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: '要从回收站恢复的清单标识。' },
    },
    required: ['projectId'],
    additionalProperties: false,
  },
  set_project_color: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: '要设色的清单标识。' },
      color: { type: 'number', description: '颜色槽位 1–8 的整数；省略表示清除颜色。' },
    },
    required: ['projectId'],
    additionalProperties: false,
  },
  set_project_icon: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: '要设图标的清单标识。' },
      icon: { type: 'string', description: '图标 key（闭集）；省略表示清除。' },
    },
    required: ['projectId'],
    additionalProperties: false,
  },
  set_project_view_mode: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: '要设默认视图的清单标识。' },
      viewMode: {
        type: 'string',
        description: '默认视图：list / board / calendar / timeline；省略表示清除回到 list。',
      },
    },
    required: ['projectId'],
    additionalProperties: false,
  },
  set_project_kind: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: '要设类型的清单标识。' },
      kind: { type: 'string', description: '清单类型：tasks / notes；省略表示清除回到 tasks。' },
    },
    required: ['projectId'],
    additionalProperties: false,
  },
  set_project_show_in_smart_list: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: '要设置的清单标识。' },
      showInSmartList: { type: 'boolean', description: '是否在智能清单 / 汇总里显示。' },
    },
    required: ['projectId', 'showInSmartList'],
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

    case 'rename_project': {
      const unknown = Object.keys(a).filter((key) => key !== 'projectId' && key !== 'name');
      if (unknown.length > 0) {
        return { ok: false, message: `rename_project 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['projectId'] !== 'string' || a['projectId'].trim() === '') {
        return { ok: false, message: 'rename_project 需要 projectId。' };
      }
      if (typeof a['name'] !== 'string' || a['name'].trim() === '') {
        return { ok: false, message: 'rename_project 需要 name（不能是空白）。' };
      }
      return {
        ok: true,
        intent: { action: 'rename-project', projectId: a['projectId'], name: a['name'] },
      };
    }

    case 'archive_project': {
      const unknown = Object.keys(a).filter((key) => key !== 'projectId' && key !== 'archived');
      if (unknown.length > 0) {
        return { ok: false, message: `archive_project 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['projectId'] !== 'string' || a['projectId'].trim() === '') {
        return { ok: false, message: 'archive_project 需要 projectId。' };
      }
      const archived = a['archived'];
      if (archived !== undefined && typeof archived !== 'boolean') {
        // 不能把"给了一个不是布尔的 archived"当成"没给"（那会默默归档而不是恢复）。
        return { ok: false, message: 'archive_project 的 archived 必须是 true 或 false。' };
      }
      return {
        ok: true,
        intent: {
          action: 'archive-project',
          projectId: a['projectId'],
          ...(typeof archived === 'boolean' ? { archived } : {}),
        },
      };
    }

    case 'delete_project': {
      const unknown = Object.keys(a).filter((key) => key !== 'projectId');
      if (unknown.length > 0) {
        return { ok: false, message: `delete_project 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['projectId'] !== 'string' || a['projectId'].trim() === '') {
        return { ok: false, message: 'delete_project 需要 projectId。' };
      }
      return { ok: true, intent: { action: 'delete-project', projectId: a['projectId'] } };
    }

    case 'move_project': {
      const unknown = Object.keys(a).filter((key) => key !== 'projectId' && key !== 'parentId');
      if (unknown.length > 0) {
        return { ok: false, message: `move_project 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['projectId'] !== 'string' || a['projectId'].trim() === '') {
        return { ok: false, message: 'move_project 需要 projectId。' };
      }
      // 显式给了 parentId 就必须是非空字符串：空串/非字符串不能当成"没给"，
      // 否则"移出到顶层"会被悄悄执行成一次无效移动，用户以为移走了。
      if ('parentId' in a) {
        const parentId = a['parentId'];
        if (typeof parentId !== 'string' || parentId.trim() === '') {
          return { ok: false, message: 'move_project 的 parentId 必须是非空字符串（提为顶层请省略它）。' };
        }
        return {
          ok: true,
          intent: { action: 'move-project', projectId: a['projectId'], parentId },
        };
      }
      // 省略 parentId = 提为顶层 ⇒ 意图里**不出现**该键，由宿主按"无 parent"落地。
      return { ok: true, intent: { action: 'move-project', projectId: a['projectId'] } };
    }

    case 'restore_project': {
      const unknown = Object.keys(a).filter((key) => key !== 'projectId');
      if (unknown.length > 0) {
        return { ok: false, message: `restore_project 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['projectId'] !== 'string' || a['projectId'].trim() === '') {
        return { ok: false, message: 'restore_project 需要 projectId。' };
      }
      return { ok: true, intent: { action: 'restore-project', projectId: a['projectId'] } };
    }

    case 'set_project_color': {
      const unknown = Object.keys(a).filter((key) => key !== 'projectId' && key !== 'color');
      if (unknown.length > 0) {
        return { ok: false, message: `set_project_color 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['projectId'] !== 'string' || a['projectId'].trim() === '') {
        return { ok: false, message: 'set_project_color 需要 projectId。' };
      }
      const color = a['color'];
      if (color !== undefined && (typeof color !== 'number' || !Number.isInteger(color) || color < 1 || color > 8)) {
        return { ok: false, message: 'set_project_color 的 color 必须是 1–8 的整数；要清除颜色请省略它。' };
      }
      return {
        ok: true,
        intent: {
          action: 'set-project-color',
          projectId: a['projectId'],
          ...(typeof color === 'number' ? { color } : {}),
        },
      };
    }

    case 'set_project_icon': {
      const unknown = Object.keys(a).filter((key) => key !== 'projectId' && key !== 'icon');
      if (unknown.length > 0) {
        return { ok: false, message: `set_project_icon 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['projectId'] !== 'string' || a['projectId'].trim() === '') {
        return { ok: false, message: 'set_project_icon 需要 projectId。' };
      }
      // 形状检查只到"非空字符串"为止：闭集词表归动作层（本包看不见 domain）。
      if (a['icon'] !== undefined && (typeof a['icon'] !== 'string' || a['icon'].trim() === '')) {
        return { ok: false, message: 'set_project_icon 的 icon 必须是非空字符串（要清除请省略）。' };
      }
      return {
        ok: true,
        intent: {
          action: 'set-project-icon',
          projectId: a['projectId'],
          ...(typeof a['icon'] === 'string' ? { icon: a['icon'] } : {}),
        },
      };
    }

    case 'set_project_view_mode': {
      const unknown = Object.keys(a).filter((key) => key !== 'projectId' && key !== 'viewMode');
      if (unknown.length > 0) {
        return { ok: false, message: `set_project_view_mode 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['projectId'] !== 'string' || a['projectId'].trim() === '') {
        return { ok: false, message: 'set_project_view_mode 需要 projectId。' };
      }
      if (
        a['viewMode'] !== undefined &&
        (typeof a['viewMode'] !== 'string' || a['viewMode'].trim() === '')
      ) {
        return { ok: false, message: 'set_project_view_mode 的 viewMode 必须是非空字符串（要清除请省略）。' };
      }
      return {
        ok: true,
        intent: {
          action: 'set-project-view-mode',
          projectId: a['projectId'],
          ...(typeof a['viewMode'] === 'string' ? { viewMode: a['viewMode'] } : {}),
        },
      };
    }

    case 'set_project_kind': {
      const unknown = Object.keys(a).filter((key) => key !== 'projectId' && key !== 'kind');
      if (unknown.length > 0) {
        return { ok: false, message: `set_project_kind 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['projectId'] !== 'string' || a['projectId'].trim() === '') {
        return { ok: false, message: 'set_project_kind 需要 projectId。' };
      }
      if (a['kind'] !== undefined && (typeof a['kind'] !== 'string' || a['kind'].trim() === '')) {
        return { ok: false, message: 'set_project_kind 的 kind 必须是非空字符串（要清除请省略）。' };
      }
      return {
        ok: true,
        intent: {
          action: 'set-project-kind',
          projectId: a['projectId'],
          ...(typeof a['kind'] === 'string' ? { kind: a['kind'] } : {}),
        },
      };
    }

    case 'set_project_show_in_smart_list': {
      const unknown = Object.keys(a).filter(
        (key) => key !== 'projectId' && key !== 'showInSmartList',
      );
      if (unknown.length > 0) {
        return { ok: false, message: `set_project_show_in_smart_list 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['projectId'] !== 'string' || a['projectId'].trim() === '') {
        return { ok: false, message: 'set_project_show_in_smart_list 需要 projectId。' };
      }
      // `showInSmartList` 是**必填布尔**：缺了它或给非布尔都不能当"默认为 true"悄悄放行
      //（那会让用户以为关掉了、其实没关）。
      const show = a['showInSmartList'];
      if (typeof show !== 'boolean') {
        return { ok: false, message: 'set_project_show_in_smart_list 的 showInSmartList 必须是 true 或 false。' };
      }
      return {
        ok: true,
        intent: {
          action: 'set-project-show-in-smart-list',
          projectId: a['projectId'],
          showInSmartList: show,
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
