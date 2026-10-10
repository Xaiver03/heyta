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

/**
 * 邮箱+密码注册的六位验证码。验证码只出现在邮件正文，绝不放入链接或日志；
 * 邮件仍复用统一的 heyta 邮件模板，收件人看到的是明确的下一步而不是一个裸数字。
 */
export const sendEmailPasswordRegistrationCodeEmail = async (
  to: string,
  code: string,
  locale: ServerLocale = DEFAULT_SERVER_LOCALE,
): Promise<boolean> => {
  const config = loadConfigFromEnv();
  const codeSeparator = locale === 'zh-CN' ? '：' : ': ';
  const body = `${t(locale, 'server.email.registerCode.body')}\n\n${t(
    locale,
    'server.email.registerCode.codeLabel',
  )}${codeSeparator}${code}`;

  return deliver({
    to,
    locale,
    subjectKey: 'server.email.registerCode.subject',
    logLabel: 'Email password registration code',
    content: {
      heading: t(locale, 'server.email.registerCode.title'),
      body,
      // The template requires a button. It is only a convenience link back to the
      // app; the code remains the sole credential for this challenge.
      buttonLabel: t(locale, 'server.email.login.button'),
      url: `${config.publicUrl}/app/`,
      note: `${t(locale, 'server.email.registerCode.expiry')}\n${t(
        locale,
        'server.email.registerCode.ignore',
      )}`,
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

/**
 * 第 6 封：**换绑请求 · 发给新邮箱**（确认这个收件箱归你管）。
 *
 * 它是双侧确认的两半之一（`account/email-change.ts` 文件头写了为什么"新邮箱确认 +
 * 旧邮箱只通知"那种常见形状在这里不够）。有效期 24 h，与"验证邮箱"同一条理由：
 * 这一半做的**就是**证明收件箱可控，所以它继承同一个窗口，而不是新拍一个数。
 */
export const sendEmailChangeConfirmEmail = async (
  to: string,
  token: string,
  locale: ServerLocale = DEFAULT_SERVER_LOCALE,
): Promise<boolean> => {
  const config = loadConfigFromEnv();
  const url = withLocale(`${config.publicUrl}/change-email?token=${token}`, locale);

  return deliver({
    to,
    locale,
    subjectKey: 'server.email.changeConfirm.subject',
    logLabel: 'Email change confirm email',
    content: {
      heading: t(locale, 'server.email.changeConfirm.title'),
      body: t(locale, 'server.email.changeConfirm.body'),
      buttonLabel: t(locale, 'server.email.changeConfirm.button'),
      url,
      note: t(locale, 'server.email.changeConfirm.expiry'),
    },
  });
};

/**
 * 第 7 封：**换绑请求 · 发给当前邮箱**（授权这一次变更）。
 *
 * 🔴 正文里必须带上**要换成哪个地址**（`{email}` 插值）。一句"有人请求换绑你的账号"
 * 而不说换成什么，等于让人在看不见内容的情况下签一张授权 —— 那一半确认就没有意义了。
 * 这个值来自用户输入，而 `renderEmail` 对 `body` 整串 `escapeHtml` ⇒ 注入面在渲染层被关掉；
 * **不要**绕过那两个函数把它拼进 HTML。
 */
export const sendEmailChangeAuthorizeEmail = async (
  to: string,
  token: string,
  newEmail: string,
  locale: ServerLocale = DEFAULT_SERVER_LOCALE,
): Promise<boolean> => {
  const config = loadConfigFromEnv();
  const url = withLocale(`${config.publicUrl}/change-email?token=${token}`, locale);

  return deliver({
    to,
    locale,
    subjectKey: 'server.email.changeAuthorize.subject',
    logLabel: 'Email change authorize email',
    content: {
      heading: t(locale, 'server.email.changeAuthorize.title'),
      body: t(locale, 'server.email.changeAuthorize.body', { email: newEmail }),
      buttonLabel: t(locale, 'server.email.changeAuthorize.button'),
      url,
      note: t(locale, 'server.email.changeAuthorize.warning'),
    },
  });
};

/**
 * 第 8 封：**换绑已完成**（发给旧地址与新地址各一封）。
 *
 * 它与 `passwordChanged` 同一族：只在**已经改完之后**发、失败**不抛出**（改都改了，
 * 因为一封通知发不出去把成功报成失败，会让人再发起一次、然后撞上冷却窗口）。
 * 旧地址那一封是这里面更要紧的：**如果那不是本人，那是他唯一能知道的方式。**
 */
export const sendEmailChangedEmail = async (
  to: string,
  locale: ServerLocale = DEFAULT_SERVER_LOCALE,
): Promise<boolean> => {
  const config = loadConfigFromEnv();
  const url = withLocale(`${config.publicUrl}/app/`, locale);

  return deliver({
    to,
    locale,
    subjectKey: 'server.email.changed.subject',
    logLabel: 'Email changed notice',
    content: {
      heading: t(locale, 'server.email.changed.title'),
      body: t(locale, 'server.email.changed.body'),
      buttonLabel: t(locale, 'server.email.changed.button'),
      url,
      note: t(locale, 'server.email.changed.notYou'),
    },
  });
};

/**
 * 第 9 封：**账号新增了一种登录方式**（工单 W6，兑现 `email-password-auth.md` 缺口 13）。
 *
 * 🔴 这一封存在的理由是那条缺口原文：拿到一枚有效会话的人可以先给账号加一个**他自己知道的**
 * 口令作为持久入口，而原主**一个字都收不到**。"加一个认证器"不是换一把钥匙，它是**多开一扇门**，
 * 而多开一扇门这件事，门的另一面必须有人知道。
 *
 * 两个调用点：`/password/set`（加上第一个口令）与 `/passkeys/registration/complete`（加一条通行密钥）。
 * 与 `passwordChanged` 同一条纪律：只在成功之后发、失败不抛出、不承诺收件人可以"撤回"这次添加
 * （撤回得回到应用里做，一封邮件里的按钮不该有那个权力）。
 */
export const sendAuthenticatorAddedEmail = async (
  to: string,
  kind: 'password' | 'passkey',
  locale: ServerLocale = DEFAULT_SERVER_LOCALE,
): Promise<boolean> => {
  const config = loadConfigFromEnv();
  const url = withLocale(`${config.publicUrl}/app/`, locale);

  return deliver({
    to,
    locale,
    subjectKey:
      kind === 'password'
        ? 'server.email.authenticatorAdded.password.subject'
        : 'server.email.authenticatorAdded.passkey.subject',
    logLabel: `Authenticator-added notice (${kind})`,
    content: {
      heading: t(locale, 'server.email.authenticatorAdded.title'),
      body: t(
        locale,
        kind === 'password'
          ? 'server.email.authenticatorAdded.password.body'
          : 'server.email.authenticatorAdded.passkey.body',
      ),
      buttonLabel: t(locale, 'server.email.authenticatorAdded.button'),
      url,
      note: t(locale, 'server.email.authenticatorAdded.notYou'),
    },
  });
};
