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
import { prisma } from '../db';
import { Logger } from '../logger';
import { issueSession, registerWithMagicLink } from '../auth';
import type { ServerLocale } from '../copy.generated.js';
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

export type PasswordAuthErrorCode =
  /** 账号不存在、没设口令、口令不对 —— 🔴 三者**故意同一个码同一句话**。 */
  | 'invalid_credentials'
  /** 口令对了但邮箱还没验证。只在口令已验证为真后才可能返回。 */
  | 'email_not_verified'
  /** 口令认证器被临时锁定（账号本身仍可用其它方式登录）。 */
  | 'account_locked'
  /** 新口令不满足策略（长度 / 常见 / 已泄露）。 */
  | 'password_policy_violation'
  /** 哈希后端过载 ⇒ 503，**不降级**（见 `concurrency.ts`）。 */
  | 'password_backend_busy';

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
 */
const hashFor = (normalized: string): Promise<string> => withHashSlot(() => hashPassword(normalized));

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
): Promise<{ message: string }> => {
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

const recordFailedAttempt = async (userId: number): Promise<void> => {
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

const clearFailedAttempts = (userId: number): Promise<unknown> =>
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
): Promise<LoginResult> => {
  const normalized = normalizePassword(password);
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
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
    token: issueSession(user),
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
