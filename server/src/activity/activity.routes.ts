/**
 * 「通知中心 + 活动（福利中心）」的 HTTP 面。
 *
 * ## 三条路由，都要求登录
 *
 * | 方法 | 路径 | 用途 |
 * |---|---|---|
 * | GET  | `/api/notifications`      | 通知列表 + 未读数 |
 * | POST | `/api/notifications/read` | 标记已读（指定 id 或全部） |
 * | GET  | `/api/activity`           | 活动列表 + 邀请进度 |
 *
 * ## 🔴 身份一律取自令牌，不取自请求体
 *
 * 三条路由都只看 `getAuthUser(req).userId`。`ids` 是唯一从外面进来的标识，
 * 而它在 `markNotificationsRead` 里被**同时**用 `userId` 圈住 ——
 * 只按 id 更新等于让任何登录用户改别人的数据。
 *
 * ## 为什么列表都包一层对象
 *
 * `{ notifications: [...] }` 而不是裸数组：以后要加分页游标是加法，
 * 不是破坏性变更（`api.ts` 的 passkeys 路由同形）。
 */
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { CAMPAIGN_CATALOG, type CampaignId, type CampaignKind } from '@heyta/domain';

import { Logger } from '../logger';
import { authenticate, getAuthUser } from '../middleware';
import { getActivitySummary, type ActivitySummary } from './invite';
import {
  NOTIFICATION_LIST_DEFAULT_LIMIT,
  listNotifications,
  markNotificationsRead,
} from './notifications';

/**
 * 通知列表的 `limit`。
 *
 * 用字符串查询参数（HTTP 查询串里一切都是字符串），所以这里 `coerce` 成数字。
 * 非法值**不报错**，回落到默认值 —— 一个坏掉的 `limit` 不该让整个通知面板打不开。
 */
const NotificationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/**
 * 标记已读的请求体。
 *
 * 🔴 `all` 与 `ids` 必须**显式二选一**，刻意不做"缺省即全部"：
 * 一个客户端 bug 让 `ids` 变成 `undefined`，在"缺省即全部"的语义下会
 * **静默清空用户的未读徽标**，而用户唯一的感受是"我的通知怎么都变已读了"，
 * 没有任何报错可查。二选一让这种请求当场 400。
 */
const MarkReadSchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(z.number().int().positive()).min(1).max(200) }),
]);

/** 活动列表的一条。`invite` 只在 `kind === 'invite'` 时出现。 */
interface CampaignRow {
  readonly id: CampaignId;
  readonly kind: CampaignKind;
  readonly invite?: ActivitySummary;
}

export async function activityRoutes(fastify: FastifyInstance): Promise<void> {
  // 通知列表
  fastify.get(
    '/notifications',
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 120, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      try {
        const { userId } = getAuthUser(req);
        const parsed = NotificationListQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          return reply.status(400).send({
            code: 'validation_failed',
            message: 'Validation failed',
            details: parsed.error.issues,
          });
        }
        const limit = parsed.data.limit ?? NOTIFICATION_LIST_DEFAULT_LIMIT;
        const { notifications, unreadCount } = await listNotifications(userId, limit);
        return reply.send({ notifications, unreadCount });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Notification list error: ${errMsg}`);
        return reply.status(500).send({ code: 'failed_to_load_notifications', message: 'Failed to load notifications.' });
      }
    },
  );

  // 标记已读
  fastify.post(
    '/notifications/read',
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 120, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      try {
        const { userId } = getAuthUser(req);
        const parsed = MarkReadSchema.safeParse(req.body);
        if (!parsed.success) {
          return reply.status(400).send({
            code: 'validation_failed',
            message: 'Validation failed',
            details: parsed.error.issues,
          });
        }
        const ids = 'ids' in parsed.data ? parsed.data.ids : null;
        const { updated, unreadCount } = await markNotificationsRead(
          userId,
          ids,
          Date.now(),
        );
        return reply.send({ updated, unreadCount });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Notification mark-read error: ${errMsg}`);
        return reply.status(500).send({ code: 'failed_to_update_notifications', message: 'Failed to update notifications.' });
      }
    },
  );

  // 活动（福利中心）
  fastify.get(
    '/activity',
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 60, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      try {
        const { userId } = getAuthUser(req);
        const now = Date.now();

        // 活动目录是静态配置（见 domain 的 `CAMPAIGN_CATALOG`），
        // 但每一项的**进度**是按用户算的 —— 所以这里不是简单地把配置回显出去。
        const campaigns: CampaignRow[] = [];
        for (const definition of CAMPAIGN_CATALOG) {
          if (definition.kind === 'invite') {
            campaigns.push({
              id: definition.id,
              kind: definition.kind,
              invite: await getActivitySummary(userId, now),
            });
            continue;
          }
          // 未来会有别的 kind。`CampaignKind` 是联合类型，所以漏掉一个分支
          // 在类型检查期就会红 —— 这里不需要 default。
        }

        return reply.send({ campaigns });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Activity list error: ${errMsg}`);
        return reply.status(500).send({ code: 'failed_to_load_activities', message: 'Failed to load activities.' });
      }
    },
  );
}
