import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';

/**
 * T2「把票据消费从闸门事务挪进业务写事务」的落点判卷。
 *
 * 真库那一半（回滚不烧 nonce、重放只生效一次）在
 * `tests/integration/inbound-worker-identity.integration.spec.ts` 的 selfhost 段，
 * 因为只有真 PostgreSQL 能回答"回滚"。这里钉的是**形状**：
 *  1. 闸门那一步不碰数据库；
 *  2. 写事务那一步在没有票据时不判权益（官方模式的边界，见 `authorizeAutomationWrite`）；
 *  3. 五个逐次放行的动作里，授权都排在**发活那一笔**业务写之前 —— 这一条是"挪进来"
 *     这个动作本身的形状，将来谁把它移回写入之后就会红。领取那一路另有反向判据：
 *     保留期抹密文 / 转待确认 / 转取消这类**只减不增**的终态写故意留在授权之前。
 */
const mocks = vi.hoisted(() => ({ prisma: { $transaction: vi.fn(), $queryRaw: vi.fn(), subscription: { findMany: vi.fn() } } }));
vi.mock('../src/db', () => ({ prisma: mocks.prisma }));
vi.mock('../src/logger', () => ({ Logger: { audit: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn() } }));

const issuer = 'https://official.test/entitlements';
const installation = '11111111-1111-4111-8111-111111111111';

describe('自动收集票据的消费落点', () => {
  const saved = { mode: process.env.AUTOMATION_ENTITLEMENT_MODE, keys: process.env.AUTOMATION_OFFICIAL_KEYS };
  let app: ReturnType<typeof Fastify> | undefined;

  /** 挂一道真闸门的探测路由：闸门代码本身是唯一被测对象。 */
  const guarded = async (options: Record<string, unknown>) => {
    const { createEntitlementGuard } = await import('../src/entitlement');
    const server = Fastify({ logger: false });
    server.addHook('preHandler', async (req) => { (req as { user?: unknown }).user = { userId: 7, email: 'gate@test.local', tokenVersion: 0 }; });
    server.post('/probe/:ruleId', { preHandler: [createEntitlementGuard({ capability: 'automation', gate: { enabled: true }, ...options } as never)] },
      async () => ({ written: true }));
    await server.ready();
    app = server;
    return server;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTOMATION_ENTITLEMENT_MODE = 'selfhost-online';
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
    if (saved.mode === undefined) delete process.env.AUTOMATION_ENTITLEMENT_MODE; else process.env.AUTOMATION_ENTITLEMENT_MODE = saved.mode;
    if (saved.keys === undefined) delete process.env.AUTOMATION_OFFICIAL_KEYS; else process.env.AUTOMATION_OFFICIAL_KEYS = saved.keys;
  });

  it('🔴 配了自托管模式却没配公钥环：闸门回 402 并停止重试，不是 500', async () => {
    delete process.env.AUTOMATION_OFFICIAL_KEYS;
    const server = await guarded({ action: 'rule-enable', precheckOnly: true, scope: () => ({ ruleId: 'r' }) });
    const response = await server.inject({ method: 'POST', url: '/probe/r',
      headers: { 'x-heyta-entitlement-ticket': 'not-a-real-ticket' }, payload: {} });
    // 500 会被客户端读成"服务端坏了，重试"；402 才是"停止重试，这台实例没连上签发方"。
    expect(response.statusCode).toBe(402);
    expect((response.json() as { reason?: string }).reason).toBe('ISSUER_NOT_CONFIGURED');
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('闸门那一步即使带着合法票据也不开事务', async () => {
    const { generateKeyPairSync, randomUUID } = await import('node:crypto');
    const pair = generateKeyPairSync('ed25519');
    const { signAutomationEntitlementTicket } = await import('../src/automation/entitlement-ticket');
    process.env.AUTOMATION_OFFICIAL_KEYS = JSON.stringify({ issuer, instanceId: installation,
      keys: { k1: pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url') } });
    const now = Math.floor(Date.now() / 1000);
    const ruleId = randomUUID();
    const ticket = signAutomationEntitlementTicket({
      issuer, keyId: 'k1', action: 'rule-enable', capability: 'automation',
      officialSubject: 'acct-1', installationId: installation, localAccountUuid: randomUUID(),
      ruleId, nonce: randomUUID(), issuedAt: now, expiresAt: now + 20, revocationVersion: 0,
    }, pair.privateKey);
    const server = await guarded({ action: 'rule-enable', precheckOnly: true, scope: () => ({ ruleId }) });
    const response = await server.inject({ method: 'POST', url: '/probe/r', headers: { 'x-heyta-entitlement-ticket': ticket }, payload: {} });
    expect(response.statusCode).toBe(200);
    // 🔴 放行 ≠ 消费：预检全程不写库，nonce 留给业务写事务去烧。
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('写事务那一步没出示票据时不判权益（官方模式的边界）', async () => {
    delete process.env.AUTOMATION_OFFICIAL_KEYS;
    const { authorizeAutomationWrite } = await import('../src/entitlement');
    // 官方模式没有一次性凭据可烧；这一格若改成"再判一次订阅"，每一次内部写入都要读订阅行，
    // 而订阅行的判定本来就由闸门做过 —— 那是重复判定，不是加防护。
    await expect(authorizeAutomationWrite({ client: mocks.prisma as never, userId: 7, action: 'event-claim' }))
      .resolves.toBeUndefined();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('写事务那一步票据验不过时抛出的是可收口成 402 的那一种', async () => {
    process.env.AUTOMATION_OFFICIAL_KEYS = JSON.stringify({ issuer, instanceId: installation, keys: { k1: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } });
    const { AutomationWriteAuthorizationError, authorizeAutomationWrite } = await import('../src/entitlement');
    const error = await authorizeAutomationWrite({ client: mocks.prisma as never, userId: 7, action: 'rule-enable', ruleId: 'r', ticket: 'junk.junk' })
      .then(() => undefined, (thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(AutomationWriteAuthorizationError);
    expect((error as InstanceType<typeof AutomationWriteAuthorizationError>).decision.allowed).toBe(false);
  });

  describe('五个逐次放行动作的落点：授权在第一笔业务写之前', () => {
    const source = (file: string) => readFileSync(resolve(__dirname, '../src/automation', file), 'utf8');
    const bodyOf = (text: string, name: string) => {
      const start = text.indexOf(`export async function ${name}(`);
      if (start < 0) throw new Error(`找不到函数 ${name}`);
      const next = text.indexOf('\nexport ', start + 1);
      return text.slice(start, next < 0 ? text.length : next);
    };
    // 🔴 判据钉的是**第一笔不可逆写**，不是 create：注册与签发都会先把同键的旧行
    // 吊销掉（updateMany），那一步已经改了既有数据、事后回滚不回来。把授权提到
    // create 之前而留在吊销之后，是这条判据要拦住却拦不住的改法 —— 所以标记必须
    // 落在吊销那一笔上。
    const sites = [
      { file: 'worker-identity.ts', fn: 'registerAutomationWorker', write: 'automationWorker.updateMany' },
      { file: 'rules.ts', fn: 'setAutomationRuleEnabled', write: 'automationRule.update' },
      { file: 'sender-credentials.ts', fn: 'issueSenderCredential', write: 'automationSenderCredential.updateMany' },
      { file: 'events.ts', fn: 'claimAutomationEvent', write: "status: 'leased'" },
      { file: 'events.ts', fn: 'publishAutomationResult', write: 'automationEvent.update' },
    ] as const;

    it.each(sites)('$file 的 $fn：$write 之前先 authorizeAutomationWrite', ({ file, fn, write }) => {
      const body = bodyOf(source(file), fn);
      const authorized = body.indexOf('authorizeAutomationWrite(');
      const written = body.indexOf(write);
      expect(authorized).toBeGreaterThanOrEqual(0);
      expect(written).toBeGreaterThanOrEqual(0);
      // 顺序反了就是"票据烧掉而业务没提交"的那个形状 —— AC-1 的反向。
      expect(authorized).toBeLessThan(written);
    });

    it('领取那一路：只减不增的终态写故意排在授权之前（保留义务不看权益）', () => {
      // 🔴 这一条挡的是"顺手把授权提到事务开头"那种改法：那样一来，一次命中保留期
      // 到点的空轮询也会把 nonce 烧掉，而抹密文/转取消本身是合规要求的动作，
      // 不该由权益决定做不做。判据命中在授权之前，就是把这个理由钉住。
      const body = bodyOf(source('events.ts'), 'claimAutomationEvent');
      const authorized = body.indexOf('authorizeAutomationWrite(');
      for (const ungated of ["status: 'expired'", "status: 'needs-confirmation'", "status: 'cancelled'"]) {
        expect(body.indexOf(ungated)).toBeGreaterThanOrEqual(0);
        expect(body.indexOf(ungated)).toBeLessThan(authorized);
      }
    });
  });
});
