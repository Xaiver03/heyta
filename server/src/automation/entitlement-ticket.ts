import { createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';

const UUID = z.string().uuid();
const IDENTIFIER = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/);
const RULE_ID = z.string().uuid();
const EVENT_ID = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/);
const TICKET_DOMAIN = 'heyta-automation-entitlement-v1.';
const MAX_TICKET_SECONDS = 30;
const CLOCK_SKEW_SECONDS = 5;
const REPLAY_RETENTION_MS = 5 * 60 * 1000;

/**
 * 🔴 票据的**封闭动作词表与作用域档**只有一份，在 `@heyta/inbound-core`（签发侧与宿主侧
 * 共用）；这里原样转出，服务端各调用点保持既有导入路径。`session` 是唯一能建立/续期短期
 * 绑定的动作，其余每一项都必须在它自己要保护的那次写事务里一次性消费 —— 否则一枚票据就成了
 * 一张 30 秒通用通行证，与[协议 §4](../../../docs/reference/inbound-automation-protocol.md) 要求的
 * "票据绑定 action、实例、账号、rule/event、nonce、版本和 expiry，最多 30 秒且一次使用"不符。
 */
import {
  AUTOMATION_ENTITLEMENT_ACTIONS,
  automationEntitlementScopeMismatch,
  type AutomationEntitlementAction,
} from '@heyta/inbound-core';

export { AUTOMATION_ENTITLEMENT_ACTIONS, AUTOMATION_ENTITLEMENT_SCOPES, type AutomationEntitlementAction } from '@heyta/inbound-core';

const claimsSchema = z.object({
  version: z.literal(1),
  issuer: z.string().min(1).max(255),
  keyId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  action: z.enum(AUTOMATION_ENTITLEMENT_ACTIONS),
  capability: z.literal('automation'),
  officialSubject: IDENTIFIER,
  installationId: UUID,
  localAccountUuid: UUID,
  ruleId: RULE_ID.optional(),
  eventId: EVENT_ID.optional(),
  nonce: UUID,
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  revocationVersion: z.number().int().nonnegative(),
}).strict().superRefine((value, ctx) => {
  if (value.expiresAt <= value.issuedAt || value.expiresAt - value.issuedAt > MAX_TICKET_SECONDS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Ticket lifetime must be at most 30 seconds' });
  }
  const mismatch = automationEntitlementScopeMismatch(value.action, value.ruleId, value.eventId);
  if (mismatch === 'RULE_SCOPE_MISSING') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Ticket scope must bind exactly the rule for this action' });
  }
  if (mismatch === 'EVENT_SCOPE_MISSING') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Ticket scope must bind exactly the event for this action' });
  }
  if (mismatch === 'SCOPE_NOT_ALLOWED') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'This action must not carry a rule or event scope' });
  }
});

const keyringSchema = z.object({
  issuer: z.string().min(1).max(255),
  instanceId: UUID,
  /** 运营者设定的吊销下限；低于它的票据与绑定一律不可用。 */
  minRevocationVersion: z.number().int().nonnegative().optional(),
  keys: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), z.string().regex(/^[A-Za-z0-9_-]{43}$/))
    .refine((keys) => Object.keys(keys).length > 0 && Object.keys(keys).length <= 32),
}).strict();

export type AutomationEntitlementTicket = z.infer<typeof claimsSchema>;
export type AutomationEntitlementKeyring = z.infer<typeof keyringSchema>;

/** 稳定拒绝码：响应只回码，日志只记码，绝不回显票据、主体或账号 UUID。 */
export const AUTOMATION_ENTITLEMENT_DENIALS = {
  ISSUER_NOT_CONFIGURED: 'AUTOMATION_ISSUER_NOT_CONFIGURED',
  TICKET_INVALID: 'AUTOMATION_TICKET_INVALID',
  TICKET_SCOPE_MISMATCH: 'AUTOMATION_TICKET_SCOPE_MISMATCH',
  TICKET_EXPIRED: 'AUTOMATION_TICKET_EXPIRED',
  TICKET_USED: 'AUTOMATION_TICKET_USED',
  LOCAL_ACCOUNT_MISMATCH: 'AUTOMATION_LOCAL_ACCOUNT_MISMATCH',
  SUBJECT_CONFLICT: 'AUTOMATION_SUBJECT_CONFLICT',
  REVOCATION_STALE: 'AUTOMATION_REVOCATION_STALE',
  CLOCK_ROLLBACK: 'AUTOMATION_CLOCK_ROLLBACK',
} as const;

export type AutomationEntitlementDenial = (typeof AUTOMATION_ENTITLEMENT_DENIALS)[keyof typeof AUTOMATION_ENTITLEMENT_DENIALS];

export class AutomationEntitlementError extends Error {
  readonly code: AutomationEntitlementDenial;
  constructor(code: AutomationEntitlementDenial) {
    super(`Automation entitlement rejected: ${code}`);
    this.code = code;
  }
}

const b64url = (value: Uint8Array): string => Buffer.from(value).toString('base64url');

function publicKeyFromRaw(raw: string): ReturnType<typeof createPublicKey> {
  const bytes = Buffer.from(raw, 'base64url');
  if (bytes.length !== 32) throw new Error('Invalid automation entitlement public key');
  // SubjectPublicKeyInfo prefix for Ed25519 (RFC 8410).
  return createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), bytes]), format: 'der', type: 'spki' });
}

export function loadAutomationEntitlementKeyring(raw = process.env.AUTOMATION_OFFICIAL_KEYS): AutomationEntitlementKeyring | undefined {
  if (!raw) return undefined;
  try {
    if (raw.length > 32_768) throw new Error();
    return keyringSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error('Invalid automation entitlement key configuration');
  }
}

export function signAutomationEntitlementTicket(
  claims: Omit<AutomationEntitlementTicket, 'version'> & { version?: 1 },
  privateKey: string | Buffer | KeyObject,
): string {
  const checked = claimsSchema.parse({ ...claims, version: 1 });
  const body = Buffer.from(JSON.stringify(checked), 'utf8');
  const signature = sign(null, Buffer.concat([Buffer.from(TICKET_DOMAIN, 'utf8'), body]), privateKey);
  return `${b64url(body)}.${b64url(signature)}`;
}

export type AutomationEntitlementTicketExpectation = {
  action: AutomationEntitlementAction;
  ruleId?: string;
  eventId?: string;
  localAccountUuid?: string;
};

/**
 * 与当前时刻无关的那一半判定：编码、签名、词表、action/作用域逐字匹配、签发者与
 * 实例属于本部署 keyring、不低于吊销下限、本地账号相符。
 *
 * 时间**不在这里判** —— 见 `redeemAutomationEntitlementTicket` 里锁后的那一步。
 */
export function inspectAutomationEntitlementTicket(
  token: string,
  keyring: AutomationEntitlementKeyring | undefined,
  expected: AutomationEntitlementTicketExpectation,
): { ok: true; claims: AutomationEntitlementTicket } | { ok: false; code: AutomationEntitlementDenial } {
  if (!keyring) return { ok: false, code: AUTOMATION_ENTITLEMENT_DENIALS.ISSUER_NOT_CONFIGURED };
  let claims: AutomationEntitlementTicket | undefined;
  try {
    if (typeof token !== 'string' || token.length > 8192) return { ok: false, code: AUTOMATION_ENTITLEMENT_DENIALS.TICKET_INVALID };
    const [bodyPart, signaturePart, extra] = token.split('.');
    if (extra !== undefined || !bodyPart || !signaturePart || !/^[A-Za-z0-9_-]+$/.test(bodyPart) || !/^[A-Za-z0-9_-]+$/.test(signaturePart)) {
      return { ok: false, code: AUTOMATION_ENTITLEMENT_DENIALS.TICKET_INVALID };
    }
    const body = Buffer.from(bodyPart, 'base64url');
    const signature = Buffer.from(signaturePart, 'base64url');
    if (body.toString('base64url') !== bodyPart || signature.toString('base64url') !== signaturePart || signature.length !== 64) {
      return { ok: false, code: AUTOMATION_ENTITLEMENT_DENIALS.TICKET_INVALID };
    }
    claims = claimsSchema.parse(JSON.parse(body.toString('utf8')));
    if (claims.issuer !== keyring.issuer || claims.installationId !== keyring.instanceId
      || !Object.prototype.hasOwnProperty.call(keyring.keys, claims.keyId)) {
      return { ok: false, code: AUTOMATION_ENTITLEMENT_DENIALS.TICKET_INVALID };
    }
    if (claims.revocationVersion < (keyring.minRevocationVersion ?? 0)) {
      return { ok: false, code: AUTOMATION_ENTITLEMENT_DENIALS.REVOCATION_STALE };
    }
    const signed = Buffer.concat([Buffer.from(TICKET_DOMAIN, 'utf8'), body]);
    if (!verify(null, signed, publicKeyFromRaw(keyring.keys[claims.keyId]!), signature)) {
      return { ok: false, code: AUTOMATION_ENTITLEMENT_DENIALS.TICKET_INVALID };
    }
  } catch {
    return { ok: false, code: AUTOMATION_ENTITLEMENT_DENIALS.TICKET_INVALID };
  }
  if (claims.action !== expected.action || claims.ruleId !== expected.ruleId || claims.eventId !== expected.eventId) {
    return { ok: false, code: AUTOMATION_ENTITLEMENT_DENIALS.TICKET_SCOPE_MISMATCH };
  }
  if (expected.localAccountUuid !== undefined && claims.localAccountUuid !== expected.localAccountUuid) {
    return { ok: false, code: AUTOMATION_ENTITLEMENT_DENIALS.LOCAL_ACCOUNT_MISMATCH };
  }
  return { ok: true, claims };
}

/** 与实例绑定的可信时钟高水位：回拨一旦发生就停止新的授权，直到运维确认。 */
export interface ConsumedAutomationEntitlement {
  readonly userId: number;
  readonly action: AutomationEntitlementAction;
  readonly officialSubject: string;
  readonly installationId: string;
  readonly localAccountUuid: string;
  readonly issuer: string;
  readonly keyId: string;
  readonly revocationVersion: number;
  readonly expiresAt: Date;
}

/**
 * 票据消费与绑定读写只用到这四个成员。用 Prisma 自己的类型而不是手抄一份
 * 结构体：抄来的形状与 `prisma`/`tx` 的真实签名对不上（`upsert` 的 create 是
 * 带必填字段的生成类型），而判定路径不许为了让 mock 好用就放宽成
 * `Record<string, unknown>`。测试要在 double 上跑真路径，就把 double 定成这个类型。
 */
export type EntitlementDatabase = Pick<
  Prisma.TransactionClient,
  '$queryRaw' | 'automationEntitlementBinding' | 'automationEntitlementTicketUse' | 'automationEntitlementClock'
>;

export interface AutomationEntitlementBindingRecord {
  readonly officialSubject: string;
  readonly installationId: string;
  readonly localAccountUuid: string;
  readonly issuer: string;
  readonly keyId: string;
  readonly revocationVersion: number;
  readonly expiresAt: Date;
}

const toMillis = (value: unknown): number | undefined => {
  if (typeof value === 'bigint') return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
};

/**
 * 生产路径的"当前时间"**只来自数据库**，并且必须在调用方持有账号锁之后读取：
 * 票据在锁外没过期，不等于落库那一刻还没过期。测试要驱动时钟就注入这个函数，
 * 不许换成"传一个绝对时间值" —— 那等于把生产边界一起放宽。
 */
const databaseNowMs = async (client: EntitlementDatabase): Promise<number> => {
  const rows = await client.$queryRaw`SELECT floor(extract(epoch from clock_timestamp())::numeric * 1000)::bigint AS "nowMs"`;
  const millis = toMillis((rows as { nowMs?: number | bigint }[])[0]?.nowMs);
  if (millis === undefined) throw new AutomationEntitlementError(AUTOMATION_ENTITLEMENT_DENIALS.TICKET_INVALID);
  return millis;
};

/**
 * 一次性消费一枚票据。**调用方必须已经持有该账号的 `FOR UPDATE` 锁**
 * （`session` 单独调用时这里补取）。
 *
 * 顺序是刻意的：离线判定（不依赖时钟，挡住伪造/错实例/错作用域）→ 账号锁 → 数据库时间
 * → 新鲜度 → 时钟回拨 → nonce 唯一插入 → 绑定（仅 `session`）。任何一步失败都不落任何状态。
 */
export async function redeemAutomationEntitlementTicket(input: {
  client: EntitlementDatabase;
  userId: number;
  action: AutomationEntitlementAction;
  ruleId?: string;
  eventId?: string;
  localAccountUuid?: string;
  token: string;
  keyring?: AutomationEntitlementKeyring;
  nowMs?: () => Promise<number>;
}): Promise<ConsumedAutomationEntitlement> {
  if (!Number.isSafeInteger(input.userId) || input.userId < 1) {
    throw new AutomationEntitlementError(AUTOMATION_ENTITLEMENT_DENIALS.TICKET_INVALID);
  }
  const keyring = input.keyring === undefined ? loadAutomationEntitlementKeyring() : input.keyring;
  const expected: AutomationEntitlementTicketExpectation = {
    action: input.action,
    ...(input.ruleId !== undefined ? { ruleId: input.ruleId } : {}),
    ...(input.eventId !== undefined ? { eventId: input.eventId } : {}),
    ...(input.localAccountUuid !== undefined ? { localAccountUuid: input.localAccountUuid } : {}),
  };
  const offline = inspectAutomationEntitlementTicket(input.token, keyring, expected);
  if (!offline.ok) throw new AutomationEntitlementError(offline.code);
  const claims = offline.claims;
  if (input.action === 'session' && input.localAccountUuid === undefined) {
    throw new AutomationEntitlementError(AUTOMATION_ENTITLEMENT_DENIALS.LOCAL_ACCOUNT_MISMATCH);
  }

  await input.client.$queryRaw`SELECT id FROM users WHERE id = ${input.userId} FOR UPDATE`;
  const nowMs = await (input.nowMs ?? (() => databaseNowMs(input.client)))();
  const nowSeconds = Math.floor(nowMs / 1000);
  if (claims.issuedAt > nowSeconds + CLOCK_SKEW_SECONDS || claims.expiresAt <= nowSeconds || claims.issuedAt > claims.expiresAt) {
    throw new AutomationEntitlementError(AUTOMATION_ENTITLEMENT_DENIALS.TICKET_EXPIRED);
  }

  const clock = await input.client.automationEntitlementClock.findUnique({ where: { installationId: claims.installationId } });
  const highWater = toMillis(clock?.maxSeenAtMs);
  if (highWater !== undefined && nowMs < highWater) {
    throw new AutomationEntitlementError(AUTOMATION_ENTITLEMENT_DENIALS.CLOCK_ROLLBACK);
  }

  const current = await input.client.automationEntitlementBinding.findUnique({ where: { userId: input.userId } });
  if (current && (current.officialSubject !== claims.officialSubject || current.installationId !== claims.installationId
    || current.localAccountUuid !== claims.localAccountUuid || current.issuer !== claims.issuer)) {
    throw new AutomationEntitlementError(AUTOMATION_ENTITLEMENT_DENIALS.SUBJECT_CONFLICT);
  }
  if (current && claims.revocationVersion < current.revocationVersion) {
    throw new AutomationEntitlementError(AUTOMATION_ENTITLEMENT_DENIALS.REVOCATION_STALE);
  }

  try {
    await input.client.automationEntitlementTicketUse.create({ data: {
      nonce: claims.nonce, userId: input.userId, action: claims.action,
      ruleId: claims.ruleId ?? null, eventId: claims.eventId ?? null,
      installationId: claims.installationId, expiresAt: new Date(claims.expiresAt * 1000),
    } });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') throw new AutomationEntitlementError(AUTOMATION_ENTITLEMENT_DENIALS.TICKET_USED);
    throw error;
  }

  await input.client.automationEntitlementClock.upsert({
    where: { installationId: claims.installationId },
    create: { installationId: claims.installationId, maxSeenAtMs: BigInt(nowMs) },
    update: { maxSeenAtMs: BigInt(Math.max(highWater ?? 0, nowMs)) },
  });

  // 🔴 只有 `session` 写绑定。操作票据留下的是消费记录，不是权益来源。
  if (input.action === 'session') {
    await input.client.automationEntitlementBinding.upsert({
      where: { userId: input.userId },
      create: { userId: input.userId, officialSubject: claims.officialSubject, installationId: claims.installationId,
        localAccountUuid: claims.localAccountUuid, issuer: claims.issuer, keyId: claims.keyId,
        revocationVersion: claims.revocationVersion, expiresAt: new Date(claims.expiresAt * 1000), checkedAt: new Date(nowMs) },
      update: { officialSubject: claims.officialSubject, installationId: claims.installationId,
        localAccountUuid: claims.localAccountUuid, issuer: claims.issuer, keyId: claims.keyId,
        revocationVersion: claims.revocationVersion, expiresAt: new Date(claims.expiresAt * 1000), checkedAt: new Date(nowMs) },
    });
  }

  return {
    userId: input.userId, action: claims.action, officialSubject: claims.officialSubject, installationId: claims.installationId,
    localAccountUuid: claims.localAccountUuid, issuer: claims.issuer, keyId: claims.keyId,
    revocationVersion: claims.revocationVersion, expiresAt: new Date(claims.expiresAt * 1000),
  };
}

/**
 * 绑定能否作为权益来源，除"没到期"外还取决于：它记录的签发者/实例仍是本部署
 * 配置的那一个，且不低于运营者的吊销下限。只看 expiry 会让"换实例、换钥、调高
 * 吊销版本"这些运维动作对已存在的绑定完全无效。
 */
export const isAutomationEntitlementBindingUsable = (
  binding: AutomationEntitlementBindingRecord | null | undefined,
  keyring: AutomationEntitlementKeyring | undefined,
  now = Date.now(),
): boolean => {
  if (!binding || !keyring) return false;
  if (binding.issuer !== keyring.issuer || binding.installationId !== keyring.instanceId) return false;
  if (binding.revocationVersion < (keyring.minRevocationVersion ?? 0)) return false;
  return binding.expiresAt.getTime() > now;
};

/** Remove consumed nonces only after the ticket's expiry plus replay buffer. */
export async function purgeExpiredAutomationEntitlementTicketUses(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - REPLAY_RETENTION_MS);
  const result = await prisma.automationEntitlementTicketUse.deleteMany({ where: { expiresAt: { lt: cutoff } } });
  return result.count;
}
