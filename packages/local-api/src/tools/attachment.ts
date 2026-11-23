/**
 * ATTACHMENT（任务附件）实体工具包
 * ==================================
 *
 * 读：`list_attachments`（某条任务下的附件目录：标识、文件名、类型、大小、归属任务）；
 * 写：`rename_attachment`（改展示名，纯 op）、`remove_attachment`（移除 → 回收站 + 尽力回收字节）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 **没有"新建附件"工具** —— 这不是漏写，是刻意的。
 *
 * 助手的输出是文本，它产不出一个真实文件的字节；而 `attachment-actions.ts` 的
 * 写路径明确拒绝"先建实体、字节后补"那个顺序（那样会留下每一台设备都点不开、
 * 没有任何一层知道该重试的附件）。一个"创建附件"的工具只能造出那条被拒绝的形状，
 * 或者只能拒绝调用者。所以本 pack 只做"对已有附件改名 / 移除 / 列目录"。
 *
 * 🔴 **没有"读字节"工具**：这条通道上刻意没有 `GET`（读字节需要一个能用它的界面，
 * 见 `attachment-http.ts` 的 `ATTACHMENT_ROUTES` 那一段）。助手"看得见一个打不开的文件"
 * 仍是功能 —— 它能改名、能删、能告诉用户"这条任务有 3 个附件"，只是不能预览内容。
 *
 * ⚠️ 铁律：**一个工具 = 一次 op**。rename 一条 `UPD`；remove 一条 `DEL`（+ 端口回收字节）。
 * 三条工具都由 `@heyta/app-host` 的 `attachment-actions.ts` 落地，op 的构造只在那里有一份。
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { McpToolDefinition } from '../mcp.js';
import type { LocalApiHost, ToolReadOutcome, ToolWriteIntentOutcome } from '../server.js';
import type { LocalApiTool } from './shared.js';
import type { EntityToolPack } from './pack.js';

/**
 * `list_attachments` 的出境字段。每一个键都必须在真实投影里出现，且反过来
 * 真实投影出的每个键都要在这里声明（`tests/tool-egress-fields.spec.ts` 判）。
 */
const ROW_FIELDS = [
  'attachment.id',
  'attachment.fileName',
  'attachment.mime',
  'attachment.sizeBytes',
  'attachment.taskId',
] as const;

const TOOLS: readonly LocalApiTool[] = [
  {
    name: 'list_attachments',
    egressFields: ROW_FIELDS,
    description:
      '列出某条任务下的附件（文件名、类型、大小）。只返回元数据，不返回文件内容 —— ' +
      '这条通道上没有取回字节的能力。软删除的附件不出现。',
    kind: 'read',
    risk: 'read',
    defaultEnabled: false,
  },
  {
    name: 'rename_attachment',
    egressFields: [],
    description: '改一个附件的展示文件名（不重新上传、不改文件内容）。空文件名会被拒绝。',
    kind: 'write',
    risk: 'write',
    defaultEnabled: false,
  },
  {
    name: 'remove_attachment',
    egressFields: [],
    description:
      '把一个附件从任务上移除：软删除到回收站，并尽力释放服务端占用的字节。' +
      '⚠️ 字节一旦释放就无法恢复，所以这一步实际不可逆——确认前请看清是哪一个附件。',
    kind: 'write',
    // ⚠️ 语义上它是删除 + 释放字节（不可逆），但本批按工单定为普通写。
    // 真正不可逆的那一半（purge）从没进过目录，这条的字节回收谁来兜底见工单风险项。
    risk: 'write',
    defaultEnabled: false,
  },
];

/** 参数 schema（给模型看的字段清单）。 */
const SCHEMAS: Readonly<Record<string, McpToolDefinition['inputSchema']>> = {
  list_attachments: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '要看哪条任务的附件。' },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  rename_attachment: {
    type: 'object',
    properties: {
      attachmentId: { type: 'string', description: '要改名的附件。' },
      fileName: { type: 'string', description: '新的展示文件名（含扩展名）。不能为空。' },
    },
    required: ['attachmentId', 'fileName'],
    additionalProperties: false,
  },
  remove_attachment: {
    type: 'object',
    properties: {
      attachmentId: { type: 'string', description: '要移除的附件。' },
    },
    required: ['attachmentId'],
    additionalProperties: false,
  },
};

/**
 * 读分支。
 *
 * 🔴 白名单重建（同 `note.ts` 的 `list_notes`）：目录描述与 `egressFields` 都承诺
 * "只出这几个字段"，而唯一的执行点就是这里 —— 宿主将来给行里挂一个 `path`，
 * 它就会跟着列表一起出境。
 */
async function runRead(
  host: LocalApiHost,
  name: string,
  a: Record<string, unknown>,
): Promise<ToolReadOutcome | undefined> {
  switch (name) {
    case 'list_attachments': {
      const taskId = a['taskId'];
      if (typeof taskId !== 'string' || taskId.trim() === '') {
        return { ok: false, kind: 'invalid-args', message: 'list_attachments 需要 taskId。' };
      }
      // 宿主没接这条读能力（可选成员）⇒ 明确说清，而不是返回一个空列表冒充"没有附件"。
      if (typeof host.listAttachments !== 'function') {
        return {
          ok: false,
          kind: 'invalid-args',
          message:
            '这个宿主没有接附件读取（list_attachments 需要宿主实现 listAttachments），' +
            '所以一个附件都没有读到 —— 不是"这条任务没有附件"。',
        };
      }
      const rows = await host.listAttachments(taskId);
      const projected = rows.map((row) => ({
        id: row.id,
        fileName: row.fileName,
        ...(row.mime === undefined ? {} : { mime: row.mime }),
        ...(row.sizeBytes === undefined ? {} : { sizeBytes: row.sizeBytes }),
        taskId: row.taskId,
      }));
      return { ok: true, payload: projected };
    }

    default:
      return undefined;
  }
}

/**
 * 写分支：参数 → 写入意图。**纯函数，不碰 host，因此不可能改数据。**
 *
 * ⚠️ "那个附件在不在、文件名合不合法"归宿主（`attachment-actions.ts` 判）——
 * 本包看不见物化状态，也不持有文件名长度上限（`ATTACHMENT_NAME_MAX_LENGTH` 在领域层）。
 * 这里只把**明显写错的调用**挡在确认之前。
 */
function toIntent(name: string, a: Record<string, unknown>): ToolWriteIntentOutcome | undefined {
  switch (name) {
    case 'rename_attachment': {
      const unknown = Object.keys(a).filter((key) => key !== 'attachmentId' && key !== 'fileName');
      if (unknown.length > 0) {
        return { ok: false, message: `rename_attachment 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['attachmentId'] !== 'string' || a['attachmentId'].trim() === '') {
        return { ok: false, message: 'rename_attachment 需要 attachmentId。' };
      }
      if (typeof a['fileName'] !== 'string' || a['fileName'].trim() === '') {
        return { ok: false, message: 'rename_attachment 需要一个非空的 fileName。' };
      }
      return {
        ok: true,
        intent: { action: 'rename-attachment', attachmentId: a['attachmentId'], fileName: a['fileName'] },
      };
    }

    case 'remove_attachment': {
      const unknown = Object.keys(a).filter((key) => key !== 'attachmentId');
      if (unknown.length > 0) {
        return { ok: false, message: `remove_attachment 不支持这些参数：${unknown.join('、')}。` };
      }
      if (typeof a['attachmentId'] !== 'string' || a['attachmentId'].trim() === '') {
        return { ok: false, message: 'remove_attachment 需要 attachmentId。' };
      }
      return { ok: true, intent: { action: 'remove-attachment', attachmentId: a['attachmentId'] } };
    }

    default:
      // 不是 ATTACHMENT 的工具名 —— 交给别的 pack，不是"写失败"。
      return undefined;
  }
}

export const attachmentToolPack: EntityToolPack = {
  entityType: 'ATTACHMENT',
  tools: TOOLS,
  schemas: SCHEMAS,
  runRead,
  toIntent,
};
