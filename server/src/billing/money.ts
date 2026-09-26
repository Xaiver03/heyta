/**
 * 金额与折扣的**整数算术**。这一层是纯函数：不碰数据库、不读环境变量、不取当前时间。
 *
 * ## 为什么必须有这一层，而不是各处在 adapter 里算
 *
 * 折扣是**唯一一处"代码算出来的数字会变成真实收款金额"**的地方。它一旦算错，
 * 后果不是显示难看，而是：用户付了 A、我们记成 B；或者券承诺 8 折、实际打了 8.3 折
 * （虚假宣传）；或者算出负数金额下单失败，而失败发生在用户已经点了"支付"之后。
 *
 * 所以这里的每一条规则都可以用**一个可以证伪的不变量**描述（见文件末尾 §4），
 * 并且由 `server/tests/billing-money.spec.ts` 逐条扫出来 —— 不是"举几个例子看着对"。
 *
 * ## 🔴 三条硬约束
 *
 * 1. **只用整数最小单位（分 / 美分）**。全程不出现浮点。`0.1 + 0.2 !== 0.3` 在钱上
 *    是实打实的错账，而 `percent * amount / 100` 里 `percent` 通常是浮点。
 *    所以百分比用**基点（basis point，1bp = 0.01%）**表示：15% 是 `1500`。
 * 2. **折扣取整方向偏向用户**（`ceil`）。理由见 `computeDiscountMinor`。
 * 3. **算出来的金额永远不许为负，也不许超过原价**。折扣必须被**夹在** `[0, 原价]`。
 *
 * 依据：`docs/adr/0018-adjustable-pricing-and-coupons.md` §3.1、§3.4。
 */

/**
 * 支持的币种。
 *
 * 刻意只有两个，而且**不是**"以后再说"的占位：heyta 只卖一个档、两个地区
 * （大陆 / 海外），见 `docs/reference/pricing-and-entitlements.md` §1。
 * 券与价目表都按币种隔离（`docs/adr/0018-...` §3.3）——
 * 一张 ¥20 的券**绝不能**抵扣 $49 的订单，因为这两种钱之间没有我们定义的汇率。
 */
export const CURRENCIES = ['CNY', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** 运行时判据。落库前要挡一道：webhook / 管理接口的载荷不可全信。 */
export const isCurrency = (value: unknown): value is Currency =>
  typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value);

/** 最小单位的小数位数：人民币与美元都是 2 位（分 / 美分）。 */
export const MINOR_UNITS_PER_MAJOR = 100;

/**
 * 百分比的分母：**基点**。
 *
 * 为什么不是 `percent: number`（0–100 的浮点）：`8.5%` 用浮点表示不出来
 * （`8.5` 是二进制近似值），而它要乘的是一个整数金额 —— 这一个乘法的结果就可能
 * 差 1 分。基点把"8.5%"变成整数 `850`，于是整个折扣计算里只有整数乘法与除法。
 *
 * 上限就是 `PERCENT_SCALE`（= 100%），即 `PERCENT_OFF_BP_MAX`。
 */
export const PERCENT_SCALE = 10_000;
export const PERCENT_OFF_BP_MAX = PERCENT_SCALE;

/**
 * 一笔订单**最少要收多少钱**，否则不给下这个单。
 *
 * 🔴 为什么不是 `0`：一笔 0 元订单在两条真实通道上都走不通 ——
 * 微信支付的 Native 下单要求金额 ≥ 1 分（0 元订单没有可支付的收款码），
 * 而且**0 元支付不产生任何支付凭证**，于是"用户拿到了权益"这件事就没有
 * 第三方证据可对账。所以一张能把订单打到 0 的券**不是"白送"，
 * 而是"让这一单无法完成"** —— 必须在下单前就拒绝，而不是等支付失败。
 *
 * （这条只约束**付费单**。自建那条路本来就不涉及支付，不受影响。）
 */
export const MIN_CHARGEABLE_AMOUNT_MINOR = 1;

/** 金额必须是**安全整数**：分币累加不该出现在钱上，出现即数据错误。 */
export const isMinorAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

/**
 * 一张券能减多少（最小单位）。
 *
 * ## 形状：判别联合，而不是"可选字段"
 *
 * `{ percentOffBp?: number; amountOffMinor?: number }` 这种写法允许
 * "两个都给"和"两个都不给"两种非法状态存在，于是每个读者都要再判一次。
 * 判别联合让非法状态**在类型上构造不出来** —— 与 `packages/domain` 的
 * `EntityModelMap` 是同一条纪律。
 */
export type DiscountBenefit =
  | { readonly kind: 'percent'; readonly percentOffBp: number }
  | { readonly kind: 'fixed'; readonly amountOffMinor: number };

/**
 * 按券的收益算折扣额（**夹取之前**）。
 *
 * ## 🔴 取整方向：`ceil`，即"偏向用户"
 *
 * 百分比折扣几乎一定除不尽（`9900 × 3333bp / 10000 = 3299.67` 分）。三种取整：
 *
 * | 取整 | 9900 分、33.33% off 的折扣 | 用户实付 | 用户实际拿到的折扣 |
 * |---|---|---|---|
 * | `ceil`（**本实现**） | 3300 | 6600 | **≥ 33.33%** ✅ |
 * | `round` | 3300 | 6600 | 视情况，可能 < 33.33% |
 * | `floor` | 3299 | 6601 | 33.32% ❌ 少给了 |
 *
 * 选 `ceil` 的唯一理由是**对外承诺的可验证性**：我们在落地页与词条表里写的是
 * "X% off"，那就必须保证用户拿到的折扣**不少于** X%。`floor` 会让实际折扣
 * 永远**略小于**宣传值 —— 那是虚假宣传，哪怕只差 1 分。`round` 则两边都可能，
 * 无法用一条不变量表达。
 *
 * 代价是商家偶尔多让 1 分 —— 这是**有意的**方向性，不是精度损失。
 * 不变量见 §4 的 `INV-PERCENT-AT-LEAST`。
 *
 * **绝对值券不取整**：`amountOffMinor` 本身就是分，没有任何除法。
 *
 * @param benefit 券的收益
 * @param amountMinor 原价（最小单位，非负整数）
 */
export const computeDiscountMinor = (
  benefit: DiscountBenefit,
  amountMinor: number,
): number => {
  if (!isMinorAmount(amountMinor) || amountMinor < 0) {
    throw new RangeError(`原价必须是 ≥ 0 的安全整数（最小单位），实际 ${amountMinor}`);
  }
  switch (benefit.kind) {
    case 'percent': {
      const bp = benefit.percentOffBp;
      if (!isPercentOffBp(bp)) {
        throw new RangeError(
          `percentOffBp 必须是 0..${PERCENT_OFF_BP_MAX} 的安全整数，实际 ${bp}`,
        );
      }
      // `amountMinor * bp` 的上界：安全整数 × 10000 ≪ 2^53，乘法本身不会失真。
      return Math.ceil((amountMinor * bp) / PERCENT_SCALE);
    }
    case 'fixed': {
      const off = benefit.amountOffMinor;
      if (!isMinorAmount(off) || off < 0) {
        throw new RangeError(`amountOffMinor 必须是 ≥ 0 的安全整数，实际 ${off}`);
      }
      return off;
    }
    default: {
      // 判别联合穷尽性检查：将来加第三种券，这里会**编译不过**。
      const never: never = benefit;
      throw new Error(`未知的折扣类型：${JSON.stringify(never)}`);
    }
  }
};

/** 基点是否合法。`0` 合法（等于不打折，用于"仅展示"的券占位），`10000` = 100%。 */
export const isPercentOffBp = (value: unknown): value is number =>
  isMinorAmount(value) && value >= 0 && value <= PERCENT_OFF_BP_MAX;

/**
 * 把折扣**夹进** `[0, 原价]`。
 *
 * 为什么必须有这一步、且**不能只在百分比分支里做**：绝对值券可以是任意大
 * （运营者把 `amountOffMinor` 写成 `99000` —— 10 倍于 ¥99），
 * 这时 `原价 − 折扣` 是负数。一个负数金额会一路走到 `createCheckout`，
 * 而微信会拒绝它 —— 失败发生在**用户已经决定购买之后**。
 * 夹取把"下单失败"变成"这一单 0 元 → 由 `MIN_CHARGEABLE_AMOUNT_MINOR` 拒绝"，
 * 也就是把一个**通道错误**变成一个**可以提前判定的业务规则**。
 *
 * （不在这里拒绝 0 元：`computeDiscountMinor` 是纯函数，"这一单能不能收钱"
 * 是定价策略的事，在 `quote.ts` 判定。见 `MIN_CHARGEABLE_AMOUNT_MINOR`。）
 */
export const clampDiscountMinor = (discountMinor: number, amountMinor: number): number => {
  if (!isMinorAmount(discountMinor)) {
    throw new RangeError(`折扣额必须是安全整数，实际 ${discountMinor}`);
  }
  if (!isMinorAmount(amountMinor) || amountMinor < 0) {
    throw new RangeError(`原价必须是 ≥ 0 的安全整数，实际 ${amountMinor}`);
  }
  return Math.min(Math.max(discountMinor, 0), amountMinor);
};

/**
 * 一单的金额分解。**这是唯一允许从"原价 + 券"推出"实付"的地方。**
 *
 * `final = original - discount` 这条减法只写一次，理由很直接：
 * 它写两次，就会有一处忘了夹取。
 */
export interface AmountBreakdown {
  readonly originalAmountMinor: number;
  readonly discountMinor: number;
  readonly finalAmountMinor: number;
}

export const breakdownAmount = (
  originalAmountMinor: number,
  discountMinor: number,
): AmountBreakdown => {
  const clamped = clampDiscountMinor(discountMinor, originalAmountMinor);
  return {
    originalAmountMinor,
    discountMinor: clamped,
    finalAmountMinor: originalAmountMinor - clamped,
  };
};

/**
 * 人类可读的金额（例如 `¥99.00` / `$49.00`）。
 *
 * ⚠️ 这**不是**展示文案的唯一来源：落地页的价格字符串仍然在词条表里
 * （`landing.pricing.hosted.price*`），由 `scripts/check-pricing-consistency.mjs`
 * 钉住与价目表一致。本函数只用于**日志、审计记录、运维脚本** ——
 * 那些地方不该出现"9900 分"这种让人心算的数字。
 *
 * 不引 `Intl`：`Intl.NumberFormat` 的行为随 Node 的 ICU 数据变化，
 * 而这些字符串要进审计表（也就是要长期可比）。所以手写，且只支持两种币种。
 */
export const formatMinor = (amountMinor: number, currency: Currency): string => {
  if (!isMinorAmount(amountMinor)) {
    throw new RangeError(`金额必须是安全整数，实际 ${amountMinor}`);
  }
  const negative = amountMinor < 0;
  const abs = Math.abs(amountMinor);
  const major = Math.trunc(abs / MINOR_UNITS_PER_MAJOR);
  const minor = abs % MINOR_UNITS_PER_MAJOR;
  const symbol = currency === 'CNY' ? '¥' : '$';
  const body = `${symbol}${major}.${String(minor).padStart(2, '0')}`;
  return negative ? `-${body}` : body;
};

// ---------------------------------------------------------------------------
// §4 不变量（由 `server/tests/billing-money.spec.ts` 逐条扫出）
// ---------------------------------------------------------------------------
//
// INV-NON-NEGATIVE       final ≥ 0，对任意 amount ≥ 0 与任意合法 benefit 成立。
// INV-NOT-MORE-THAN-BASE final ≤ original。
// INV-DISCOUNT-RANGE     discount ∈ [0, original]。
// INV-PERCENT-AT-LEAST   ceil 分支：final × 10000 ≤ original × (10000 − bp)。
//                        即"用户拿到的折扣不少于券面承诺的百分比"。
//                        🔴 把 `Math.ceil` 改成 `Math.floor` 会**打破这条**，
//                        测试会红 —— 这条不变量就是那个改动的守门人。
// INV-DETERMINISTIC      同一 (benefit, amount) 反复调用恒等，且不含浮点。
// INV-FIXED-EXACT        绝对值券在 `off ≤ amount` 时折扣**精确等于** off（不取整）。
//
// 这些不变量都是**可以证伪**的：改一行实现就能让某条红。
