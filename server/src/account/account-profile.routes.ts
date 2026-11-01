/**
 * 账号资料（昵称 + 头像）的 HTTP 面。R10。
 *
 * ## 五条路由，全部要求登录
 *
 * | 方法   | 路径                    | 用途 |
 * |---|---|---|
 * | GET    | `/api/account/profile`  | 读自己的资料（昵称 + `avatarHash`，**不含**任何图片字节） |
 * | PUT    | `/api/account/profile`  | 改昵称 |
 * | PUT    | `/api/account/avatar`   | 上传头像（**明文**图片载荷） |
 * | GET    | `/api/account/avatar`   | 取头像（本人，另一台设备用） |
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
 * ## 🔴 头像是**基础资料**，明文存储（ADR-0079，2026-11-01 绝对决策）
 *
 * 昵称与头像只用来"认出这个账号"，不是用户的实质内容。端到端加密只留给任务、
 * 便签这类实质内容。⇒ 这条路由收的是 `{contentType, dataBase64}` 明文，
 * 服务端**能且必须**自己校验格式白名单与解码后的字节上限
 *（`ACCOUNT_AVATAR_MAX_SOURCE_BYTES`）—— 不再有"服务端看不到内容"这个前提。
 *
 * 明文 ≠ 公开：GET 仍要求 Bearer，只回本人那一行；没有按别人身份查资料的端点。
 *
 * 走 JSON body（base64）而不是 multipart：与既有上传同形，不引新依赖。
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  ACCOUNT_PROFILE_PATHS,
  ACCOUNT_AVATAR_MAX_UPLOAD_BASE64_BYTES,
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
   * 上传头像（明文图片载荷）。
   *
   * 🔴 `hash` 由**服务端**算，客户端**不参与**：它就是**图片字节**的 SHA-256。
   * 两端各算一次的话，Hermes 上没有 `crypto.subtle`，会算出两个 hash
   * ⇒ 客户端把服务端返回的 `avatarHash` 当缓存键用，自己一个字节都不算。
   */
  fastify.put(
    `/${ACCOUNT_PROFILE_PATHS.avatar}`,
    {
      // 上传体 1 MiB（base64 后），比全局 20 MB 小一个量级 —— 头像不该能占满请求体额度。
      // ⚠️ `bodyLimit` 是**路由选项**，不是 `config` 的键。放进 `config` 里 TypeScript 会报
      // TS2769，但 `config` 本身是自由形状 —— 写错位置的后果是"限制静默失效"。
      bodyLimit: ACCOUNT_AVATAR_MAX_UPLOAD_BASE64_BYTES,
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
        const { contentType, dataBase64 } = parsed.data;

        const { userId } = getAuthUser(req);
        // Prisma 的 `Bytes` 要 Buffer（包一层 `new Uint8Array(...)` 会 TS2740）。
        const data = Buffer.from(dataBase64, 'base64');
        const hash = createHash('sha256').update(data).digest('hex');

        await prisma.userAvatar.upsert({
          where: { userId },
          create: { userId, data, contentType, hash, updatedAt: BigInt(Date.now()) },
          update: { data, contentType, hash, updatedAt: BigInt(Date.now()) },
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
   * 取头像（本人；另一台设备用）。
   *
   * 返回 JSON 里的 `{contentType, dataBase64, avatarHash}`，不是 `image/*` 字节流：
   * 客户端已经有"带 Bearer 取回再拼 data URI"的通道，做成直链会把鉴权从令牌
   * 挪到 URL 上（要么公开、要么引入签名 URL），那是另一套东西。
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
          select: { data: true, contentType: true, hash: true },
        });
        if (row === null) {
          return reply.status(404).send({ code: 'avatar-absent', message: 'No avatar.' });
        }
        return reply.send({
          contentType: row.contentType,
          dataBase64: Buffer.from(row.data).toString('base64'),
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
