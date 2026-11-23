/**
 * COMMENT（任务评论）工具包 —— **share 感知的独立工具通道**（P4 / ADR-0062）
 * ======================================================================
 *
 * 读：`list_task_comments`（某条任务下的评论线程）
 * 写：`add_task_comment`（加评论）、`delete_task_comment`（软删评论）
 *
 * ## 🔴 这一组为什么与其它实体的 pack 不同形
 *
 * 其它实体的写入都落到**个人 op-log**（`submitIntent` → `ctx.dispatch`）。
 * 评论**不是**：个人 op-log 会**永久拒绝** `COMMENT` op（`op-log/src/state.ts`
 * 的 role 门 + 服务端白名单），而"发出去了但永远不出现"是最坏的失效。
 * 所以评论只存在于**共享清单**，写入只经 **share 加密通道**：
 *
 *   pack（本文件） → `LocalApiWriteIntent`（意图）
 *     → `submitIntent`（宿主层） → `options.commentActions.addComment/removeComment`
 *     → `dispatchShareOp(shareId, intent)`（share 通道，加密 + 逐 op 签名 + 上行）
 *
 * 也就是说：**工具层与个人 op-log 共用同一个 `submit` 入口**（`check:ai-tools`
 * 的"写入口恰好那两个文件"不破），但**执行目标**是 share 通道。
 *
 * ## 没有共享会话 = 诚实失败，不是空列表
 *
 * - 读：`host.listTaskComments` 是**可选**成员。没接它的宿主（CLI / MCP /
 *   无登录态的壳）回一句"本宿主没有共享会话"，**不假装成"这条任务没有评论"**。
 * - 写：`submitIntent` 看到 `options.commentActions === undefined` 时回
 *   `{ ok:false, reason:'invalid', message:'当前宿主没有共享会话…' }`，**零 op**。
 *   这条判据在 app-host（能看见 `commentActions` 的那一层），不在本包 ——
 *   本包零依赖、看不见 share 会话。
 *
 * ⚠️ 个人清单任务的 `addComment` 会抛 `ListNotSharedError`（`code:'list-not-shared'`），
 * 由 `submitIntent` 译成"评论只存在于共享清单"。那条错误在**构造/写入前**抛出，
 * 天然不产生 op。
 *
 * ## 为什么没有 `edit_task_comment`
 *
 * 改评论正文（`editComment`）在产品上是一个 UI 动作，但当前工单只要求
 * 加 / 列 / 删三条；改正文留到真实 share 后端就位后再按需补（同 `note.ts`
 * 文件头"钉今天"那条的处理：登记，不硬做）。
 */

import { DEFAULT_LIST_LIMIT, clampListLimit } from './shared.js';
import type { McpToolDefinition } from '../mcp.js';
import type { LocalApiHost, ToolReadOutcome, ToolWriteIntentOutcome } from '../server.js';
import type { LocalApiTool } from './shared.js';
import type { EntityToolPack } from './pack.js';

/** 评论读出境的字段（`list_task_comments`）——与 `LocalApiComment` 的字段逐字对应。 */
const ROW_FIELDS = [
  'comment.id',
  'comment.taskId',
  'comment.authorUserId',
  'comment.body',
  'comment.createdAt',
] as const;

const TOOLS: readonly LocalApiTool[] = [
  {
    name: 'list_task_comments',
    egressFields: ROW_FIELDS,
    description:
      '列出一条任务下的评论线程（标识、所属任务、作者、正文、创建时间），按创建时间从早到晚。' +
      '评论只存在于**共享清单**里 —— 个人清单、或本宿主没有共享会话时，会明确告诉你读不到，' +
      `而不是给一个空列表。默认最多 ${String(DEFAULT_LIST_LIMIT)} 条，筛完才截断。`,
    kind: 'read',
    risk: 'read',
    defaultEnabled: false,
  },
  {
    name: 'add_task_comment',
    // 写工具只产出提案、结果不回送模型 ⇒ 出境面是提案里那几个字段。
    egressFields: [],
    description:
      '给一条**共享清单**里的任务加一条评论。评论只存在于共享清单：个人清单、' +
      '或本宿主没有共享会话时，会被拒绝且不写任何东西。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'delete_task_comment',
    // 删除 → 软删（`DEL`），可逆 ⇒ `destructive-reversible`，不是 purge。
    egressFields: [],
    description:
      '删除一条评论（软删除，可撤销）。评论只存在于共享清单；本宿主没有共享会话时会被拒绝。',
    kind: 'write',
    risk: 'destructive-reversible',
    defaultEnabled: false,
  },
];

/** 参数 schema（给模型看的字段清单）。 */
const SCHEMAS: Readonly<Record<string, McpToolDefinition['inputSchema']>> = {
  list_task_comments: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要读哪条任务的评论线程。' },
      limit: {
        type: 'number',
        description: `最多返回几条，默认 ${String(DEFAULT_LIST_LIMIT)}。作用在筛完之后的列表上。`,
      },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  add_task_comment: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '给哪条任务加评论（必须属于共享清单）。' },
      body: { type: 'string', description: '评论正文（不能为空；上限由领域层判定）。' },
    },
    required: ['taskId', 'body'],
    additionalProperties: false,
  },
  delete_task_comment: {
    type: 'object',
    properties: {
      commentId: { type: 'string', description: '要删除（软删）的评论。' },
    },
    required: ['commentId'],
    additionalProperties: false,
  },
};

/**
 * 读分支：只有 `list_task_comments`。
 *
 * 🔴 `host.listTaskComments` 缺席 = **本宿主没有共享会话**，回 `invalid-args`
 * （借这一档，理由同 `server.ts` 的 `hostDoesNotSupport`）而不是空列表：
 * "没有共享会话"与"这条任务没有评论"是两句不同的话，不能合成一句看起来正常的空结果。
 */
async function runRead(
  host: LocalApiHost,
  name: string,
  a: Record<string, unknown>,
): Promise<ToolReadOutcome | undefined> {
  switch (name) {
    case 'list_task_comments': {
      const taskId = a['taskId'];
      if (typeof taskId !== 'string' || taskId.trim() === '') {
        return { ok: false, kind: 'invalid-args', message: 'list_task_comments 需要 taskId。' };
      }
      if (host.listTaskComments === undefined) {
        return {
          ok: false,
          kind: 'invalid-args',
          message: '当前宿主没有共享会话（评论只在已登录的共享清单可用）',
        };
      }
      const rows = await host.listTaskComments(taskId, clampListLimit(a['limit']));
      // 🔴 白名单重建（同 `note.ts` 的纪律）：出境只在声明过的那几格。
      const projected = rows.map((row) => ({
        id: row.id,
        taskId: row.taskId,
        authorUserId: row.authorUserId,
        body: row.body,
        createdAt: row.createdAt,
      }));
      return { ok: true, payload: projected };
    }
    default:
      return undefined;
  }
}

/** 非空字符串检查（id 类参数）。 */
function nonEmptyId(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  return raw;
}

/**
 * 写分支：参数 → 写入意图。**纯函数，不碰 host，因此不可能改数据。**
 *
 * ⚠️ 正文合法性（空 / 超长）与"这条清单共不共享"都归**执行层**
 * （`commentActions.addComment` 自己校验 + 抛 `ListNotSharedError`）——
 * 本包零依赖、看不见 share 会话，也不持有 `COMMENT_MAX_LENGTH`。猜一个上限
 * 或自行放宽限制都比拒绝更糟。
 */
function toIntent(name: string, a: Record<string, unknown>): ToolWriteIntentOutcome | undefined {
  switch (name) {
    case 'add_task_comment': {
      const unknown = Object.keys(a).filter((key) => key !== 'taskId' && key !== 'body');
      if (unknown.length > 0) {
        return { ok: false, message: `add_task_comment 不支持这些参数：${unknown.join('、')}。` };
      }
      const taskId = nonEmptyId(a['taskId']);
      if (taskId === undefined) return { ok: false, message: 'add_task_comment 需要 taskId。' };
      if (typeof a['body'] !== 'string') {
        return { ok: false, message: 'add_task_comment 的 body 必须是字符串。' };
      }
      return { ok: true, intent: { action: 'add-task-comment', taskId, body: a['body'] } };
    }
    case 'delete_task_comment': {
      const unknown = Object.keys(a).filter((key) => key !== 'commentId');
      if (unknown.length > 0) {
        return { ok: false, message: `delete_task_comment 不支持这些参数：${unknown.join('、')}。` };
      }
      const commentId = nonEmptyId(a['commentId']);
      if (commentId === undefined) {
        return { ok: false, message: 'delete_task_comment 需要 commentId。' };
      }
      return { ok: true, intent: { action: 'delete-task-comment', commentId } };
    }
    default:
      // 不是 COMMENT 的工具名 —— 交给别的 pack，不是"写失败"。
      return undefined;
  }
}

export const commentToolPack: EntityToolPack = {
  entityType: 'COMMENT',
  tools: TOOLS,
  schemas: SCHEMAS,
  runRead,
  toIntent,
};
