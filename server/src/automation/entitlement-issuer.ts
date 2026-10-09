import { createHash, createPrivateKey, createPublicKey, randomBytes, sign as cryptoSign, verify as cryptoVerify, randomUUID, type KeyObject } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AUTOMATION_ENTITLEMENT_ACTIONS, AUTOMATION_ENTITLEMENT_SCOPES, loadAutomationEntitlementKeyring, signAutomationEntitlementTicket, type AutomationEntitlementAction, type AutomationEntitlementKeyring } from './entitlement-ticket';

/**
 * 🔴 自动收集权益的**签发端**。判定内核（`entitlement-ticket.ts`）只管"这枚票据是不是
 * 本部署信任的签发者签的、有没有过期、有没有被用过"；它管不到"该不该签"。
 * "该不该签"必须有服务端记录的事实来源，否则自托管那侧的 `localAccountUuid` 与
 * `installationId` 都是客户端自己填的，票据就成了可定制的通行证。
 *
 * 这一层提供三份事实：
 * - `subjects`：一个账号一个跨实例稳定的**不透明公开主体**（不是本地数字 userId）；
 * - `activations`：一次性激活码，把"这台实例 + 这个本地账号"和主体牵起来；
 * - `links`：牵成之后的绑定本身，也是此后 `session` 票据三个 claims 的唯一来源。
 */

const UUID = z.string().uuid();
const BASE64URL_32 = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** 激活码明文只出一次；库里存的是它的 SHA-256，泄漏数据库不等于泄漏活码。 */
const ACTIVATION_CODE_BYTES = 24;
const ACTIVATION_TTL_MS = 15 * 60 * 1000;
const ACTIVATION_RESEND_MIN_MS = 60 * 1000;
const ACTIVATION_RESEND_MAX = 5;

/** 吊销清单是公开信息，但它必须是**签过名**的公开信息，且可缓存期有上限。 */
export const REVOCATION_MANIFEST_DOMAIN = 'heyta-automation-revocation-v1.';
export const AUTOMATION_REVOCATION_SCOPE = 'global';
const MAX_MANIFEST_MS = 24 * 60 * 60 * 1000;

/**
 * 签发端自己的失败码。与票据消费那九条拒绝码分开：那些讲"票据坏"，这些讲"不该签"。
 * 🔴 字面量住在 `@heyta/inbound-core`（`AUTOMATION_ENTITLEMENT_ACTIONS` 同一个理由）：
 * 宿主要靠其中三枚判"该显示等待权益"，两端各抄一遍时漂移的症状是宿主把该停的重试
 * 当成可重试。这里原样转出，服务端各调用点保持既有导入路径。
 */
import { AUTOMATION_ISSUER_DENIALS, type AutomationIssuerDenial } from '@heyta/inbound-core';

export { AUTOMATION_ISSUER_DENIALS, type AutomationIssuerDenial } from '@heyta/inbound-core';

export class AutomationIssuerError extends Error {
  readonly code: AutomationIssuerDenial;
  constructor(code: AutomationIssuerDenial) {
    super(`Automation entitlement issuance rejected: ${code}`);
    this.code = code;
  }
}

export type IssuerDatabase = Pick<
  Prisma.TransactionClient,
  'automationEntitlementSubject' | 'automationEntitlementActivation' | 'automationEntitlementLink' | 'automationEntitlementRevocation'
>;

export type AutomationEntitlementSubjectRecord = { userId: number; subject: string };
export type AutomationEntitlementLinkRecord = {
  installationId: string;
  userId: number;
  subject: string;
  localAccountUuid: string;
  boundAt: Date;
  revokedAt: Date | null;
};

const manifestClaimsSchema = z.object({
  version: z.literal(1),
  issuer: z.string().min(1).max(255),
  keyId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  scope: z.literal(AUTOMATION_REVOCATION_SCOPE),
  revocationVersion: z.number().int().nonnegative(),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
}).strict().superRefine((value, ctx) => {
  if (value.expiresAt <= value.issuedAt || value.expiresAt - value.issuedAt > MAX_MANIFEST_MS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Revocation manifest lifetime must be between 0 and 24 hours' });
  }
});

export type AutomationRevocationManifestClaims = z.infer<typeof manifestClaimsSchema>;

/** 官方签发端的私钥侧配置。公钥侧（供自托管实例验签）是 `AUTOMATION_OFFICIAL_KEYS`，两份分开管理。 */
const issuerConfigSchema = z.object({
  /** 与公钥侧 keyring 的 `issuer` 逐字相同；它就是一个 URL，不是标识符。 */
  issuer: z.string().min(1).max(255),
  keyId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  /** Ed25519 私钥种子（RFC 8410，base64url 的 32 字节）。 */
  privateKeySeed: BASE64URL_32,
}).strict();

export type AutomationEntitlementIssuer = z.infer<typeof issuerConfigSchema>;

export function loadAutomationEntitlementIssuer(
  env: NodeJS.ProcessEnv = process.env,
): AutomationEntitlementIssuer | undefined {
  const seed = env.AUTOMATION_OFFICIAL_PRIVATE_KEY;
  const issuer = env.AUTOMATION_OFFICIAL_ISSUER;
  const keyId = env.AUTOMATION_OFFICIAL_KEY_ID;
  if (seed === undefined || issuer === undefined || keyId === undefined) return undefined;
  try {
    return issuerConfigSchema.parse({ issuer, keyId, privateKeySeed: seed });
  } catch {
    throw new Error('Invalid automation entitlement issuer configuration');
  }
}

/** 种子 → PKCS#8 v1 Ed25519 私钥（前缀见 RFC 8410 A.4），与公钥侧的裸 32 字节对称。 */
export function automationIssuerPrivateKey(seed: string): KeyObject {
  const bytes = Buffer.from(seed, 'base64url');
  if (bytes.length !== 32) throw new Error('Invalid automation entitlement issuer private key');
  return createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), bytes]),
    format: 'der',
    type: 'pkcs8',
  });
}

const b64url = (value: Uint8Array): string => Buffer.from(value).toString('base64url');

const ACTIVATION_CODE_DOMAIN = 'heyta-automation-activation-v1.';

export const automationActivationCodeHash = (code: string): string =>
  createHash('sha256').update(`${ACTIVATION_CODE_DOMAIN}${code}`).digest('hex');

/**
 * 一个账号一个跨实例稳定的公开主体。首次请求时惰性生成；生成后**永不改**，
 * 因为票据 claims、links 与对外说明都指向它，换主体等价于重新绑定。
 */
export async function ensureAutomationEntitlementSubject(
  client: IssuerDatabase,
  userId: number,
): Promise<AutomationEntitlementSubjectRecord> {
  const existing = await client.automationEntitlementSubject.findUnique({ where: { userId } });
  if (existing) return { userId: existing.userId, subject: existing.subject };
  const subject = `htsub_${randomBytes(16).toString('hex')}`;
  try {
    const created = await client.automationEntitlementSubject.create({ data: { userId, subject } });
    return { userId: created.userId, subject: created.subject };
  } catch (error) {
    // 并发首取：唯一约束替我们做了裁决，读回赢的那一条。
    if ((error as { code?: string }).code === 'P2002') {
      const row = await client.automationEntitlementSubject.findUnique({ where: { userId } });
      if (row) return { userId: row.userId, subject: row.subject };
    }
    throw error;
  }
}

/**
 * 发一张（或重发当前那一张）一次性激活码。一台实例同时只有一张活码 —— 主键就是
 * `(userId, installationId)`，所以"重发"是覆盖而不是新增，历史不留在这张表里。
 * 节流是刻意的：活码是能换出付费权益的东西，不许被拿来穷举。
 */
export async function issueAutomationEntitlementActivation(input: {
  client: IssuerDatabase;
  userId: number;
  installationId: string;
  now?: Date;
}): Promise<{ code: string; expiresAt: Date; subject: string }> {
  UUID.parse(input.installationId);
  const now = input.now ?? new Date();
  const { subject } = await ensureAutomationEntitlementSubject(input.client, input.userId);
  const where = { userId_installationId: { userId: input.userId, installationId: input.installationId } };
  const existing = await input.client.automationEntitlementActivation.findUnique({ where });
  const code = randomBytes(ACTIVATION_CODE_BYTES).toString('base64url');
  const expiresAt = new Date(now.getTime() + ACTIVATION_TTL_MS);
  if (!existing) {
    await input.client.automationEntitlementActivation.create({
      data: { userId: input.userId, installationId: input.installationId, codeHash: automationActivationCodeHash(code), expiresAt, lastSentAt: now, resendCount: 0 },
    });
    return { code, expiresAt, subject };
  }
  if (now.getTime() - existing.lastSentAt.getTime() < ACTIVATION_RESEND_MIN_MS) {
    throw new AutomationIssuerError(AUTOMATION_ISSUER_DENIALS.ACTIVATION_RATE_LIMITED);
  }
  if (existing.resendCount >= ACTIVATION_RESEND_MAX) {
    throw new AutomationIssuerError(AUTOMATION_ISSUER_DENIALS.ACTIVATION_RESEND_EXHAUSTED);
  }
  await input.client.automationEntitlementActivation.update({
    where,
    data: { codeHash: automationActivationCodeHash(code), expiresAt, lastSentAt: now, resendCount: { increment: 1 } },
  });
  return { code, expiresAt, subject };
}

/**
 * 兑换活码 = 把 (主体, 实例, 本地账号) 记成一条服务端事实。
 *
 * 🔴 三道"对不上就拒"：码不属于这个账号 / 码是给另一台实例发的 / 这台实例已经绑给了
 * 别的主体或别的本地账号。最后那一条是换绑必须**先撤销**的原因 —— 否则一枚新码就能把
 * 别人在这台实例上的绑定顶掉。兑换成功后活码行删除：一次性是行为，不是标志位。
 */
export async function redeemAutomationEntitlementActivation(input: {
  client: IssuerDatabase;
  userId: number;
  code: string;
  installationId: string;
  localAccountUuid: string;
  now?: Date;
}): Promise<AutomationEntitlementLinkRecord> {
  UUID.parse(input.installationId);
  UUID.parse(input.localAccountUuid);
  const now = input.now ?? new Date();
  const activation = await input.client.automationEntitlementActivation.findUnique({
    where: { codeHash: automationActivationCodeHash(input.code) },
  });
  const subjectRow = activation && activation.userId === input.userId
    ? await input.client.automationEntitlementSubject.findUnique({ where: { userId: input.userId } })
    : null;
  if (!activation || !subjectRow || activation.userId !== input.userId || activation.expiresAt.getTime() <= now.getTime()) {
    throw new AutomationIssuerError(AUTOMATION_ISSUER_DENIALS.ACTIVATION_INVALID);
  }
  if (activation.installationId !== input.installationId) {
    throw new AutomationIssuerError(AUTOMATION_ISSUER_DENIALS.ACTIVATION_INVALID);
  }
  const current = await input.client.automationEntitlementLink.findUnique({ where: { installationId: input.installationId } });
  if (current && current.revokedAt === null) {
    const same = current.userId === input.userId && current.subject === subjectRow.subject
      && current.localAccountUuid === input.localAccountUuid;
    if (!same) throw new AutomationIssuerError(AUTOMATION_ISSUER_DENIALS.LINK_CONFLICT);
  }
  const link = current
    ? await input.client.automationEntitlementLink.update({
      where: { installationId: input.installationId },
      data: { userId: input.userId, subject: subjectRow.subject, localAccountUuid: input.localAccountUuid, boundAt: now, revokedAt: null },
    })
    : await input.client.automationEntitlementLink.create({
      data: {
        installationId: input.installationId, userId: input.userId, subject: subjectRow.subject,
        localAccountUuid: input.localAccountUuid, boundAt: now,
      },
    });
  await input.client.automationEntitlementActivation.delete({
    where: { userId_installationId: { userId: activation.userId, installationId: activation.installationId } },
  });
  return {
    installationId: link.installationId, userId: link.userId, subject: link.subject,
    localAccountUuid: link.localAccountUuid, boundAt: link.boundAt, revokedAt: link.revokedAt,
  };
}

/** 撤销绑定：只置时间戳，不删行 —— 删了就等于允许别人把同一台实例的号重新绑上去而无痕。 */
export async function revokeAutomationEntitlementLink(input: {
  client: IssuerDatabase;
  userId: number;
  installationId: string;
  now?: Date;
}): Promise<boolean> {
  const result = await input.client.automationEntitlementLink.updateMany({
    where: { installationId: input.installationId, userId: input.userId, revokedAt: null },
    data: { revokedAt: input.now ?? new Date() },
  });
  return result.count > 0;
}

/**
 * 签一枚 `session` 票据。**三个 claims 全部取自 links 行**，请求体一个字都不参与：
 * 这就是"绑实"的可执行含义 —— 兑换过一次之后，客户端再自报别的本地账号或实例，
 * 签出来的票据不会跟着变。未绑定 / 已撤销 / 不属于这个账号，一律不签。
 */
export async function signAutomationEntitlementSessionTicket(input: {
  client: IssuerDatabase;
  userId: number;
  installationId: string;
  issuer: AutomationEntitlementIssuer;
  /** 票据里带的吊销下限；由调用方从"环境变量下限"与"在线刷新到的下限"里取较大值。 */
  revocationVersion: number;
  lifetimeSeconds?: number;
  now?: number;
}): Promise<{ token: string; expiresAt: Date; subject: string }> {
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  const link = await input.client.automationEntitlementLink.findUnique({ where: { installationId: input.installationId } });
  if (!link || link.revokedAt !== null) throw new AutomationIssuerError(AUTOMATION_ISSUER_DENIALS.LINK_NOT_BOUND);
  if (link.userId !== input.userId) throw new AutomationIssuerError(AUTOMATION_ISSUER_DENIALS.SUBJECT_MISMATCH);
  const lifetime = input.lifetimeSeconds ?? 30;
  const token = signAutomationEntitlementTicket({
    issuer: input.issuer.issuer,
    keyId: input.issuer.keyId,
    action: 'session',
    capability: 'automation',
    officialSubject: link.subject,
    installationId: link.installationId,
    localAccountUuid: link.localAccountUuid,
    nonce: randomUUID(),
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + lifetime,
    revocationVersion: input.revocationVersion,
  }, automationIssuerPrivateKey(input.issuer.privateKeySeed));
  return { token, expiresAt: new Date((nowSeconds + lifetime) * 1000), subject: link.subject };
}

/**
 * 签一枚**逐次放行**的动作票据。宿主侧原来只有 `session` 一条取票通道，其余动作
 * （启用规则、签发凭据、注册 worker、领取、发布结果、预留、提交许可、草稿确认）在
 * 自托管模式下**没有任何供给方** —— 闸门判"要票据"，却没人能给它票据。
 *
 * 🔴 这里签的是"这个主体可以在这个作用域上做这一个动作"，不是"这个 rule/event 真的存在"：
 * 官方实例手里只有 `links` 与订阅，客户实例上的规则与事件它看不到，也不该看到（E2EE）。
 * "作用域属于这个本地账号"由**自托管那一侧**判定 —— 它读的是自己库里的 `automation_rules`
 * / `automation_events`。两侧各管各的事实，不在这里合成。
 */
export async function signAutomationEntitlementActionTicket(input: {
  client: IssuerDatabase;
  userId: number;
  installationId: string;
  action: AutomationEntitlementAction;
  ruleId?: string;
  eventId?: string;
  issuer: AutomationEntitlementIssuer;
  revocationVersion: number;
  lifetimeSeconds?: number;
  now?: number;
}): Promise<{ token: string; expiresAt: Date; subject: string; action: AutomationEntitlementAction }> {
  // `session` 走它自己那条：那条同时是"建立绑定"的凭证，作用域要求也不同（它要带
  // 绑定三字段里的 localAccountUuid 语义），混用会让一次登录换到一张通用通行证。
  if (input.action === 'session' || !(AUTOMATION_ENTITLEMENT_ACTIONS as readonly string[]).includes(input.action)) {
    throw new AutomationIssuerError(AUTOMATION_ISSUER_DENIALS.ACTION_UNKNOWN);
  }
  const scope = AUTOMATION_ENTITLEMENT_SCOPES[input.action];
  const ruleMatches = scope === 'rule' ? input.ruleId !== undefined : input.ruleId === undefined;
  const eventMatches = scope === 'event' ? input.eventId !== undefined : input.eventId === undefined;
  if (!ruleMatches || !eventMatches) throw new AutomationIssuerError(AUTOMATION_ISSUER_DENIALS.SCOPE_MISMATCH);
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  const link = await input.client.automationEntitlementLink.findUnique({ where: { installationId: input.installationId } });
  if (!link || link.revokedAt !== null) throw new AutomationIssuerError(AUTOMATION_ISSUER_DENIALS.LINK_NOT_BOUND);
  if (link.userId !== input.userId) throw new AutomationIssuerError(AUTOMATION_ISSUER_DENIALS.SUBJECT_MISMATCH);
  const lifetime = input.lifetimeSeconds ?? 30;
  const token = signAutomationEntitlementTicket({
    issuer: input.issuer.issuer,
    keyId: input.issuer.keyId,
    action: input.action,
    capability: 'automation',
    officialSubject: link.subject,
    installationId: link.installationId,
    localAccountUuid: link.localAccountUuid,
    ...(input.ruleId === undefined ? {} : { ruleId: input.ruleId }),
    ...(input.eventId === undefined ? {} : { eventId: input.eventId }),
    nonce: randomUUID(),
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + lifetime,
    revocationVersion: input.revocationVersion,
  }, automationIssuerPrivateKey(input.issuer.privateKeySeed));
  return { token, expiresAt: new Date((nowSeconds + lifetime) * 1000), subject: link.subject, action: input.action };
}

const publicKeyRawFor = (keyring: AutomationEntitlementKeyring, keyId: string): Buffer => {
  const raw = Buffer.from(keyring.keys[keyId]!, 'base64url');
  if (raw.length !== 32) throw new Error('Invalid automation entitlement public key');
  return raw;
};

/** 签一份吊销清单。清单只说一件事：现在的全局下限是多少，以及这份声明到什么时候为止。 */
export function signAutomationRevocationManifest(input: {
  issuer: AutomationEntitlementIssuer;
  revocationVersion: number;
  lifetimeMs?: number;
  now?: number;
}): string {
  const claims: AutomationRevocationManifestClaims = {
    version: 1,
    issuer: input.issuer.issuer,
    keyId: input.issuer.keyId,
    scope: AUTOMATION_REVOCATION_SCOPE,
    revocationVersion: input.revocationVersion,
    issuedAt: Math.floor((input.now ?? Date.now()) / 1000),
    expiresAt: Math.floor(((input.now ?? Date.now()) + (input.lifetimeMs ?? 60 * 60 * 1000)) / 1000),
  };
  manifestClaimsSchema.parse(claims);
  const body = Buffer.from(JSON.stringify(claims), 'utf8');
  const signature = cryptoSign(null, Buffer.concat([Buffer.from(REVOCATION_MANIFEST_DOMAIN, 'utf8'), body]), automationIssuerPrivateKey(input.issuer.privateKeySeed));
  return `${b64url(body)}.${b64url(signature)}`;
}

/**
 * 自托管侧吃一份清单：**验签用的公钥只来自本部署配置的 keyring**，清单自己说的
 * 任何密钥身份都不算数（否则签发者就能现编一把钥来"降低"下限）。合并是单调的：
 * 比库里低的值被忽略而不是报错 —— 缓存与重放都会送旧清单过来，那不该中断授权。
 */
export function inspectAutomationRevocationManifest(
  manifest: string,
  keyring: AutomationEntitlementKeyring | undefined,
): { ok: true; claims: AutomationRevocationManifestClaims } | { ok: false; code: AutomationIssuerDenial } {
  if (!keyring) return { ok: false, code: AUTOMATION_ISSUER_DENIALS.ISSUER_NOT_CONFIGURED };
  let claims: AutomationRevocationManifestClaims;
  try {
    if (typeof manifest !== 'string' || manifest.length > 8192) return { ok: false, code: AUTOMATION_ISSUER_DENIALS.MANIFEST_INVALID };
    const [bodyPart, signaturePart, extra] = manifest.split('.');
    if (extra !== undefined || !bodyPart || !signaturePart) return { ok: false, code: AUTOMATION_ISSUER_DENIALS.MANIFEST_INVALID };
    const body = Buffer.from(bodyPart, 'base64url');
    const signature = Buffer.from(signaturePart, 'base64url');
    if (body.toString('base64url') !== bodyPart || signature.toString('base64url') !== signaturePart || signature.length !== 64) {
      return { ok: false, code: AUTOMATION_ISSUER_DENIALS.MANIFEST_INVALID };
    }
    claims = manifestClaimsSchema.parse(JSON.parse(body.toString('utf8')));
    if (claims.issuer !== keyring.issuer || !Object.prototype.hasOwnProperty.call(keyring.keys, claims.keyId)) {
      return { ok: false, code: AUTOMATION_ISSUER_DENIALS.MANIFEST_INVALID };
    }
    const publicKey = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), publicKeyRawFor(keyring, claims.keyId)]),
      format: 'der',
      type: 'spki',
    });
    if (!cryptoVerify(null, Buffer.concat([Buffer.from(REVOCATION_MANIFEST_DOMAIN, 'utf8'), body]), publicKey, signature)) {
      return { ok: false, code: AUTOMATION_ISSUER_DENIALS.MANIFEST_INVALID };
    }
  } catch {
    return { ok: false, code: AUTOMATION_ISSUER_DENIALS.MANIFEST_INVALID };
  }
  return { ok: true, claims };
}

export async function readAutomationRevocationFloor(client: IssuerDatabase, scope = AUTOMATION_REVOCATION_SCOPE): Promise<number> {
  const row = await client.automationEntitlementRevocation.findUnique({ where: { scope } });
  return row?.revocationVersion ?? 0;
}

/** 运营者抬下限：只许升。降回去等于让已吊销的票据重新有效，那不是运维动作而是事故。 */
export async function bumpAutomationRevocationFloor(input: {
  client: IssuerDatabase;
  revocationVersion: number;
  now?: Date;
}): Promise<number> {
  const current = await readAutomationRevocationFloor(input.client);
  if (input.revocationVersion <= current) {
    throw new AutomationIssuerError(AUTOMATION_ISSUER_DENIALS.REVOCATION_NOT_INCREASING);
  }
  const at = input.now ?? new Date();
  await input.client.automationEntitlementRevocation.upsert({
    where: { scope: AUTOMATION_REVOCATION_SCOPE },
    create: { scope: AUTOMATION_REVOCATION_SCOPE, revocationVersion: input.revocationVersion, updatedAt: at },
    update: { revocationVersion: input.revocationVersion, updatedAt: at },
  });
  return input.revocationVersion;
}

/**
 * 自托管侧应用一份清单：验签 → 单调合并 → 落库，返回合并后的下限。
 * 落库的是**从已签名清单里解出来的数**，不是请求体里的数。
 */
export async function applyAutomationRevocationManifest(input: {
  client: IssuerDatabase;
  manifest: string;
  keyring?: AutomationEntitlementKeyring | undefined;
  now?: number;
}): Promise<{ revocationVersion: number; refreshed: boolean }> {
  const inspected = inspectAutomationRevocationManifest(
    input.manifest, input.keyring === undefined ? loadAutomationEntitlementKeyring() : input.keyring,
  );
  if (!inspected.ok) throw new AutomationIssuerError(inspected.code);
  const now = input.now ?? Date.now();
  const current = await readAutomationRevocationFloor(input.client);
  if (inspected.claims.revocationVersion <= current) return { revocationVersion: current, refreshed: false };
  const at = new Date(now);
  await input.client.automationEntitlementRevocation.upsert({
    where: { scope: AUTOMATION_REVOCATION_SCOPE },
    create: {
      scope: AUTOMATION_REVOCATION_SCOPE, revocationVersion: inspected.claims.revocationVersion,
      manifestKeyId: inspected.claims.keyId, manifestExpiresAt: new Date(inspected.claims.expiresAt * 1000), updatedAt: at,
    },
    update: {
      revocationVersion: inspected.claims.revocationVersion,
      manifestKeyId: inspected.claims.keyId, manifestExpiresAt: new Date(inspected.claims.expiresAt * 1000), updatedAt: at,
    },
  });
  return { revocationVersion: inspected.claims.revocationVersion, refreshed: true };
}

/**
 * 判定用的有效下限 = 部署手配的下限与在线刷新到的下限里**较大**的那一个。
 * 只看环境变量，"在线刷新"就只是往库里写了个数；只看库里那个，重启换部署就丢。
 */
export async function loadEffectiveAutomationKeyring(
  client: IssuerDatabase,
  keyring?: AutomationEntitlementKeyring,
): Promise<AutomationEntitlementKeyring | undefined> {
  const base = keyring ?? loadAutomationEntitlementKeyring();
  if (!base) return undefined;
  const refreshed = await readAutomationRevocationFloor(client);
  const floor = Math.max(base.minRevocationVersion ?? 0, refreshed);
  return { ...base, minRevocationVersion: floor };
}
