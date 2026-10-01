/**
 * 服务端（邮件 / 凭据页）用的文案快照 —— **自动生成，请勿手改**。
 *
 * 唯一事实源：`packages/i18n/src/locales/{zh-CN,en}.ts`（与客户端同一份词条表）
 * 重新生成：`pnpm --filter @heyta/sync-server gen:server-copy`
 * 校验漂移：`pnpm check:server-copy`（已接进 `pnpm check`）
 *
 * 🔴 只搬 `server.` 前缀的词条。**不要在这里手写第二份文案。**
 */

export const SERVER_LOCALES = ["zh-CN", "en"] as const;

export type ServerLocale = (typeof SERVER_LOCALES)[number];

/** 服务端可用词条的 key 联合类型（拼错是编译期错误）。 */
export type ServerCopyKey =
  | "server.email.common.autoNote"
  | "server.email.common.fallbackIntro"
  | "server.email.common.tagline"
  | "server.email.login.body"
  | "server.email.login.button"
  | "server.email.login.expiry"
  | "server.email.login.ignore"
  | "server.email.login.subject"
  | "server.email.login.title"
  | "server.email.passwordChanged.body"
  | "server.email.passwordChanged.button"
  | "server.email.passwordChanged.notYou"
  | "server.email.passwordChanged.subject"
  | "server.email.passwordChanged.title"
  | "server.email.recover.body"
  | "server.email.recover.button"
  | "server.email.recover.expiry"
  | "server.email.recover.ignore"
  | "server.email.recover.subject"
  | "server.email.recover.title"
  | "server.email.reset.body"
  | "server.email.reset.button"
  | "server.email.reset.expiry"
  | "server.email.reset.ignore"
  | "server.email.reset.subject"
  | "server.email.reset.title"
  | "server.email.verify.body"
  | "server.email.verify.button"
  | "server.email.verify.expiry"
  | "server.email.verify.subject"
  | "server.email.verify.title"
  | "server.page.confirm.body"
  | "server.page.confirm.button"
  | "server.page.confirm.heading"
  | "server.page.confirm.title"
  | "server.page.confirm.verifiedOnly"
  | "server.page.error.unknown"
  | "server.page.login.again"
  | "server.page.login.body"
  | "server.page.login.busy"
  | "server.page.login.button"
  | "server.page.login.error"
  | "server.page.login.heading"
  | "server.page.login.success"
  | "server.page.login.title"
  | "server.page.recover.body"
  | "server.page.recover.busy"
  | "server.page.recover.button"
  | "server.page.recover.error"
  | "server.page.recover.heading"
  | "server.page.recover.success"
  | "server.page.recover.title"
  | "server.page.recover.verifying"
  | "server.page.recover.waiting"
  | "server.page.reset.body"
  | "server.page.reset.breached"
  | "server.page.reset.busy"
  | "server.page.reset.button"
  | "server.page.reset.confirmLabel"
  | "server.page.reset.goLogin"
  | "server.page.reset.heading"
  | "server.page.reset.hide"
  | "server.page.reset.hint"
  | "server.page.reset.invalidLink"
  | "server.page.reset.locked"
  | "server.page.reset.mismatch"
  | "server.page.reset.newLabel"
  | "server.page.reset.reveal"
  | "server.page.reset.success"
  | "server.page.reset.title"
  | "server.page.reset.tooCommon"
  | "server.page.reset.tooLong"
  | "server.page.reset.tooShort"
  | "server.page.reset.unavailable"
  | "server.page.tokenRequired"
  | "server.page.verify.action"
  | "server.page.verify.body"
  | "server.page.verify.failedBody"
  | "server.page.verify.failedTitle"
  | "server.page.verify.heading"
  | "server.page.verify.title"
  ;

/** 按语言分开的词条表。 */
export const SERVER_COPY: Record<ServerLocale, Record<ServerCopyKey, string>> = {
  "zh-CN": {
    "server.email.common.autoNote": "这封邮件由系统自动发送，请勿直接回复。",
    "server.email.common.fallbackIntro": "如果按钮点不动，请把下面的链接复制到浏览器打开：",
    "server.email.common.tagline": "本地优先的任务与习惯管理",
    "server.email.login.body": "点击下面的按钮完成登录。",
    "server.email.login.button": "登录",
    "server.email.login.expiry": "这个链接 15 分钟内有效。",
    "server.email.login.ignore": "如果这不是你本人发起的，忽略这封邮件即可。",
    "server.email.login.subject": "你的 heyta 登录链接",
    "server.email.login.title": "登录 heyta",
    "server.email.passwordChanged.body": "你的 heyta 账号刚刚设置了新的登录密码，其他设备上的登录都已失效。",
    "server.email.passwordChanged.button": "打开 heyta",
    "server.email.passwordChanged.notYou": "如果这不是你本人操作的，请立刻用「忘记密码」重新拿回账号，并确认你的邮箱有没有被别人读到。",
    "server.email.passwordChanged.subject": "你的 heyta 登录密码已被更改",
    "server.email.passwordChanged.title": "登录密码已更改",
    "server.email.recover.body": "你申请了恢复通行密钥。点击下面的按钮，为账号注册一个新的通行密钥——它会替换掉原来那一个。",
    "server.email.recover.button": "注册新通行密钥",
    "server.email.recover.expiry": "这个链接 1 小时内有效。",
    "server.email.recover.ignore": "如果这不是你本人发起的，忽略这封邮件即可，你的账号不会有任何变化。",
    "server.email.recover.subject": "恢复你的 heyta 通行密钥",
    "server.email.recover.title": "通行密钥恢复",
    "server.email.reset.body": "你申请了重置登录密码。点击下面的按钮设置一个新密码 —— 设置成功后，其他设备上的登录都会失效。",
    "server.email.reset.button": "设置新密码",
    "server.email.reset.expiry": "这个链接 15 分钟内有效，且只能使用一次。",
    "server.email.reset.ignore": "如果这不是你本人发起的，忽略这封邮件即可，你的密码不会有任何变化。",
    "server.email.reset.subject": "重置你的 heyta 登录密码",
    "server.email.reset.title": "重置登录密码",
    "server.email.verify.body": "请点击下面的按钮验证你的邮箱，完成账号注册。",
    "server.email.verify.button": "验证邮箱",
    "server.email.verify.expiry": "这个链接 24 小时内有效。",
    "server.email.verify.subject": "验证你的 heyta 账号",
    "server.email.verify.title": "欢迎使用 heyta",
    "server.page.confirm.body": "点击下面的按钮完成验证。",
    "server.page.confirm.button": "完成验证",
    "server.page.confirm.heading": "完成邮箱验证",
    "server.page.confirm.title": "完成邮箱验证",
    "server.page.confirm.verifiedOnly": "邮箱已验证。请用你的通行密钥登录。",
    "server.page.error.unknown": "出了点问题，请稍后重试。",
    "server.page.login.again": "重新申请登录链接",
    "server.page.login.body": "点击下面的按钮，完成这次登录。",
    "server.page.login.busy": "正在登录…",
    "server.page.login.button": "登录",
    "server.page.login.error": "登录失败，请重新申请一个登录链接。",
    "server.page.login.heading": "完成登录",
    "server.page.login.success": "登录成功，正在跳转…",
    "server.page.login.title": "完成登录",
    "server.page.recover.body": "点击下面的按钮，为你的账号注册一个新的通行密钥。它会替换掉原来那一个。",
    "server.page.recover.busy": "正在准备…",
    "server.page.recover.button": "注册新通行密钥",
    "server.page.recover.error": "操作失败，请重试。",
    "server.page.recover.heading": "恢复你的通行密钥",
    "server.page.recover.success": "通行密钥已重新注册，现在可以回到应用登录了。",
    "server.page.recover.title": "恢复通行密钥",
    "server.page.recover.verifying": "正在验证…",
    "server.page.recover.waiting": "请在系统弹窗中完成验证…",
    "server.page.reset.body": "为你的账号设置一个新密码。设置成功后，其他设备上的登录都会失效，你需要用新密码重新登录。",
    "server.page.reset.breached": "这个密码出现在已泄露的密码库里，请换一个。",
    "server.page.reset.busy": "正在保存…",
    "server.page.reset.button": "保存新密码",
    "server.page.reset.confirmLabel": "再输一次新密码",
    "server.page.reset.goLogin": "去登录",
    "server.page.reset.heading": "设置新登录密码",
    "server.page.reset.hide": "隐藏",
    "server.page.reset.hint": "至少 8 个字符。用一句只有你记得住的话，比加符号更难猜。",
    "server.page.reset.invalidLink": "这个链接无效、已过期，或者已经被用过了。请重新申请一封邮件。",
    "server.page.reset.locked": "尝试次数太多了，请稍后再试。",
    "server.page.reset.mismatch": "两次输入的密码不一致。",
    "server.page.reset.newLabel": "新密码",
    "server.page.reset.reveal": "显示",
    "server.page.reset.success": "密码已重置。请用新密码登录。",
    "server.page.reset.title": "设置新登录密码",
    "server.page.reset.tooCommon": "这个密码太常见了，请换一个与你不相关的。",
    "server.page.reset.tooLong": "密码太长了，最多 256 个字符。",
    "server.page.reset.tooShort": "密码至少要有 8 个字符。",
    "server.page.reset.unavailable": "服务器正忙，请稍后重试。",
    "server.page.tokenRequired": "链接不完整：缺少必要的令牌。",
    "server.page.verify.action": "返回并登录",
    "server.page.verify.body": "你的账号已经可以正常使用了。",
    "server.page.verify.failedBody": "这个验证链接无效或已经过期。请重新注册，或申请一封新的验证邮件。",
    "server.page.verify.failedTitle": "验证失败",
    "server.page.verify.heading": "邮箱验证成功",
    "server.page.verify.title": "邮箱已验证",
  },
  "en": {
    "server.email.common.autoNote": "This email was sent automatically. Please do not reply.",
    "server.email.common.fallbackIntro": "If the button does not work, copy this link into your browser:",
    "server.email.common.tagline": "Local-first tasks and habits",
    "server.email.login.body": "Click the button below to finish signing in.",
    "server.email.login.button": "Sign in",
    "server.email.login.expiry": "This link is valid for 15 minutes.",
    "server.email.login.ignore": "If you did not request this, just ignore this email.",
    "server.email.login.subject": "Your heyta login link",
    "server.email.login.title": "Sign in to heyta",
    "server.email.passwordChanged.body": "A new sign-in password was just set for your heyta account, and every other device has been signed out.",
    "server.email.passwordChanged.button": "Open heyta",
    "server.email.passwordChanged.notYou": "If this wasn’t you, take your account back right away with “Forgot password”, and check whether someone else can read your email inbox.",
    "server.email.passwordChanged.subject": "Your heyta sign-in password was changed",
    "server.email.passwordChanged.title": "Password changed",
    "server.email.recover.body": "You asked to recover your passkey. Click the button below to register a new passkey for your account — it replaces the previous one.",
    "server.email.recover.button": "Register a new passkey",
    "server.email.recover.expiry": "This link is valid for 1 hour.",
    "server.email.recover.ignore": "If you did not request this, just ignore this email — nothing about your account will change.",
    "server.email.recover.subject": "Recover your heyta passkey",
    "server.email.recover.title": "Passkey recovery",
    "server.email.reset.body": "You asked to reset your sign-in password. Click the button below to choose a new one — once that succeeds, every other device will be signed out.",
    "server.email.reset.button": "Choose a new password",
    "server.email.reset.expiry": "This link is valid for 15 minutes and can be used once.",
    "server.email.reset.ignore": "If this wasn’t you, just ignore this email — your password will not change.",
    "server.email.reset.subject": "Reset your heyta sign-in password",
    "server.email.reset.title": "Reset your password",
    "server.email.verify.body": "Click the button below to verify your email and finish creating your account.",
    "server.email.verify.button": "Verify email",
    "server.email.verify.expiry": "This link is valid for 24 hours.",
    "server.email.verify.subject": "Verify your heyta account",
    "server.email.verify.title": "Welcome to heyta",
    "server.page.confirm.body": "Click the button below to confirm.",
    "server.page.confirm.button": "Confirm",
    "server.page.confirm.heading": "Confirm your email",
    "server.page.confirm.title": "Confirm your email",
    "server.page.confirm.verifiedOnly": "Email confirmed. Please sign in with your passkey.",
    "server.page.error.unknown": "Something went wrong. Please try again.",
    "server.page.login.again": "Request a new login link",
    "server.page.login.body": "Click the button below to finish this sign-in.",
    "server.page.login.busy": "Signing in…",
    "server.page.login.button": "Sign in",
    "server.page.login.error": "Sign-in failed. Please request a new login link.",
    "server.page.login.heading": "Finish signing in",
    "server.page.login.success": "Signed in. Redirecting…",
    "server.page.login.title": "Finish signing in",
    "server.page.recover.body": "Click the button below to register a new passkey for your account. It replaces the previous one.",
    "server.page.recover.busy": "Preparing…",
    "server.page.recover.button": "Register a new passkey",
    "server.page.recover.error": "That did not work. Please try again.",
    "server.page.recover.heading": "Recover your passkey",
    "server.page.recover.success": "Your passkey has been registered again. You can go back to the app and sign in.",
    "server.page.recover.title": "Recover passkey",
    "server.page.recover.verifying": "Verifying…",
    "server.page.recover.waiting": "Complete the prompt from your system…",
    "server.page.reset.body": "Choose a new password for your account. Once it’s set, every other device is signed out and you’ll sign in again with the new password.",
    "server.page.reset.breached": "This password has appeared in a breach database. Please use a different one.",
    "server.page.reset.busy": "Saving…",
    "server.page.reset.button": "Save new password",
    "server.page.reset.confirmLabel": "Re-enter new password",
    "server.page.reset.goLogin": "Sign in",
    "server.page.reset.heading": "Set a new sign-in password",
    "server.page.reset.hide": "Hide",
    "server.page.reset.hint": "At least 8 characters. A phrase only you would know beats symbols.",
    "server.page.reset.invalidLink": "This link is invalid, expired, or has already been used. Request a new email.",
    "server.page.reset.locked": "Too many attempts. Please try again later.",
    "server.page.reset.mismatch": "The two passwords don’t match.",
    "server.page.reset.newLabel": "New password",
    "server.page.reset.reveal": "Show",
    "server.page.reset.success": "Your password has been reset. Sign in with your new password.",
    "server.page.reset.title": "Set a new sign-in password",
    "server.page.reset.tooCommon": "That password is too common. Pick one unrelated to you.",
    "server.page.reset.tooLong": "That password is too long — 256 characters at most.",
    "server.page.reset.tooShort": "Use at least 8 characters.",
    "server.page.reset.unavailable": "The server is busy right now. Please try again shortly.",
    "server.page.tokenRequired": "This link is incomplete: the required token is missing.",
    "server.page.verify.action": "Go back and sign in",
    "server.page.verify.body": "Your account is ready to use.",
    "server.page.verify.failedBody": "This verification link is invalid or has expired. Please register again, or request a new verification email.",
    "server.page.verify.failedTitle": "Verification failed",
    "server.page.verify.heading": "Your email is verified",
    "server.page.verify.title": "Email verified",
  },
};
