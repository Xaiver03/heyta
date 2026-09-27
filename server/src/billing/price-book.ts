/**
 * **可调整的价目表**：价格是数据，不是散落在代码里的常量。
 * ==========================================================
 *
 * ## 为什么要有这一层
 *
 * 在加这个文件之前，"价格"这个事实同时存在于四个地方，而它们之间**没有任何
 * 类型关系**（见 `docs/reference/pricing-and-entitlements.md` §4）：
 * adapter 里的常量、中英词条表、法务文本、参考文档。于是"改价"这件事
 * 不是一次修改，而是**四次必须同时做对的修改**，且漏掉任何一次都是一次
 * 真实事故（用户看到的价格 ≠ 他要付的价格）。
 *
 * 本文件把那四处里**"实际收多少"**这一处变成：
 *
 * - **一份带生效区间的版本化价目表**（`PriceBookEntry[]`），而不是一个常量；
 * - **可被运行时覆盖**（数据库里的一行，见 `price-book-store.ts`）——
 *   「改价不改代码」是刻意的，而且**不改代码**这件事在促销场景里是必需的：
 *   限时价需要在某个时刻自动生效、某个时刻自动失效，而不是等一次部署；
 * - **每一次改价都留审计**（`pricing_audit_log`），因为"某个用户在某个价格下
 *   买了东西"必须可回溯 —— 这是钱的账，不是配置的账。
 *
 * ## 这一层是纯的
 *
 * 不碰数据库、不读环境变量、不取当前时间（`now` 一律由调用方传入）。
 * 于是"区间解析"与"重叠校验"可以用一组**可以证伪的**测试穷尽扫出来
 * （`server/tests/billing-price-book.spec.ts`）。
 *
 * 依据：`docs/adr/0018-adjustable-pricing-and-coupons.md` §3.2、§4。
 */

import { CURRENCIES, formatMinor, isCurrency, isMinorAmount, type Currency } from './money';

/**
 * 价目表的一**版**。
 *
 * 🔴 版本是不可变的：改价 = **追加一版**，不是就地改一行。
 *
 * 为什么不用「一个可变的 `currentAmount` 列 + 一张历史表」：那样"当前价"与
 * "历史价"是**两种形状**的数据，于是每个读价格的地方都要判一次"读哪张表"，
 * 而漏判的那一处会静默地用当前价去解释一笔历史订单 —— 那是错账。
 * 统一成"区间"之后，"当前价"只是"区间包含 `now` 的那一版"这一个查询，
 * 历史订单也能用**同一个函数**按它自己的时间点解析出当时的价格。
 */
export interface PriceBookEntry {
  /** 价格标识（SKU）。与 `createCheckout` 的 `priceId` 同值，例如 `hosted-monthly`。 */
  readonly priceId: string;
  readonly currency: Currency;
  /** 金额，**最小单位整数**（分 / 美分）。 */
  readonly amountMinor: number;
  /** 生效起点（epoch 毫秒，**含**）。 */
  readonly effectiveFrom: number;
  /**
   * 生效终点（epoch 毫秒，**不含**）。`null` = 一直有效（开区间）。
   *
   * 🔴 右开、左闭是刻意的：这样"上一版结束的那一刻"就是"下一版开始的那一刻"，
   * 两版在边界上**不会同时生效**，也不会有一个纳秒的空隙。
   * 若两端都闭，边界毫秒上两版同时成立 → `resolvePrice` 会判成重叠而抛异常，
   * 而这是**正常的改价操作**，不是数据错误。
   */
  readonly effectiveUntil: number | null;
  /** 人类可读的备注，进审计与运维脚本输出。例如「上线推广价」。 */
  readonly note?: string;
}

/** 「这一版是不是在 `now` 生效」——左闭右开。 */
export const isEntryEffectiveAt = (entry: PriceBookEntry, now: number): boolean =>
  now >= entry.effectiveFrom && (entry.effectiveUntil === null || now < entry.effectiveUntil);

/**
 * 🔴 SKU → 它授予的能力（`hosting` / `ai`）。
 *
 * **按 SKU 而不是按价格版本**：一次改价改的是金额，从不改变"这一档给什么"。
 * 把 grants 放到 `PriceBookEntry`（一个版本）上会凭空造出一个自由度 ——
 * 同一 SKU 的两版可以声明不同的能力 —— 而那个自由度没有任何有意义的用法，
 * 只会变成一个需要门禁去防的不一致。`price_versions` 表也因此不必加列。
 *
 * 与下面四处同源：`docs/reference/pricing-and-entitlements.md` 的 `pricing-ssot`
 * 块、`scripts/check-pricing-consistency.mjs` 的 `ALLOWED_GRANTS`、
 * `Subscription.grants` 的 DB CHECK，以及 `entitlement.ts` 的
 * `ENTITLEMENT_CAPABILITIES`。门禁会红在"两处说法不一致"上。
 */
export const SKU_GRANTS: Readonly<Record<string, readonly string[]>> = {
  'hosted-monthly': ['hosting'],
  'hosted-ai-monthly': ['hosting', 'ai'],
};

/**
 * 取某个 SKU 授予的能力。
 *
 * 🔴 未知 SKU 返回 `null` 而**不是**空数组 —— 两者语义不同，且混起来很危险：
 * `[]` 是"这一档确定不授予任何能力"（一个合法的声明），`null` 是"我们不知道
 * 这个 SKU 是什么"（价目表与能力表不同步）。调用方对前者的处理是"照常授予零项"，
 * 对后者的处理必须是"不要授予，并告警"。
 */
export const grantsForSku = (priceId: string): readonly string[] | null =>
  SKU_GRANTS[priceId] ?? null;

/**
 * 🔴 **已定价、已对外承诺，但尚不可交付 —— 因此不得售卖的 SKU。**
 *
 * 这是 [ADR-0023](../../docs/adr/0023-managed-ai-quota-not-implemented.md) §3.1
 * 那条硬约束的**执行点**。只写进 ADR 而没有执行点，就等于没有这条约束 ——
 * 收银台正是它要挡住的那扇门。
 *
 * 为什么是"不得售卖"而不是"不许宣传"：落地页可以继续描述 ¥12（那是**已锁定**的
 * 产品决定），但**收了钱交付不了**是另一回事。带 `ai` 能力的那一档买的是
 * 云端 AI 的 300 次/月，而端点、计量、模型调用**一个都不存在**。
 *
 * 值里的那句话是给**用户**看的拒绝理由：他点了支付却买不成，必须知道为什么，
 * 而不是看到一个 500。清单清空之日（ADR-0023 §5）就是这里被删掉之日。
 *
 * ⚠️ 这个对象是 `scripts/check-ai-quota-consistency.mjs` §3b 的锚点：
 * 那个门会**解析下面这个对象字面量**并检查键。所以别把 SKU id 写进本注释里
 * 当作"已经声明"的证据 —— 门读的是对象体，不是注释。
 */
export const NOT_YET_DELIVERABLE_SKUS: Readonly<Record<string, string>> = {
  'hosted-ai-monthly': '云端 AI 的端点与用量计量尚未上线，这一档暂时无法购买（ADR-0023）',
};

/**
 * 这一档现在能不能卖。`null` = 能卖；否则返回**给用户看的**理由。
 *
 * 🔴 与 `grantsForSku` 刻意分开：那个回答"这一档给什么能力"（长期属性），
 * 这个回答"今天能不能交付"（临时状态）。混成一个的话，临时下架会看起来像
 * "档位被删了"，恢复上架会看起来像"新增了一个档"。
 */
export const notSellableReason = (priceId: string): string | null =>
  NOT_YET_DELIVERABLE_SKUS[priceId] ?? null;

/**
 * 解析一个精确的价目表条目。
 *
 * 语义（三条，缺一不可）：
 * - 恰好一个匹配 → 返回它；
 * - **多个匹配 → 抛异常**。重叠是**数据错误**，而"取第一个"会让它永远不被发现
 *   （两个价格同时生效，取哪个都"能跑"），最后表现为"有时候收 A 有时候收 B"；
 * - 零个匹配 → `null`（**由调用方**决定这是"没有这个 SKU"还是"这一刻没有生效版本"，
 *   因为这两种情况的处理不同：前者是 404，后者是配置漏洞。见
 *   `resolveEffectivePrice`）。
 */
export const resolvePriceEntry = (
  entries: readonly PriceBookEntry[],
  query: { readonly priceId: string; readonly currency: Currency; readonly now: number },
): PriceBookEntry | null => {
  const matched = entries.filter(
    (e) =>
      e.priceId === query.priceId && e.currency === query.currency && isEntryEffectiveAt(e, query.now),
  );
  if (matched.length === 0) return null;
  if (matched.length > 1) {
    throw new PriceBookOverlapError(query.priceId, query.currency, query.now, matched);
  }
  return matched[0] ?? null;
};

/** 价目表里同一 (priceId, currency) 在某一时刻有多版同时生效。**这是数据错误。** */
export class PriceBookOverlapError extends Error {
  readonly code = 'PRICE_BOOK_OVERLAP';

  constructor(
    readonly priceId: string,
    readonly currency: Currency,
    readonly now: number,
    readonly matched: readonly PriceBookEntry[],
  ) {
    super(
      `价目表里 ${priceId}/${currency} 在 ${new Date(now).toISOString()} 有 ` +
        `${matched.length} 版同时生效 —— 重叠是数据错误，拒绝猜一个。` +
        `命中：${matched.map((m) => `${m.amountMinor}@${m.effectiveFrom}`).join(', ')}`,
    );
    this.name = 'PriceBookOverlapError';
  }
}

/** 价目表里根本没有这个 (priceId, currency)。 */
export class UnknownPriceError extends Error {
  readonly code = 'PRICE_UNKNOWN';

  constructor(
    readonly priceId: string,
    readonly currency: Currency,
  ) {
    super(`价目表里没有 ${priceId}/${currency} —— 拒绝按 0 元下单`);
    this.name = 'UnknownPriceError';
  }
}

/**
 * 有覆盖版本、但**这一刻没有一版生效**（区间之间有洞）。
 *
 * 与 `UnknownPriceError` 分开：这个错误的成因是**运维改价改出了一个空隙**，
 * 不是"这个 SKU 不存在"。混成一个错误会让排查的人去查 SKU 名字。
 */
export class PriceNotEffectiveError extends Error {
  readonly code = 'PRICE_NOT_EFFECTIVE';

  constructor(
    readonly priceId: string,
    readonly currency: Currency,
    readonly now: number,
  ) {
    super(
      `价目表 ${priceId}/${currency} 有版本，但没有一版覆盖 ${new Date(now).toISOString()} —— ` +
        '改价留下的空隙，不是"这个 SKU 不存在"',
    );
    this.name = 'PriceNotEffectiveError';
  }
}

/**
 * **代码默认价目表**：新装实例的初始价格。
 *
 * 🔴 它不是"另一份事实源"，而是**基线**。裁决顺序是：
 *
 *   1. 数据库里对该 (priceId, currency) 有版本 → **数据库赢**，代码默认被完全遮蔽；
 *   2. 数据库里没有 → 用这里。
 *
 * 这样"改价"有两种粒度：一次部署改基线（长期定价），或一次数据变更加一版
 * 限时价（促销）。两者的可见后果不同，但**解析用的是同一个函数**。
 *
 * ⚠️ 第 1 条的代价必须说清楚：如果数据库里存在一条旧覆盖，
 * **改这个常量不会让实际价格变** —— 覆盖会遮蔽它。所以
 * `scripts/check-pricing-consistency.mjs` 钉住的是"**基线与对外文案一致**"，
 * 而 `server/scripts/pricing.ts show` 会**明确警告**是否存在遮蔽
 * （并列出还需要同步的每一个文案落点，退出码 1）。
 *
 * 📌 这里原先点名的是 `server/scripts/show-price.ts` —— **那个文件从来不存在**。
 * 遮蔽告警现在实现在上面那个 CLI 里（`pnpm --filter @heyta/server pricing show`）。
 *
 * 这里的数字必须与 `docs/reference/pricing-and-entitlements.md` 的
 * ```` ```json pricing-ssot ```` 块、中英词条表、法务文本一致，门禁会红。
 * `effectiveFrom` 取 0 而不是给一个"上线时刻"：基线从**有史以来**就有效，
 * 于是任何 `now` 都能解析出结果，不会因为机器时钟偏差而落进空隙。
 */
export const DEFAULT_PRICE_BOOK: readonly PriceBookEntry[] = [
  {
    priceId: 'hosted-monthly',
    currency: 'CNY',
    amountMinor: 500,
    effectiveFrom: 0,
    effectiveUntil: null,
    note: '大陆官方托管 · 月付（基线）',
  },
  {
    priceId: 'hosted-monthly',
    currency: 'USD',
    amountMinor: 500,
    effectiveFrom: 0,
    effectiveUntil: null,
    note: '海外官方托管 · 月付（基线）',
  },
  {
    priceId: 'hosted-ai-monthly',
    currency: 'CNY',
    amountMinor: 1_200,
    effectiveFrom: 0,
    effectiveUntil: null,
    note: '大陆官方托管 + 云端 AI · 月付（基线）',
  },
  {
    priceId: 'hosted-ai-monthly',
    currency: 'USD',
    amountMinor: 1_200,
    effectiveFrom: 0,
    effectiveUntil: null,
    note: '海外官方托管 + 云端 AI · 月付（基线）',
  },
];

/**
 * 校验一份价目表，返回**全部**问题（不是遇到第一个就抛）。
 *
 * 为什么返回列表而不是 fail-fast：改价是人手动做的，一次可能同时写错好几处。
 * 一次报全部能让人一次改完；只报第一个会让人改五轮。
 *
 * ⚠️ `requireNonEmpty` 这个开关是必需的，不是方便：**"一份空的价目表"和
 * "一份覆盖版本列表为空"是两件完全不同的事** ——
 * - 前者是配置错误（一个 SKU 都没有，收不了钱）；
 * - 后者是**完全正常的初始状态**（还没人改过价，一切都走代码基线）。
 *
 * 把它们混成一个判据会让"从没改过价的新装实例"在每次读覆盖版本时抛异常。
 * 这个开关就是那两种语义的分界点。
 */
export const validatePriceBook = (
  entries: readonly PriceBookEntry[],
  options: { readonly requireNonEmpty?: boolean } = {},
): string[] => {
  const problems: string[] = [];
  const requireNonEmpty = options.requireNonEmpty ?? true;

  if (entries.length === 0) {
    if (requireNonEmpty) {
      problems.push('价目表是空的 —— 一份没有价格的价目表不该被当成"合法但没有 SKU"。');
    }
    return problems;
  }

  for (const [index, entry] of entries.entries()) {
    const where = `第 ${index + 1} 项（${entry.priceId ?? '?'}/${entry.currency ?? '?'}）`;
    if (typeof entry.priceId !== 'string' || entry.priceId.trim() === '') {
      problems.push(`${where}：priceId 不能为空`);
    }
    if (!isCurrency(entry.currency)) {
      problems.push(`${where}：currency 必须是 ${CURRENCIES.join(' / ')}`);
    }
    if (!isMinorAmount(entry.amountMinor) || entry.amountMinor <= 0) {
      problems.push(
        `${where}：amountMinor 必须是**正**安全整数（分），实际 ${entry.amountMinor} —— ` +
          '0 元不是"免费档"，而是"这个 SKU 不该存在"',
      );
    }
    if (!isMinorAmount(entry.effectiveFrom) || entry.effectiveFrom < 0) {
      problems.push(`${where}：effectiveFrom 必须是 ≥ 0 的安全整数，实际 ${entry.effectiveFrom}`);
    }
    if (entry.effectiveUntil !== null) {
      if (!isMinorAmount(entry.effectiveUntil)) {
        problems.push(`${where}：effectiveUntil 必须是安全整数或 null`);
      } else if (!isMinorAmount(entry.effectiveFrom) || entry.effectiveUntil <= entry.effectiveFrom) {
        problems.push(
          `${where}：effectiveUntil(${entry.effectiveUntil}) 必须**严格大于** ` +
            `effectiveFrom(${entry.effectiveFrom}) —— 左闭右开区间不能为空`,
        );
      }
    }
  }

  // 同一 (priceId, currency) 的窗口不允许重叠（边界相接不算重叠，因为是右开）。
  const byKey = new Map<string, PriceBookEntry[]>();
  for (const entry of entries) {
    const key = `${entry.priceId}\u0000${entry.currency}`;
    const list = byKey.get(key);
    if (list === undefined) byKey.set(key, [entry]);
    else list.push(entry);
  }
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) => a.effectiveFrom - b.effectiveFrom);
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (prev === undefined || cur === undefined) continue;
      const prevEnd = prev.effectiveUntil;
      if (prevEnd === null || prevEnd > cur.effectiveFrom) {
        const [priceId, currency] = key.split('\u0000');
        problems.push(
          `${priceId}/${currency} 的版本窗口重叠：` +
            `[${prev.effectiveFrom}, ${prevEnd === null ? '∞' : prevEnd}) 与 ` +
            `[${cur.effectiveFrom}, ${cur.effectiveUntil === null ? '∞' : cur.effectiveUntil})。` +
            '重叠会让"这一刻收多少钱"变成未定义 —— 追加新版本时要先把上一版的' +
            '`effectiveUntil` 收到新版本的 `effectiveFrom`。',
        );
      }
    }
  }

  return problems;
};

/**
 * 校验一份价目表；有问题就抛（把所有问题合并进一条错误里）。
 *
 * 用在写入路径（`publishPrice`）与门禁上：**非法价目表绝不能进库**。
 * 与 `validatePriceBook` 的分工是"给人看" vs "给程序用"。
 */
export const assertValidPriceBook = (
  entries: readonly PriceBookEntry[],
  options: { readonly requireNonEmpty?: boolean } = {},
): void => {
  const problems = validatePriceBook(entries, options);
  if (problems.length === 0) return;
  throw new InvalidPriceBookError(problems);
};

/** 价目表不合法。`problems` 是**全部**问题，不是第一个。 */
export class InvalidPriceBookError extends Error {
  readonly code = 'PRICE_BOOK_INVALID';

  constructor(readonly problems: readonly string[]) {
    super(`价目表不合法（${problems.length} 处）：\n   - ${problems.join('\n   - ')}`);
    this.name = 'InvalidPriceBookError';
  }
};

/**
 * 从"基线 + 覆盖"里解析出**某一刻真实生效**的那一版。
 *
 * 裁决顺序（与 `DEFAULT_PRICE_BOOK` 的注释同一件事，这里是可以执行的那一份）：
 *
 * | 数据库里对该 key 有版本吗 | 行为 |
 * |---|---|
 * | 有 | **只在覆盖里找**。找到 → 用它；没找到 → `PriceNotEffectiveError` |
 * | 无 | 只在基线里找。找到 → 用它；没找到 → `UnknownPriceError` |
 *
 * 🔴 关键在"**只在覆盖里找**"：如果覆盖里没找到就回落到基线，
 * 那么"改价改出一个空隙"这件事的后果是**按旧价收钱** —— 静默地按一个
 * 已经被替换掉的价格收款，而且没有任何错误。那正是错账最难看的一种形状。
 *
 * @param baseline 代码基线（`DEFAULT_PRICE_BOOK`）
 * @param overrides 数据库里的版本（可为空数组）
 * @param query priceId / currency / now
 */
export const resolveEffectivePrice = (
  baseline: readonly PriceBookEntry[],
  overrides: readonly PriceBookEntry[],
  query: { readonly priceId: string; readonly currency: Currency; readonly now: number },
): PriceBookEntry => {
  const forKey = (list: readonly PriceBookEntry[]) =>
    list.filter((e) => e.priceId === query.priceId && e.currency === query.currency);

  const overrideForKey = forKey(overrides);
  if (overrideForKey.length > 0) {
    const hit = resolvePriceEntry(overrideForKey, query);
    if (hit === null) {
      throw new PriceNotEffectiveError(query.priceId, query.currency, query.now);
    }
    return hit;
  }

  const baselineForKey = forKey(baseline);
  const hit = resolvePriceEntry(baselineForKey, query);
  if (hit === null) {
    throw new UnknownPriceError(query.priceId, query.currency);
  }
  return hit;
};

/**
 * 把价目表投影成微信 adapter 要的 `{ [priceId]: { totalFen, description } }`。
 *
 * 存在的理由：**价格不该在 adapter 里再抄一份**。adapter 的默认价目表曾经是
 * 一个独立常量（见 `wechat.adapter.ts` 的注释），本函数把它变成派生值 ——
 * "再抄一份"从此不是纪律问题，而是**做不到**。
 *
 * 只投影指定币种：微信只收 CNY。取不到生效版本的 SKU 直接**不出现**在结果里
 * （而不是补一个 0），于是下单时 `WechatUnknownPriceError` 会照常拦住它 ——
 * fail-closed 保持在 adapter 那一侧，本函数不替它决定。
 *
 * 同一 priceId 在 `now` 有多版生效 = 数据错误 → 抛 `PriceBookOverlapError`。
 */
export const projectPrices = (
  entries: readonly PriceBookEntry[],
  currency: Currency,
  now: number,
): Readonly<Record<string, { readonly totalFen: number; readonly description: string }>> => {
  const out: Record<string, { totalFen: number; description: string }> = {};
  const priceIds = [...new Set(entries.filter((e) => e.currency === currency).map((e) => e.priceId))];
  for (const priceId of priceIds) {
    const hit = resolvePriceEntry(entries.filter((e) => e.currency === currency), {
      priceId,
      currency,
      now,
    });
    if (hit === null) continue;
    out[priceId] = {
      totalFen: hit.amountMinor,
      description: hit.note ?? `heyta ${priceId}（${formatMinor(hit.amountMinor, currency)}）`,
    };
  }
  return out;
};
