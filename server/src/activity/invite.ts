/**
 * 邀请：发码、绑定、结算、发奖。
 *
 * ## 生命周期（与 `schema.prisma` 的 `Referral` 注释同源）
 *
 * ```
 *   ① 被邀请人注册时带上 ?invite=CODE
 *        → attachInviteOnRegister()：建一行 referrals（activatedAt = null）
 *   ② 被邀请人点邮件里的链接完成验证
 *        → settleReferralActivation()：标记激活 + 给邀请人加 5 天 + 写通知
 * ```
 *
 * ## 🔴 为什么"发奖"发生在 `verifyEmail` 的**同一个事务**里
 *
 * 结算与验证共用一个事务，换到的是三件事：
 *
 * 1. **不会重复发**：标记激活用的是 `updateMany({ where: { activatedAt: null } })`
 *    这个 CAS，加上 `referrals.invitee_user_id` 的唯一约束，两处合起来才是
 *    "恰好一次"。并发两次验证请求时，第二次的 `claim.count` 是 0。
 * 2. **不会半途**：会员加了但通知没写（或反过来）都不会发生。
 * 3. **失败是可重试的**：结算抛异常会让整个事务回滚 —— 于是 `isVerified` 仍是 0、
 *    验证令牌还在，用户**再点一次那封邮件里的链接**就会重来一遍。
 *    这是刻意的：验证是一个用户能自己重试的动作，而"验证成功但奖励丢了"
 *    是他既看不见、也无法自救的状态。
 *
 * ⚠️ 代价是：如果结算真的坏了，**邮箱验证会一起失败**。所以这里的所有写入
 * 都必须按构造满足数据库的 CHECK（见迁移里的三条 `referrals_*`），
 * 而不是"但愿它不抛"。
 *
 * ## 🔴 奖励行的形状：`(userId, 'invite')` 一行，到期日叠加
 *
 * 奖品写进 `subscriptions` 表，`provider = 'invite'`：
 *
 * | 问题 | 做法 | 理由 |
 * |---|---|---|
 * | 会不会和付费行打架 | **不会**，provider 不同 ⇒ 不是同一行 | `apply-event.ts` 的约定是"一行一用户 / (userId, provider)" |
 * | 会不会覆盖已付时长 | **不会**，用 `extendSubscriptionPeriod` 做 `max(now, 已有到期日) + N 天` | 那个公式是收钱路径的同一个函数，不在这里重写 |
 * | `price_id` 写什么 | `null`（档位未知） | 它不是一次购买。编一个 `hosted-monthly` 进去等于伪造一条购买事实 |
 *
 * ⚠️ 由此产生一条**必须同时成立**的前提：权益判定不能再"只看最新那一行"。
 * 邀请行是在付费行**之后**建的，按 id 取最新会把付费时长整个丢掉 ——
 * 见 `entitlement.ts` 的 `evaluateCapabilityAcross`。
 */
import { randomBytes } from 'node:crypto';

import { Prisma } from '@prisma/client';

import {
  INVITE_CAP_PER_WINDOW,
  INVITE_CAP_WINDOW_DAYS,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  INVITE_REWARD_DAYS,
  decideInviteAttach,
  displayNameFromEmail,
  extendSubscriptionPeriod,
  isInviteCodeShape,
  normalizeInviteCode,
  type InviteAttachRejection,
} from '@heyta/domain';

import { prisma } from '../db';
import { Logger } from '../logger';
import { toEpochMillis } from '../entitlement';
import { createNotification } from './notifications';

/**
 * 邀请奖励用的 provider 名。
 *
 * 🔴 它同时是**权益行的身份**：权益判定按 `(userId, provider)` 区分来源，
 * 所以这个字符串不能是 `'manual'` 之类会被别处复用的值 ——
 * 一旦两个来源共用一个 provider，两条权益就会互相覆盖到期日。
 */
export const INVITE_SUBSCRIPTION_PROVIDER = 'invite';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 事务内外这些委托形状相同，所以 `prisma` 与 `tx` 都能传进来。 */
export type ActivityDb = Prisma.TransactionClient;

/** 邀请码字符数固定，一次多取几个字节再筛，几乎不会重试。 */
const INVITE_ALPHABET_SIZE = INVITE_CODE_ALPHABET.length;
/**
 * 拒绝采样的上界：`floor(256 / 31) * 31 = 248`。
 *
 * 直接 `byte % 31` 会让前 8 个字母比其余多出约 3% 的命中率 —— 那不是安全问题，
 * 但"码的分布稍有偏"这种性质一旦写下来就没人能重新证明它无害，不如当场做对。
 */
const INVITE_UNBIASED_LIMIT = Math.floor(256 / INVITE_ALPHABET_SIZE) * INVITE_ALPHABET_SIZE;

/** 生成一张邀请码：固定长度、字母表内均匀、不含易混字符。 */
export const generateInviteCode = (): string => {
  const out: string[] = [];
  while (out.length < INVITE_CODE_LENGTH) {
    for (const byte of randomBytes(INVITE_CODE_LENGTH * 2)) {
      if (out.length >= INVITE_CODE_LENGTH) break;
      if (byte >= INVITE_UNBIASED_LIMIT) continue;
      out.push(INVITE_CODE_ALPHABET.charAt(byte % INVITE_ALPHABET_SIZE));
    }
  }
  return out.join('');
};

const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/**
 * 取某个用户的邀请码，没有就**惰性建一张**。
 *
 * ## 为什么读路径会写
 *
 * 这是刻意的 get-or-create：注册时就发码的话，绝大多数账号的码永远不会被用到
 * （他们会来注册，但不会去邀请），而每一张都要占一个全局唯一值。
 *
 * 它是**幂等**的：并发调用最多多试几次，最终两方拿到同一张码
 * （`invite_codes.user_id` 上的唯一约束是这件事的保证）。
 */
export const ensureInviteCode = async (userId: number): Promise<string> => {
  const existing = await prisma.inviteCode.findUnique({ where: { userId } });
  if (existing !== null) return existing.code;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const created = await prisma.inviteCode.create({
        data: { userId, code: generateInviteCode(), createdAt: BigInt(Date.now()) },
      });
      return created.code;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // P2002 有两种可能，必须分开处理：
      //   · 并发下另一个请求已经为**这个用户**建好了 → 直接用它；
      //   · 只是**码**撞了 → 换一张重试。
      // 先按 userId 重读：它同时覆盖了前一种情况，以及"自己建成功了但响应丢了"。
      const again = await prisma.inviteCode.findUnique({ where: { userId } });
      if (again !== null) return again.code;
    }
  }

  // 5 次都撞码：31^8 ≈ 8.5e11 的空间里连撞 5 次，说明不是概率问题。
  throw new Error('生成邀请码连续失败，请稍后重试');
};

/** 绑定结果。比 `decideInviteAttach` 多两种"只有服务端才知道"的拒绝原因。 */
export type InviteAttachOutcome =
  | { readonly attached: true; readonly referralId: number; readonly inviterUserId: number }
  | {
      readonly attached: false;
      readonly reason: InviteAttachRejection | 'MALFORMED_CODE' | 'UNKNOWN_CODE';
    };

export interface AttachInviteInput {
  /** 刚注册出来的账号。 */
  readonly inviteeUserId: number;
  /** 注册请求里带来的码（原样、未归一化）。`undefined` = 没带。 */
  readonly rawCode: string | undefined;
  /** epoch 毫秒。 */
  readonly now: number;
  readonly db?: ActivityDb;
}

/**
 * 注册时把邀请码绑定到新账号上。
 *
 * ## 🔴 这个函数**永远不该让注册失败**
 *
 * 注册路径必须对"邮箱是否已存在""码是否有效"保持**中性**（反枚举）。
 * 所以调用方拿到任何结果都继续走注册成功的响应，这里也**不抛**业务性错误 ——
 * 唯一的异常是数据库真的坏了（那本来就会让注册失败）。
 *
 * 拒绝**不会**告诉用户原因。这是有意的：在注册那一刻说出"这张码无效"，
 * 等于确认了"有一张码存在但不对"，而那张码的价值只在邀请人手上。
 * 被邀请人什么都没损失（按产品规则，奖励只发给邀请人），
 * 而邀请人会通过"成功邀请 0 人"自己发现。
 */
export const attachInviteOnRegister = async (
  input: AttachInviteInput,
): Promise<InviteAttachOutcome> => {
  const db = input.db ?? prisma;
  const normalized = normalizeInviteCode(input.rawCode ?? '');

  if (!isInviteCodeShape(normalized)) {
    return { attached: false, reason: 'MALFORMED_CODE' };
  }

  const code = await db.inviteCode.findUnique({ where: { code: normalized } });
  if (code === null) {
    return { attached: false, reason: 'UNKNOWN_CODE' };
  }

  const [existingReferral, invitesInWindow] = await Promise.all([
    db.referral.findUnique({ where: { inviteeUserId: input.inviteeUserId } }),
    db.referral.count({
      where: {
        inviterUserId: code.userId,
        createdAt: { gte: BigInt(input.now - INVITE_CAP_WINDOW_DAYS * MS_PER_DAY) },
      },
    }),
  ]);

  const decision = decideInviteAttach({
    inviterUserId: code.userId,
    inviteeUserId: input.inviteeUserId,
    codeDisabled: code.disabled,
    inviteeAlreadyReferred: existingReferral !== null,
    invitesInWindow,
  });

  if (!decision.attached) {
    Logger.info(`Invite not attached: ${decision.reason}`);
    return { attached: false, reason: decision.reason };
  }

  try {
    const created = await db.referral.create({
      data: {
        inviteeUserId: input.inviteeUserId,
        inviterUserId: code.userId,
        code: normalized,
        createdAt: BigInt(input.now),
        // 三个结算字段全为 null = "还没兑现"，由数据库的
        // `referrals_settlement_all_or_nothing` 钉住（不允许半成品）。
      },
    });
    return { attached: true, referralId: created.id, inviterUserId: code.userId };
  } catch (err) {
    // 并发注册同一邮箱时的第二次写入会撞 `invitee_user_id` 唯一约束。
    // 这不是错误，是"已经算过一次了"。
    if (isUniqueViolation(err)) {
      return { attached: false, reason: 'INVITEE_ALREADY_REFERRED' };
    }
    throw err;
  }
};

/**
 * 给邀请人加 `days` 天的 `hosting` 权益。
 *
 * 见文件头："一行一用户 / (userId, provider)"、到期日**叠加**而不是覆盖。
 */
export const grantInviteReward = async (
  db: ActivityDb,
  inviterUserId: number,
  days: number,
  now: number,
): Promise<void> => {
  const existing = await db.subscription.findFirst({
    where: { userId: inviterUserId, provider: INVITE_SUBSCRIPTION_PROVIDER },
    orderBy: { id: 'desc' },
  });

  const currentPeriodEnd =
    existing === null ? null : (toEpochMillis(existing.currentPeriodEnd) ?? null);

  // 🔴 复用收钱路径的同一个函数，不在这里重写 `max(now, end) + N`。
  // 它对非有限输入**抛异常**（而不是把 NaN 写进库），正是这里想要的。
  const nextPeriodEnd = extendSubscriptionPeriod({ now, currentPeriodEnd, days });

  const write = {
    provider: INVITE_SUBSCRIPTION_PROVIDER,
    // 邀请没有外部订阅对象，如实写 null（与微信那条路径同形）。
    externalSubscriptionId: null,
    status: 'active',
    currentPeriodEnd: BigInt(nextPeriodEnd),
    // 🔴 不是一次购买，所以档位如实写"未知"，不编一个 priceId。
    priceId: null,
    grants: ['hosting'],
    lastEventAt: BigInt(now),
    updatedAt: BigInt(now),
  };

  if (existing === null) {
    await db.subscription.create({
      data: { ...write, userId: inviterUserId, createdAt: BigInt(now) },
    });
    return;
  }
  await db.subscription.update({ where: { id: existing.id }, data: write });
};

/** 结算结果。用于测试与日志，不直接回给用户。 */
export type SettlementOutcome =
  | { readonly settled: true; readonly inviterUserId: number; readonly days: number }
  | { readonly settled: false; readonly reason: 'NO_REFERRAL' | 'ALREADY_SETTLED' };

/**
 * 被邀请人完成邮箱验证时结算这条邀请。
 *
 * 🔴 调用点**必须**在 `verifyEmail` 的验证事务里（见文件头的三条理由）。
 * 幂等靠 CAS，不靠"调用方只会调一次"。
 */
export const settleReferralActivation = async (
  db: ActivityDb,
  inviteeUserId: number,
  now: number,
  days: number = INVITE_REWARD_DAYS,
): Promise<SettlementOutcome> => {
  const referral = await db.referral.findUnique({ where: { inviteeUserId } });
  if (referral === null) return { settled: false, reason: 'NO_REFERRAL' };

  // CAS：只有"还没激活"的那一行会被改写。并发第二次得到 count === 0。
  const claim = await db.referral.updateMany({
    where: { id: referral.id, activatedAt: null },
    data: {
      activatedAt: BigInt(now),
      rewardDays: days,
      rewardedAt: BigInt(now),
    },
  });
  if (claim.count !== 1) return { settled: false, reason: 'ALREADY_SETTLED' };

  await grantInviteReward(db, referral.inviterUserId, days, now);

  // 展示名在**写入时**快照一次：之后对方改邮箱不会改写这条历史。
  // 拿不到就是 `null`，由客户端按读者当前的语言兜底（见 domain 的说明）。
  const invitee = await db.user.findUnique({
    where: { id: inviteeUserId },
    select: { email: true },
  });

  await createNotification(db, {
    userId: referral.inviterUserId,
    kind: 'referral-activated',
    payload: { displayName: displayNameFromEmail(invitee?.email ?? ''), days },
    createdAt: now,
  });

  Logger.info(
    `Referral settled: inviter=${referral.inviterUserId} days=${days} (invitee=${inviteeUserId})`,
  );

  return { settled: true, inviterUserId: referral.inviterUserId, days };
};

/** `referrals` 行的一条投影，给"我邀请了谁"列表用。 */
export interface ReferralSummary {
  /** 邀请码（快照）。 */
  readonly code: string;
  /** 被邀请人的展示名（当前邮箱用户名部分）；拿不到是 `null`。 */
  readonly displayName: string | null;
  /** epoch 毫秒。 */
  readonly createdAt: number;
  /** epoch 毫秒；`null` = 还没激活。 */
  readonly activatedAt: number | null;
  /** 已发放的天数；`null` = 还没发放。 */
  readonly rewardDays: number | null;
}

/** 「活动」页要的全部数据。 */
export interface ActivitySummary {
  readonly inviteCode: string;
  readonly rewardDays: number;
  readonly invited: number;
  readonly activated: number;
  readonly daysEarned: number;
  /** 上限窗口内**已绑定**的邀请数（含还没激活的）。 */
  readonly windowInvited: number;
  /** 窗口内最多能绑定多少条。 */
  readonly windowCap: number;
  readonly windowDays: number;
  readonly referrals: readonly ReferralSummary[];
}

export const ACTIVITY_REFERRAL_LIST_LIMIT = 20;
const ACTIVITY_REFERRAL_LIST_MAX = 100;

/**
 * 汇总某个用户的邀请情况。
 *
 * ⚠️ `windowInvited` / `windowCap` / `windowDays` 一起返回，是为了让界面能说
 * "本窗口还能邀请 N 位"，而**不是**让界面自己去猜上限 ——
 * 上限是产品决定，它只该有一个定义（`INVITE_CAP_PER_WINDOW`，在 domain 里）。
 */
export const getActivitySummary = async (
  userId: number,
  now: number,
  referralsLimit: number = ACTIVITY_REFERRAL_LIST_LIMIT,
): Promise<ActivitySummary> => {
  // 读路径惰性建码。见 `ensureInviteCode` 的说明（幂等 get-or-create）。
  const inviteCode = await ensureInviteCode(userId);

  const clamped = Math.min(
    Math.max(Math.trunc(referralsLimit), 1),
    ACTIVITY_REFERRAL_LIST_MAX,
  );

  const [rows, invited, activated, windowInvited, rewardSum] = await Promise.all([
    prisma.referral.findMany({
      where: { inviterUserId: userId },
      select: {
        code: true,
        createdAt: true,
        activatedAt: true,
        rewardDays: true,
        invitee: { select: { email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: clamped,
    }),
    prisma.referral.count({ where: { inviterUserId: userId } }),
    prisma.referral.count({ where: { inviterUserId: userId, activatedAt: { not: null } } }),
    prisma.referral.count({
      where: {
        inviterUserId: userId,
        createdAt: { gte: BigInt(now - INVITE_CAP_WINDOW_DAYS * MS_PER_DAY) },
      },
    }),
    prisma.referral.aggregate({
      where: { inviterUserId: userId },
      _sum: { rewardDays: true },
    }),
  ]);

  const referrals: ReferralSummary[] = rows.map((row) => ({
    code: row.code,
    displayName: displayNameFromEmail(row.invitee?.email ?? ''),
    createdAt: toEpochMillis(row.createdAt) ?? 0,
    activatedAt: toEpochMillis(row.activatedAt) ?? null,
    rewardDays: row.rewardDays,
  }));

  return {
    inviteCode,
    rewardDays: INVITE_REWARD_DAYS,
    invited,
    // 🔴 `invited` / `activated` / `daysEarned` 三个数字**必须来自全量聚合**，
    // 不能从上面那一页 `referrals` 里数出来 —— 列表有 `take` 上限，
    // 从页里数会让"邀请 200 人"的账号看到"已激活 20 人"，
    // 而这两个数字在界面上是并排显示的，对不上时没有任何东西会报错。
    activated,
    daysEarned: rewardSum._sum.rewardDays ?? 0,
    windowInvited,
    windowCap: INVITE_CAP_PER_WINDOW,
    windowDays: INVITE_CAP_WINDOW_DAYS,
    referrals,
  };
};
