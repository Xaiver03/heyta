/**
 * 口令**找回与改密**（计划 `docs/plans/email-password-auth.md` W3）。
 *
 * ## 这三条路各自难在哪
 *
 * ### `/forgot`：它必须不是一个邮箱存在性预言机
 * 存在、不存在、存在但没设过口令 —— 三种情况**同一句**中性响应、**同一个状态码**，
 * 而且**不写任何东西**。这条与注册那条是同一个立场（`auth.ts` 里的
 * `REGISTRATION_SUCCESS_MESSAGE`），否则"Forgot password"就成了一个
 * 比登录更便宜的存在性查询接口：登录那条要猜口令，这条只要提交邮箱。
 *
 * 🔴 **为什么没设过口令的账号也回同一句话，而不是"这个账号没有口令"**：
 * 那句会把"哪些邮箱只用通行密钥登录"整个泄露出去，而这类账号恰恰是最值得保护的。
 *
 * ### 限流：用**行本身**当计数器，不在内存里再数一遍
 * 计划写的是"按账号限流 3/小时"。这里落地成 **一个账号在上一张链接还没过期时不再发第二张**
 * （见下面那个 `OR` 条件）⇒ 每账号最多 15 分钟一封 = 稳态 4/小时。
 *
 * 为什么不用一个内存计数器：本进程的 Map **重启就归零、多副本各数各的**，
 * 而那行 `reset_password_token_expires_at` 在 Postgres 里，重启与副本都还认它。
 * 差的那一封不是重点 —— 用一份会消失的状态去"精确"限流才是。
 * ⚠️ 这条与 §10 第 7 条同源（`@fastify/rate-limit` 也是单进程内存态）。
 *
 * ### `/reset`：策略校验**在消费令牌之前**
 * 一次性链接是用户手上唯一的凭证。先验新口令的策略再烧链接，顺序反过来时的症状是：
 * 用户按要求填了一遍、被"口令太短"打回，而**链接已经没了**，他得回邮箱重新点。
 *
 * 消费是**一条带条件的 UPDATE**（`where` 里同时有令牌哈希与未过期），
 * 不是"先查再改"：后者在两个请求同时点到同一个链接时会给两次"成功"。
 *
 * 🔴 成功后**不发会话**（J14）。这与 ADR-0039 的"验证即登录"**故意不一致**，
 * 理由在 ADR-0040：能走完重置流程意味着持有收件箱，而收件箱是可以被旁观的
 * （共享电脑、被转发的邮件、旧设备）。高风险时刻的终点应该是登录页，不是自动进场。
 *
 * ### `tokenVersion++`：这是"全设备登出"唯一的落地方式
 * 改密与重置都会 bump 它，而 `verifyToken` 每一条 JWT 都比对它 ⇒
 * 所有旧设备当场 401。本地数据**继续可读**（口令在本地，数据不该因为一次改密变得不可读），
 * 客户端的后续行为是产品要求，见 §3.5 与 J13。
 */
import { randomBytes } from 'crypto';
import { prisma } from '../db';
import { Logger } from '../logger';
import { hashToken } from '../auth-tokens';
import { authCache } from '../auth-cache';
import { issueSession } from '../auth';
import { sendPasswordChangedEmail, sendPasswordResetEmail } from '../email';
import type { ServerLocale } from '../copy.generated.js';
import {
  PASSWORD_ACCOUNT_LOCKED_MESSAGE,
  PASSWORD_INVALID_CREDENTIALS_MESSAGE,
  PASSWORD_INVALID_RESET_LINK_MESSAGE,
  PASSWORD_POLICY_MESSAGE,
  PasswordAuthError,
  hashFor,
  recordFailedAttempt,
} from './service';
import { checkNewPassword, normalizePassword } from './policy';
import { verifyPassword } from './hash';
import { withHashSlot } from './concurrency';

/**
 * 与魔法链接登录那条一致（`auth.ts` 的 15 分钟）。
 * 比验证邮件的 24 小时短是刻意的：**改口令这件事的破坏半径比"验证一个邮箱是我的"大**，
 * 而链接躺在邮件里 —— 邮件是所有系统里最容易被别人看到的地方。
 */
export const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;

/**
 * `/forgot` 的唯一响应（中性）。
 *
 * 🔴 三种情况共用它：账号不存在 / 存在但没设口令 / 已有一张还在有效期内的链接。
 * 少一种，这句话就退化成预言机。
 */
export const PASSWORD_RESET_REQUEST_MESSAGE =
  'If that email address is in our database, we’ll email a link to reset your password.';

/** 重置成功。**不许**读成"你已经登录了"（J14 的反面就是这个措辞）。 */
export const PASSWORD_RESET_SUCCESS_MESSAGE =
  'Your password has been reset. Sign in with your new password.';

/**
 * 已登录、但账号**根本没有口令**这个认证器（纯通行密钥 / 魔法链接注册）。
 *
 * 与 `invalid_reset_link` 分开是因为客户端动作相反：那句是"回去重新点链接"，
 * 这句是"去走「忘记密码」把口令设上"。判据与不并入的理由在
 * `service.ts` 的 `no_password_set` 上。
 */
export const PASSWORD_NOT_SET_MESSAGE =
  'This account has no password yet. Use “Forgot password” to create one.';

export interface PasswordResetRequestInput {
  email: string;
  /** 收件人语言，由路由层按 `?lang=` > 账号 `locale` > `Accept-Language` 解析。 */
  locale?: ServerLocale;
}

/**
 * 申请一封重置邮件。**任何分支都返回同一句中性的 `{ message }`**。
 *
 * 顺序：查账号 → 有口令才申请 → 只在"上一张已经过期"时才写新的 → 发了才算数。
 * 发信失败时把刚写进去的令牌**回滚**（与 `passkey.ts` 的恢复邮件同一条立场）：
 * 库里留一枚没有任何邮件携带的有效令牌，比"用户重点一次"更坏。
 */
export const requestPasswordReset = async (
  input: PasswordResetRequestInput,
): Promise<{ message: string }> => {
  const neutral = { message: PASSWORD_RESET_REQUEST_MESSAGE };
  const email = input.email.toLowerCase();
  const now = Date.now();

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, passwordHash: true },
  });

  // 没这个账号，或这个账号根本没有口令这个认证器（纯通行密钥 / 魔法链接）。
  if (!user || user.passwordHash === null) {
    Logger.info('Password reset requested for an address with no password authenticator');
    return neutral;
  }

  const resetToken = randomBytes(32).toString('hex');
  const expiresAt = BigInt(now + PASSWORD_RESET_TTL_MS);

  const claim = await prisma.user.updateMany({
    where: {
      id: user.id,
      // 🔴 这一串 `OR` 就是那个"按账号限流"（见文件头）：上一张链接还在有效期内时
      // `count === 0`，这里什么都不发，而用户看到的仍是同一句话。
      OR: [
        { resetPasswordToken: null },
        { resetPasswordTokenExpiresAt: null },
        { resetPasswordTokenExpiresAt: { lte: BigInt(now) } },
      ],
    },
    data: {
      resetPasswordToken: hashToken(resetToken),
      resetPasswordTokenExpiresAt: expiresAt,
    },
  });
  if (claim.count === 0) {
    Logger.info(`Password reset link already outstanding (ID: ${user.id})`);
    return neutral;
  }

  const emailSent = await sendPasswordResetEmail(user.email, resetToken, input.locale);
  if (!emailSent) {
    await prisma.user.updateMany({
      where: { id: user.id, resetPasswordToken: hashToken(resetToken) },
      data: { resetPasswordToken: null, resetPasswordTokenExpiresAt: null },
    });
    Logger.error(`Password reset email delivery failed (ID: ${user.id})`);
  }

  return neutral;
};

/**
 * "口令已被更改"的告知信。
 *
 * 🔴 两个调用点都在**已经改完之后**，且**失败不抛出**：
 * 1. 只在成功时发。挂在失败路径上会让这个接口变成骚扰他人的工具（对着别人
 *    的邮箱反复点"改密"就能给他发信），而且顺带承认了"这个邮箱有账号"。
 * 2. 口令**已经**换了。因为一封通知发不出去就把成功报成失败，用户会以为
 *    没改成而再去申请链接 —— 那比少一封邮件糟得多。
 */
const notifyPasswordChanged = async (
  userId: number,
  email: string,
  locale?: ServerLocale,
): Promise<void> => {
  const sent = await sendPasswordChangedEmail(email, locale);
  if (!sent) {
    Logger.error(`Password-changed notice could not be delivered (ID: ${userId})`);
  }
};

export interface PasswordResetInput {
  token: string;
  password: string;
  /** 通知信的语言；不传则走 `email.ts` 的默认（中文）。 */
  locale?: ServerLocale;
}

/**
 * 用链接里的令牌换新口令。
 *
 * @throws `password_policy_violation` 新口令不合格 —— **令牌仍然可用**（顺序见文件头）。
 * @throws `invalid_reset_link` 查不到 / 已过期 / 已被用过（三者同一句，见常量注释）。
 */
export const resetPasswordWithToken = async (
  input: PasswordResetInput,
): Promise<{ message: string }> => {
  const { token, password, locale } = input;
  const policy = await checkNewPassword(password);
  if (!policy.ok) {
    throw new PasswordAuthError(
      'password_policy_violation',
      PASSWORD_POLICY_MESSAGE,
      undefined,
      policy.code,
    );
  }

  // 邮件里那句令牌原样进来，库里那一列是它的 SHA-256 ⇒ 每次按哈希查（W2 的立场）。
  const tokenHash = hashToken(token);
  const now = BigInt(Date.now());

  const user = await prisma.user.findFirst({
    where: { resetPasswordToken: tokenHash },
    select: { id: true, email: true, resetPasswordTokenExpiresAt: true },
  });

  if (!user) {
    throw new PasswordAuthError('invalid_reset_link', PASSWORD_INVALID_RESET_LINK_MESSAGE);
  }
  if (user.resetPasswordTokenExpiresAt === null || user.resetPasswordTokenExpiresAt <= now) {
    // 过期就当场清掉（与 `auth.ts` 里过期魔法链接的处理同形）。清它**不是**判据的一部分 ——
    // 下面的 `where` 已经保证过期的行不会被改；这里只是别让一枚死令牌长期躺在库里。
    await prisma.user.updateMany({
      where: { id: user.id, resetPasswordToken: tokenHash },
      data: { resetPasswordToken: null, resetPasswordTokenExpiresAt: null },
    });
    throw new PasswordAuthError('invalid_reset_link', PASSWORD_INVALID_RESET_LINK_MESSAGE);
  }

  // 哈希算在 `updateMany` **之前**：一次 ~35 ms 的失败不该让那行令牌处于
  // "已被查出来、还没被消费"的空档里被第二个请求撞上。反过来说也不亏 ——
  // 口令错到底不会发生（策略已经过了）。
  const passwordHash = await hashFor(policy.normalized);

  // 🔴 全设备登出（J13）的第二半：`verifyToken` 命中缓存时**不查库**，而缓存里存的
  // 正是 `tokenVersion`。不失效的话，旧设备在 TTL（30 s）内**照样通过** ——
  // 库里那格已经 +1、`count` 是 1、日志也打了，而人还在里面。这件事在界面上完全
  // 不可见，所以它必须和写挨在一起（同 `auth.ts` 里那个标记的立场：写前后各一次，
  // 中间那次 `verify` 会把**旧**版本回填进缓存）。
  // AUTH_CACHE_INVALIDATION: keep adjacent to tokenVersion writes.
  authCache.invalidate(user.id);

  const consumed = await prisma.user.updateMany({
    where: {
      id: user.id,
      resetPasswordToken: tokenHash,
      resetPasswordTokenExpiresAt: { gt: now },
    },
    data: {
      passwordHash,
      resetPasswordToken: null,
      resetPasswordTokenExpiresAt: null,
      // 🔴 全设备登出（J13）：旧 JWT 里的 `tokenVersion` 当场对不上。
      tokenVersion: { increment: 1 },
      // 一次成功的重置就是"这个人拿回了收件箱"，口令爆破留下的锁要一并解掉 ——
      // 否则攻击者可以用"先输错五次锁住、再走重置"把人挡在自己的账号外面。
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });
  if (consumed.count !== 1) {
    // 走到这里说明同一枚链接在两次请求之间被用掉了（或那一行刚被后台清掉）。
    throw new PasswordAuthError('invalid_reset_link', PASSWORD_INVALID_RESET_LINK_MESSAGE);
  }

  Logger.info(`Password reset completed (ID: ${user.id})`);
  // AUTH_CACHE_INVALIDATION: keep adjacent to tokenVersion writes.
  authCache.invalidate(user.id);
  // 🔴 **不发会话**（J14）。这里返回的只有"去登录"这句话。
  //
  // 改口令成功的**告知信**：与 `changePassword` 同一条立场（那里的注释写了为什么
  // 只在成功时发）。发信失败**不影响**已经完成的重置 —— 口令已经换了，
  // 因为一封通知发不出去而把成功报成失败，会让人以为没改成而再去申请一张链接。
  await notifyPasswordChanged(user.id, user.email, locale);
  return { message: PASSWORD_RESET_SUCCESS_MESSAGE };
};

export interface ChangePasswordResult {
  token: string;
  user: { id: number; email: string; locale: string | null };
}

/**
 * 已登录状态下改口令：**当前设备不掉线，其余设备全部掉线**。
 *
 * 为什么当前设备要换一枚新令牌：`tokenVersion` 是全局计数器，bump 之后
 * **手上这枚也会失效**。所以这里在同一个事务式的序列里签一枚带新版本号的令牌，
 * 客户端拿它替换本地那份 —— 而不是"改个密码把自己的这个标签页也踢出去"。
 *
 * 当前口令校验失败**计入**登录那条同一个计数器（见 `recordFailedAttempt` 上的注释），
 * 否则改密接口就是一条不会被锁的口令爆破通道。
 */
export const changePassword = async (
  userId: number,
  currentPassword: string,
  newPassword: string,
  locale?: ServerLocale,
): Promise<ChangePasswordResult> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      locale: true,
      passwordHash: true,
      tokenVersion: true,
      lockedUntil: true,
    },
  });

  if (!user) {
    throw new PasswordAuthError(
      'invalid_credentials',
      PASSWORD_INVALID_CREDENTIALS_MESSAGE,
    );
  }

  // 账号从来没有口令（纯通行密钥 / 魔法链接注册的）。
  // 🔴 这**不是** `invalid_credentials`：那个人没有"输错当前口令"这回事，
  // 把它报成口令错会把他引向"我是不是忘了口令"的死循环。
  // 也不跑哑校验：这条路的计时不回答任何攻击者不知道的事 —— 他手上已经有一枚有效令牌了。
  if (user.passwordHash === null) {
    throw new PasswordAuthError('no_password_set', PASSWORD_NOT_SET_MESSAGE);
  }

  const now = Date.now();
  if (user.lockedUntil !== null && user.lockedUntil > BigInt(now)) {
    // 锁是**口令这个认证器**的，改密这条路也读它 —— 不然锁只挡登录按钮，
    // 而同一个认证器上还开着另一扇门。
    throw new PasswordAuthError(
      'account_locked',
      PASSWORD_ACCOUNT_LOCKED_MESSAGE,
      Math.ceil(Number((user.lockedUntil - BigInt(now)) / BigInt(1000))),
    );
  }

  const currentNormalized = normalizePassword(currentPassword);
  const matches = await withHashSlot(() =>
    verifyPassword(currentNormalized, user.passwordHash!),
  );

  if (!matches) {
    await recordFailedAttempt(user.id);
    throw new PasswordAuthError(
      'invalid_credentials',
      PASSWORD_INVALID_CREDENTIALS_MESSAGE,
    );
  }

  const policy = await checkNewPassword(newPassword);
  if (!policy.ok) {
    throw new PasswordAuthError(
      'password_policy_violation',
      PASSWORD_POLICY_MESSAGE,
      undefined,
      policy.code,
    );
  }

  const passwordHash = await hashFor(policy.normalized);
  // AUTH_CACHE_INVALIDATION: keep adjacent to tokenVersion writes.
  authCache.invalidate(user.id);

  // 🔴 新版本号从**写**里读回来，不是 `user.tokenVersion + 1` 算出来的：
  // 两次并发的改密（同一个人开两个标签页各点一次保存）会各自读到同一个旧值、
  // 各自算出同一个"新"值，于是其中一枚新签的令牌一出生就对不上库里那格。
  // `increment` + `select` 让服务端自己把决胜后的值告诉我们。
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      tokenVersion: { increment: 1 },
      failedLoginAttempts: 0,
      lockedUntil: null,
      // 改口令时把在途的重置链接一并作废：用户刚刚证明了手里有当前口令，
      // 那封"可能是别人申请的"邮件就该失效。
      resetPasswordToken: null,
      resetPasswordTokenExpiresAt: null,
    },
    select: { tokenVersion: true },
  });
  // AUTH_CACHE_INVALIDATION: keep adjacent to tokenVersion writes.
  authCache.invalidate(user.id);

  Logger.info(`Password changed (ID: ${user.id}); all other sessions revoked`);
  await notifyPasswordChanged(user.id, user.email, locale);
  return {
    token: issueSession({ id: user.id, email: user.email, tokenVersion: updated.tokenVersion }),
    user: { id: user.id, email: user.email, locale: user.locale },
  };
};
