/**
 * 附件动作（宿主无关）—— 工单 `task-detail-ticktick-parity` #9 的**写路径**
 * ======================================================================
 *
 * `ATTACHMENT` 实体的 op 只能在这里构造（AGENTS.md §3.5：`apps/*` 不许有
 * 一行在决定"业务上该怎么做"）。与 `note-actions.ts` / `reminder-actions.ts`
 * 同一个理由。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 五个由这里**独占**的语义决定：
 *
 * 1. 🔴 **先传字节，后发 CREATE op。**
 *    顺序反过来（先建实体再传字节）会让半途失败留下一个**点不开的附件**：
 *    元数据已经同步到所有设备，而任何一台都取不到字节，且没有任何一层知道该重试。
 *    现在这个顺序下，失败留下的是服务端一个"没有主人的 blob" ——
 *    它占配额但**用户看不见**，而且本方法会立刻尽力 `DELETE` 回收它。
 *    ⚠️ 回收本身也可能失败（断网）。那种情况登记在计划里，靠服务端的孤儿扫描兜，
 *    不假装"删干净了"。
 *
 * 2. **`sizeBytes` 取服务端测到的那个数**（`receipt.byteCount`），不是客户端估的。
 *    客户端只能从 base64 长度反推（`Math.floor(len*3/4)`，还受 padding 影响），
 *    而列表里显示的大小必须是"服务端实际存了多少"。
 *    ⚠️ 客户端估算**只用来自拒**太离谱的文件（省一次 20 MB 的白传），
 *    从不拿它当写进实体的事实。
 *
 * 3. **上传通道是一个注入的端口**（{@link AttachmentBlobPort}），不是内部 import。
 *    两个理由：(a) 本机测试要能在**不碰网络**的情况下跑完"上传失败 ⇒ 不许写 op"
 *    这条最重要路径；(b) 不是每台设备都配得起这个端口 —— 没登录、没服务端地址时，
 *    动作层要能说清是"这台设备没接上传通道"，而不是让界面去猜。
 *    与 `comment-actions.ts` 的 `dispatchShareOp` 同一条先例。
 *
 * 4. **删附件 = 两条腿，而且顺序是"先发 op"。**
 *    `DEL` op 是用户能看见的那一半（列表里消失了），字节回收是账号侧的账务。
 *    先删字节再发 op 的话，op 失败会留下"列表里还在、点开就报错"的附件 ——
 *    那是本文件第 1 条刚刚否决过的同一个形状，不能在同一份代码里犯两次。
 *    op 成功后字节删除失败 ⇒ 返回 `{ bytesReleased: false }`，
 *    **列表状态仍然正确**（用户要的后果已达成），多占的额度由服务端孤儿扫描回收。
 *
 * 5. **改名是一条纯 op**，不碰字节。
 *    `fileName` 只是展示名：服务端存与取都以 `id` 为键，所以改名
 *    不可能把文件改坏。这条写在这是为了拦住"改名要重新上传"那种实现 ——
 *    它会让用户以为改个名字要等一次上传。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 🔴 本文件**不做加密**。字节按 ADR-0081 在上传前已由整库档位决定形态，
 * 领域层与动作层看到的都是"一串 base64"，这是刻意的无知（见契约文件头）。
 */

import {
  aliveAttachmentsForTask,
  attachmentBytesTotal,
  attachmentRejection,
  type Attachment,
} from '@heyta/domain';
import { MAX_ATTACHMENT_BYTES } from '@heyta/shared-schema';
import type { EntityType } from '@heyta/shared-schema';
import { OpType } from '@heyta/sync-core';

import type { ActionContext } from './actions.js';
import type { AttachmentBlobPort } from './attachment-http.js';
import { randomId } from './ids.js';

/** 建附件的输入。`dataBase64` 已经是最终形态（明文字节或整库档密文）。 */
export interface NewAttachmentFields {
  /** 展示用文件名（含扩展名）。空白 / 超长会被领域层拒绝。 */
  fileName: string;
  /** MIME 类型；缺 = 未知，界面降级为通用文件图标。 */
  contentType?: string;
  dataBase64: string;
}

export interface AttachmentActionsOptions {
  /** 字节通道。不注入 ⇒ 三个写动作都会明确拒绝（见文件头第 3 条）。 */
  blobs?: AttachmentBlobPort;
  /** 附件 id 生成器。可注入的理由与 `TaskActionsOptions.newTaskId` 相同：结构性断言不该靠随机数。 */
  newAttachmentId?: () => string;
}

export interface AttachmentActions {
  /**
   * 加一个附件：传字节 → 发 CREATE op。
   *
   * 返回服务端的回执（`hash` / 实际字节数），让调用方能立刻把"已用额度"更新，
   * 不必等一次全量刷新。
   *
   * 🔴 **抛错的情形只有三种**，而且都保证"没有半条附件留在列表里"：
   * 文件名不合法 · 这台设备没接上传通道 · 字节上传没成（含太大 / 额度满 / 断网）。
   * op 写入本身失败时，方法会先尽力回收刚上传的 blob 再抛。
   */
  addAttachment(taskId: string, fields: NewAttachmentFields): Promise<{ id: string; hash: string; byteCount: number }>;
  /** 改展示名（纯 op，不碰字节）。 */
  renameAttachment(attachmentId: string, fileName: string): Promise<void>;
  /** 移除附件：发 `DEL` op，随后尽力回收字节。 */
  removeAttachment(attachmentId: string): Promise<{ bytesReleased: boolean }>;
  /** 某条任务下的附件（软删的不进，`createdAt` 升序）。判据与顺序都来自领域层。 */
  attachmentsForTask(taskId: string): Attachment[];
  /** 某条任务下附件的字节合计（显示用）。 */
  attachmentBytesForTask(taskId: string): number;
}

export function createAttachmentActions(
  ctx: ActionContext,
  options: AttachmentActionsOptions = {},
): AttachmentActions {
  const makeAttachmentId = options.newAttachmentId ?? ((): string => `att-${randomId()}`);
  const blobs = options.blobs;

  const attachmentOf = (entityId: string): Attachment | undefined => {
    const row = ctx.getState().attachments[entityId];
    if (row === undefined || row.deletedAt !== undefined) return undefined;
    return row;
  };

  /**
   * 取上传通道，没有就说清是**哪一件事没有**。
   *
   * 🔴 返回而不是"断言 + 非空 `!`"：那样 TS 推不出窄化，代码里会留一串感叹号，
   * 而每一个感叹号都是一处"类型说没事，运行时未必"的债务。
   */
  const requireChannel = (): AttachmentBlobPort => {
    if (blobs === undefined) {
      throw new Error('这台设备没有可用的上传通道（no-channel）');
    }
    return blobs;
  };

  const aliveAttachments = (): Attachment[] => Object.values(ctx.getState().attachments);

  return {
    async addAttachment(taskId, fields) {
      const task = ctx.getState().tasks[taskId];
      if (task === undefined || task.deletedAt !== undefined) {
        throw new Error(`找不到任务「${taskId}」（附件必须挂在一条活着的任务上）`);
      }
      const rejection = attachmentRejection(fields.fileName);
      if (rejection !== undefined) {
        throw new Error(
          `附件名不合法（${rejection}）：${fields.fileName.slice(0, 40)}`,
        );
      }
      const channel = requireChannel();

      // 客户端估算只用于"先拦一道"，真实数字以服务端回执为准（文件头第 2 条）。
      const estimatedBytes = Math.floor((fields.dataBase64.length * 3) / 4);
      if (estimatedBytes > MAX_ATTACHMENT_BYTES) {
        throw new Error(`附件太大（too-large）：约 ${String(estimatedBytes)} 字节`);
      }

      const id = makeAttachmentId();
      const uploaded = await channel.upload(id, fields.dataBase64, fields.contentType ?? 'application/octet-stream');
      if (!uploaded.ok) {
        // 🔴 一个字节都不写进 op-log：这条附件对用户来说**根本不存在过**。
        throw new Error(`上传失败（${uploaded.reason}）`);
      }

      try {
        await ctx.dispatch({
          entityType: 'ATTACHMENT' as EntityType,
          entityId: id,
          opType: OpType.Create,
          payload: {
            taskId,
            fileName: fields.fileName.trim(),
            // 🔴 `null` 而不是省略：reducer 对 `CRT` 是合并语义，省略等于"不动它"，
            // 而新建时没有任何东西要保留（`note-actions.ts` 同一条）。
            mimeType: fields.contentType ?? null,
            sizeBytes: uploaded.receipt.byteCount,
          },
        });
      } catch (e: unknown) {
        // op 没写成 ⇒ 那块字节已经没有主人。尽力回收，失败也不掩盖原始错误。
        await channel.remove(id).catch(() => undefined);
        throw e;
      }

      return { id, hash: uploaded.receipt.hash, byteCount: uploaded.receipt.byteCount };
    },

    async renameAttachment(attachmentId, fileName) {
      if (attachmentOf(attachmentId) === undefined) {
        throw new Error(`找不到附件「${attachmentId}」`);
      }
      const rejection = attachmentRejection(fileName);
      if (rejection !== undefined) throw new Error(`附件名不合法（${rejection}）`);
      const next = fileName.trim();
      /**
       * 🔴 名字没变就不写 op —— 与 `updateNoteContent` 同一条闸门、同一个理由：
       * `UPD` 会推进 `updatedAt`，而它是对账与"最近改动"排序的输入。
       * "点开看一眼、什么都没改、退出去"不该在日志里留下一条事实。
       */
      if (next === attachmentOf(attachmentId)?.fileName) return;
      await ctx.dispatch({
        entityType: 'ATTACHMENT' as EntityType,
        entityId: attachmentId,
        opType: OpType.Update,
        payload: { fileName: next },
      });
    },

    async removeAttachment(attachmentId) {
      if (attachmentOf(attachmentId) === undefined) {
        throw new Error(`找不到附件「${attachmentId}」`);
      }
      // 文件头第 4 条：op 先走，字节随后。
      await ctx.dispatch({
        entityType: 'ATTACHMENT' as EntityType,
        entityId: attachmentId,
        opType: OpType.Delete,
        payload: {},
      });
      if (blobs === undefined) return { bytesReleased: false };
      const removed = await blobs.remove(attachmentId);
      return { bytesReleased: removed.ok };
    },

    attachmentsForTask(taskId) {
      // 过滤与顺序都在领域层（单点定义，见 `domain/src/attachments.ts`）。
      return aliveAttachmentsForTask(aliveAttachments(), taskId);
    },

    attachmentBytesForTask(taskId) {
      return attachmentBytesTotal(this.attachmentsForTask(taskId));
    },
  };
}
