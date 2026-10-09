import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ prisma: { $transaction: vi.fn() } }));
vi.mock('../src/db', () => ({ prisma: mocks.prisma }));

const identity = { credentialHash: 'a'.repeat(64), databaseEpoch: 'epoch', tokenVersion: 0 };
const envelope = JSON.stringify({ version: 1, keyEpoch: 2, ephemeralPublicKey: Buffer.alloc(32, 1).toString('base64'), nonce: Buffer.alloc(12, 2).toString('base64'), ciphertext: Buffer.alloc(24, 3).toString('base64') });


describe('automation queue lease fencing', () => {
  it('increments generation and refuses a disabled rule', async () => {
    const update = vi.fn().mockResolvedValue({ eventId: 'event', ruleId: 'rule', ruleVersion: 1, payloadCiphertext: envelope,
      createdAt: new Date(1_800_000_000_000), leaseGeneration: 3, leaseExpiresAt: new Date(1_800_000_060_000), attempt: 2 });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      automationWorker: { findFirst: vi.fn().mockResolvedValue({ id: 'worker' }) },
      automationEvent: { update, },
      automationRule: { findUnique: vi.fn().mockResolvedValue({ enabled: true, deletedAt: null, version: 1 }) },
    };
    tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ event_id: 'event', rule_id: 'rule', rule_version: 1,
      status: 'queued', lease_expires_at: null }]);
    mocks.prisma.$transaction.mockImplementation(async (fn: (value: unknown) => unknown) => fn(tx));
    const { claimAutomationEvent } = await import('../src/automation/events');
    const result = await claimAutomationEvent(7, 'client', identity, new Date(1_800_000_000_000));
    expect(result?.leaseGeneration).toBe(3);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'leased', leaseWorkerId: 'worker' }) }));
  });

  it.each(['reserved', 'sent', 'consumed', 'unknown'])('does not automatically rerun a %s model attempt after lease expiry', async (state) => {
    const update = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ event_id: 'event', rule_id: 'rule', rule_version: 1,
        payload_ciphertext: envelope, status: 'leased', lease_expires_at: new Date(1), expires_at: new Date(1_900_000_000_000) }]),
      automationWorker: { findFirst: vi.fn().mockResolvedValue({ id: 'worker' }) },
      automationAiAttempt: { findFirst: vi.fn().mockResolvedValue({ state }) },
      automationEvent: { update },
    };
    mocks.prisma.$transaction.mockImplementation(async (fn: (value: unknown) => unknown) => fn(tx));
    const { claimAutomationEvent } = await import('../src/automation/events');
    expect(await claimAutomationEvent(7, 'client', identity, new Date(1_800_000_000_000))).toBeUndefined();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'needs-confirmation', reasonCode: 'model-result-uncertain' }) }));
  });

  it('fences result publication to the lease owner and generation', async () => {
    const update = vi.fn().mockResolvedValue({ eventId: 'event', status: 'prepared', parseVersion: 1 });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      automationWorker: { findFirst: vi.fn().mockResolvedValue({ id: 'worker' }) },
      automationEvent: { findFirst: vi.fn().mockResolvedValue({ eventId: 'event', status: 'leased', leaseWorkerId: 'worker', leaseGeneration: 1,
        leaseExpiresAt: new Date(1_900_000_000_000), ruleId: 'rule' }), update },
      automationRule: { findFirst: vi.fn().mockResolvedValue({ maxItems: 50, parseVersion: 1 }) },
      automationRecipientKey: { findUnique: vi.fn().mockResolvedValue({ keyEpoch: 2 }) },
    };
    mocks.prisma.$transaction.mockImplementation(async (fn: (value: unknown) => unknown) => fn(tx));
    const { publishAutomationResult } = await import('../src/automation/events');
    await expect(publishAutomationResult({ userId: 7, clientId: 'client', identity, eventId: 'event', leaseGeneration: 1,
      parseVersion: 1, itemCount: 1, resultDigest: 'b'.repeat(64), resultCiphertext: envelope })).resolves.toEqual({ eventId: 'event', state: 'prepared', parseVersion: 1 });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'prepared', leaseExpiresAt: null }) }));
  });

  it('rejects malformed result envelopes before opening a transaction', async () => {
    mocks.prisma.$transaction.mockClear();
    const { publishAutomationResult } = await import('../src/automation/events');
    await expect(publishAutomationResult({ userId: 7, clientId: 'client', identity, eventId: 'event', leaseGeneration: 1,
      parseVersion: 1, itemCount: 1, resultDigest: 'b'.repeat(64), resultCiphertext: '{}' })).rejects.toThrow('Invalid automation result');
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('does not reinterpret a frozen confirmation draft as prepared on an idempotent publish', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      automationWorker: { findFirst: vi.fn().mockResolvedValue({ id: 'worker' }) },
      automationEvent: { findFirst: vi.fn().mockResolvedValue({ eventId: 'event', status: 'needs-confirmation',
        leaseWorkerId: 'worker', leaseGeneration: 1, ruleId: 'rule', parseVersion: 1,
        resultDigest: 'b'.repeat(64), resultCiphertext: envelope, resultItemCount: 1 }), update: vi.fn() },
    };
    mocks.prisma.$transaction.mockImplementation(async (fn: (value: unknown) => unknown) => fn(tx));
    const { publishAutomationResult } = await import('../src/automation/events');
    const input = { userId: 7, clientId: 'client', identity, eventId: 'event', leaseGeneration: 1,
      parseVersion: 1, itemCount: 1, resultDigest: 'b'.repeat(64), resultCiphertext: envelope };
    await expect(publishAutomationResult({ ...input, needsConfirmation: true })).resolves.toEqual({ eventId: 'event', state: 'needs-confirmation', parseVersion: 1 });
    await expect(publishAutomationResult(input)).rejects.toThrow('conflicts with frozen result');
    expect(tx.automationEvent.update).not.toHaveBeenCalled();
  });
});
