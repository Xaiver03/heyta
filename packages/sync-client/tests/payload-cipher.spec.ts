import { describe, expect, it } from 'vitest';
import { decodeBase64, encodeBase64, encrypt, isEncryptedPayloadTransportShape } from '@heyta/sync-core';
import { createPasswordPayloadCipher, createVaultPayloadCipher } from '../src/payload-cipher.js';

const identity = {
  id: 'op-a', clientId: 'device-a', actionType: 'CREATE_TASK', opType: 'CRT',
  entityType: 'TASK', entityId: 'task-a', timestamp: 100, schemaVersion: 1,
};
const rootKey = new Uint8Array(32).fill(42);
const cipher = () => createVaultPayloadCipher({ current: { keyVersion: 1, rootKey } });

describe('versioned sync payload cipher', () => {
  it('authenticates empty entityIds with the same identity as their omitted HTTP download shape', async () => {
    const encoded = await cipher().encrypt('single task', { ...identity, entityIds: [] });
    expect(await cipher().decrypt(encoded, identity)).toBe('single task');
    const omitted = await cipher().encrypt('single task', identity);
    expect(await cipher().decrypt(omitted, { ...identity, entityIds: [] })).toBe('single task');
    await expect(cipher().decrypt(encoded, { ...identity, entityIds: ['other-task'] })).rejects.toThrow();
  });

  it('roundtrips unicode without a password and stays in the server base64 transport contract', async () => {
    const encoded = await cipher().encrypt('{"title":"任务 🦊"}', identity);
    expect(isEncryptedPayloadTransportShape(encoded)).toBe(true);
    expect(await cipher().decrypt(encoded, identity)).toBe('{"title":"任务 🦊"}');
    expect(await cipher().encrypt('{"title":"任务 🦊"}', identity)).not.toBe(encoded);
  });

  it.each(['id', 'clientId', 'actionType', 'opType', 'entityType', 'entityId'] as const)(
    'rejects a server transplant that changes %s', async (field) => {
      const encoded = await cipher().encrypt('secret', identity);
      await expect(cipher().decrypt(encoded, { ...identity, [field]: 'replacement' })).rejects.toThrow();
    },
  );

  it('rejects an unavailable version and authenticates version even with the same root', async () => {
    const encoded = await cipher().encrypt('secret', identity);
    const other = createVaultPayloadCipher({ current: { keyVersion: 2, rootKey } });
    await expect(other.decrypt(encoded, identity)).rejects.toThrow('version unavailable');
    const bytes = new Uint8Array(decodeBase64(encoded));
    new DataView(bytes.buffer).setFloat64('heyta-vault-op/'.length + 1, 2, false);
    await expect(other.decrypt(encodeBase64(bytes), identity)).rejects.toThrow();
  });

  it('reads an explicitly retained older key while writing only the current version', async () => {
    const old = await cipher().encrypt('old', identity);
    const next = createVaultPayloadCipher({
      current: { keyVersion: 2, rootKey: new Uint8Array(32).fill(7) },
      previous: [{ keyVersion: 1, rootKey }],
    });
    expect(await next.decrypt(old, identity)).toBe('old');
    const encoded = await next.encrypt('new', identity);
    expect(await next.decrypt(encoded, identity)).toBe('new');
    await expect(cipher().decrypt(encoded, identity)).rejects.toThrow('version unavailable');
  });

  it('only permits legacy reads when a migration password was explicitly supplied', async () => {
    const legacy = await encrypt('old payload', 'legacy passphrase');
    await expect(cipher().decrypt(legacy, identity)).rejects.toThrow('Legacy key required');
    const mixed = createVaultPayloadCipher({ current: { keyVersion: 1, rootKey }, legacyPassword: 'legacy passphrase' });
    expect(await mixed.decrypt(legacy, identity)).toBe('old payload');
    const encoded = await mixed.encrypt('new payload', identity);
    await expect(createPasswordPayloadCipher('legacy passphrase').decrypt(encoded, identity)).rejects.toThrow('Vault key required');
  });

  it('does not interpret recognised but damaged vault records as legacy ciphertext', async () => {
    const encoded = await cipher().encrypt('secret', identity);
    const bytes = new Uint8Array(decodeBase64(encoded));
    bytes['heyta-vault-op/'.length] = 99;
    const mixed = createVaultPayloadCipher({ current: { keyVersion: 1, rootKey }, legacyPassword: 'unused' });
    await expect(mixed.decrypt(encodeBase64(bytes), identity)).rejects.toThrow('Invalid vault operation envelope');
  });

  it('captures key material so external buffer mutation cannot corrupt an in-flight batch', async () => {
    const mutable = rootKey.slice();
    const session = createVaultPayloadCipher({ current: { keyVersion: 1, rootKey: mutable } });
    mutable.fill(0);
    const encoded = await session.encrypt('stable', identity);
    expect(await cipher().decrypt(encoded, identity)).toBe('stable');
  });

  it('resolves historical versions lazily without enumerating an untrusted range', async () => {
    const encoded = await cipher().encrypt('old', identity);
    const requested: number[] = [];
    const lazy = createVaultPayloadCipher({
      current: { keyVersion: Number.MAX_SAFE_INTEGER, rootKey },
      resolveKeyVersion: (version) => {
        requested.push(version);
        return version === 1 ? rootKey : undefined;
      },
    });

    expect(await lazy.decrypt(encoded, identity)).toBe('old');
    expect(requested).toEqual([1]);

    const hostile = new Uint8Array(decodeBase64(encoded));
    new DataView(hostile.buffer, hostile.byteOffset, hostile.byteLength)
      .setFloat64('heyta-vault-op/'.length + 1, Number.MAX_SAFE_INTEGER - 1, false);
    await expect(lazy.decrypt(encodeBase64(hostile), identity))
      .rejects.toThrow('Vault key version unavailable');
    expect(requested).toEqual([1, Number.MAX_SAFE_INTEGER - 1]);
  });
});
