/**
 * 换绑登录邮箱的 **HTTP 契约**（服务端与四个宿主共用）。
 *
 * 裁决在 [ADR-0063](../../../docs/adr/0063-email-rebinding-and-per-session-revocation.md) §2.1–§2.4；
 * 这份文件只管**必须跨端逐字相同**的那三样（路径、稳定码、时限），理由与
 * `auth-http-contract.ts` 文件头写的是同一条：漂移的症状是 404 或"一句错话"，不是报错。
 *
 * 它是**纯可加**的：`CURRENT_SCHEMA_VERSION` 只管 op / snapshot，不 bump。
 */

/**
 * 相对服务端根的路径（不带 `/api`），与 `ACCOUNT_PROFILE_PATHS` 同一形状。
 *
 * 🔴 `confirm` 是**唯一一条不需要 Bearer** 的：它由邮件里的链接触发，而点链接的人
 * 手上没有会话（他可能在另一台电脑上、在旧邮箱里、在新邮箱里）。其余三条都在
 * `preHandler: authenticate` 上，`userId` 只取自已认证身份。
 */
export const EMAIL_CHANGE_PATHS = {
  /** `POST` 已登录发起换绑。body `{ newEmail }`。成功语义是"去看两个收件箱"。 */
  request: 'account/email/change/request',
  /** `POST` 用链接里的一次性令牌确认**其中一边**。成功**不发会话**（J14 同族）。 */
  confirm: 'account/email/change/confirm',
  /** `GET` 已登录读"这张活请求还等哪一边"。界面上的那句实话来自这里。 */
  status: 'account/email/change/status',
  /** `POST` 已登录撤销自己发起的那张活请求。 */
  cancel: 'account/email/change/cancel',
} as const;

/**
 * 换绑这条路上的**稳定机器码**（响应体的 `code` 字段）。
 *
 * 🔴 这里**没有**反枚举那一族。理由与 `PASSWORD_AUTH_ERROR_CODES` 里
 * `no_password_set` / `password_already_set` 已经确立的那条论证同一条：
 * 换绑的四个动作里，除 `confirm` 之外全部要求 Bearer，调用者手上已经有一枚有效令牌，
 * 区分性错误**不泄露他不知道的事**。而 `confirm` 那一侧刻意**不区分**（见下面那条注释）。
 */
export const EMAIL_CHANGE_ERROR_CODES = [
  /**
   * 链接查不到 / 已过期 / 已被用过 / 请求已被撤销 —— 🔴 四者**故意同一个码同一句话**。
   *
   * 与 `invalid_reset_link` 完全同一条理由：区分它们就是给攻击者一个"哪些换绑链接正在被广播"
   * 的预言机，而合法用户四种情况的处置一模一样（回界面重新发起一次）。
   */
  'invalid_change_link',
  /**
   * 这个账号**从来没有验证过邮箱** ⇒ 换绑这条路不走。
   *
   * ⚠️ 它今天实际上到不了：未验证的账号在 `verifyToken` 那一步就被拒（`ACCOUNT_UNVERIFIED`）。
   * 仍然登记进词表，是因为它是这条流程的**前提**而不是巧合 —— 哪天"未验证不许换绑"变成
   * "未验证也可以换绑"，判据会红，而那个变更必须是有意决定的。
   */
  'email_not_verified',
  /** 新地址与当前地址是同一个。只在已认证接口出现，不构成枚举面。 */
  'email_unchanged',
  /**
   * 新地址**已经被另一个账号占用**。只在已认证接口出现，不构成枚举面。
   *
   * ⚠️ 它只覆盖"`users.email` 上已经有这一行"。另一半由 `pending_email` 上那条唯一索引兜：
   * 抢一个别人正在换绑中的地址 ⇒ 同样是这一句（不另开一码 —— 客户端动作完全相同）。
   */
  'email_taken',
  /** 距上一张活请求还没到冷却窗口 ⇒ 什么都不会再发。 */
  'email_change_cooldown',
] as const;

export type EmailChangeErrorCode = (typeof EMAIL_CHANGE_ERROR_CODES)[number];

/**
 * 两侧确认令牌的有效期 = **24 小时**。
 *
 * 🔴 这个数**不是拍的**：锚的是"验证一个邮箱是不是我的"那一条
 * （`VERIFICATION_TOKEN_EXPIRY_MS`，`server/src/auth.ts:24`）。换绑里的**新邮箱那一半**
 * 语义上就是同一件事（证明收件箱可控），所以它继承同一个窗口，而不是新增一个旋钮。
 *
 * 为什么不是重置口令那个 15 分钟：那一半做的是"改一把钥匙"，破坏半径更大所以窗口更短
 * （理由在 `password/recovery.ts:61-66`）。换绑的两半里，**旧邮箱那一半是授权、
 * 新邮箱那一半是验证**，两个都点齐了才生效 —— 单边的破坏半径被另一半挡住了。
 */
export const EMAIL_CHANGE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 重发冷却 = **60 秒**。锚的是注册验证码那条
 *（`EMAIL_PASSWORD_REGISTRATION_RESEND_COOLDOWN_MS`，本包 `auth-http-contract.ts:83`），
 * 不另拍一个数。
 */
export const EMAIL_CHANGE_RESEND_COOLDOWN_MS = 60 * 1000;

/** 一张活请求的对外形状。`awaiting*` 是让界面能说出**实话**的那两个布尔。 */
export interface EmailChangeStatusResponse {
  pending: boolean;
  /** 还等旧邮箱那一边点。 */
  awaitingOld: boolean;
  /** 还等新邮箱那一边点。 */
  awaitingNew: boolean;
  /** 待绑的地址（本人刚输入的值，Bearer 归属 ⇒ 原样回显，不做假脱敏）。 */
  pendingEmail?: string;
  expiresAt?: number;
  resendAvailableAt?: number;
}

/** `confirm` 的响应。`applied` 只在**两边都点齐并当场生效**那一次为 true。 */
export interface EmailChangeConfirmResponse {
  message: string;
  applied: boolean;
}
