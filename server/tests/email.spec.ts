import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

import { DEFAULT_SMTP_FROM, PRODUCT_NAME } from '../src/config';

const originalEnv = { ...process.env };

const resetEnv = (): void => {
  process.env = { ...originalEnv };
};

/**
 * `sendMail` 必须用 `vi.hoisted` 提升 —— `vi.mock` 的工厂是**提升到文件顶部**执行的，
 * 直接引用下面的 `const` 会拿到未初始化的绑定并抛
 * "Cannot access 'sendMail' before initialization"。
 */
const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));

vi.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail }),
  getTestMessageUrl: () => null,
}));

describe('Email transport configuration', () => {
  beforeEach(() => {
    resetEnv();
    vi.resetModules();
  });

  afterEach(() => {
    resetEnv();
  });

  it('should fail gracefully in production without SMTP configuration', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_URL = 'https://example.com';

    const { sendVerificationEmail } = await import('../src/email');
    const result = await sendVerificationEmail('user@test.com', 'token');
    expect(result).toBe(false);
  });
});

/**
 * 邮件正文的品牌名。
 *
 * 🔴 这一组是为了钉住一次**真实发生过的漂移**：SuperSync → heyta 的改名里
 * `pages.ts` 改到了（用户在邮件里点进去会看到 "logging in to heyta"），
 * 而 `email.ts` **一处都没改** —— 于是同一趟流程里，邮件说 SuperSync、页面说 heyta，
 * 看起来像钓鱼邮件。
 *
 * 断言的是**用户真正读到的三个字段**（subject / text / html）和 from，
 * 而不是源码里有没有某个字面量 —— 后者改了写法就会失效。
 */
describe('邮件必须说 heyta，不能说 SuperSync', () => {
  const SMTP_FROM = 'heyta <noreply@finlaw.cloud>';

  async function sendAllThree(): Promise<void> {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_USER = 'noreply@finlaw.cloud';
    process.env.SMTP_PASS = 'secret';
    process.env.SMTP_FROM = SMTP_FROM;
    process.env.PUBLIC_URL = 'https://heyta.example.com';

    const { sendVerificationEmail, sendPasskeyRecoveryEmail, sendLoginMagicLinkEmail } =
      await import('../src/email');

    sendMail.mockReset();
    sendMail.mockResolvedValue({ messageId: 'test-message-id' });

    expect(await sendVerificationEmail('user@test.com', 'tok')).toBe(true);
    expect(await sendPasskeyRecoveryEmail('user@test.com', 'tok')).toBe(true);
    expect(await sendLoginMagicLinkEmail('user@test.com', 'tok')).toBe(true);
  }

  interface MailOptions {
    from: string;
    subject: string;
    text: string;
    html: string;
  }

  it('三封信都真的发出去了（不是"配置了就算数"）', async () => {
    await sendAllThree();
    expect(sendMail).toHaveBeenCalledTimes(3);
  });

  it('🔴 三个 subject / text / html 里都**不许出现** SuperSync', async () => {
    await sendAllThree();
    for (const call of sendMail.mock.calls) {
      const mail = call[0] as MailOptions;
      for (const field of ['subject', 'text', 'html'] as const) {
        expect(mail[field], `${field} 里还有 SuperSync：${mail[field]}`).not.toContain('SuperSync');
      }
    }
  });

  it('subject 里必须真的出现产品名（不是把品牌删掉了事）', async () => {
    await sendAllThree();
    const subjects = sendMail.mock.calls.map((c) => (c[0] as MailOptions).subject);
    expect(subjects).toHaveLength(3);
    for (const subject of subjects) {
      expect(subject).toContain(PRODUCT_NAME);
    }
    // 三封信的主题各不相同 —— 相同就意味着模板接错了。
    expect(new Set(subjects).size).toBe(3);
  });

  it('From 用配置里的值（真实域名），不是占位符', async () => {
    await sendAllThree();
    for (const call of sendMail.mock.calls) {
      expect((call[0] as MailOptions).from).toBe(SMTP_FROM);
    }
  });

  it('没配 SMTP_FROM 时兜底是 heyta 的占位符，而不是 SuperSync', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '465';
    delete process.env.SMTP_FROM;
    process.env.PUBLIC_URL = 'https://heyta.example.com';

    const { sendLoginMagicLinkEmail } = await import('../src/email');
    sendMail.mockReset();
    sendMail.mockResolvedValue({ messageId: 'test-message-id' });

    await sendLoginMagicLinkEmail('user@test.com', 'tok');

    const mail = sendMail.mock.calls[0]?.[0] as MailOptions;
    expect(mail.from).toBe(DEFAULT_SMTP_FROM);
    expect(mail.from).toContain(PRODUCT_NAME);
    expect(mail.from).not.toContain('SuperSync');
  });

  it('登录链接指向 /magic-login 且 token 带在链接里（邮件唯一真正有用的部分）', async () => {
    await sendAllThree();
    const mail = sendMail.mock.calls[2]?.[0] as MailOptions;
    expect(mail.text).toContain('https://heyta.example.com/magic-login?token=tok');
  });
});
