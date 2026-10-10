/**
 * 账号资料（昵称 + 头像）的 HTTP 面。R10。
 *
 * ## 五条路由，全部要求登录
 *
 * | 方法   | 路径                    | 用途 |
 * |---|---|---|
 * | GET    | `/api/account/profile`  | 读自己的资料（昵称 + `avatarHash`，**不含**任何图片字节） |
 * | PUT    | `/api/account/profile`  | 改昵称 |
 * | PUT    | `/api/account/avatar`   | 上传**密文**头像 |
 * | GET    | `/api/account/avatar`   | 取密文头像（给另一台设备用） |
 * | DELETE | `/api/account/avatar`   | 移除头像 |
 *
 * ## 🔴 身份一律取自令牌，不取自输入
 *
 * 五条都只看 `getAuthUser(req).userId`。**没有**任何一条接受 `userId` / `email` 参数，
 * 所以"查别人的资料"在这套路由里**写不出来** —— 不是被拒绝了，是没有那条路。
 * 这是 §8.6 那条边界（今天无协作 ⇒ 不做公开可读）在代码里的形态。
 *
 * ## 路径只有一个来源
 *
 * 注册时拼的是 `` `/${ACCOUNT_PROFILE_PATHS.profile}` ``，而客户端从同一个常量取
 *（`packages/shared-schema/src/account-profile-contract.ts`）。
 * ⚠️ 契约与实现漂移的症状是 404，而不是报错 —— 所以这里**不靠**测试兜，靠只有一个字面量。
 *
 * ## 为什么头像是密文，以及密文为什么不需要上传通道
 *
 * 见 `server/prisma/schema.prisma` 的 `UserAvatar` 那段（法务表 E 的结构性依据）
 * 与 `docs/plans/ui-review-fill-zh-timeline.md` §8.6。
 * 线上传的是 `encrypt()` 的 base64 输出，走 JSON body ⇒ 与 op 上传**完全同形**：
 * 不需要 multipart、不需要自定义 content type parser、不引入任何新依赖。
 *
 * 🔴 而且"它是不是密文"用的就是**同步通道那一道闸门**
 *（`isEncryptedPayloadTransportShape`，`server/src/sync/sync.routes.payload.ts:48` 同款），
 * 不是为头像另写一份形状校验 —— 两份校验一定会漂。
 *
 * ## ⚠️ 服务端**不**校验原图大小，因为它做不到
 *
 * 它看不到明文，所以 `ACCOUNT_AVATAR_MAX_SOURCE_BYTES`（512 KB 原图）是**客户端纪律**。
 * 服务端能强制的是密文上限（`ACCOUNT_AVATAR_MAX_CIPHER_BASE64_BYTES`）。
 * 把这条写明白，是为了不让下一个人以为服务端兜住了原图体积。
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { isEncryptedPayloadTransportShape } from '@heyta/sync-core';
import {
  ACCOUNT_PROFILE_PATHS,
  ACCOUNT_AVATAR_MAX_CIPHER_BASE64_BYTES,
  accountAvatarUpdateSchema,
  accountDisplayNameSchema,
  accountProfileUpdateSchema,
  displayNameCodePoints,
} from '@heyta/shared-schema';

import { prisma } from '../db';
import { Logger } from '../logger';
import { authenticate, getAuthUser } from '../middleware';
import { readAccountProfile } from './account-profile.store';

export async function accountProfileRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    `/${ACCOUNT_PROFILE_PATHS.profile}`,
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 120, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      try {
        const { userId } = getAuthUser(req);
        return reply.send(await readAccountProfile(userId));
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Account profile read error: ${errMsg}`);
        return reply.status(500).send({ code: 'failed_to_load_profile', message: 'Failed to load profile.' });
      }
    },
  );

  /**
   * 改昵称。校验规则来自 `@heyta/shared-schema`（两端同一个数），
   * 而 🔴 **服务端是唯一裁决者**：客户端的 `maxLength` 只是让人少打几个字。
   */
  fastify.put(
    `/${ACCOUNT_PROFILE_PATHS.profile}`,
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      try {
        const parsed = accountProfileUpdateSchema.safeParse(req.body);
        if (!parsed.success) {
          return reply.status(400).send({
            code: 'validation_failed',
            message: 'Validation failed',
            details: parsed.error.issues,
          });
        }
        const { userId } = getAuthUser(req);
        const displayName = parsed.data.displayName;
        await prisma.user.update({
          where: { id: userId },
          data: { displayName },
        });
        return reply.send(await readAccountProfile(userId));
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Account profile update error: ${errMsg}`);
        return reply.status(500).send({ code: 'failed_to_update_profile', message: 'Failed to update profile.' });
      }
    },
  );

  /**
   * 上传密文头像。
   *
   * 🔴 `hash` 由**服务端**算，客户端**不参与**：
   * 定义是"密文字节（base64 解码后）的 SHA-256"，如果两端各算一次，
   * Hermes 上没有 `crypto.subtle`（这条仓库已经为同类问题付过一次代价，
   * 见 legacy 密文在移动端无纯 JS 兜底那次），两端就会算出两个 hash。
   * ⇒ 客户端把服务端返回的 `avatarHash` 当缓存键用，自己一个字节都不算。
   */
  fastify.put(
    `/${ACCOUNT_PROFILE_PATHS.avatar}`,
    {
      // 密文上限 2 MiB，比全局 20 MB 的 `bodyLimit` 小一个量级 —— 头像不该能占满请求体额度。
      // ⚠️ `bodyLimit` 是**路由选项**，不是 `config` 的键。放进 `config` 里 TypeScript 会报
      // TS2769（这次就是这么发现的），但 `config` 本身是自由形状 —— 也就是说
      // 写错位置的后果是"限制静默失效"，而不是运行时报错。
      bodyLimit: ACCOUNT_AVATAR_MAX_CIPHER_BASE64_BYTES,
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
      preHandler: authenticate,
    },
    async (req, reply) => {
      try {
        const parsed = accountAvatarUpdateSchema.safeParse(req.body);
        if (!parsed.success) {
          return reply.status(400).send({
            code: 'validation_failed',
            message: 'Validation failed',
            details: parsed.error.issues,
          });
        }
        const { cipherBase64 } = parsed.data;

        // 🔴 与同步通道**同一道**闸门：只收密文形状。
        if (!isEncryptedPayloadTransportShape(cipherBase64)) {
          return reply.status(400).send({
            code: 'payload-not-encrypted',
            message: 'Avatar payload must be an encrypted blob',
          });
        }

        const { userId } = getAuthUser(req);
        // Prisma 的 `Bytes` 要 Buffer（包一层 `new Uint8Array(...)` 会 TS2740）。
        const cipher = Buffer.from(cipherBase64, 'base64');
        // ⚠️ 这里**曾经**有一条"解出零字节就 400"的兜底，已删。理由值得留着：
        // 上面的形状闸门要求"长度 % 4 == 0 + 规范字母表 + 至少 28 字节"，
        // 而满足这三条的串解码后**不可能**是 0 字节 —— `Buffer.from(_, 'base64')`
        // 静默丢无效字符那件事，恰恰被"只接受规范字母表"这一步挡在外面了。
        // 判据实测：能同时过闸门的输入里，最短的那条解出 28 字节。
        // AGENTS §8 的"不许为不可能发生的场景写错误处理"，这一条就是它。
        const hash = createHash('sha256').update(cipher).digest('hex');

        await prisma.userAvatar.upsert({
          where: { userId },
          create: { userId, cipher, hash, updatedAt: BigInt(Date.now()) },
          update: { cipher, hash, updatedAt: BigInt(Date.now()) },
        });
        return reply.send({ avatarHash: hash });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Avatar upload error: ${errMsg}`);
        return reply.status(500).send({ code: 'failed_to_store_avatar', message: 'Failed to store avatar.' });
      }
    },
  );

  /**
   * 取密文头像（另一台设备用）。
   *
   * ⚠️ 返回的是 **JSON 里的 base64**，不是 `image/*` 字节流。
   * 这是有意的：图本来就得先解密才能显示，做成 `<img src>` 直链反而要求
   * 服务端能给出明文图片 —— 那正是这一整段要避免的东西。
   * 没有头像时回 404 + 结构化 code，不回 200 + 空串（"没有"和"是空的"是两件事）。
   */
  fastify.get(
    `/${ACCOUNT_PROFILE_PATHS.avatar}`,
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 120, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      try {
        const { userId } = getAuthUser(req);
        const row = await prisma.userAvatar.findUnique({
          where: { userId },
          select: { cipher: true, hash: true },
        });
        if (row === null) {
          return reply.status(404).send({ code: 'avatar-absent', message: 'No avatar.' });
        }
        return reply.send({
          cipherBase64: Buffer.from(row.cipher).toString('base64'),
          avatarHash: row.hash,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Avatar read error: ${errMsg}`);
        return reply.status(500).send({ code: 'failed_to_load_avatar', message: 'Failed to load avatar.' });
      }
    },
  );

  /**
   * 移除头像。
   *
   * 用 `deleteMany` 而不是 `delete`：后者在"本来就没有头像"时抛 `P2025`，
   * 而那**正是**用户点「移除」时想要到达的状态。把幂等做成报错，
   * 症状是界面上"移除"按钮第二次点就失败。
   */
  fastify.delete(
    `/${ACCOUNT_PROFILE_PATHS.avatar}`,
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      try {
        const { userId } = getAuthUser(req);
        await prisma.userAvatar.deleteMany({ where: { userId } });
        return reply.send({ avatarHash: null });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Avatar delete error: ${errMsg}`);
        return reply.status(500).send({ code: 'failed_to_remove_avatar', message: 'Failed to remove avatar.' });
      }
    },
  );
}

/** 供测试与 `auth.ts` 复用，避免第二份校验逻辑。 */
export { accountDisplayNameSchema, displayNameCodePoints };
