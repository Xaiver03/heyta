/**
 * 收银台 —— 把"报价 → 冻结 → 下单"这条链接上**用户**。
 *
 * 在这个文件之前，整条链路（`quoteOrder` / `createOrderWithReservation` /
 * `createCheckout` / `settleOrderPaid`）**都已经写好、都有测试、都没有调用方**。
 * 于是出现了一个很贵的形状：**计价引擎存在，但用户走不到付钱那一步**。
 * 本文件是那条链唯一的入口。
 *
 * ## 四个刻意的顺序与边界
 *
 * 1. 🔴 **先冻结、后下单**（`CreateCheckoutInput.outTradeNo` 的注释里那条纪律）。
 *    顺序必须是「报价 → 生成订单号 → 冻结落库 → 交给通道」。反过来会在
 *    "券名额已满"时留下一个**通道侧已存在、用户还能扫码付款**的订单，
 *    而那时我们没有对应的冻结金额 —— 收也不是、拒也不是。
 * 2. 🔴 **金额只从服务端的报价来，永远不从请求体来。** 请求体只允许给
 *    `priceId`（买哪一档）与 `couponCode`（用户敲的码）。任何 `amount` 字段
 *    都不存在于这个 schema 里 —— 让客户端决定金额就是让客户端决定收多少钱。
 * 3. 🔴 **通道侧下单失败要 `failOrder`**，不是"留着不管"。留着会让那张券的名额
 *    被一个永远不会付款的订单占到过期为止；`failOrder` 正是在这一步释放它。
 *    这也是 `failOrder` 的**第一个生产调用方**（此前只有测试与导出）。
 * 4. 🔴 **不可交付的档在这里被挡掉**（`notSellableReason`）。这是
 *    ADR-0023 §3.1「计量存在之前 `hosted-ai-monthly` 不得被售卖」的**执行点**：
 *    没有它，这条路由今天就能把一档收了钱交付不了的服务卖出去。
 * 5. 🔴 **通道要收得了这个币种，而且要在冻结之前判**（`supportedCurrencies`）。
 *    金额是最小单位整数、不带币种，所以"报价冻 USD、通道按 CNY 签出去"是
 *    一个**数值对得上、币种对不上、没有一层会报错**的分叉 —— 结算也只比
 *    `final_amount_minor`，照样授予权益。这里按 `currency` 选通道，
 *    选不到就 409，一张订单都不落；adapter 自己也必须拒（声明与执行同源）。
 *
 * ## 不在这里做的事
 *
 * - **不授予权益**。授予仍然只有一条写入路径：webhook → `applyPaymentEvent`。
 *   收银台只负责"把钱收上来"，不负责"把权益发下去"。
 * - **不推断币种与区域**。它们由调用方给（默认 CNY / CN），并且只接受词表里的值，
 *   再按 ⑤ 与通道声明的能力对齐 —— 但**不替调用方猜**一个它能收的币种。
 */

import type { FastifyPluginAsync } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { authenticate, getAuthUser } from '../middleware';
import { prisma } from '../db';
import { Logger } from '../logger';
import { DEFAULT_PRICE_BOOK, grantsForSku, notSellableReason } from './price-book';
import { NOOP_PROVIDER } from './noop.adapter';
import { isRegion, normalizeCouponCode } from './coupon';
import type { CouponDefinition } from './coupon';
import {
  createOrderWithReservation,
  createPrismaSqlExecutor,
  failOrder,
  loadCouponUsage,
  loadCoupons,
  loadPriceOverrides,
} from './pricing-store';
import { QuotePricingError, isSellableCurrency, quoteOrder } from './quote';
import { buildWechatOutTradeNo } from './wechat.adapter';
import type { BillingAdapter } from './types';
import type { SqlExecutor } from './pricing-store';

/** 默认收什么钱 / 在哪个法域。与 `quote.ts` / `coupon.ts` 的词表同源，不另起一套。 */
const DEFAULT_CURRENCY = 'CNY';
const DEFAULT_REGION = 'CN';

/**
 * 🔴 请求体**故意**只有"买哪一档"与"用哪个码"。
 *
 * 没有 `amount` / `discount` / `currency` 之外的金额字段，而且 `currency` 与
 * `region` 会被词表校验 —— 一个多出来的字段不会报错（zod 默认丢弃未知键），
 * 但它**永远不会被读到**，因为下面的代码只从 `parsed.data` 取。
 */
const CheckoutBodySchema = z.object({
  priceId: z.string().min(1).max(64),
  /** 用户在收银台上手输的券码。服务端归一化，**不猜、不自动追加**。 */
  couponCode: z.string().min(1).max(64).optional(),
  currency: z.string().min(1).max(8).optional(),
  region: z.string().min(1).max(8).optional(),
});

export interface CheckoutRoutesOptions {
  /**
   * 可用的支付通道。🔴 `noop` 会被过滤掉 —— 它不是"一个通道"，
   * 而是"没有配通道"的占位，让它接单会把一笔真实支付变成一个必然抛错的调用。
   */
  readonly adapters?: readonly BillingAdapter[];
  /** 可注入时钟（epoch 毫秒）。默认 `Date.now`。 */
  readonly now?: () => number;
  /**
   * 可注入的 SQL 执行面。默认是 `createPrismaSqlExecutor(prisma)`。
   *
   * 🔴 存在的理由是**测试能跑真 SQL**：本路由的价值全在"报价 → 冻结 → 下单"
   * 这条**有顺序的**链上（金额、券名额、订单号三处必须一致）。用一个 mock 的
   * `prisma` 去断言"它调用了什么"，只能证明我们写下了自己期望的调用序列；
   * 换成 PGlite 就能证明**库里的那一行**真的对了。
   */
  readonly sql?: SqlExecutor;
  /** 站点公开根地址，用来拼回跳地址。 */
  readonly publicUrl?: string;
  /** 支付成功 / 取消后的回跳地址。默认 `${publicUrl}/`。 */
  readonly successUrl?: string;
  readonly cancelUrl?: string;
}

export const checkoutRoutes: FastifyPluginAsync<CheckoutRoutesOptions> = async (
  fastify,
  options,
) => {
  const base = (options.publicUrl ?? '').replace(/\/+$/, '');
  const successUrl = options.successUrl ?? `${base}/`;
  const cancelUrl = options.cancelUrl ?? `${base}/`;
  const now = options.now ?? Date.now;
  const sql = options.sql ?? createPrismaSqlExecutor(prisma);

  fastify.post<{ Body: unknown }>(
    '/checkout',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = CheckoutBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'INVALID_BODY',
          detail: parsed.error.issues.map((i) => i.message),
        });
      }
      const body = parsed.data;
      const { userId } = getAuthUser(request);

      // ── ① 这一档今天能不能交付 ────────────────────────────────────────
      // 🔴 先于任何报价：不可交付的档连价都不该报出来。给出**给用户看的**理由。
      const notSellable = notSellableReason(body.priceId);
      if (notSellable !== null) {
        return reply.code(409).send({
          error: 'PRICE_NOT_SELLABLE',
          priceId: body.priceId,
          reason: notSellable,
        });
      }
      // ── ② 是我们认识的档吗 ────────────────────────────────────────────
      // 不认识的档**不报价**：`resolveEffectivePrice` 会抛，但那时错误形状
      // 已经变成"价目表坏了"，而真实原因是"客户端给了个不存在的 priceId"。
      if (grantsForSku(body.priceId) === null) {
        return reply.code(400).send({ error: 'UNKNOWN_PRICE', priceId: body.priceId });
      }
      // ── ③ 币种与区域只能来自词表 ──────────────────────────────────────
      const currency = body.currency ?? DEFAULT_CURRENCY;
      if (!isSellableCurrency(currency)) {
        return reply.code(400).send({ error: 'UNSUPPORTED_CURRENCY', currency });
      }
      const region = body.region ?? DEFAULT_REGION;
      if (!isRegion(region)) {
        return reply.code(400).send({ error: 'UNSUPPORTED_REGION', region });
      }
      // ── ④ 必须有真通道，而且它得收得了这个币种 ──────────────────────────
      const usable = (options.adapters ?? []).filter((a) => a.provider !== NOOP_PROVIDER);
      if (usable.length === 0) {
        // 自托管默认就是这个形状（只配了 noop）。这不是 500：系统是好的，
        // 只是这台实例没有开通收款能力。
        return reply.code(503).send({ error: 'BILLING_PROVIDER_NOT_CONFIGURED' });
      }
      // 🔴 币种能力在**冻结之前**判。理由与"先冻结后下单"是同一条纪律的反面：
      //    等到 `createCheckout` 才拒，那张订单**已经落库**了（随后被 `failOrder`
      //    改成 `failed`），用户换来一个 502 和一条无用的失败订单，而真实原因只是
      //    "这台实例收不了这个币种"—— 本可以在建单之前就说清楚。
      //    `PROVIDER_CURRENCY_UNSUPPORTED` 与 `UNSUPPORTED_CURRENCY`（③ 的词表拒绝）
      //    刻意是两个错误：前者是"这台实例没有能力"，后者是"这个值我们根本不认识"。
      const adapter = usable.find((a) => a.supportedCurrencies.includes(currency));
      if (adapter === undefined) {
        return reply.code(409).send({
          error: 'PROVIDER_CURRENCY_UNSUPPORTED',
          currency,
          providers: usable.map((a) => a.provider),
        });
      }

      const nowMs = now();

      // ── ⑤ 报价（读库里的价目覆盖与券）─────────────────────────────────
      // 🔴 这里**不再**自己 `createPrismaSqlExecutor(prisma)` —— 那会**遮蔽**
      // 插件级注入的 `sql`（`options.sql`），把测试里的 PGlite 执行面静默换掉。
      // 症状很误导：错误会出现在更深处，形状是"某个 client 上没有
      // `$queryRawUnsafe`"，看起来像 Prisma 的问题，其实是变量遮蔽。
      const overrides = await loadPriceOverrides(sql);
      const { coupons, invalid } = await loadCoupons(sql);
      if (invalid.length > 0) {
        // 🔴 一张券坏了**不**阻断所有人购买（`loadCoupons` 的纪律）：
        // 价目表坏是"这一刻收多少钱没有定义"，券坏只是"那一张不能用"。
        // 但必须留痕，否则就是静默丢弃。
        Logger.warn('收银台：有券定义非法，已跳过', {
          count: invalid.length,
          couponIds: invalid.map((c) => c.id),
        });
      }
      // 键必须是**已归一化**的码：用户敲的是 `HELLO-2026`，库里存的是归一化后的形态。
      // `code === null` 的券进不了这张表 —— 没有码，就不可能被用户**敲**出来
      // （用户敲的码是这里唯一的入口；本路由不猜、不自动追加促销码）。
      const couponsByCode = new Map<string, CouponDefinition>();
      for (const coupon of coupons) {
        if (coupon.code !== null) {
          couponsByCode.set(normalizeCouponCode(coupon.code), coupon);
        }
      }
      const usageByCouponId = await loadCouponUsage(
        sql,
        coupons.map((c) => c.id),
        userId,
      );

      let quote;
      try {
        quote = quoteOrder(
          {
            priceId: body.priceId,
            currency,
            region,
            candidateCodes: body.couponCode === undefined ? [] : [body.couponCode],
            usageByCouponId,
          },
          { baseline: DEFAULT_PRICE_BOOK, overrides, couponsByCode, now: nowMs },
        );
      } catch (error) {
        if (error instanceof QuotePricingError) {
          // 🔴 "没有可卖的价格"是配置问题，不是用户的错，也**绝不回落**成 0 元。
          Logger.error('收银台：报价失败，未向用户报出任何金额', {
            priceId: body.priceId,
            currency,
            message: error.message,
          });
          return reply.code(409).send({
            error: 'PRICE_NOT_EFFECTIVE',
            priceId: body.priceId,
            currency,
          });
        }
        throw error;
      }

      // ── ⑥ 先冻结 ──────────────────────────────────────────────────────
      // 订单号必须在**这一刻**生成，并同时用于落库与下单 —— 两处不同就是
      // "一笔真实到账的钱授予不出去"（见 `CreateCheckoutInput.outTradeNo`）。
      //
      // ⚠️ 这里借用了 `buildWechatOutTradeNo`，虽然本路由与 provider 无关。
      // 这是**已知的耦合**，不是疏忽：`hy<uid>x<ts>x<hex>` 是目前唯一的商户订单号
      // 格式，而它的形状由微信 adapter 的 `OUT_TRADE_NO_PATTERN` 校验。
      // 有第二个 provider 时，正确做法是把生成器提升成 provider 无关的工具函数，
      // 而不是在这里再抄一份格式（两份格式一定会漂移）。
      const outTradeNo = buildWechatOutTradeNo(
        userId,
        nowMs,
        randomBytes(8).toString('hex'),
      );
      const { orderId } = await createOrderWithReservation(sql, {
        userId,
        provider: adapter.provider,
        outTradeNo,
        quote,
        now: nowMs,
      });

      // ── ⑦ 后下单 ──────────────────────────────────────────────────────
      let checkout;
      try {
        checkout = await adapter.createCheckout({
          userId,
          priceId: body.priceId,
          // 金额**只从冻结的报价来**。
          amountMinor: quote.finalAmountMinor,
          // 🔴 币种也**只从冻结的报价来**，且必须与所选通道声明的能力一致
          //    （上面 ④ 已经按它选过通道）。传字面量 'CNY' 就是"报价冻 USD、
          //    通道收 CNY"那个静默收错钱的形状。
          currency: quote.currency,
          outTradeNo,
          successUrl,
          cancelUrl,
        });
      } catch (error) {
        // 🔴 通道侧失败 → 立刻把这一单判失败。`failOrder` 会释放券的预留名额，
        // 否则那张券会被一个永远不会付款的订单占到过期为止。
        await failOrder(sql, { orderId, now: now() });
        Logger.error('收银台：通道侧下单失败，已取消订单并释放券名额', {
          orderId,
          outTradeNo,
          provider: adapter.provider,
          message: error instanceof Error ? error.message : String(error),
        });
        return reply.code(502).send({ error: 'CHECKOUT_FAILED', outTradeNo });
      }

      // 🔴 只回**这一单自己的**事实：冻结金额、折扣、失效时间、通道侧的支付参数。
      // `appliedCouponId` 不外露（内部 id，对用户没有意义）；折扣金额本身
      // 已经回答了"我那个码生效了吗"。
      return reply.code(200).send({
        orderId,
        outTradeNo,
        priceId: quote.priceId,
        currency: quote.currency,
        originalAmountMinor: quote.originalAmountMinor,
        discountMinor: quote.discountMinor,
        amountMinor: quote.finalAmountMinor,
        expiresAt: quote.expiresAt,
        rejectedCoupons: quote.rejectedCoupons,
        ...checkout,
      });
    },
  );
};
