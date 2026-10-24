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
 * 4. 🔴 **不可交付的档在这里被挡掉**（`notSellableReason`）。清单今天**是空的**
 *    （`hosted-ai-monthly` 已在 ADR-0054 之后解除 —— 计量与代理路由都在了），
 *    但**这道问句本身必须留在这一步**：它是"已定价但暂时交付不了"这个状态唯一的
 *    执行点，而 `pnpm check:ai-quota` §3 现在钉的就是"清单可以空、调用点不许消失"。
 *    顺序仍是判据：**先于报价**，不可交付的档连价都不该报出来。
 * 5. 🔴 **通道要收得了这个币种，而且要在冻结之前判**（`supportedCurrencies`）。
 *    金额是最小单位整数、不带币种，所以"报价冻 USD、通道按 CNY 签出去"是
 *    一个**数值对得上、币种对不上、没有一层会报错**的分叉 —— 结算也只比
 *    `final_amount_minor`，照样授予权益。这里按 `currency` 选通道，
 *    选不到就 409，一张订单都不落；adapter 自己也必须拒（声明与执行同源）。
 * 6. 🔴 **②′ 这一档要交付的能力，这台实例**有**吗**（`managedAiConfigured`）。
 *    `NOT_YET_DELIVERABLE_SKUS` 回答的是"这一档在全仓库今天能不能交付"，
 *    而云端 AI 那一档的交付与否是**逐台实例**的事实：同一个镜像，官方配了
 *    `MANAGED_AI_*`、自托管没配。没配时那条代理路由对每个请求回 503，
 *    收 ¥12 就是收钱不交付。默认**拒**（忘了传选项的症状是"卖不出去"，不是"卖了不交付"）。
 * 7. 🔴 **④′ 收了钱不许把已经付费的能力判小**（`PRICE_TIER_LOSES_GRANTS`）。
 *    收银台有了两枚按钮之后，"高档用户点低档"是一条**用户自己走得通**的路径，
 *    而授予那侧是整行替换 `grants`：时长照加、能力缩回。判在冻结之前，
 *    拒掉而不是"折价"—— 一行只有一个 `currentPeriodEnd`，折算没有数据形状可依。
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
import { buildOutTradeNo } from './out-trade-no';
import { evaluateEntitlement } from '../entitlement';
import { MANAGED_AI_CAPABILITY } from '../ai/metering';
import type { BillingAdapter } from './types';
import type { SqlExecutor } from './pricing-store';

/** 默认收什么钱 / 在哪个法域。与 `quote.ts` / `coupon.ts` 的词表同源，不另起一套。 */
const DEFAULT_CURRENCY = 'CNY';
const DEFAULT_REGION = 'CN';

/**
 * 拒单时响应体里的 `reason`：**稳定机器码**，界面据此说自己的那句话。
 *
 * 🔴 这里曾经是**一句中文散文**（"这台实例没有配置托管 AI 的上游…"）—— 它同时被当成
 * 给运营者的说明和给客户端的分支依据用。后果两头都坏：
 *
 * · 客户端**没法**按它分支（散文是会改的，而且只有中文），于是真实发生的两件完全不同的事
 *   （"这一档要交付的能力本机没有" vs "这一单会把已付费的能力判小"）被界面说成同一句
 *   「这一档现在还不能卖」——产品负责人 2026-10-24 实拍问的第一句就是"为什么"；
 * · 想把它印到界面上就会在英文界面漏中文（`CouponRejectionExplanation` 那一课）。
 *
 * 所以：**散文归日志，机器码归线协议**。界面只按码取自己的词条（`web.*` / `mobile.*`）。
 */
export const CHECKOUT_REJECTION_REASON = {
  /** ②′：这一档授予 `ai`，而本实例没配托管 AI 上游（`MANAGED_AI_ENABLED` + 三项）。 */
  managedAiNotConfigured: 'MANAGED_AI_NOT_CONFIGURED',
  /** ④′：这一单会让该账号已付费那一行的能力变少（一次性支付整行替换）。 */
  tierLosesGrants: 'TIER_LOSES_GRANTS',
} as const;

export type CheckoutRejectionReason =
  (typeof CHECKOUT_REJECTION_REASON)[keyof typeof CHECKOUT_REJECTION_REASON];

/**
 * ②′ 给**运营者**看的那句解释。只进日志（`Logger.warn` 的 `detail`），**不进响应体**。
 *
 * 它回答的是"我该去配哪一枚旋钮"，而用户看到的永远是"这一档现在买不了 + 该换哪一档"。
 */
const MANAGED_AI_NOT_DELIVERABLE_DETAIL =
  '这台实例没有配置托管 AI 的上游（`MANAGED_AI_ENABLED` 与三项 `MANAGED_AI_UPSTREAM_*`），'
  + '而这一档买的就是它：现在卖出去，用户拿到的是每次请求一个 503。';

/** ④′ 的解释，同上：只进日志。 */
const TIER_LOSSES_GRANTS_DETAIL =
  '这一档的能力集合不包含该账号当前已付费那一行的全部能力，而一次性支付是**整行替换** '
  + '`priceId` / `grants`（`apply-event.ts` 的 `applyOneTimeGrant`）：'
  + '收这一单会让用户付了钱却**少**拿到原来有的能力。';

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
  /**
   * 🔴 这台实例**能不能交付**「我们的云端 AI」—— 即 `config.ts` 的 `managedAi`
   * 是否配齐（`MANAGED_AI_ENABLED=true` 且三项上游凭证齐全）。
   *
   * **默认 `false` = 这一档不卖**。这不是保守，是这条线上唯一的 fail-closed 位置：
   * 上游没配时 `POST /api/ai/managed/chat` 对每个请求回
   * `503 MANAGED_AI_NOT_CONFIGURED`（闸门 ③ 在额度 ⑤ 之前，所以它不白扣次数），
   * 于是"收 ¥12、交付 0 次"是一个**配置就能造出来**的状态。
   * `NOT_YET_DELIVERABLE_SKUS` 挡不住它 —— 那张表是**全局静态**的，
   * 而这件事是**这一台实例**的事实（同一个镜像，官方开着、自托管没开）。
   *
   * ⚠️ 值在**注册插件时**取一次，与 `adapters` 同一姿态（两者都来自
   * `loadConfigFromEnv()`，运行期不会变）。不要在这里再 `loadConfigFromEnv()` 一次：
   * 那会造出第二个配置源，而"两处读同一枚 env、一处为空"正是本仓反复登记过的分叉形状。
   */
  readonly managedAiConfigured?: boolean;
}

/**
 * 读"这一行订阅此刻实际授予的能力"，只为 ④′ 服务。
 *
 * 为什么按 `(userId, provider)` 取**一行**而不是取全部：
 * 一次性支付的授予路径就是按这个键复用一行的（`apply-event.ts` 的
 * `applyOneTimeGrant`），而 ④′ 判的正是"这一单会不会把**那一行**判小"。
 * 跨行的并集（付费行 + 邀请行）由 `evaluateCapabilityAcross` 在守卫那侧管，
 * 在这里读并集会拒掉根本不会被覆盖的行 —— 那是把别人的权益当成要保护的东西。
 *
 * 三种返回值，含义不同，不许合并：
 * - `null`：库里没有这一行（第一次买），谈不上"判小"；
 * - `[]`：有这一行，但**此刻没有授予任何能力**（已到期 / 状态不算有效 / grants 列形状不对）。
 *   最后一项刻意落到 `[]` 而不是抛：grants 不是数组时 `evaluateCapability` 本来就会
 *   `MISSING_GRANTS` 拒绝，用户在那一行上**没有**任何能力可丢。
 * - 数组：这一行此刻授予的能力。
 */
const readEntitledGrantsForProvider = async (
  runner: SqlExecutor,
  userId: number,
  provider: string,
  nowMs: number,
): Promise<readonly string[] | null> => {
  const rows = await runner.query<{
    status: unknown;
    current_period_end: unknown;
    grants: unknown;
  }>(
    'SELECT status, current_period_end, grants FROM subscriptions WHERE user_id = $1 AND provider = $2 LIMIT 1',
    [userId, provider],
  );
  const row = rows[0];
  if (row === undefined) return null;

  const decision = evaluateEntitlement(
    {
      status: typeof row.status === 'string' ? row.status : null,
      currentPeriodEnd: row.current_period_end as number | bigint | null,
    },
    nowMs,
  );
  if (!decision.allowed) return [];

  // 🔴 数组才是集合。字符串**也有** `includes`，`'hosting,ai'` 会被当成集合用，
  // 而子串匹配让 `includes('ai')` 返回 true —— 同 `entitlement.ts` 里那条理由。
  return Array.isArray(row.grants) ? (row.grants as readonly string[]) : [];
};

export const checkoutRoutes: FastifyPluginAsync<CheckoutRoutesOptions> = async (
  fastify,
  options,
) => {
  const base = (options.publicUrl ?? '').replace(/\/+$/, '');
  const successUrl = options.successUrl ?? `${base}/`;
  const cancelUrl = options.cancelUrl ?? `${base}/`;
  const now = options.now ?? Date.now;
  const sql = options.sql ?? createPrismaSqlExecutor(prisma);
  // 🔴 默认**拒**（见 `managedAiConfigured` 的注释）：忘了传这个选项的症状是
  // "这一档卖不出去"，而不是"卖了但交付不了"。前者会被立刻发现，后者是收钱不交付。
  const managedAiConfigured = options.managedAiConfigured ?? false;

  fastify.post<{ Body: unknown }>(
    '/checkout',
    { preHandler: authenticate },
    async (request, reply) => {
      const parsed = CheckoutBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          code: 'INVALID_BODY',
          message: 'INVALID_BODY',
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
          code: 'PRICE_NOT_SELLABLE',
          message: 'PRICE_NOT_SELLABLE',
          priceId: body.priceId,
          reason: notSellable,
        });
      }
      // ── ② 是我们认识的档吗 ────────────────────────────────────────────
      // 不认识的档**不报价**：`resolveEffectivePrice` 会抛，但那时错误形状
      // 已经变成"价目表坏了"，而真实原因是"客户端给了个不存在的 priceId"。
      const requestedGrants = grantsForSku(body.priceId);
      if (requestedGrants === null) {
        return reply.code(400).send({ code: 'UNKNOWN_PRICE', message: 'UNKNOWN_PRICE', priceId: body.priceId });
      }
      // ── ②′ 这一档要交付的那项能力，这台实例真的有吗 ─────────────────────
      //
      // 🔴 这是 `NOT_YET_DELIVERABLE_SKUS` **结构上做不到**的那一半：那张表回答
      // "这一档在全仓库今天能不能交付"（一个静态、全局的事实），而这里回答的是
      // "**这一台**实例能不能"。同一个镜像，官方托管配了上游、自托管没配 ——
      // 把这一格写进那张表就会变成"为了我这台没配，把所有人那一档下架"。
      //
      // 判据只有一条：这一档授予 `ai`（云端 AI 能力）而 `config.ts` 的 `managedAi` 不存在。
      // 那时 `POST /api/ai/managed/chat` 对**每个**请求回 `503 MANAGED_AI_NOT_CONFIGURED`，
      // 用户付 ¥12 拿到 0 次。额度也白扣不了（闸门 ③ 在 ⑤ 之前），但钱已经收了。
      //
      // ⚠️ 复用 `PRICE_NOT_SELLABLE` 而**不**新造一个码：对用户这句话就是对的
      // （"这一档现在买不了"），而两种成因的区分归运营 —— 走 `reason` 与下面那条日志。
      if (requestedGrants.includes(MANAGED_AI_CAPABILITY) && !managedAiConfigured) {
        Logger.warn('收银台：这一档授予云端 AI，但本实例未配置托管上游，已拒单', {
          priceId: body.priceId,
          userId,
          reason: CHECKOUT_REJECTION_REASON.managedAiNotConfigured,
          detail: MANAGED_AI_NOT_DELIVERABLE_DETAIL,
        });
        return reply.code(409).send({
          code: 'PRICE_NOT_SELLABLE',
          message: 'PRICE_NOT_SELLABLE',
          priceId: body.priceId,
          reason: CHECKOUT_REJECTION_REASON.managedAiNotConfigured,
        });
      }
      // ── ③ 币种与区域只能来自词表 ──────────────────────────────────────
      const currency = body.currency ?? DEFAULT_CURRENCY;
      if (!isSellableCurrency(currency)) {
        return reply.code(400).send({ code: 'UNSUPPORTED_CURRENCY', message: 'UNSUPPORTED_CURRENCY', currency });
      }
      const region = body.region ?? DEFAULT_REGION;
      if (!isRegion(region)) {
        return reply.code(400).send({ code: 'UNSUPPORTED_REGION', message: 'UNSUPPORTED_REGION', region });
      }
      // ── ④ 必须有真通道，而且它得收得了这个币种 ──────────────────────────
      const usable = (options.adapters ?? []).filter((a) => a.provider !== NOOP_PROVIDER);
      if (usable.length === 0) {
        // 自托管默认就是这个形状（只配了 noop）。这不是 500：系统是好的，
        // 只是这台实例没有开通收款能力。
        return reply.code(503).send({ code: 'BILLING_PROVIDER_NOT_CONFIGURED', message: 'BILLING_PROVIDER_NOT_CONFIGURED' });
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
          code: 'PROVIDER_CURRENCY_UNSUPPORTED',
          message: 'PROVIDER_CURRENCY_UNSUPPORTED',
          currency,
          providers: usable.map((a) => a.provider),
        });
      }

      const nowMs = now();

      // ── ④′ 这一单会不会把已经付过钱的能力判小 ───────────────────────────
      //
      // 🔴 起因是把 ¥12 档做成可点的那一瞬间就出现的新状态：收银台有了两枚按钮。
      // 一次性支付的授予**整行替换** `priceId` 与 `grants`
      // （`apply-event.ts` 的 `applyOneTimeGrant`，注释里那句"档位与能力必须一起写"），
      // 于是"¥12 的用户点 ¥5 续费"得到的是：**时长 +30 天、能力缩回 `hosting`**。
      // 用户付了钱、时间没丢，云端 AI 却当场没了 —— 没有任何一层会报错。
      //
      // 为什么拒而不做"按比例折算"：那需要"每一笔支付各自到哪一天结束"的数据形状，
      // 而这一行只有**一个** `currentPeriodEnd`（schema 里那一列，本文件不碰）。
      // 在没有那个形状之前，"补差价升档"与"降档保留高档到期末"都是编出来的语义。
      //
      // 顺序仍然守本文件第 1 条：**在冻结之前**。这里已经知道 `adapter.provider`，
      // 而那张订阅行的键正是 `(userId, provider)`。
      const entitledGrants = await readEntitledGrantsForProvider(sql, userId, adapter.provider, nowMs);
      const lostGrants = (entitledGrants ?? []).filter((g) => !requestedGrants.includes(g));
      if (entitledGrants !== null && lostGrants.length > 0) {
        Logger.warn('收银台：这一单会把该账号已付费的能力判小，已拒单（未冻结订单）', {
          userId,
          provider: adapter.provider,
          priceId: body.priceId,
          lostGrants,
          reason: CHECKOUT_REJECTION_REASON.tierLosesGrants,
          detail: TIER_LOSSES_GRANTS_DETAIL,
        });
        return reply.code(409).send({
          code: 'PRICE_TIER_LOSES_GRANTS',
          message: 'PRICE_TIER_LOSES_GRANTS',
          priceId: body.priceId,
          lostGrants,
          reason: CHECKOUT_REJECTION_REASON.tierLosesGrants,
        });
      }

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
            code: 'PRICE_NOT_EFFECTIVE',
            message: 'PRICE_NOT_EFFECTIVE',
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
      const outTradeNo = buildOutTradeNo(
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
        return reply.code(502).send({ code: 'CHECKOUT_FAILED', message: 'CHECKOUT_FAILED', outTradeNo });
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
