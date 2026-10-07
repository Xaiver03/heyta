import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { SuperSyncClientIdSchema } from '@heyta/shared-schema';

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const grantSchema = z.object({
  userId: z.number().int().positive().max(2147483647),
  workerId: z.string().uuid(),
  syncClientId: SuperSyncClientIdSchema,
  databaseEpoch: identifier,
  eventId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/),
  itemCount: z.number().int().min(1).max(50),
}).strict();
const claimsSchema = grantSchema.extend({
  version: z.literal(1),
  instanceId: z.string().uuid(),
  keyId: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
}).strict();
const keyringSchema = z.object({
  instanceId: z.string().uuid(),
  activeKeyId: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  keys: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,32}$/), z.string().regex(/^[0-9a-f]{64}$/))
    .refine((keys) => Object.keys(keys).length > 0 && Object.keys(keys).length <= 32),
}).strict().refine((value) => Object.prototype.hasOwnProperty.call(value.keys, value.activeKeyId));
export type CommitGrant = z.infer<typeof grantSchema>;
export type CommitProofKeyring = z.infer<typeof keyringSchema>;
const DOMAIN = 'heyta-inbound-commit-v1.';

/** Separate deployment secret, never JWT_SECRET, a webhook credential or a vault key. */
export function loadCommitProofKeyring(raw = process.env.AUTOMATION_COMMIT_KEYS): CommitProofKeyring | undefined {
  if (!raw) return undefined;
  try {
    if (raw.length > 8192) throw new Error();
    return keyringSchema.parse(JSON.parse(raw));
  } catch { throw new Error('Invalid automation commit signing configuration'); }
}

/** Only after commit authorization succeeds. No rule/content/digest is in this receipt. */
export function signCommitProof(grant: CommitGrant, keyring: CommitProofKeyring): string {
  const result = keyringSchema.safeParse(keyring);
  if (!result.success) throw new Error('Invalid automation commit signing configuration');
  const checked = result.data;
  const claims = claimsSchema.parse({ ...grantSchema.parse(grant), version: 1,
    instanceId: checked.instanceId, keyId: checked.activeKeyId });
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', Buffer.from(checked.keys[checked.activeKeyId], 'hex'))
    .update(DOMAIN + body).digest('base64url');
  return `${body}.${signature}`;
}

/** The grant deliberately has no TTL: it is an already-authorized local intent. */
export function verifyCommitProof(token: string, keyring: CommitProofKeyring | undefined): CommitGrant | undefined {
  if (!keyring || typeof token !== 'string' || token.length > 2048) return undefined;
  try {
    const [body, signature, extra] = token.split('.');
    if (extra !== undefined || !body || !signature || !/^[A-Za-z0-9_-]+$/.test(body) ||
        !/^[A-Za-z0-9_-]{43}$/.test(signature)) return undefined;
    const raw = Buffer.from(body, 'base64url');
    if (raw.toString('base64url') !== body) return undefined;
    const claims = claimsSchema.parse(JSON.parse(raw.toString('utf8')));
    if (claims.instanceId !== keyring.instanceId || !Object.prototype.hasOwnProperty.call(keyring.keys, claims.keyId)) return undefined;
    const actual = Buffer.from(signature, 'base64url');
    if (actual.toString('base64url') !== signature) return undefined;
    const expected = createHmac('sha256', Buffer.from(keyring.keys[claims.keyId], 'hex')).update(DOMAIN + body).digest();
    if (!timingSafeEqual(actual, expected)) return undefined;
    const { version: _version, instanceId: _instanceId, keyId: _keyId, ...grant } = claims;
    return grant;
  } catch { return undefined; }
}
