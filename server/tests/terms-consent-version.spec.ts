/**
 * 同意留痕的**版本**那一列（链 3）。
 * ==================================
 *
 * 钉的是三件事，每件都对应一个"看起来能过"的失效形状：
 *
 * 1. **判给官方托管实例才写版本**（`isOfficialHostedInstance`）。
 *    自托管机器对外发布的是运营者自己的文本，给它盖上 heyta 的版本号，
 *    数据库里就躺着一句替别人作出的承诺 —— 而三年后它会被当成证据读。
 * 2. **时刻与版本成对**。有时间戳没版本 = 对外文本那句"记下一整套版本指纹"没兑现；
 *    有版本没时间戳 = 一条比两列都空更误导人的记录。
 * 3. 🔴 **客户端没勾 ⇒ 数据库没有任何同意记录**（`docs/plans/legal-compliance-before-filing.md`
 *    §6 第 5 条要的回归）。这条是"不得发明同意"的机器版本。
 *
 * 老账号（迁移前已有的行）**不在这里测**，由
 * `terms-version-migration.pglite.spec.ts` 在真实 SQL 上测 —— 回填发生在迁移里，
 * 不在应用代码里，拿 mock 测它等于测了一个不存在的凶手。
 */

import { afterEach, beforeEach, describe, expect, it, vi, Mock } from 'vitest';

// 必须在 import auth.ts 之前设好（模块顶层就有 getJwtSecret()）。
vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-validation';
});

/**
 * 邮箱+口令那个注册入口要先过策略、再哈希，才委托给 `registerWithMagicLink`。
 * 这两步与"同意留痕"无关（本文件的靶子是留痕），所以把它们换成快的假实现：
 * 真 Argon2 会让这条用例去依赖 pepper 与后端自检，而那些由 `password-auth-flow.spec.ts`
 * 与启动自检各自负责。**只换这两个模块，`../src/auth` 仍是真模块**（见下面那条 mock）。
 */
const hashSpies = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  needsRehash: vi.fn(),
  dummyVerify: vi.fn(),
}));
const policySpies = vi.hoisted(() => ({ checkNewPassword: vi.fn() }));

vi.mock('../src/password/hash', () => hashSpies);
vi.mock('../src/password/policy', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ...policySpies };
});

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
    referral: { findUnique: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma: mockPrisma };
});

vi.mock('../src/email', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(true),
  sendLoginMagicLinkEmail: vi.fn().mockResolvedValue(true),
}));

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

// setup.ts 全局 mock 了 ../src/auth；这里要用真模块。
vi.mock('../src/auth', async (importOriginal) => await importOriginal());

import { prisma } from '../src/db';
import { registerWithMagicLink } from '../src/auth';
import { registerWithEmailPassword } from '../src/password/service';
import { consentedLegalSetVersion, isOfficialHostedInstance } from '../src/legal-consent';
import { LEGAL_SET_VERSION, OFFICIAL_HOSTED_DOMAIN } from '../src/legal.generated';

const mockPrisma = prisma as unknown as {
  user: { findUnique: Mock; create: Mock; updateMany: Mock };
  referral: { findUnique: Mock };
  $transaction: Mock;
};

/** 造一个"这台实例的公网地址"的环境，然后调用**同步**被测函数。 */
const withPublicUrl = <T>(publicUrl: string, run: () => T): T => {
  const previous = process.env.PUBLIC_URL;
  process.env.PUBLIC_URL = publicUrl;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_URL;
    else process.env.PUBLIC_URL = previous;
  }
};

/**
 * ⚠️ 异步用例**不能**用上面那个包装：`registerWithMagicLink` 在 `await` 之后才读
 * `loadConfigFromEnv()`，届时包装的 finally 已经把变量还原了 —— 测的会是上一个用例的地址。
 * 所以异步用例直接赋值，由下面的 afterEach 统一还原。
 */
const setPublicUrl = (publicUrl: string): void => {
  process.env.PUBLIC_URL = publicUrl;
};

const PUBLIC_URL_BEFORE_EVERYTHING = process.env.PUBLIC_URL;

afterEach(() => {
  if (PUBLIC_URL_BEFORE_EVERYTHING === undefined) delete process.env.PUBLIC_URL;
  else process.env.PUBLIC_URL = PUBLIC_URL_BEFORE_EVERYTHING;
});

const createData = (): Record<string, unknown> =>
  (mockPrisma.user.create.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;

const updateManyData = (): Record<string, unknown> =>
  (mockPrisma.user.updateMany.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;

describe('legal-consent：这台实例有没有资格写版本号', () => {
  it('官方托管域 ⇒ 写整套版本指纹', () => {
    expect(
      withPublicUrl(`https://${OFFICIAL_HOSTED_DOMAIN}`, consentedLegalSetVersion),
    ).toBe(LEGAL_SET_VERSION);
  });

  it('别的域名 ⇒ null（运营者的文本不由我们命名版本）', () => {
    expect(withPublicUrl('https://sync.example.com', consentedLegalSetVersion)).toBeNull();
    // 我们自己留着做回滚路径的旧域名同样不是"官方托管域"，客户端上它给用户的
    // 也是 `<baseUrl>/privacy.html`（app-host 的分流），两头必须一致。
    expect(withPublicUrl('https://heyta.finlaw.cloud', consentedLegalSetVersion)).toBeNull();
  });

  it('localhost / 缺失 / 坏掉的 URL ⇒ null（fail-closed）', () => {
    expect(withPublicUrl('http://localhost:1900', consentedLegalSetVersion)).toBeNull();
    expect(isOfficialHostedInstance('not a url')).toBe(false);
    expect(isOfficialHostedInstance('')).toBe(false);
  });

  it('🔴 兄弟域名不算官方：逐字相等，不是前缀或 includes', () => {
    expect(isOfficialHostedInstance(`https://${OFFICIAL_HOSTED_DOMAIN}.evil.net`)).toBe(false);
    expect(isOfficialHostedInstance(`https://evil.${OFFICIAL_HOSTED_DOMAIN}`)).toBe(false);
    expect(isOfficialHostedInstance(`https://not-${OFFICIAL_HOSTED_DOMAIN}`)).toBe(false);
  });

  it('主机名大小写不敏感（DNS 不区分大小写）', () => {
    expect(isOfficialHostedInstance(`https://${OFFICIAL_HOSTED_DOMAIN.toUpperCase()}`)).toBe(true);
  });

  it('带端口与尾斜杠仍认得出是官方实例', () => {
    expect(isOfficialHostedInstance(`https://${OFFICIAL_HOSTED_DOMAIN}/`)).toBe(true);
    expect(isOfficialHostedInstance(`https://${OFFICIAL_HOSTED_DOMAIN}:8443/app`)).toBe(true);
  });
});

describe('注册写库：时刻与版本必须成对', () => {
  const testEmail = 'consent@example.test';

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ id: 1, email: testEmail, isVerified: 0 });
    mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.referral.findUnique.mockResolvedValue(null);
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => callback(mockPrisma),
    );
  });

  it('🔴 客户端没勾 ⇒ 两列都是空（没有"发明同意"的余地）', async () => {
    setPublicUrl(`https://${OFFICIAL_HOSTED_DOMAIN}`);
    await registerWithMagicLink(testEmail);

    const data = createData();
    expect(data.termsAcceptedAt).toBeNull();
    expect(data.termsDocumentVersion).toBeNull();
  });

  it('勾了 + 官方托管实例 ⇒ 时间与整套版本指纹一起落库', async () => {
    setPublicUrl(`https://${OFFICIAL_HOSTED_DOMAIN}`);
    await registerWithMagicLink(testEmail, 1_700_000_000_000);

    const data = createData();
    expect(data.termsAcceptedAt).toBe(1_700_000_000_000n);
    expect(data.termsDocumentVersion).toBe(LEGAL_SET_VERSION);
  });

  it('勾了 + 自建实例 ⇒ 只有时间，版本是 null', async () => {
    setPublicUrl('https://sync.example.com');
    await registerWithMagicLink(testEmail, 1_700_000_000_000);

    const data = createData();
    expect(data.termsAcceptedAt).toBe(1_700_000_000_000n);
    expect(data.termsDocumentVersion).toBeNull();
  });

  it('🔴 第三个注册入口（邮箱+口令）也成对 —— 它靠**委托**，不靠自己也写一遍', async () => {
    // `registerWithEmailPassword` 里没有一个字提到版本：它校验策略、哈希口令，然后把
    // `termsAcceptedAt` **原样交给** `registerWithMagicLink`。所以"成对"这件事在这条路上
    // 成立的唯一理由是那条委托。把委托换成自己建号（service.ts 文件头明令禁止的那种复制）
    // 时，这条用例会红 —— 这就是它存在的意义。
    setPublicUrl(`https://${OFFICIAL_HOSTED_DOMAIN}`);
    policySpies.checkNewPassword.mockImplementation(async (raw: string) => ({
      ok: true,
      normalized: raw.normalize('NFC').normalize('NFKC'),
    }));
    hashSpies.hashPassword.mockResolvedValue(
      '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$Q2xpZW50U2lnbmF0dXJlT2ZUaGVUZXN0',
    );

    await registerWithEmailPassword({
      email: testEmail,
      password: 'a-passphrase-that-is-long-enough',
      termsAcceptedAt: 1_700_000_000_000,
    });

    const data = createData();
    expect(data.termsAcceptedAt).toBe(1_700_000_000_000n);
    expect(data.termsDocumentVersion).toBe(LEGAL_SET_VERSION);
  });

  it('🔴 同一个入口没勾 ⇒ 两列仍然都空（委托没有把"没同意"读成"同意过"）', async () => {
    setPublicUrl(`https://${OFFICIAL_HOSTED_DOMAIN}`);
    policySpies.checkNewPassword.mockImplementation(async (raw: string) => ({
      ok: true,
      normalized: raw.normalize('NFC').normalize('NFKC'),
    }));
    hashSpies.hashPassword.mockResolvedValue(
      '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$Q2xpZW50U2lnbmF0dXJlT2ZUaGVUZXN0',
    );

    await registerWithEmailPassword({
      email: testEmail,
      password: 'a-passphrase-that-is-long-enough',
    });

    const data = createData();
    expect(data.termsAcceptedAt).toBeNull();
    expect(data.termsDocumentVersion).toBeNull();
  });

  it('版本指纹是**整套**而不是一份：形状由真源保证', () => {
    // 对外文本承诺的是"当时每一份对外文本的版本号一起钉住"，所以一列里必须
    // 出现不止一份文档。真源删到只剩一份时，这条会红 —— 那时该改的是条款文本。
    expect(LEGAL_SET_VERSION.split(';').length).toBeGreaterThan(1);
    expect(LEGAL_SET_VERSION).toContain('terms@');
    expect(LEGAL_SET_VERSION).toContain('privacy@');
  });

  it('存量未激活账号重发验证邮件：带了同意就把时刻与版本一起钉上', async () => {
    setPublicUrl(`https://${OFFICIAL_HOSTED_DOMAIN}`);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 7,
      email: testEmail,
      isVerified: 0,
      verificationResendCount: 0,
    });

    await registerWithMagicLink(testEmail, 1_700_000_000_000);

    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    const data = updateManyData();
    expect(data.termsAcceptedAt).toBe(1_700_000_000_000n);
    expect(data.termsDocumentVersion).toBe(LEGAL_SET_VERSION);
  });

  it('🔴 重发（没带同意）时**整对键都不出现** —— 不是写成 null 覆盖掉上一次那条', async () => {
    setPublicUrl(`https://${OFFICIAL_HOSTED_DOMAIN}`);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 7,
      email: testEmail,
      isVerified: 0,
      verificationResendCount: 0,
    });

    await registerWithMagicLink(testEmail);

    const resend = updateManyData();
    expect('termsAcceptedAt' in resend).toBe(false);
    expect('termsDocumentVersion' in resend).toBe(false);
  });
});
