/**
 * 版本策略接口：`GET /api/app-version`。
 * =====================================
 *
 * 定性见 [`docs/plans/app-auto-update.md`](../../../docs/plans/app-auto-update.md)。
 *
 * ## 🔴 为什么它匿名、且必须 `no-store`
 *
 * 更新检查发生在**应用启动时**，那一刻用户可能还没登录 —— 要 token 会让「未登录就检查不到
 * 更新」变成常态。而载荷里**没有身份维度**（`deviceId` 只做灰度分桶，不进响应、不落库），
 * 所以它与 `holiday-adjustments` 同属「公共事实」那一类（ADR-0052），匿名只读成立。
 *
 * `Cache-Control: no-store` 不是可调项：被 CDN/中间层缓存住，用户会在缓存过期前**一直
 * 检测不到新版本**，而发版方以为已经推下去了。这条头就是这条接口的存在前提。
 *
 * ## 判定全在服务端
 *
 * 客户端只读 `updateAvailable` / `forceUpdate` 两个布尔，不自己比版本大小（见 `policy.ts` 文件头）。
 *
 * ## 路由登记
 *
 * 这条是匿名 GET，`scripts/check-public-facts.mjs` 的判据 4 要求它在
 * `REVIEWED_ANONYMOUS_GET` 里被认领 —— 否则门禁会判「新开了一条没人审过的匿名下行」。
 */

import type { FastifyInstance } from 'fastify';

import { APP_VERSION_PATHS, appVersionQuerySchema } from '@heyta/shared-schema';

import {
  type AppVersionPolicyConfig,
  buildAppVersionResponse,
  loadAppVersionPolicyConfig,
} from './config';

/**
 * 匿名面的速率上限。
 *
 * 合法调用频率是「一台设备一天几次」（启动 + 6 小时 + 回前台，几十次/天）。取
 * 120 次 / 5 分钟 ≈ 每小时 1440 次单 IP，是合法值的几十倍余量，同时挡住把它当压测靶子的用法。
 * 比全局（500/15min）更贴这条通道的真实负载。
 */
export const APP_VERSION_RATE_LIMIT = {
  max: 120,
  timeWindow: '5 minutes',
} as const;

export interface AppVersionRoutesOptions {
  /** 测试注入用；不传则按 env 组装（真实运行时）。 */
  config?: AppVersionPolicyConfig;
}

export const appVersionRoutes = async (
  fastify: FastifyInstance,
  opts: AppVersionRoutesOptions = {},
): Promise<void> => {
  // 配置在**注册时**组装一次：env 不合法就在启动阶段抛出（`AppVersionConfigError`），
  // 而不是等到第一个客户端来问才炸。
  const config = opts.config ?? loadAppVersionPolicyConfig();

  fastify.get(
    `/${APP_VERSION_PATHS.public}`,
    { config: { rateLimit: APP_VERSION_RATE_LIMIT } },
    async (req, reply) => {
      const parsed = appVersionQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        // 400 也要 no-store：一条报错更不该被中间层缓存。
        return reply
          .header('cache-control', 'no-store')
          .status(400)
          .send({
            code: 'invalid_app_version_query',
            message: '版本检查参数不合法（platform 与 currentVersion 必填，currentVersion 只收数字段版本）',
          });
      }

      const body = buildAppVersionResponse(config, parsed.data);
      return reply.header('cache-control', 'no-store').status(200).send(body);
    },
  );
};
