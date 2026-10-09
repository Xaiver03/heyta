import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AUTH_PASSWORD_PATHS, SuperSyncClientIdSchema, inboundDraftEventIdSchema, inboundDraftDecisionSchema } from '@heyta/shared-schema';
import { isEmailAllowed } from './email-allowlist';
import * as jwt from 'jsonwebtoken';
import {
  verifyEmail,
  replaceToken,
  requestLoginMagicLink,
  verifyLoginMagicLink,
  verifyEmailLink,
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
import { withAccountProfile } from './account/account-profile.store';
import { deleteAccountWithTombstone } from './account/account-tombstones';
import { evaluateLegalRecheck, recordLegalReconfirm } from './legal-recheck';
import {
  loginWithEmailPassword,
  registerWithEmailPassword,
  setInitialPassword,
  toPasswordAuthError,
  PasswordAuthError,
  LOGIN_LOCKOUT_MS,
  PASSWORD_ACCOUNT_LOCKED_MESSAGE,
  PASSWORD_EMAIL_NOT_VERIFIED_MESSAGE,
  PASSWORD_INVALID_CREDENTIALS_MESSAGE,
  PASSWORD_INVALID_RESET_LINK_MESSAGE,
  PASSWORD_POLICY_MESSAGE,
  PASSWORD_ALREADY_SET_MESSAGE,
  type PasswordAuthErrorCode,
} from './password/service';
import {
  PASSWORD_RESET_REQUEST_MESSAGE,
  PASSWORD_NOT_SET_MESSAGE,
  changePassword,
  requestPasswordReset,
  resetPasswordWithToken,
} from './password/recovery';
import { MAX_PASSWORD_CODE_POINTS, type PasswordPolicyCode } from './password/policy';
import { PASSWORD_BACKEND_RETRY_AFTER_SECONDS } from './password/concurrency';
import { Logger } from './logger';
import { prisma } from './db';
import { asServerLocale, resolveLocale } from './design-html.js';
import { SERVER_LOCALES, type ServerLocale } from './copy.generated.js';
import { authCache } from './auth-cache';
import { getWsConnectionService } from './sync/services/websocket-connection.service';
import { AutomationWriteAuthorizationError, createEntitlementGuard, readAutomationEntitlementTicketHeader, replyAutomationRejection, resolveAutomationEntitlementMode } from './entitlement';
import { issueAutomationCommitPermit, readInboundUploadIdentity, registerAutomationWorker, revokeAutomationWorker } from './automation/worker-identity';
import { createAutomationRule, deleteAutomationRule, listAutomationRules, setAutomationRuleEnabled, updateAutomationRuleConfig } from './automation/rules';
import { claimAutomationEvent, listAutomationEvents, publishAutomationResult, readAutomationPreparedResult, renewAutomationLease, retryUncertainAutomationEvent, readAutomationDraft, decideAutomationDraft } from './automation/events';
import { advanceAutomationAiAttempt, reserveAutomationAiAttempt } from './automation/ai-metering';
import { issueSenderCredential, listSenderCredentials, revokeSenderCredential } from './automation/sender-credentials';
import { AUTOMATION_ENTITLEMENT_ACTIONS, AutomationEntitlementError, redeemAutomationEntitlementTicket } from './automation/entitlement-ticket';
import {
  AutomationIssuerError,
  AUTOMATION_ISSUER_DENIALS,
  bumpAutomationRevocationFloor,
  applyAutomationRevocationManifest,
  ensureAutomationEntitlementSubject,
  issueAutomationEntitlementActivation,
  loadAutomationEntitlementIssuer,
  readAutomationRevocationFloor,
  redeemAutomationEntitlementActivation,
  revokeAutomationEntitlementLink,
  loadEffectiveAutomationKeyring,
  signAutomationEntitlementSessionTicket,
  signAutomationEntitlementActionTicket,
  signAutomationRevocationManifest,
  type AutomationEntitlementIssuer,
} from './automation/entitlement-issuer';
import { requireAdmin } from './admin/admin.middleware';

// Zod Schemas
const VerifyEmailSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

// Deliberately does not name the Terms of Service: an instance may publish only a
// privacy policy, in which case the consent label reads "I agree to the Privacy Policy"
// and naming a document that is not served would be wrong.
const TERMS_REQUIRED_MESSAGE = 'You must accept the linked legal documents to register';

const AutomationWorkerRegisterSchema = z.object({
  clientId: SuperSyncClientIdSchema,
  databaseEpoch: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
}).strict();
const AutomationEntitlementTicketSchema = z.object({
  ticket: z.string().min(1).max(8192),
  localAccountUuid: z.string().uuid(),
}).strict();
const AutomationInstallationSchema = z.object({ installationId: z.string().uuid() }).strict();
const AutomationActionTicketSchema = z.object({
  installationId: z.string().uuid(),
  action: z.enum(AUTOMATION_ENTITLEMENT_ACTIONS),
  ruleId: z.string().uuid().optional(),
  eventId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/).optional(),
}).strict();
const AutomationActivationRedeemSchema = z.object({
  code: z.string().min(20).max(64),
  installationId: z.string().uuid(),
  localAccountUuid: z.string().uuid(),
}).strict();
const AutomationRevocationManifestBodySchema = z.object({ manifest: z.string().min(1).max(8192) }).strict();
const AutomationRevocationBumpSchema = z.object({ revocationVersion: z.number().int().nonnegative().max(1_000_000) }).strict();
const AutomationWorkerRevokeSchema = z.object({ workerId: z.string().uuid() }).strict();
const AutomationCommitPermitSchema = z.object({
  clientId: SuperSyncClientIdSchema,
  databaseEpoch: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
  eventId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/),
  opId: z.string().regex(/^inbound:[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/),
  ruleId: z.string().uuid(),
  ruleVersion: z.number().int().min(1),
  parseVersion: z.number().int().min(1),
  resultDigest: z.string().regex(/^[0-9a-f]{64}$/),
  itemCount: z.number().int().min(1).max(50),
}).strict();
const AutomationRuleFieldsSchema = z.array(z.enum(['title', 'note', 'priority', 'projectId', 'dueDate', 'startDate', 'durationMinutes'])).min(1).max(7);
const AutomationRuleConfigSchema = z.object({
  allowedFields: AutomationRuleFieldsSchema.optional(),
  targetProjectId: z.string().max(128).nullable().optional(),
  timezone: z.string().max(128).nullable().optional(),
  parseVersion: z.number().int().min(1).optional(),
  maxItems: z.number().int().min(1).max(50).optional(),
}).strict();
const AutomationRuleCreateSchema = z.object({ keyId: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/), ...AutomationRuleConfigSchema.shape }).strict();
const AutomationRuleEnabledSchema = z.object({ enabled: z.boolean() }).strict();
const AutomationRuleConfigUpdateSchema = AutomationRuleConfigSchema;
const AutomationRuleParamsSchema = z.object({ ruleId: z.string().uuid() }).strict();
const AutomationSenderCredentialSchema = z.object({ keyId: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/) }).strict();
const AutomationSenderRevokeSchema = z.object({ credentialId: z.string().uuid() }).strict();
const AutomationRecipientKeySchema = z.object({
  keyEpoch: z.number().int().min(1),
  publicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  packageVersion: z.number().int().min(1),
  expectedPackageVersion: z.number().int().min(0).nullable(),
}).strict();
const AutomationClaimSchema = z.object({
  clientId: SuperSyncClientIdSchema,
  eventId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/).optional(),
}).strict();
const AutomationLeaseSchema = z.object({
  clientId: SuperSyncClientIdSchema,
  leaseGeneration: z.number().int().min(1),
}).strict();
const AutomationResultSchema = AutomationLeaseSchema.extend({
  parseVersion: z.number().int().min(1),
  itemCount: z.number().int().min(1).max(50),
  resultDigest: z.string().regex(/^[0-9a-f]{64}$/),
  resultCiphertext: z.string().min(1).max(1_000_000),
  needsConfirmation: z.boolean().optional(),
}).strict();
const AutomationAiAttemptBaseSchema = z.object({
  clientId: SuperSyncClientIdSchema,
  ruleId: z.string().uuid(),
  parseVersion: z.number().int().min(1),
  attempt: z.number().int().min(1),
  leaseGeneration: z.number().int().min(1),
}).strict();
const AutomationAiReserveSchema = AutomationAiAttemptBaseSchema.extend({
  billingSource: z.enum(['local', 'direct', 'managed']),
}).strict();
const AutomationAiStateSchema = AutomationAiAttemptBaseSchema.extend({
  from: z.enum(['reserved', 'sent', 'consumed', 'released', 'unknown']),
  to: z.enum(['reserved', 'sent', 'consumed', 'released', 'unknown']),
}).strict();

/**
 * 注册请求体的**共同字段** —— 通行密钥、魔法链接、邮箱+口令三条路共用一份，
 * 因为"同意条款"这件事只有一种正确写法（见 `buildRegisterBodySchema` 上那段），
 * 复制三遍迟早有一遍会写成 `z.boolean().optional()`。
 */
const buildRegisterBodyShape = (requireConsent: boolean) => ({
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
  z.object(buildRegisterBodyShape(requireConsent));

/**
 * 口令在**传输层**的上限，刻意比**策略层**宽，而且是从策略常量推导出来的。
 *
 * 两层都以 **code point** 计（实测：zod 4.6.5 的 `.max()` 数的是码点，不是 UTF-16
 * 单元 —— `z.string().max(8)` 对 5 个 emoji 是放行的）。这里的 `×2` 因此**不是**
 * 单位换算，而是"把用户能看见的那句话留给策略层"：
 *
 * 🔴 超过 `MAX_PASSWORD_CODE_POINTS` 的口令应该拿到
 * `400 + code=password_policy_violation + policyCode=too_long`，而不是 zod 那句
 * `Validation failed` —— 后者没有 `code`，客户端按词条表翻不出任何有意义的提示。
 * 所以传输线必须**在策略线之外**，它只负责挡住"拿 10 MB 字符串来哈希"这种体积攻击。
 * 长度是否合规**只由 `password/policy.ts` 裁决**，它给出可判别的 `code`。
 * 这里的 `min(1)` 只负责"这个字段得在"，不判定强度。
 */
const PASSWORD_TRANSPORT_MAX = MAX_PASSWORD_CODE_POINTS * 2;

const PasswordSchema = z.string().min(1, 'Password is required').max(PASSWORD_TRANSPORT_MAX);

const EmailPasswordLoginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: PasswordSchema,
});

/** 申请重置。**只有邮箱** —— 新口令在 `/password/reset` 那一步才出现。 */
const PasswordForgotSchema = z.object({
  email: z.string().email('Invalid email format'),
});

/**
 * 重置：链接里的令牌 + 新口令。
 *
 * `token` 只判"在不在"，**不判形状**（64 位十六进制之类）。理由与 `PasswordSchema`
 * 那条同源：形状规则属于签发方（`recovery.ts`），写在这里就是第二套事实源；
 * 而形状不对的最终裁决是"库里查不到这枚哈希" ⇒ 同一句 `invalid_reset_link`。
 * 在这里加一条正则只会把"将来换了令牌生成方式"变成"两处要同步改"。
 */
const PasswordResetSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  password: PasswordSchema,
});

/**
 * 改密：当前口令 + 新口令。
 *
 * 🔴 两个字段都**不**在这里判强度。当前口令是老值（用户当年可能设得比现在松），
 * 在这里套策略会让**改密这件事本身**变成一条"用新规则拒绝老口令"的路 ——
 * 正确动作是"接受当前口令、只对**新**口令跑策略"（在 `changePassword` 里）。
 */
const PasswordChangeSchema = z.object({
  currentPassword: PasswordSchema,
  newPassword: PasswordSchema,
});

/**
 * 设**第一个**口令：只有一个新口令字段 —— 没有"当前口令"可验，那个账号从来没有过口令。
 *
 * 与上面那条同样是**不判强度**的：长度/常见/泄露由 `setInitialPassword` 里的
 * `checkNewPassword` 权威裁决（两套规则迟早给出两个答案）。
 */
const PasswordSetSchema = z.object({
  newPassword: PasswordSchema,
});

/**
 * 从请求里解析收件人语言。
 *
 * 顺序与 `design-html.ts` 的 `resolveLocale` 一致：
 *   ① `body.locale`（客户端当前界面语言，**可选**——客户端不传也完全正常工作）
 *   ② 默认 `zh-CN`
 *
 * 🔴 **刻意不改任何 zod schema**：`body.locale` 是可选字段，zod 的 `z.object()`
 * 默认会剥掉未声明的键 —— 也就是说这个字段**不会**进 `parseResult.data`，
 * 但也**不会**让请求失败。加它不需要动 schema，于是也不会与正在改这些
 * schema 的人撞车。（要让它进 `data` 就得改 schema，代价远大于收益。）
 */
const localeFromRequest = (req: { body?: unknown }): ServerLocale => {
  const body = req.body as { locale?: unknown } | undefined;
  return resolveLocale(typeof body?.locale === 'string' ? body.locale : null);
};

/**
 * 🔴 **发信端点的语言优先级**（2026-10-01 定，2026-10-03 产品负责人改判）：
 *
 *   ① `body.locale` —— 客户端当前界面语言（显式、最新鲜）
 *   ② **账号语言**（`users.locale`，按收件邮箱查）—— 用户在别的设备登录态下设过
 *   ③ 默认 `zh-CN`
 *
 * ② 只在 ① 缺失时生效：客户端带上 `locale` 就说明用户此刻看着那种语言的界面，
 * 比（可能陈旧的）账号行更新鲜。
 *
 * 🔴 **`Accept-Language` 这一档已删**（2026-10-03）：拍板口径是「默认中文，除非
 * 用户登录之后改成英文、或一开始就选了英文」。浏览器语言不是选择，是环境噪声，
 * 而它当时正把中文界面注册的人的第一封邮件渲染成英文。原来那条"② 高于 ③"的
 * 理由（账号语言是明确选择、浏览器语言不是）现在推得更远：**只有明确选择参与**。
 *
 * 多一次 `findUnique` 是可接受的：发信端点都是稀疏、限流的用户动作。
 */
const localeForEmail = async (
  req: { body?: unknown },
  email: string,
): Promise<ServerLocale> => {
  const body = req.body as { locale?: unknown } | undefined;
  if (typeof body?.locale === 'string' && (SERVER_LOCALES as readonly string[]).includes(body.locale)) {
    return body.locale as ServerLocale;
  }
  const account = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { locale: true },
  });
  const fromAccount = asServerLocale(account?.locale);
  if (fromAccount !== undefined) return fromAccount;
  // 尾部与 localeFromRequest 相同（显式无效时它会落到 header / 默认）。
  return localeFromRequest(req);
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
type EmailPasswordRegisterBody = RegisterBody & { password: string };
type EmailPasswordLoginBody = z.infer<typeof EmailPasswordLoginSchema>;
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

/**
 * 口令那条路的其余客户端文案**不在这里** —— 唯一真源在
 * `password/service.ts` 的 `PASSWORD_*_MESSAGE`（路由按 `code` 挑状态码，句子原样发出）。
 *
 * 这一句是**例外**，因为它对应的抛出点没有码：`concurrency.ts` 的
 * `PasswordBackendBusy.message` 是一句技术描述（哪个闸门满了、排了多少），
 * 而 `toPasswordAuthError` 把它原样带进 `PasswordAuthError.message`。
 * 直接透传给客户端等于泄露内部容量语义，所以路由层给一句自己的话。
 */
const PASSWORD_BACKEND_BUSY_MESSAGE =
  'Too many sign-in requests are being processed. Please try again.';

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

/** 口令认证失败的 HTTP 表达（`passwordAuthResponseOf` 的输出）。 */
export interface PasswordAuthResponse {
  status: number;
  body: {
    error: string;
    code: PasswordAuthErrorCode;
    policyCode?: PasswordPolicyCode;
  };
  /** 只在需要 `Retry-After` 的两种失败上出现。 */
  retryAfterSeconds?: number;
}

/**
 * 口令错误的**唯一**映射表 —— 注册与登录两个端点共用一份。
 *
 * 🔴 写成一份纯函数（算出状态码 + 响应体）而不是在两处 `catch` 里各摆一串 `if`，
 * 理由与 `issueSession` 同源：状态码是"锁不锁得对、退避退得对"的承载者，
 * 两处各写一遍迟早出现"登录路给 429、注册路给 400"这种同码不同命。
 * 判别信号是 `code`（客户端按它取词条，见 `passkey.ts` 对 `PasskeyErrorCode` 的同款约定）。
 *
 * 刻意**不碰 `reply`**：这样五个码的映射能用普通断言逐个钉住，不需要起 Fastify。
 * 而且 `switch` 覆盖了整个联合类型**且没有 `default`** —— 以后新增一个码而忘了给
 * 状态码，编译期就红，不会静默落到某个兜底分支上。
 *
 * 三个状态码的选择都不是显然，所以逐个写下理由：
 *
 * - `account_locked` ⇒ **429 + `Retry-After`**，不用 423。
 *   423 `Locked` 是 WebDAV 的方法语义，代理与客户端库普遍不认识它，
 *   而这里的真实语义是"因太多尝试而暂时不行，N 秒后再来" —— 那正好是 429
 *   与 `Retry-After` 的定义。锁的是**口令这个认证器**，不是账号（魔法链接
 *   与通行密钥照旧可走），所以也不许读成"账号被封"。
 * - `password_backend_busy` ⇒ **503**，不用 429。
 *   闸门满是**我们的容量**问题，不是这个客户端发得太猛。报成 429 会让
 *   客户端退避策略去惩罚一个无辜用户（"你慢点试"），而正确答案是我们
 *   降并发或扩容。503 + `Retry-After` 说的是"我这儿满了"。
 * - `email_not_verified` ⇒ **403**，不用 401。
 *   口令**已经验对了** —— 凭证没问题，所以 401（"重来一次也许就对了"）
 *   是错的暗示；缺的是"去收那封验证邮件"这一步。而这句话本身说出了账号状态，
 *   所以它只允许在校验口令通过之后出现（顺序钉在 `password/service.ts`）。
 */
export const passwordAuthResponseOf = (pwErr: PasswordAuthError): PasswordAuthResponse => {
  switch (pwErr.code) {
    case 'account_locked':
      return {
        status: 429,
        retryAfterSeconds: pwErr.retryAfterSeconds ?? Math.ceil(LOGIN_LOCKOUT_MS / 1000),
        body: { error: PASSWORD_ACCOUNT_LOCKED_MESSAGE, code: pwErr.code },
      };
    case 'password_backend_busy':
      return {
        status: 503,
        retryAfterSeconds: pwErr.retryAfterSeconds ?? PASSWORD_BACKEND_RETRY_AFTER_SECONDS,
        body: { error: PASSWORD_BACKEND_BUSY_MESSAGE, code: pwErr.code },
      };
    case 'email_not_verified':
      return {
        status: 403,
        body: { error: PASSWORD_EMAIL_NOT_VERIFIED_MESSAGE, code: pwErr.code },
      };
    case 'invalid_reset_link':
      // 400，不用 401/403：这不是"你没证明你是谁"，是"这个链接本身不成"。
      // 报 401 会让通用 HTTP 层把它读成"重新认证一次"（而客户端会重放同一个链接 → 死循环），
      // 报 403 是在说"你的账号不许做这件事" —— 也不对。
      return {
        status: 400,
        body: { error: PASSWORD_INVALID_RESET_LINK_MESSAGE, code: pwErr.code },
      };
    case 'no_password_set':
      // 与 `invalid_reset_link` 同为 400（都是"这条路走不通"），但**句子与 code 不同** ——
      // 界面据 code 换 CTA：这句要把人导向「设置登录密码」（`/password/set`），
      // 那句要他回去重新点一次链接。
      // ⚠️ 旧版本这里写的是"导向「忘记密码」" —— 那是一条**不存在的出路**：
      // `requestPasswordReset` 对没有口令认证器的账号根本不发信。
      return {
        status: 400,
        body: { error: PASSWORD_NOT_SET_MESSAGE, code: pwErr.code },
      };
    case 'password_already_set':
      // 同为 400：也是"这条路走不通"，但方向相反 —— 该走 `change`。
      // 不给 403 是因为它读的像"你的账号不许做这件事"，而真相是"这个账号已经有口令"。
      return {
        status: 400,
        body: { error: PASSWORD_ALREADY_SET_MESSAGE, code: pwErr.code },
      };
    case 'password_policy_violation':
      return {
        status: 400,
        // 具体是哪条规则（太短 / 太常见 / 已泄露）由客户端按 `policyCode` 取词条 ——
        // 设口令时只说"口令不符合要求"而不给动作，等于没说。
        body: {
          error: PASSWORD_POLICY_MESSAGE,
          code: pwErr.code,
          policyCode: pwErr.policyCode,
        },
      };
    case 'invalid_credentials':
      return {
        status: 401,
        body: { error: PASSWORD_INVALID_CREDENTIALS_MESSAGE, code: pwErr.code },
      };
  }
};

/** 把上面那份决定施加到响应上。除了 `Retry-After` 的写法，这里不该有判断。 */
const sendPasswordAuthError = (reply: FastifyReply, pwErr: PasswordAuthError): unknown => {
  const res = passwordAuthResponseOf(pwErr);
  if (res.retryAfterSeconds !== undefined) {
    reply.header('retry-after', String(res.retryAfterSeconds));
  }
  return reply.status(res.status).send(res.body);
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
  const RegistrationChallengeRequestSchema = z.object({
    ...buildRegisterBodyShape(opts.requireTermsConsent),
    password: PasswordSchema,
  });

  // Self-hosted automation has no implicit free path. An official issuer
  // ticket is short-lived and one-time; consuming it binds the authenticated
  // local account to this installation before any automation gate can pass.
  fastify.post<{ Body: z.infer<typeof AutomationEntitlementTicketSchema> }>(
    '/automation/entitlement/verify',
    { preHandler: authenticate },
    async (req, reply) => {
      const parsed = AutomationEntitlementTicketSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Validation failed' });
      try {
        // `session` 是唯一能建立/续期短期绑定的动作，也就是公网接收那一格
        // "至多 30 秒已签发窗口"的来源；其它动作的票据只放行它自己那一次操作。
        // 判定用的下限 = 手配的那一个与在线刷新到的那一个里较大的（只升不降）。
        const keyring = await loadEffectiveAutomationKeyring(prisma);
        const consumed = await prisma.$transaction((tx) => redeemAutomationEntitlementTicket({
          client: tx,
          userId: getAuthUser(req).userId,
          action: 'session',
          token: parsed.data.ticket,
          localAccountUuid: parsed.data.localAccountUuid,
          keyring,
        }));
        return reply.header('Cache-Control', 'no-store').send({ state: 'active', expiresAt: consumed.expiresAt.toISOString() });
      } catch (error) {
        // 只回稳定码；票据正文、官方主体与本地账号 UUID 都不出这道门。
        const code = error instanceof AutomationEntitlementError ? error.code : 'AUTOMATION_TICKET_INVALID';
        Logger.audit({ event: 'AUTOMATION_ENTITLEMENT_DENIED', userId: getAuthUser(req).userId, errorCode: code, capability: 'automation' });
        return reply.status(403).send({ error: 'Automation entitlement verification failed', errorCode: code });
      }
    },
  );

  // ── 签发端（只在 `official` 模式的实例上开放）───────────────────────────────
  // 🔴 判定内核管"这枚票据能不能信"，这一段管"这枚票据该不该签"。两件事的凭据也
  // 分开：验证侧配的是公钥环（`AUTOMATION_OFFICIAL_KEYS`），签发侧配的是私钥
  // （`AUTOMATION_OFFICIAL_PRIVATE_KEY` + issuer + keyId）。自托管实例配了公钥环
  // 也签不出任何东西。
  const automationIssuerSide = (): { issuer: AutomationEntitlementIssuer } | { code: string } => {
    if (resolveAutomationEntitlementMode() !== 'official') return { code: AUTOMATION_ISSUER_DENIALS.NOT_ON_THIS_INSTANCE };
    const issuer = loadAutomationEntitlementIssuer();
    return issuer ? { issuer } : { code: AUTOMATION_ISSUER_DENIALS.ISSUER_NOT_CONFIGURED };
  };

  // 逐次放行的一次性动作共用**同一条**取票据的通道（只认出现一次的头，重复即当作没带）。
  // 闸门用它是为了离线预检，路由用它是为了在写事务里消费 —— 两处必须读到同一枚票据，
  // 所以这里只有一处解析，不在各路由里各写一遍。
  const automationTicket = (req: FastifyRequest): string | undefined => {
    const rawHeaders = req.raw?.rawHeaders;
    return Array.isArray(rawHeaders) ? readAutomationEntitlementTicketHeader(rawHeaders) : undefined;
  };

  fastify.post<{ Body: z.infer<typeof AutomationInstallationSchema> }>(
    '/automation/entitlement/subject',
    { preHandler: [authenticate, createEntitlementGuard({ capability: 'automation' })] },
    async (req, reply) => {
      const ready = automationIssuerSide();
      if ('code' in ready) return reply.status(403).send({ error: 'Automation entitlement issuance unavailable', errorCode: ready.code });
      const { userId } = getAuthUser(req);
      const row = await prisma.$transaction((tx) => ensureAutomationEntitlementSubject(tx, userId));
      return reply.header('Cache-Control', 'no-store').send({ subject: row.subject });
    },
  );

  // 激活码明文**只在这一个响应里出现一次**：库里只有它的 SHA-256，日志与审计只记码的存续。
  fastify.post<{ Body: z.infer<typeof AutomationInstallationSchema> }>(
    '/automation/entitlement/activations',
    { preHandler: [authenticate, createEntitlementGuard({ capability: 'automation' })] },
    async (req, reply) => {
      const parsed = AutomationInstallationSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Validation failed' });
      const ready = automationIssuerSide();
      if ('code' in ready) return reply.status(403).send({ error: 'Automation entitlement issuance unavailable', errorCode: ready.code });
      try {
        const issued = await prisma.$transaction((tx) => issueAutomationEntitlementActivation({
          client: tx, userId: getAuthUser(req).userId, installationId: parsed.data.installationId,
        }));
        return reply.header('Cache-Control', 'no-store').send({ code: issued.code, expiresAt: issued.expiresAt.toISOString(), subject: issued.subject });
      } catch (error) {
        const code = error instanceof AutomationIssuerError ? error.code : AUTOMATION_ISSUER_DENIALS.ACTIVATION_INVALID;
        Logger.audit({ event: 'AUTOMATION_ENTITLEMENT_DENIED', userId: getAuthUser(req).userId, errorCode: code, capability: 'automation' });
        return reply.status(403).send({ error: 'Automation entitlement issuance rejected', errorCode: code });
      }
    },
  );

  // 兑换 = 把 (主体, 实例, 本地账号) 写成服务端事实。此后签 `session` 票据只认这一行。
  fastify.post<{ Body: z.infer<typeof AutomationActivationRedeemSchema> }>(
    '/automation/entitlement/activations/redeem',
    { preHandler: [authenticate, createEntitlementGuard({ capability: 'automation' })] },
    async (req, reply) => {
      const parsed = AutomationActivationRedeemSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Validation failed' });
      const ready = automationIssuerSide();
      if ('code' in ready) return reply.status(403).send({ error: 'Automation entitlement issuance unavailable', errorCode: ready.code });
      try {
        const link = await prisma.$transaction((tx) => redeemAutomationEntitlementActivation({
          client: tx, userId: getAuthUser(req).userId, code: parsed.data.code,
          installationId: parsed.data.installationId, localAccountUuid: parsed.data.localAccountUuid,
        }));
        return reply.header('Cache-Control', 'no-store').send({ subject: link.subject, installationId: link.installationId, boundAt: link.boundAt.toISOString() });
      } catch (error) {
        const code = error instanceof AutomationIssuerError ? error.code : AUTOMATION_ISSUER_DENIALS.ACTIVATION_INVALID;
        Logger.audit({ event: 'AUTOMATION_ENTITLEMENT_DENIED', userId: getAuthUser(req).userId, errorCode: code, capability: 'automation' });
        return reply.status(403).send({ error: 'Automation entitlement binding rejected', errorCode: code });
      }
    },
  );

  fastify.post<{ Body: z.infer<typeof AutomationInstallationSchema> }>(
    '/automation/entitlement/activations/revoke',
    { preHandler: authenticate },
    async (req, reply) => {
      const parsed = AutomationInstallationSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Validation failed' });
      const ready = automationIssuerSide();
      if ('code' in ready) return reply.status(403).send({ error: 'Automation entitlement issuance unavailable', errorCode: ready.code });
      const revoked = await revokeAutomationEntitlementLink({
        client: prisma, userId: getAuthUser(req).userId, installationId: parsed.data.installationId,
      });
      // 撤销自己的绑定不是失败：没有可撤销的绑定时返回 false，但账号侧状态本就干净。
      return reply.header('Cache-Control', 'no-store').send({ revoked });
    },
  );

  // 签一枚 30 秒 `session` 票据。claims 三个绑定字段全部来自 links 行，请求体一个字都不参与。
  fastify.post<{ Body: z.infer<typeof AutomationInstallationSchema> }>(
    '/automation/entitlement/session',
    { preHandler: [authenticate, createEntitlementGuard({ capability: 'automation' })] },
    async (req, reply) => {
      const parsed = AutomationInstallationSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Validation failed' });
      const ready = automationIssuerSide();
      if ('code' in ready) return reply.status(403).send({ error: 'Automation entitlement issuance unavailable', errorCode: ready.code });
      try {
        const floor = await readAutomationRevocationFloor(prisma);
        const signed = await prisma.$transaction((tx) => signAutomationEntitlementSessionTicket({
          client: tx, userId: getAuthUser(req).userId, installationId: parsed.data.installationId,
          issuer: ready.issuer, revocationVersion: floor,
        }));
        return reply.header('Cache-Control', 'no-store').send({ ticket: signed.token, expiresAt: signed.expiresAt.toISOString() });
      } catch (error) {
        const code = error instanceof AutomationIssuerError ? error.code : AUTOMATION_ISSUER_DENIALS.LINK_NOT_BOUND;
        Logger.audit({ event: 'AUTOMATION_ENTITLEMENT_DENIED', userId: getAuthUser(req).userId, errorCode: code, capability: 'automation' });
        return reply.status(403).send({ error: 'Automation entitlement issuance rejected', errorCode: code });
      }
    },
  );

  // 逐次放行动作的**取票通道**。上一轮把闸门改成"这些动作各要一枚自己的票据"，但只有
  // `session` 有供给方 —— 自托管那一侧因此永远停在"等权益"。签出来的是
  // "这个主体可以在这个作用域上做这一个动作"；🔴 **作用域是否真属于这个本地账号由客户实例
  // 判**（官方实例看不到、也不该看到客户库里的规则与事件 —— 那是 E2EE 的前提）。
  // 限流的数从被约束的常量推：worker 默认 30 s 一跳 ⇒ 稳态 ≤ 2 跳/分，一跳最多 5 枚
  // （领取、预留、发布、提交许可、草稿确认）⇒ 合法上限 10 枚/分；60 是 6 倍余量，
  // 同时把"无限制索取 Ed25519 签名"这条路堵掉。
  fastify.post<{ Body: z.infer<typeof AutomationActionTicketSchema> }>(
    '/automation/entitlement/ticket',
    { preHandler: [authenticate], config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = AutomationActionTicketSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Validation failed' });
      const ready = automationIssuerSide();
      if ('code' in ready) return reply.status(403).send({ error: 'Automation entitlement issuance unavailable', errorCode: ready.code });
      try {
        const floor = await readAutomationRevocationFloor(prisma);
        const data = parsed.data;
        const signed = await prisma.$transaction((tx) => signAutomationEntitlementActionTicket({
          client: tx, userId: getAuthUser(req).userId, installationId: data.installationId, action: data.action,
          ...(data.ruleId === undefined ? {} : { ruleId: data.ruleId }),
          ...(data.eventId === undefined ? {} : { eventId: data.eventId }),
          issuer: ready.issuer, revocationVersion: floor,
        }));
        return reply.header('Cache-Control', 'no-store').send({ ticket: signed.token, expiresAt: signed.expiresAt.toISOString(), action: signed.action });
      } catch (error) {
        const code = error instanceof AutomationIssuerError ? error.code : AUTOMATION_ISSUER_DENIALS.LINK_NOT_BOUND;
        Logger.audit({ event: 'AUTOMATION_ENTITLEMENT_DENIED', userId: getAuthUser(req).userId, errorCode: code, capability: 'automation' });
        return reply.status(403).send({ error: 'Automation entitlement issuance rejected', errorCode: code });
      }
    },
  );

  // ── 吊销版本：官方侧签发清单，自托管侧吃清单 ──────────────────────────────
  // 公开可读：它讲的是"哪些票据已经作废"，不含任何账号信息，且必须**验签**才作数。
  fastify.get('/automation/entitlement/revocations', async (_req, reply) => {
    const ready = automationIssuerSide();
    if ('code' in ready) return reply.status(403).send({ error: 'Automation entitlement issuance unavailable', errorCode: ready.code });
    const manifest = signAutomationRevocationManifest({ issuer: ready.issuer, revocationVersion: await readAutomationRevocationFloor(prisma) });
    return reply.header('Cache-Control', 'no-store').send({ manifest });
  });

  fastify.post<{ Body: z.infer<typeof AutomationRevocationBumpSchema> }>(
    '/automation/entitlement/revocations',
    { preHandler: [authenticate, requireAdmin] },
    async (req, reply) => {
      const parsed = AutomationRevocationBumpSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Validation failed' });
      const ready = automationIssuerSide();
      if ('code' in ready) return reply.status(403).send({ error: 'Automation entitlement issuance unavailable', errorCode: ready.code });
      try {
        const version = await bumpAutomationRevocationFloor({ client: prisma, revocationVersion: parsed.data.revocationVersion });
        Logger.audit({ event: 'AUTOMATION_ENTITLEMENT_REVOKED', userId: getAuthUser(req).userId, revocationVersion: version, capability: 'automation' });
        return reply.header('Cache-Control', 'no-store').send({ revocationVersion: version });
      } catch (error) {
        const code = error instanceof AutomationIssuerError ? error.code : AUTOMATION_ISSUER_DENIALS.REVOCATION_NOT_INCREASING;
        return reply.status(403).send({ error: 'Automation revocation update rejected', errorCode: code });
      }
    },
  );

  // 自托管侧的在线刷新：清单由客户端**转述**，但下限只认**验过签**的那个数。
  // 这一条不需要权益闸门 —— 恰恰是在绑定被吊销或过期之后才需要它。
  fastify.post<{ Body: z.infer<typeof AutomationRevocationManifestBodySchema> }>(
    '/automation/entitlement/revocations/refresh',
    { preHandler: authenticate },
    async (req, reply) => {
      const parsed = AutomationRevocationManifestBodySchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Validation failed' });
      try {
        const applied = await applyAutomationRevocationManifest({ client: prisma, manifest: parsed.data.manifest });
        return reply.header('Cache-Control', 'no-store').send({ revocationVersion: applied.revocationVersion, refreshed: applied.refreshed });
      } catch (error) {
        const code = error instanceof AutomationIssuerError ? error.code : AUTOMATION_ISSUER_DENIALS.MANIFEST_INVALID;
        Logger.audit({ event: 'AUTOMATION_ENTITLEMENT_DENIED', userId: getAuthUser(req).userId, errorCode: code, capability: 'automation' });
        return reply.status(403).send({ error: 'Automation revocation manifest rejected', errorCode: code });
      }
    },
  );

  // The worker secret is returned once, persisted only as a hash, and never
  // enters op-log, logs, or a user-visible error.
  fastify.post<{ Body: z.infer<typeof AutomationWorkerRegisterSchema> }>(
    '/automation/worker/register',
    { preHandler: [authenticate, createEntitlementGuard({ capability: 'automation', action: 'worker-register', precheckOnly: true })] },
    async (req, reply) => {
      const parsed = AutomationWorkerRegisterSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Validation failed' });
      try {
        const user = getAuthUser(req);
        return reply.status(201).send(await registerAutomationWorker(
          user.userId, parsed.data.clientId, parsed.data.databaseEpoch, automationTicket(req),
        ));
      } catch (error) {
        if (error instanceof AutomationWriteAuthorizationError) return replyAutomationRejection(req, reply, error.decision, 'automation');
        Logger.warn(`Automation worker registration rejected: ${error instanceof Error ? error.message : 'unknown'}`);
        return reply.status(400).send({ error: 'Automation worker registration failed' });
      }
    },
  );

  fastify.post<{ Body: z.infer<typeof AutomationWorkerRevokeSchema> }>(
    '/automation/worker/revoke',
    { preHandler: authenticate },
    async (req, reply) => {
      const parsed = AutomationWorkerRevokeSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Validation failed' });
      const revoked = await revokeAutomationWorker(getAuthUser(req).userId, parsed.data.workerId);
      return reply.send({ revoked });
    },
  );

  fastify.post<{ Body: z.infer<typeof AutomationCommitPermitSchema> }>(
    '/automation/commit-permit',
    // The service checks entitlement in the first-permit transaction. Exact
    // owner retries remain reachable after expiry for an already granted intent.
    { preHandler: authenticate },
    async (req, reply) => {
      const parsed = AutomationCommitPermitSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Validation failed' });
      const user = getAuthUser(req);
      const identity = readInboundUploadIdentity(req.raw.rawHeaders, user.tokenVersion);
      if (!identity) return reply.status(403).send({ error: 'Automation worker authorization required' });
      const workerToken = req.raw.rawHeaders.find((_value, index, headers) => index % 2 === 0 && headers[index].toLowerCase() === 'x-heyta-worker-token')
        ? req.raw.rawHeaders[req.raw.rawHeaders.findIndex((_value, index, headers) => index % 2 === 0 && headers[index].toLowerCase() === 'x-heyta-worker-token') + 1]
        : undefined;
      if (workerToken === undefined) return reply.status(403).send({ error: 'Automation worker authorization required' });
      try {
        const data = parsed.data;
        if (data.opId !== `inbound:${data.eventId}`) return reply.status(400).send({ error: 'Validation failed' });
        const ticket = readAutomationEntitlementTicketHeader(req.raw.rawHeaders);
        return reply.status(201).send(await issueAutomationCommitPermit({
          userId: user.userId, tokenVersion: user.tokenVersion ?? -1, clientId: data.clientId,
          workerToken, databaseEpoch: data.databaseEpoch, eventId: data.eventId, opId: data.opId,
          ruleId: data.ruleId, ruleVersion: data.ruleVersion, parseVersion: data.parseVersion,
          resultDigest: data.resultDigest, itemCount: data.itemCount,
          ...(ticket === undefined ? {} : { ticket }),
        }));
      } catch (error) {
        Logger.warn(`Automation permit rejected: ${error instanceof Error ? error.message : 'unknown'}`);
        return reply.status(403).send({ error: 'Automation commit authorization failed' });
      }
    },
  );

  fastify.get('/automation/rules', { preHandler: authenticate }, async (req, reply) => {
    return reply.send({ rules: await listAutomationRules(getAuthUser(req).userId) });
  });

  fastify.post<{ Body: z.infer<typeof AutomationRuleCreateSchema> }>(
    '/automation/rules',
    { preHandler: [authenticate, createEntitlementGuard({ capability: 'automation' })] },
    async (req, reply) => {
      const parsed = AutomationRuleCreateSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Validation failed' });
      try {
        const { keyId, ...config } = parsed.data;
        return reply.status(201).send(await createAutomationRule(getAuthUser(req).userId, keyId, config));
      }
      catch { return reply.status(400).send({ error: 'Automation rule creation failed' }); }
    },
  );

  fastify.put<{ Params: unknown; Body: z.infer<typeof AutomationRuleConfigUpdateSchema> }>(
    '/automation/rules/:ruleId/config',
    { preHandler: [authenticate, createEntitlementGuard({ capability: 'automation' })] },
    async (req, reply) => {
      const params = AutomationRuleParamsSchema.safeParse(req.params);
      const body = AutomationRuleConfigUpdateSchema.safeParse(req.body);
      if (!params.success || !body.success) return reply.status(400).send({ error: 'Validation failed' });
      try { return reply.send(await updateAutomationRuleConfig(getAuthUser(req).userId, params.data.ruleId, body.data)); }
      catch { return reply.status(404).send({ error: 'Automation rule not found' }); }
    },
  );

  fastify.put<{ Params: unknown; Body: z.infer<typeof AutomationRuleEnabledSchema> }>(
    '/automation/rules/:ruleId/enabled',
    // 关闭规则不要求付费（协议 §4），只有启用才消费 rule-enable 票据。
    { preHandler: [authenticate, createEntitlementGuard({ capability: 'automation', action: 'rule-enable',
      precheckOnly: true,
      when: (req) => (req.body as { enabled?: unknown } | undefined)?.enabled === true,
      scope: (req) => ({ ruleId: String((req.params as { ruleId?: unknown }).ruleId ?? '') }) })] },
    async (req, reply) => {
      const params = AutomationRuleParamsSchema.safeParse(req.params);
      const body = AutomationRuleEnabledSchema.safeParse(req.body);
      if (!params.success || !body.success) return reply.status(400).send({ error: 'Validation failed' });
      try { return reply.send(await setAutomationRuleEnabled(getAuthUser(req).userId, params.data.ruleId, body.data.enabled, automationTicket(req))); }
      catch (error) {
        if (error instanceof AutomationWriteAuthorizationError) return replyAutomationRejection(req, reply, error.decision, 'automation');
        return reply.status(404).send({ error: 'Automation rule not found' });
      }
    },
  );

  fastify.delete<{ Params: unknown }>(
    '/automation/rules/:ruleId',
    { preHandler: authenticate },
    async (req, reply) => {
      const params = AutomationRuleParamsSchema.safeParse(req.params);
      if (!params.success) return reply.status(400).send({ error: 'Validation failed' });
      try { return reply.send(await deleteAutomationRule(getAuthUser(req).userId, params.data.ruleId)); }
      catch { return reply.status(404).send({ error: 'Automation rule not found' }); }
    },
  );

  // Sender secrets are returned once. The database stores only deployment-KEK
  // wrapped ciphertext; issuing the same keyId rotates and revokes its prior key.
  fastify.post<{ Params: unknown; Body: z.infer<typeof AutomationSenderCredentialSchema> }>(
    '/automation/rules/:ruleId/sender-credentials',
    { preHandler: [authenticate, createEntitlementGuard({ capability: 'automation', action: 'sender-credential-issue',
      precheckOnly: true,
      scope: (req) => ({ ruleId: String((req.params as { ruleId?: unknown }).ruleId ?? '') }) })]},
    async (req, reply) => {
      const params = AutomationRuleParamsSchema.safeParse(req.params); const body = AutomationSenderCredentialSchema.safeParse(req.body);
      if (!params.success || !body.success) return reply.status(400).send({ error: 'Validation failed' });
      try { return reply.status(201).send(await issueSenderCredential(getAuthUser(req).userId, params.data.ruleId, body.data.keyId, automationTicket(req))); }
      catch (error) {
        if (error instanceof AutomationWriteAuthorizationError) return replyAutomationRejection(req, reply, error.decision, 'automation');
        return reply.status(409).send({ error: 'Sender credential could not be issued' });
      }
    },
  );
  fastify.get<{ Params: unknown }>(
    '/automation/rules/:ruleId/sender-credentials', { preHandler: authenticate }, async (req, reply) => {
      const params = AutomationRuleParamsSchema.safeParse(req.params);
      if (!params.success) return reply.status(400).send({ error: 'Validation failed' });
      try { return reply.send({ credentials: await listSenderCredentials(getAuthUser(req).userId, params.data.ruleId) }); }
      catch { return reply.status(404).send({ error: 'Sender credentials not found' }); }
    },
  );
  fastify.post<{ Body: z.infer<typeof AutomationSenderRevokeSchema> }>(
    '/automation/sender-credentials/revoke', { preHandler: authenticate }, async (req, reply) => {
      const body = AutomationSenderRevokeSchema.safeParse(req.body); if (!body.success) return reply.status(400).send({ error: 'Validation failed' });
      return reply.send({ revoked: await revokeSenderCredential(getAuthUser(req).userId, body.data.credentialId) });
    },
  );

  // Account-level X25519 recipient key registration. CAS is the publish fence:
  // a stale device cannot silently replace a newer key package.
  fastify.put<{ Body: z.infer<typeof AutomationRecipientKeySchema> }>(
    '/automation/recipient-key',
    { preHandler: [authenticate, createEntitlementGuard({ capability: 'automation' })] },
    async (req, reply) => {
      const parsed = AutomationRecipientKeySchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Validation failed' });
      const userId = getAuthUser(req).userId;
      const data = parsed.data;
      const bytes = Buffer.from(data.publicKey.replace(/-/g, '+').replace(/_/g, '/') + '==', 'base64');
      if (bytes.length !== 32) return reply.status(400).send({ error: 'Validation failed' });
      try {
        const result = await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
          const current = await tx.automationRecipientKey.findUnique({ where: { userId } });
          if (current === null) {
            if (data.expectedPackageVersion !== null) throw new Error('Recipient key version conflict');
            return tx.automationRecipientKey.create({ data: { userId, keyEpoch: data.keyEpoch, publicKey: data.publicKey, packageVersion: data.packageVersion } });
          }
          // An epoch identifies the private key, so the same epoch may only
          // be republished byte-for-byte. A changed public key must advance
          // the epoch; otherwise queued ciphertext becomes undecryptable.
          if (data.expectedPackageVersion !== current.packageVersion || data.packageVersion <= current.packageVersion ||
              data.keyEpoch < current.keyEpoch || (data.keyEpoch === current.keyEpoch && data.publicKey !== current.publicKey)) {
            throw new Error('Recipient key version conflict');
          }
          return tx.automationRecipientKey.update({ where: { userId }, data: { keyEpoch: data.keyEpoch, publicKey: data.publicKey, packageVersion: data.packageVersion } });
        });
        return reply.send({ keyEpoch: result.keyEpoch, publicKey: result.publicKey, packageVersion: result.packageVersion });
      } catch { return reply.status(409).send({ error: 'Recipient key version conflict' }); }
    },
  );
  fastify.get('/automation/recipient-key', { preHandler: [authenticate, createEntitlementGuard({ capability: 'automation' })] }, async (req, reply) => {
    const row = await prisma.automationRecipientKey.findUnique({ where: { userId: getAuthUser(req).userId } });
    if (row === null) return reply.status(404).send({ error: 'Recipient key is not registered' });
    return reply.send({ keyEpoch: row.keyEpoch, publicKey: row.publicKey, packageVersion: row.packageVersion });
  });

  // Authenticated worker queue protocol. The worker token is read only from
  // duplicate-rejecting headers; no body field can select another worker.
  fastify.post<{ Params: { eventId: string } }>(
    '/automation/events/:eventId/retry',
    { preHandler: [authenticate, createEntitlementGuard({ capability: 'automation' })] },
    async (req, reply) => {
      const eventId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/).safeParse(req.params.eventId);
      const body = z.object({ expectedAttempt: z.number().int().positive(), expectedRuleVersion: z.number().int().positive() }).strict().safeParse(req.body);
      if (!eventId.success || !body.success) return reply.status(400).send({ error: 'Validation failed' });
      try {
        return reply.send(await retryUncertainAutomationEvent({ userId: getAuthUser(req).userId, eventId: eventId.data, ...body.data }));
      } catch { return reply.status(409).send({ error: 'Automation event cannot be retried' }); }
    },
  );

  fastify.get<{ Params: { eventId: string } }>(
    '/automation/events/:eventId/draft', { preHandler: [authenticate] }, async (req, reply) => {
      const eventId = inboundDraftEventIdSchema.safeParse(req.params.eventId);
      if (!eventId.success) return reply.status(400).send({ error: 'Validation failed' });
      const user = getAuthUser(req);
      if (user.tokenVersion === undefined) return reply.status(403).send({ error: 'Authentication required' });
      try {
        return reply.header('Cache-Control', 'no-store').send(await readAutomationDraft({ userId: user.userId, tokenVersion: user.tokenVersion, eventId: eventId.data }));
      } catch { return reply.status(404).send({ error: 'Automation draft is not available' }); }
    },
  );
  fastify.post<{ Params: { eventId: string } }>(
    '/automation/events/:eventId/draft/decision', { preHandler: [authenticate] }, async (req, reply) => {
      const eventId = inboundDraftEventIdSchema.safeParse(req.params.eventId);
      const body = inboundDraftDecisionSchema.safeParse(req.body);
      if (!eventId.success || !body.success) return reply.status(400).send({ error: 'Validation failed' });
      const user = getAuthUser(req);
      if (user.tokenVersion === undefined) return reply.status(403).send({ error: 'Authentication required' });
      // 确认那一侧的权益判定**只在写事务里做一次**：官方模式看共享锁定的订阅行，
      // 自托管在线模式消费一张绑定本事件的 action 票据。HTTP 层再判一次会把同一张
      // 票据烧掉两次，而闸门那层拦不住"订阅在等锁期间到期"这一格。
      const ticket = body.data.decision === 'confirm' ? readAutomationEntitlementTicketHeader(req.raw.rawHeaders) : undefined;
      try {
        return reply.send(await decideAutomationDraft({ userId: user.userId, tokenVersion: user.tokenVersion,
          eventId: eventId.data, ...body.data, ...(ticket === undefined ? {} : { ticket }) }));
      } catch { return reply.status(409).send({ error: 'Automation draft decision could not be applied' }); }
    },
  );

  fastify.post<{ Body: z.infer<typeof AutomationClaimSchema> }>(
    '/automation/events/claim',
    { preHandler: [authenticate, createEntitlementGuard({ capability: 'automation', action: 'event-claim', precheckOnly: true })]},
    async (req, reply) => {
      const parsed = AutomationClaimSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Validation failed' });
      const user = getAuthUser(req);
      const identity = readInboundUploadIdentity(req.raw.rawHeaders, user.tokenVersion);
      if (!identity) return reply.status(403).send({ error: 'Automation worker authorization required' });
      try {
        const claimed = await claimAutomationEvent(user.userId, parsed.data.clientId, identity, new Date(), parsed.data.eventId, automationTicket(req));
        return reply.send(claimed ?? { state: 'empty' });
      } catch (error) {
        if (error instanceof AutomationWriteAuthorizationError) return replyAutomationRejection(req, reply, error.decision, 'automation');
        return reply.status(403).send({ error: 'Automation worker authorization failed' });
      }
    },
  );

  fastify.post<{ Params: { eventId: string }; Body: z.infer<typeof AutomationLeaseSchema> }>(
    '/automation/events/:eventId/renew',
    { preHandler: [authenticate, createEntitlementGuard({ capability: 'automation' })] },
    async (req, reply) => {
      const params = z.object({ eventId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/) }).safeParse(req.params);
      const parsed = AutomationLeaseSchema.safeParse(req.body);
      if (!params.success || !parsed.success) return reply.status(400).send({ error: 'Validation failed' });
      const user = getAuthUser(req);
      const identity = readInboundUploadIdentity(req.raw.rawHeaders, user.tokenVersion);
      if (!identity) return reply.status(403).send({ error: 'Automation worker authorization required' });
      try { return reply.send(await renewAutomationLease(user.userId, parsed.data.clientId, identity, params.data.eventId, parsed.data.leaseGeneration)); }
      catch { return reply.status(409).send({ error: 'Automation lease is no longer valid' }); }
    },
  );

  fastify.post<{ Params: { eventId: string }; Body: z.infer<typeof AutomationResultSchema> }>(
    '/automation/events/:eventId/result',
    { preHandler: [authenticate, createEntitlementGuard({ capability: 'automation', action: 'result-publish',
      precheckOnly: true,
      scope: (req) => ({ eventId: String((req.params as { eventId?: unknown }).eventId ?? '') }) })]},
    async (req, reply) => {
      const params = z.object({ eventId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/) }).safeParse(req.params);
      const parsed = AutomationResultSchema.safeParse(req.body);
      if (!params.success || !parsed.success) return reply.status(400).send({ error: 'Validation failed' });
      const user = getAuthUser(req);
      const identity = readInboundUploadIdentity(req.raw.rawHeaders, user.tokenVersion);
      if (!identity) return reply.status(403).send({ error: 'Automation worker authorization required' });
      try {
        return reply.send(await publishAutomationResult({ userId: user.userId, clientId: parsed.data.clientId,
          identity, eventId: params.data.eventId, leaseGeneration: parsed.data.leaseGeneration,
          parseVersion: parsed.data.parseVersion, resultDigest: parsed.data.resultDigest,
          resultCiphertext: parsed.data.resultCiphertext, itemCount: parsed.data.itemCount, needsConfirmation: parsed.data.needsConfirmation,
          ticket: automationTicket(req) }));
      } catch (error) {
        if (error instanceof AutomationWriteAuthorizationError) return replyAutomationRejection(req, reply, error.decision, 'automation');
        return reply.status(409).send({ error: 'Automation lease or result is no longer valid' });
      }
    },
  );

  fastify.get<{ Querystring: { clientId?: string } }>(
    '/automation/events/recover',
    // Already-authorized local intents can recover after subscription expiry.
    // New commit permits still pass the independent entitlement gate.
    { preHandler: authenticate },
    async (req, reply) => {
      const user = getAuthUser(req);
      const clientId = SuperSyncClientIdSchema.safeParse(req.query.clientId);
      if (!clientId.success) return reply.status(400).send({ error: 'Validation failed' });
      const identity = readInboundUploadIdentity(req.raw.rawHeaders, user.tokenVersion);
      if (!identity) return reply.status(403).send({ error: 'Automation worker authorization required' });
      try {
        const result = await readAutomationPreparedResult(user.userId, clientId.data, identity);
        return reply.send(result ?? { state: 'empty' });
      } catch { return reply.status(403).send({ error: 'Automation worker authorization failed' }); }
    },
  );

  fastify.get<{ Params: { eventId: string }; Querystring: { clientId?: string } }>(
    '/automation/events/:eventId/result',
    // Recovery reads an already-frozen ciphertext. It must remain available
    // to the authenticated owner after entitlement expiry; issuing a new
    // permit is still gated separately.
    { preHandler: authenticate },
    async (req, reply) => {
      const params = z.object({ eventId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/) }).safeParse(req.params);
      if (!params.success) return reply.status(400).send({ error: 'Validation failed' });
      const user = getAuthUser(req);
      const clientId = SuperSyncClientIdSchema.safeParse(req.query.clientId);
      if (!clientId.success) return reply.status(400).send({ error: 'Validation failed' });
      const identity = readInboundUploadIdentity(req.raw.rawHeaders, user.tokenVersion);
      if (!identity) return reply.status(403).send({ error: 'Automation worker authorization required' });
      try {
        const result = await readAutomationPreparedResult(user.userId, clientId.data, identity, params.data.eventId);
        if (!result) return reply.status(404).send({ error: 'Automation result is not available' });
        return reply.send(result);
      } catch { return reply.status(403).send({ error: 'Automation worker authorization failed' }); }
    },
  );

  fastify.post<{ Params: { eventId: string }; Body: z.infer<typeof AutomationAiReserveSchema> }>(
    '/automation/events/:eventId/ai-attempt/reserve',
    // ⚠️ 这一格**没有**改成 `precheckOnly`：reserve 的写事务走 `automation/ai-metering.ts`
    // 的 SqlRunner 端口（位置参数 `$1`），而票据消费需要 Prisma 事务客户端的具名成员
    // （绑定行、nonce 表、时钟表）。把它挪进同一个事务要么复制一份判定（正是本仓库
    // "同一个判断写三遍"那个漂移源头），要么改端口形状（牵连托管额度那一路）。
    // 记在计划 T2 那节的边界表里，不冒充已完成。
    { preHandler: [authenticate, createEntitlementGuard({ capability: 'automation', action: 'ai-reserve',
      scope: (req) => ({ eventId: String((req.params as { eventId?: unknown }).eventId ?? '') }) })]},
    async (req, reply) => {
      const params = z.object({ eventId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/) }).safeParse(req.params);
      const parsed = AutomationAiReserveSchema.safeParse(req.body);
      if (!params.success || !parsed.success || params.data.eventId.length > 64) return reply.status(400).send({ error: 'Validation failed' });
      const user = getAuthUser(req);
      const identity = readInboundUploadIdentity(req.raw.rawHeaders, user.tokenVersion);
      if (!identity) return reply.status(403).send({ error: 'Automation worker authorization required' });
      try {
        return reply.send(await reserveAutomationAiAttempt({ userId: user.userId, ruleId: parsed.data.ruleId,
          eventId: params.data.eventId, parseVersion: parsed.data.parseVersion, attempt: parsed.data.attempt }, Date.now(), undefined,
          undefined, { clientId: parsed.data.clientId, credentialHash: identity.credentialHash,
            databaseEpoch: identity.databaseEpoch, tokenVersion: identity.tokenVersion, leaseGeneration: parsed.data.leaseGeneration },
          parsed.data.billingSource));
      } catch { return reply.status(409).send({ error: 'Automation AI attempt could not be reserved' }); }
    },
  );

  fastify.post<{ Params: { eventId: string }; Body: z.infer<typeof AutomationAiStateSchema> }>(
    '/automation/events/:eventId/ai-attempt/state',
    { preHandler: [authenticate, createEntitlementGuard({ capability: 'automation' })] },
    async (req, reply) => {
      const params = z.object({ eventId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/) }).safeParse(req.params);
      const parsed = AutomationAiStateSchema.safeParse(req.body);
      if (!params.success || !parsed.success) return reply.status(400).send({ error: 'Validation failed' });
      const user = getAuthUser(req);
      const identity = readInboundUploadIdentity(req.raw.rawHeaders, user.tokenVersion);
      if (!identity) return reply.status(403).send({ error: 'Automation worker authorization required' });
      try {
        const changed = await advanceAutomationAiAttempt({ userId: user.userId, ruleId: parsed.data.ruleId,
          eventId: params.data.eventId, parseVersion: parsed.data.parseVersion, attempt: parsed.data.attempt },
          parsed.data.from, parsed.data.to, undefined, { clientId: parsed.data.clientId, credentialHash: identity.credentialHash,
            databaseEpoch: identity.databaseEpoch, tokenVersion: identity.tokenVersion, leaseGeneration: parsed.data.leaseGeneration });
        return reply.send({ changed });
      } catch { return reply.status(409).send({ error: 'Automation AI attempt state transition failed' }); }
    },
  );

  fastify.get('/automation/events', { preHandler: authenticate }, async (req, reply) => {
    return reply.send({ events: await listAutomationEvents(getAuthUser(req).userId) });
  });


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

  // ============================================
  // 账号语言（应用语言解析链第 2 层，2026-10-01 拍板）
  // ============================================

  /**
   * 登录态下把当前界面语言写回账号（`users.locale`，可空列，见那条迁移）。
   *
   * 消费方有三：登录响应带回（客户端本机无显式选择时采纳）、发信函数对已知
   * 账号优先用它、凭据页链接在发信时就把它写成 `?lang=`。归属来自令牌
   * （`authenticate` → `getAuthUser`），不来自输入。
   */
  fastify.put(
    '/account/locale',
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
      try {
        // 🔴 只认 SERVER_LOCALES —— 这是生成物（copy.generated.ts）里的集合，
        // 第三种语言落地时它自动长出第三个成员，这里不用跟着改。
        const parsed = z.object({ locale: z.enum(SERVER_LOCALES) }).safeParse(req.body);
        if (!parsed.success) {
          return reply.status(400).send({
            error: 'Validation failed',
            details: parsed.error.issues,
          });
        }
        const user = getAuthUser(req);
        await prisma.user.update({
          where: { id: user.userId },
          data: { locale: parsed.data.locale },
        });
        return reply.send({ locale: parsed.data.locale });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Account locale update error: ${errMsg}`);
        return reply.status(500).send({ error: 'Failed to update locale.' });
      }
    },
  );

  // 重新确认（补签）：G-27。两条都挂 `preHandler: authenticate` —— 读写的都是
  // **令牌主人自己**的同意记录，`userId` 一律来自 `getAuthUser(req)`，不来自输入。
  // 判据、为什么只有注册以外这一条写入路径、为什么不在非官方实例上拦人：`legal-recheck.ts`。

  /**
   * 这个账号现在需不需要被拦一次去重新确认。
   *
   * 客户端在登录之后、放行同步之前问一次。返回的是**结构化原因码**，
   * 文案归 `packages/i18n`（服务端从来说不出人话，这条纪律与凭据页同一套）。
   */
  fastify.get(
    '/account/legal-consent',
    {
      preHandler: authenticate,
      config: {
        rateLimit: {
          // 每次启动问一次。60/15min 是"一个人反复重开也打不满"的量级，
          // 不是"攻击者会被限住"的量级 —— 这条路只读，不值得为它设计防滥用。
          max: 60,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const decision = await evaluateLegalRecheck(getAuthUser(req).userId);
        return reply.send({
          needsReconfirm: decision.needsReconfirm,
          reason: decision.reason,
          currentVersion: decision.currentVersion,
          recordedVersion: decision.recordedVersion,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Legal consent status error: ${errMsg}`);
        return reply.status(500).send({ error: 'Failed to read consent status.' });
      }
    },
  );

  /**
   * 记下"他确认了**现在这一版**"。
   *
   * 🔴 `documentVersion` 必须是界面上真的展示过的那一版，且要逐字等于服务端当前指纹
   * —— 拿旧版来确认新版会写出一条版本号写错的历史记录，那比没有记录更糟
   *（这正是链 3 立起来要防的"读的是 A、记的是 B"）。
   */
  fastify.post(
    '/account/legal-consent',
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
      try {
        const parsed = z
          .object({
            documentVersion: z.string().min(1),
            acceptedAt: z.number().int().nonnegative(),
          })
          .safeParse(req.body);
        if (!parsed.success) {
          return reply.status(400).send({ error: 'Validation failed', details: parsed.error.issues });
        }
        const result = await recordLegalReconfirm({
          userId: getAuthUser(req).userId,
          clientVersion: parsed.data.documentVersion,
          acceptedAt: parsed.data.acceptedAt,
        });
        if (!result.ok) {
          // 409：请求本身合法，但它要写的那件事在当前状态下不成立（不是客户端写错了字段）。
          return reply
            .status(409)
            .send({ error: result.error === 'not-applicable' ? 'instance_cannot_name_text' : 'version_mismatch' });
        }
        return reply.send({ ok: true, recordedVersion: result.recordedVersion });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Legal consent record error: ${errMsg}`);
        return reply.status(500).send({ error: 'Failed to record consent.' });
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

        // Cascade delete handles: operations, syncState, devices (via Prisma schema).
        // The tombstone is written in the SAME transaction (ADR-0055): split commits
        // can leave "account gone, no tombstone", which is silent until a restore
        // brings that person back.
        await prisma.$transaction((tx) => deleteAccountWithTombstone(tx, userId));
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
          await localeForEmail(req, email),
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
          select: { tokenVersion: true, locale: true },
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
          // locale = 账号语言（可空）：客户端在本机无显式选择时采纳（解析链第 2 层，
          // docs/plans/i18n-multilingual.md §3）。magic-link 那两条登录路同样带它。
          // R10 起昵称与头像 hash 也在这里 —— 四条认证路**共用**
          // `account-profile.store.ts` 的 `withAccountProfile`，不各自拼对象。
          user: await withAccountProfile({
            id: userInfo.userId,
            email: userInfo.email,
            locale: user?.locale ?? null,
          }),
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

        const result = await requestPasskeyRecovery(email, await localeForEmail(req, email));
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

        const result = await registerWithMagicLink(email, Date.now(), inviteCode, await localeForEmail(req, email));
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

        const result = await requestLoginMagicLink(email, await localeForEmail(req, email));
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

        /**
         * 🔴 **委托给唯一入口**（ADR-0039 §2.1 / §3.2）。
         *
         * 这个端点历史上只认登录令牌，而"邮箱链接换会话"现在只有一份实现
         * （`verifyEmailLink`：登录令牌 / 邮箱注册令牌 / 通行密钥注册令牌）。
         * 这里保留它是因为**已经发出去的邮件**指向它 —— 但行为必须与新的
         * 那个端点一致，否则同一封邮件走两条路会得到两种结果。
         */
        const result = await verifyEmailLink(token);
        if (result.kind !== 'session') {
          // 通行密钥注册那条链接：验证成功但**不该**在这里换会话（产品语义如此）。
          // 明确说出来，而不是返回一个缺少 token 的 200 —— 后者会让调用方
          // 以为"登录成功了但没有令牌"。
          return reply.status(409).send({
            error: 'This link verifies a passkey registration; please sign in with your passkey.',
          });
        }
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

  // ============================================
  // EMAIL + PASSWORD ENDPOINTS
  // ============================================

  /**
   * 注册（邮箱 + 口令）。**成功语义与魔法链接注册完全一致**：账号要先经邮箱验证。
   *
   * 🔴 这里刻意**不**直接给会话。口令设在建账号的那一刻，但"这个邮箱真的是你的"
   * 只能由那封邮件回答；跳过验证等于让任何人用一个邮箱领走一个账号。
   * 所以响应是一句中性的"去看你的收件箱"，而口令已经存好了。
   *
   * 邮箱已被占用时同样返回这句中性消息（`registerWithMagicLink` 里
   * `isVerified === 1` 提前 return），所以这个端点**不是**邮箱存在性预言机。
   */
  fastify.post<{ Body: EmailPasswordRegisterBody }>(
    AUTH_PASSWORD_PATHS.register,
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      const schema = z.object({
        ...buildRegisterBodyShape(opts.requireTermsConsent),
        password: PasswordSchema,
      });
      const parseResult = schema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.issues,
        });
      }
      const { email, password, inviteCode, termsAccepted } = parseResult.data;

      try {
        if (!isEmailAllowed(email)) {
          return reply
            .status(403)
            .send({ error: 'Registration is not allowed for this email address.' });
        }

        const result = await registerWithEmailPassword({
          email,
          password,
          // 🔴 **不**照抄魔法链接那条路的 `Date.now()` 无条件传值：
          // `auth.ts` 里写着"绝不发明一次同意"，而无条件传值恰好就是发明
          // —— 未配置法务页面的实例上，没点勾选框的请求也会被写入接受时间。
          // 这里按 zod 的结果走：真的收到 `termsAccepted: true` 才记时间。
          // 需要同意的实例上 zod 已经保证只有 `true` 能到这里。
          ...(termsAccepted === true && { termsAcceptedAt: Date.now() }),
          inviteCode,
          locale: await localeForEmail(req, email),
        });
        return reply.status(201).send(result);
      } catch (err) {
        const pwErr = toPasswordAuthError(err);
        if (pwErr) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error';
          Logger.warn(`Email+password registration rejected (${pwErr.code}): ${errMsg}`);
          return sendPasswordAuthError(reply, pwErr);
        }
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Email+password registration error: ${errMsg}`);
        return reply.status(400).send({
          error: getSafeErrorMessage(err, 'Registration failed. Please try again.'),
        });
      }
    },
  );

  /**
   * 登录（邮箱 + 口令）。响应与 `/login/passkey/verify` 同形
   * （`{ token, user: { id, email, locale } }`），客户端不需要为这条路演第二套接线。
   *
   * ⚠️ 响应里**永远不含** `passwordHash` —— 令牌由 `issueSession` 签，
   * 用户对象只挑了三个字段。这条由测试逐字段钉住（计划 J12），不靠 review 眼睛。
   *
   * 限流取 50/15min 而不是更狠的数：**承重的防爆破是账号侧的失败计数**
   * （5 次 / 15 分钟，见 `password/service.ts`）。IP 侧再收紧只会让同一个 NAT
   * 后面第 6 个人的正常登录，被前 5 个人的拼写失误连带挡掉；而对"拿一句常见口令
   * 喷一万个邮箱"这种分布式喷洒，每个账号只掉一次计数，IP 限流本来也拦不住。
   */
  fastify.post<{ Body: EmailPasswordLoginBody }>(
    AUTH_PASSWORD_PATHS.login,
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      const parseResult = EmailPasswordLoginSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.issues,
        });
      }
      const { email, password } = parseResult.data;

      try {
        return reply.send(await loginWithEmailPassword(email, password));
      } catch (err) {
        const pwErr = toPasswordAuthError(err);
        if (pwErr) {
          // 🔴 口令错 / 账号不存在 / 没设口令三者**同一条日志级别**（warn）。
          // 分级成 error/info 的话，日志本身就成了一个可被读出来的信号，
          // 而且运维会拿它当"有人在爆破我"的仪表盘 —— 那个判断该由计数做。
          Logger.warn(`Password login failed (${pwErr.code})`);
          return sendPasswordAuthError(reply, pwErr);
        }
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Password login error: ${errMsg}`);
        return reply.status(401).send({
          error: getSafeErrorMessage(err, PASSWORD_INVALID_CREDENTIALS_MESSAGE),
        });
      }
    },
  );

  // ============================================
  // 口令找回 / 重置 / 改密（计划 W3）
  // ============================================

  /**
   * 申请一封"重置口令"的邮件。
   *
   * 🔴 **响应与账号是否存在无关**：见 `password/recovery.ts` 文件头第一条。
   * 这里连 `Logger` 的级别都不分支（不存在 / 有账号 / 有账号但没口令 三种都走同一条
   * `Logger.info` 在 service 层发），所以日志也不会从响应侧漏出差别。
   *
   * 限流有两层，**都不是**这个端点的主角：
   * - 按账号：`recovery.ts` 用那一行 `reset_password_token_expires_at` 当计数器
   *   （15 分钟一封）。选它而不是内存 Map 的理由写在那儿。
   * - 按 IP：下面这个 `rateLimit`。它拦的是"一个 IP 喷一万个邮箱"（按账号那层
   *   对每个账号只掉一次计数，拿它防喷洒等于不设防）。
   * 50/15min 与登录那条同一个数：这条路的边际成本也主要是"发一封邮件"，
   * 而 SMTP 抖动时更狠的数只会让真实用户重点一次。
   */
  fastify.post<{ Body: z.infer<typeof PasswordForgotSchema> }>(
    AUTH_PASSWORD_PATHS.forgot,
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      const parseResult = PasswordForgotSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.issues,
        });
      }
      const { email } = parseResult.data;

      try {
        const result = await requestPasswordReset({
          email,
          locale: await localeForEmail(req, email),
        });
        // 🔴 200 而不是 202/201：这条响应**不描述任何账号事实**，
        // 用不同的码去区分"发了"和"没发"就是在把它变成预言机。
        return reply.send(result);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Password reset request error: ${errMsg}`);
        // 兜底句**仍然必须是那句中性的话**，不能是 `getSafeErrorMessage(...)`。
        //
        // 🔴 状态码也必须是 **200**，不是 500。这一条与另外两条不同：`/reset`、`/change`
        // 的请求里不含身份，"这次是服务端坏了"那个信息不泄露任何人；**这条含**。
        // 只要"存在且口令认证器正常"是那条唯一能走到写库的路，一次异常（超长邮箱、
        // 并发、库抖）就会把响应分成 200 / 500 两堆 —— 而攻击者不需要猜口令，
        // 只要制造一次失败就能把这条接口变回预言机：**中性设计只看得出文案，
        // 泄露却发生在状态码上**。错误照样记进日志，那是给我们看的，不是给客户端的。
        return reply.status(200).send({ message: PASSWORD_RESET_REQUEST_MESSAGE });
      }
    },
  );

  /**
   * 用邮件链接里的令牌换新口令。
   *
   * 🔴 成功**不发会话**（J14，理由在 `recovery.ts` 文件头与 ADR-0040）。
   * 响应只有"去登录"那句话，客户端据此把界面导向登录页 —— 不许在这里
   * 顺手签一枚令牌让流程"更顺"。
   *
   * 这条是**未认证**的（用户正是进不去才走这条路），但它天然被链接约束：
   * 没有那枚一次性令牌就什么都做不了，而令牌本身是 256 bit 随机值、
   * 15 分钟有效、用一次即焚。所以这里不挂 `rateLimit` 的紧数值 ——
   * 真正的爆破门槛是哈希查询本身（每次 ~35 ms 且过 `withHashSlot` 闸门），
   * 猜中一枚有效令牌的概率是 2^-256。
   */
  fastify.post<{ Body: { token?: string; password?: string } }>(
    AUTH_PASSWORD_PATHS.reset,
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      const parseResult = PasswordResetSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.issues,
        });
      }
      const { token, password } = parseResult.data;

      try {
        return reply.send(
          await resetPasswordWithToken({
            token,
            password,
            // 通知信的语言：这一条没有邮箱可查账号 locale，
            // 而"正在浏览器前填这张表的人"的手上就有当前语言。
            locale: localeFromRequest(req),
          }),
        );
      } catch (err) {
        const pwErr = toPasswordAuthError(err);
        if (pwErr) {
          Logger.warn(`Password reset rejected (${pwErr.code})`);
          return sendPasswordAuthError(reply, pwErr);
        }
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Password reset error: ${errMsg}`);
        // 兜底句用 `invalid_reset_link` 那句：**任何**没走通的重置都只该有一种读法
        // （"回去重新点一次链接"）。说"系统错误"是在告诉对方这次是别的原因。
        return reply.status(500).send({
          error: PASSWORD_INVALID_RESET_LINK_MESSAGE,
          code: 'invalid_reset_link' satisfies PasswordAuthErrorCode,
        });
      }
    },
  );

  /**
   * 已登录改口令。**当前设备不掉线，其余设备全部掉线**（J13）。
   *
   * 响应与 `/login/email-password` **同形**（`{ token, user }`）而不是只有 `{ message }`：
   * `tokenVersion` 是全局计数器，bump 之后手上这枚也失效了，客户端必须有一枚新的
   * 才能继续用 —— 否则"改个密码把自己的这个标签页也踢出去"，而它刚刚证明了
   * 这个人有权改。这条形状由测试钉住（J13 的第二半）。
   *
   * 挂在 `preHandler: authenticate` 上：这条路读的是**已认证身份**的 `userId`，
   * 绝不允许从 body 里取（那会是一条"给任意账号改口令"的路）。
   */
  fastify.post<{ Body: { currentPassword?: string; newPassword?: string } }>(
    AUTH_PASSWORD_PATHS.change,
    {
      preHandler: authenticate,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      const parseResult = PasswordChangeSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.issues,
        });
      }
      const { currentPassword, newPassword } = parseResult.data;

      try {
        return reply.send(
          await changePassword(
            getAuthUser(req).userId,
            currentPassword,
            newPassword,
            localeFromRequest(req),
          ),
        );
      } catch (err) {
        const pwErr = toPasswordAuthError(err);
        if (pwErr) {
          Logger.warn(`Password change rejected (${pwErr.code})`);
          return sendPasswordAuthError(reply, pwErr);
        }
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Password change error: ${errMsg}`);
        return reply.status(500).send({
          error: getSafeErrorMessage(err, 'Password change failed. Please try again.'),
        });
      }
    },
  );

  /**
   * 已登录**给账号加上第一个口令**（纯通行密钥 / 魔法链接注册的账号）。
   *
   * 🔴 不是 `change` 的语法糖：那条要验一个不存在的当前口令、bump `tokenVersion`
   * 并回一枚**新会话**，这条三样都没有（它是**加一个认证器**，不是换一把钥匙，
   * 把其余设备踢下线在这条路上没有任何收益）。所以响应只有 `{ message }`，
   * 客户端**不需要**换令牌 —— 少一条形状不同的路就多一处"客户端猜哪条对"。
   *
   * 为什么不能靠 `forgot` 代劳：那对没有口令认证器的账号**刻意不发信**（反枚举）。
   * 少了这条路由，`no_password_set` 那句"去设一个登录密码"就是一句指向不存在的路的谎话。
   *
   * 同样挂在 `preHandler: authenticate` 上，`userId` **只**取自已认证身份。
   */
  fastify.post<{ Body: { newPassword?: string } }>(
    AUTH_PASSWORD_PATHS.set,
    {
      preHandler: authenticate,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      const parseResult = PasswordSetSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.issues,
        });
      }

      try {
        return reply.send(
          await setInitialPassword({
            userId: getAuthUser(req).userId,
            password: parseResult.data.newPassword,
          }),
        );
      } catch (err) {
        const pwErr = toPasswordAuthError(err);
        if (pwErr) {
          Logger.warn(`Initial password rejected (${pwErr.code})`);
          return sendPasswordAuthError(reply, pwErr);
        }
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Initial password error: ${errMsg}`);
        return reply.status(500).send({
          error: getSafeErrorMessage(err, 'Password setup failed. Please try again.'),
        });
      }
    },
  );

  // ============================================
  // 邮箱链接换会话（**唯一入口**，ADR-0039 §2.1）
  // ============================================

  /**
   * 邮件里那个 `token` 换会话。三类令牌（登录 / 邮箱注册 / 通行密钥注册）
   * 由 `verifyEmailLink` 一份实现分流；确认页对三个邮件端点都只调这一个。
   *
   * 返回判别式：`{kind:'session',token,user}` 或 `{kind:'verified-only',user}`。
   * ⚠️ 后者**不是失败** —— 它是"验证成功、但那条路的产品语义不发会话"
   *    （通行密钥注册）。页面据此显示"已确认，去应用"，而不是报错。
   */
  fastify.post<{ Body: { token?: string } }>(
    '/auth/email/verify',
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
        const token = typeof req.body?.token === 'string' ? req.body.token : '';
        if (token === '') {
          return reply.status(400).send({ error: 'Validation failed' });
        }
        return reply.send(await verifyEmailLink(token));
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        Logger.error(`Email link verify error: ${errMsg}`);
        return reply.status(401).send({
          error: getSafeErrorMessage(err, 'Invalid or expired link'),
        });
      }
    },
  );
};
