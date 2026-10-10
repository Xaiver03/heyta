import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { generateInboundKeyPair, openInbound, signWebhook } from '@heyta/inbound-core';

const mocks = vi.hoisted(() => {
  const state: { event: any | null; queue: { events: bigint; bytes: bigint } } = {
    event: null,
    // 账号未终结队列的用量读（事务内那次 $queryRaw）从这里取值，逐用例推边界。
    queue: { events: 0n, bytes: 0n },
  };
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
  // 阈值从被约束的常量推，不抄数字：改源码里那两枚而不动测试，边界用例会跟着挪；
  // 反过来把判定删掉，用例会红。取值走 beforeEach 里那次已有的模块 import。
  let maxQueueEvents: number;
  let maxQueueBytes: number;

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

  // 队列上限用例要用**不同的事件身份**各打一次（同一个 eventId 会先撞上重放分支）。
  // 签名里也带着 eventId，所以只能整条重签，不能只改头。
  const requestAs = async (body: Buffer, id: string) => {
    const timestamp = String(Math.floor(now / 1000));
    const signature = signWebhook(secret, {
      method: 'POST', path: `/api/automation/v1/hooks/${ruleId}`,
      ruleId, keyId: 'inbound-v1', timestamp, eventId: id, contentType: 'application/json', body,
    });
    return app.inject({ method: 'POST', url: `/api/automation/v1/hooks/${ruleId}`, payload: body,
      headers: { 'content-type': 'application/json', 'x-heyta-key-id': 'inbound-v1',
        'x-heyta-timestamp': timestamp, 'x-heyta-event-id': id, 'x-heyta-signature': signature } });
  };

  beforeEach(async () => {
    now = 1_800_000_000_000;
    mocks.state.event = null;
    mocks.state.queue = { events: 0n, bytes: 0n };
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
        return [{ events: mocks.state.queue.events, bytes: mocks.state.queue.bytes }];
      }),
      automationEvent: { create: mocks.prisma.automationEvent.create },
      automationRule: mocks.prisma.automationRule,
      automationRecipientKey: mocks.prisma.automationRecipientKey,
      automationSenderCredential: mocks.prisma.automationSenderCredential,
      subscription: mocks.prisma.subscription,
    }));
    process.env.AUTOMATION_ENTITLEMENT_MODE = 'official';
    process.env.AUTOMATION_WEBHOOK_KEYS = JSON.stringify({ keys: { 'inbound-v1': Buffer.from(secret).toString('hex') } });
    const inbound = await import('../src/automation/inbound.routes');
    ({ MAX_QUEUE_EVENTS: maxQueueEvents, MAX_QUEUE_BYTES: maxQueueBytes } = inbound);
    app = Fastify({ logger: false });
    await app.register(inbound.inboundAutomationRoutes, { prefix: '/api', serverOrigin: 'https://example.test', now: () => now });
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
    // 🔴「重放查询不重复占队列/业务额度」这一句此前只有"码对"没有"额度"：
    // 额度裁决整个住在 prisma.$transaction 里（账号行锁 + 用量 SQL），
    // 所以"重放那一次没开事务"就是这句的判据 —— 把短路挪到事务之后就必红。
    const transactionsBeforeRetry = mocks.prisma.$transaction.mock.calls.length;
    expect((await request(body)).statusCode).toBe(202);
    expect(mocks.prisma.$transaction.mock.calls.length).toBe(transactionsBeforeRetry);
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

  // 🔴 AC-2 的「并发限额」与「持久化失败不返回 accepted」两句，此前**没有任何尺**：
  // 队列上限那两段判定在源码里（事务内 `>= MAX_QUEUE_EVENTS` / `bytes + len > MAX_QUEUE_BYTES`），
  // 全仓 grep `InboundQueueLimitError|QUEUE_EVENTS_LIMIT|QUEUE_BYTES_LIMIT` 在测试侧命中 **0** 处
  // ⇒ 谁把 1_000 改成 1_000_000、或把那两个 throw 删掉，整套测试一声不响。
  // 边界一律**从被约束的常量推**（上面 import），不抄数字。
  it('accepts up to the queue event cap and refuses one past it without writing', async () => {
    mocks.state.queue = { events: BigInt(maxQueueEvents - 1), bytes: 0n };
    expect((await requestAs(Buffer.from('{"title":"last slot"}'), 'evt-cap-minus-1')).statusCode).toBe(202);

    mocks.state.event = null;
    mocks.prisma.automationEvent.create.mockClear();
    mocks.state.queue = { events: BigInt(maxQueueEvents), bytes: 0n };
    const response = await requestAs(Buffer.from('{"title":"one too many"}'), 'evt-cap');
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ code: 'QUEUE_EVENTS_LIMIT', message: 'Inbound event exceeds the allowed quota.' });
    expect(mocks.prisma.automationEvent.create).not.toHaveBeenCalled();
  });

  it('counts the sealed envelope against the byte cap and the boundary is exclusive, not inclusive', async () => {
    mocks.state.queue = { bytes: 0n, events: 0n };
    const body = Buffer.from('{"title":"measured"}', 'utf8');
    expect((await requestAs(body, 'evt-len-0')).statusCode).toBe(202);
    const envelopeBytes = Buffer.byteLength(String(mocks.state.event.payloadCiphertext), 'utf8');

    // 恰好用满：已有用量 + 这一枚 == 上限 ⇒ **仍然接受**（源码写的是 `> MAX`，不是 `>= MAX`）。
    mocks.state.event = null;
    mocks.state.queue = { bytes: BigInt(maxQueueBytes - envelopeBytes), events: 0n };
    expect((await requestAs(body, 'evt-len-exact')).statusCode).toBe(202);

    // 多一枚字节：上限是**加密后的密文长度**算的，不是明文（协议里"加密膨胀计入队列字节数"那一格）。
    // 明文只有 20 B，所以拿明文去凑边界会永远撞不上这一档 —— 这一条同时钉住"算的是哪一枚数"。
    mocks.state.event = null;
    mocks.prisma.automationEvent.create.mockClear();
    mocks.state.queue = { bytes: BigInt(maxQueueBytes - envelopeBytes + 1), events: 0n };
    const response = await requestAs(body, 'evt-len-over');
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({ code: 'QUEUE_BYTES_LIMIT', message: 'Inbound event exceeds the allowed quota.' });
    expect(mocks.prisma.automationEvent.create).not.toHaveBeenCalled();
    expect(envelopeBytes).toBeGreaterThan(body.length);
  });

  it('does not report accepted when the enqueue write itself fails', async () => {
    mocks.prisma.automationEvent.create.mockRejectedValue(Object.assign(new Error('database unavailable'), { code: 'P2003' }));
    const response = await request(Buffer.from('{"title":"write failed"}'));
    expect(response.statusCode).toBe(500);
    // 对外响应里不许出现"已受理"的任何形状：状态字段、eventId、`queued` 都不行。
    expect(response.body).not.toContain('queued');
    expect(response.json()).toEqual({ code: 'inbound_event_could_not_be_accepted', message: 'Inbound event could not be accepted' });
  });

  // 唯一索引上的插入竞态：前置查找没看见对手刚线性化进去的那行，insert 才撞 P2002。
  // 这一支必须**重读赢家并按同一条重试/冲突规则判**，既不能漏 500，也不能落第二枚信封。
  // 赢家的 dedupeDigest 由生产代码自己算（先让它正常落一行），测试不复制摘要算法。
  it('re-reads the winner on an insert race: same bytes return it, different bytes conflict', async () => {
    const body = Buffer.from('{"title":"winner"}', 'utf8');
    expect((await requestAs(body, 'evt-race')).statusCode).toBe(202);
    const winner = mocks.state.event;
    const createAttempts = mocks.prisma.automationEvent.create.mock.calls.length;

    // 同一 eventId、**不同的字节** ⇒ 409，而不是把赢家的信封当成我的重试。
    mocks.prisma.automationEvent.findFirst.mockResolvedValueOnce(null);
    mocks.prisma.automationEvent.create.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: 'P2002' }));
    const conflict = await requestAs(Buffer.from('{"title":"loser"}', 'utf8'), 'evt-race');
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ code: 'EVENT_CONTENT_CONFLICT', message: 'EVENT_CONTENT_CONFLICT' });

    // 同一 eventId、**同样的字节** ⇒ 原样返回赢家的不透明状态；本地没有第二条事件行。
    mocks.prisma.automationEvent.findFirst.mockResolvedValueOnce(null);
    mocks.prisma.automationEvent.create.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: 'P2002' }));
    const raced = await requestAs(body, 'evt-race');
    expect(raced.statusCode).toBe(202);
    expect(raced.json()).toEqual({ eventId: 'evt-race', state: 'queued' });
    // create 只多了那两次**失败**的尝试；若生产代码在竞态后另建一封，这里就会变。
    expect(mocks.prisma.automationEvent.create.mock.calls.length).toBe(createAttempts + 2);
    expect(mocks.state.event).toBe(winner);
  });
});
