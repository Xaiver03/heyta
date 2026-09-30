import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isEmailAllowed } from './email-allowlist';
import * as jwt from 'jsonwebtoken';
import {
  verifyEmail,
  replaceToken,
  requestLoginMagicLink,
  verifyLoginMagicLink,
  registerWithMagicLink,
  getJwtSecret,
  JWT_EXPIRY,
} from './auth';
import {
  generateRegistrationOptions,
  verifyRegistration,
  generateAuthenticationOptions,
  verifyAuthentication,
  requestPasskeyRecovery,
  getRecoveryRegistrationOptions,
  completePasskeyRecovery,
  listUserPasskeys,
  deleteUserPasskey,
  renameUserPasskey,
  PASSKEY_NAME_MAX_LENGTH,
  generateUserPasskeyOptions,
  completeUserPasskeyRegistration,
  PasskeyError,
} from './passkey';
import { authenticate, getAuthUser } from './middleware';
import { Logger } from './logger';
import { prisma } from './db';
import { resolveLocale } from './design-html.js';
import type { ServerLocale } from './copy.generated.js';
import { authCache } from './auth-cache';
import { getWsConnectionService } from './sync/services/websocket-connection.service';

// Zod Schemas
const VerifyEmailSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

// Deliberately does not name the Terms of Service: an instance may publish only a
// privacy policy, in which case the consent label reads "I agree to the Privacy Policy"
// and naming a document that is not served would be wrong.
const TERMS_REQUIRED_MESSAGE = 'You must accept the linked legal documents to register';

/**
 * Registration body, with consent required only where legal pages exist. The generic image
 * ships no Terms of Service and publishes no privacy policy until the operator configures
 * `PRIVACY_*`, so an unconfigured instance must not demand agreement to documents it does
 * not serve.
 *
 * `z.literal(true)` rather than `z.boolean().optional().refine(...)` is load-bearing: in
 * zod 4 an issue raised by a refinement on an *optional* field is discarded when the key is
 * absent from the input, so the refinement form accepted `{"email":"..."}` with no consent
 * at all. A required literal has no such hole — an absent key is a type error, not a
 * skipped check. Guarded by tests/legal-pages.spec.ts.
 */
export const buildRegisterBodySchema = (
  requireConsent: boolean,
): z.ZodType<{ email: string; termsAccepted?: boolean; inviteCode?: string }> =>
  z.object({
    email: z.string().email('Invalid email format'),
    termsAccepted: requireConsent
      ? z.literal(true, { message: TERMS_REQUIRED_MESSAGE })
      : z.boolean().optional(),
    // 邀请码。**刻意只校验长度上限，不校验形状** ——
    // 形状不对时该发生的是"这张码不作数，注册照常成功"，而不是一个 400。
    // 在注册入口对码做形状校验，等于把"这张码存在但格式不对"这件事
    // 变成一个可探测的信号；而且用户手里那张码是从别人那里抄来的，
    // 让他因为抄多了一个空格就注册失败，是拿一个附带福利去挡主流程。
    //
    // 上限 64 只是挡明显不像话的输入（真实码 8 位）。归一化在
    // `@heyta/domain` 的 `normalizeInviteCode`，**不在这里**。
    inviteCode: z.string().max(64).optional(),
  });

/**
 * 从请求里解析收件人语言。
 *
 * 顺序与 `design-html.ts` 的 `resolveLocale` 一致：
 *   ① `body.locale`（客户端当前语言，**可选**——客户端不传也完全正常工作）
 *   ② `Accept-Language`（浏览器自动带，覆盖"系统语言"这一档）
 *   ③ 默认 `zh-CN`
 *
 * 🔴 **刻意不改任何 zod schema**：`body.locale` 是可选字段，zod 的 `z.object()`
 * 默认会剥掉未声明的键 —— 也就是说这个字段**不会**进 `parseResult.data`，
 * 但也**不会**让请求失败。加它不需要动 schema，于是也不会与正在改这些
 * schema 的人撞车。（要让它进 `data` 就得改 schema，代价远大于收益。）
 */
const localeFromRequest = (req: {
  body?: unknown;
  headers: Record<string, unknown>;
}): ServerLocale => {
  const body = req.body as { locale?: unknown } | undefined;
  const explicit = typeof body?.locale === 'string' ? body.locale : null;
  const header = req.headers['accept-language'];
  return resolveLocale(explicit, typeof header === 'string' ? header : null);
};

const PasskeyRegisterVerifySchema = z.object({
  email: z.string().email('Invalid email format'),
  credential: z.object({}).passthrough(), // WebAuthn credential response
  // 与 `buildRegisterBodySchema` 同字段、同理由。客户端在 options 与 verify
  // 两次调用里都带上它（`/register/passkey/options` 那次会被 zod 收下但不使用 ——
  // 绑定发生在 verify，因为那时才 User 行）。
  inviteCode: z.string().max(64).optional(),
});

const PasskeyLoginOptionsSchema = z.object({
  email: z.string().email('Invalid email format'),
});

const PasskeyLoginVerifySchema = z.object({
  email: z.string().email('Invalid email format'),
  credential: z.object({}).passthrough(), // WebAuthn credential response
});

const PasskeyRecoveryRequestSchema = z.object({
  email: z.string().email('Invalid email format'),
});

const PasskeyRecoveryOptionsSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

const PasskeyRecoveryCompleteSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  credential: z.object({}).passthrough(), // WebAuthn credential response
});

/**
 * 管理一条**已有**通行密钥时用的行 id。
 *
 * 这是 `Passkey.id`（服务端 cuid），**不是 credential ID** ——
 * 客户端从来没有拿到过 credential ID，也不需要。上限只是挡明显不像话的输入。
 */
const PasskeyIdParamSchema = z.object({
  id: z.string().min(1).max(64),
});

/**
 * 改名请求体。
 *
 * `null` 是**合法值**，表示"去掉名字"（与空串同义 —— 服务层的
 * `normalizePasskeyName` 把两者都归一成 `null`）。
 *
 * ⚠️ 顺序是 `.trim()` 在 `.max()` **之前**：先去掉首尾空白再判长度，
 * 否则一串 200 个空格会因为"太长"被 400 掉，而它其实等于"清空名字"。
 * 长度上限与 `PASSKEY_NAME_MAX_LENGTH` 共用同一个常量 —— 界面、zod、
 * 服务层各写一个字面量迟早漂移，而漂移的样子是"界面让输、服务端 400"。
 */
const PasskeyRenameSchema = z.object({
  name: z.string().trim().max(PASSKEY_NAME_MAX_LENGTH).nullable(),
});

/**
 * 已认证地"再加一条凭据"的完成体。
 *
 * 🔴 只有 `credential` 一个字段，**没有任何"这是谁的凭据"的字段** ——
 * 归属来自令牌（`authenticate` → `getAuthUser`），不来自输入。zod 默认丢弃
 * 未声明键，所以请求体里就算塞了 `userId` / `email` 也**到不了**服务端逻辑。
 * 这一点由 `tests/passkey-enrollment.spec.ts` 的反向 B 用"塞了 userId: 2 之后
 * `passkey.create` 收到的仍然是 1"直接钉住。
 */
const PasskeyEnrollmentCompleteSchema = z.object({
  credential: z.object({}).passthrough(), // WebAuthn credential response
});

// Magic Link Schemas
const MagicLinkRequestSchema = z.object({
  email: z.string().email('Invalid email format'),
});

const MagicLinkVerifySchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

type VerifyEmailBody = z.infer<typeof VerifyEmailSchema>;
type RegisterBody = { email: string; termsAccepted?: boolean };
type PasskeyRegisterOptionsBody = RegisterBody;
type PasskeyRegisterVerifyBody = z.infer<typeof PasskeyRegisterVerifySchema>;
type PasskeyLoginOptionsBody = z.infer<typeof PasskeyLoginOptionsSchema>;
type PasskeyLoginVerifyBody = z.infer<typeof PasskeyLoginVerifySchema>;
type PasskeyRecoveryRequestBody = z.infer<typeof PasskeyRecoveryRequestSchema>;
type PasskeyRecoveryOptionsBody = z.infer<typeof PasskeyRecoveryOptionsSchema>;
type PasskeyRecoveryCompleteBody = z.infer<typeof PasskeyRecoveryCompleteSchema>;
type MagicLinkRegisterBody = RegisterBody;
type MagicLinkRequestBody = z.infer<typeof MagicLinkRequestSchema>;
type MagicLinkVerifyBody = z.infer<typeof MagicLinkVerifySchema>;
type PasskeyIdParams = z.infer<typeof PasskeyIdParamSchema>;
type PasskeyEnrollmentCompleteBody = z.infer<typeof PasskeyEnrollmentCompleteSchema>;

type PasskeyRenameBody = z.infer<typeof PasskeyRenameSchema>;

/**
 * 客户端可见的通行密钥文案。
 *
 * 🔴 这些句子**只**由本层挑选：`passkey.ts` 抛出的 `message` 刻意保持笼统
 * （`Invalid credentials`），判别一律走 `PasskeyError.code`。
 * 句子里不许出现 credential ID / 用户名等可以拿来对号入座的东西。
 */
const PASSKEY_STALE_MESSAGE =
  'This passkey is no longer registered on this server. Add a new passkey or sign in another way.';
const PASSKEY_VERIFICATION_FAILED_MESSAGE = 'Passkey verification failed';
const PASSKEY_NOT_FOUND_FOR_USER_MESSAGE = 'Passkey not found';
const LAST_PASSKEY_MESSAGE =
  'This is your only passkey, so it cannot be removed. Add another passkey first.';
const PASSKEY_ALREADY_REGISTERED_MESSAGE =
  'This passkey is already registered on this account.';
const PASSKEY_NAME_TOO_LONG_MESSAGE = 'Passkey name is too long';

// Known safe error messages that can be shown to clients
const SAFE_ERROR_MESSAGES = new Set([
  'Email not verified',
  'Invalid verification token',
  'Verification token has expired',
  'Registration successful. Please check your email to verify your account.',
  // Passkey-specific messages
  'Challenge expired or not found. Please try again.',
  'Passkey verification failed. Please try again.',
  'Passkey verification failed',
  'If an account with that email exists, a recovery link has been sent.',
  'Invalid or expired recovery token',
  'Passkey has been reset successfully. You can now log in with your new passkey.',
  // Magic link messages
  'If an account with that email exists, a login link has been sent.',
  'Invalid or expired login link',
]);

// Returns a safe error message for clients (hides internal details)
const getSafeErrorMessage = (err: unknown, fallback: string): string => {
  if (err instanceof Error && SAFE_ERROR_MESSAGES.has(err.message)) {
    return err.message;
  }
  return fallback;
};

export interface ApiRoutesOptions {
  /** True when this instance publishes a privacy policy, so consent can be demanded. */
  requireTermsConsent: boolean;
}

export const apiRoutes = async (
  fastify: FastifyInstance,
  opts: ApiRoutesOptions,
): Promise<void> => {
  const PasskeyRegisterOptionsSchema = buildRegisterBodySchema(opts.requireTermsConsent);
  const MagicLinkRegisterSchema = PasskeyRegisterOptionsSchema;

  // Moderate rate limiting for email verification (20 attempts per 15 minutes)
  fastify.post<{ Body: VerifyEmailBody }>(
    '/verify-email',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const parseResult = VerifyEmailSchema.safeParse(req.body);
        if (!parseResult.success) {
          return reply.status(400).send({
            error: 'Validation failed',
            details: parseResult.error.issues,
          });
        }
        const { token } = parseResult.data;

        await verifyEmail(token);
        return reply.send({ message: 'Email verified successfully' });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Verification error: ${errMsg}`);
        return reply.status(400).send({
          error: getSafeErrorMessage(err, 'Verification failed. Please try again.'),
        });
      }
    },
  );

  // Replace JWT token (requires authentication)
  // Use this when a token was accidentally shared or compromised
  fastify.post(
    '/replace-token',
    {
      preHandler: authenticate,
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const user = getAuthUser(req);
        const result = await replaceToken(user.userId, user.email);
        // Sockets authenticate only at upgrade, so revoked tokens would keep
        // receiving op notifications through already-open connections — close
        // them all, the caller's own socket included: a socket's clientId is
        // self-declared and unauthenticated, so sparing "the caller's" socket
        // by id would let a stolen-token client exempt itself by claiming it.
        // The caller reconnects with its fresh token on the next sync cycle.
        // Any request body (legacy clients sent their clientId) is ignored.
        getWsConnectionService().closeForUser(user.userId);
        return reply.send(result);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Token replacement error: ${errMsg}`);
        return reply.status(500).send({
          error: 'Failed to replace token. Please try again.',
        });
      }
    },
  );

  // Delete user account (requires authentication)
  // This permanently deletes the user and all associated data (operations, sync state, devices)
  fastify.delete(
    '/account',
    {
      preHandler: authenticate,
      config: {
        rateLimit: {
          max: 3,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const userId = getAuthUser(req).userId;

        Logger.info(`[user:${userId}] DELETE ACCOUNT requested`);

        // AUTH_CACHE_INVALIDATION: account deletion must not leave a ghost-token window.
        authCache.invalidate(userId);

        // Cascade delete handles: operations, syncState, devices (via Prisma schema)
        await prisma.user.delete({ where: { id: userId } });
        // AUTH_CACHE_INVALIDATION: account deletion must not leave a ghost-token window.
        authCache.invalidate(userId);

        // The cascade removed this user's sync_devices rows, but an open socket
        // keeps answering pings, so the dead-connection branch never reaps it.
        // Its heartbeat touch would then re-INSERT a device row for a user that
        // no longer exists and trip the FK every throttle window. Closed after
        // the delete, not before: with the user row already gone no reconnect
        // can re-authenticate and re-orphan a socket.
        getWsConnectionService().closeForUser(userId);

        Logger.audit({ event: 'USER_ACCOUNT_DELETED', userId });

        return reply.send({ success: true });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Delete account error: ${errMsg}`);
        return reply.status(500).send({
          error: 'Failed to delete account. Please try again.',
        });
      }
    },
  );

  // ============================================
  // PASSKEY ENDPOINTS
  // ============================================

  // Get passkey registration options (for new user signup)
  fastify.post<{ Body: PasskeyRegisterOptionsBody }>(
    '/register/passkey/options',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const parseResult = PasskeyRegisterOptionsSchema.safeParse(req.body);
        if (!parseResult.success) {
          return reply.status(400).send({
            error: 'Validation failed',
            details: parseResult.error.issues,
          });
        }
        const { email } = parseResult.data;

        if (!isEmailAllowed(email)) {
          return reply
            .status(403)
            .send({ error: 'Registration is not allowed for this email address.' });
        }

        const options = await generateRegistrationOptions(email);
        return reply.send(options);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Passkey registration options error: ${errMsg}`);
        return reply.status(400).send({
          error: getSafeErrorMessage(err, 'Failed to generate registration options.'),
        });
      }
    },
  );

  // Verify passkey registration and create user
  fastify.post<{ Body: PasskeyRegisterVerifyBody }>(
    '/register/passkey/verify',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const parseResult = PasskeyRegisterVerifySchema.safeParse(req.body);
        if (!parseResult.success) {
          return reply.status(400).send({
            error: 'Validation failed',
            details: parseResult.error.issues,
          });
        }
        const { email, credential, inviteCode } = parseResult.data;

        if (!isEmailAllowed(email)) {
          return reply
            .status(403)
            .send({ error: 'Registration is not allowed for this email address.' });
        }

        const result = await verifyRegistration(
          email,
          credential as any,
          Date.now(),
          inviteCode,
        );
        return reply.status(201).send(result);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Passkey registration verify error: ${errMsg}`);
        return reply.status(400).send({
          error: getSafeErrorMessage(
            err,
            'Passkey registration failed. Please try again.',
          ),
        });
      }
    },
  );

  // Get passkey authentication options (for login)
  fastify.post<{ Body: PasskeyLoginOptionsBody }>(
    '/login/passkey/options',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const parseResult = PasskeyLoginOptionsSchema.safeParse(req.body);
        if (!parseResult.success) {
          return reply.status(400).send({
            error: 'Validation failed',
            details: parseResult.error.issues,
          });
        }
        const { email } = parseResult.data;

        const options = await generateAuthenticationOptions(email);
        return reply.send(options);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Passkey login options error: ${errMsg}`);
        return reply.status(400).send({
          error: getSafeErrorMessage(err, 'Failed to generate login options.'),
        });
      }
    },
  );

  // Verify passkey authentication and return JWT
  fastify.post<{ Body: PasskeyLoginVerifyBody }>(
    '/login/passkey/verify',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const parseResult = PasskeyLoginVerifySchema.safeParse(req.body);
        if (!parseResult.success) {
          return reply.status(400).send({
            error: 'Validation failed',
            details: parseResult.error.issues,
          });
        }
        const { email, credential } = parseResult.data;

        const userInfo = await verifyAuthentication(email, credential as any);

        // Get token version for JWT
        const user = await prisma.user.findUnique({
          where: { id: userInfo.userId },
          select: { tokenVersion: true },
        });
        const tokenVersion = user?.tokenVersion ?? 0;

        // Sign JWT (same format as password login)
        const token = jwt.sign(
          { userId: userInfo.userId, email: userInfo.email, tokenVersion },
          getJwtSecret(),
          { expiresIn: JWT_EXPIRY },
        );

        return reply.send({
          token,
          user: { id: userInfo.userId, email: userInfo.email },
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Passkey login verify error: ${errMsg}`);
        // ── 缺口 B：让"这条凭据服务端已经不认了"与"凭据被拒"可判别 ──
        //
        // 以前两种情况都是 401 `Authentication failed`，用户分不清
        // "设备上这条旧密钥已经失效，请重新注册/换登录方式"和
        // "刚建的新密钥验不过"。
        //
        // ## 泄露取舍（明确写下，因为这不是显然的）
        //
        // 这个端点**未认证**：任何人都能先要一个 challenge，再拿一个
        // credential ID 来换这个码，从而判断该 credential ID 是否在本实例注册过。
        // 也就是说 `passkey_not_found` 确实是一个**以已知 credential ID 为键的
        // 存在性预言机**。
        //
        // 选择暴露它，理由：
        //   1. credential ID 不是秘密。它每次登录都明文出现在断言响应里，
        //      也存在浏览器凭据库里；规范从不把它当作需要保密的数据
        //      （要保密的是公钥之外不足以伪造签名的部分，以及签名本身）。
        //   2. 它不是**可枚举**的：32 字节随机值，攻击者必须先知道某一个
        //      credential ID 才能问出关于它的一个比特。而如果他已经知道这个
        //      credential ID，他能得到的也只是"它还注册着没有"。
        //   3. 不暴露的代价是真实的：用户会一直重试一条永远不可能成功的
        //      旧凭据，或者误以为自己的新凭据坏了 —— 这正是我们要修的缺陷。
        //
        // 备选方案是保持统一 401，把判别信号放到"已经认证过的列表接口"
        // （见 GET /passkeys）。放弃它的原因：那个信号是**事后**的 ——
        // 用户是在**登录失败的那一刻**需要知道该换登录方式还是该重注册，
        // 而不是登进去以后。
        //
        // 措辞上仍然只给一句可执行的建议，不回显 credential ID、
        // 不区分"不存在"与"属于别的账号"（后者在这个端点上本来也查不到）。
        if (err instanceof PasskeyError && err.code === 'passkey_not_found') {
          return reply.status(401).send({
            error: PASSKEY_STALE_MESSAGE,
            code: 'passkey_not_found',
          });
        }
        if (err instanceof PasskeyError && err.code === 'passkey_verification_failed') {
          return reply.status(401).send({
            error: PASSKEY_VERIFICATION_FAILED_MESSAGE,
            code: 'passkey_verification_failed',
          });
        }
        return reply.status(401).send({
          error: getSafeErrorMessage(err, 'Authentication failed'),
        });
      }
    },
  );

  // Request passkey recovery (sends magic link)
  fastify.post<{ Body: PasskeyRecoveryRequestBody }>(
    '/recover/passkey',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const parseResult = PasskeyRecoveryRequestSchema.safeParse(req.body);
        if (!parseResult.success) {
          return reply.status(400).send({
            error: 'Validation failed',
            details: parseResult.error.issues,
          });
        }
        const { email } = parseResult.data;

        const result = await requestPasskeyRecovery(email, localeFromRequest(req));
        return reply.send(result);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Passkey recovery request error: ${errMsg}`);
        return reply.status(400).send({
          error: getSafeErrorMessage(err, 'Recovery request failed. Please try again.'),
        });
      }
    },
  );

  // Get registration options for passkey recovery
  fastify.post<{ Body: PasskeyRecoveryOptionsBody }>(
    '/recover/passkey/options',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const parseResult = PasskeyRecoveryOptionsSchema.safeParse(req.body);
        if (!parseResult.success) {
          return reply.status(400).send({
            error: 'Validation failed',
            details: parseResult.error.issues,
          });
        }
        const { token } = parseResult.data;

        const result = await getRecoveryRegistrationOptions(token);
        return reply.send(result);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Passkey recovery options error: ${errMsg}`);
        return reply.status(400).send({
          error: getSafeErrorMessage(err, 'Invalid or expired recovery token'),
        });
      }
    },
  );

  // Complete passkey recovery (register new passkey)
  fastify.post<{ Body: PasskeyRecoveryCompleteBody }>(
    '/recover/passkey/complete',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const parseResult = PasskeyRecoveryCompleteSchema.safeParse(req.body);
        if (!parseResult.success) {
          return reply.status(400).send({
            error: 'Validation failed',
            details: parseResult.error.issues,
          });
        }
        const { token, credential } = parseResult.data;

        const result = await completePasskeyRecovery(token, credential as any);
        return reply.send(result);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Passkey recovery complete error: ${errMsg}`);
        return reply.status(400).send({
          error: getSafeErrorMessage(err, 'Passkey recovery failed. Please try again.'),
        });
      }
    },
  );

  // ============================================
  // PASSKEY MANAGEMENT ENDPOINTS (self-service)
  // ============================================
  //
  // 服务端此前只有注册 / 登录 / 恢复三组端点，**没有任何"看我自己的凭据 /
  // 删掉一条"的入口**。恢复流程是"注册新凭据 + 删掉全部旧凭据"的全量覆盖，
  // 不是管理：用户丢了一台设备时，既看不到自己还有哪些凭据，
  // 也删不掉一条已知丢失/泄露的凭据。
  //
  // 两条路由都 `preHandler: authenticate`：作用域是**令牌的主人**，
  // 请求体里没有任何"这是谁的凭据"的字段 —— 归属永远来自认证结果，
  // 不来自输入。这样就不存在"改个 userId 参数去删别人的"这种形状。

  // List the caller's own passkeys
  fastify.get(
    '/passkeys',
    {
      preHandler: authenticate,
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const { userId } = getAuthUser(req);
        const passkeys = await listUserPasskeys(userId);
        // `{ passkeys: [...] }` 而不是裸数组：裸数组以后想加分页/游标
        // 就是破坏性变更，而包一层不是。
        return reply.send({ passkeys });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Passkey list error: ${errMsg}`);
        return reply.status(500).send({ error: 'Failed to load passkeys.' });
      }
    },
  );

  // Delete one of the caller's own passkeys
  fastify.delete<{ Params: PasskeyIdParams }>(
    '/passkeys/:id',
    {
      preHandler: authenticate,
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      const parsedParams = PasskeyIdParamSchema.safeParse(req.params);
      if (!parsedParams.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parsedParams.error.issues,
        });
      }

      try {
        const { userId } = getAuthUser(req);
        await deleteUserPasskey(userId, parsedParams.data.id);
        return reply.send({ success: true });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Passkey delete error: ${errMsg}`);

        // 🔴 别人的凭据 → 404，**不是** 403。
        // 403 会说"这条 id 存在，但不归你" —— 那就是一个存在性预言机。
        // 404 让"不是你的"和"不存在"完全同形（`passkey.ts` 里两者
        // 抛的是同一个码）。
        if (err instanceof PasskeyError && err.code === 'passkey_not_found_for_user') {
          return reply.status(404).send({
            error: PASSKEY_NOT_FOUND_FOR_USER_MESSAGE,
            code: 'passkey_not_found_for_user',
          });
        }
        // 最后一条 → 409 + 可判别码，让界面说"先加一条新的"，
        // 而不是把一个 500 或者静默失败呈现给用户。
        if (err instanceof PasskeyError && err.code === 'last_passkey_required') {
          return reply.status(409).send({
            error: LAST_PASSKEY_MESSAGE,
            code: 'last_passkey_required',
          });
        }
        return reply.status(500).send({ error: 'Failed to delete passkey.' });
      }
    },
  );

  // Rename one of the caller's own passkeys（或去掉名字 —— `name: null`）
  //
  // 为什么需要它：设置页同时支持"再加一条"和"删一条"，而一条凭据能展示的
  // 只有创建时间与最后使用时间。同一台设备反复加过几条之后，用户没有任何
  // 办法分辨"要删的是哪一条" —— 在"至少留一条，否则账号会被锁死"的规则下，
  // 删错一条是有代价的。
  fastify.patch<{ Params: PasskeyIdParams }>(
    '/passkeys/:id',
    {
      preHandler: authenticate,
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      const parsedParams = PasskeyIdParamSchema.safeParse(req.params);
      if (!parsedParams.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parsedParams.error.issues,
        });
      }

      const parsedBody = PasskeyRenameSchema.safeParse(req.body);
      if (!parsedBody.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parsedBody.error.issues,
        });
      }

      try {
        const { userId } = getAuthUser(req);
        await renameUserPasskey(userId, parsedParams.data.id, parsedBody.data.name);
        // 不回传改名后的对象：界面的真相来自重新拉取列表
        // （见 `passkeysStore.rename` 的注释）。
        return reply.send({ success: true });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Passkey rename error: ${errMsg}`);

        // 与删除**逐字节相同**的 404：别人的凭据与不存在的凭据不可区分。
        // 这里多一个不同的码（或者换成 403）就等于把 404 那条纪律作废。
        if (err instanceof PasskeyError && err.code === 'passkey_not_found_for_user') {
          return reply.status(404).send({
            error: PASSKEY_NOT_FOUND_FOR_USER_MESSAGE,
            code: 'passkey_not_found_for_user',
          });
        }
        // zod 已经挡了正常输入；这是绕过 HTTP 的调用方才撞得到的兜底。
        if (err instanceof PasskeyError && err.code === 'passkey_name_too_long') {
          return reply.status(400).send({
            error: PASSKEY_NAME_TOO_LONG_MESSAGE,
            code: 'passkey_name_too_long',
          });
        }
        return reply.status(500).send({ error: 'Failed to rename passkey.' });
      }
    },
  );

  // ── 已认证地给当前账号「再加一条」凭据 ──────────────────────
  //
  // 为什么不是让已登录用户复用 `/register/passkey/*`：`verifyRegistration`
  // 对"email 已属于一个已验证账号"**故意**提前返回成功（防枚举）而**不写
  // 任何凭据**，所以那条路对已登录用户是静默空操作 —— 界面说成功、新凭据
  // 不存在。设置页让"删最后一条"被拒的用户"先添加一条新的"，用户照做后
  // 删掉旧的，就再也登不进去。这两条路由就是那条真正会写库的通路。
  //
  // 🔴 两条都 `preHandler: authenticate`，作用域是**令牌的主人**；
  // 请求体里没有任何字段能指定归属（见 PasskeyEnrollmentCompleteSchema）。

  // Step 1: registration options for the signed-in account
  fastify.post(
    '/passkeys/registration/options',
    {
      preHandler: authenticate,
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const { userId } = getAuthUser(req);
        const options = await generateUserPasskeyOptions(userId);
        return reply.send(options);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`User passkey options error: ${errMsg}`);
        // 令牌有效但账号已不在：401 + 可判别码，客户端据此提示重新登录。
        if (err instanceof PasskeyError && err.code === 'passkey_not_found_for_user') {
          return reply.status(401).send({
            error: 'Account not found',
            code: 'passkey_not_found_for_user',
          });
        }
        return reply.status(400).send({
          error: getSafeErrorMessage(err, 'Failed to generate registration options.'),
        });
      }
    },
  );

  // Step 2: verify the credential and WRITE the passkey onto the signed-in user
  fastify.post<{ Body: PasskeyEnrollmentCompleteBody }>(
    '/passkeys/registration/complete',
    {
      preHandler: authenticate,
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      const parseResult = PasskeyEnrollmentCompleteSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.issues,
        });
      }

      try {
        const { userId } = getAuthUser(req);
        const result = await completeUserPasskeyRegistration(
          userId,
          parseResult.data.credential as never,
        );
        // 200 而不是 201：客户端只关心"这条凭据现在在账号上了"，
        // 而"成功 ⟺ 真的写入"由 completeUserPasskeyRegistration 保证。
        return reply.send(result);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`User passkey registration error: ${errMsg}`);

        if (err instanceof PasskeyError && err.code === 'passkey_already_registered') {
          return reply.status(409).send({
            error: PASSKEY_ALREADY_REGISTERED_MESSAGE,
            code: 'passkey_already_registered',
          });
        }
        if (err instanceof PasskeyError && err.code === 'passkey_verification_failed') {
          return reply.status(400).send({
            error: PASSKEY_VERIFICATION_FAILED_MESSAGE,
            code: 'passkey_verification_failed',
          });
        }
        return reply.status(400).send({
          error: getSafeErrorMessage(err, 'Passkey registration failed. Please try again.'),
        });
      }
    },
  );

  // ============================================
  // MAGIC LINK ENDPOINTS
  // ============================================

  // Register with magic link (email-only, no passkey)
  fastify.post<{ Body: MagicLinkRegisterBody }>(
    '/register/magic-link',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const parseResult = MagicLinkRegisterSchema.safeParse(req.body);
        if (!parseResult.success) {
          return reply.status(400).send({
            error: 'Validation failed',
            details: parseResult.error.issues,
          });
        }
        const { email, inviteCode } = parseResult.data;

        if (!isEmailAllowed(email)) {
          return reply
            .status(403)
            .send({ error: 'Registration is not allowed for this email address.' });
        }

        const result = await registerWithMagicLink(email, Date.now(), inviteCode, localeFromRequest(req));
        return reply.status(201).send(result);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Magic link registration error: ${errMsg}`);
        return reply.status(400).send({
          error: getSafeErrorMessage(err, 'Registration failed. Please try again.'),
        });
      }
    },
  );

  // Request magic link login email
  fastify.post<{ Body: MagicLinkRequestBody }>(
    '/login/magic-link',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const parseResult = MagicLinkRequestSchema.safeParse(req.body);
        if (!parseResult.success) {
          return reply.status(400).send({
            error: 'Validation failed',
            details: parseResult.error.issues,
          });
        }
        const { email } = parseResult.data;

        const result = await requestLoginMagicLink(email, localeFromRequest(req));
        return reply.send(result);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Magic link request error: ${errMsg}`);
        return reply.status(400).send({
          error: getSafeErrorMessage(err, 'Failed to send login link. Please try again.'),
        });
      }
    },
  );

  // Verify magic link token and return JWT
  fastify.post<{ Body: MagicLinkVerifyBody }>(
    '/login/magic-link/verify',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const parseResult = MagicLinkVerifySchema.safeParse(req.body);
        if (!parseResult.success) {
          return reply.status(400).send({
            error: 'Validation failed',
            details: parseResult.error.issues,
          });
        }
        const { token } = parseResult.data;

        const result = await verifyLoginMagicLink(token);
        return reply.send(result);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Magic link verify error: ${errMsg}`);
        return reply.status(401).send({
          error: getSafeErrorMessage(err, 'Invalid or expired login link'),
        });
      }
    },
  );
};
