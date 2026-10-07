import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, createDecipheriv, createCipheriv, createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { equalBytes } from '@noble/curves/utils.js';
import { INBOUND_MAX_PLAINTEXT_BYTES, type InboundEnvelopeContext } from '@heyta/shared-schema';
import { generateInboundKeyPair, sealInbound, openInbound, wrapInboundKey, unwrapInboundKey } from '../src/index.js';

const context: InboundEnvelopeContext = { accountId: 'account', serverOrigin: 'https://example.test', ruleId: 'rule', eventId: 'event', keyEpoch: 1, purpose: 'input' };
const scope = { accountId: context.accountId, serverOrigin: context.serverOrigin, keyEpoch: context.keyEpoch };
const plaintext = new TextEncoder().encode('synthetic inbound payload');
afterEach(() => vi.unstubAllGlobals());

describe.each(['webcrypto', 'pure-js'] as const)('inbound envelope / %s', (backend) => {
  const setup = () => vi.stubGlobal('crypto', backend === 'webcrypto'
    ? webcrypto
    : { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });

  it('roundtrips input and wrapped keys without persisting private bytes', async () => {
    setup();
    const pair = generateInboundKeyPair();
    const root = new Uint8Array(32).fill(7);
    try {
      const wrapped = await wrapInboundKey(pair.privateKey, root, scope);
      expect(Object.keys(wrapped).sort()).toEqual(['ciphertext', 'keyEpoch', 'nonce', 'publicKey', 'version']);
      const recovered = await unwrapInboundKey(wrapped, root, scope);
      try {
        expect(equalBytes(recovered, pair.privateKey)).toBe(true);
        const envelope = await sealInbound(plaintext, pair.publicKey, context);
        const opened = await openInbound(envelope, recovered, context);
        expect(equalBytes(opened, plaintext)).toBe(true);
        opened.fill(0);
        const second = await sealInbound(plaintext, pair.publicKey, context);
        expect(envelope.ciphertext === second.ciphertext).toBe(false);
        expect(envelope.ephemeralPublicKey === second.ephemeralPublicKey).toBe(false);
      } finally { recovered.fill(0); }
    } finally { pair.privateKey.fill(0); root.fill(0); }
  });

  it('binds account, origin, rule, event, purpose and key epoch', async () => {
    setup(); const pair = generateInboundKeyPair();
    try {
      const envelope = await sealInbound(plaintext, pair.publicKey, context);
      const overrides = [
        { accountId: 'other' }, { serverOrigin: 'https://other.test' }, { ruleId: 'other' },
        { eventId: 'other' }, { purpose: 'result' as const }, { keyEpoch: 2 },
      ];
      for (const override of overrides) {
        await expect(openInbound(envelope, pair.privateKey, { ...context, ...override })).rejects.toThrow();
      }
      for (const field of ['nonce', 'ciphertext', 'ephemeralPublicKey'] as const) {
        const bytes = Buffer.from(envelope[field], 'base64'); bytes[0] = bytes[0]! ^ 1;
        await expect(openInbound({ ...envelope, [field]: bytes.toString('base64') }, pair.privateKey, context)).rejects.toThrow();
      }
      await expect(openInbound({ ...envelope, version: 2 }, pair.privateKey, context)).rejects.toThrow();
      await expect(openInbound({ ...envelope, extra: 'not allowed' }, pair.privateKey, context)).rejects.toThrow();
      await expect(openInbound({ ...envelope, ciphertext: `${envelope.ciphertext}\n` }, pair.privateKey, context)).rejects.toThrow();
    } finally { pair.privateKey.fill(0); }
  });

  it('rejects low-order public keys and wrong wrapping roots/epochs/public keys', async () => {
    setup(); const pair = generateInboundKeyPair();
    const root = new Uint8Array(32).fill(7);
    try {
      await expect(sealInbound(plaintext, Buffer.alloc(32).toString('base64'), context)).rejects.toThrow();
      const wrapped = await wrapInboundKey(pair.privateKey, root, scope);
      await expect(unwrapInboundKey(wrapped, new Uint8Array(32).fill(8), scope)).rejects.toThrow();
      await expect(unwrapInboundKey(wrapped, root, { ...scope, keyEpoch: 2 })).rejects.toThrow();
      await expect(unwrapInboundKey(wrapped, root, { ...scope, accountId: 'other' })).rejects.toThrow();
      await expect(unwrapInboundKey({ ...wrapped, publicKey: Buffer.alloc(32).toString('base64') }, root, scope)).rejects.toThrow();
      await expect(wrapInboundKey(new Uint8Array(31), root, scope)).rejects.toThrow();
    } finally { pair.privateKey.fill(0); root.fill(0); }
  });

  it('accepts exact plaintext cap and refuses cap + 1 before encryption', async () => {
    setup(); const pair = generateInboundKeyPair();
    try {
      for (const size of [0, INBOUND_MAX_PLAINTEXT_BYTES]) {
        const envelope = await sealInbound(new Uint8Array(size), pair.publicKey, context);
        const opened = await openInbound(envelope, pair.privateKey, context);
        expect(opened.byteLength).toBe(size); opened.fill(0);
      }
      await expect(sealInbound(new Uint8Array(INBOUND_MAX_PLAINTEXT_BYTES + 1), pair.publicKey, context)).rejects.toThrow();
    } finally { pair.privateKey.fill(0); }
  });

  it('captures caller bytes and scope before asynchronous crypto work', async () => {
    setup(); const pair = generateInboundKeyPair();
    const body = plaintext.slice();
    const mutableContext = { ...context };
    const pending = sealInbound(body, pair.publicKey, mutableContext);
    body.fill(0); mutableContext.keyEpoch = 2;
    try {
      const envelope = await pending;
      expect(envelope.keyEpoch).toBe(1);
      const opened = await openInbound(envelope, pair.privateKey, context);
      expect(equalBytes(opened, plaintext)).toBe(true); opened.fill(0);
      const copy = pair.privateKey.slice();
      const mutableScope = { ...scope };
      const root = new Uint8Array(32).fill(7);
      const wrapping = wrapInboundKey(copy, root, mutableScope);
      copy.fill(0); mutableScope.keyEpoch = 2;
      const recovered = await unwrapInboundKey(await wrapping, root, scope);
      expect(equalBytes(recovered, pair.privateKey)).toBe(true);
      recovered.fill(0); root.fill(0);
    } finally { pair.privateKey.fill(0); }
  });
});

it('interoperates with independently implemented Node X25519/HKDF/AES-GCM', async () => {
  const pair = generateInboundKeyPair();
  let shared: Buffer | undefined;
  let key: Buffer | undefined;
  try {
    const envelope = await sealInbound(plaintext, pair.publicKey, context);
    const privateDer = Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), Buffer.from(pair.privateKey)]);
    const nodePrivate = createPrivateKey({ key: privateDer, type: 'pkcs8', format: 'der' });
    privateDer.fill(0);
    const epk = Buffer.from(envelope.ephemeralPublicKey, 'base64');
    const nodePublic = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), epk]), type: 'spki', format: 'der' });
    shared = diffieHellman({ privateKey: nodePrivate, publicKey: nodePublic });
    const aad = Buffer.from(JSON.stringify(['heyta-inbound-v1', context.serverOrigin, context.accountId, context.ruleId, context.eventId, context.purpose, context.keyEpoch]));
    const salt = createHash('sha256').update(aad).digest();
    const info = Buffer.concat([Buffer.from('heyta-inbound-x25519-aes256gcm-v1'), epk, Buffer.from(pair.publicKey, 'base64')]);
    key = Buffer.from(hkdfSync('sha256', shared, salt, info, 32));
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64'));
    decipher.setAAD(aad); decipher.setAuthTag(ciphertext.subarray(-16));
    const opened = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
    expect(equalBytes(opened, plaintext)).toBe(true); opened.fill(0);

    // Reverse direction: Node authors the envelope, the portable implementation reads it.
    const sender = generateKeyPairSync('x25519');
    const senderPublic = sender.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
    const recipientPublic = createPublicKey(nodePrivate);
    shared.fill(0); key.fill(0);
    shared = diffieHellman({ privateKey: sender.privateKey, publicKey: recipientPublic });
    const reverseInfo = Buffer.concat([Buffer.from('heyta-inbound-x25519-aes256gcm-v1'), senderPublic, Buffer.from(pair.publicKey, 'base64')]);
    key = Buffer.from(hkdfSync('sha256', shared, salt, reverseInfo, 32));
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(aad);
    const reversed = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    const reversePlaintext = await openInbound({ version: 1, keyEpoch: 1, ephemeralPublicKey: senderPublic.toString('base64'), nonce: nonce.toString('base64'), ciphertext: reversed.toString('base64') }, pair.privateKey, context);
    expect(equalBytes(reversePlaintext, plaintext)).toBe(true); reversePlaintext.fill(0);
  } finally { pair.privateKey.fill(0); shared?.fill(0); key?.fill(0); }
});
