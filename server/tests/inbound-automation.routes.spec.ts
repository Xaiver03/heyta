import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { generateInboundKeyPair, openInbound, signWebhook } from '@heyta/inbound-core';

const mocks = vi.hoisted(() => {
  const state: { event: any | null } = { event: null };
  return {
    state,
    prisma: {
      $transaction: vi.fn(),
      subscription: { findMany: vi.fn() },
      automationRule: { findUnique: vi.fn() },
      automationSenderCredential: { findFirst: vi.fn() },
      automationRecipientKey: { findUnique: vi.fn() },
      automationEvent: { findFirst: vi.fn(), create: vi.fn() },
    },
  };
});

vi.mock('../src/db', () => ({ prisma: mocks.prisma }));
vi.mock('../src/logger', () => ({ Logger: { warn: vi.fn(), audit: vi.fn() } }));

describe('public inbound automation receiver', () => {
  const secret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const ruleId = '11111111-1111-4111-8111-111111111111';
  const eventId = 'source-event-1';
  const pair = generateInboundKeyPair();
  let app: ReturnType<typeof Fastify>;
  let now: number;

  const request = async (body: Buffer, overrides: Record<string, string> = {}) => {
    const timestamp = overrides['x-heyta-timestamp'] ?? String(Math.floor(now / 1000));
    const contentType = overrides['content-type'] ?? 'application/json';
    const signature = signWebhook(secret, {
      method: 'POST', path: `/api/automation/v1/hooks/${ruleId}`,
      ruleId, keyId: 'inbound-v1', timestamp, eventId,
      contentType: contentType === 'text/plain' ? 'text/plain' : 'application/json', body,
    });
    return app.inject({ method: 'POST', url: `/api/automation/v1/hooks/${ruleId}`, payload: body,
      headers: {
        'content-type': contentType, 'x-heyta-key-id': 'inbound-v1',
        'x-heyta-timestamp': timestamp, 'x-heyta-event-id': eventId,
        'x-heyta-signature': signature, ...overrides,
      } });
  };

  beforeEach(async () => {
    now = 1_800_000_000_000;
    mocks.state.event = null;
    mocks.prisma.subscription.findMany.mockResolvedValue([{ status: 'active', grants: ['automation'], currentPeriodEnd: BigInt(now + 60_000) }]);
    mocks.prisma.automationRule.findUnique.mockResolvedValue({ id: ruleId, userId: 7, version: 3, enabled: true, deletedAt: null, keyId: 'inbound-v1' });
    mocks.prisma.automationSenderCredential.findFirst.mockResolvedValue(null);
    mocks.prisma.automationEvent.findFirst.mockImplementation(async () => mocks.state.event);
    mocks.prisma.automationRecipientKey.findUnique.mockResolvedValue({ userId: 7, keyEpoch: 2, publicKey: pair.publicKey, packageVersion: 4 });
    mocks.prisma.automationEvent.create.mockImplementation(async ({ data }: any) => {
      mocks.state.event = { ...data, eventId: data.eventId };
      return mocks.state.event;
    });
    mocks.prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({
      // 账号锁之后的两类原始查询：权益行锁读与队列用量读，按语句分流。
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
        const sql = strings.join('?');
        // 锁内那次 `... FROM subscriptions ... FOR SHARE` 读的还是同一份订阅来源，
        // 所以让它走同一个 mock：这样"第二次判定看到到期"才测得到锁后重读。
        if (sql.includes('FROM subscriptions')) return mocks.prisma.subscription.findMany();
        return [{ events: 0n, bytes: 0n }];
      }),
      automationEvent: { create: mocks.prisma.automationEvent.create },
      automationRule: mocks.prisma.automationRule,
      automationRecipientKey: mocks.prisma.automationRecipientKey,
      automationSenderCredential: mocks.prisma.automationSenderCredential,
      subscription: mocks.prisma.subscription,
    }));
    process.env.AUTOMATION_ENTITLEMENT_MODE = 'official';
    process.env.AUTOMATION_WEBHOOK_KEYS = JSON.stringify({ keys: { 'inbound-v1': Buffer.from(secret).toString('hex') } });
    const { inboundAutomationRoutes } = await import('../src/automation/inbound.routes');
    app = Fastify({ logger: false });
    await app.register(inboundAutomationRoutes, { prefix: '/api', serverOrigin: 'https://example.test', now: () => now });
  });

  afterEach(async () => {
    await app.close();
    delete process.env.AUTOMATION_WEBHOOK_KEYS;
    delete process.env.AUTOMATION_ENTITLEMENT_MODE;
    vi.clearAllMocks();
  });

  it('verifies raw bytes, seals them, and stores no plaintext', async () => {
    const body = Buffer.from('{  "title" : "hello" }', 'utf8');
    const response = await request(body);
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ eventId, state: 'queued' });
    expect(mocks.state.event.payloadCiphertext).not.toContain('hello');
    const opened = await openInbound(JSON.parse(mocks.state.event.payloadCiphertext), pair.privateKey, {
      accountId: 'user-7', serverOrigin: 'https://example.test', ruleId, eventId, purpose: 'input', keyEpoch: 2,
    });
    expect(Buffer.from(opened).equals(body)).toBe(true);
  });

  it('requires paid automation even with the default self-hosted gate disabled', async () => {
    mocks.prisma.subscription.findMany.mockResolvedValue([]);
    expect((await request(Buffer.from('{"title":"unpaid"}'))).statusCode).toBe(402);
    expect(mocks.prisma.automationEvent.create).not.toHaveBeenCalled();
  });

  it('does not fall back to the legacy keyring after a managed credential is revoked', async () => {
    mocks.prisma.automationSenderCredential.findFirst.mockResolvedValue({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', keyId: 'inbound-v1', createdAt: new Date(1),
      revokedAt: BigInt(now), rotatedAt: BigInt(now),
    });
    expect((await request(Buffer.from('{"title":"revoked"}'))).statusCode).toBe(401);
    expect(mocks.prisma.automationEvent.create).not.toHaveBeenCalled();
  });

  it('rechecks expiry at enqueue after the first authorization read', async () => {
    mocks.prisma.subscription.findMany.mockResolvedValueOnce([{ status: 'active', grants: ['automation'], currentPeriodEnd: now + 60_000 }]).mockResolvedValue([]);
    expect((await request(Buffer.from('{"title":"expired"}'))).statusCode).toBe(402);
    expect(mocks.prisma.automationEvent.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate JSON keys before the database write', async () => {
    const body = Buffer.from('{"a":1,"a":2}', 'utf8');
    const response = await request(body);
    expect(response.statusCode).toBe(400);
    expect(mocks.prisma.automationEvent.create).not.toHaveBeenCalled();
  });

  it('returns the existing opaque state for an exact retry and conflicts on new bytes', async () => {
    const body = Buffer.from('{"title":"same"}', 'utf8');
    expect((await request(body)).statusCode).toBe(202);
    expect((await request(body)).statusCode).toBe(202);
    expect(mocks.prisma.automationEvent.create).toHaveBeenCalledTimes(1);
    const different = Buffer.from('{"title":"changed"}', 'utf8');
    expect((await request(different)).statusCode).toBe(409);
  });

  it('rejects a stale signature without touching the ledger', async () => {
    const body = Buffer.from('{"title":"hello"}', 'utf8');
    const response = await request(body, { 'x-heyta-timestamp': String(Math.floor((now - 301_000) / 1000)) });
    expect(response.statusCode).toBe(401);
    expect(mocks.prisma.automationEvent.create).not.toHaveBeenCalled();
  });

  it('offers a signed opaque status lookup without returning the envelope', async () => {
    const body = Buffer.from('{"title":"hello"}', 'utf8');
    expect((await request(body)).statusCode).toBe(202);
    const timestamp = String(Math.floor(now / 1000));
    const path = `/api/automation/v1/hooks/${ruleId}/events/${eventId}`;
    const signature = signWebhook(secret, { method: 'GET', path, ruleId, keyId: 'inbound-v1', timestamp, eventId,
      contentType: 'application/json', body: Buffer.alloc(0) });
    const response = await app.inject({ method: 'GET', url: path, headers: {
      'content-type': 'application/json', 'x-heyta-key-id': 'inbound-v1', 'x-heyta-timestamp': timestamp,
      'x-heyta-event-id': eventId, 'x-heyta-signature': signature,
    } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ eventId, state: 'queued' });
    expect(response.body).not.toContain('hello');
  });
});
