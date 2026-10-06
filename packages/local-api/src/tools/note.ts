/**
 * NOTE（便签）实体工具包
 * ======================
 *
 * 读：`list_notes`（列表行，**不含正文**）、`get_note`（单条，含正文）；
 * 写：`create_note`、`update_note`（改正文）。
 *
 * 🔴 为什么列表不带正文、单条才带：这是 `list_tasks` / `get_task` 那条已经立好、
 * 而且被 `tests/tool-egress-fields.spec.ts` 钉过一遍的分工 —— 便签的正文是它**唯一**
 * 的自由文本，一次列几十张等于把几十条正文一起送出去，而用户按"我同意"时看到的
 * 披露只有一句"会送出便签正文"。逐条取让每一次正文出境都对应一次具体的请求。
 *
 * ⚠️ 正文的**长度上限不在这里**：那条规则住在 `@heyta/domain` 的
 * `NOTE_MAX_CONTENT_LENGTH`（由 `createNote` / `updateNoteContent` 执行）。
 * 本包零依赖、抄不了那个数 —— 抄一个数字进描述里，就是造一份一定会漂的抄件，
 * 而它漂了以后症状是"界面承诺 10000、领域按 8000 拒"。超限的回复来自领域层自己那句话。
 *
 * ⚠️ 界面上还能"钉到今天"和"移到某个清单"，这两个动作现在没有工具：
 * 它们改的是**视图归属**而不是便签的内容，而"AI 替用户决定哪张便签该钉在今天"
 * 需要先看钉选在产品里的语义（它是一条会出现在今天屏幕上的东西）。已登记，不是漏写。
 */

import { DEFAULT_LIST_LIMIT, clampListLimit } from './shared.js';
import type { McpToolDefinition } from '../mcp.js';
import type { LocalApiHost, ToolReadOutcome, ToolWriteIntentOutcome } from '../server.js';
import type { LocalApiTool } from './shared.js';
import type { EntityToolPack } from './pack.js';

const ROW_FIELDS = ['note.id', 'note.projectId', 'note.isPinnedToToday', 'note.updatedAt'] as const;

const TOOLS: readonly LocalApiTool[] = [
  {
    name: 'list_notes',
    egressFields: ROW_FIELDS,
    description:
      '列出便签的目录信息（标识、归属清单、是否钉在今天、最后修改时间），顺序和界面上一样。' +
      `不返回正文 —— 正文要用 get_note 逐条取。默认最多 ${String(DEFAULT_LIST_LIMIT)} 条，筛完才截断。`,
    kind: 'read',
    defaultEnabled: false,
  },
  {
    name: 'get_note',
    egressFields: [...ROW_FIELDS, 'note.content'],
    description: '读取一条便签，包含正文。',
    kind: 'read',
    defaultEnabled: false,
  },
  {
    name: 'create_note',
    // 写工具只产出提案、结果不回送模型 ⇒ 出境面是提案里那几个字段（同 TASK / PROJECT 的写工具）。
    egressFields: [],
    description:
      '新建一张便签。正文不能为空（只有空格也算空）。' +
      '可以指定放进哪个清单，不指定就是不归属任何清单；可以钉在今天。',
    kind: 'write',
    defaultEnabled: false,
  },
  {
    name: 'update_note',
    egressFields: [],
    description: '改写一张已有便签的正文（整段替换，不是追加）。正文不能为空。',
    kind: 'write',
    defaultEnabled: false,
  },
];

/** 参数 schema（给模型看的字段清单）。 */
const SCHEMAS: Readonly<Record<string, McpToolDefinition['inputSchema']>> = {
  list_notes: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: `最多返回几条，默认 ${String(DEFAULT_LIST_LIMIT)}。作用在筛完之后的列表上。`,
      },
    },
    additionalProperties: false,
  },
  get_note: {
    type: 'object',
    properties: {
      noteId: { type: 'string', description: '要读哪一张便签。' },
    },
    required: ['noteId'],
    additionalProperties: false,
  },
  create_note: {
    type: 'object',
    properties: {
      content: { type: 'string', description: '便签正文。' },
      projectId: { type: 'string', description: '放进哪个清单；省略或不传就是不给任何清单。' },
      isPinnedToToday: { type: 'boolean', description: '是否钉在今天的便签区，默认不钉。' },
    },
    required: ['content'],
    additionalProperties: false,
  },
  update_note: {
    type: 'object',
    properties: {
      noteId: { type: 'string', description: '要改哪一张便签。' },
      content: { type: 'string', description: '新的正文（整段替换）。' },
    },
    required: ['noteId', 'content'],
    additionalProperties: false,
  },
};

/**
 * 读分支。
 *
 * 🔴 `get_note` 命中不到时回的是 `{ error: … }` 信封（同 `get_task`）——
 * 那是一个**正常结果**，不是失败：调用方要能区分"这张便签不存在"和"读取出错"。
 */
async function runRead(
  host: LocalApiHost,
  name: string,
  a: Record<string, unknown>,
): Promise<ToolReadOutcome | undefined> {
  switch (name) {
    case 'list_notes': {
      const rows = await host.listNotes(clampListLimit(a['limit']));
      // 🔴 白名单重建（同 `projectListForTool` 的纪律）：这条判据不是防御性的，
      // `list_notes` 的承诺是"不返回正文"，而它唯一的执行点就是这里 ——
      // 宿主将来给行里挂一个 `content`，它就会跟着列表一起出境。
      const projected = rows.map((row) => ({
        id: row.id,
        projectId: row.projectId,
        isPinnedToToday: row.isPinnedToToday,
        updatedAt: row.updatedAt,
      }));
      return { ok: true, payload: projected };
    }

    case 'get_note': {
      const noteId = a['noteId'];
      if (typeof noteId !== 'string' || noteId.trim() === '') {
        return { ok: false, kind: 'invalid-args', message: 'get_note 需要 noteId。' };
      }
      const note = await host.getNote(noteId);
      if (note === undefined) {
        return { ok: true, payload: { error: `没有找到便签「${noteId}」。` } };
      }
      return { ok: true, payload: note };
    }

    default:
      return undefined;
  }
}

/** 正文的形状检查：不是字符串、空、只有空格，都在这里拒，不留到确认之后。 */
function rejectContent(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return '正文必须是字符串。';
  if (raw.trim() === '') return '正文不能为空（只有空格也算空）。';
  return undefined;
}

/**
 * 写分支：参数 → 写入意图。**纯函数，不碰 host，因此不可能改数据。**
 *
 * ⚠️ "那个清单存不存在、正文超不超长"归宿主 —— 本包看不见物化状态，也不持有长度上限，
 * 猜一个归属或自行放宽限制都比拒绝更糟。
 */
function toIntent(name: string, a: Record<string, unknown>): ToolWriteIntentOutcome | undefined {
  switch (name) {
    case 'create_note': {
      const bad = rejectContent(a['content']);
      if (bad !== undefined) return { ok: false, message: `create_note：${bad}` };
      const projectId = a['projectId'];
      if (projectId !== undefined && (typeof projectId !== 'string' || projectId.trim() === '')) {
        // 🔴 空串**不当成"不归属"**：那是 `undefined` 的含义。写错的调用方应该收到错误，
        // 而不是收到一次"按我没说的意思改了"。
        return { ok: false, message: 'create_note 的 projectId 要么不给，要么是一个非空字符串。' };
      }
      return {
        ok: true,
        intent: {
          action: 'create-note',
          content: a['content'] as string,
          ...(typeof projectId === 'string' ? { projectId } : {}),
          ...(typeof a['isPinnedToToday'] === 'boolean'
            ? { isPinnedToToday: a['isPinnedToToday'] }
            : {}),
        },
      };
    }

    case 'update_note': {
      if (typeof a['noteId'] !== 'string' || a['noteId'].trim() === '') {
        return { ok: false, message: 'update_note 需要 noteId。' };
      }
      const bad = rejectContent(a['content']);
      if (bad !== undefined) return { ok: false, message: `update_note：${bad}` };
      return {
        ok: true,
        intent: { action: 'update-note', noteId: a['noteId'], content: a['content'] as string },
      };
    }

    default:
      // 不是 NOTE 的工具名 —— 交给别的 pack，不是"写失败"。
      return undefined;
  }
}

export const noteToolPack: EntityToolPack = {
  entityType: 'NOTE',
  tools: TOOLS,
  schemas: SCHEMAS,
  runRead,
  toIntent,
};
