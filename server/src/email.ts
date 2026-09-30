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
    Logger.warn('No SMTP configuration found. Using Ethereal Email for testing.');
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
