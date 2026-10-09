import { z } from 'zod';

export const INBOUND_MAX_PLAINTEXT_BYTES = 512 * 1024;
const b64 = (bytes: number) => z.string().length(4 * Math.ceil(bytes / 3))
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9:_-]*$/);
const epoch = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const inboundKeyScopeSchema = z.object({
  accountId: id,
  serverOrigin: z.string().max(2048).url().refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value;
    } catch { return false; }
  }),
  keyEpoch: epoch,
}).strict();

export const inboundEnvelopeContextSchema = inboundKeyScopeSchema.extend({
  ruleId: id,
  eventId: id,
  purpose: z.enum(['input', 'result']),
}).strict();

export const inboundEnvelopeSchema = z.object({
  version: z.literal(1),
  keyEpoch: epoch,
  ephemeralPublicKey: b64(32),
  nonce: b64(12),
  ciphertext: z.string().min(24).max(4 * Math.ceil((INBOUND_MAX_PLAINTEXT_BYTES + 16) / 3))
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict();

export const inboundWrappedKeySchema = z.object({
  version: z.literal(1),
  keyEpoch: epoch,
  publicKey: b64(32),
  nonce: b64(12),
  ciphertext: b64(48),
}).strict();

export type InboundKeyScope = z.infer<typeof inboundKeyScopeSchema>;
export type InboundEnvelopeContext = z.infer<typeof inboundEnvelopeContextSchema>;
export type InboundEnvelope = z.infer<typeof inboundEnvelopeSchema>;
export type InboundWrappedKey = z.infer<typeof inboundWrappedKeySchema>;
