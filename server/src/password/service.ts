/**
 * 邮箱 + 口令的**注册与登录**（计划 `docs/plans/email-password-auth.md` W1）。
 *
 * ## 这条路上唯一难的地方是"不泄露账号是否存在"，而它有三个出口
 *
 * 1. **计时**：账号不存在时如果直接返回，响应会比"跑一次 Argon2id"快 ~35 ms。
 *    攻击者不需要读错误信息，拿秒表就能枚举邮箱。⇒ 不存在 / 没设口令 / 口令错
 *    **三条路都必须真的算一次同参数的哈希**（`dummyVerify`）。
 * 2. **文案与状态码**：三种失败给**同一句** `Invalid credentials` + 同一个状态码
 *    （沿用上游 `auth-flows.spec.ts` 钉过的契约，按 §3.4 移植语义）。
 * 3. **写侧副作用**：账号不存在时**没有行可计数**，于是"枚举一千个邮箱"和
 *    "对真账号爆破一千次"在服务端留下的痕迹完全不同。这里接受这个差别 ——
 *    把它抹平要求给不存在的账号建占位行，那是一条新攻击面（占位行可被用来
 *    预领邮箱）。IP 侧的限制由 `@fastify/rate-limit` 承担。
 *
 * ## 🔴 锁定锁的是"口令这个认证器"，不是账号
 *
 * NIST SP 800-63B 5.1.1.2 的口径。所以：
 * - `lockedUntil` **只被口令这条路读取**；魔法链接登录与通行密钥登录**照旧可走**
 *   （`verifyLoginMagicLink` 成功时还会顺手清掉这两个字段）。
 * - 理由很实际：如果锁定 = 整账号停摆，那"输错五次别人邮箱的口令"就是一个
 *   **对任意账号的拒绝服务攻击**。而邮箱是攻击者知道的。
 *
 * ## 顺序不是风格问题
 *
 * "未验证邮箱"这句话**必须**在校验口令**通过之后**才说 —— 否则它就是最省事的
 * 枚举器（一次请求、零猜测就知道哪些邮箱注册过）。
 */
import type { PasswordAuthErrorCode } from '@heyta/shared-schema';
import { prisma } from '../db';
import { Logger } from '../logger';
import { issueSession, registerWithMagicLink } from '../auth';
import type { SessionMeta } from '../account/access-sessions';
import type { ServerLocale } from '../copy.generated.js';
import { notifyAuthenticatorAdded } from '../account/authenticator-notice';
import { normalizeEmail } from '../account/email-normalize';
import {
  dummyVerify,
  hashPassword,
  needsRehash,
  verifyPassword,
} from './hash';
import { PasswordBackendBusy, withHashSlot } from './concurrency';
import { checkNewPassword, normalizePassword, type PasswordPolicyCode } from './policy';

/** 上游契约（`tests/auth-flows.spec.ts`）钉的是 5 次 / 15 分钟，照移植。 */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

/**
 * 口令这条路对客户端的判别词表**不在这里定义** —— 唯一真源在
 * `@heyta/shared-schema` 的 `auth-http-contract.ts`（每条码为什么存在、为什么
 * 与相邻那条不许合并，理由跟着码一起搬过去了）。
 *
 * 这里按**原名再导出**，所以 `api.ts` 的 `satisfies PasswordAuthErrorCode`
 * 与各测试的导入一个字都不用改。留在服务端单独定义一份，就等于服务端与四个宿主
 * 各持有一张表 —— 而客户端是按字符串查表的，改名或漏一条不会有任何一层报错。
 */
export type { PasswordAuthErrorCode };

/**
 * 口令这条路**面向客户端的句子**（唯一真源在这里）。
 *
 * 分工是刻意的：**本模块管句子，`api.ts` 管状态码并按 `code` 原样发出**。
 * 句子只有一份，所以"服务层改了措辞、路由层还在发旧那句"这种漂移无处发生。
 *
 * ⚠️ 这里**不走** `api.ts` 的 `SAFE_ERROR_MESSAGES` 白名单。那套机制服务的是
 * "错误对象身上没有码"的老路径（`getSafeErrorMessage(err, 兜底)`）；把这几个串
 * 塞进白名单会顺手改变**通行密钥**那条路的行为 —— `passkey.ts` 也抛
 * `'Invalid credentials'`，一旦入白名单，它的兜底句 `Authentication failed`
 * 就被透传句顶掉了。一次改动只碰它该碰的东西。
 *
 * 🔴 三条不是措辞偏好的取舍：
 * 1. `PASSWORD_INVALID_CREDENTIALS_MESSAGE` 覆盖"账号不存在 / 没设口令 / 口令错"
 *    三种情况，且**只有一个状态码** —— 少一条，秒表或文案就成枚举器。
 * 2. `PASSWORD_EMAIL_NOT_VERIFIED_MESSAGE` 是这条路上唯一会说出账号状态的一句，
 *    所以它**只在校验口令通过之后**才可能出现（顺序见 `loginWithEmailPassword`）。
 * 3. `PASSWORD_ACCOUNT_LOCKED_MESSAGE` 必须给可执行动作（改用链接登录 / 还要等多久），
 *    而不是只说"不行"。它说"口令这条路被锁"，不说"账号被锁" —— 后者不属实，
 *    魔法链接与通行密钥照旧可走。
 */
export const PASSWORD_INVALID_CREDENTIALS_MESSAGE = 'Invalid credentials';
export const PASSWORD_EMAIL_NOT_VERIFIED_MESSAGE =
  'Email not verified. Check your inbox for the verification link.';
export const PASSWORD_ACCOUNT_LOCKED_MESSAGE =
  'Account temporarily locked due to repeated failed sign-in attempts. Sign in with a link, or try again later.';
export const PASSWORD_POLICY_MESSAGE = 'That password does not meet the requirements.';
/** 见 `invalid_reset_link` 上的注释：查不到 / 过期 / 用过 三种情况**共用这一句**。 */
export const PASSWORD_INVALID_RESET_LINK_MESSAGE =
  'That reset link is invalid or has been used. Request a new one.';
/**
 * 已有口令的账号来走"设第一个口令" ⇒ 该改走 `change`。
 *
 * 只在**已认证**接口上出现（理由见 `PASSWORD_AUTH_ERROR_CODES` 里那条注释），
 * 所以它不像 `invalid_credentials` 那样需要中性化。
 */
export const PASSWORD_ALREADY_SET_MESSAGE =
  'This account already has a sign-in password. Use password change instead.';
/** `/password/set` 成功。与 `change` 不同：**没有**新会话可发（手上那枚仍然有效）。 */
export const PASSWORD_SET_SUCCESS_MESSAGE = 'Password set';

export class PasswordAuthError extends Error {
  constructor(
    readonly code: PasswordAuthErrorCode,
    message: string,
    /** 只在 `account_locked` 上有意义：还要等多少秒。 */
    readonly retryAfterSeconds?: number,
    /** 只在 `password_policy_violation` 上有意义：客户端按它取词条。 */
    readonly policyCode?: PasswordPolicyCode,
  ) {
    super(message);
    this.name = 'PasswordAuthError';
  }
}

/**
 * 口令校验。**两条**设置口令的路（注册 / 改密）与登录共用这一份归一化口径。
 *
 * 🔴 归一化只发生在这里与 `policy.normalizePassword`，且注册存的就是归一化后的串 ——
 * 存原始输入而验归一化输入（或反之）是"同一口令在两端不一样"的标准生成方式。
 *
 * ⚠️ 导出给 `recovery.ts`（重置 / 改密）用。**不要**在别处再写一遍
 * `withHashSlot(() => hashPassword(…))`：绕过闸门直接算哈希的地方多一处，
 * "并发有上限"这个前提就少一处成立。
 */
export const hashFor = (normalized: string): Promise<string> =>
  withHashSlot(() => hashPassword(normalized));

export interface RegisterWithEmailPasswordInput {
  email: string;
  password: string;
  termsAcceptedAt?: number;
  inviteCode?: string;
  locale?: ServerLocale;
}

/**
 * 注册：先过策略、再哈希、最后**委托 `registerWithMagicLink`**。
 *
 * 🔴 为什么委托而不是自己写一遍建账号：那条路已经负责
 * 验证令牌、TEST_MODE 自动验证、邀请码登记与结算、配额默认值、P2002 中性化、
 * 重发上限。复制它 = 制造第二套语义（而这个仓库已经在 §3.5 为这件事付过学费）。
 *
 * 顺序也是刻意的：**策略 + 哈希在前**。一个不满足长度要求的请求
 * 不该先占掉一个邮箱、再告之"口令太短"；而邮箱是否已被占用由被委托方
 * 用中性消息回答（见 `auth.ts` 里的 `REGISTRATION_SUCCESS_MESSAGE`）。
 */
export const registerWithEmailPassword = async (
  input: RegisterWithEmailPasswordInput,
): Promise<{ message: string; emailDelivered?: boolean }> => {
  const policy = await checkNewPassword(input.password);
  if (!policy.ok) {
    throw new PasswordAuthError(
      'password_policy_violation',
      PASSWORD_POLICY_MESSAGE,
      undefined,
      policy.code,
    );
  }

  const passwordHash = await hashFor(policy.normalized);

  return registerWithMagicLink(
    input.email,
    input.termsAcceptedAt,
    input.inviteCode,
    input.locale,
    passwordHash,
  );
};

/**
 * 给一个**还没有口令**的账号加上第一个登录口令（已认证）。
 *
 * ## 为什么必须有这条路
 *
 * `passwordHash` 可空是设计（纯通行密钥 / 魔法链接账号）。少了这条路由，那种账号
 * **永远**加不上登录密码：`change` 要验一个不存在的当前口令（它回 `no_password_set`），
 * 而 `forgot` 对没有口令认证器的账号**刻意不发信**（反枚举，`recovery.ts:117`）。
 * 症状是界面上每一句"去设一个登录密码"都指向一条不存在的路。
 *
 * ## 与 `change` 的三点不同，每一点都要写清
 *
 *   1. **不验当前口令** —— 没有可验的东西。
 *   2. 🔴 **不 bump `tokenVersion`**：这是**加一个认证器**，不是换一把钥匙。把其余设备
 *      踢下线在这条路上没有任何安全收益（这个人此刻就登录着），只有成本。
 *      也因此**不返回新会话** —— 手上那枚仍然有效，客户端不需要换。
 *   3. 🔴 **成功后发"账号多了一种登录方式"那封信**（`notifyAuthenticatorAdded`，
 *      ADR-0063 §2.6）。这里**不用** `notifyPasswordChanged` —— 那封信的语义是"你的口令
 *      被改了"，这个账号本来没有口令，用它就是说谎。要说的是一件不同的事：
 *      **多开了一扇门**。原来这条路上一个字都不发，于是"拿着别人遗失的会话给自己加一个
 *      他知道的口令"是一条**没有回声**的提权路径（`email-password-auth.md` 缺口 13 原文）。
 *      已登录加通行密钥那条路（`passkeys/registration/complete`）同批发同一封 ——
 *      两处共用 `account/authenticator-notice.ts` 这一个收口，免得一条纪律漂成两份。
 *
 * 已认证就够了，不需要"再证明一次邮箱"：登录态本身就是这把钥匙的授权边界，
 * 而 E2EE 之下服务端读不到任何明文数据 —— 加一个口令不放大任何人的数据面。
 * 唯一加的门是**邮箱必须已验证**：否则设出来的口令登不进（`loginWithEmailPassword`
 * 要求 `isVerified`），那才是真的把人引进死胡同。
 */
export const setInitialPassword = async (input: {
  userId: number;
  password: string;
}): Promise<{ message: string }> => {
  const policy = await checkNewPassword(input.password);
  if (!policy.ok) {
    throw new PasswordAuthError(
      'password_policy_violation',
      PASSWORD_POLICY_MESSAGE,
      undefined,
      policy.code,
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true, isVerified: true, passwordHash: true },
  });

  if (!user) {
    // 带着一枚有效令牌却查不到那一行 ⇒ 账号在两次请求之间被删了。
    // 不新造一个码：`invalid_credentials` 在这一层就是"这次认证不成立"。
    throw new PasswordAuthError('invalid_credentials', PASSWORD_INVALID_CREDENTIALS_MESSAGE);
  }
  if (user.passwordHash !== null) {
    throw new PasswordAuthError('password_already_set', PASSWORD_ALREADY_SET_MESSAGE);
  }
  if (user.isVerified !== 1) {
    throw new PasswordAuthError(
      'email_not_verified',
      PASSWORD_EMAIL_NOT_VERIFIED_MESSAGE,
    );
  }

  const passwordHash = await hashFor(policy.normalized);

  // 🔴 条件写（`passwordHash: null` 在 `where` 里）：两次"设第一个口令"并发时，
  // 只有一个赢，另一个得到 `password_already_set`。无条件 `update` 会让后写的
  // 那一次**静默覆盖**前一次 —— 而两个人都看到了"成功"。
  const written = await prisma.user.updateMany({
    where: { id: user.id, passwordHash: null },
    data: { passwordHash },
  });
  if (written.count !== 1) {
    throw new PasswordAuthError('password_already_set', PASSWORD_ALREADY_SET_MESSAGE);
  }

  Logger.info(`Initial password set (ID: ${user.id})`);
  await notifyAuthenticatorAdded(user.id, 'password');
  return { message: PASSWORD_SET_SUCCESS_MESSAGE };
};

export interface LoginResult {
  token: string;
  user: { id: number; email: string; locale: string | null };
}

/** 口令对 ⇒ 抬升工作因子（**不阻塞**本次登录的返回）。 */
const rehashOnLogin = async (userId: number, normalized: string): Promise<void> => {
  try {
    const fresh = await hashFor(normalized);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: fresh } });
    Logger.info(`Password rehashed to current policy (ID: ${userId})`);
  } catch (err) {
    // 🔴 重算失败**不能**让一次本来成功的登录变成失败。策略落后于当前值是性能问题,
    // 而不是"这次认证没通过"；下次登录还会再试。
    Logger.error(
      `Password rehash failed (ID: ${userId}): ${
        err instanceof Error ? err.message : 'unknown'
      }`,
    );
  }
};

/**
 * 记一次口令失败。
 *
 * ⚠️ 登录与**改密**共用这一个计数器是有意的：改密接口校验的也是当前口令，
 * 如果它不计数，那"输错当前口令"就成了一条**不会被锁**的口令爆破通道 ——
 * 而它比登录那条更好用，因为它不需要账号存在以外的任何东西（令牌已经带上了）。
 */
export const recordFailedAttempt = async (userId: number): Promise<void> => {
  // `increment` 让"计数"是一条语句里的读-改-写。先 find 再 update 的写法在并发爆破下
  // 会丢计数（两个请求各自读到 4、各自写 5）—— 那正是"永远锁不上"的形状。
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: { increment: 1 }, lockedUntil: null },
    select: { failedLoginAttempts: true },
  });
  if (updated.failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
    await prisma.user.update({
      where: { id: userId },
      data: { lockedUntil: BigInt(Date.now() + LOGIN_LOCKOUT_MS) },
    });
    Logger.warn(
      `Password authenticator locked (ID: ${userId}) after ${updated.failedLoginAttempts} failed attempts`,
    );
  }
};

/** 见 `recordFailedAttempt`：同一条锁，成功的那一次由同一条路解除。 */
export const clearFailedAttempts = (userId: number): Promise<unknown> =>
  prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });

/**
 * 口令登录。**不**跑口令策略（长度/常见/泄露）—— 那三道的代价是 1–3 s 的外部
 * 依赖，挂在认证热路径上等于把"第三方抖动"变成"我们登录不了"（W0 探针 2 的结论）。
 */
export const loginWithEmailPassword = async (
  email: string,
  password: string,
  meta: SessionMeta = {},
): Promise<LoginResult> => {
  const normalized = normalizePassword(password);
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
    select: {
      id: true,
      email: true,
      locale: true,
      passwordHash: true,
      isVerified: true,
      tokenVersion: true,
      failedLoginAttempts: true,
      lockedUntil: true,
    },
  });

  const invalid = new PasswordAuthError(
    'invalid_credentials',
    PASSWORD_INVALID_CREDENTIALS_MESSAGE,
  );

  if (!user) {
    await withHashSlot(() => dummyVerify(normalized));
    throw invalid;
  }

  // 没有口令这个认证器（纯通行密钥 / 魔法链接账号）。同样跑一次哑校验,
  // 否则"这个邮箱没设口令"又是一个计时特征。
  // ⚠️ **不**计数也不锁定：对一个根本不存在口令的账号计数，会让一次枚举
  //    把无辜账号的 `lockedUntil` 写上 —— 那正是上面"锁认证器不锁账号"要防的事。
  if (!user.passwordHash) {
    await withHashSlot(() => dummyVerify(normalized));
    throw invalid;
  }

  const now = Date.now();
  if (user.lockedUntil !== null) {
    if (user.lockedUntil > BigInt(now)) {
      const waitSeconds = Math.ceil(
        Number((user.lockedUntil - BigInt(now)) / BigInt(1000)),
      );
      throw new PasswordAuthError(
        'account_locked',
        PASSWORD_ACCOUNT_LOCKED_MESSAGE,
        waitSeconds,
      );
    }
    // 🔴 锁定期**已过** ⇒ 计数一并作废。不作废的话这条路的形状是：用户老老实实等了
    // 15 分钟，回来打错**一个**字，`recordFailedAttempt` 看到计数仍然 >= 上限，
    // 当场再锁 15 分钟 —— 而界面上没有任何东西能解释"为什么一次就锁上了"。
    // 移植自上游的契约是「5 次失败锁 15 分钟」，读起来就是"窗口过后重新数 5 次"。
    await clearFailedAttempts(user.id);
  }

  const matches = await withHashSlot(() => verifyPassword(normalized, user.passwordHash!));

  if (!matches) {
    await recordFailedAttempt(user.id);
    throw invalid;
  }

  await clearFailedAttempts(user.id);

  if (user.isVerified === 0) {
    throw new PasswordAuthError(
      'email_not_verified',
      PASSWORD_EMAIL_NOT_VERIFIED_MESSAGE,
    );
  }

  if (needsRehash(user.passwordHash)) {
    await rehashOnLogin(user.id, normalized);
  }

  Logger.info(`User logged in with password (ID: ${user.id})`);
  return {
    token: await issueSession(user, meta),
    user: { id: user.id, email: user.email, locale: user.locale },
  };
};

/**
 * 导出给路由层的**过载**判据（`PasswordBackendBusy` 是从 `concurrency.ts` 抛的,
 * 不该要求每个调用方都去 import 那两个模块才知道有这回事）。
 */
export const toPasswordAuthError = (err: unknown): PasswordAuthError | null => {
  if (err instanceof PasswordAuthError) return err;
  if (err instanceof PasswordBackendBusy) {
    return new PasswordAuthError(
      'password_backend_busy',
      err.message,
      err.retryAfterSeconds,
    );
  }
  return null;
};
