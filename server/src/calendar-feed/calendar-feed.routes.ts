/**
 * 日历导出订阅源（`/calendar/<token>.ics`）
 * =======================================
 *
 * 让 Google / Outlook / Apple 订阅 heyta 的任务日历（只读）。两条路由：
 *
 * · `GET /api/calendar/feed-token`（需登录）：签发一个订阅 URL 给当前账号；
 * · `GET /calendar/:file`（公开、无 cookie）：校验 `<token>.ics` 的 HMAC 令牌，
 *   回放该账号 op-log 成物化状态 → `state.TASK` → `tasksToIcs` → `text/calendar`。
 *
 * ## 为什么能服务端生成
 *
 * 服务端已持有 op-log（`Operation` 表）并有 `replayOpsToState`（snapshot 生成与
 * `scripts/recover-user.ts` 共用）。可读（非 E2E）账号即可物化出任务；**E2E 加密账号**
 * 的 payload 是密文，回放会抛 `EncryptedOpsNotSupportedError` ⇒ 回 409，客户端侧仍可
 * 用「导出 .ics」下载。默认形态是可读，所以订阅源对默认用户可用。
 *
 * ## 安全
 *
 * 令牌 = HMAC(userId)，密钥 `CALENDAR_FEED_SECRET`（≥32 字节）；缺省则两条路由都 503
 * （功能禁用），绝不用弱默认密钥。响应 `cache-control: no-store`。
 */

import type { FastifyInstance } from 'fastify';

import { prisma } from '../db';
import { Logger } from '../logger';
import { authenticate, getAuthUser } from '../middleware';
import { replayOpsToState, type ReplayOperationRow } from '../sync/op-replay';
import { REPLAY_OPERATION_SELECT } from '../sync/services/snapshot-generation.service';

import { buildCalendarIcsFromState } from './feed';
import { signCalendarFeedToken, verifyCalendarFeedToken } from './token';

const MIN_SECRET_BYTES = 32;
const OP_BATCH_SIZE = 5000;

function feedSecret(): string | undefined {
  const secret = process.env.CALENDAR_FEED_SECRET?.trim() ?? '';
  return Buffer.byteLength(secret, 'utf8') >= MIN_SECRET_BYTES ? secret : undefined;
}

function publicUrl(): string {
  return (process.env.PUBLIC_URL?.trim() || 'http://localhost:3000').replace(/\/+$/u, '');
}

export async function calendarFeedRoutes(fastify: FastifyInstance): Promise<void> {
  // 签发订阅 URL（需登录）。
  fastify.get(
    '/api/calendar/feed-token',
    { preHandler: authenticate, config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const secret = feedSecret();
      if (secret === undefined) return reply.status(503).send({ code: 'calendar_feed_disabled' });
      const { userId } = getAuthUser(req);
      const token = signCalendarFeedToken(userId, secret);
      return reply.send({ url: `${publicUrl()}/calendar/${token}.ics` });
    },
  );

  // 公开订阅源（无 cookie）。`:file` 形如 `<token>.ics`。
  fastify.get(
    '/calendar/:file',
    { config: { rateLimit: { max: 120, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const secret = feedSecret();
      if (secret === undefined) return reply.status(503).send({ code: 'calendar_feed_disabled' });

      const file = (req.params as { file?: string }).file ?? '';
      if (!file.endsWith('.ics')) return reply.status(404).send({ code: 'not_found' });
      const userId = verifyCalendarFeedToken(file.slice(0, -'.ics'.length), secret);
      if (userId === undefined) return reply.status(404).send({ code: 'not_found' });

      try {
        let state: Record<string, unknown> = {};
        let cursor = 0;
        for (;;) {
          const batch = await prisma.operation.findMany({
            where: { userId, serverSeq: { gt: cursor } },
            orderBy: { serverSeq: 'asc' },
            take: OP_BATCH_SIZE,
            select: REPLAY_OPERATION_SELECT,
          });
          if (batch.length === 0) break;
          state = replayOpsToState(batch as unknown as ReplayOperationRow[], state);
          const last = batch[batch.length - 1];
          if (last === undefined) break;
          cursor = last.serverSeq;
          if (batch.length < OP_BATCH_SIZE) break;
        }
        const ics = buildCalendarIcsFromState(state, { now: Date.now(), domain: new URL(publicUrl()).host });
        reply.header('content-type', 'text/calendar; charset=utf-8');
        reply.header('cache-control', 'no-store');
        return reply.send(ics);
      } catch (error) {
        // 加密账号 / 回放失败：不泄露细节，给一个可读的拒绝码。
        Logger.error(
          `calendar feed generation failed for user ${String(userId)}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return reply.status(409).send({ code: 'calendar_feed_unavailable' });
      }
    },
  );
}
