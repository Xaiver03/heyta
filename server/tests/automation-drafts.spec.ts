import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ prisma: { $transaction: vi.fn() } }));
vi.mock('../src/db', () => ({ prisma: mocks.prisma }));
import { decideAutomationDraft, readAutomationDraft } from '../src/automation/events';

const now = new Date('2026-10-08T00:00:00Z');
const ruleId = '11111111-1111-4111-8111-111111111111';
const cipher = JSON.stringify({ version: 1, keyEpoch: 2, ephemeralPublicKey: Buffer.alloc(32, 1).toString('base64'),
  nonce: Buffer.alloc(12, 2).toString('base64'), ciphertext: Buffer.alloc(24, 3).toString('base64') });
const snapshot = { eventId: 'event', ruleId, ruleVersion: 1, parseVersion: 1, attempt: 2,
  resultDigest: 'a'.repeat(64), resultItemCount: 1, resultCiphertext: cipher };
const session = { userId: 7, tokenVersion: 3, eventId: 'event' };
const revision = { expectedAttempt: 2, expectedRuleVersion: 1, expectedDigest: snapshot.resultDigest };
const confirm = { ...session, ...revision, decision: 'confirm' as const, resultDigest: 'b'.repeat(64), resultItemCount: 1, resultCiphertext: cipher };
const fixture = () => ({
  $queryRaw: vi.fn().mockResolvedValueOnce([{ tokenVersion: 3, isVerified: 1 }])
    .mockResolvedValue([{ status: 'active', currentPeriodEnd: now.getTime() + 60_000, grants: ['automation'] }]),
  automationEvent: { findFirst: vi.fn().mockResolvedValue({ ...snapshot, expiresAt: new Date(now.getTime() + 60_000) }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  automationCommitPermit: { findUnique: vi.fn().mockResolvedValue(null) },
  automationRule: { findFirst: vi.fn().mockResolvedValue({ maxItems: 2 }) },
  automationRecipientKey: { findUnique: vi.fn().mockResolvedValue({ keyEpoch: 2 }) },
});
let tx: ReturnType<typeof fixture>;
beforeEach(() => {
  // 这条路径建模的是**官方托管**部署：权益来源是订阅行的 automation grant。
  // 自托管在线核验（一次性 action 票据）由 automation-entitlement-ticket.spec.ts 单独判。
  process.env.AUTOMATION_ENTITLEMENT_MODE = 'official';
  vi.clearAllMocks();
  tx = fixture();
  mocks.prisma.$transaction.mockImplementation(async (fn: (db: unknown) => unknown) => fn(tx));
});
describe('encrypted automation draft decisions', () => {
  it.each(['confirm', 'cancel'])('does not resurrect a draft swept between reading and the %s CAS', async (action) => {
    tx.automationEvent.updateMany.mockResolvedValue({ count: 0 });
    await expect(decideAutomationDraft(action === 'confirm' ? confirm : { ...session, ...revision, decision: 'cancel' }, now))
      .rejects.toThrow('revision conflict');
    expect(tx.automationEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      status: 'needs-confirmation', reasonCode: 'needs-confirmation', resultDigest: revision.expectedDigest, expiresAt: { gt: now },
    }) }));
  });
  it('returns only the validated ciphertext snapshot for the authenticated account', async () => {
    tx.automationEvent.findFirst.mockResolvedValue({ ...snapshot, expiresAt: new Date(now.getTime() + 60_000) });
    expect(await readAutomationDraft(session, now)).toEqual(snapshot);
    expect(tx.automationEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      userId: 7, eventId: 'event', status: 'needs-confirmation', expiresAt: { gt: now },
    }) }));
  });
  it('confirms an exact draft revision without issuing a permit or writing tasks', async () => {
    expect(await decideAutomationDraft(confirm, now)).toEqual({ eventId: 'event', state: 'prepared' });
    expect(tx.automationEvent.findFirst).toHaveBeenCalledWith({ where: {
      userId: 7, eventId: 'event', status: 'needs-confirmation', reasonCode: 'needs-confirmation',
      attempt: 2, ruleVersion: 1, resultDigest: snapshot.resultDigest, expiresAt: { gt: now },
    } });
    expect(tx.automationEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: {
      status: 'prepared', reasonCode: null, resultDigest: confirm.resultDigest, resultItemCount: 1,
      resultCiphertext: cipher, leaseWorkerId: null, leaseExpiresAt: null,
    } }));
  });
  it('allows cancellation without querying subscription and clears both bodies', async () => {
    expect(await decideAutomationDraft({ ...session, ...revision, decision: 'cancel' }, now)).toEqual({ eventId: 'event', state: 'cancelled' });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.automationEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: {
      status: 'cancelled', reasonCode: 'user-cancelled', payloadCiphertext: null, resultCiphertext: null,
      leaseWorkerId: null, leaseExpiresAt: null,
    } }));
  });
  it.each(['confirm', 'cancel', 'read'])('rejects a revoked JWT after the account lock for %s', async (action) => {
    tx.$queryRaw.mockReset().mockResolvedValue([{ tokenVersion: 4, isVerified: 1 }]);
    const request = action === 'read' ? readAutomationDraft(session, now) : decideAutomationDraft(
      action === 'confirm' ? confirm : { ...session, ...revision, decision: 'cancel' }, now);
    await expect(request).rejects.toThrow('session expired');
    expect(tx.automationEvent.findFirst).not.toHaveBeenCalled();
    expect(tx.automationEvent.updateMany).not.toHaveBeenCalled();
  });
  it('rejects entitlement expiry at the locked transaction boundary', async () => {
    tx.$queryRaw.mockReset().mockResolvedValueOnce([{ tokenVersion: 3, isVerified: 1 }])
      .mockResolvedValueOnce([{ status: 'active', currentPeriodEnd: now.getTime(), grants: ['automation'] }]);
    await expect(decideAutomationDraft(confirm, now)).rejects.toThrow('entitlement');
    expect(tx.automationEvent.updateMany).not.toHaveBeenCalled();
  });
  it.each(['revision', 'permit', 'rule', 'epoch', 'count', 'retention'])('rejects %s conflict without a write', async (reason) => {
    if (reason === 'revision') tx.automationEvent.findFirst.mockResolvedValue(null);
    if (reason === 'permit') tx.automationCommitPermit.findUnique.mockResolvedValue({ id: 'permit' });
    if (reason === 'rule') tx.automationRule.findFirst.mockResolvedValue(null);
    if (reason === 'epoch') tx.automationRecipientKey.findUnique.mockResolvedValue({ keyEpoch: 3 });
    if (reason === 'count') tx.automationRule.findFirst.mockResolvedValue({ maxItems: 0 });
    if (reason === 'retention') tx.automationEvent.findFirst.mockResolvedValue({ ...snapshot, expiresAt: now });
    await expect(decideAutomationDraft(confirm, now)).rejects.toThrow('revision conflict');
    expect(tx.automationEvent.updateMany).not.toHaveBeenCalled();
  });
  it.each([
    { ...confirm, decision: 'unknown' }, { ...confirm, resultCiphertext: '{}' },
    { ...session, ...revision, decision: 'cancel', resultCiphertext: cipher },
    { ...confirm, title: 'plaintext must not cross this boundary' },
  ])('rejects invalid wire decisions before any transaction', async (input) => {
    await expect(decideAutomationDraft(input as typeof confirm, now)).rejects.toThrow('Invalid automation draft decision');
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});
