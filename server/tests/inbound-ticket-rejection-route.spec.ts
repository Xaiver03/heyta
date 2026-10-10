import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';

/**
 * AC-1 六枚拒绝情形里**票据那一半**的 HTTP 形状判卷。
 *
 * 现量（本文件入库前，逐条可复跑）：
 *   git grep -l 'ENTITLEMENT_TICKET_REJECTED' HEAD -- server/tests  ⇒ 0 个文件
 *   git grep -l 'ticketCode'                  HEAD -- server/tests  ⇒ 1 个文件，
 *     且它是 `tests/integration/inbound-worker-identity.integration.spec.ts`，
 *     整份被 `DATABASE_URL` 门控 ⇒ 默认那条 `pnpm -r test` 里**一跑都不跑**。
 * ⇒ 也就是说"闸门算出的那一枚拒绝码，最后到底有没有回到宿主手里"这件事，
 *    当时只有单测层在验码本身（`automation-entitlement-ticket.spec.ts`），
 *    线上形状没有任何一层守着。这一档补的就是那一格。
 *
 * 判的四件事各自对应一种真实伤害：
 * ① **必须是 402**：402 是宿主唯一会"停止重试并显示等待权益"的信号。回成 409 会让
 *    worker 对着一枚永远不可能变合法的票据退避重试到 30 秒窗口结束；
 * ② **必须带 `ticketCode`**：只有 `reason` 的话，界面分不清"票过期了（重新取一枚就好）"
 *    和"主体冲突（要先重新绑定）"，前者该自愈、后者必须找人；
 * ③ **拒绝不许烧掉 nonce**（除重放那一枚）：拒了还写消费记录，等于把下一枚合法票据
 *    的配额提前花掉 —— 这是 AC-1 那句"不产生业务效果"在票据侧的反向；
 * ④ **响应与审计都不许回显票据正文/主体/账号 UUID**：`@throws` 之外这一层是密文边界上
 *    唯一会把官方侧标识写进日志的地方（协议 §4 那句"日志只记码"的落点）。
 *
 * ⚠️ 这一档**不**证明的事：nonce 的数据库唯一约束、时钟高水位的持久化、绑定行的写入
 * （那些要真库，在 `inbound-worker-identity.integration` 与 `verify-inbound-worker-identity.py`）；
 * 这里唯一的被测对象是**判定结果怎么变成线协议**。`authenticate` 被换成直接写好身份，
 * `prisma` 是一台按 SQL 文本回行的假机器。
 */

const mocks = vi.hoisted(() => ({
  prisma: { $transaction: vi.fn(), $queryRaw: vi.fn(), subscription: { findMany: vi.fn() } },
  /** 事务内那台：模板标签的原始查询（订阅 FOR SHARE、吊销下限、数据库时钟）。 */
  txRaw: vi.fn(),
  /** 消费记录表的 create：调用次数就是"有没有烧掉 nonce"的读数。 */
  useCreate: vi.fn(),
  clock: { findUnique: vi.fn(), upsert: vi.fn() },
  binding: { findUnique: vi.fn() },
  audit: vi.fn(),
  /** 数据库时钟与回拨档都由这一枚喂：`databaseNowMs` 只认 `nowMs` 这个列名。 */
  db: { nowMs: () => BigInt(Date.now()), revocationFloor: null as unknown },
}));

vi.mock('../src/db', () => ({ prisma: mocks.prisma }));
vi.mock('../src/logger', () => ({
  Logger: { audit: mocks.audit, warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn() },
}));
vi.mock('../src/middleware', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/middleware')>()),
  authenticate: async (req: { user?: unknown }) => { req.user = { userId: 7, email: 'ticket@test.local', tokenVersion: 0 }; },
}));

import { apiRoutes } from '../src/api';
import { ENTITLEMENT_ERROR_CODE } from '../src/entitlement';
import { AUTOMATION_ENTITLEMENT_DENIALS, signAutomationEntitlementTicket } from '../src/automation/entitlement-ticket';
import { AUTOMATION_ENTITLEMENT_MAX_TICKET_LIFETIME_MS, AUTOMATION_ENTITLEMENT_TICKET_HEADER } from '@heyta/inbound-core';

/**
 * 🔴 「最多 30 秒」从 `@heyta/inbound-core` 那枚毫秒常量推，不写 30 也不从服务端的
 * `MAX_TICKET_SECONDS` 取：后者此刻还坐在别人一条未提交的 hunk 里（工作树有、HEAD 没有），
 * 从这里 import 会让这一档**在干净 HEAD 上编不出来** —— 那正是上一笔刚记过的"工作树绿 ≠ 提交绿"。
 * 而宿主判的本来就是 inbound-core 这一个数，拿它当尺与被测方同源，比抄 30 更有意义。
 */
const MAX_TICKET_SECONDS = AUTOMATION_ENTITLEMENT_MAX_TICKET_LIFETIME_MS / 1000;

const ISSUER = 'https://official.test';
const KEY_ID = 'k-test';
const INSTANCE_ID = randomUUID();
const SUBJECT = 'htsub_' + createHash('sha256').update('subject-a').digest('hex').slice(0, 32);
const LOCAL_ACCOUNT = randomUUID();

/** 两把 Ed25519：一把是部署配的，另一把用来签"签名不对的那一枚"（同 keyId、不同密钥）。 */
const issued = generateKeyPairSync('ed25519');
const foreign = generateKeyPairSync('ed25519');
const rawPublic = (key: ReturnType<typeof generateKeyPairSync>['publicKey']): string =>
  Buffer.from((key.export({ type: 'spki', format: 'der' }) as Buffer).subarray(-32)).toString('base64url');

const keyringFor = (minRevocationVersion?: number): string => JSON.stringify({
  issuer: ISSUER,
  instanceId: INSTANCE_ID,
  keys: { [KEY_ID]: rawPublic(issued.publicKey) },
  ...(minRevocationVersion === undefined ? {} : { minRevocationVersion }),
});

const ticket = (overrides: {
  secret?: ReturnType<typeof generateKeyPairSync>['privateKey'];
  action?: 'ai-reserve' | 'rule-enable' | 'worker-register';
  ruleId?: string;
  installationId?: string;
  officialSubject?: string;
  localAccountUuid?: string;
  eventId?: string;
  nonce?: string;
  issuedAt?: number;
  expiresAt?: number;
  revocationVersion?: number;
} = {}): string => {
  const now = Math.floor(Date.now() / 1000);
  const action = overrides.action ?? 'ai-reserve';
  return signAutomationEntitlementTicket({
    issuer: ISSUER,
    keyId: KEY_ID,
    action,
    capability: 'automation',
    officialSubject: overrides.officialSubject ?? SUBJECT,
    installationId: overrides.installationId ?? INSTANCE_ID,
    localAccountUuid: overrides.localAccountUuid ?? LOCAL_ACCOUNT,
    ...(overrides.ruleId === undefined ? {} : { ruleId: overrides.ruleId }),
    // 作用域档由词表决定：`rule-enable`/`worker-register` 不许带 eventId，
    // `ai-reserve` 必须带。默认给 'ev-shared' 只为了下方那批事件档用例少写一层参数。
    ...(overrides.eventId !== undefined ? { eventId: overrides.eventId } : action === 'ai-reserve' ? { eventId: 'ev-shared' } : {}),
    nonce: overrides.nonce ?? randomUUID(),
    issuedAt: overrides.issuedAt ?? now,
    expiresAt: overrides.expiresAt ?? now + MAX_TICKET_SECONDS,
    revocationVersion: overrides.revocationVersion ?? 0,
  }, overrides.secret ?? issued.privateKey);
};

const reserve = async (eventId: string, presented?: string) => {
  const app = Fastify();
  await app.register(apiRoutes, { prefix: '/api', requireTermsConsent: false });
  const headers: Record<string, string> = {
    authorization: 'Bearer injected',
    'content-type': 'application/json',
    'x-heyta-worker-token': '55'.repeat(32),
    'x-heyta-database-epoch': randomUUID(),
  };
  if (presented !== undefined) headers[AUTOMATION_ENTITLEMENT_TICKET_HEADER] = presented;
  const response = await app.inject({
    method: 'POST',
    url: `/api/automation/events/${eventId}/ai-attempt/reserve`,
    headers,
    payload: { clientId: `t-${randomUUID()}`, ruleId: randomUUID(), parseVersion: 1, attempt: 1,
      leaseGeneration: 1, billingSource: 'managed' },
  });
  await app.close();
  return response;
};

/**
 * 拒绝情形的共同判据：402 + 封闭 reason + 那一枚码 + 没有业务写。
 * `burned` 只有重放那一枚是 `true`：其余每一枚都必须在写消费记录**之前**就被拒掉，
 * 否则"这次没成"会顺带把下一枚票据的配额花掉。
 */
const expectRejected = (presented: string | undefined, code: string, eventId = 'ev-shared', burned = false) =>
  reserve(eventId, presented).then((response) => {
    expect(response.statusCode).toBe(402);
    const body = response.json() as Record<string, unknown>;
    expect(body.code).toBe(ENTITLEMENT_ERROR_CODE);
    expect(body.reason).toBe('ENTITLEMENT_TICKET_REJECTED');
    expect(body.ticketCode).toBe(code);
    expect(mocks.useCreate).toHaveBeenCalledTimes(burned ? 1 : 0);
    return body;
  });

/** 通用注入：闸门两路（预检档与自托管消费档）要用不同路由与不同 body 形状。 */
const call = async (method: 'POST' | 'PUT', url: string, payload: Record<string, unknown>, presented?: string) => {
  const app = Fastify();
  await app.register(apiRoutes, { prefix: '/api', requireTermsConsent: false });
  const headers: Record<string, string> = { authorization: 'Bearer injected', 'content-type': 'application/json' };
  if (presented !== undefined) headers[AUTOMATION_ENTITLEMENT_TICKET_HEADER] = presented;
  const response = await app.inject({ method, url, headers, payload });
  await app.close();
  return response;
};

describe('自动收集票据拒绝的 HTTP 收口（真库那一半在集成档，这里只验线协议形状）', () => {
  const saved = {
    gate: process.env.ENTITLEMENT_GATE_ENABLED,
    mode: process.env.AUTOMATION_ENTITLEMENT_MODE,
    keys: process.env.AUTOMATION_OFFICIAL_KEYS,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENTITLEMENT_GATE_ENABLED = 'true';
    process.env.AUTOMATION_ENTITLEMENT_MODE = 'selfhost-online';
    process.env.AUTOMATION_OFFICIAL_KEYS = keyringFor();
    mocks.db.nowMs = () => BigInt(Date.now());
    mocks.db.revocationFloor = null;
    mocks.clock.findUnique.mockResolvedValue(null);
    mocks.clock.upsert.mockResolvedValue({ installationId: INSTANCE_ID, maxSeenAtMs: 0n });
    mocks.binding.findUnique.mockResolvedValue(null);
    mocks.useCreate.mockResolvedValue({ id: 1 });
    mocks.prisma.subscription.findMany.mockResolvedValue([]);
    mocks.txRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('');
      if (sql.includes('clock_timestamp')) return [{ nowMs: mocks.db.nowMs() }];
      if (sql.includes('automation_entitlement_revocations')) return mocks.db.revocationFloor === null ? [] : [mocks.db.revocationFloor];
      if (sql.includes('FOR SHARE')) return [];
      if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) return [{ id: 7 }];
      return [];
    });
    mocks.prisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => mocks.txRaw(strings, ...values));
    mocks.prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({
      $queryRaw: mocks.txRaw,
      // 这一档不测计量：票据被拒掉时根本走不到处理器，所以位置参数那台只要在场即可。
      $queryRawUnsafe: async () => [],
      $executeRawUnsafe: async () => 1,
      automationEntitlementBinding: mocks.binding,
      automationEntitlementTicketUse: { create: mocks.useCreate },
      automationEntitlementClock: mocks.clock,
    }));
  });

  afterEach(() => {
    for (const [name, value] of [['ENTITLEMENT_GATE_ENABLED', saved.gate], ['AUTOMATION_ENTITLEMENT_MODE', saved.mode], ['AUTOMATION_OFFICIAL_KEYS', saved.keys]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });

  it('坏签名：402 + TICKET_INVALID，且 nonce 没被烧掉', async () => {
    // 同一个 keyId、另一把私钥 —— 正是"部署换钥但 keyId 没换"那格的形状。
    await expectRejected(ticket({ secret: foreign.privateKey }), AUTOMATION_ENTITLEMENT_DENIALS.TICKET_INVALID);
  });

  it('错实例：票据签给别的 installationId ⇒ 402 + TICKET_INVALID', async () => {
    await expectRejected(ticket({ installationId: randomUUID() }), AUTOMATION_ENTITLEMENT_DENIALS.TICKET_INVALID);
  });

  it('错主体：绑定行记的主体与票据不符 ⇒ 402 且 ticketCode 是 SUBJECT_CONFLICT', async () => {
    // 只有这一枚要让绑定行存在（`if (current && …)`）：没有绑定行时主体无从比对。
    mocks.binding.findUnique.mockResolvedValue({
      officialSubject: 'htsub_' + '0'.repeat(32), installationId: INSTANCE_ID,
      localAccountUuid: LOCAL_ACCOUNT, issuer: ISSUER, keyId: KEY_ID, revocationVersion: 0,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expectRejected(ticket(), AUTOMATION_ENTITLEMENT_DENIALS.SUBJECT_CONFLICT);
  });

  it('作用域不符：票据绑的是另一条事件 ⇒ 402 + TICKET_SCOPE_MISMATCH', async () => {
    await expectRejected(ticket({ eventId: 'ev-for-a-different-event' }), AUTOMATION_ENTITLEMENT_DENIALS.TICKET_SCOPE_MISMATCH);
  });

  it('过期：数据库时钟走到 expiresAt 之后 ⇒ 402 + TICKET_EXPIRED', async () => {
    const now = Math.floor(Date.now() / 1000);
    mocks.db.nowMs = () => BigInt((now + MAX_TICKET_SECONDS + 2) * 1000);
    await expectRejected(ticket({ issuedAt: now, expiresAt: now + MAX_TICKET_SECONDS }), AUTOMATION_ENTITLEMENT_DENIALS.TICKET_EXPIRED);
  });

  it('重放：nonce 已存在 ⇒ 402 + TICKET_USED（这一枚确实要撞唯一约束）', async () => {
    mocks.useCreate.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    // burned=true：只有这一枚是"撞了约束才被拒"，其余每一枚都必须落在写消费记录之前。
    await expectRejected(ticket(), AUTOMATION_ENTITLEMENT_DENIALS.TICKET_USED, 'ev-shared', true);
  });

  it('时钟回拨：实例高水位高于数据库时钟 ⇒ 402 + CLOCK_ROLLBACK', async () => {
    mocks.clock.findUnique.mockResolvedValue({ installationId: INSTANCE_ID, maxSeenAtMs: BigInt(Date.now() + 600_000) });
    await expectRejected(ticket(), AUTOMATION_ENTITLEMENT_DENIALS.CLOCK_ROLLBACK);
  });

  it('吊销落后：部署下限高于票据版本 ⇒ 402 + REVOCATION_STALE', async () => {
    process.env.AUTOMATION_OFFICIAL_KEYS = keyringFor(3);
    await expectRejected(ticket({ revocationVersion: 1 }), AUTOMATION_ENTITLEMENT_DENIALS.REVOCATION_STALE);
  });

  it('自托管在线模式下不带票 ⇒ 402 + ENTITLEMENT_TICKET_REQUIRED（没有 ticketCode 可给）', async () => {
    const response = await reserve(`ev-${randomUUID()}`);
    expect(response.statusCode).toBe(402);
    const body = response.json() as Record<string, unknown>;
    expect(body.reason).toBe('ENTITLEMENT_TICKET_REQUIRED');
    expect(body.ticketCode).toBeUndefined();
    expect(mocks.useCreate).not.toHaveBeenCalled();
  });

  it('配了模式却没配公钥环 ⇒ 402 + ISSUER_NOT_CONFIGURED，不许变成会被重试的 500', async () => {
    delete process.env.AUTOMATION_OFFICIAL_KEYS;
    const response = await reserve(`ev-${randomUUID()}`, ticket());
    expect(response.statusCode).toBe(402);
    expect((response.json() as Record<string, unknown>).reason).toBe('ISSUER_NOT_CONFIGURED');
  });

  it('正向对照：合法票据不是 402，且 nonce 真的被消费了一次', async () => {
    const response = await reserve('ev-valid', ticket({ eventId: 'ev-valid' }));
    expect(response.statusCode).not.toBe(402);
    expect(mocks.useCreate).toHaveBeenCalledTimes(1);
    expect(mocks.clock.upsert).toHaveBeenCalledTimes(1);
  });

  // 🔴 上面那批走的是"闸门自己开事务消费"那一路（`ai-attempt/reserve` 因计量端口形状没挪进
  // 业务写事务，`api.ts` 那一格注释写明了）。下面三条补的是**另一路** `precheckOnly`：
  // 预检只做与时刻无关的离线判定，一个字节都不写库。两条路回出的形状必须逐字相同，
  // 而它们是两个不同的分支 —— 只测一条，另一条漏掉 `ticketCode` 也不会有任何东西失败。
  it('预检档（worker/register）：坏签名回 402 + TICKET_INVALID，且闸门根本不开事务', async () => {
    const response = await call('POST', '/api/automation/worker/register',
      { clientId: `c-${randomUUID()}`, databaseEpoch: randomUUID() }, ticket({ action: 'worker-register', secret: foreign.privateKey }));
    expect(response.statusCode).toBe(402);
    expect(response.json()).toMatchObject({
      code: ENTITLEMENT_ERROR_CODE, reason: 'ENTITLEMENT_TICKET_REJECTED', ticketCode: AUTOMATION_ENTITLEMENT_DENIALS.TICKET_INVALID,
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.useCreate).not.toHaveBeenCalled();
  });

  it('预检档：票据绑的是另一条规则 ⇒ 402 + TICKET_SCOPE_MISMATCH，同样不开事务', async () => {
    const response = await call('PUT', `/api/automation/rules/${randomUUID()}/enabled`, { enabled: true },
      ticket({ action: 'rule-enable', ruleId: randomUUID() }));
    expect(response.statusCode).toBe(402);
    expect((response.json() as Record<string, unknown>).ticketCode).toBe(AUTOMATION_ENTITLEMENT_DENIALS.TICKET_SCOPE_MISMATCH);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('关闭规则不带票也不许被权益挡住（"管理/关闭规则不要求付费"这一句在线层有尺）', async () => {
    const response = await call('PUT', `/api/automation/rules/${randomUUID()}/enabled`, { enabled: false });
    expect(response.statusCode).not.toBe(402);
    expect(mocks.useCreate).not.toHaveBeenCalled();
  });

  it('拒绝里不回显票据正文、官方主体、本地账号 UUID 与 nonce（响应与审计两侧都查）', async () => {
    const account = randomUUID();
    // 绑定行的本地账号与票据不符 ⇒ 必然走到 SUBJECT_CONFLICT（那一枚码覆盖主体/实例/账号/签发者四种不符），
    // 而这四个字面量正是最容易被顺手回显的东西。
    mocks.binding.findUnique.mockResolvedValue({
      officialSubject: SUBJECT, installationId: INSTANCE_ID, localAccountUuid: account,
      issuer: ISSUER, keyId: KEY_ID, revocationVersion: 0, expiresAt: new Date(Date.now() + 60_000),
    });
    const presented = ticket({ eventId: 'ev-leak', localAccountUuid: randomUUID() });
    const nonce = JSON.parse(Buffer.from(presented.split('.')[0]!, 'base64url').toString('utf8')).nonce as string;
    const body = await expectRejected(presented, AUTOMATION_ENTITLEMENT_DENIALS.SUBJECT_CONFLICT, 'ev-leak');
    const text = JSON.stringify(body);
    for (const secret of [presented, SUBJECT, account, nonce]) expect(text).not.toContain(secret);
    const audited = JSON.stringify(mocks.audit.mock.calls);
    for (const secret of [presented, SUBJECT, account, nonce]) expect(audited).not.toContain(secret);
    // 审计要能指出是哪一枚码，否则运营者只能看到"有人被拒"。
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'ENTITLEMENT_TICKET_REJECTED', capability: 'automation', ticketCode: AUTOMATION_ENTITLEMENT_DENIALS.SUBJECT_CONFLICT,
    }));
  });
});
