import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { prisma } from '../db';
import { authorizeAutomationWrite } from '../entitlement';

const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;
const KEK = /^[0-9a-f]{64}$/;
const deploymentKey = (): Buffer => {
  const value = process.env.AUTOMATION_SENDER_KEK;
  if (!value || !KEK.test(value)) throw new Error('Automation sender credential encryption is not configured');
  return Buffer.from(value, 'hex');
};
const aad = (userId: number, ruleId: string, keyId: string): Buffer => Buffer.from(`heyta-sender-v1:${userId}:${ruleId}:${keyId}`);
const seal = (secret: Buffer, userId: number, ruleId: string, keyId: string): string => {
  const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', deploymentKey(), nonce); cipher.setAAD(aad(userId, ruleId, keyId));
  const body = Buffer.concat([cipher.update(secret), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), body]).toString('base64url');
};
const open = (ciphertext: string, userId: number, ruleId: string, keyId: string): Buffer => {
  const raw = Buffer.from(ciphertext, 'base64url'); if (raw.length < 29 || raw[0] !== 1) throw new Error('Invalid sender credential');
  const decipher = createDecipheriv('aes-256-gcm', deploymentKey(), raw.subarray(1, 13)); decipher.setAAD(aad(userId, ruleId, keyId)); decipher.setAuthTag(raw.subarray(13, 29));
  return Buffer.concat([decipher.update(raw.subarray(29)), decipher.final()]);
};
export interface IssuedSenderCredential { credentialId: string; keyId: string; secret: string; ruleId: string; }
export interface SenderCredentialSummary { credentialId: string; keyId: string; createdAt: string; revokedAt: string | null; rotatedAt: string | null; }
export interface SenderCredentialResolution { configured: boolean; credentialId?: string; secret?: Uint8Array; }
const validate = (userId: number, ruleId: string, keyId: string): void => {
  if (!Number.isSafeInteger(userId) || userId < 1 || !/^[0-9a-f-]{36}$/.test(ruleId) || !KEY_ID.test(keyId)) throw new Error('Invalid sender credential');
};
export async function issueSenderCredential(userId: number, ruleId: string, keyId: string, ticket?: string): Promise<IssuedSenderCredential> {
  validate(userId, ruleId, keyId); const secret = randomBytes(32);
  try {
    const row = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const rule = await tx.automationRule.findFirst({ where: { id: ruleId, userId, deletedAt: null } }); if (!rule) throw new Error('Automation rule not found');
      // 签发会把同一 keyId 的旧凭据一并吊销 —— 那是不可逆的一步，所以授权必须
      // 走在它之前，且与 create 落在同一个事务里。
      await authorizeAutomationWrite({ client: tx, userId, action: 'sender-credential-issue', ruleId, ...(ticket === undefined ? {} : { ticket }) });
      await tx.automationSenderCredential.updateMany({ where: { userId, ruleId, keyId, revokedAt: null }, data: { revokedAt: BigInt(Date.now()), rotatedAt: BigInt(Date.now()) } });
      return tx.automationSenderCredential.create({ data: { id: randomUUID(), userId, ruleId, keyId, secretCiphertext: seal(secret, userId, ruleId, keyId) } });
    });
    return { credentialId: row.id, keyId, secret: secret.toString('base64url'), ruleId };
  } finally { secret.fill(0); }
}
export async function loadSenderCredentialSecret(userId: number, ruleId: string, keyId: string): Promise<Uint8Array | undefined> {
  validate(userId, ruleId, keyId);
  const row = await prisma.automationSenderCredential.findFirst({ where: { userId, ruleId, keyId, revokedAt: null } });
  if (!row) return undefined;
  const secret = open(row.secretCiphertext, userId, ruleId, keyId); try { return Uint8Array.from(secret); } finally { secret.fill(0); }
}

/**
 * Resolve the account-managed credential without allowing a revoked or
 * corrupted row to fall back to the legacy environment keyring. `configured`
 * is intentionally true for revoked rows: once an account has moved to the
 * managed credential path, revocation must be an effective deny operation.
 */
export async function resolveSenderCredential(userId: number, ruleId: string, keyId: string): Promise<SenderCredentialResolution> {
  validate(userId, ruleId, keyId);
  const row = await prisma.automationSenderCredential.findFirst({
    where: { userId, ruleId, keyId },
    orderBy: { createdAt: 'desc' },
  });
  if (!row || row.revokedAt !== null) return { configured: row !== null };
  const secret = open(row.secretCiphertext, userId, ruleId, keyId);
  try { return { configured: true, credentialId: row.id, secret: Uint8Array.from(secret) }; }
  finally { secret.fill(0); }
}
export async function revokeSenderCredential(userId: number, credentialId: string): Promise<boolean> {
  if (!Number.isSafeInteger(userId) || userId < 1 || !/^[0-9a-f-]{36}$/.test(credentialId)) return false;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const result = await tx.automationSenderCredential.updateMany({ where: { id: credentialId, userId, revokedAt: null }, data: { revokedAt: BigInt(Date.now()) } });
    return result.count === 1;
  });
}

export async function listSenderCredentials(userId: number, ruleId: string): Promise<SenderCredentialSummary[]> {
  if (!Number.isSafeInteger(userId) || userId < 1 || !/^[0-9a-f-]{36}$/.test(ruleId)) throw new Error('Invalid sender credential');
  const rows = await prisma.automationSenderCredential.findMany({ where: { userId, ruleId }, orderBy: { createdAt: 'desc' }, select: { id: true, keyId: true, createdAt: true, revokedAt: true, rotatedAt: true } });
  return rows.map((row) => ({ credentialId: row.id, keyId: row.keyId, createdAt: row.createdAt.toISOString(), revokedAt: row.revokedAt === null ? null : row.revokedAt.toString(), rotatedAt: row.rotatedAt === null ? null : row.rotatedAt.toString() }));
}
