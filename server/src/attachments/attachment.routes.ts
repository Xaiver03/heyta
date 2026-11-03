/**
 * 任务附件字节的 HTTP 面（工单 `task-detail-ticktick-parity` #9）。
 *
 * | 方法   | 路径                        | 用途 |
 * |---|---|---|
 * | PUT    | `/api/attachments/:attachmentId` | 上传/覆盖一个附件的字节 |
 * | DELETE | `/api/attachments/:attachmentId` | 回收字节 |
 *
 * 🔴 **没有 `GET`（读字节）**，不是漏了：这一轮的界面只做"上传 + 列表 + 移除"，
 * 读端点没有消费者。理由与那条守着它的断言都写在下面 DELETE 那一块的注释里。
 *
 * ## 🔴 身份一律取自令牌，id 只是"哪一个"，不是"谁的"
 *
 * 三条路由都只看 `getAuthUser(req).userId`，而 `attachmentId` **永远与 userId 一起**
 * 出现在 `where` 里。少带那一半的后果是：任何人知道自己那个 id 就能读到别人的文件
 * —— 而 id 是客户端生成的，跨账号猜中不可能，但**同一份 URL 被复制粘贴进聊天**
 * 是完全可能的（用户会这么做）。⇒ 鉴权判据是 `(attachmentId, userId)` 这一对。
 *
 * ## 为什么是 JSON + base64，而不是裸字节流 / multipart
 *
 * 与 `account-profile.routes.ts` 的头像同一个选择，同一个理由：
 * 走 JSON body 复用既有上传形态与鉴权中间件，**不引新依赖**（AGENTS.md §3.1/§3.2
 * 那道门不是拿来绕的）。代价是体积膨胀 4/3 —— 用
 * `MAX_ATTACHMENT_UPLOAD_BASE64_BYTES` 显式接住，而不是让全局 20 MB 去撞。
 *
 * ## 🔴 配额：这张表的字节**不进** `users.storage_used_bytes`
 *
 * 那个计数器是 **op-log + 快照**的缓存值，它的对账路径（`calculateStorageUsage`
 * 扫描、clean-slate 归零）只认识 op 与快照两种来源。把附件字节加进去，任何一次
 * 对账都会**静默抹掉**它们（症状：配额显示突然变小）。
 * ⇒ 闸门把两项**相加**后再判：`checkStorageQuota(userId, attachmentBytes + newBytes)`。
 * 头像是同一个先例（它的字节也从不进那个计数器）。
 *
 * `SUM(byte_count)` 走 `attachment_blobs_user_id_idx`，不碰 `data` 那一列 ——
 * 这正是 `byte_count` 存在的原因：按账号求和不能把几十 MB 的字节读进内存。
 *
 * ## ⚠️ 服务端**不解读**内容（ADR-0081）
 *
 * 明文档下 `data` 就是文件本身，E2EE 档下是客户端密文。服务端只知道长度与
 * `content_type` 这两个数字，不做任何格式校验 —— 校验它读不懂的东西不是安全，
 * 是把自己绑到一个它没有钥匙的前提上。
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  ATTACHMENT_ERROR_CODES,
  ATTACHMENT_ID_REGEX,
  ATTACHMENT_ROUTE_PATTERN,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_UPLOAD_BASE64_BYTES,
  attachmentUploadSchema,
} from '@heyta/shared-schema';

import { prisma } from '../db';
import { Logger } from '../logger';
import { authenticate, getAuthUser } from '../middleware';
import { StorageQuotaService } from '../sync/services/storage-quota.service';

/**
 * 只用于**只读**的配额判定（`checkStorageQuota` 是一次 SELECT）。
 *
 * ⚠️ 这不是"第二个计数器"：本模块从不写 `users.storage_used_bytes`，
 * 所以不需要与 `SyncService` 共享那个实例里的 per-user 锁。
 * 读侧唯一的差别是它带着自己的（空）`forcedReconciles` 集合，
 * 即"不替别人触发重扫" —— 重扫仍由同步那条路负责。
 */
const storageQuota = new StorageQuotaService();

/**
 * 账号下已有附件字节的总和。
 *
 * 用 `byte_count` 列而不是 `octet_length(data)`：后者会把每一块字节从 TOAST
 * 里读出来再算长度 —— 一次上传请求里做这件事，等于让用户为"检查额度"下载
 * 自己所有的附件。
 */
async function attachmentBytesFor(userId: number): Promise<number> {
  const aggregated = await prisma.attachmentBlob.aggregate({
    _sum: { byteCount: true },
    where: { userId },
  });
  return aggregated._sum.byteCount ?? 0;
}

export async function attachmentRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * 上传/覆盖字节。
   *
   * 🔴 `hash` 与 `byteCount` 都由**服务端**从解码后的 buffer 算，客户端报的
   * 任何数字都不参与判定。客户端虚报 `sizeBytes: 1` 改变不了它落在配额上的值。
   */
  fastify.put(
    ATTACHMENT_ROUTE_PATTERN,
    {
      // base64 上限再加一点余量给 JSON 信封（键名 + contentType）。
      // ⚠️ `bodyLimit` 是**路由选项**，不是 `config` 的键 —— 写错位置的后果是限制静默失效。
      bodyLimit: MAX_ATTACHMENT_UPLOAD_BASE64_BYTES + 512,
      config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
      preHandler: authenticate,
    },
    async (req, reply) => {
      const { attachmentId } = req.params as { attachmentId: string };
      if (!ATTACHMENT_ID_REGEX.test(attachmentId)) {
        return reply.status(400).send({
          code: 'validation_failed',
          message: 'Invalid attachment id.',
        });
      }
      const parsed = attachmentUploadSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: 'validation_failed',
          message: 'Validation failed',
          details: parsed.error.issues,
        });
      }

      try {
        const { userId } = getAuthUser(req);
        // Prisma 的 `Bytes` 要 Buffer（包一层 `new Uint8Array(...)` 会 TS2740）。
        const data = Buffer.from(parsed.data.dataBase64, 'base64');
        const byteCount = data.length;

        // zod 限的是 base64 文本长度；这一道限的是**解码后**的真实字节数。
        if (byteCount > MAX_ATTACHMENT_BYTES) {
          return reply.status(413).send({
            code: ATTACHMENT_ERROR_CODES.tooLarge,
            message: `Attachment exceeds ${String(
              Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024)),
            )} MiB.`,
            maxBytes: MAX_ATTACHMENT_BYTES,
            receivedBytes: byteCount,
          });
        }

        // 覆盖同一个附件时，旧的字节不该继续占着额度。
        const existing = await prisma.attachmentBlob.findFirst({
          where: { attachmentId, userId },
          select: { byteCount: true },
        });
        const replacementCredit = existing?.byteCount ?? 0;
        const needed = byteCount - replacementCredit;
        if (needed > 0) {
          const alreadyStored = await attachmentBytesFor(userId);
          const verdict = await storageQuota.checkStorageQuota(
            userId,
            alreadyStored + needed,
          );
          if (!verdict.allowed) {
            return reply.status(507).send({
              code: ATTACHMENT_ERROR_CODES.quotaExceeded,
              message: 'Storage quota exceeded.',
              quotaBytes: verdict.quota,
              usedBytes: verdict.currentUsage + alreadyStored,
            });
          }
        }

        const hash = createHash('sha256').update(data).digest('hex');
        const now = BigInt(Date.now());
        await prisma.attachmentBlob.upsert({
          where: { attachmentId },
          create: {
            attachmentId,
            userId,
            data,
            byteCount,
            contentType: parsed.data.contentType,
            hash,
            createdAt: now,
            updatedAt: now,
          },
          update: { data, byteCount, contentType: parsed.data.contentType, hash, updatedAt: now },
        });
        return reply.send({ hash, byteCount });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Attachment upload error: ${errMsg}`);
        return reply.status(500).send({ code: 'failed_to_store_attachment', message: 'Failed to store attachment.' });
      }
    },
  );

  /**
   * 回收字节。
   *
   * 🔴 **这一族上没有 `GET`（读字节）** —— 不是漏了。契约文件
   * `attachment-http-contract.ts` 在 `ATTACHMENT_ROUTES` 那段写了为什么：
   * 这一轮没有任何界面能用它，而"没人调的读端点"正是本仓库反复清理的形状。
   * `packages/shared-schema/tests/attachment-contract.spec.ts` 有一条
   * `Object.keys(ATTACHMENT_ROUTES)` 的断言守着它 —— 谁补 GET 就必须同时补上消费者。
   *
   * 用 `deleteMany` 而不是 `delete`：后者在"本来就没有"时抛 `P2025`，而那**正是**
   * 用户点删除后想要到达的状态（头像同一个坑）。
   *
   * ⚠️ 它**只**删字节，不动 op-log 里的附件实体 —— 墓碑由 `removeAttachment`
   * 那条 action 的 `DEL` op 负责。两件事分头做是对的（一个用户意图 = 一个 op，
   * 而字节回收不是 op），但意味着**界面必须两个都调**：只调这里会让附件
   * 在列表里继续显示、点开就报 404；只发 op 会把字节留在服务端占额度。
   * 这个"两个都要"的契约落在 `packages/app-host/src/attachment-actions.ts`，
   * 不许各端自己拼。
   */
  fastify.delete(
    ATTACHMENT_ROUTE_PATTERN,
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      const { attachmentId } = req.params as { attachmentId: string };
      if (!ATTACHMENT_ID_REGEX.test(attachmentId)) {
        return reply.status(400).send({ code: 'validation_failed', message: 'Invalid attachment id.' });
      }
      try {
        const { userId } = getAuthUser(req);
        const target = await prisma.attachmentBlob.findFirst({
          where: { attachmentId, userId },
          select: { byteCount: true },
        });
        await prisma.attachmentBlob.deleteMany({ where: { attachmentId, userId } });
        // 回释放了多少，让客户端能把"已用量"就地降下来，而不是等一次全量刷新。
        return reply.send({ releasedBytes: target?.byteCount ?? 0 });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Attachment delete error: ${errMsg}`);
        return reply.status(500).send({ code: 'failed_to_remove_attachment', message: 'Failed to remove attachment.' });
      }
    },
  );
}
