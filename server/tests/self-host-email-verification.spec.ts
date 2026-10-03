/**
 * 自托管必须保留"邮箱 + 口令"这条路（产品负责人 2026-10-03 的裁决）
 * ============================================================================
 *
 * 裁决原文的意思拆开是两句：**账号密码登录是主流、必须有**，且**即使用户自托管
 * （给了自己的同步域名、自己的回调域名）也照样是这一条**。第二句在本文件落地之前
 * 是**不成立**的，而它坏在一个没人会当 bug 看的地方：
 *
 *   `isVerified` 是所有登录路的硬前置（`verifyToken` 与 `loginWithEmailPassword`
 *   都因它拒绝，后者更是在**口令校验通过之后**才抛 `email_not_verified`），
 *   而开这道闸的唯一动作是点那封验证邮件里的链接。一台**没配 SMTP** 的服务器于是得到：
 *   注册回一句"请去查收邮件" → 那封信从来没存在过 → 口令永远登录不进。
 *   界面上每一句"去查收"都指向一条不存在的路 —— 与本仓 §6.2 抓过的那类同形。
 *
 * 于是这里钉三件事，缺一不可：
 *   1. `REQUIRE_EMAIL_VERIFICATION=false` 时**当场激活**，且**一个请求都不发**；
 *   2. 信没发出去时响应带 `emailDelivered: false`，而中性文案与状态码**不变**
 *      （变了就成邮箱存在性预言机）；
 *   3. 取值写错**报错**，不静默落到任何一边（与 `ENTITLEMENT_GATE_ENABLED` 同纪律）。
 *
 * ⚠️ 判据的牙齿靠变异证明，不靠阅读 —— 而**这一组需要两个方向各一次变异**才立得住
 *   （2026-10-03 实测，三条各跑一遍，红字都点名了是谁）：
 *   · 把 `emailVerificationRequired` 换成 `config.testMode?.autoVerifyUsers === true`
 *     （忽略开关、**永远不**验证）⇒ 3 红：第 2 组两条 + 第 3 组判点那条。
 *     🔴 第 1 组**不会**红 —— 一台什么都不验证的机器恰好满足"当场激活、一封都不发"。
 *     这条反直觉的结论本身就是要记下来的东西：只往一个方向变异会误判"判据有牙齿"。
 *   · 换成 `config.testMode?.autoVerifyUsers !== true`（忽略开关、**永远要**验证）
 *     ⇒ 3 红：第 1 组两条 + 判点那条。← 这一半才是钉住"开关真的管用"的那刀。
 *   · 把 `auth.ts` 那两处 `emailDelivered: false` 改回只回中性句 ⇒ **恰好** 2 红
 *     （第 2 组两条），其余 7 条不动。
 */

import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';

// Must set JWT_SECRET before auth.ts is imported (top-level getJwtSecret() call).
vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-validation';
});

// Mock prisma —— 形状照 `magic-link-registration.spec.ts`（同一条被委托的路）。
vi.mock('../src/db', () => {
  const mockPrisma = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    passkey: { create: vi.fn(), deleteMany: vi.fn() },
    pendingPasskeyRegistration: { findUnique: vi.fn(), deleteMany: vi.fn() },
    referral: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { prisma: mockPrisma };
});

// 发信是唯一被观测的外部动作：成功/失败两条都由用例自己决定。
vi.mock('../src/email', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(true),
  sendLoginMagicLinkEmail: vi.fn().mockResolvedValue(true),
}));

// 邀请的登记与结算不是本文件的主题（那边有自己的用例），mock 掉以免把事务拖进来。
vi.mock('../src/activity/invite', () => ({
  attachInviteOnRegister: vi.fn().mockResolvedValue(undefined),
  settleReferralActivation: vi
    .fn()
    .mockResolvedValue({ settled: false, reason: 'NO_PENDING' }),
}));

vi.mock('crypto', async () => {
  const actual = await vi.importActual('crypto');
  return {
    ...actual,
    randomBytes: vi.fn().mockReturnValue(Buffer.from('test-token-1234567890'.repeat(3))),
  };
});

vi.mock('@prisma/client', () => {
  class PrismaClientKnownRequestError extends Error {
    code: string;
    constructor(message: string, { code }: { code: string }) {
      super(message);
      this.code = code;
      this.name = 'PrismaClientKnownRequestError';
    }
  }
  return { Prisma: { PrismaClientKnownRequestError } };
});

// `tests/setup.ts` 里有一条全局的 `../src/auth` mock（别的用例要的是它的形状）。
// 本文件测的**就是**这个模块，所以按 `magic-link-registration.spec.ts` 的同一条
// 出路把它换回真实现 —— 少了这三行，取到的是那个 mock，症状是
// "No registerWithMagicLink export is defined on the mock"，而不是任何产品结论。
vi.mock('../src/auth', async (importOriginal) => {
  const actual = await importOriginal();
  return actual;
});

import { prisma } from '../src/db';
import { sendVerificationEmail } from '../src/email';
import { registerWithMagicLink } from '../src/auth';
import { emailVerificationRequired, loadConfigFromEnv } from '../src/config';

const mockPrisma = prisma as unknown as {
  user: { findUnique: Mock; create: Mock; update: Mock; updateMany: Mock };
  pendingPasskeyRegistration: { findUnique: Mock };
  $transaction: Mock;
};
const mockSend = sendVerificationEmail as Mock;

/** 环境快照：本文件的每条用例都会改 `REQUIRE_EMAIL_VERIFICATION`，必须逐条还原。 */
const ENV_SNAPSHOT = { ...process.env };

const setRequireEnv = (value: string | undefined): void => {
  if (value === undefined) delete process.env.REQUIRE_EMAIL_VERIFICATION;
  else process.env.REQUIRE_EMAIL_VERIFICATION = value;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.pendingPasskeyRegistration.findUnique.mockResolvedValue(null);
  mockPrisma.$transaction.mockImplementation(
    async (callback: (tx: unknown) => Promise<unknown>) => callback(mockPrisma),
  );
  mockSend.mockResolvedValue(true);
});

afterEach(() => {
  process.env = { ...ENV_SNAPSHOT };
});

describe('1. REQUIRE_EMAIL_VERIFICATION=false：注册当场可用，且一封都不发', () => {
  beforeEach(() => setRequireEnv('false'));

  it('新账号：不发信、写成 isVerified=1，且**不**带 emailDelivered', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ id: 7 });

    const result = await registerWithMagicLink('self@host.example', Date.now());

    expect(mockSend).not.toHaveBeenCalled();
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'self@host.example' },
        data: expect.objectContaining({ isVerified: 1 }),
      }),
    );
    expect(result.message).toContain('automatically verified');
    // 🔴 这条与"信没发出去"是**两件**事：这里是"根本不需要信"。
    // 把它也标成 emailDelivered:false 会让界面在一台配置正确的自托管服务器上
    // 说出一句"邮件没发出去" —— 那是新造的一个谎。
    expect(result.emailDelivered).toBeUndefined();
  });

  it('已存在但未验证的账号：同样不发信，走同一条激活尾巴', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 9,
      isVerified: 0,
      verificationResendCount: 0,
    });

    const result = await registerWithMagicLink('self@host.example', Date.now());

    expect(mockSend).not.toHaveBeenCalled();
    expect(result.message).toContain('automatically verified');
  });
});

describe('2. 信没发出去：不许再回那句"请去查收邮件"', () => {
  beforeEach(() => setRequireEnv(undefined));

  it('新账号 + 发信失败 ⇒ emailDelivered:false，而 message 仍是那句中性的', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ id: 11 });
    mockSend.mockResolvedValue(false);

    const result = await registerWithMagicLink('nobody@host.example', Date.now());

    expect(result).toEqual({
      message: 'Registration successful. Please check your email to verify your account.',
      emailDelivered: false,
    });
    // 中性文案**没**变：状态码与这句话都不许随"邮箱是否已存在"变化，
    // 否则这个端点就成了邮箱存在性预言机（同文件另一条纪律）。
    expect(mockPrisma.user.create).toHaveBeenCalled();
  });

  it('重发分支（已存在未验证账号）+ 发信失败 ⇒ 同样带 emailDelivered:false', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 12,
      isVerified: 0,
      verificationResendCount: 1,
    });
    mockSend.mockResolvedValue(false);

    const result = await registerWithMagicLink('nobody@host.example', Date.now());

    expect(result.emailDelivered).toBe(false);
    // 发信失败时**不**推进重发计数（旧令牌还有效），这条既有语义要留住。
    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('发信成功时这个字段**不出现**（缺省不是 false）', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ id: 13 });

    const result = await registerWithMagicLink('fine@host.example', Date.now());

    expect('emailDelivered' in result).toBe(false);
  });
});

describe('3. 取值严格 + 判点只有一个', () => {
  it('默认 true：官方托管实例的行为一个字节都没变', () => {
    setRequireEnv(undefined);
    expect(loadConfigFromEnv().requireEmailVerification).toBe(true);
  });

  it("'false' 与 ' FALSE ' 都算关（大小写与空格不敏感）", () => {
    for (const raw of ['false', ' FALSE ']) {
      setRequireEnv(raw);
      expect(loadConfigFromEnv().requireEmailVerification).toBe(false);
    }
  });

  it('写错取值在启动时**报错**，不静默落到任何一边', () => {
    setRequireEnv('no');
    expect(() => loadConfigFromEnv()).toThrow(/Invalid REQUIRE_EMAIL_VERIFICATION/);
  });

  it('判点：夹具与自托管两条理由都算"不需要信"，而默认算"需要"', () => {
    const config = (requireEmail: boolean, autoVerify = false) =>
      ({
        requireEmailVerification: requireEmail,
        ...(autoVerify ? { testMode: { enabled: true, autoVerifyUsers: true } } : {}),
      }) as Parameters<typeof emailVerificationRequired>[0];

    expect(emailVerificationRequired(config(true))).toBe(true);
    expect(emailVerificationRequired(config(false))).toBe(false);
    expect(emailVerificationRequired(config(true, true))).toBe(false);
  });
});
