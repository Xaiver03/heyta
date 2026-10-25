/**
 * 后台**发放订阅**的写入层：三种动作 + 一笔审计。
 * ==============================================
 *
 * 裁决在 [`docs/adr/0076-admin-subscription-grants.md`]
 * （../../../docs/adr/0076-admin-subscription-grants.md）。这里只放**执行**它的那段代码。
 *
 * ## 🔴 三种动作写的是同一张表的**同一行**，而那一行必须是发放行
 *
 * 一个用户最多一条 `provider = 'admin-grant'` 的订阅行（与邀请奖励那条
 * `provider = 'invite'` 同形，见 `activity/invite.ts::grantInviteReward`）。
 * 本文件的三个函数**从不按 `id` 或 `userId` 找订阅行** —— 它们的每一次 `where`
 * 都带 `provider: ADMIN_GRANT_PROVIDER`。这不是巧合，是 ADR-0076 §2 二的落点：
 * 一条 `provider='wechat'` 的行是"有人付过钱"的证据，改它就是伪造购买事实，
 * 而且改前的值没地方存 ⇒ 不可还原。
 *
 * 之所以能只加一行就"升级"：权益判定是**跨行并集**
 * （`entitlement.ts::evaluateCapabilityAcross` 的头注释里"将来的运营赠送"就是这一处）。
 * 发放行设成更高档 ⇒ 发放期内能力上移；发放到期或被收回 ⇒ 回到他付过钱的那一档。
 *
 * ## 🔴 `grants` 从 SKU 派生，客户端永远发不出来
 *
 * 唯一来源是 `price-book.ts` 的 `grantsForSku`。三道闸门（ADR-0076 §2 三）：
 * 未知 SKU（`null`，**不是** `[]`）拒；`notSellableReason` 非 null 拒 —— 收银台
 * 挡住的东西后台也挡，否则后台就是收银台旁边那扇没锁的门；天数越界拒。
 *
 * ## 🔴 审计与权益写在**同一个事务**
 *
 * 不是"写完再补日志"：那样崩溃时会出现"权益已经发出去了但没人知道是谁发的"，
 * 而这张表存在的全部理由就是不让那一刻发生。判据在
 * `server/tests/admin-subscription-grant.spec.ts` 的「审计走的是事务里那个 client」。
 *
 * ## 为什么这一层**不**取当前时间
 *
 * `now` 一律由调用方传入（与 `holiday-adjustment-store.ts` 同一口径）：
 * "他到哪天到期"是审计事实，测试必须能钉住它，不能让写入时刻渗进判定里。
 */

import type { PrismaClient } from '@prisma/client';

import { extendSubscriptionPeriod } from '@heyta/domain';

import { prisma } from '../db';
import { grantsForSku, notSellableReason, SKU_GRANTS } from '../billing/price-book';

/**
 * 发放行的 provider 值。
 *
 * ⚠️ 它**不等于** `invite`：那条是自动结算的奖励，触发条件是"被邀请人验证了邮箱"，
 * 幂等靠推荐行的 CAS。把人工发放塞进同一行会让"邀请奖励发过没有"变成
 * "这一行存在过" —— 一次手工发放就把奖励的幂等性破坏掉（ADR-0076 §3.2）。
 */
export const ADMIN_GRANT_PROVIDER = 'admin-grant';

/** 三种动作。**封闭词表**，词表外直接抛（库里不设 CHECK，理由见迁移头部）。 */
export const SUBSCRIPTION_GRANT_ACTIONS = ['grant', 'upgrade', 'revoke'] as const;
export type SubscriptionGrantAction = (typeof SUBSCRIPTION_GRANT_ACTIONS)[number];

export function isSubscriptionGrantAction(value: unknown): value is SubscriptionGrantAction {
  return (
    typeof value === 'string' &&
    (SUBSCRIPTION_GRANT_ACTIONS as readonly string[]).includes(value)
  );
}

/**
 * 一次发放的天数上下界（ADR-0076 §2 三第 3 道闸门）。
 *
 * 3650 = 十年。它不是"运营最多想发十年"，是**把一次手滑关在一个可发现的范围内**：
 * 没有上限时，`days` 那格多打两个 0 就是一个两千年的到期日，而它不会在任何地方报错 ——
 * 权益判定只会一直放行。⚠️ 这个数**没有需求侧依据**，登记在 ADR-0076 §5 未核实项。
 *
 * 🔴 下界是 `1` 而不是 `0`：`0 天`不是一种"象征性地发一下"，而是一个
 * `[now, now)` 的空周期 —— 它会留下一行 active 的订阅、审计上写着"发了 0 天"，
 * 而权益一格没给。那种行是下一次排查的人必须解释的东西。
 */
export const GRANT_DAYS_MIN = 1;
export const GRANT_DAYS_MAX = 3650;

// ---------------------------------------------------------------------------
// 错误：每个都是一个**具名结果**，路由原样翻成状态码
// ---------------------------------------------------------------------------

/** SKU 不在 `SKU_GRANTS` 里（`grantsForSku` 给了 `null`，不是 `[]`）。 */
export class UnknownGrantSkuError extends Error {
  readonly code = 'UNKNOWN_SKU';
  constructor(readonly sku: string) {
    super(
      `SKU ${JSON.stringify(sku)} 不在能力表里 —— 拒发（"不知道这是什么"不等于"它不给能力"）`,
    );
    this.name = 'UnknownGrantSkuError';
  }
}

/** 这一档已定价但**交付不了**（`NOT_YET_DELIVERABLE_SKUS`）。 */
export class SkuNotDeliverableError extends Error {
  readonly code = 'SKU_NOT_DELIVERABLE';
  constructor(
    readonly sku: string,
    readonly reason: string,
  ) {
    super(`SKU ${JSON.stringify(sku)} 现在交付不了：${reason} —— 收银台收不了钱的档位，后台也不发`);
    this.name = 'SkuNotDeliverableError';
  }
}

/** `days` 越界 / 非整数。 */
export class InvalidGrantDaysError extends Error {
  readonly code = 'INVALID_DAYS';
  constructor(
    readonly days: unknown,
    readonly why: string,
  ) {
    super(`发放天数不合法（${String(days)}）：${why}`);
    this.name = 'InvalidGrantDaysError';
  }
}

/** 理由为空。ADR-0053 给退款批准立的规矩的直接沿用。 */
export class MissingGrantReasonError extends Error {
  readonly code = 'REASON_REQUIRED';
  constructor() {
    super('发放必须带一句人话的理由 —— 它会改变别人能用什么');
    this.name = 'MissingGrantReasonError';
  }
}

/** 目标账号不存在（或已注销）。 */
export class GrantUserNotFoundError extends Error {
  readonly code = 'USER_NOT_FOUND';
  constructor(readonly userId: number) {
    super(`用户 #${String(userId)} 不存在`);
    this.name = 'GrantUserNotFoundError';
  }
}

/**
 * 没有**当前有效**的发放行可供升档/收回。
 *
 * 🔴 这一条同时拦住两种静默的错误：
 *  - `revoke` 打在没有发放行的人身上 ⇒ 动到 0 行，界面得能说"他本来就没有发放"，
 *    而不是"已完成"（与公告下架、退款那几条同一立场）；
 *  - `upgrade` 打在**已被收回**的发放行上 ⇒ 那是一次**伪装的重新发放**，
 *    而发放该走 `grant`（它带天数、带一条语义完整的审计）。
 */
export class NoActiveGrantError extends Error {
  readonly code = 'NO_ACTIVE_GRANT';
  constructor(readonly userId: number) {
    super(`用户 #${String(userId)} 没有当前有效的发放行`);
    this.name = 'NoActiveGrantError';
  }
}

/** 词表外的存量审计行 ⇒ 抛，不静默降级（同 `announcement-store.ts` 那条）。 */
export class UnknownGrantActionError extends Error {
  readonly code = 'ACTION_VOCABULARY';
  constructor(readonly storedAction: string) {
    super(`subscription_grants.action 词表外的存量行：${JSON.stringify(storedAction)}`);
    this.name = 'UnknownGrantActionError';
  }
}

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/**
 * 本层用到的 Prisma 面。做成 `Pick<>` 而不是 `PrismaClient`：桩要写哪几样由编译器说。
 *
 * 🔴 分成"根 client"与"事务内 client"两型，不是繁琐：Prisma 的事务 client
 * **故意没有** `$transaction`（`ITXClientDenyList`）。把两样混成一个型，
 * 要么根 client 传不进事务回调，要么就得在类型上撒谎 —— 后者会让
 * "在事务里再开一个事务"这种真实错误失去编译期拦阻（`billing/pricing-store.ts`
 * 的文件头记的就是这个坑）。
 */
export type GrantTx = Pick<PrismaClient, 'subscription' | 'subscriptionGrant' | 'user'>;
export type GrantDb = GrantTx & Pick<PrismaClient, '$transaction'>;

/** 发放行的订阅投影（回到界面的是"现在他有什么"）。 */
export interface GrantSubscriptionView {
  readonly subscriptionId: number;
  readonly userId: number;
  readonly priceId: string | null;
  readonly grants: readonly string[];
  readonly status: string;
  readonly currentPeriodEnd: number;
}

/** 审计行投影。 */
export interface GrantAuditRow {
  readonly id: number;
  readonly userId: number;
  readonly actorUserId: number;
  readonly action: SubscriptionGrantAction;
  readonly sku: string | null;
  readonly days: number | null;
  readonly grants: readonly string[];
  /** `null` = 这次之前他没有发放行。 */
  readonly beforePeriodEnd: number | null;
  readonly afterPeriodEnd: number | null;
  readonly reason: string;
  readonly createdAt: number;
}

/** 一次动作的结果：改完的订阅行 + 那一笔审计。 */
export interface GrantOutcome {
  readonly subscription: GrantSubscriptionView;
  readonly audit: GrantAuditRow;
}

/** 后台档位下拉的一项。 */
export interface GrantSkuOption {
  readonly priceId: string;
  readonly grants: readonly string[];
  readonly sellable: boolean;
}

// ---------------------------------------------------------------------------
// 投影
// ---------------------------------------------------------------------------

const toGrantView = (row: {
  id: number;
  userId: number;
  priceId: string | null;
  grants: string[];
  status: string | null;
  currentPeriodEnd: bigint | null;
}): GrantSubscriptionView => ({
  subscriptionId: row.id,
  userId: row.userId,
  priceId: row.priceId,
  grants: row.grants,
  status: row.status ?? '',
  currentPeriodEnd: row.currentPeriodEnd === null ? 0 : Number(row.currentPeriodEnd),
});

const toAuditRow = (row: {
  id: number;
  userId: number;
  actorUserId: number;
  action: string;
  sku: string | null;
  days: number | null;
  grants: string[];
  beforePeriodEnd: bigint | null;
  afterPeriodEnd: bigint | null;
  reason: string;
  createdAt: bigint;
}): GrantAuditRow => {
  if (!isSubscriptionGrantAction(row.action)) {
    throw new UnknownGrantActionError(row.action);
  }
  return {
    id: row.id,
    userId: row.userId,
    actorUserId: row.actorUserId,
    action: row.action,
    sku: row.sku,
    days: row.days,
    grants: row.grants,
    beforePeriodEnd: row.beforePeriodEnd === null ? null : Number(row.beforePeriodEnd),
    afterPeriodEnd: row.afterPeriodEnd === null ? null : Number(row.afterPeriodEnd),
    reason: row.reason,
    createdAt: Number(row.createdAt),
  };
};

// ---------------------------------------------------------------------------
// 闸门
// ---------------------------------------------------------------------------

/**
 * SKU → 能力，带两道拒绝（ADR-0076 §2 三）。
 *
 * 🔴 `grantsForSku` 返回 `null` 与返回 `[]` 是两件事，这里只接前者当错误、
 * 后者当合法：`[]` 是"这一档确定不授予任何能力"（一个可以存在的声明），
 * `null` 是"价目表与能力表不同步"。把 `null` 折成 `[]` 的症状是
 * **发出去一条谁也用不了的订阅，而且每一步都报告成功**。
 */
export const resolveGrantGrants = (sku: string): readonly string[] => {
  const grants = grantsForSku(sku);
  if (grants === null) throw new UnknownGrantSkuError(sku);
  const blocked = notSellableReason(sku);
  if (blocked !== null) throw new SkuNotDeliverableError(sku, blocked);
  return grants;
};

/** 天数闸门。路由的 zod 已经挡过一次；这一道是给"绕过路由直接调 store"的。 */
export const assertGrantDays = (days: number): void => {
  if (!Number.isInteger(days) || days < GRANT_DAYS_MIN || days > GRANT_DAYS_MAX) {
    throw new InvalidGrantDaysError(
      days,
      `必须是 ${String(GRANT_DAYS_MIN)}–${String(GRANT_DAYS_MAX)} 之间的整数`,
    );
  }
};

/** 理由闸门：去掉首尾空白后不许为空。 */
const assertGrantReason = (reason: string): string => {
  const trimmed = reason.trim();
  if (trimmed === '') throw new MissingGrantReasonError();
  return trimmed;
};

// ---------------------------------------------------------------------------
// 读面
// ---------------------------------------------------------------------------

/**
 * 后台档位下拉。
 *
 * 🔴 它是 `SKU_GRANTS` 的**投影**，不是第二份清单：界面上不许硬编码档位，
 * 否则"价目表加了一档但后台没有"这件事需要一个人才会发现。
 *
 * ⚠️ 这一格**不显示价格**，也**不带那句"为什么现在发不了"**。
 *
 * 价格：这一格是给"送人哪一档"用的，把 ¥ 数字放在它旁边会被读成"这一下要收钱"，
 * 而它不收 —— 价格的事实源在 `price-book.ts`，要看价格该去订单/价目那一格。
 *
 * 理由：`NOT_YET_DELIVERABLE_SKUS` 的值是**中文散文**。它一旦进响应就会绕过词条表
 * 直接出现在界面上，而切了英文的用户会看到一句中文 —— 那正是
 * [ADR-0074](../../../docs/adr/0074-checkout-rejection-reason-is-a-token.md) §三.1
 * 给收银台定下"码进响应、散文进日志"时要改掉的那个形状。所以这里只给 `sellable`：
 * **能不能发**是一个布尔，够界面做决定；那句话留给日志与 `pnpm doctor:billing`。
 */
export const listGrantSkuOptions = (): GrantSkuOption[] =>
  Object.keys(SKU_GRANTS)
    .sort()
    .map((priceId) => {
      const grants = grantsForSku(priceId);
      const reason = notSellableReason(priceId);
      return {
        priceId,
        // 未知档位在这里只可能是"两处词表不同步"（`SKU_GRANTS` 自己有键、
        // `grantsForSku` 却不认）—— 那种情况下把它当"可发"列出来是更坏的，
        // 所以按**空能力**列出，让写入路径去拒（写入那道闸门才是裁决者）。
        grants: grants ?? [],
        sellable: grants !== null && reason === null,
      };
    });

/** 发放记录（动作史）。最新在前，按调用方给的分页窗口取。 */
export async function listSubscriptionGrants(
  options: { readonly take: number; readonly skip: number; readonly userId?: number },
  client: GrantDb = prisma,
): Promise<{ readonly items: readonly GrantAuditRow[]; readonly total: number }> {
  const where = options.userId === undefined ? {} : { userId: options.userId };
  const [total, rows] = await Promise.all([
    client.subscriptionGrant.count({ where }),
    client.subscriptionGrant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options.take,
      skip: options.skip,
    }),
  ]);
  return { items: rows.map(toAuditRow), total };
}

/** 某个用户当前的发放行（`null` = 没有）。收回后的行仍然在这里，只是状态不是 active。 */
async function readGrantRow(client: GrantTx, userId: number) {
  return client.subscription.findFirst({
    where: { userId, provider: ADMIN_GRANT_PROVIDER },
    orderBy: { id: 'desc' },
  });
}

/** 发放行的类型（Prisma 推出来的那一份，避免在这里重抄一遍列 → 重抄就会漂）。 */
type GrantRow = Awaited<ReturnType<typeof readGrantRow>>;
/** 「有这一行」的那一档 —— 给下面的类型守卫用，让调用点拿到 `id` 时不必断言。 */
type ExistingGrantRow = NonNullable<GrantRow>;

/**
 * 「当前有效」= 状态在 `entitledStatuses` 里 **且** 周期还没过。
 *
 * 🔴 这两个谓词必须**同时**成立，缺一不可，而它和 `entitlement.ts` 判用户能不能用
 * 时用的是同一对谓词 —— 后台在这里如果只判 `status === 'active'`，就会出现
 * "后台说他有效、用户已经被闸门挡在门外"（周期早过了但没人改状态），
 * 那正是营收看板那条「不读一个没人读的字段」的反面。
 */
const isLiveGrant = (row: GrantRow, now: number): row is ExistingGrantRow =>
  row !== null &&
  row.status === 'active' &&
  row.currentPeriodEnd !== null &&
  Number(row.currentPeriodEnd) > now;

// ---------------------------------------------------------------------------
// 写面
// ---------------------------------------------------------------------------

/**
 * **赠送订阅**：在发放行上把周期延长 N 天，档位设为所选 SKU。
 *
 * 三种落点，同一个函数（它们不是三种语义，是同一句话的三个时态）：
 *
 * | 现状 | 结果 |
 * |---|---|
 * | 没有发放行 | 建一行，到期 = `now + N 天` |
 * | 有发放行、还没到期 | 接在旧到期日**后面**（`max(now, end) + N`）—— 不覆盖已发的时长 |
 * | 有发放行、已到期/已收回 | 复活成 active，从 `now` 重新起算 |
 *
 * `max(now, 已有到期) + N` 用的是**收钱路径的同一个函数**
 * （`extendSubscriptionPeriod`），不在这里重写公式：那份公式对非有限输入抛异常，
 * 而"自己再写一个加法"正是 `invite.ts` 文件头点名要避免的那第二份实现。
 */
export async function grantSubscription(
  input: {
    readonly userId: number;
    readonly sku: string;
    readonly days: number;
    readonly reason: string;
    readonly actorUserId: number;
    readonly now: number;
  },
  client: GrantDb = prisma,
): Promise<GrantOutcome> {
  const grants = resolveGrantGrants(input.sku);
  assertGrantDays(input.days);
  const reason = assertGrantReason(input.reason);

  return client.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } });
    if (user === null) throw new GrantUserNotFoundError(input.userId);

    const existing = await readGrantRow(tx, input.userId);
    const before =
      existing?.currentPeriodEnd === null || existing?.currentPeriodEnd === undefined
        ? null
        : Number(existing.currentPeriodEnd);

    const after = extendSubscriptionPeriod({
      now: input.now,
      currentPeriodEnd: before,
      days: input.days,
    });

    const write = {
      provider: ADMIN_GRANT_PROVIDER,
      status: 'active',
      currentPeriodEnd: BigInt(after),
      priceId: input.sku,
      grants: [...grants],
      lastEventAt: BigInt(input.now),
      updatedAt: BigInt(input.now),
    };

    const row =
      existing === null
        ? await tx.subscription.create({
            data: {
              ...write,
              userId: input.userId,
              // 发放没有外部订阅对象，如实留空（与邀请、手动授予那两条路径同形）。
              externalSubscriptionId: null,
              createdAt: BigInt(input.now),
            },
          })
        : await tx.subscription.update({ where: { id: existing.id }, data: write });

    const audit = await tx.subscriptionGrant.create({
      data: {
        userId: input.userId,
        actorUserId: input.actorUserId,
        action: 'grant',
        sku: input.sku,
        days: input.days,
        grants: [...grants],
        beforePeriodEnd: before === null ? null : BigInt(before),
        afterPeriodEnd: BigInt(after),
        reason,
        createdAt: BigInt(input.now),
      },
    });

    return { subscription: toGrantView(row), audit: toAuditRow(audit) };
  });
}

/**
 * **免费升级**：只把发放行的档位换成更高一档，**一天都不加**。
 *
 * 🔴 与 `grantSubscription` 的差别只有"动不动 `currentPeriodEnd`"。
 * 分成两个函数是刻意的（ADR-0076 §3.4）：一个带开关的函数会造出
 * `upgrade + days=30` 这种没人核对过的组合，而判据必须写成条件断言 ——
 * 那种断言在变异验证里很容易两头都测不到。
 *
 * 为什么这样就能"升级"一个付费用户：判定是**跨行并集**，发放行带上更高档的能力
 * 就在那一刻抬上去；到期或收回后回到他付过钱的那一档。**付费行一个字段都没动。**
 *
 * 🔴 要求**当前有效**的发放行。打在已收回的行上等于一次伪装的重新发放
 * （它不加天数，那条审计会写"这次没给时间"，而实际上给了一段新周期）——
 * 那种情况必须走 `grant`。
 */
export async function upgradeSubscriptionGrant(
  input: {
    readonly userId: number;
    readonly sku: string;
    readonly reason: string;
    readonly actorUserId: number;
    readonly now: number;
  },
  client: GrantDb = prisma,
): Promise<GrantOutcome> {
  const grants = resolveGrantGrants(input.sku);
  const reason = assertGrantReason(input.reason);

  return client.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } });
    if (user === null) throw new GrantUserNotFoundError(input.userId);

    const existing = await readGrantRow(tx, input.userId);
    if (!isLiveGrant(existing, input.now)) {
      throw new NoActiveGrantError(input.userId);
    }
    const before = existing.currentPeriodEnd === null ? null : Number(existing.currentPeriodEnd);

    const row = await tx.subscription.update({
      where: { id: existing.id },
      // 🔴 没有 `currentPeriodEnd`：这一行的全部意义就是"它不改时间"。
      // 变异验证会把它加回去一次，那条判据必须因此红。
      data: {
        priceId: input.sku,
        grants: [...grants],
        lastEventAt: BigInt(input.now),
        updatedAt: BigInt(input.now),
      },
    });

    const audit = await tx.subscriptionGrant.create({
      data: {
        userId: input.userId,
        actorUserId: input.actorUserId,
        action: 'upgrade',
        sku: input.sku,
        // 升档不给天数。存 `null` 而不是 `0`：`0` 是"发了 0 天"（一个天数），
        // `null` 是"这次动作的语义里没有天数这一维"。
        days: null,
        grants: [...grants],
        beforePeriodEnd: before === null ? null : BigInt(before),
        afterPeriodEnd: before === null ? null : BigInt(before),
        reason,
        createdAt: BigInt(input.now),
      },
    });

    return { subscription: toGrantView(row), audit: toAuditRow(audit) };
  });
}

/**
 * **收回发放**：把发放行判死，**行留着**。
 *
 * | 做法 | 为什么不是它 |
 * |---|---|
 * | `delete` 那一行 | 权益史就没了；下次给同一个人发放会看起来像"第一次" |
 * | 清空 `priceId`/`grants` | 那是只有改写别人的购买记录才做得出的动作，而发放行清空了也没意义 |
 * | 顺带把付费行也停掉 | 🔴 那是**退款**的职责（ADR-0053），不是这里的。收回一次发放让一个付费用户失去他买的东西，是这条边界唯一必须挡住的症状 |
 *
 * `currentPeriodEnd = now` 让"到期判定"这条现成的路把它关掉 ——
 * 不引入第二种"无效"表示（`status='canceled'` 与周期已过**同时**成立，
 * 因为 `entitledStatuses` 只认 `active`，而周期那一条也独立生效）。
 */
export async function revokeSubscriptionGrant(
  input: {
    readonly userId: number;
    readonly reason: string;
    readonly actorUserId: number;
    readonly now: number;
  },
  client: GrantDb = prisma,
): Promise<GrantOutcome> {
  const reason = assertGrantReason(input.reason);

  return client.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } });
    if (user === null) throw new GrantUserNotFoundError(input.userId);

    const existing = await readGrantRow(tx, input.userId);
    if (!isLiveGrant(existing, input.now)) {
      throw new NoActiveGrantError(input.userId);
    }
    const before = existing.currentPeriodEnd === null ? null : Number(existing.currentPeriodEnd);

    const row = await tx.subscription.update({
      where: { id: existing.id },
      data: {
        status: 'canceled',
        currentPeriodEnd: BigInt(input.now),
        lastEventAt: BigInt(input.now),
        updatedAt: BigInt(input.now),
      },
    });

    const audit = await tx.subscriptionGrant.create({
      data: {
        userId: input.userId,
        actorUserId: input.actorUserId,
        action: 'revoke',
        // 收回不重新声明档位：`sku`/`grants` 留 `null`/空，
        // 那一档是什么由**它自己那一条 `grant`/`upgrade` 审计行**说。
        sku: null,
        days: null,
        grants: [],
        beforePeriodEnd: before === null ? null : BigInt(before),
        afterPeriodEnd: BigInt(input.now),
        reason,
        createdAt: BigInt(input.now),
      },
    });

    return { subscription: toGrantView(row), audit: toAuditRow(audit) };
  });
}
