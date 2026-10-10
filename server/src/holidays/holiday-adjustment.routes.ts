/**
 * 调休/补班（公共事实）的**匿名只读**下行：`GET /api/holiday-adjustments`。
 * ============================================================================
 *
 * W4b。定性见 [`docs/adr/0052-public-facts-are-deployer-supplied.md`](../../../docs/adr/0052-public-facts-are-deployer-supplied.md)。
 *
 * ## 🔴 这是这个服务端上**第一条**匿名只读的非密文 JSON 下行
 *
 * 工单原句"唯一一条公开只读非密文下行是 `GET /api/push/vapid-public-key`"经实测**否证**：
 * `push.routes.ts:127` 挂了 `preHandler authenticate`，未登录直接 401。
 * 所以今天匿名只读的 JSON 下行是 **0 条**，本文件是第 1 条。
 *
 * 这件事不是措辞差别。前 0 条意味着**没有任何先例**回答下面三个问题，而它们必须被回答：
 *
 * | 问题 | 这一版的处置 |
 * |---|---|
 * | 谁来限流？ | per-route `rateLimit`（比全局 500/15min 紧一个数量级），见下面常量 |
 * | 响应多大？ | 上界由录入区间 × 每年上限**算出来**（`holiday-adjustment-store.ts`），不是"应该不大" |
 * | 怎么不每次全量发？ | ETag + `If-None-Match` → 304（空 body） |
 *
 * ## 为什么它**不**要 token
 *
 * 它下发的是**公共事实**（哪天上班、哪天放假 + 公告原文出处），不是用户数据。
 * 要 token 会把三个东西搞坏：① 未登录用户看不到日历标注（功能上就少了东西）；
 * ② 一个"读公共事实"的请求要带凭据，凭据就在日志里多出现一次；
 * ③ 自托管部署方想只看公告日历，也得先有一个账号。
 *
 * 🔴 与之相反的是那 **5 条已有的** app-host fetch（admin-client / inbox / host /
 * entitlement / hosted-auth）—— 它们读的都是**账号级**事实，都要 token。
 * 这条通道的区别不是"少写了一行鉴权"，是**载荷里没有身份维度**：
 * 路径不带 `:id`、查询串不接受 `userId`、响应与调用方无关（`PUBLIC_FACT_SHAPES` 钉的就是这件事）。
 *
 * ## 为什么它不进 op-log
 *
 * §3.4「被回放/来自远端的 op 不得再次触发副作用」在这里**反着**成立：
 * 公共事实不是用户意图的产物，把它做成 op 会让"某个部署方下发的调休"变成
 * 一条**跨设备同步的用户写入** —— 于是它会被别的设备回放、会与用户自己的
 * 安排争 LWW、而且换一台服务器时无法解释"这些 op 是谁写的"。
 * 本地缓存的家因此是 `STORES.META`（不进 op-log、不跨设备），见 app-host 那一份。
 */

import type { FastifyInstance } from 'fastify';

import { HOLIDAY_ADJUSTMENT_PATHS } from '@heyta/shared-schema';

import { Logger } from '../logger';
import {
  HolidayAdjustmentInvariantError,
  holidayETag,
  loadHolidayAdjustments,
  parseIfNoneMatch,
} from './holiday-adjustment-store';

/**
 * 匿名面的速率上限。
 *
 * 🔴 为什么比全局（500 次 / 15 分钟，`server.ts` 的 `rateLimit` 注册）紧：
 * 全局那一条是给"登录用户 + 同步热路径"这个混合负载定的，而这条端点是
 * **任何人、无凭据、返回整个数据集**。它唯一的合法调用频率是
 * "一台设备一天几次"（缓存 1 小时 ⇒ 24 次/天/设备）。
 * 60 次 / 5 分钟 ≈ 每小时 720 次单 IP，是合法值的 30 倍余量 ——
 * 再宽就只是在给"拿这个接口当下载器"留空间。
 *
 * ⚠️ 生效前提：`@fastify/rate-limit` 必须在**根实例**上注册过
 *（`server.ts` 里它在 `!testMode.enabled` 分支内）。判据在
 * `server/tests/holiday-public-route.spec.ts` 的最后一条：那个测试**自己注册一份插件**，
 * 然后打满 `max+1` 次并要求第 61 次是 429 —— 去掉那次 `register` 它立刻转红。
 * 否则这条配置在测试里是装饰，那正是 §7 元规则 2 说的"一条永远通过的判据"。
 */
export const HOLIDAY_PUBLIC_RATE_LIMIT = {
  max: 60,
  timeWindow: '5 minutes',
} as const;

/**
 * `Cache-Control` 的取值。
 *
 * `max-age=3600` 是"一小时内的重复访问不发请求"，不是"数据一小时才更新一次"：
 * 调休公告一年改两三次，客户端在窗口期内多等一小时没有产品后果。
 * `must-revalidate` 是给"过期后不许再用陈旧副本"那一档 ——
 * 配合 ETag，过期后的第一次访问是一次 `If-None-Match`，命中就是 304、几十字节。
 *
 * 🔴 为什么**不是** `no-store`：那会让每台设备每次渲染日历都打一次服务端，
 * 而这条端点返回的是全量数据集。缓存是这条通道能匿名开放的前提。
 * ⚠️ 也刻意**没有** `immutable`：它等于"这个 URL 的内容永远不变"，是假的。
 */
export const HOLIDAY_PUBLIC_CACHE_CONTROL = 'public, max-age=3600, must-revalidate';

export const holidayAdjustmentRoutes = async (fastify: FastifyInstance): Promise<void> => {
  fastify.get(
    `/${HOLIDAY_ADJUSTMENT_PATHS.public}`,
    {
      // 🔴 per-route 速率：见 `HOLIDAY_PUBLIC_RATE_LIMIT` 的理由。
      config: { rateLimit: HOLIDAY_PUBLIC_RATE_LIMIT },
    },
    async (req, reply) => {
      let snapshot: Awaited<ReturnType<typeof loadHolidayAdjustments>>;
      try {
        snapshot = await loadHolidayAdjustments();
      } catch (err) {
        if (err instanceof HolidayAdjustmentInvariantError) {
          // 库约束没了。响亮地失败（见那个类的注释），不要退化成"返回空的一份" ——
          // 空的一份在客户端的表现是"退回随包表"，那**看起来完全正常**。
          Logger.error(`Holiday adjustments invariant violated: ${err.message}`);
          return reply.status(500).send({ code: 'holiday_adjustment_data_is_inconsistent', message: 'Holiday adjustment data is inconsistent.' });
        }
        const message = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Holiday adjustments load error: ${message}`);
        return reply.status(500).send({ code: 'failed_to_load_holiday_adjustments', message: 'Failed to load holiday adjustments.' });
      }

      const etag = holidayETag(snapshot.version);

      // ── 304 ────────────────────────────────────────────────────────
      // 🔴 必须在 `send` 之前判，且命中时**一个字节 body 都不发**。
      // 这条分支存在的全部理由是：匿名面 + 全量数据 = 不想让每次访问都传一遍。
      if (parseIfNoneMatch(req.headers['if-none-match']).includes(snapshot.version)) {
        return reply.header('etag', etag).header('cache-control', HOLIDAY_PUBLIC_CACHE_CONTROL).status(304).send();
      }

      return reply
        .header('etag', etag)
        .header('cache-control', HOLIDAY_PUBLIC_CACHE_CONTROL)
        .send(snapshot.body);
    },
  );
};
