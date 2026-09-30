import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 邀请的核心逻辑：发码、绑定、发奖、结算。
 *
 * ## 为什么这一层要单独测
 *
 * 这些函数跑在**邮箱验证事务**里（见 `src/activity/invite.ts` 头注释）。
 * 它们出错的方式不是"报一个错"，而是三种静默：
 *
 * - **多发一次**：没有 CAS 的话，并发的两次验证会让同一条邀请发两遍奖励；
 * - **少发一次**：结算状态写了一半（激活了但没发）；
 * - **丢时长**：发奖时用 `now + N` 覆盖而不是 `max(now, 已有) + N`，
 *   把用户已经付过钱的剩余时间埋掉。
 *
 * 三种都不会抛异常，只会在对账时表现为"数字对不上"。所以每条都单独钉。
 */

const mocks = vi.hoisted(() => ({
  inviteCode: { findUnique: vi.fn(), create: vi.fn() },
  referral: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    aggregate: vi.fn(),
  },
  subscription: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn() },
  accountNotification: { create: vi.fn(), findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
}));

vi.mock('../src/db', () => ({ prisma: mocks }));

vi.mock('../src/logger', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    audit: vi.fn(),
  },
}));

import {
  INVITE_SUBSCRIPTION_PROVIDER,
  attachInviteOnRegister,
  ensureInviteCode,
  generateInviteCode,
  grantInviteReward,
  settleReferralActivation,
} from '../src/activity/invite';
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  INVITE_REWARD_DAYS,
} from '@heyta/domain';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

/** 构造一个 Prisma 的 P2002（唯一约束冲突）。 */
const uniqueViolation = (): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
  });

const db = mocks as unknown as Parameters<typeof attachInviteOnRegister>[0]['db'] &
  typeof mocks;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.referral.updateMany.mockResolvedValue({ count: 1 });
  mocks.referral.create.mockResolvedValue({ id: 42 });
  mocks.subscription.create.mockResolvedValue({ id: 1 });
  mocks.subscription.update.mockResolvedValue({ id: 1 });
  mocks.accountNotification.create.mockResolvedValue({ id: 1 });
  mocks.user.findUnique.mockResolvedValue({ email: 'star@example.com' });
});

describe('generateInviteCode', () => {
  it('长度固定', () => {
    expect(generateInviteCode()).toHaveLength(INVITE_CODE_LENGTH);
  });

  it('字符全部在字母表内（也就是不含 0/O/1/I/L）', () => {
    for (let i = 0; i < 50; i += 1) {
      for (const ch of generateInviteCode()) {
        expect(INVITE_CODE_ALPHABET.includes(ch)).toBe(true);
      }
    }
  });

  it('大写下发，正好满足库里的 CHECK', () => {
    for (let i = 0; i < 20; i += 1) {
      const code = generateInviteCode();
      expect(code).toBe(code.toUpperCase());
      expect(code).toBe(code.trim());
    }
  });

  it('连续 200 张码没有重复（31^8 的空间里这不是概率问题）', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(generateInviteCode());
    expect(seen.size).toBe(200);
  });

  it('字母表全部字符都会被用到（拒绝采样没有把某一段饿死）', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i += 1) {
      for (const ch of generateInviteCode()) seen.add(ch);
    }
    expect(seen.size).toBe(INVITE_CODE_ALPHABET.length);
  });
});

describe('ensureInviteCode（惰性 get-or-create）', () => {
  it('已有码 → 直接返回，不再写库', async () => {
    mocks.inviteCode.findUnique.mockResolvedValue({ userId: 7, code: 'ABCD2345' });
    expect(await ensureInviteCode(7)).toBe('ABCD2345');
    expect(mocks.inviteCode.create).not.toHaveBeenCalled();
  });

  it('没有码 → 建一张并返回', async () => {
    mocks.inviteCode.findUnique.mockResolvedValue(null);
    mocks.inviteCode.create.mockResolvedValue({ code: 'WXYZ6789' });
    expect(await ensureInviteCode(7)).toBe('WXYZ6789');
    expect(mocks.inviteCode.create).toHaveBeenCalledOnce();
  });

  it('🔴 并发下撞 P2002、但重读发现同用户已有码 → 用那一张（不发散）', async () => {
    mocks.inviteCode.findUnique
      .mockResolvedValueOnce(null) // 第一次：还没有
      .mockResolvedValueOnce({ userId: 7, code: 'AAAA2222' }); // 重读：并发的另一方建好了
    mocks.inviteCode.create.mockRejectedValue(uniqueViolation());

    expect(await ensureInviteCode(7)).toBe('AAAA2222');
  });

  it('🔴 只是码撞了（重读仍没有该用户的码）→ 换一张重试', async () => {
    mocks.inviteCode.findUnique
      .mockResolvedValueOnce(null) // 初次
      .mockResolvedValueOnce(null) // 重读：不是同用户并发，是码撞了
      .mockResolvedValue(null);
    mocks.inviteCode.create
      .mockRejectedValueOnce(uniqueViolation())
      .mockResolvedValueOnce({ code: 'BBBB3333' });

    expect(await ensureInviteCode(7)).toBe('BBBB3333');
    expect(mocks.inviteCode.create).toHaveBeenCalledTimes(2);
  });

  it('🔴 连续 5 次都撞码 → 抛（那说明不是概率问题）', async () => {
    mocks.inviteCode.findUnique.mockResolvedValue(null);
    mocks.inviteCode.create.mockRejectedValue(uniqueViolation());

    await expect(ensureInviteCode(7)).rejects.toThrow(/邀请码/);
  });

  it('非 P2002 的异常直接冒出去（不吞数据库故障）', async () => {
    mocks.inviteCode.findUnique.mockResolvedValue(null);
    mocks.inviteCode.create.mockRejectedValue(new Error('db down'));

    await expect(ensureInviteCode(7)).rejects.toThrow('db down');
  });
});

describe('attachInviteOnRegister', () => {
  const setupCode = (overrides: Partial<{ userId: number; code: string; disabled: boolean }> = {}) => {
    mocks.inviteCode.findUnique.mockResolvedValue({
      userId: 100,
      code: 'ABCD2345',
      disabled: false,
      ...overrides,
    });
    mocks.referral.findUnique.mockResolvedValue(null);
    mocks.referral.count.mockResolvedValue(0);
  };

  it('没带码 → MALFORMED_CODE，且一次库都不查', async () => {
    const outcome = await attachInviteOnRegister({
      inviteeUserId: 2,
      rawCode: undefined,
      now: NOW,
      db,
    });
    expect(outcome).toEqual({ attached: false, reason: 'MALFORMED_CODE' });
    expect(mocks.inviteCode.findUnique).not.toHaveBeenCalled();
  });

  it('形状不对（长度差一位）→ MALFORMED_CODE', async () => {
    const outcome = await attachInviteOnRegister({
      inviteeUserId: 2,
      rawCode: 'ABCD234',
      now: NOW,
      db,
    });
    expect(outcome).toEqual({ attached: false, reason: 'MALFORMED_CODE' });
  });

  it('🔴 归一化在查找**之前**：用户粘 `abcd-2345` 也能命中库里那行', async () => {
    setupCode();
    await attachInviteOnRegister({
      inviteeUserId: 2,
      rawCode: '  abcd-2345  ',
      now: NOW,
      db,
    });
    expect(mocks.inviteCode.findUnique).toHaveBeenCalledWith({
      where: { code: 'ABCD2345' },
    });
  });

  it('库里没有这张码 → UNKNOWN_CODE', async () => {
    mocks.inviteCode.findUnique.mockResolvedValue(null);
    const outcome = await attachInviteOnRegister({
      inviteeUserId: 2,
      rawCode: 'ABCD2345',
      now: NOW,
      db,
    });
    expect(outcome).toEqual({ attached: false, reason: 'UNKNOWN_CODE' });
  });

  it('自己邀请自己 → SELF_INVITE，不建行', async () => {
    setupCode({ userId: 2 });
    const outcome = await attachInviteOnRegister({
      inviteeUserId: 2,
      rawCode: 'ABCD2345',
      now: NOW,
      db,
    });
    expect(outcome).toEqual({ attached: false, reason: 'SELF_INVITE' });
    expect(mocks.referral.create).not.toHaveBeenCalled();
  });

  it('码被停用 → CODE_DISABLED', async () => {
    setupCode({ disabled: true });
    const outcome = await attachInviteOnRegister({
      inviteeUserId: 2,
      rawCode: 'ABCD2345',
      now: NOW,
      db,
    });
    expect(outcome).toEqual({ attached: false, reason: 'CODE_DISABLED' });
  });

  it('被邀请人已经算过 → INVITEE_ALREADY_REFERRED', async () => {
    setupCode();
    mocks.referral.findUnique.mockResolvedValue({ id: 9, activatedAt: null });
    const outcome = await attachInviteOnRegister({
      inviteeUserId: 2,
      rawCode: 'ABCD2345',
      now: NOW,
      db,
    });
    expect(outcome).toEqual({ attached: false, reason: 'INVITEE_ALREADY_REFERRED' });
  });

  it('邀请人窗口内已到上限 → CAP_REACHED', async () => {
    setupCode();
    mocks.referral.count.mockResolvedValue(20);
    const outcome = await attachInviteOnRegister({
      inviteeUserId: 2,
      rawCode: 'ABCD2345',
      now: NOW,
      db,
    });
    expect(outcome).toEqual({ attached: false, reason: 'CAP_REACHED' });
  });

  it('🔴 窗口只数最近 30 天（用 createdAt 下界，而不是全表 count）', async () => {
    setupCode();
    await attachInviteOnRegister({
      inviteeUserId: 2,
      rawCode: 'ABCD2345',
      now: NOW,
      db,
    });
    const args = mocks.referral.count.mock.calls[0]![0] as {
      where: { createdAt: { gte: bigint } };
    };
    expect(args.where.createdAt.gte).toBe(BigInt(NOW - 30 * DAY));
  });

  it('成功 → 建行，且**结算三字段全空**（先登记、后兑现）', async () => {
    setupCode();
    const outcome = await attachInviteOnRegister({
      inviteeUserId: 2,
      rawCode: 'abcd2345',
      now: NOW,
      db,
    });

    expect(outcome).toEqual({ attached: true, referralId: 42, inviterUserId: 100 });
    const data = mocks.referral.create.mock.calls[0]![0].data as Record<string, unknown>;
    // 归一化之后的码被存下来（迁移的 CHECK 会拒掉未归一化的）。
    expect(data.code).toBe('ABCD2345');
    expect(data.inviterUserId).toBe(100);
    expect(data.inviteeUserId).toBe(2);
    expect(data.createdAt).toBe(BigInt(NOW));
    // 🔴 不能在这里写结算字段：那会造出"激活了但没发奖"的行，
    // 被迁移的 all-or-nothing CHECK 拒绝，而且语义上也是错的。
    expect('activatedAt' in data).toBe(false);
    expect('rewardDays' in data).toBe(false);
    expect('rewardedAt' in data).toBe(false);
  });

  it('🔴 并发注册的第二次写入撞唯一约束 → 当作"已经算过一次"，不抛', async () => {
    setupCode();
    mocks.referral.create.mockRejectedValue(uniqueViolation());
    const outcome = await attachInviteOnRegister({
      inviteeUserId: 2,
      rawCode: 'ABCD2345',
      now: NOW,
      db,
    });
    expect(outcome).toEqual({ attached: false, reason: 'INVITEE_ALREADY_REFERRED' });
  });

  it('其他数据库异常照常冒出去', async () => {
    setupCode();
    mocks.referral.create.mockRejectedValue(new Error('db down'));
    await expect(
      attachInviteOnRegister({ inviteeUserId: 2, rawCode: 'ABCD2345', now: NOW, db }),
    ).rejects.toThrow('db down');
  });
});

describe('grantInviteReward：到期日叠加，绝不覆盖', () => {
  it('没有邀请行 → 建一行，provider=invite、grants=[hosting]、priceId=null', async () => {
    mocks.subscription.findFirst.mockResolvedValue(null);
    await grantInviteReward(db, 7, INVITE_REWARD_DAYS, NOW);

    const data = mocks.subscription.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.provider).toBe(INVITE_SUBSCRIPTION_PROVIDER);
    expect(data.status).toBe('active');
    expect(data.grants).toEqual(['hosting']);
    expect(data.priceId).toBeNull();
    expect(data.externalSubscriptionId).toBeNull();
    expect(data.currentPeriodEnd).toBe(BigInt(NOW + INVITE_REWARD_DAYS * DAY));
  });

  it('🔴 已有更晚的到期日 → 从**那个日期**往后加，不埋掉已付时长', async () => {
    const existingEnd = NOW + 20 * DAY;
    mocks.subscription.findFirst.mockResolvedValue({
      id: 5,
      currentPeriodEnd: BigInt(existingEnd),
    });
    await grantInviteReward(db, 7, INVITE_REWARD_DAYS, NOW);

    const data = mocks.subscription.update.mock.calls[0]![0].data as {
      currentPeriodEnd: bigint;
    };
    expect(data.currentPeriodEnd).toBe(BigInt(existingEnd + INVITE_REWARD_DAYS * DAY));
  });

  it('已有已过期的到期日 → 从 now 起算（不把新时长埋进过去）', async () => {
    mocks.subscription.findFirst.mockResolvedValue({
      id: 5,
      currentPeriodEnd: BigInt(NOW - 3 * DAY),
    });
    await grantInviteReward(db, 7, INVITE_REWARD_DAYS, NOW);

    const data = mocks.subscription.update.mock.calls[0]![0].data as {
      currentPeriodEnd: bigint;
    };
    expect(data.currentPeriodEnd).toBe(BigInt(NOW + INVITE_REWARD_DAYS * DAY));
  });

  it('🔴 库里的到期日是垃圾值（超大 bigint）→ 当作"没有已付时长"，从 now 起算', async () => {
    mocks.subscription.findFirst.mockResolvedValue({
      id: 5,
      // 超出 Number.MAX_SAFE_INTEGER：转 number 会静默丢精度，
      // 所以 `toEpochMillis` 把它判为"无法确定"，这里就该回落到 now。
      currentPeriodEnd: BigInt('99999999999999999999'),
    });
    await grantInviteReward(db, 7, INVITE_REWARD_DAYS, NOW);

    const data = mocks.subscription.update.mock.calls[0]![0].data as {
      currentPeriodEnd: bigint;
    };
    expect(data.currentPeriodEnd).toBe(BigInt(NOW + INVITE_REWARD_DAYS * DAY));
  });

  it('按 (userId, provider) 找那一行 —— 不是"最新的订阅"', async () => {
    mocks.subscription.findFirst.mockResolvedValue(null);
    await grantInviteReward(db, 7, INVITE_REWARD_DAYS, NOW);

    expect(mocks.subscription.findFirst).toHaveBeenCalledWith({
      where: { userId: 7, provider: INVITE_SUBSCRIPTION_PROVIDER },
      orderBy: { id: 'desc' },
    });
  });
});

describe('settleReferralActivation', () => {
  it('没有待结算的邀请 → NO_REFERRAL，什么都不写', async () => {
    mocks.referral.findUnique.mockResolvedValue(null);
    const outcome = await settleReferralActivation(db, 2, NOW);
    expect(outcome).toEqual({ settled: false, reason: 'NO_REFERRAL' });
    expect(mocks.referral.updateMany).not.toHaveBeenCalled();
    expect(mocks.accountNotification.create).not.toHaveBeenCalled();
  });

  it('🔴 CAS：更新不到那一行（并发第二次）→ ALREADY_SETTLED，且**不发奖、不写通知**', async () => {
    mocks.referral.findUnique.mockResolvedValue({ id: 9, inviterUserId: 100 });
    mocks.referral.updateMany.mockResolvedValue({ count: 0 });

    const outcome = await settleReferralActivation(db, 2, NOW);

    expect(outcome).toEqual({ settled: false, reason: 'ALREADY_SETTLED' });
    expect(mocks.subscription.create).not.toHaveBeenCalled();
    expect(mocks.subscription.update).not.toHaveBeenCalled();
    expect(mocks.accountNotification.create).not.toHaveBeenCalled();
  });

  it('CAS 的条件是 activatedAt 仍为空（幂等的全部依据）', async () => {
    mocks.referral.findUnique.mockResolvedValue({ id: 9, inviterUserId: 100 });
    await settleReferralActivation(db, 2, NOW);

    expect(mocks.referral.updateMany).toHaveBeenCalledWith({
      where: { id: 9, activatedAt: null },
      data: {
        activatedAt: BigInt(NOW),
        rewardDays: INVITE_REWARD_DAYS,
        rewardedAt: BigInt(NOW),
      },
    });
  });

  it('成功 → 发奖 + 写通知，载荷是展示名快照 + 天数', async () => {
    mocks.referral.findUnique.mockResolvedValue({ id: 9, inviterUserId: 100 });
    mocks.subscription.findFirst.mockResolvedValue(null);
    mocks.user.findUnique.mockResolvedValue({ email: 'star@example.com' });

    const outcome = await settleReferralActivation(db, 2, NOW);

    expect(outcome).toEqual({
      settled: true,
      inviterUserId: 100,
      days: INVITE_REWARD_DAYS,
    });
    // 奖发给了**邀请人**，不是被邀请人。
    expect(mocks.subscription.create.mock.calls[0]![0].data.userId).toBe(100);

    const notification = mocks.accountNotification.create.mock.calls[0]![0].data as {
      userId: number;
      kind: string;
      payload: unknown;
      createdAt: bigint;
    };
    expect(notification.userId).toBe(100);
    expect(notification.kind).toBe('referral-activated');
    expect(notification.payload).toEqual({
      displayName: 'star',
      days: INVITE_REWARD_DAYS,
    });
    expect(notification.createdAt).toBe(BigInt(NOW));
  });

  it('🔴 展示名取不到时如实写 null（不在服务端编一个中文名）', async () => {
    mocks.referral.findUnique.mockResolvedValue({ id: 9, inviterUserId: 100 });
    mocks.subscription.findFirst.mockResolvedValue(null);
    mocks.user.findUnique.mockResolvedValue({ email: '@example.com' });

    await settleReferralActivation(db, 2, NOW);

    const notification = mocks.accountNotification.create.mock.calls[0]![0].data as {
      payload: { displayName: unknown };
    };
    expect(notification.payload.displayName).toBeNull();
  });

  it('天数可注入（便于把奖励规则测成确定场景）', async () => {
    mocks.referral.findUnique.mockResolvedValue({ id: 9, inviterUserId: 100 });
    mocks.subscription.findFirst.mockResolvedValue(null);

    const outcome = await settleReferralActivation(db, 2, NOW, 3);

    expect(outcome).toEqual({ settled: true, inviterUserId: 100, days: 3 });
    const data = mocks.subscription.create.mock.calls[0]![0].data as {
      currentPeriodEnd: bigint;
    };
    expect(data.currentPeriodEnd).toBe(BigInt(NOW + 3 * DAY));
  });
});
