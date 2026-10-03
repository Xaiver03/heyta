import { beforeEach, describe, expect, it } from 'vitest';
import {
  createVaultKeyPackage,
  assertEncryptedVaultRecord,
  assertVaultKeyPackage,
  decryptVaultRecord,
  decodeBase64,
  deriveVaultFeatureKey,
  encodeBase64,
  encryptVaultRecord,
  generateRecoveryCode,
  normalizeRecoveryCode,
  reencryptVaultRecords,
  rewrapVaultKeyPackage,
  rotateVaultKey,
  unlockVaultWithPassphrase,
  unlockVaultWithRecoveryCode,
} from '../src';
import { setArgon2ParamsForTesting } from '../src';

describe('versioned E2EE key lifecycle', () => {
  beforeEach(() => {
    setArgon2ParamsForTesting({ parallelism: 1, memorySize: 8, iterations: 1 });
  });

  it('generates a checksummed recovery code and accepts grouping/case changes', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^(?:[0-9A-HJKMNP-TV-Z]{4}-){9}[0-9A-HJKMNP-TV-Z]{4}$/);
    const canonical = normalizeRecoveryCode(code.toLowerCase().replaceAll('-', ' '));
    expect(canonical).toHaveLength(40);
    const badChecksum = `${canonical.slice(0, -1)}${canonical.at(-1) === '0' ? '1' : '0'}`;
    expect(() => normalizeRecoveryCode(badChecksum)).toThrow('Invalid recovery code');
  });

  it('unlocks the same root with passphrase and recovery code', async () => {
    const created = await createVaultKeyPackage('correct horse battery staple');
    await expect(unlockVaultWithPassphrase(created.package, 'correct horse battery staple'))
      .resolves.toEqual(created.rootKey);
    await expect(unlockVaultWithRecoveryCode(created.package, created.recoveryCode))
      .resolves.toEqual(created.rootKey);
    await expect(unlockVaultWithPassphrase(created.package, 'wrong passphrase')).rejects.toBeDefined();
  });

  it('derives independent feature keys with explicit domain separation', async () => {
    const created = await createVaultKeyPackage('passphrase');
    const sync = deriveVaultFeatureKey(created.rootKey, 'sync');
    const ai = deriveVaultFeatureKey(created.rootKey, 'ai-task-planning');
    expect(sync).not.toEqual(ai);
    expect(() => deriveVaultFeatureKey(created.rootKey, 'sync:ai' as never)).toThrow('Invalid vault key purpose');
    expect(() => deriveVaultFeatureKey(created.rootKey, 'unknown' as never)).toThrow('Invalid vault key purpose');
  });

  it('encrypts records and binds identity, purpose, and version as authenticated metadata', async () => {
    const created = await createVaultKeyPackage('passphrase');
    const record = await encryptVaultRecord('task-1', '{"title":"secret"}', created.rootKey, 'sync');
    await expect(decryptVaultRecord(record, created.rootKey)).resolves.toBe('{"title":"secret"}');
    await expect(decryptVaultRecord({ ...record, purpose: 'ai-feedback' }, created.rootKey)).rejects.toBeDefined();
    await expect(decryptVaultRecord({ ...record, keyVersion: 2 }, created.rootKey)).rejects.toBeDefined();
    await expect(decryptVaultRecord({ ...record, id: 'task-2' }, created.rootKey)).rejects.toBeDefined();
  });

  it('rejects malformed packages and records before cryptographic work', async () => {
    const created = await createVaultKeyPackage('passphrase');
    expect(() => assertVaultKeyPackage({ ...created.package, version: 2 })).toThrow('Invalid vault key package');
    expect(() => assertVaultKeyPackage({ ...created.package, keyVersion: 1.5 })).toThrow('Invalid vault key version');
    expect(() => assertVaultKeyPackage({
      ...created.package,
      passphrase: { ...created.package.passphrase, kdf: 'scrypt' },
    })).toThrow('Invalid vault key wrapper');
    expect(() => assertVaultKeyPackage({
      ...created.package,
      passphrase: { ...created.package.passphrase, unknown: true },
    })).toThrow('Invalid vault key wrapper');
    expect(() => assertVaultKeyPackage({
      ...created.package,
      rootKeyFingerprint: 'Z'.repeat(64),
    })).toThrow('Invalid vault key package');
    expect(() => assertEncryptedVaultRecord({
      id: '', purpose: 'sync', keyVersion: 1, ciphertext: 'AAAA',
    })).toThrow('Invalid encrypted vault record');
    expect(() => assertEncryptedVaultRecord({
      id: 'task', purpose: 'unknown', keyVersion: 1, ciphertext: 'AAAA',
    })).toThrow('Invalid encrypted vault record');
    const record = await encryptVaultRecord('task', 'secret', created.rootKey, 'sync');
    const envelope = new Uint8Array(decodeBase64(record.ciphertext));
    envelope[0] = 2;
    expect(() => assertEncryptedVaultRecord({ ...record, ciphertext: encodeBase64(envelope) }))
      .toThrow('Invalid vault record envelope');
    await expect(createVaultKeyPackage('passphrase', 0)).rejects.toThrow('Invalid vault key version');
    await expect(createVaultKeyPackage('passphrase', 1.5)).rejects.toThrow('Invalid vault key version');
  });

  it('rotates the root and re-encrypts all records atomically from the caller perspective', async () => {
    const created = await createVaultKeyPackage('old passphrase');
    const records = await Promise.all([
      encryptVaultRecord('a', 'alpha', created.rootKey, 'sync'),
      encryptVaultRecord('b', 'beta', created.rootKey, 'ai-feedback'),
    ]);
    const rotated = await rotateVaultKey(created.package, created.rootKey, 'new passphrase');
    expect(rotated.package.keyVersion).toBe(2);
    const migrated = await reencryptVaultRecords(records, created.rootKey, rotated.rootKey, rotated.package.keyVersion);
    await expect(unlockVaultWithPassphrase(rotated.package, 'new passphrase')).resolves.toEqual(rotated.rootKey);
    await expect(decryptVaultRecord(migrated[0], rotated.rootKey)).resolves.toBe('alpha');
    await expect(decryptVaultRecord(migrated[1], rotated.rootKey)).resolves.toBe('beta');
    await expect(reencryptVaultRecords([
      { ...records[0], ciphertext: `${records[0].ciphertext.slice(0, -2)}AA` },
      records[1],
    ], created.rootKey, rotated.rootKey, 2)).rejects.toBeDefined();
  });

  it('re-wraps the same root for a passphrase change and issues a fresh recovery code', async () => {
    const created = await createVaultKeyPackage('old passphrase');
    const changed = await rewrapVaultKeyPackage(created.package, created.rootKey, 'new passphrase');
    expect(changed.package.keyVersion).toBe(created.package.keyVersion + 1);
    expect(changed.package.rootKeyFingerprint).toBe(created.package.rootKeyFingerprint);
    expect(changed.rootKey).toEqual(created.rootKey);
    expect(changed.recoveryCode).not.toBe(created.recoveryCode);
    await expect(unlockVaultWithPassphrase(changed.package, 'new passphrase')).resolves.toEqual(created.rootKey);
    await expect(unlockVaultWithRecoveryCode(changed.package, changed.recoveryCode)).resolves.toEqual(created.rootKey);
    await expect(unlockVaultWithRecoveryCode(changed.package, created.recoveryCode)).rejects.toBeDefined();
  });
});
