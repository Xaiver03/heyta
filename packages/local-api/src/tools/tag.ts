/**
 * TAG（标签）实体工具包
 * ======================
 *
 * 读：`list_tags`；写：`create_tag`（新建标签）、`set_task_tags`（给一条任务整组换标签）。
 * 与 `task.ts` / `project.ts` / `habit.ts` 同形状：目录条目 + 参数 schema + 读分支 + 写分支
 * 全在这一个文件里。
 *
 * 🔴 为什么"给任务打标签"归 TAG 而不是 TASK：这个动作落地的是**标签集合**这个概念，
 * 而按名字判定实体时 `set_task_tags` 的中心词是 `tags`（见
 * `scripts/gen-ai-capability-manifest.mjs` 的 `ENTITY_NOUNS`）。把它挂到 TASK 上，
 * 就会出现"TASK 有六个工具、TAG 一个都没有"—— 而覆盖面门禁问的是
 * 「标签这个东西，AI 看得见也改得动吗」，那个问题的答案会是假的。
 *
 * ⚠️ 界面上还能**删除**标签，这个动作现在没有工具：删一条标签会把所有任务上的它一起摘掉，
 * 影响面是"用户没说的那些任务"，而目录里每多一个写工具就是"逐工具默认关"清单长一条。
 * 要补它得先回答"一次确认里用户看得见的是哪几条任务" —— 已登记，不是漏写。
 */

import type { McpToolDefinition } from '../mcp.js';
import type { LocalApiHost, ToolReadOutcome, ToolWriteIntentOutcome } from '../server.js';
import type { LocalApiTool } from './shared.js';
import type { EntityToolPack } from './pack.js';

const TOOLS: readonly LocalApiTool[] = [
  {
    name: 'list_tags',
    egressFields: ['tag.id', 'tag.name'],
    description: '列出所有标签（标识与名称）。给任务打标签之前先用它拿到标签标识。',
    kind: 'read',
    defaultEnabled: false,
  },
  {
    name: 'create_tag',
    // 写工具只产出提案、结果不回送模型 ⇒ 出境面是提案里那几个字段（同 TASK / PROJECT 的写工具）。
    egressFields: [],
    description: '新建一个标签。名称不能为空，也不能只有空格。重名不会被拒绝（界面上也是如此）。',
    kind: 'write',
    defaultEnabled: false,
  },
  {
    name: 'set_task_tags',
    egressFields: [],
    description:
      '把一条任务的标签**整组换成**给定的这一组，传空数组就是全部清掉。' +
      '这不是追加：要多打一个标签，先把现有标签取回来，连同新的一起传。' +
      '不认识或已经删掉的标签标识会被拒绝而不是忽略。',
    kind: 'write',
    defaultEnabled: false,
  },
];

/** 参数 schema（给模型看的字段清单）。 */
const SCHEMAS: Readonly<Record<string, McpToolDefinition['inputSchema']>> = {
  list_tags: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  create_tag: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '标签名称，不能是空白。' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  set_task_tags: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要改哪一条任务。' },
      tagIds: {
        type: 'array',
        items: { type: 'string' },
        description: '这一条任务最终应该挂上的标签标识**全集**（顺序无所谓，重复的会并掉）。空数组 = 全部清掉。',
      },
    },
    required: ['taskId', 'tagIds'],
    additionalProperties: false,
  },
};

/**
 * 读分支。
 *
 * 🔴 标签**名**不是敏感正文（与 `list_habits` / `list_projects` 同一条判断），
 * 所以这里不需要 `projectListForTool` 那一层投影；白名单在宿主侧的 `tagToRow` 里做，
 * 这一支原样回宿主给的东西不会多带字段。
 */
async function runRead(
  host: LocalApiHost,
  name: string,
  _a: Record<string, unknown>,
): Promise<ToolReadOutcome | undefined> {
  switch (name) {
    case 'list_tags': {
      return { ok: true, payload: await host.listTags() };
    }

    default:
      return undefined;
  }
}

/**
 * 写分支：参数 → 写入意图。**纯函数，不碰 host，因此不可能改数据。**
 *
 * ⚠️ 只做**形状**检查："标签标识存不存在、还活着吗"归宿主（它才看得见物化状态）。
 */
function toIntent(name: string, a: Record<string, unknown>): ToolWriteIntentOutcome | undefined {
  switch (name) {
    case 'create_tag': {
      if (typeof a['name'] !== 'string' || a['name'].trim() === '') {
        return { ok: false, message: 'create_tag 需要 name。' };
      }
      return { ok: true, intent: { action: 'create-tag', name: a['name'] } };
    }

    case 'set_task_tags': {
      if (typeof a['taskId'] !== 'string' || a['taskId'].trim() === '') {
        return { ok: false, message: 'set_task_tags 需要 taskId。' };
      }
      const raw = a['tagIds'];
      if (!Array.isArray(raw)) {
        // 🔴 不能把"没给数组"当成空数组：那等于用户说"看看这条任务的标签"，
        // 而系统回答"已经帮你清空了"。
        return { ok: false, message: 'set_task_tags 需要 tagIds（一组标签标识，可以是空数组）。' };
      }
      if (raw.some((x) => typeof x !== 'string' || x.trim() === '')) {
        return { ok: false, message: 'tagIds 里每一项都必须是非空字符串。' };
      }
      return {
        ok: true,
        intent: { action: 'set-task-tags', taskId: a['taskId'], tagIds: raw as string[] },
      };
    }

    default:
      // 不是 TAG 的工具名 —— 交给别的 pack，不是"写失败"。
      return undefined;
  }
}

export const tagToolPack: EntityToolPack = {
  entityType: 'TAG',
  tools: TOOLS,
  schemas: SCHEMAS,
  runRead,
  toIntent,
};
