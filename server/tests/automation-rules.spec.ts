import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ prisma: { $transaction: vi.fn(), automationRule: { create: vi.fn(), findMany: vi.fn() } } }));
vi.mock('../src/db', () => ({ prisma: mocks.prisma }));

const row = {
  id: '11111111-1111-4111-8111-111111111111', userId: 7, version: 1, enabled: false, keyId: 'hook',
  allowedFields: ['title'], targetProjectId: null, timezone: null, parseVersion: 1, authorizationVersion: 1,
  maxItems: 50, createdAt: new Date(1_800_000_000_000), deletedAt: null,
};

describe('automation rule contract', () => {
  it('persists a closed field policy and bounded output configuration', async () => {
    mocks.prisma.automationRule.create.mockResolvedValue(row);
    const { createAutomationRule } = await import('../src/automation/rules');
    const result = await createAutomationRule(7, 'hook', { allowedFields: ['title', 'dueDate'], timezone: 'Asia/Shanghai', maxItems: 3 });
    expect(result.allowedFields).toEqual(['title']);
    expect(mocks.prisma.automationRule.create).toHaveBeenCalledWith({ data: expect.objectContaining({ allowedFields: ['title', 'dueDate'], timezone: 'Asia/Shanghai', maxItems: 3 }) });
  });

  it('erases rule digests and ciphertext while retaining the rule tombstone', async () => {
    const update = vi.fn().mockResolvedValue({ ...row, enabled: false, version: 2, deletedAt: BigInt(1_800_000_000_001) });
    const deleteEvents = vi.fn().mockResolvedValue({ count: 2 });
    const deleteAttempts = vi.fn();
    const deletePermits = vi.fn();
    const deleteCredentials = vi.fn();
    const tx = { $queryRaw: vi.fn(), automationRule: { findFirst: vi.fn().mockResolvedValue(row), update }, automationEvent: { deleteMany: deleteEvents }, automationCommitPermit: { deleteMany: deletePermits }, automationAiAttempt: { deleteMany: deleteAttempts }, automationSenderCredential: { deleteMany: deleteCredentials } };
    mocks.prisma.$transaction.mockImplementation(async (fn: (value: unknown) => unknown) => fn(tx));
    const { deleteAutomationRule } = await import('../src/automation/rules');
    await deleteAutomationRule(7, row.id);
    for (const remove of [deletePermits, deleteEvents, deleteAttempts, deleteCredentials]) expect(remove).toHaveBeenCalledWith({ where: { userId: 7, ruleId: row.id } });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ enabled: false, deletedAt: expect.any(BigInt) }) }));
  });
});
