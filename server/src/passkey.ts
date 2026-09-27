import {
  generateRegistrationOptions as webAuthnGenerateRegistration,
  verifyRegistrationResponse,
  generateAuthenticationOptions as webAuthnGenerateAuthentication,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { prisma } from './db';
import { Logger } from './logger';
import { randomBytes } from 'crypto';
import { sendPasskeyRecoveryEmail, sendVerificationEmail } from './email';
import { getWsConnectionService } from './sync/services/websocket-connection.service';
import { Prisma } from '@prisma/client';
import { loadConfigFromEnv, isConsentRequired } from './config';
import {
  VERIFICATION_TOKEN_EXPIRY_MS,
  MAX_VERIFICATION_RESEND_COUNT,
  verifyEmail,
} from './auth';
import { authCache } from './auth-cache';
import { getDefaultStorageQuotaBytes } from './sync/services/storage-quota.service';

// Constants
const CHALLENGE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const RECOVERY_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const REGISTRATION_SUCCESS_MESSAGE =
  'Registration successful. Please check your email to verify your account.';
type ChallengeCeremony = 'registration' | 'authentication' | 'recovery';

/**
 * 通行密钥错误的稳定机器码。
 *
 * 🔴 为什么要一个**码**而不只是句子：`verifyAuthentication` 里的两种情况
 * （设备上这条凭据服务端已经不认了 / 服务端认得但这次断言验不过）
 * 以前都会落成同一句 `Invalid credentials`，`api.ts` 的 `getSafeErrorMessage`
 * 又因为那句话不在白名单里而把它换成笼统的 `Authentication failed`。
 * 于是"你这条旧密钥已经失效了，请重新注册或换登录方式"和"新密钥坏了"
 * 在客户端完全一样 —— 用户没有任何可执行的动作。
 *
 * 码是**给客户端的判别信号**，句子留给客户端按码取词条（app-host 的
 * 封闭联合 `HostedAuthFailureReason`）。服务端自己抛出的 `message` 刻意
 * 保持笼统（`Invalid credentials`）：日志和上层都不该依赖它做判断。
 */
export type PasskeyErrorCode =
  /** 这次登录出示的 credential ID 在本服务端不存在（多半是已删除的陈旧凭据）。 */
  | 'passkey_not_found'
  /** 服务端认得这条凭据，但断言校验失败（签名/计数器/来源等）。 */
  | 'passkey_verification_failed'
  /** 要删的凭据不属于当前用户，或者根本不存在 —— 两者故意同一个码。 */
  | 'passkey_not_found_for_user'
  /** 删掉它会让账号一条凭据都不剩，而账号可能只靠通行密钥登录。 */
  | 'last_passkey_required';

/**
 * 带稳定 `code` 的通行密钥错误。
 *
 * ⚠️ `message` 保持通用文案（`Invalid credentials` 等）：判别靠 `code`，
 * 不靠对 `message` 做字符串匹配 —— 后者一改文案就悄悄失效。
 */
export class PasskeyError extends Error {
  readonly code: PasskeyErrorCode;

  constructor(code: PasskeyErrorCode, message: string) {
    super(message);
    this.name = 'PasskeyError';
    this.code = code;
  }
}

// WebAuthn configuration from environment
const getWebAuthnConfig = (): { rpName: string; rpID: string; origin: string } => {
  const rpID = process.env.WEBAUTHN_RP_ID || 'localhost';
  // Falls back to the relying-party ID, not our brand: this string is what a self-hoster's
  // users see in their OS passkey prompt and what their device stores against the
  // credential. Defaulting it to our product name would record us as the relying party on
  // instances we do not run.
  const rpName = process.env.WEBAUTHN_RP_NAME || rpID;
  const origin = process.env.WEBAUTHN_ORIGIN || 'http://localhost:1900';

  Logger.info(`WebAuthn config: rpID=${rpID}, origin=${origin}`);
  return { rpName, rpID, origin };
};

// In-memory challenge storage (short-lived, per ceremony and subject)
// In production with multiple instances, use Redis or similar
const challenges = new Map<string, { challenge: string; expiresAt: number }>();

// Warn at startup if running with in-memory storage in production
if (process.env.NODE_ENV === 'production') {
  Logger.warn(
    'Passkey challenge storage is using in-memory Map. ' +
      'This will not work correctly with multiple server instances. ' +
      'For multi-instance deployments, implement Redis-based challenge storage.',
  );
}

// Cleanup expired challenges periodically
setInterval(() => {
  const now = Date.now();
  for (const [email, data] of challenges.entries()) {
    if (data.expiresAt < now) {
      challenges.delete(email);
    }
  }
}, 60 * 1000); // Every minute

const getChallengeKey = (ceremony: ChallengeCeremony, subject: string): string =>
  `${ceremony}:${subject.toLowerCase()}`;

const storeChallenge = (
  ceremony: ChallengeCeremony,
  subject: string,
  challenge: string,
): void => {
  challenges.set(getChallengeKey(ceremony, subject), {
    challenge,
    expiresAt: Date.now() + CHALLENGE_EXPIRY_MS,
  });
};

const getAndClearChallenge = (
  ceremony: ChallengeCeremony,
  subject: string,
): string | null => {
  const key = getChallengeKey(ceremony, subject);
  const data = challenges.get(key);
  if (!data) return null;

  challenges.delete(key);

  if (data.expiresAt < Date.now()) {
    return null; // Expired
  }

  return data.challenge;
};

/**
 * Generate registration options for passkey creation (new user)
 */
export const generateRegistrationOptions = async (
  email: string,
): Promise<PublicKeyCredentialCreationOptionsJSON> => {
  const { rpName, rpID } = getWebAuthnConfig();

  // Generate options
  const options = await webAuthnGenerateRegistration({
    rpName,
    rpID,
    userName: email,
    userDisplayName: email,
    // Registration options must not reveal whether this email or any of its
    // credentials already exist.
    excludeCredentials: [],
    authenticatorSelection: {
      residentKey: 'required', // Required for synced passkeys (Google Password Manager)
      userVerification: 'preferred',
    },
    attestationType: 'none', // We don't need attestation
  });

  storeChallenge('registration', email, options.challenge);

  Logger.info(
    `Registration options generated: ${JSON.stringify({
      rp: options.rp,
      pubKeyCredParams: options.pubKeyCredParams,
      authenticatorSelection: options.authenticatorSelection,
      attestation: options.attestation,
    })}`,
  );
  return options;
};

/**
 * Verify passkey registration and create user
 */
export const verifyRegistration = async (
  email: string,
  credential: RegistrationResponseJSON,
  termsAcceptedAt?: number,
): Promise<{ message: string }> => {
  const { rpID, origin } = getWebAuthnConfig();

  const expectedChallenge = getAndClearChallenge('registration', email);
  if (!expectedChallenge) {
    throw new Error('Challenge expired or not found. Please try again.');
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false, // We use 'preferred', not 'required'
    });
  } catch (err) {
    Logger.warn(`Passkey registration verification failed: ${err}`);
    throw new Error('Passkey verification failed. Please try again.');
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Passkey verification failed');
  }

  const { credential: credentialInfo } = verification.registrationInfo;

  // credentialInfo.id from SimpleWebAuthn is a Uint8Array containing the base64url string as UTF-8 bytes
  // We need to decode it to get the actual raw credential ID bytes
  const credentialIdBase64url = Buffer.from(credentialInfo.id).toString('utf-8');
  const credentialIdRawBytes = Buffer.from(credentialIdBase64url, 'base64url');
  Logger.debug(`Registration credentialId base64url: ${credentialIdBase64url}`);
  Logger.debug(
    `Registration credentialId raw bytes (hex): ${credentialIdRawBytes.toString('hex')}`,
  );

  const verificationToken = randomBytes(32).toString('hex');
  const tokenExpiresAt = BigInt(Date.now() + VERIFICATION_TOKEN_EXPIRY_MS);
  // Never invent an acceptance. On an instance that publishes no legal pages there is
  // nothing to accept, and recording a timestamp would assert a consent the user was never
  // shown. The column is nullable precisely so "not applicable" is representable.
  const config = loadConfigFromEnv();
  const acceptedAt = termsAcceptedAt
    ? BigInt(termsAcceptedAt)
    : isConsentRequired(config)
      ? BigInt(Date.now())
      : null;

  try {
    // Check if unverified user exists (re-registration attempt)
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      if (existingUser.isVerified === 1) {
        return { message: REGISTRATION_SUCCESS_MESSAGE };
      }

      if (existingUser.verificationResendCount >= MAX_VERIFICATION_RESEND_COUNT) {
        Logger.warn(`Verification resend cap reached (ID: ${existingUser.id})`);
        return { message: REGISTRATION_SUCCESS_MESSAGE };
      }
    }

    const pendingCreated = await prisma.$transaction(async (tx) => {
      let userId: number;
      if (existingUser) {
        const claim = await tx.user.updateMany({
          where: {
            id: existingUser.id,
            isVerified: 0,
            verificationResendCount: { lt: MAX_VERIFICATION_RESEND_COUNT },
          },
          data: {
            verificationResendCount: { increment: 1 },
          },
        });
        if (claim.count !== 1) return false;
        userId = existingUser.id;
      } else {
        const createdUser = await tx.user.create({
          data: {
            email: email.toLowerCase(),
            passwordHash: null,
            termsAcceptedAt: acceptedAt,
            // Set explicitly rather than leaning on the column default, so that
            // SUPERSYNC_DEFAULT_STORAGE_QUOTA_BYTES actually reaches new accounts.
            storageQuotaBytes: BigInt(getDefaultStorageQuotaBytes()),
          },
        });
        userId = createdUser.id;
      }

      await tx.pendingPasskeyRegistration.create({
        data: {
          userId,
          verificationToken,
          verificationTokenExpiresAt: tokenExpiresAt,
          credentialId: credentialIdRawBytes,
          publicKey: Buffer.from(credentialInfo.publicKey),
          counter: BigInt(credentialInfo.counter),
          transports: credential.response.transports
            ? JSON.stringify(credential.response.transports)
            : null,
        },
      });
      return true;
    });
    if (!pendingCreated) return { message: REGISTRATION_SUCCESS_MESSAGE };

    // In TEST_MODE with autoVerifyUsers, skip email and auto-verify
    if (config.testMode?.autoVerifyUsers) {
      await verifyEmail(verificationToken);
      Logger.info(`[TEST_MODE] Auto-verified passkey user`);
      return {
        message: 'Registration successful. Your account has been automatically verified.',
      };
    }

    // Normal flow: send verification email
    const emailSent = await sendVerificationEmail(email, verificationToken);
    if (!emailSent) return { message: REGISTRATION_SUCCESS_MESSAGE };

    Logger.info(`Passkey registration initiated`);
    return { message: REGISTRATION_SUCCESS_MESSAGE };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { message: REGISTRATION_SUCCESS_MESSAGE };
    }
    throw err;
  }
};

/**
 * Generate authentication options for passkey login
 */
export const generateAuthenticationOptions = async (
  email: string,
): Promise<PublicKeyCredentialRequestOptionsJSON> => {
  const { rpID } = getWebAuthnConfig();

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { passkeys: true },
  });

  if (!user || user.passkeys.length === 0) {
    // Don't reveal if user exists - generate dummy options
    const options = await webAuthnGenerateAuthentication({
      rpID,
      userVerification: 'preferred',
    });
    storeChallenge('authentication', email, options.challenge);
    return options;
  }

  // Don't provide allowCredentials - let browser discover resident credentials
  // This works because we use residentKey: 'required' during registration
  Logger.info(
    `Login (userId: ${user.id}): using discoverable credentials (no allowCredentials)`,
  );

  const options = await webAuthnGenerateAuthentication({
    rpID,
    // allowCredentials omitted - browser will show all discoverable passkeys for this RP
    userVerification: 'preferred',
  });

  storeChallenge('authentication', email, options.challenge);

  Logger.info(
    `Generated passkey authentication options (userId: ${user.id}): rpId=${options.rpId}, discoverable=true`,
  );
  return options;
};

/**
 * Verify passkey authentication and return JWT-compatible user info
 */
export const verifyAuthentication = async (
  email: string,
  credential: AuthenticationResponseJSON,
): Promise<{ userId: number; email: string }> => {
  const { rpID, origin } = getWebAuthnConfig();

  const expectedChallenge = getAndClearChallenge('authentication', email);
  if (!expectedChallenge) {
    throw new Error('Challenge expired or not found. Please try again.');
  }

  // With discoverable credentials, look up the passkey by credential ID
  // instead of by email, since the user might select any passkey for this RP
  const credentialIdBuffer = Buffer.from(credential.id, 'base64url');

  const passkey = await prisma.passkey.findUnique({
    where: { credentialId: credentialIdBuffer },
    include: { user: true },
  });

  if (!passkey) {
    Logger.warn(
      `Passkey not found for credential ID: ${credential.id.substring(0, 20)}...`,
    );
    // 🔴 与"断言验不过"用**不同的码**：这是缺口 B 的全部内容。
    // 句子仍然是笼统的 `Invalid credentials`（下面 catch 里那句也一样），
    // 判别只发生在 `api.ts` 把 `code` 投影给客户端那一步 —— 那里有注释
    // 说明为什么这里可以给一个可判别信号而不会变成 credential ID 的存在性预言机。
    throw new PasskeyError('passkey_not_found', 'Invalid credentials');
  }

  const user = passkey.user;

  if (user.isVerified === 0) {
    throw new Error('Email not verified');
  }

  // Log if the email doesn't match (user selected a different account's passkey)
  if (user.email.toLowerCase() !== email.toLowerCase()) {
    Logger.info(
      `User authenticated with passkey for a different account (userId: ${user.id})`,
    );
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false, // We use 'preferred', not 'required'
      credential: {
        id: passkey.credentialId.toString('base64url'),
        publicKey: new Uint8Array(passkey.publicKey),
        counter: Number(passkey.counter),
        transports: passkey.transports ? JSON.parse(passkey.transports) : undefined,
      },
    });
  } catch (err) {
    Logger.warn(
      `Passkey authentication verification failed (userId: ${user.id}): ${err}`,
    );
    throw new PasskeyError('passkey_verification_failed', 'Invalid credentials');
  }

  if (!verification.verified) {
    throw new PasskeyError('passkey_verification_failed', 'Invalid credentials');
  }

  // Update counter and last used timestamp
  await prisma.passkey.update({
    where: { id: passkey.id },
    data: {
      counter: BigInt(verification.authenticationInfo.newCounter),
      lastUsedAt: new Date(),
    },
  });

  Logger.info(`User logged in via passkey (ID: ${user.id})`);

  return { userId: user.id, email: user.email };
};

/**
 * Request passkey recovery - sends magic link email
 */
export const requestPasskeyRecovery = async (
  email: string,
): Promise<{ message: string }> => {
  const successMessage = {
    message: 'If an account with that email exists, a recovery link has been sent.',
  };

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { passkeys: true },
  });

  // Don't reveal if user exists
  if (!user) {
    Logger.debug(`Passkey recovery requested for non-existent email`);
    return successMessage;
  }

  // Only for passkey users (no password)
  if (user.passwordHash) {
    Logger.debug(`Passkey recovery requested for password user (ID: ${user.id})`);
    return successMessage;
  }

  if (user.isVerified === 0) {
    Logger.debug(`Passkey recovery requested for unverified account (ID: ${user.id})`);
    return successMessage;
  }

  if (user.passkeys.length === 0) {
    Logger.debug(`Passkey recovery requested for user with no passkeys (ID: ${user.id})`);
    return successMessage;
  }

  const now = Date.now();
  if (
    user.passkeyRecoveryToken &&
    user.passkeyRecoveryTokenExpiresAt !== null &&
    user.passkeyRecoveryTokenExpiresAt > BigInt(now)
  ) {
    return successMessage;
  }

  const recoveryToken = randomBytes(32).toString('hex');
  const expiresAt = BigInt(now + RECOVERY_TOKEN_EXPIRY_MS);

  const claim = await prisma.user.updateMany({
    where: {
      id: user.id,
      OR: [
        { passkeyRecoveryToken: null },
        { passkeyRecoveryTokenExpiresAt: null },
        { passkeyRecoveryTokenExpiresAt: { lte: BigInt(now) } },
      ],
    },
    data: {
      passkeyRecoveryToken: recoveryToken,
      passkeyRecoveryTokenExpiresAt: expiresAt,
    },
  });
  if (claim.count === 0) return successMessage;

  const emailSent = await sendPasskeyRecoveryEmail(email, recoveryToken);
  if (!emailSent) {
    await prisma.user.updateMany({
      where: { id: user.id, passkeyRecoveryToken: recoveryToken },
      data: {
        passkeyRecoveryToken: null,
        passkeyRecoveryTokenExpiresAt: null,
      },
    });
    return successMessage;
  }

  Logger.info(`Passkey recovery requested (ID: ${user.id})`);
  return successMessage;
};

/**
 * Validate recovery token and return registration options
 */
export const getRecoveryRegistrationOptions = async (
  token: string,
): Promise<{ email: string; options: PublicKeyCredentialCreationOptionsJSON }> => {
  const user = await prisma.user.findFirst({
    where: { passkeyRecoveryToken: token },
    include: { passkeys: true },
  });

  if (!user) {
    throw new Error('Invalid or expired recovery token');
  }

  if (
    user.passkeyRecoveryTokenExpiresAt &&
    user.passkeyRecoveryTokenExpiresAt < BigInt(Date.now())
  ) {
    await prisma.user.updateMany({
      where: { id: user.id, passkeyRecoveryToken: token },
      data: {
        passkeyRecoveryToken: null,
        passkeyRecoveryTokenExpiresAt: null,
      },
    });
    throw new Error('Invalid or expired recovery token');
  }

  const { rpName, rpID } = getWebAuthnConfig();

  const options = await webAuthnGenerateRegistration({
    rpName,
    rpID,
    userName: user.email,
    userDisplayName: user.email,
    // Don't exclude existing passkeys - we're replacing them
    excludeCredentials: [],
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    attestationType: 'none',
  });

  // Store challenge with recovery token as key (since we don't want to leak email)
  storeChallenge('recovery', token, options.challenge);

  Logger.debug(`Generated recovery registration options for user ${user.id}`);
  return { email: user.email, options };
};

/**
 * Complete passkey recovery - register new passkey and delete old ones
 */
export const completePasskeyRecovery = async (
  token: string,
  credential: RegistrationResponseJSON,
): Promise<{ message: string }> => {
  const { rpID, origin } = getWebAuthnConfig();

  const user = await prisma.user.findFirst({
    where: { passkeyRecoveryToken: token },
  });

  if (!user) {
    throw new Error('Invalid or expired recovery token');
  }

  if (
    user.passkeyRecoveryTokenExpiresAt &&
    user.passkeyRecoveryTokenExpiresAt < BigInt(Date.now())
  ) {
    await prisma.user.updateMany({
      where: { id: user.id, passkeyRecoveryToken: token },
      data: {
        passkeyRecoveryToken: null,
        passkeyRecoveryTokenExpiresAt: null,
      },
    });
    throw new Error('Invalid or expired recovery token');
  }

  const expectedChallenge = getAndClearChallenge('recovery', token);
  if (!expectedChallenge) {
    throw new Error('Challenge expired or not found. Please try again.');
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false, // We use 'preferred', not 'required'
    });
  } catch (err) {
    Logger.warn(`Passkey recovery verification failed for user ${user.id}: ${err}`);
    throw new Error('Passkey verification failed. Please try again.');
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Passkey verification failed');
  }

  const { credential: credentialInfo } = verification.registrationInfo;

  // credentialInfo.id from SimpleWebAuthn is a Uint8Array containing the base64url string as UTF-8 bytes
  // We need to decode it to get the actual raw credential ID bytes
  const credentialIdBase64url = Buffer.from(credentialInfo.id).toString('utf-8');
  const credentialIdRawBytes = Buffer.from(credentialIdBase64url, 'base64url');

  // AUTH_CACHE_INVALIDATION: keep adjacent to tokenVersion writes.
  authCache.invalidate(user.id);

  // Delete old passkeys and create new one, clear recovery token, invalidate sessions
  await prisma.$transaction(async (tx) => {
    const consume = await tx.user.updateMany({
      where: {
        id: user.id,
        passkeyRecoveryToken: token,
        OR: [
          { passkeyRecoveryTokenExpiresAt: null },
          { passkeyRecoveryTokenExpiresAt: { gte: BigInt(Date.now()) } },
        ],
      },
      data: {
        passkeyRecoveryToken: null,
        passkeyRecoveryTokenExpiresAt: null,
        tokenVersion: { increment: 1 },
      },
    });
    if (consume.count !== 1) {
      throw new Error('Invalid or expired recovery token');
    }

    await tx.passkey.deleteMany({ where: { userId: user.id } });

    await tx.passkey.create({
      data: {
        credentialId: credentialIdRawBytes,
        publicKey: Buffer.from(credentialInfo.publicKey),
        counter: BigInt(credentialInfo.counter),
        transports: credential.response.transports
          ? JSON.stringify(credential.response.transports)
          : null,
        userId: user.id,
      },
    });
  });
  // AUTH_CACHE_INVALIDATION: keep adjacent to tokenVersion writes.
  authCache.invalidate(user.id);
  // Sockets authenticate only at upgrade — without this, tokens revoked by
  // the recovery's tokenVersion bump keep receiving op notifications through
  // already-open connections. Same pairing as POST /api/replace-token.
  getWsConnectionService().closeForUser(user.id);

  Logger.info(`Passkey recovery completed (ID: ${user.id})`);

  return {
    message:
      'Passkey has been reset successfully. You can now log in with your new passkey.',
  };
};

// ── 自助管理通行密钥（列 / 删）────────────────────────────────────
//
// 在此之前服务端**只有**注册 / 登录 / 恢复三组端点，用户没有任何自助管理
// 自己凭据的能力：丢了设备既看不到自己还有哪些凭据，也删不掉一条已知泄露/
// 丢失的凭据。恢复流程是"注册新凭据 + 删掉全部旧凭据"的全量覆盖，
// 不是管理。下面两个函数补的就是这个缺口。
//
// 🔴 **刻意不做「改名」**：`Passkey` 表没有 `name` 列（见 schema.prisma），
// 改名需要一次数据库迁移，而本轮明确不碰迁移纪律（AGENTS.md §4）。
// 「名称」这个字段因此也不在下面的返回形状里 —— 与其返回一个假名字，
// 不如不返回。

/**
 * 一条通行密钥的**用户可见**投影。
 *
 * 🔴 这里返回的字段是**白名单**，不是"除了敏感字段以外的全部"：
 * `credentialId` 与 `publicKey` 是凭据的内部数据，客户端列个表
 * 一个字段都不需要它们。白名单让"以后往 Passkey 表加了个敏感列"
 * 不会自动泄漏到列表接口里。
 *
 * ⚠️ **没有 `isCurrentDevice`**：要判断"这条是不是本设备"，唯一能用的
 * 标识就是 `credentialId`，而我们刚刚决定不把它交给客户端。客户端的替代
 * 判据是 `lastUsedAt`（"最近使用"）—— 用户刚刚用过的通常就是手上这台。
 * 想精确做到"当前设备"就得让宿主把登录时拿到的 credential ID 记下来
 * 再回传，那是另一轮的工作量，不该用一个猜出来的布尔值冒充。
 */
export interface PasskeySummary {
  /** 服务端行 id（cuid）。不是 credential ID —— 删/查都用它。 */
  id: string;
  /** ISO 8601。 */
  createdAt: string;
  /** ISO 8601；从未用过时为 null。 */
  lastUsedAt: string | null;
}

/**
 * 列出当前用户的通行密钥。
 *
 * `select` 与返回值都只包含 `PasskeySummary` 的字段：公钥与 credential ID
 * 从来不会离开这个函数。
 */
export const listUserPasskeys = async (userId: number): Promise<PasskeySummary[]> => {
  const rows = await prisma.passkey.findMany({
    where: { userId },
    select: { id: true, createdAt: true, lastUsedAt: true },
    // 新的在前 —— 用户最可能想删的是刚加错的那条。
    orderBy: { createdAt: 'desc' },
  });

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt === null ? null : row.lastUsedAt.toISOString(),
  }));
};

/**
 * 删除当前用户的一条通行密钥。
 *
 * ## 归属：不在自己的名下 = 不存在
 *
 * 删除谓词里同时带 `id` 与 `userId`，所以"别人的 id"和"不存在的 id"
 * 走的是同一条路，抛出**同一个** `passkey_not_found_for_user`。
 * 接口层把它投影成 404 —— 响应里没有任何东西能区分
 * "这条 id 存在但不属于你"和"这条 id 根本不存在"。用 403 就会把前者
 * 变成一个存在性预言机。
 *
 * ## 最后一条：拒绝删除
 *
 * 🔴 **产品取舍（这里选的是"拒绝"，理由如下）**：
 *
 * 账号可能**只靠通行密钥登录** —— `User.passwordHash` 可空，用
 * `/register/passkey/verify` 建的账号就是 `null`。删掉最后一条凭据，
 * 用户下一次登录时设备上没有任何一条服务端认得的凭据，而"恢复"要
 * 依赖邮件送达（`sendPasskeyRecoveryEmail` 会失败，实例可能压根没配
 * SMTP）。也就是说，允许删最后一条 = 允许用户在一个普通设置操作里
 * 把自己永久锁在门外。
 *
 * 备选方案是"允许删，然后强制走恢复邮件"。放弃它的原因：那要求
 * 先证明邮件通道可用（服务端目前不检查），而对没配 SMTP 的自托管实例，
 * 这不是"多一步"，是"账号没了"。
 *
 * 所以：删到只剩一条时返回 `last_passkey_required`，界面显示
 * "这是最后一条通行密钥 —— 先添加一条新的，或者走找回流程"。
 * 用户想换凭据时的正确顺序是**先加后删**，不是先删后加。
 *
 * ## 原子性
 *
 * 谓词里的 `user: { passkeys: { some: { id: { not: passkeyId } } } }`
 * 让"还有另一条"这个条件与删除发生在**同一条语句**里。先 `count()`
 * 再 `delete()` 的写法在两次调用之间会漏：两个并发请求各自看到 2 条、
 * 各自删掉一条，最后一条都不剩 —— 正是上面那条注释要防的事。
 */
export const deleteUserPasskey = async (
  userId: number,
  passkeyId: string,
): Promise<{ deleted: true }> => {
  const outcome = await prisma.$transaction(async (tx) => {
    const deleted = await tx.passkey.deleteMany({
      where: {
        id: passkeyId,
        userId,
        // 只有该用户名下还存在**另一条**凭据时才允许命中这一行。
        user: { passkeys: { some: { id: { not: passkeyId } } } },
      },
    });
    if (deleted.count === 1) return 'deleted' as const;

    // 没删掉：区分"是你的最后一条"（409）与"不是你的/不存在"（404）。
    // 这次查询只用来选错误码，仍然只在 `userId` 范围内找，
    // 所以别人的 id 在这里同样查不到 —— 两种失败因此不可区分。
    const owned = await tx.passkey.findFirst({
      where: { id: passkeyId, userId },
      select: { id: true },
    });
    return owned === null ? ('missing' as const) : ('last' as const);
  });

  if (outcome === 'deleted') {
    Logger.audit({
      event: 'PASSKEY_DELETED',
      userId,
      // 只记服务端行 id，不记 credential ID —— 审计日志不是多一处凭据数据的理由。
      entityId: passkeyId,
    });
    return { deleted: true };
  }

  if (outcome === 'last') {
    throw new PasskeyError(
      'last_passkey_required',
      'Cannot delete the last passkey on this account',
    );
  }
  throw new PasskeyError('passkey_not_found_for_user', 'Passkey not found');
};
