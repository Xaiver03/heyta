import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ prisma: { $transaction: vi.fn(), automationEvent: { findMany: vi.fn() } } }));
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

// 🔴 ADR-0077 那句「抽取成功后原文已不在我们手上 ⇒ 这一条不能再重抽第二遍」在代码里就是重试守卫中的
// `event.payloadCiphertext === null` 那一支。这里钉的正是它：源正文没了就必须拒，而且是**不重新入队**地拒。
// 头一是绿头（正向那档），所以后三枚红不是因为夹具坏 —— 摘掉守卫里任何一支，对应那一条就红。
describe('explicit retry guard requires the source payload to still be there', () => {
  const now = new Date(1_800_000_000_000);
  const retryTx = (event: Record<string, unknown>, permit: unknown = null, rule: unknown = { id: 'rule' }) => {
    const update = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      automationEvent: { findFirst: vi.fn().mockResolvedValue(event), update },
      automationRule: { findFirst: vi.fn().mockResolvedValue(rule) },
      automationCommitPermit: { findUnique: vi.fn().mockResolvedValue(permit) },
    };
    mocks.prisma.$transaction.mockImplementation(async (fn: (value: unknown) => unknown) => fn(tx));
    return update;
  };
  const callRetry = async () => {
    const { retryUncertainAutomationEvent } = await import('../src/automation/events');
    return retryUncertainAutomationEvent({ userId: 7, eventId: 'event', expectedAttempt: 1, expectedRuleVersion: 1 }, now);
  };
  const uncertain = { status: 'needs-confirmation', reasonCode: 'model-result-uncertain', attempt: 1, ruleVersion: 1,
    ruleId: 'rule', eventId: 'event', expiresAt: new Date(1_900_000_000_000) };

  it('绿头：结果不确定且源正文还在 ⇒ 重新入队并清掉租约', async () => {
    const update = retryTx({ ...uncertain, payloadCiphertext: envelope });
    await expect(callRetry()).resolves.toEqual({ eventId: 'event', state: 'queued' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: 'queued', reasonCode: null, leaseWorkerId: null, leaseExpiresAt: null }) }));
  });

  it('源正文已丢弃（抽取成功后那一档）⇒ 拒，而且一次重新入队都不许发生', async () => {
    const update = retryTx({ ...uncertain, payloadCiphertext: null });
    await expect(callRetry()).rejects.toThrow('Automation event cannot be retried');
    expect(update).not.toHaveBeenCalled();
  });

  it('留存窗口已过 ⇒ 同样拒（窗口外没有正文可抽，重试语义不成立）', async () => {
    const update = retryTx({ ...uncertain, payloadCiphertext: envelope, expiresAt: new Date(1_700_000_000_000) });
    await expect(callRetry()).rejects.toThrow('Automation event cannot be retried');
    expect(update).not.toHaveBeenCalled();
  });

  it('列表接口的 select 只取元数据：多取一列（尤其正文/结果那两列）就红', async () => {
    mocks.prisma.automationEvent.findMany.mockResolvedValue([{ eventId: 'e1', ruleId: 'r1', ruleVersion: 1,
      status: 'queued', reasonCode: null, attempt: 1, createdAt: new Date(1_800_000_000_000) }]);
    const { listAutomationEvents } = await import('../src/automation/events');
    expect(await listAutomationEvents(7)).toEqual([{ eventId: 'e1', ruleId: 'r1', ruleVersion: 1,
      status: 'queued', reasonCode: null, attempt: 1, receivedAt: 1_800_000_000_000 }]);
    // 🔴 这一句是这枚用例的承重点：查询路径上"不出现明文"靠的就是这个 select 的**精确形状**。
    // 加进任何一列（`payloadCiphertext`/`resultCiphertext`/租约……）都在这里红 —— 不靠"记得别加"。
    const args = mocks.prisma.automationEvent.findMany.mock.calls.at(-1)![0] as { select: Record<string, unknown> };
    expect(Object.keys(args.select).sort()).toEqual(
      ['attempt', 'createdAt', 'eventId', 'reasonCode', 'ruleId', 'ruleVersion', 'status']);
  });

  it('已有提交许可 ⇒ 拒（重抽会造出第二个任务）', async () => {
    const update = retryTx({ ...uncertain, payloadCiphertext: envelope }, { id: 'permit' });
    await expect(callRetry()).rejects.toThrow('Automation event cannot be retried');
    expect(update).not.toHaveBeenCalled();
  });
});
