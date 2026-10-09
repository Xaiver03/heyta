import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ prisma: { $transaction: vi.fn(), automationSenderCredential: { findFirst: vi.fn(), updateMany: vi.fn() } }, row: undefined as any }));
vi.mock('../src/db', () => ({ prisma: mocks.prisma }));
import { issueSenderCredential, loadSenderCredentialSecret, revokeSenderCredential } from '../src/automation/sender-credentials';
const userId = 7; const ruleId = '11111111-1111-4111-8111-111111111111';
beforeEach(() => {
  vi.clearAllMocks(); process.env.AUTOMATION_SENDER_KEK = '11'.repeat(32); mocks.row = undefined;
  mocks.prisma.$transaction.mockImplementation(async (fn: (db: unknown) => unknown) => fn({
    $queryRaw: vi.fn(), automationRule: { findFirst: vi.fn().mockResolvedValue({ id: ruleId }) },
    automationSenderCredential: { updateMany: mocks.prisma.automationSenderCredential.updateMany, create: vi.fn().mockImplementation(async ({ data }) => {
      mocks.row = { id: data.id, userId, ruleId, keyId: data.keyId, secretCiphertext: data.secretCiphertext, revokedAt: null }; return mocks.row;
    }) },
  }));
  mocks.prisma.automationSenderCredential.findFirst.mockImplementation(async () => mocks.row?.revokedAt == null ? mocks.row : null);
  mocks.prisma.automationSenderCredential.updateMany.mockResolvedValue({ count: 1 });
});
describe('deployment-KEK wrapped sender credentials', () => {
  it('returns a one-time secret and stores only wrapped ciphertext', async () => {
    const issued = await issueSenderCredential(userId, ruleId, 'hook-v1');
    expect(issued.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mocks.row.secretCiphertext).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(mocks.row.secretCiphertext).not.toContain(issued.secret);
    const loaded = await loadSenderCredentialSecret(userId, ruleId, issued.keyId);
    expect(Buffer.from(loaded!).toString('base64url')).toBe(issued.secret);
  });
  it('binds decryption to the exact account/rule/key and rejects revoked or tampered ciphertext', async () => {
    const issued = await issueSenderCredential(userId, ruleId, 'hook-v1');
    expect(await loadSenderCredentialSecret(userId, ruleId, issued.keyId)).toBeInstanceOf(Uint8Array);
    await expect(loadSenderCredentialSecret(userId, '22222222-2222-4222-8222-222222222222', issued.keyId)).rejects.toThrow();
    mocks.row.revokedAt = BigInt(Date.now());
    expect(await loadSenderCredentialSecret(userId, ruleId, issued.keyId)).toBeUndefined();
    mocks.row.revokedAt = null; mocks.row.secretCiphertext = `${mocks.row.secretCiphertext.slice(0, 10)}${mocks.row.secretCiphertext[10] === 'A' ? 'B' : 'A'}${mocks.row.secretCiphertext.slice(11)}`;
    await expect(loadSenderCredentialSecret(userId, ruleId, issued.keyId)).rejects.toThrow();
  });
  it('revokes by account and credential identity only', async () => {
    const result = await revokeSenderCredential(userId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(result).toBe(true);
    expect(mocks.prisma.automationSenderCredential.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', userId, revokedAt: null,
    } }));
  });
});
