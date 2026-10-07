import { describe, expect, it } from 'vitest';
import { loadCommitProofKeyring, signCommitProof, verifyCommitProof } from '../src/automation/commit-proof';
const ring = { instanceId: '6ff03f66-5bdb-48ab-a8e7-3606f38b7bf3', activeKeyId: 'test', keys: { test: '11'.repeat(32) } };
const grant = { userId: 1, workerId: 'e9c798e5-05e9-45b2-9dbb-26c5a56a5572', syncClientId: 'a', databaseEpoch: 'epoch', eventId: 'event', itemCount: 2 };
describe('owner-held commit receipt', () => {
  it('verifies without a rule, event row, digest or plaintext', () => {
    const token = signCommitProof(grant, ring);
    expect(verifyCommitProof(token, ring)).toEqual(grant);
    const claims = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
    expect(Object.keys(claims).sort()).toEqual([...Object.keys(grant), 'version', 'instanceId', 'keyId'].sort());
  });
  it('rejects body/signature tampering, truncation, padding and another instance', () => {
    const token = signCommitProof(grant, ring);
    const [body, signature] = token.split('.');
    const altered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), workerId: '94b7cc53-de86-4b65-80fa-f4d1d801c29b' })).toString('base64url');
    for (const invalid of [`${altered}.${signature}`, `${body}.${'A'.repeat(43)}`, token.slice(0, -1), token + '=', token + '.x']) {
      expect(verifyCommitProof(invalid, ring)).toBeUndefined();
    }
    expect(verifyCommitProof(token, { ...ring, instanceId: 'a4cfcfae-3691-4fc0-a0db-1c0d8b885e68' })).toBeUndefined();
    expect(verifyCommitProof(token, undefined)).toBeUndefined();
  });
  it('rotation keeps old verification keys; removing one invalidates only its proofs', () => {
    const old = signCommitProof(grant, ring);
    const rotated = { ...ring, activeKeyId: 'new', keys: { ...ring.keys, new: '22'.repeat(32) } };
    const current = signCommitProof(grant, rotated);
    expect(verifyCommitProof(old, rotated)).toEqual(grant);
    expect(verifyCommitProof(current, rotated)).toEqual(grant);
    expect(verifyCommitProof(old, { ...rotated, keys: { new: '22'.repeat(32) } })).toBeUndefined();
  });
  it('fails closed on bad configuration without reflecting the secret', () => {
    expect(loadCommitProofKeyring('')).toBeUndefined();
    expect(loadCommitProofKeyring(JSON.stringify(ring))).toEqual(ring);
    expect(() => loadCommitProofKeyring('{"secret":"do-not-echo"}')).toThrow('Invalid automation commit signing configuration');
    expect(() => loadCommitProofKeyring(JSON.stringify({ ...ring, activeKeyId: 'missing' }))).toThrow();
  });
});
