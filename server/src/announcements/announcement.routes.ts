/**
 * 用户侧的公告读面：`GET /api/announcements/active`。
 * ====================================================
 *
 * 依据：[`docs/adr/0075-announcements-are-a-content-channel.md`](../../../docs/adr/0075-announcements-are-a-content-channel.md)。
 *
 * ## 为什么它要 token（而调休那条不要）
 *
 * ADR-0052 那条匿名只读回答过三个问题：谁限流、响应多大、怎么不每次全量发。
 * 这一条**不**走同一条路，因为它服务的是"登录进来之后应用顶部那一横条" ——
 * 调用方本来就已经带着会话。挂鉴权换来两件事：不用新造一档限流，
 * 以及未登录的公开面上不会出现部署方写的自由文本（那是一条**对外**的言论渠道，
 * 而公告的读者是用户，不是搜索引擎）。
 *
 * 🔴 载荷里**没有身份维度**：路径不带 `:id`、查询串不接受 `userId`、
 * 响应与调用方无关。所以它虽然要 token，仍然不是"账号级事实"——
 * 与 `admin-client` 那 5 条要 token 的读请求区别在这里。
 *
 * ## 投影
 *
 * 只出 `id / title / body / level / publishedAt / expiresAt`。
 * `createdBy` **不给用户侧**：它是运营归属记录，用户不需要知道是谁发的，
 * 而"发公告的那个人是谁"在一个一人运营的产品里会指向一个具体自然人。
 */
import { FastifyInstance } from 'fastify';

import { authenticate } from '../middleware';
import { listActiveAnnouncements } from './announcement-store';

export const announcementRoutes = async (fastify: FastifyInstance): Promise<void> => {
  fastify.get(
    '/announcements/active',
    { preHandler: authenticate },
    async (_req, reply) => {
      const now = Date.now();
      const announcements = await listActiveAnnouncements(now);
      return reply.send({
        // 服务端此刻的读数。界面不许拿它跟自己本地的时间戳再比一次
        // （ADR-0075 §3.4：有效性只有一个裁决者）。
        now,
        announcements: announcements.map((item) => ({
          id: item.id,
          title: item.title,
          body: item.body,
          level: item.level,
          publishedAt: item.publishedAt,
          expiresAt: item.expiresAt,
        })),
      });
    },
  );
};
