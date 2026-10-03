import * as nodemailer from 'nodemailer';
import { Logger } from './logger';
import { DEFAULT_SMTP_FROM, loadConfigFromEnv } from './config';
import {
  DEFAULT_SERVER_LOCALE,
  renderEmail,
  renderEmailText,
  t,
  type EmailContent,
} from './design-html.js';
import type { ServerCopyKey, ServerLocale } from './copy.generated.js';

let transporter: nodemailer.Transporter | null = null;

const getTransporter = async (): Promise<nodemailer.Transporter> => {
  if (transporter) return transporter;

  const config = loadConfigFromEnv();

  if (config.smtp) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user
        ? {
            user: config.smtp.user,
            pass: config.smtp.pass,
          }
        : undefined,
    });
    Logger.info(`SMTP configured: ${config.smtp.host}:${config.smtp.port}`);
  } else {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SMTP configuration is required in production environments');
    }

    // Fallback to Ethereal for development if no SMTP config
    //
    // 🔴 这条兜底是**故意留给开发**的（`scripts/verify-password-web-journey.mjs`
    // 就是靠抓下面那行 `Preview URL:` 来证明"那封信真的存在"），但它对自托管者
    // 是一件事关隐私的取舍：**验证链接里带着一个可用的账号令牌，而它会被寄到
    // 第三方（ethereal.email）的公开预览页上**，谁拿到那个 URL 谁就能激活账号。
    // 所以这里把话说在前面，而不是等人去翻文档：
    // 生产要么配 SMTP，要么显式 `REQUIRE_EMAIL_VERIFICATION=false`（见 env.example）。
    Logger.warn(
      'No SMTP configuration found. Using Ethereal Email for testing — ' +
        'verification links (containing live account tokens) will be readable by anyone ' +
        'holding the preview URL below. Configure SMTP, or set ' +
        'REQUIRE_EMAIL_VERIFICATION=false, for any real deployment.',
    );
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    Logger.info(`Ethereal Email configured: ${testAccount.user}`);
  }

  return transporter;
};

/** 测试用：丢掉缓存的 transporter（改了 SMTP 配置之后必须重建）。 */
export const __resetMailTransporterForTests = (): void => {
  transporter = null;
};

/**
 * 把语言写进链接。
 *
 * 🔴 **为什么值得单独做这件事**：邮件是**为收件人**渲染的，而收件人点开链接时
 * 用的浏览器语言未必等于他注册时用的语言（在英文系统里注册的中文用户就是典型）。
 * 语言随链接一起走，收件人看到的就是**发信那一刻**他该看到的语言。
 */
const withLocale = (link: string, locale: ServerLocale): string => {
  const separator = link.includes('?') ? '&' : '?';
  return `${link}${separator}lang=${locale}`;
};

/** 三封邮件共用的发送流程：渲染 → 发信 → 记日志（含 Ethereal 预览地址）。 */
async function deliver(options: {
  to: string;
  locale: ServerLocale;
  subjectKey: ServerCopyKey;
  content: Omit<EmailContent, 'title'>;
  logLabel: string;
}): Promise<boolean> {
  try {
    const mailTransporter = await getTransporter();
    const config = loadConfigFromEnv();
    const from = config.smtp?.from || DEFAULT_SMTP_FROM;
    const { locale } = options;

    const subject = t(locale, options.subjectKey);
    const content: EmailContent = { ...options.content, title: subject };

    const info = await mailTransporter.sendMail({
      from,
      to: options.to,
      subject,
      text: renderEmailText(locale, content),
      html: renderEmail(locale, content),
    });

    Logger.info(`${options.logLabel} sent [${locale}]: ${info.messageId}`);

    // If using Ethereal, log the preview URL
    const preview = nodemailer.getTestMessageUrl(info);
    if (preview) {
      Logger.info(`Preview URL: ${preview}`);
    }

    return true;
  } catch (err) {
    Logger.error(`Failed to send ${options.logLabel}:`, err);
    return false;
  }
}

/**
 * 验证邮件。
 *
 * `locale` 由调用方（注册接口）传入 —— 取不到时**默认中文**，
 * 与 `resolveLocale()` 的兜底一致。
 */
export const sendVerificationEmail = async (
  to: string,
  token: string,
  locale: ServerLocale = DEFAULT_SERVER_LOCALE,
): Promise<boolean> => {
  const config = loadConfigFromEnv();
  const url = withLocale(`${config.publicUrl}/verify-email?token=${token}`, locale);

  return deliver({
    to,
    locale,
    subjectKey: 'server.email.verify.subject',
    logLabel: 'Verification email',
    content: {
      heading: t(locale, 'server.email.verify.title'),
      body: t(locale, 'server.email.verify.body'),
      buttonLabel: t(locale, 'server.email.verify.button'),
      url,
      note: t(locale, 'server.email.verify.expiry'),
    },
  });
};

export const sendPasskeyRecoveryEmail = async (
  to: string,
  token: string,
  locale: ServerLocale = DEFAULT_SERVER_LOCALE,
): Promise<boolean> => {
  const config = loadConfigFromEnv();
  const url = withLocale(`${config.publicUrl}/recover-passkey?token=${token}`, locale);

  return deliver({
    to,
    locale,
    subjectKey: 'server.email.recover.subject',
    logLabel: 'Passkey recovery email',
    content: {
      heading: t(locale, 'server.email.recover.title'),
      body: t(locale, 'server.email.recover.body'),
      buttonLabel: t(locale, 'server.email.recover.button'),
      url,
      note: `${t(locale, 'server.email.recover.ignore')}\n${t(locale, 'server.email.recover.expiry')}`,
    },
  });
};

export const sendLoginMagicLinkEmail = async (
  to: string,
  token: string,
  locale: ServerLocale = DEFAULT_SERVER_LOCALE,
): Promise<boolean> => {
  const config = loadConfigFromEnv();
  const url = withLocale(`${config.publicUrl}/magic-login?token=${token}`, locale);

  return deliver({
    to,
    locale,
    subjectKey: 'server.email.login.subject',
    logLabel: 'Magic link login email',
    content: {
      heading: t(locale, 'server.email.login.title'),
      body: t(locale, 'server.email.login.body'),
      buttonLabel: t(locale, 'server.email.login.button'),
      url,
      note: `${t(locale, 'server.email.login.ignore')}\n${t(locale, 'server.email.login.expiry')}`,
    },
  });
};

/**
 * 第 4 封：**口令重置链接**。
 *
 * 有效期那句话写"15 分钟"而不是抄 `PASSWORD_RESET_TTL_MS` —— 它是给人读的文案，
 * 由 i18n 词条钉住；两处不一致时门禁不会红，但用户会按邮件里的时间等。
 * ⚠️ 改 TTL 记得同时改 `server.email.reset.expiry`。
 */
export const sendPasswordResetEmail = async (
  to: string,
  token: string,
  locale: ServerLocale = DEFAULT_SERVER_LOCALE,
): Promise<boolean> => {
  const config = loadConfigFromEnv();
  const url = withLocale(`${config.publicUrl}/reset-password?token=${token}`, locale);

  return deliver({
    to,
    locale,
    subjectKey: 'server.email.reset.subject',
    logLabel: 'Password reset email',
    content: {
      heading: t(locale, 'server.email.reset.title'),
      body: t(locale, 'server.email.reset.body'),
      buttonLabel: t(locale, 'server.email.reset.button'),
      url,
      note: `${t(locale, 'server.email.reset.ignore')}\n${t(locale, 'server.email.reset.expiry')}`,
    },
  });
};

/**
 * 第 5 封：**口令已被更改的安全通知**（计划 §3 那条"发安全通知邮件"）。
 *
 * 它与前四封唯一的不同是**没有令牌** —— 按钮只是回到应用登录。
 * 🔴 这封存在的理由不是礼貌：口令被改成功时，如果那不是本人，他唯一能知道的方式
 * 就是这一封邮件。所以它**只在成功之后发**（失败的尝试不发信 —— 那会让这变成
 * 一个骚扰他人的接口，也顺带告诉攻击者"这个邮箱有账号"）。
 */
export const sendPasswordChangedEmail = async (
  to: string,
  locale: ServerLocale = DEFAULT_SERVER_LOCALE,
): Promise<boolean> => {
  const config = loadConfigFromEnv();
  const url = withLocale(`${config.publicUrl}/app/`, locale);

  return deliver({
    to,
    locale,
    subjectKey: 'server.email.passwordChanged.subject',
    logLabel: 'Password changed notice',
    content: {
      heading: t(locale, 'server.email.passwordChanged.title'),
      body: t(locale, 'server.email.passwordChanged.body'),
      buttonLabel: t(locale, 'server.email.passwordChanged.button'),
      url,
      note: t(locale, 'server.email.passwordChanged.notYou'),
    },
  });
};
