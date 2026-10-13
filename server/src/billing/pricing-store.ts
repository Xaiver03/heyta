/**
 * 定价与优惠券的**持久化层**。
 * =================================
 *
 * ## 为什么 SQL 走一个端口，而不是直接 `import { prisma }`
 *
 * 这个仓库里所有涉及钱的 SQL 都必须**被真的跑过**。直接 `import { prisma }`
 * 会让这段代码在 CI 里一行都执行不到（CI 没有 PostgreSQL），于是"并发核销会不会
 * 超发"就只能靠读代码相信 —— 而这个仓库的规矩是不信（见
 * `array-branch-equivalence.pglite.spec.ts` 的文件头）。
 *
 * 所以 IO 做成一个 `SqlExecutor` 端口：
 * - 生产：`createPrismaSqlExecutor(prisma)`（见本文件末尾）；
 * - 测试：`createPgliteSqlExecutor(db)` —— PGlite 是**真的 PostgreSQL**，
 *   于是下面这些 SQL（含 `SELECT ... FOR UPDATE`、唯一约束、CHECK 约束）
 *   在原生的 Postgres 语义下被真跑一遍。
 *
 * 剩下没被覆盖的只有"Prisma 的参数绑定"那一层薄胶水，这一点在
 * `docs/reference/pricing-and-coupons.md` §7 的未验证项里写明，不假装它被测过。
 *
 * ## 🔴 两条不可动摇的规则
 *
 * 1. **金额只从报价快照里读，不在落库时重算。** 重算意味着"下单时算一次、
 *    回调时再算一次"，而两次之间价格或券可以变。见 `quote.ts` 的文件头。
 * 2. **名额的计数口径只有一处**（`COUNTED_REDEMPTION_STATES`），
 *    而且 `expired` **不在**里面、`reversed` **在**里面。理由见那个常量的注释。
 */

import {
  type CouponDefinition,
  type CouponUsage,
  type Region,
  COUPON_REJECTION_EXPLANATION,
  validateCouponDefinition,
} from './coupon';
import { isMinorAmount, type Currency } from './money';
import {
  assertValidPriceBook,
  type PriceBookEntry,
} from './price-book';
import type { OrderQuote, RejectedCoupon } from './quote';

// ---------------------------------------------------------------------------
// 端口
// ---------------------------------------------------------------------------

/** 最小 SQL 执行端口。参数一律用 `$1, $2 …` 占位（PostgreSQL 原生）。 */
export interface SqlRunner {
  query<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  /** 返回受影响行数。 */
  execute(sql: string, params?: readonly unknown[]): Promise<number>;
}

/**
 * 根 SQL 面：`SqlRunner` + 开事务。
 *
 * 🔴 **事务回调拿到的是受限的 `SqlRunner`，不是 `SqlExecutor`** —— 这个区分是
 * 类型层的，不是注释层的。Prisma 的事务 client **故意没有** `$transaction`
 * （它在 `ITXClientDenyList` 里），所以"回调参数能不能再开一层事务"这件事，
 * 一旦声明成 `SqlExecutor` 就**永远**不兼容 `PrismaClient.$transaction`：
 * `createPrismaSqlExecutor(prisma)` 在 strict 下抛 `TS2345`。
 *
 * 那条路径当时没有生产调用点，于是这个洞躲过了 `tsc`（vitest 只转译、不做类型
 * 检查，而 `server/tsconfig.json` 的 `include` 又不含 `tests/**`）。现在拆开之后，
 * "不许嵌套事务"由类型拦住，而不是靠人记得。
 * 原缺口记录见 `docs/reference/pricing-and-coupons.md` §7 第 12 条。
 */
export interface SqlExecutor extends SqlRunner {
  transaction<T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// 词表
// ---------------------------------------------------------------------------

/** 订单状态。与迁移里的 `checkout_orders_status_known` CHECK **必须一致**。 */
export const ORDER_STATUSES = ['pending', 'paid', 'failed', 'expired', 'refunded'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** 核销状态。与迁移里的 `coupon_redemptions_state_known` CHECK 一致。 */
export const REDEMPTION_STATES = ['reserved', 'applied', 'expired', 'reversed'] as const;
export type RedemptionState = (typeof REDEMPTION_STATES)[number];

/**
 * 🔴 **哪些核销状态占用券的名额。** 这一个常量是限额语义的唯一定义处。
 *
 * | 状态 | 计数 | 为什么 |
 * |---|---|---|
 * | `reserved` | ✅ | 不占名额的话，刷预留就能把限量券占满（占位是主动攻击面） |
 * | `applied` | ✅ | 已用掉的 |
 * | `reversed` | ✅ | 退款**不归还**名额。总量限额是"预算已投放"的语义，归还意味着同一份预算能被买→退→再买反复薅（行业默认也是不自动归还：微信商家券要商户**主动**调退券接口才回卡包） |
 * | `expired` | ❌ | **必须**不占。否则一张限 100 张的券会被 100 个"点了支付但没付"的单永久占满 —— 那时 sweep 就毫无意义了 |
 *
 * ⚠️ 由此产生一个**有意的、有界的不一致**：一笔支付如果晚于订单过期才到
 * （`markOrderPaid` 的 `afterExpiry`），那个名额可能已经被别人拿走了。
 * 结果是最多超发 1 次。这个方向是**故意的** —— 宁可多给一个人权益，
 * 也不能因为"名额没了"就吞掉一笔真实到账的钱。`quotaExceeded` 会被返回，
 * 调用方应把它记成告警，而不是当成正常路径。
 */
export const COUNTED_REDEMPTION_STATES: readonly RedemptionState[] = [
  'reserved',
  'applied',
  'reversed',
];

const stateList = (states: readonly RedemptionState[]): string =>
  states.map((s) => `'${s}'`).join(', ');

// ---------------------------------------------------------------------------
// 时间戳归一化（驱动差异的收敛点）
// ---------------------------------------------------------------------------

/**
 * `BIGINT` 列 → epoch 毫秒。
 *
 * 🔴 必须同时接受 `number` / `bigint` / `string`：**不同驱动给不同类型** ——
 * Prisma 对 `BigInt` 列返回 `bigint`，node-postgres 传统上返回 `string`。
 * 只处理一种的话，另一种会在运行时变成 `Number(undefined)` 或一个字符串比较，
 * 而它不会报错，只会算错时间。非法值一律 `undefined`，由调用方决定怎么办。
 */
export const toMillis = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  }
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
    return Number(value);
  }
  if (typeof value === 'string') {
    if (!/^\d+$/.test(value)) return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
};

/** 必须有值的时刻；拿不到就抛 —— 沉默地把 `undefined` 当 0 会让报价窗口变成 1970 年。 */
const requiredMillis = (value: unknown, what: string): number => {
  const millis = toMillis(value);
  if (millis === undefined) {
    throw new Error(`${what} 不是一个合法的 epoch 毫秒值：${JSON.stringify(value)}`);
  }
  return millis;
};

// ---------------------------------------------------------------------------
// 价目表
// ---------------------------------------------------------------------------

interface PriceVersionRow {
  readonly price_id: unknown;
  readonly currency: unknown;
  readonly amount_minor: unknown;
  readonly effective_from: unknown;
  readonly effective_until: unknown;
  readonly note: unknown;
}

/**
 * 读数据库里的价目表版本（**全部**，不只是当前生效的）。
 *
 * 全部读出来是刻意的：`resolveEffectivePrice` 是纯函数，它需要看到整个区间集合
 * 才能判断"这一刻有没有版本生效"以及"有没有重叠"。只读 `now` 那一版等于把这个
 * 判断塞进 SQL，于是它就不能被单元测试穷尽扫到了。
 */
export const loadPriceOverrides = async (sql: SqlExecutor): Promise<PriceBookEntry[]> => {
  const rows = await sql.query<PriceVersionRow>(
    `SELECT price_id, currency, amount_minor, effective_from, effective_until, note
       FROM price_versions
      ORDER BY price_id, currency, effective_from`,
  );
  const entries: PriceBookEntry[] = rows.map((row) => {
    const until = row.effective_until === null ? null : requiredMillis(row.effective_until, 'price_versions.effective_until');
    return {
      priceId: String(row.price_id),
      currency: row.currency as Currency,
      amountMinor: Number(row.amount_minor),
      effectiveFrom: requiredMillis(row.effective_from, 'price_versions.effective_from'),
      effectiveUntil: until,
      ...(row.note === null || row.note === undefined ? {} : { note: String(row.note) }),
    };
  });
  // 🔴 价目表坏掉就**必须响**：重叠的窗口意味着"这一刻收多少钱"是未定义的，
  // 而它没有任何合理的降级行为。与"券坏掉只跳过那张券"不同（见 loadCoupons）。
  //
  // ⚠️ `requireNonEmpty: false` 是必需的：**空数组在这里的语义是"还没人改过价"**，
  // 一切都走代码基线 —— 那是最常见的初始状态，不是配置错误。
  // （把这两种语义混起来会让新装实例的每一次报价都炸。）
  assertValidPriceBook(entries, { requireNonEmpty: false });
  return entries;
};

/** 改价的一次操作记录。 */
export interface PublishPriceInput {
  readonly entry: PriceBookEntry;
  /** 覆盖版本的开始时刻。必须**严格晚于**被它结束的那一版的 `effectiveFrom`。 */
  readonly effectiveFrom: number;
  readonly actor: string;
  readonly note: string;
}

/** 改价的对象不存在（要结束的那一版找不到）。 */
export class PriceVersionConflictError extends Error {
  readonly code = 'PRICE_VERSION_CONFLICT';

  constructor(message: string) {
    super(message);
    this.name = 'PriceVersionConflictError';
  }
}

/**
 * **发布一版新价格**：把当前开区间的那一版收口，再插入新版，并写审计。
 *
 * 三件事必须在**同一个事务**里，否则会出现"旧版已收口、新版还没插入"的
 * 一瞬间 —— 那一刻任何报价都会抛 `PriceNotEffectiveError`，也就是一个
 * 真实的"改价把收银台弄挂了"的窗口。
 *
 * 用 `FOR UPDATE` 锁住旧版那一行，让两个并发的改价请求串行化。
 * 这不是性能问题（改价是人手动做的），而是"两版同时开区间"这个数据错误的
 * 唯一防线 —— 而那个错误会让 `resolveEffectivePrice` 在之后每一笔报价上抛异常。
 */
export const publishPriceVersion = async (
  sql: SqlExecutor,
  input: PublishPriceInput,
): Promise<{ readonly closedVersionId: number | null; readonly newVersionId: number }> =>
  sql.transaction(async (tx) => {
    assertValidPriceBook([input.entry]);
    // 一次取时钟：`created_at` 与审计行的时刻必须**同一个值**，
    // 否则"先有审计还是先有版本"在排查时会得出两个结论。
    const now = Date.now();

    const open = await tx.query<{ id: unknown; effective_from: unknown; amount_minor: unknown }>(
      `SELECT id, effective_from, amount_minor
         FROM price_versions
        WHERE price_id = $1 AND currency = $2 AND effective_until IS NULL
        FOR UPDATE`,
      [input.entry.priceId, input.entry.currency],
    );

    let closedVersionId: number | null = null;
    if (open.length > 1) {
      throw new PriceVersionConflictError(
        `${input.entry.priceId}/${input.entry.currency} 有 ${open.length} 版同时开着区间 —— ` +
          '这是数据错误，拒绝继续改价（先把它们收口）。',
      );
    }
    const previous = open[0];
    if (previous !== undefined) {
      const previousFrom = requiredMillis(previous.effective_from, '旧 version.effective_from');
      if (input.effectiveFrom <= previousFrom) {
        throw new PriceVersionConflictError(
          `新版生效时刻 ${input.effectiveFrom} 不晚于旧版起点 ${previousFrom} —— ` +
            '那会让两版重叠（旧版无法收口）。',
        );
      }
      closedVersionId = Number(previous.id);
      await tx.execute(
        `UPDATE price_versions SET effective_until = $1 WHERE id = $2`,
        [input.effectiveFrom, closedVersionId],
      );
    }

    const inserted = await tx.query<{ id: unknown }>(
      `INSERT INTO price_versions
         (price_id, currency, amount_minor, effective_from, effective_until, note, created_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        input.entry.priceId,
        input.entry.currency,
        input.entry.amountMinor,
        input.effectiveFrom,
        input.entry.effectiveUntil ?? null,
        input.note,
        now,
        input.actor,
      ],
    );
    const newVersionId = Number(inserted[0]?.id);

    await appendAudit(tx, {
      action: 'price_published',
      target: `${input.entry.priceId}/${input.entry.currency}`,
      beforeJson: previous === undefined ? null : JSON.stringify({ amountMinor: Number(previous.amount_minor), effectiveFrom: requiredMillis(previous.effective_from, '旧版起点') }),
      afterJson: JSON.stringify({ amountMinor: input.entry.amountMinor, effectiveFrom: input.effectiveFrom }),
      actor: input.actor,
      note: input.note,
      now,
    });

    return { closedVersionId, newVersionId };
  });

// ---------------------------------------------------------------------------
// 审计
// ---------------------------------------------------------------------------

export const AUDIT_ACTIONS = [
  'price_published',
  'coupon_upserted',
  'coupon_toggled',
  /**
   * 🔴 支付到账金额与订单冻结金额不一致。**这是会实际损失钱的那一类事件**，
   * 所以它必须留下审计行 —— 只在返回值里报一个 `amount-mismatch` 而库里没有痕迹，
   * 等于"有人付了不对的钱"这件事只存在于当时那条日志里。
   */
  'order_amount_mismatch',
  /**
   * 退款这一族（ADR-0053）。**每一条都要落审计**，理由与 `order_amount_mismatch`
   * 同一条：钱上的决定不能只活在当时那个 HTTP 响应里。
   *
   * · `refund_requested` / `refund_denied`：政策判"能退/不能退"的那一次判断本身。
   *   被拒也要留痕 —— 用户七天内申请过而被挡，是一个要能举证的事实。
   * · `refund_decided`：运营批准或拒绝（`operator_note` 是"谁批的、为什么批"的载体）。
   * · `refund_channel_failed`：通道拒了。**权益一格未动**，所以更需要可查。
   * · `refund_retracted` / `refund_retraction_skipped`：回收了多少天，
   *   或者"钱退了却没有可回收的订阅行"这一件如实但不该静默的事。
   */
  'refund_requested',
  'refund_denied',
  'refund_decided',
  'refund_channel_failed',
  'refund_retracted',
  'refund_retraction_skipped',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

interface AuditInput {
  readonly action: AuditAction;
  readonly target: string;
  readonly beforeJson: string | null;
  readonly afterJson: string | null;
  readonly actor: string;
  readonly note: string;
  readonly now: number;
}

/**
 * 追加一行审计。**只追加**（没有任何 UPDATE / DELETE），与迁移的注释一致。
 *
 * 收 `SqlRunner` 而不是 `SqlExecutor`：它只写一行，**不该**有能力开事务 ——
 * 而且它几乎总是在别的事务**里面**被调用（`publishPriceVersion` / `upsertCoupon` /
 * `settleOrderPaid` 都要"改数据 + 写审计"原子完成）。声明成 `SqlExecutor` 会让
 * 事务内的 `appendAudit(tx, …)` 类型不合法，逼出要么绕行、要么把审计挪到事务外的
 * 二选一 —— 后者会留下"改了价但审计没写"的窗口。
 */
export const appendAudit = async (sql: SqlRunner, input: AuditInput): Promise<void> => {
  await sql.execute(
    `INSERT INTO pricing_audit_log
       (action, target, before_json, after_json, actor, note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.action,
      input.target,
      input.beforeJson,
      input.afterJson,
      input.actor,
      input.note,
      input.now,
    ],
  );
};

/** 读出来的一行审计。金额之类的结构化内容留在 `beforeJson` / `afterJson` 里，不二次解析。 */
export interface PricingAuditEntry {
  readonly id: number;
  readonly action: string;
  readonly target: string;
  readonly beforeJson: string | null;
  readonly afterJson: string | null;
  readonly actor: string | null;
  readonly note: string | null;
  /** `null` = 这一行的时间戳读不出来（数据损坏），调用方负责如实显示，不要兜成 0。 */
  readonly createdAt: number | null;
}

/**
 * 读最近若干条审计，**新的在前**。
 *
 * 🔴 这个函数存在的理由：`pricing_audit_log` 在此之前**只写不读** ——
 * `appendAudit` 是全仓唯一的接触点。于是"谁在什么时候把 ¥12 改成 ¥15"
 * 这个问题在代码里**没有任何答案**，只能手写 SQL 去问库。
 * 审计写下来却读不出来，等于没有审计：它的全部价值就在于事后能被查到。
 *
 * 只读、无副作用。`limit` 由调用方给（CLI 固定取一个小值，避免刷屏）。
 * 排序用 `created_at DESC, id DESC`：同一毫秒内落的几行也要有**稳定**顺序，
 * 否则"最后一条是谁改的"会随查询计划变。
 */
export const loadPricingAudit = async (
  sql: SqlRunner,
  options: { readonly limit: number },
): Promise<readonly PricingAuditEntry[]> => {
  const rows = await sql.query<{
    readonly id: unknown;
    readonly action: unknown;
    readonly target: unknown;
    readonly before_json: unknown;
    readonly after_json: unknown;
    readonly actor: unknown;
    readonly note: unknown;
    readonly created_at: unknown;
  }>(
    `SELECT id, action, target, before_json, after_json, actor, note, created_at
       FROM pricing_audit_log
      ORDER BY created_at DESC, id DESC
      LIMIT $1`,
    [options.limit],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    action: String(row.action),
    target: String(row.target),
    beforeJson: row.before_json === null || row.before_json === undefined ? null : String(row.before_json),
    afterJson: row.after_json === null || row.after_json === undefined ? null : String(row.after_json),
    actor: row.actor === null || row.actor === undefined ? null : String(row.actor),
    note: row.note === null || row.note === undefined ? null : String(row.note),
    createdAt: toMillis(row.created_at) ?? null,
  }));
};

// ---------------------------------------------------------------------------
// 券
// ---------------------------------------------------------------------------

interface CouponRow {
  readonly id: unknown;
  readonly code: unknown;
  readonly name: unknown;
  readonly kind: unknown;
  readonly percent_off_bp: unknown;
  readonly amount_off_minor: unknown;
  readonly currency: unknown;
  readonly applies_to_all_prices: unknown;
  readonly price_ids: unknown;
  readonly applies_to_all_regions: unknown;
  readonly regions: unknown;
  readonly valid_from: unknown;
  readonly valid_until: unknown;
  readonly max_redemptions: unknown;
  readonly max_redemptions_per_user: unknown;
  readonly minimum_order_minor: unknown;
  readonly first_purchase_only: unknown;
  readonly enabled: unknown;
}

const asStringArray = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.map((v) => String(v)) : [];

/** 一行 → 领域对象。**不做校验**（校验由 `loadCoupons` 统一做，以便一次性报全部问题）。 */
export const toCouponDefinition = (row: CouponRow): CouponDefinition => {
  const allPrices = row.applies_to_all_prices === true;
  const allRegions = row.applies_to_all_regions === true;
  const benefit =
    row.kind === 'percent'
      ? ({ kind: 'percent', percentOffBp: Number(row.percent_off_bp) } as const)
      : ({ kind: 'fixed', amountOffMinor: Number(row.amount_off_minor) } as const);
  // 🔴 **不过滤**不认识的值：把原样带下去，让 `validateCouponDefinition` 报出来。
  // 过滤（`.filter(isRegion)`）会把"写错的区域"变成"静默地按剩下的生效"，
  // 而那张券看起来是好的。这里宁愿让类型暂时说谎（下面立刻校验）。
  const regionsRaw = asStringArray(row.regions) as readonly Region[];
  return {
    id: String(row.id),
    code: row.code === null || row.code === undefined ? null : String(row.code),
    name: String(row.name),
    benefit,
    currency: row.currency as Currency,
    priceIds: allPrices ? null : asStringArray(row.price_ids),
    validFrom: requiredMillis(row.valid_from, `coupons(${String(row.id)}).valid_from`),
    validUntil:
      row.valid_until === null || row.valid_until === undefined
        ? null
        : requiredMillis(row.valid_until, `coupons(${String(row.id)}).valid_until`),
    maxRedemptions:
      row.max_redemptions === null || row.max_redemptions === undefined
        ? null
        : Number(row.max_redemptions),
    maxRedemptionsPerUser:
      row.max_redemptions_per_user === null || row.max_redemptions_per_user === undefined
        ? null
        : Number(row.max_redemptions_per_user),
    minimumOrderMinor:
      row.minimum_order_minor === null || row.minimum_order_minor === undefined
        ? null
        : Number(row.minimum_order_minor),
    firstPurchaseOnly: row.first_purchase_only === true,
    regions: allRegions ? null : regionsRaw,
    enabled: row.enabled === true,
  };
};

/** 一张券的定义坏了。 */
export interface InvalidCouponRow {
  readonly id: string;
  readonly problems: readonly string[];
}

/**
 * 读券定义，并**把坏掉的券单独分出来**，而不是整批抛。
 *
 * 与价目表的处理**刻意不同**（那里是整批抛）。区别在于后果：
 * - 价目表坏 → "这一刻收多少钱"没有定义，**没有任何合理的继续方式**；
 * - 一张券坏 → 那一张券不能用了，其余券与不打折的路径**完全正常**。
 *   为了一个错别字让所有人买不成，是把影响面放大。
 *
 * ⚠️ 但"分出来"**不等于"默认忽略"**：`invalid` 会原样返回，调用方必须记录
 * 并告警（`server/scripts/pricing.ts show` 会把它打出来并置退出码 1，人也能查）。
 * 静默丢弃才是这里真正要避免的事。
 *
 * 📌 上面原先点名的是 `server/scripts/show-price.ts` —— **那个文件从来不存在**。
 * 实际打印它的就是那个 CLI。
 */
export const loadCoupons = async (
  sql: SqlExecutor,
): Promise<{ readonly coupons: readonly CouponDefinition[]; readonly invalid: readonly InvalidCouponRow[] }> => {
  const rows = await sql.query<CouponRow>(
    `SELECT id, code, name, kind, percent_off_bp, amount_off_minor, currency,
            applies_to_all_prices, price_ids, applies_to_all_regions, regions,
            valid_from, valid_until, max_redemptions, max_redemptions_per_user,
            minimum_order_minor, first_purchase_only, enabled
       FROM coupons
      ORDER BY id`,
  );
  const coupons: CouponDefinition[] = [];
  const invalid: InvalidCouponRow[] = [];
  for (const row of rows) {
    let definition: CouponDefinition;
    try {
      definition = toCouponDefinition(row);
    } catch (error) {
      invalid.push({
        id: String(row.id),
        problems: [error instanceof Error ? error.message : String(error)],
      });
      continue;
    }
    const problems = validateCouponDefinition(definition);
    if (problems.length > 0) {
      invalid.push({ id: definition.id, problems });
      continue;
    }
    coupons.push(definition);
  }
  return { coupons, invalid };
};

/**
 * 读用量事实。键是**券 id**。
 *
 * ⚠️ 这是"**这一刻**"的事实，而它必须与随后的预留**在同一个事务里**再校验一遍 ——
 * 本函数只服务于"报价时该给用户看什么价"，不能当成预留的准入判定。
 * 准入在 `createOrderWithReservation` 的事务里重新查（那里带着 `FOR UPDATE` 锁）。
 */
export const loadCouponUsage = async (
  sql: SqlExecutor,
  couponIds: readonly string[],
  userId: number,
): Promise<Record<string, CouponUsage>> => {
  const out: Record<string, CouponUsage> = {};
  if (couponIds.length === 0) return out;

  const paid = await sql.query<{ n: unknown }>(
    `SELECT count(*)::int AS n FROM checkout_orders WHERE user_id = $1 AND status = 'paid'`,
    [userId],
  );
  const userHasPaidOrder = Number(paid[0]?.n ?? 0) > 0;

  for (const couponId of couponIds) {
    const total = await sql.query<{ n: unknown }>(
      `SELECT count(*)::int AS n FROM coupon_redemptions
        WHERE coupon_id = $1 AND state IN (${stateList(COUNTED_REDEMPTION_STATES)})`,
      [couponId],
    );
    const mine = await sql.query<{ n: unknown }>(
      `SELECT count(*)::int AS n FROM coupon_redemptions
        WHERE coupon_id = $1 AND user_id = $2 AND state IN (${stateList(COUNTED_REDEMPTION_STATES)})`,
      [couponId, userId],
    );
    out[couponId] = {
      totalRedemptions: Number(total[0]?.n ?? 0),
      userRedemptions: Number(mine[0]?.n ?? 0),
      userHasPaidOrder,
    };
  }
  return out;
};

/** 券的定义字段（用于 upsert）。 */
export interface CouponWrite {
  readonly definition: CouponDefinition;
  readonly actor: string;
  readonly note: string;
  /** 写入时刻（epoch 毫秒）。**由调用方传入**，不在本函数里取时钟。 */
  readonly now: number;
}

/**
 * 新建或更新一张券，并写审计。
 *
 * 🔴 定义不合法就**抛**（`InvalidCouponDefinitionError` 的兄弟：这里直接
 * 用 `validateCouponDefinition`，因为它返回全部问题，比逐条抛更适合人看）。
 * 让一张坏券进库，等于把问题推迟到"某个用户输入那个码"的那一刻。
 */
export const upsertCoupon = async (
  sql: SqlExecutor,
  write: CouponWrite,
): Promise<{ readonly created: boolean }> =>
  sql.transaction(async (tx) => {
    const problems = validateCouponDefinition(write.definition);
    if (problems.length > 0) {
      throw new CouponDefinitionRejectedError(problems);
    }
    const c = write.definition;
    const before = await tx.query<CouponRow>(
      `SELECT * FROM coupons WHERE id = $1 FOR UPDATE`,
      [c.id],
    );
    await tx.execute(
      `INSERT INTO coupons
         (id, code, name, kind, percent_off_bp, amount_off_minor, currency,
          applies_to_all_prices, price_ids, applies_to_all_regions, regions,
          valid_from, valid_until, max_redemptions, max_redemptions_per_user,
          minimum_order_minor, first_purchase_only, enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $19)
       ON CONFLICT (id) DO UPDATE SET
         code = EXCLUDED.code,
         name = EXCLUDED.name,
         kind = EXCLUDED.kind,
         percent_off_bp = EXCLUDED.percent_off_bp,
         amount_off_minor = EXCLUDED.amount_off_minor,
         currency = EXCLUDED.currency,
         applies_to_all_prices = EXCLUDED.applies_to_all_prices,
         price_ids = EXCLUDED.price_ids,
         applies_to_all_regions = EXCLUDED.applies_to_all_regions,
         regions = EXCLUDED.regions,
         valid_from = EXCLUDED.valid_from,
         valid_until = EXCLUDED.valid_until,
         max_redemptions = EXCLUDED.max_redemptions,
         max_redemptions_per_user = EXCLUDED.max_redemptions_per_user,
         minimum_order_minor = EXCLUDED.minimum_order_minor,
         first_purchase_only = EXCLUDED.first_purchase_only,
         enabled = EXCLUDED.enabled,
         updated_at = EXCLUDED.updated_at`,
      [
        c.id,
        c.code,
        c.name,
        c.benefit.kind,
        c.benefit.kind === 'percent' ? c.benefit.percentOffBp : null,
        c.benefit.kind === 'fixed' ? c.benefit.amountOffMinor : null,
        c.currency,
        c.priceIds === null,
        c.priceIds ?? [],
        c.regions === null,
        c.regions ?? [],
        c.validFrom,
        c.validUntil,
        c.maxRedemptions,
        c.maxRedemptionsPerUser,
        c.minimumOrderMinor,
        c.firstPurchaseOnly,
        c.enabled,
        write.now,
      ],
    );
    await appendAudit(tx, {
      action: 'coupon_upserted',
      target: c.id,
      beforeJson: before.length === 0 ? null : JSON.stringify({ name: String(before[0]!.name) }),
      afterJson: JSON.stringify({ name: c.name, enabled: c.enabled }),
      actor: write.actor,
      note: write.note,
      now: write.now,
    });
    return { created: before.length === 0 };
  });

/** 券定义被拒绝写入。 */
export class CouponDefinitionRejectedError extends Error {
  readonly code = 'COUPON_REJECTED';

  constructor(readonly problems: readonly string[]) {
    super(`券定义不合法，拒绝写入（${problems.length} 处）：\n   - ${problems.join('\n   - ')}`);
    this.name = 'CouponDefinitionRejectedError';
  }
}

// ---------------------------------------------------------------------------
// 订单 + 核销
// ---------------------------------------------------------------------------

/** 名额已被占满（`createOrderWithReservation` 的事务内判定）。 */
export class CouponQuotaExceededError extends Error {
  readonly code = 'COUPON_QUOTA_EXCEEDED';

  constructor(
    readonly couponId: string,
    readonly reason: 'total' | 'per_user',
  ) {
    super(
      `券 ${couponId} 的名额已满（${reason === 'total' ? '总量' : '该用户'}）—— ` +
        '这是**预留时**的权威判定，报价时看到的是同一事实的早期快照。',
    );
    this.name = 'CouponQuotaExceededError';
  }
}

export interface CreateOrderInput {
  readonly userId: number;
  readonly provider: string;
  /** 商户订单号，由调用方（adapter）生成。 */
  readonly outTradeNo: string;
  /** **已经算好的**报价。金额只从这里读，不在本函数里重算。 */
  readonly quote: OrderQuote;
  readonly now: number;
}

/**
 * 建订单 + 预留券名额。**一个事务**。
 *
 * ## 为什么预留必须在事务里重新查限额
 *
 * 报价（`quoteOrder`）是几十毫秒前算的，它读到的用量是一个**快照**。
 * 两个用户同时用最后一张券时，两份报价都会说"能用" —— 那是报价的固有限制，
 * 不是 bug。所以**准入判定必须在写入的这一刻、在锁的保护下重做一遍**，
 * 而报价只能决定"给他看什么价"。
 *
 * 这也是"报价 → 冻结 → 对账"三步里"冻结"的那一步：
 * 从此这一单的金额不再依赖价目表或券的任何后续变化。
 *
 * ## 🔴 折扣额不重算
 *
 * 只重新判定**名额**，不重新算钱。重算会让"报价时给他 7920、落库时变成 7920+α"
 * 这种最糟的情况发生（用户看到的价格 ≠ 订单金额）。券是否已停用、是否已过期，
 * 在这一步都**不**再判：报价时它是有效的，而报价与下单在同一个请求里，
 * 相隔毫秒级；把有效期判定搬到这里只会制造"同一秒内两个答案"。
 */
export const createOrderWithReservation = async (
  sql: SqlExecutor,
  input: CreateOrderInput,
): Promise<{ readonly orderId: number; readonly redemptionId: number | null }> => {
  const q = input.quote;
  return sql.transaction(async (tx) => {
    if (q.appliedCouponId !== null) {
      // 🔴 先锁券行：这是"两个并发请求都看到 9/10"的唯一解药。
      // 锁的粒度是**一张券**，不是全表 —— 改价/发券是人工低频操作，
      // 而这里串行化的是同一张券的并发核销，代价可以忽略。
      const locked = await tx.query<{
        max_redemptions: unknown;
        max_redemptions_per_user: unknown;
      }>(
        `SELECT max_redemptions, max_redemptions_per_user
           FROM coupons WHERE id = $1 FOR UPDATE`,
        [q.appliedCouponId],
      );
      const coupon = locked[0];
      if (coupon === undefined) {
        throw new CouponQuotaExceededError(q.appliedCouponId, 'total');
      }
      const maxTotal =
        coupon.max_redemptions === null || coupon.max_redemptions === undefined
          ? null
          : Number(coupon.max_redemptions);
      const maxPerUser =
        coupon.max_redemptions_per_user === null || coupon.max_redemptions_per_user === undefined
          ? null
          : Number(coupon.max_redemptions_per_user);

      if (maxTotal !== null) {
        const total = await tx.query<{ n: unknown }>(
          `SELECT count(*)::int AS n FROM coupon_redemptions
            WHERE coupon_id = $1 AND state IN (${stateList(COUNTED_REDEMPTION_STATES)})`,
          [q.appliedCouponId],
        );
        if (Number(total[0]?.n ?? 0) >= maxTotal) {
          throw new CouponQuotaExceededError(q.appliedCouponId, 'total');
        }
      }
      if (maxPerUser !== null) {
        const mine = await tx.query<{ n: unknown }>(
          `SELECT count(*)::int AS n FROM coupon_redemptions
            WHERE coupon_id = $1 AND user_id = $2 AND state IN (${stateList(COUNTED_REDEMPTION_STATES)})`,
          [q.appliedCouponId, input.userId],
        );
        if (Number(mine[0]?.n ?? 0) >= maxPerUser) {
          throw new CouponQuotaExceededError(q.appliedCouponId, 'per_user');
        }
      }
    }

    const inserted = await tx.query<{ id: unknown }>(
      `INSERT INTO checkout_orders
         (out_trade_no, user_id, provider, price_id, currency, region,
          original_amount_minor, discount_minor, final_amount_minor,
          coupon_id, status, quoted_at, expires_at, rejected_coupons_json,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11, $12, $13, $11, $11)
       RETURNING id`,
      [
        input.outTradeNo,
        input.userId,
        input.provider,
        q.priceId,
        q.currency,
        q.region,
        q.originalAmountMinor,
        q.discountMinor,
        q.finalAmountMinor,
        q.appliedCouponId,
        q.quotedAt,
        q.expiresAt,
        JSON.stringify(q.rejectedCoupons),
      ],
    );
    const orderId = Number(inserted[0]?.id);

    let redemptionId: number | null = null;
    if (q.appliedCouponId !== null) {
      const redemption = await tx.query<{ id: unknown }>(
        `INSERT INTO coupon_redemptions
           (coupon_id, user_id, order_id, state, original_amount_minor, discount_minor,
            final_amount_minor, currency, reserved_until, created_at)
         VALUES ($1, $2, $3, 'reserved', $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          q.appliedCouponId,
          input.userId,
          orderId,
          q.originalAmountMinor,
          q.discountMinor,
          q.finalAmountMinor,
          q.currency,
          q.expiresAt,
          input.now,
        ],
      );
      redemptionId = Number(redemption[0]?.id);
    }

    return { orderId, redemptionId };
  });
};

/** 结算结果。调用方按 `outcome` 决定要不要告警。 */
export type SettleOrderOutcome =
  | {
      readonly outcome: 'granted';
      readonly orderId: number;
      readonly userId: number;
      /**
       * 🔴 **这一单买的是哪一档**（`checkout_orders.price_id`）。
       *
       * 必须带出来：有了它，调用方才能按**订单冻结的** SKU 决定授予什么能力
       * （`grantsForSku(priceId)`），而不是相信 adapter "实付金额落在价目表上"
       * 那个启发式 —— 后者遇到打折单会给出**错的档位或给不出档位**。
       * 列一直在库里，此前只是没被 `SELECT` 取出来。
       * 见 `docs/reference/pricing-and-coupons.md` §7 第 9 条 (a)。
       *
       * `null` = 订单没记档位（不该发生：收银台报价必有 priceId）。
       * 真出现时是数据异常，调用方应 fail-closed（不授予）。
       */
      readonly priceId: string | null;
      /** 支付到账时订单**已经过期**（名额可能已被别人拿走）。应当告警。 */
      readonly afterExpiry: boolean;
      /** 结算后这张券的计数**超过了**上限 —— 见 `COUNTED_REDEMPTION_STATES`。 */
      readonly quotaExceeded: boolean;
    }
  /** 同一笔支付重复到达。幂等，无副作用。 */
  | { readonly outcome: 'already-paid'; readonly orderId: number; readonly userId: number }
  /** 金额与冻在订单上的报价不一致 —— **不授予**，落审计。 */
  | { readonly outcome: 'amount-mismatch'; readonly orderId: number; readonly userId: number; readonly expectedMinor: number; readonly actualMinor: number }
  /** 订单已退款 / 已失败，不再授予。 */
  | { readonly outcome: 'order-not-grantable'; readonly orderId: number; readonly userId: number; readonly status: OrderStatus }
  /** 订单号不是我们生成的（伪造 / 来自别的系统）。 */
  | { readonly outcome: 'unknown-order'; readonly outTradeNo: string };

export interface SettleOrderPaidInput {
  readonly outTradeNo: string;
  readonly providerEventId: string;
  /** 支付商回执里的实付金额。**必须与订单上冻结的实付一致。** */
  readonly paidAmountMinor: number;
  readonly now: number;
}

interface OrderRow {
  readonly id: unknown;
  readonly user_id: unknown;
  readonly status: unknown;
  readonly price_id: unknown;
  readonly original_amount_minor: unknown;
  readonly discount_minor: unknown;
  readonly final_amount_minor: unknown;
  readonly coupon_id: unknown;
}

const isOrderStatus = (value: unknown): value is OrderStatus =>
  typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);

/**
 * **在调用方已经开启的事务里结算一笔已支付的订单。**
 *
 * 🔴 存在的理由：webhook 的落点是一个 Prisma 交互式事务
 * （`prisma.$transaction(async (tx) => …)`）。"授予权益"与"结算订单（并把券的
 * `reserved` 名额转成 `applied`）"必须**同生共死** —— 分开写会留下
 * "权益发了、订单没结算"或反之的半截状态，而券的额度会被一张已付款的订单
 * 永久占住。可 `settleOrderPaid` 收的是 `SqlExecutor`，会在**里面再开一层**
 * 事务；Prisma 的事务 client 没有 `$transaction`（`ITXClientDenyList`），
 * 所以正确形状不是"把 `$transaction` 硬套进去"，而是把结算主体抽成收
 * `SqlRunner` 的这一个函数，由两种调用方各自决定事务边界：
 *
 * - 独立调用（CLI / 工具）：`settleOrderPaid(sql, input)` 自己开事务；
 * - 事务内调用（webhook）：`settleOrderPaidInTransaction(tx, input)`。
 *
 * 结算逻辑**只有这一份** —— 两种入口的差别仅仅是事务边界。
 * `SqlRunner` / `SqlExecutor` 那两个接口（本文件上方）讲的"事务回调拿到的是
 * 受限的只读面"就是这条路径能成立的原因。
 */
export const settleOrderPaidInTransaction = async (
  tx: SqlRunner,
  input: SettleOrderPaidInput,
): Promise<SettleOrderOutcome> => {
  const rows = await tx.query<OrderRow>(
    `SELECT id, user_id, status, price_id, original_amount_minor, discount_minor, final_amount_minor, coupon_id
       FROM checkout_orders WHERE out_trade_no = $1 FOR UPDATE`,
    [input.outTradeNo],
  );
  const order = rows[0];
  if (order === undefined) {
    return { outcome: 'unknown-order', outTradeNo: input.outTradeNo };
  }
  const orderId = Number(order.id);
  const userId = Number(order.user_id);
  const status = isOrderStatus(order.status) ? order.status : undefined;
  if (status === undefined) {
    throw new Error(`订单 ${orderId} 的状态 ${JSON.stringify(order.status)} 不在词表里 —— 数据已损坏`);
  }

  if (status === 'paid') {
    return { outcome: 'already-paid', orderId, userId };
  }
  if (status === 'refunded' || status === 'failed') {
    return { outcome: 'order-not-grantable', orderId, userId, status };
  }

  const expectedMinor = Number(order.final_amount_minor);
  if (!isMinorAmount(input.paidAmountMinor) || input.paidAmountMinor !== expectedMinor) {
    // 🔴 落审计，不只是返回一个 outcome。理由见 `AUDIT_ACTIONS` 的说明：
    // "有人付了不对的钱"必须能在库里被查到，而不是只在当时的返回值里。
    await appendAudit(tx, {
      action: 'order_amount_mismatch',
      target: `order:${orderId}`,
      beforeJson: JSON.stringify({ finalAmountMinor: expectedMinor }),
      afterJson: JSON.stringify({ paidAmountMinor: input.paidAmountMinor }),
      actor: 'system',
      note: `支付到账金额与订单冻结金额不一致 —— 不授予权益（providerEventId=${input.providerEventId}）`,
      now: input.now,
    });
    return {
      outcome: 'amount-mismatch',
      orderId,
      userId,
      expectedMinor,
      actualMinor: input.paidAmountMinor,
    };
  }

  const afterExpiry = status === 'expired';
  await tx.execute(
    `UPDATE checkout_orders
        SET status = 'paid', paid_at = $1, settled_at = $1, updated_at = $1, provider_event_id = $2
      WHERE id = $3`,
    [input.now, input.providerEventId, orderId],
  );

  let quotaExceeded = false;
  const couponId = order.coupon_id === null || order.coupon_id === undefined ? null : String(order.coupon_id);
  if (couponId !== null) {
    // `reserved` → `applied`，以及"到账晚于过期"时的 `expired` → `applied`。
    await tx.execute(
      `UPDATE coupon_redemptions
          SET state = 'applied', applied_at = $1, settled_at = $1
        WHERE order_id = $2 AND state IN ('reserved', 'expired')`,
      [input.now, orderId],
    );

    const coupon = await tx.query<{ max_redemptions: unknown }>(
      `SELECT max_redemptions FROM coupons WHERE id = $1`,
      [couponId],
    );
    const maxTotal =
      coupon[0]?.max_redemptions === null || coupon[0]?.max_redemptions === undefined
        ? null
        : Number(coupon[0]?.max_redemptions);
    if (maxTotal !== null) {
      const counted = await tx.query<{ n: unknown }>(
        `SELECT count(*)::int AS n FROM coupon_redemptions
          WHERE coupon_id = $1 AND state IN (${stateList(COUNTED_REDEMPTION_STATES)})`,
        [couponId],
      );
      quotaExceeded = Number(counted[0]?.n ?? 0) > maxTotal;
    }
  }

  // 🔴 `priceId` 是这一单**冻结的**档位 —— 调用方按它决定授予什么能力
  // （`grantsForSku`），而不是相信 adapter 的金额启发式。见类型注释。
  const priceId =
    order.price_id === null || order.price_id === undefined
      ? null
      : String(order.price_id);
  return { outcome: 'granted', orderId, userId, priceId, afterExpiry, quotaExceeded };
};

/**
 * **结算一笔已支付的订单。** 幂等，且是唯一允许把订单推进到 `paid` 的路径。
 *
 * ## 幂等靠"条件更新 + 状态读回"，不靠调用方记得判
 *
 * 支付商的投递是 **at-least-once**（Stripe 明确说会重复投递、且不保证顺序）。
 * 所以这里不是"执行一次核销命令"，而是"把订单推进到终态"的**状态机**：
 * 读回当前状态，已经是 `paid` 就返回 `already-paid` 且不做任何写入。
 * 上游的 `payment_events` 唯一约束是第一道闸，这里是第二道 ——
 * 两道闸保护的是不同的东西：前者防同一事件重复，后者防**同一订单**被两次结算
 * （两个不同事件指向同一订单是完全可能的）。
 *
 * ## 🔴 金额校验跟**订单**比，不跟价目表比
 *
 * 这是修掉 `docs/reference/pricing-and-entitlements.md` §4 那个洞的地方：
 * 原来是"付的金额是价目表里的某一个"，一旦有第二个 SKU 或一张券就失效。
 * 这里比的是**冻在这一单上的实付金额**，所以它同时覆盖 SKU 与折扣。
 *
 * ## 🔴 到账晚于过期，**照样授予**
 *
 * 用户真的付了钱。"名额没了所以不给"会同时得罪用户和我们自己（要退款）。
 * 所以 `expired` 也允许推进到 `paid`，并把 `afterExpiry` 与 `quotaExceeded`
 * 一起返回让调用方告警。见 `COUNTED_REDEMPTION_STATES` 的说明。
 *
 * ## 事务边界
 *
 * 本函数只负责**开事务**；主体在 `settleOrderPaidInTransaction`。webhook 必须
 * 把自己的"授予权益 + 结算订单"放进同一个事务，所以它调的是那个内层函数。
 */
export const settleOrderPaid = async (
  sql: SqlExecutor,
  input: SettleOrderPaidInput,
): Promise<SettleOrderOutcome> =>
  sql.transaction((tx) => settleOrderPaidInTransaction(tx, input));

/**
 * 把订单标成失败（下单后支付通道立刻失败，或人工取消）。
 *
 * 🔴 **必须一并释放名额。** 只把订单置 `failed`、留着核销行 `reserved`，就等于
 * "这条路已经死了，但它占的位置还锁着" —— 要等支付窗口结束、被
 * `expireStaleOrders` 扫到才放出来。有界（窗口内），但限量券的预算会在窗口里
 * 被白白烧掉，而且"人工取消"恰恰是最不该占着名额的那种。
 *
 * 释放用 `expired` 而不是 `reversed`：`reversed` 是**计数**的（预算是"已投放"），
 * 而这里的钱**从没动过**。见 `COUNTED_REDEMPTION_STATES`。
 *
 * 与 `expireStaleOrders` 同形：两条 UPDATE 都幂等（条件里带状态），
 * 顺序是**先放名额再改订单**（名额才是稀缺资源）。
 */
export const failOrder = async (
  sql: SqlExecutor,
  input: { readonly orderId: number; readonly now: number },
): Promise<{ readonly orders: number; readonly redemptions: number }> =>
  sql.transaction(async (tx) => {
    const redemptions = await tx.execute(
      `UPDATE coupon_redemptions
          SET state = 'expired', settled_at = $1
        WHERE order_id = $2 AND state = 'reserved'`,
      [input.now, input.orderId],
    );
    const orders = await tx.execute(
      `UPDATE checkout_orders SET status = 'failed', settled_at = $1, updated_at = $1
        WHERE id = $2 AND status = 'pending'`,
      [input.now, input.orderId],
    );
    return { orders, redemptions };
  });

/**
 * 🔴 **扫掉过期的预留**：未支付且已过期的订单 → `expired`，其预留 → `expired`。
 *
 * 没有这一步，`maxRedemptions` 就是一句空话：任何人只要点开收银台拿到收款码
 * 就能把名额占住（`reserved` 是计数的），而 sweep 负责把"没付款的"放出来。
 * 这是一个**必须真的在跑**的后台任务，不是可选的优化 ——
 * `docs/reference/pricing-and-coupons.md` §5 把它列为运维要求。
 *
 * 两条 UPDATE 都是幂等的（条件里带状态），重复跑没有副作用。
 * 顺序无所谓，但**先放名额再改订单**更容易解释：名额是稀缺资源。
 *
 * 返回被扫掉的行数，供监控取用（"长时间为 0"可能是 sweep 挂了，
 * 也可能是真的没人下单 —— 所以要看的是"任务有没有跑"而不是这个数）。
 */
export const expireStaleOrders = async (
  sql: SqlExecutor,
  input: { readonly now: number },
): Promise<{ readonly redemptions: number; readonly orders: number }> =>
  sql.transaction(async (tx) => {
    const redemptions = await tx.execute(
      `UPDATE coupon_redemptions
          SET state = 'expired', settled_at = $1
        WHERE state = 'reserved' AND reserved_until < $1`,
      [input.now],
    );
    const orders = await tx.execute(
      `UPDATE checkout_orders
          SET status = 'expired', settled_at = $1, updated_at = $1
        WHERE status = 'pending' AND expires_at < $1`,
      [input.now],
    );
    return { redemptions, orders };
  });

/**
 * 退款：订单 → `refunded`，核销 → `reversed`。
 *
 * 🔴 **不归还名额**（`reversed` 是计数的）。理由见 `COUNTED_REDEMPTION_STATES`：
 * 归还意味着同一份预算能被"买 → 退 → 再买"反复薅，而那正是退款滥用最常见的形状。
 *
 * 🔴 **只允许从 `paid` 出发。** 先前的条件是 `IN ('paid', 'pending')`，那是一条
 * **钱从没动过**的路径（下单后立刻取消 / 支付通道建单失败），却把核销推成
 * `reversed` —— 而 `reversed` 是**计数**的，等于**永久吃掉一个名额**。
 * 上面"退款不归还名额"的理由（预算已投放）恰恰不适用于没付过款的单：
 * 那笔预算根本还没投放。同一条 15 分钟窗口里被人反复触发，就能把限量券的
 * 名额一点点耗光，而账面上看不到任何一笔钱。
 *
 * 核销侧同步收紧成 `applied`（去掉 `reserved`）：`settleOrderPaid` 在**同一个
 * 事务**里把订单置 `paid`、把核销置 `applied`，所以 `paid` ⇒ `applied`。
 * 那个 `reserved` 分支因此不可达，留着只会**掩盖**一个坏了的不变量 ——
 * 万一真出现 `paid` + `reserved`，我们要的是它炸出来，不是悄悄记一笔核销。
 *
 * ⚠️ 2026-10-05 更正（ADR-0053）：这里原写"本轮不做资金侧退款，这一步只改我们自己的账"。
 * 那句话当时成立，现在不成立 —— 资金侧已经接进 `refund-store.ts#submitRefundToChannel`，
 * 而本函数的**第一个生产调用方**是 `applyRefundResult`（只在通道确认 `success` 之后）。
 * 它仍然是"退款被**确认之后**的状态同步"，但那个确认不再是一句空话：
 * 没退成钱的一条都到不了这里（`refunded_at IS NULL` 那道条件更新）。
 */
export const reverseOrderOnRefundInTransaction = async (
  tx: SqlRunner,
  input: { readonly orderId: number; readonly now: number },
): Promise<{ readonly orders: number; readonly redemptions: number }> => {
  const orders = await tx.execute(
    `UPDATE checkout_orders
        SET status = 'refunded', settled_at = $1, updated_at = $1
      WHERE id = $2 AND status = 'paid'`,
    [input.now, input.orderId],
  );
  const redemptions = await tx.execute(
    `UPDATE coupon_redemptions
        SET state = 'reversed', settled_at = $1
      WHERE order_id = $2 AND state = 'applied'`,
    [input.now, input.orderId],
  );
  return { orders, redemptions };
};

/**
 * 事务**外**的入口：自己开一层事务跑上面那个主体。
 *
 * 与 `settleOrderPaid` / `settleOrderPaidInTransaction` 同一对形状，理由也一样：
 * 退款回收必须"订单 + 券 + 权益"同生共死，而调用方（`refund-store.ts`）**已经**
 * 开着一层事务并持有那一行的 `FOR UPDATE`。Prisma 的事务 client 上没有
 * `$transaction`（`ITXClientDenyList`），所以正确形状不是硬套一层，
 * 而是把主体抽成收 `SqlRunner` 的那一个。
 */
export const reverseOrderOnRefund = async (
  sql: SqlExecutor,
  input: { readonly orderId: number; readonly now: number },
): Promise<{ readonly orders: number; readonly redemptions: number }> =>
  sql.transaction((tx) => reverseOrderOnRefundInTransaction(tx, input));

/** 把被拒的候选券序列化出来（订单上冗余存一份，用于回答"我的码为什么不能用"）。 */
export const serializeRejections = (rejected: readonly RejectedCoupon[]): string =>
  JSON.stringify(
    rejected.map((r) => ({
      rawCode: r.rawCode,
      couponId: r.couponId,
      reason: r.reason,
      explanation: COUPON_REJECTION_EXPLANATION[r.reason],
    })),
  );

/**
 * Prisma 版 `SqlExecutor` 的**两个**端口。
 *
 * 🔴 这是本文件里**唯一**没被 pglite 测到的一段（CI 没有 PostgreSQL）。
 * 它只做三件事：把 `?` 换成 `$n` 的活不干（Prisma 原生就用 `$n`）、
 * 转发参数、把 `$transaction` 包起来。所有 SQL 文本本身在 pglite 上跑过。
 * 这个边界在 `docs/reference/pricing-and-coupons.md` §7 写明。
 *
 * **为什么是两个接口而不是一个**：`PrismaClient.$transaction` 的回调给的是
 * `Omit<PrismaClient, ITXClientDenyList>` —— 那个 client **故意没有** `$transaction`。
 * 声明成"一个接口、回调参数也是它自己"就跟上游**永远**不兼容，
 * 于是 `createPrismaSqlExecutor(prisma)` 在 strict 下抛 `TS2345`
 * （§7 第 12 条）。拆成"根 / 事务"两个接口之后，这一向才对得上。
 */

/**
 * Prisma 的**事务** client —— 也就是 `PrismaClient.$transaction` 回调参数的类型。
 *
 * 原始查询都有，`$transaction` **没有**：它就在 Prisma 的 `ITXClientDenyList` 里。
 * 这个"没有"是上游的设计，不是我们的选择，所以我们的两个端口必须承认它。
 */
export interface PrismaTransactionClient {
  $queryRawUnsafe<T = unknown>(sql: string, ...params: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...params: unknown[]): Promise<number>;
}

/** Prisma 的**根** client：在事务 client 之上多一个 `$transaction`。 */
export interface PrismaLikeClient extends PrismaTransactionClient {
  $transaction<T>(fn: (tx: PrismaTransactionClient) => Promise<T>): Promise<T>;
}

/**
 * 事务**内**的面：只有读写，没有 `transaction`（对应 `PrismaTransactionClient`）。
 *
 * 🔴 **导出**是为了让 webhook 能在**自己已经开启的** Prisma 事务里跑结算：
 * `settleOrderPaidInTransaction(createPrismaSqlRunner(tx), …)`。没有它，webhook
 * 只能要么再开一层事务（把"权益发了、订单没结算"那个半截窗口留下），
 * 要么把 `$transaction` 硬套上去（Prisma 的事务 client 上没有它）。
 */
export const createPrismaSqlRunner = (client: PrismaTransactionClient): SqlRunner => ({
  query: async <T>(sql: string, params: readonly unknown[] = []): Promise<T[]> => {
    const result = await client.$queryRawUnsafe<T[]>(sql, ...params);
    return Array.isArray(result) ? result : [];
  },
  execute: (sql: string, params: readonly unknown[] = []): Promise<number> =>
    client.$executeRawUnsafe(sql, ...params),
});

export const createPrismaSqlExecutor = (client: PrismaLikeClient): SqlExecutor => ({
  ...createPrismaSqlRunner(client),
  transaction: <T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> =>
    client.$transaction((tx) => fn(createPrismaSqlRunner(tx))),
});
