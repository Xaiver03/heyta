import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 公共事实的**匿名只读下行**（`GET /api/holiday-adjustments`）。
 * ============================================================================
 *
 * ## 为什么这个文件存在
 *
 * 契约（`packages/shared-schema/src/holiday-adjustment-contract.ts`）与路由
 * （`server/src/holidays/holiday-adjustment.routes.ts`）两边都写着"判据钉在
 * `server/tests/holiday-public-route.spec.ts`"，而**这个文件此前并不存在** ——
 * 那句指针是一句空头承诺。更要紧的是：这条通道此前从来没有对着真服务端打过一次，
 * 客户端那一半喂的是桩 `fetch`，e2e 那一半用 `page.route` 截胡，
 * 于是 `parseIfNoneMatch` 的四种写法、ETag/304、500 那一支、per-route 速率，
 * **全都没有消费者**。
 *
 * ## 这一组用例保护的是什么
 *
 * | 承诺 | 载体 |
 *   |---|---|
 * | 它是**匿名**的（不需 token 就能 200），但载荷里**没有身份维度**（`note` 不下发） | 用例 1、2 |
 * | 出处（`papers`）是公共事实的一部分，必须跟着下发 | 用例 2 |
 * | `If-None-Match` 的四种常见写法都要能命中 304，且 304 **一个字节 body 都不发** | 用例 3 |
 * | 不匹配的令牌 ⇒ 仍是 200（不许把"没命中"读成"没数据"） | 用例 4 |
 * | 服务端出错时**不许**退化成"返回空的一份"（空的一份在客户端的表现是"退回随包表"，看起来完全正常） | 用例 5、6 |
 * | per-route 速率不是装饰：注册了插件就必须能打出 429 | 用例 7 |
 *
 * 🔴 桩 Prisma 的边界（与 `holiday-admin-routes.spec.ts` 同一套说法）：
 * 这一份判的是**路由层**（鉴权面、头、状态码、降级形状）。它证明不了
 * `DATE` 列的序列化，也证明不了 CHECK 约束 —— 那两样分别由
 * `day-column.ts` 的往返用例与 `holiday-adjustment-migration.pglite.spec.ts` 担。
 */

const mocks = vi.hoisted(() => ({
  holidayAdjustmentYear: { findMany: vi.fn() },
}));

vi.mock('../src/db', () => ({ prisma: mocks }));

import { HOLIDAY_ADJUSTMENT_PATHS, holidayAdjustmentsResponseSchema } from '@heyta/shared-schema';

import { HolidayAdjustmentInvariantError } from '../src/holidays/holiday-adjustment-store';
import {
  HOLIDAY_PUBLIC_CACHE_CONTROL,
  HOLIDAY_PUBLIC_RATE_LIMIT,
  holidayAdjustmentRoutes,
} from '../src/holidays/holiday-adjustment.routes';

const GOV_PAPER = 'https://www.gov.cn/zhengce/content/2026-11/content_000000.htm';
const INTERNAL_NOTE = '运营内部措辞：本次调整顺延一周';

/** 库里的一行照 `fetchYearRows` 的 `select` 形状给（含 `BigInt` 的 `updatedAt`）。 */
const rowOf = (year: number) => ({
  year,
  papers: [GOV_PAPER],
  note: INTERNAL_NOTE,
  updatedAt: BigInt(1_730_000_000_000),
  updatedBy: 'ops@example.com',
  // 🔴 两天都必须在**这一年之内**（契约的 `daysBelongToYear` 会整条拒掉跨界的那一天）。
  days: [
    { day: new Date(Date.UTC(year, 0, 18)), isOffDay: true },
    { day: new Date(Date.UTC(year, 0, 19)), isOffDay: false },
  ],
});

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.holidayAdjustmentYear.findMany.mockResolvedValue([rowOf(2026)]);
  app = Fastify();
  await app.register(holidayAdjustmentRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

const PUBLIC_URL = `/${HOLIDAY_ADJUSTMENT_PATHS.public}`;

describe('公共事实的匿名只读下行', () => {
  it('🔴 匿名可达：不带任何 authorization / cookie 就是 200', async () => {
    const res = await app.inject({ method: 'GET', url: PUBLIC_URL });

    expect(res.statusCode, '这条通道存在的前提就是不要凭据').toBe(200);
    expect(res.headers['cache-control']).toBe(HOLIDAY_PUBLIC_CACHE_CONTROL);
  });

  it('🔴 载荷里没有身份维度：note 与 updatedBy 都不许出现在公开响应里', async () => {
    const res = await app.inject({ method: 'GET', url: PUBLIC_URL });
    const text = res.body;

    expect(text, '公开面下发运营内部措辞').not.toContain(INTERNAL_NOTE);
    expect(text).not.toContain('ops@example.com');
    // 出处是**公共事实的一部分**，它必须在。少它 = 标注"休/班"没有来源。
    expect(text).toContain(GOV_PAPER);

    const parsed = holidayAdjustmentsResponseSchema.safeParse(JSON.parse(text));
    expect(parsed.success, '公开响应必须过契约那份 schema').toBe(true);
  });

  it('🔴 If-None-Match 的四种写法都要命中 304，且 304 不带 body', async () => {
    const first = await app.inject({ method: 'GET', url: PUBLIC_URL });
    const version = String((JSON.parse(first.body) as { version: string }).version);
    const etagHeader = String(first.headers['etag']);

    const variants = [version, `"${version}"`, `W/"${version}"`, `"other", ${version}`];
    for (const value of variants) {
      const res = await app.inject({ method: 'GET', url: PUBLIC_URL, headers: { 'if-none-match': value } });
      expect(res.statusCode, `写法 ${value} 应当命中`).toBe(304);
      expect(res.body, '命中时一个字节 body 都不发').toBe('');
    }
    // 正向对照：裸令牌与带引号的那一份必须等价，否则 `parseIfNoneMatch` 的剥引号那步是装饰。
    expect(etagHeader.replace(/^W\/|^"|"$/g, '')).toBe(version);
  });

  it('不匹配的令牌 ⇒ 仍是 200（不许把"没命中"读成"没数据"）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: PUBLIC_URL,
      headers: { 'if-none-match': '"1730000000000.9.9"' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { years: unknown[] };
    expect(body.years.length, '未命中必须原样把这一份发出去').toBe(1);
  });

  it('🔴 不变量违约 ⇒ 响亮 500，不许退化成"空的一份"', async () => {
    mocks.holidayAdjustmentYear.findMany.mockRejectedValue(
      new HolidayAdjustmentInvariantError('库里的年度数超出录入区间能装下的上限'),
    );

    const res = await app.inject({ method: 'GET', url: PUBLIC_URL });

    expect(res.statusCode).toBe(500);
    expect(res.body).not.toMatch(/"years"\s*:\s*\[\]/);
    expect(JSON.parse(res.body)).not.toHaveProperty('years');
  });

  it('读取失败（非不变量那一类）同样是 500，且回显里不带内部错误原文', async () => {
    mocks.holidayAdjustmentYear.findMany.mockRejectedValue(new Error('connection reset by peer'));

    const res = await app.inject({ method: 'GET', url: PUBLIC_URL });

    expect(res.statusCode).toBe(500);
    expect(res.body, '内部错误原文不许原样下发给匿名调用方').not.toContain('connection reset');
  });

  /**
   * 🔴 这一条存在的理由写在路由的注释里：`@fastify/rate-limit` 若没在**根实例**上注册，
   * `config.rateLimit` 就是装饰。这里显式注册一份，于是"60 次/5 分钟"变成一个**打得出读数**
   * 的断言；把它拿掉（去掉 register）本条立刻转红 —— 那正是要的形态。
   */
  it('per-route 速率不是装饰：打满 max+1 次 ⇒ 出现 429', async () => {
    await app.close();
    app = Fastify();
    await app.register(rateLimit, { max: 100_000, timeWindow: '15 minutes' });
    await app.register(holidayAdjustmentRoutes);
    await app.ready();

    const statuses: number[] = [];
    for (let i = 0; i < HOLIDAY_PUBLIC_RATE_LIMIT.max + 1; i++) {
      const res = await app.inject({ method: 'GET', url: PUBLIC_URL });
      statuses.push(res.statusCode);
    }

    expect(statuses.filter((s) => s === 200).length).toBe(HOLIDAY_PUBLIC_RATE_LIMIT.max);
    expect(statuses.at(-1), '第 max+1 次必须被这条 per-route 配置挡下').toBe(429);
  });
});
