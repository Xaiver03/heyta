import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes } from '@noble/hashes/utils.js';
import { equalBytes } from '@noble/curves/utils.js';
import { aesEncrypt, aesDecrypt, getRandomBytes, encodeBase64, decodeBase64 } from '@heyta/sync-core';
import {
  INBOUND_MAX_PLAINTEXT_BYTES, inboundEnvelopeContextSchema, inboundEnvelopeSchema,
  inboundKeyScopeSchema, inboundWrappedKeySchema,
  type InboundEnvelope, type InboundEnvelopeContext, type InboundKeyScope, type InboundWrappedKey,
} from '@heyta/shared-schema';

function fail(): never { throw new Error('Invalid inbound cryptographic envelope'); }
const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);
const checkKey = (key: Uint8Array): void => { if (!(key instanceof Uint8Array) || key.length !== 32) fail(); };

function canonicalBase64(value: string, length?: number): Uint8Array {
  const bytes = new Uint8Array(decodeBase64(value));
  if ((length !== undefined && bytes.length !== length) || encodeBase64(bytes) !== value) fail();
  return bytes;
}

function contextAad(context: InboundEnvelopeContext): Uint8Array {
  const parsed = inboundEnvelopeContextSchema.safeParse(context);
  if (!parsed.success) fail();
  const c = parsed.data;
  return utf8(JSON.stringify(['heyta-inbound-v1', c.serverOrigin, c.accountId, c.ruleId, c.eventId, c.purpose, c.keyEpoch]));
}

function wrappingAad(scope: InboundKeyScope, publicKey: string): Uint8Array {
  const parsed = inboundKeyScopeSchema.safeParse(scope);
  if (!parsed.success) fail();
  const s = parsed.data;
  return utf8(JSON.stringify(['heyta-inbound-key-v1', s.serverOrigin, s.accountId, s.keyEpoch, publicKey]));
}

function envelopeKey(secret: Uint8Array, aad: Uint8Array, ephemeral: Uint8Array, recipient: Uint8Array): Uint8Array {
  return hkdf(sha256, secret, sha256(aad), concatBytes(utf8('heyta-inbound-x25519-aes256gcm-v1'), ephemeral, recipient), 32);
}

/** Caller owns the private bytes and must wipe them after wrapping/session use. */
export function generateInboundKeyPair(): { privateKey: Uint8Array; publicKey: string } {
  const privateKey = getRandomBytes(32);
  try { return { privateKey, publicKey: encodeBase64(x25519.getPublicKey(privateKey)) }; }
  catch { privateKey.fill(0); return fail(); }
}

/** Derive the canonical recipient key for sealing a worker's frozen result. */
export function inboundPublicKey(privateKey: Uint8Array): string {
  checkKey(privateKey);
  try { return encodeBase64(x25519.getPublicKey(privateKey)); } catch { return fail(); }
}

/** Public-key encryption is shared by the receiver and client result publisher. */
export async function sealInbound(
  plaintext: Uint8Array, recipientPublicKey: string, context: InboundEnvelopeContext,
): Promise<InboundEnvelope> {
  if (!(plaintext instanceof Uint8Array) || plaintext.byteLength > INBOUND_MAX_PLAINTEXT_BYTES) fail();
  const aad = contextAad(context);
  const keyEpoch = context.keyEpoch;
  const recipient = canonicalBase64(recipientPublicKey, 32);
  const privateKey = getRandomBytes(32);
  const body = plaintext.slice();
  let shared: Uint8Array | undefined;
  let key: Uint8Array | undefined;
  try {
    const ephemeral = x25519.getPublicKey(privateKey);
    // noble rejects an all-zero shared secret (low-order public keys).
    shared = x25519.getSharedSecret(privateKey, recipient);
    key = envelopeKey(shared, aad, ephemeral, recipient);
    const nonce = getRandomBytes(12);
    const ciphertext = await aesEncrypt(key, nonce, body, aad);
    return { version: 1, keyEpoch, ephemeralPublicKey: encodeBase64(ephemeral), nonce: encodeBase64(nonce), ciphertext: encodeBase64(ciphertext) };
  } catch { return fail(); }
  finally { privateKey.fill(0); body.fill(0); shared?.fill(0); key?.fill(0); }
}

export async function openInbound(
  value: unknown, privateKey: Uint8Array, context: InboundEnvelopeContext,
): Promise<Uint8Array> {
  checkKey(privateKey);
  const parsed = inboundEnvelopeSchema.safeParse(value);
  if (!parsed.success || parsed.data.keyEpoch !== context.keyEpoch) fail();
  const envelope = parsed.data;
  const aad = contextAad(context);
  const ephemeral = canonicalBase64(envelope.ephemeralPublicKey, 32);
  const nonce = canonicalBase64(envelope.nonce, 12);
  const ciphertext = canonicalBase64(envelope.ciphertext);
  if (ciphertext.length < 16 || ciphertext.length > INBOUND_MAX_PLAINTEXT_BYTES + 16) fail();
  let shared: Uint8Array | undefined;
  let key: Uint8Array | undefined;
  try {
    const recipient = x25519.getPublicKey(privateKey);
    shared = x25519.getSharedSecret(privateKey, ephemeral);
    key = envelopeKey(shared, aad, ephemeral, recipient);
    return await aesDecrypt(key, nonce, ciphertext, aad);
  } catch { return fail(); }
  finally { shared?.fill(0); key?.fill(0); }
}

/** Only this wrapped value may be persisted; never the root/private bytes. */
export async function wrapInboundKey(
  privateKey: Uint8Array, rootKey: Uint8Array, scope: InboundKeyScope,
): Promise<InboundWrappedKey> {
  checkKey(privateKey); checkKey(rootKey);
  const publicKey = encodeBase64(x25519.getPublicKey(privateKey));
  const aad = wrappingAad(scope, publicKey);
  const keyEpoch = scope.keyEpoch;
  const key = hkdf(sha256, rootKey, sha256(aad), utf8('heyta-inbound-root-wrap-v1'), 32);
  const privateCopy = privateKey.slice();
  try {
    const nonce = getRandomBytes(12);
    const ciphertext = await aesEncrypt(key, nonce, privateCopy, aad);
    return { version: 1, keyEpoch, publicKey, nonce: encodeBase64(nonce), ciphertext: encodeBase64(ciphertext) };
  } catch { return fail(); }
  finally { key.fill(0); privateCopy.fill(0); }
}

export async function unwrapInboundKey(value: unknown, rootKey: Uint8Array, scope: InboundKeyScope): Promise<Uint8Array> {
  checkKey(rootKey);
  const parsed = inboundWrappedKeySchema.safeParse(value);
  if (!parsed.success || parsed.data.keyEpoch !== scope.keyEpoch) fail();
  const envelope = parsed.data;
  const publicKey = canonicalBase64(envelope.publicKey, 32);
  const aad = wrappingAad(scope, envelope.publicKey);
  const key = hkdf(sha256, rootKey, sha256(aad), utf8('heyta-inbound-root-wrap-v1'), 32);
  let privateKey: Uint8Array | undefined;
  try {
    privateKey = await aesDecrypt(key, canonicalBase64(envelope.nonce, 12), canonicalBase64(envelope.ciphertext, 48), aad);
    if (privateKey.length !== 32 || !equalBytes(x25519.getPublicKey(privateKey), publicKey)) fail();
    return privateKey;
  } catch { privateKey?.fill(0); return fail(); }
  finally { key.fill(0); }
}
