/**
 * USER_MEMORY（陈述记忆）实体工具包
 * ===================================
 *
 * 读：`list_memories`；写：`remember_memory`。
 *
 * ## 为什么写只有"记一条"，没有"忘记/改"
 *
 * 忘记与改是**用户对自己记忆的操作**，发生在设置页；让模型主动删记忆，
 * 一旦误判就是"用户说过的话被 AI 悄悄抹掉"，而且无法从对话里看出来。
 * 真要做，得先有"删除回执 + 可恢复"的产品设计，不是加一个工具的事。
 *
 * ## 为什么 `remember_memory` 必须确认
 *
 * 记忆会进入之后每一轮的 system prompt —— 写错一条不是"这一轮答错"，
 * 而是"之后每一轮都带着错的前提"。所以它走提案确认（`aiToolProposalRequiresConfirmation`），
 * 与 `update_note` 同档，不由 AI 自动落库。
 *
 * ## 出境
 *
 * 读工具把记忆正文发给模型，所以 `egressFields` 如实登记；写工具只产出提案，
 * 结果不回送模型，`egressFields` 为空（同 TAG / PROJECT 的写工具）。
 */

import type { McpToolDefinition } from '../mcp.js';
import type { LocalApiHost, ToolReadOutcome, ToolWriteIntentOutcome } from '../server.js';
import type { LocalApiTool } from './shared.js';
import type { EntityToolPack } from './pack.js';

const KINDS = ['profile', 'preference', 'fact', 'task'] as const;

const TOOLS: readonly LocalApiTool[] = [
  {
    name: 'list_memories',
    egressFields: ['memory.id', 'memory.kind', 'memory.text'],
    description:
      '列出已经记住的、关于这位用户的长期信息（身份 / 偏好 / 稳定事实 / 在办事项）。' +
      '只在需要确认"我是不是已经知道这件事"时用，不要为了显得贴心而每次都读。',
    kind: 'read',
    risk: 'read',
    defaultEnabled: false,
  },
  {
    name: 'remember_memory',
    // 写工具只产出提案、结果不回送模型 ⇒ 出境面为空。
    egressFields: [],
    description:
      '记住一条用户**明确说过**的长期信息（偏好、身份、稳定事实、在办事项）。' +
      '一条一句话；不要从猜测里编。会先让用户确认，确认后才生效。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
];

const SCHEMAS: Readonly<Record<string, McpToolDefinition['inputSchema']>> = {
  list_memories: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  remember_memory: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '一句话，用用户自己的说法。' },
      kind: {
        type: 'string',
        enum: [...KINDS],
        description: 'profile=身份；preference=做事方式/喜好；fact=稳定事实；task=在办事项。省略按事实处理。',
      },
    },
    required: ['text'],
    additionalProperties: false,
  },
};

async function runRead(
  host: LocalApiHost,
  name: string,
): Promise<ToolReadOutcome | undefined> {
  if (name !== 'list_memories') return undefined;
  if (host.listMemories === undefined) {
    return {
      ok: false,
      kind: 'not-readable',
      message: '这个宿主没有接记忆列表，读不到。',
    };
  }
  return { ok: true, payload: await host.listMemories() };
}

function toIntent(
  name: string,
  a: Record<string, unknown>,
): ToolWriteIntentOutcome | undefined {
  if (name !== 'remember_memory') return undefined;

  const unknown = Object.keys(a).filter((key) => key !== 'text' && key !== 'kind');
  if (unknown.length > 0) {
    return { ok: false, message: `remember_memory 不支持这些参数：${unknown.join('、')}。` };
  }
  const text = typeof a['text'] === 'string' ? a['text'].trim() : '';
  if (text === '') return { ok: false, message: 'remember_memory 需要 text（不能是空白）。' };

  const kind = a['kind'];
  if (kind !== undefined && (typeof kind !== 'string' || !KINDS.includes(kind as never))) {
    return { ok: false, message: `remember_memory 的 kind 只能是 ${KINDS.join(' / ')}。` };
  }
  return {
    ok: true,
    intent: {
      action: 'remember-memory',
      text,
      ...(kind === undefined ? {} : { kind: kind as (typeof KINDS)[number] }),
    },
  };
}

export const memoryToolPack: EntityToolPack = {
  entityType: 'USER_MEMORY',
  tools: TOOLS,
  schemas: SCHEMAS,
  runRead,
  toIntent,
};
