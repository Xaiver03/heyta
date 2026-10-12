import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, generateKeyPairSync, randomUUID, verify } from 'node:crypto';

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
import { AUTOMATION_ENTITLEMENT_DENIALS, signAutomationEntitlementTicket, signAutomationEntitlementTicketUnchecked, loadAutomationEntitlementKeyring, inspectAutomationEntitlementTicket } from '../src/automation/entitlement-ticket';
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

/**
 * 直接驱动票据闸门那一层时要用的夹具 —— 与路由那一路**同源**：
 * 就是 `beforeEach` 写进 env 的那一份 keyring，复用的是同一个 `issued` 密钥对。
 * ⇒ "签名对不对"这一维在两处逐字相同，唯一被单独动过的是 eventId 的形状。
 */
const gateKeyring = (): NonNullable<ReturnType<typeof loadAutomationEntitlementKeyring>> =>
  loadAutomationEntitlementKeyring(keyringFor())!;

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
  /**
   * 绕过签发侧校验，直接产出一枚**形状不合法**的票据（B182/B183 那两条形状用例要的正是它）。
   *
   * 为什么需要这枚逃生门：`signAutomationEntitlementTicket` 自己也校验形状，所以
   * `ticket({ eventId: '-evt' })` 会**在签发那一刻就抛**，根本到不了闸门 ——
   * 而形状用例要问的是"**收票那一侧**收不收"。不绕过签发侧，这两条用例只会测到签发侧。
   * ⚠️ 它只改 claims 的形状，签名照签，所以验签路径仍然是真的。
   */
  bypassIssueSideShapeCheck?: boolean;
} = {}): string => {
  const now = Math.floor(Date.now() / 1000);
  const action = overrides.action ?? 'ai-reserve';
  const signTicket = overrides.bypassIssueSideShapeCheck
    ? signAutomationEntitlementTicketUnchecked
    : signAutomationEntitlementTicket;
  return signTicket({
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
    // 🔴 `version` 必须显式写进来：`signAutomationEntitlementTicketUnchecked` **不做**
    // `{...claims, version: 1}` 那一步（那正是它被绕开的东西），所以漏了它签出来的是一枚
    // `claimsSchema` 判不合法的票据 —— 而失败会落在 `version` 上，**根本走不到 eventId 的形状判据**。
    // 实测踩过：漏掉这一格时，下面那两条形状用例在**变异体上照样绿**（假绿），
    // 因为闸门拒它们的理由是 `version` 而不是形状。
    version: 1,
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

/**
 * 🔴 **形状档专用**：URL 与票据 claims 用**同一个**非法 eventId。
 *
 * 为什么不能直接复用 `expectRejected(..., eventId)`：那个 helper 的第三个参数只改
 * **票据 claims**，URL 永远走它自己那个默认的 `'ev-shared'`。于是
 * 「票据 claims 里的形状被放宽」这件事**根本不会被问到** —— 票据带着非法 claims 过闸门，
 * 而路由参数是合法的，请求一路走到底。
 *
 * ⚠️ **空串那一档不在这里**：它会让 URL 变成 `…/events//ai-attempt/reserve`，
 * Fastify 根本匹配不到这条路由，读到的 404 是**路由形状**造成的，不是形状校验造成的 ——
 * 拿它当形状判据就是一条永远为真的尺。
 */
const expectShapeRejected = async (eventId: string): Promise<void> => {
  const response = await reserve(eventId, ticket({ eventId, bypassIssueSideShapeCheck: true }));
  expect(response.statusCode).toBe(402);
  const body = response.json() as Record<string, unknown>;
  expect(body.code).toBe(ENTITLEMENT_ERROR_CODE);
  expect(body.ticketCode).toBe(AUTOMATION_ENTITLEMENT_DENIALS.TICKET_INVALID);
  expect(mocks.useCreate).not.toHaveBeenCalled();
};

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

  /**
   * 🔴 **形状那一格**（B182 / B183）。
   *
   * 补这两条之前，这一族**零形状覆盖**：全部用例用的都是 `ev-shared` / `ev-valid` /
   * `ev-leak` / `ev-for-a-different-event`，而**当时那几份模式副本同时接受这四个字面量** ⇒
   * 把任何一份收紧或放宽都不会红。
   *
   * 现在形状只有一份事实源（`@heyta/inbound-core` 的 `INBOUND_EVENT_ID_PATTERN`，
   * 抄的是协议里那句「来源 ID 必须是 1–64 字节 ASCII 字母/数字/冒号/下划线/连字符，
   * 以字母或数字起头」），票据 claims / 路由参数 / 计量层三处都 import 它。
   *
   * ── 这一族钉的到底是什么（**2026-10-12 实测更正了原先的推断**）──
   *
   * 落笔时的推断是「形状被放宽 ⇒ 拒绝从内层 402 滑到外层 400」。**实测不是那样**，
   * 而实测顺带照出了这条 helper 自己的一枚假绿 —— 两件事都留在这里：
   *
   * 🔴 **坑一：`version` 漏了 ⇒ 端到端那两条在变异体上照样绿。**
   * `signAutomationEntitlementTicketUnchecked` **不做** `{...claims, version: 1}` 那一步
   * （那正是它被绕开的东西）。`ticket()` 起初没显式写 `version`，于是签出来的是一枚
   * **没有 `version` 字段**的票据，`claimsSchema` 判它在 `version` 上不合法、**根本走不到
   * `eventId` 的形状判据**。症状是：把 `INBOUND_EVENT_ID_PATTERN` 放宽之后这两条依然全绿。
   * 修法是让 `ticket()` 显式带上 `version: 1`（见那个 helper 里的注释）。
   *
   * 🔴 **坑二：端到端那条 402 是桩的巧合，不是闸门判出来的。**
   * 修好坑一之后逐层量，放宽 `INBOUND_EVENT_ID_PATTERN` 得到的是：
   *
   * | 层 | 放宽前 | 放宽后 |
   * |---|---|---|
   * | 票据闸门 `inspectAutomationEntitlementTicket` | 拒（`TICKET_INVALID`） | **放行**（`{ok:true}`） |
   * | 端到端 HTTP | 402 + `TICKET_INVALID` | **仍是 402 + `TICKET_INVALID`** |
   *
   * 端到端那一格没跟着变，是因为闸门放行之后请求一路走到业务写事务，而**这台假库的
   * `automationEntitlementTicketUse.create` 不在场** ⇒ 抛错被 `authorizeAutomationOperation`
   * 收成 `TICKET_REJECTED`。⇒ **拿端到端当形状判据就是一条假尺**（它在放宽后依然绿）。
   * 所以真正承重的是**下面那三条直接问闸门纯函数**的用例 —— 它们才是会红的那一对。
   *
   * 端到端那两条留在原地仍然有价值，但价值是"**端到端形状**"而不是"闸门形状"：
   * 它们钉的是 URL 与 claims 同形时**不会**变成 400/500 那种更坏的读数，
   * 以及"不合形状的请求一个字节都不许写库"（`useCreate` 零调用）。
   */
  it('形状：首字符不是字母数字（`-evt`）⇒ 402 + TICKET_INVALID，不是 400', async () => {
    await expectShapeRejected('-evt');
  });

  it('形状：eventId 超过协议上限 64 字节（65 字节）⇒ 402 + TICKET_INVALID', async () => {
    await expectShapeRejected('e'.repeat(65));
  });

  /**
   * 🔴 **真正承重的那一条**：形状校验住在票据闸门的**那一层**，就钉那一层。
   *
   * ── 为什么不能只写上面两条（**2026-10-12 实测**）──
   *
   * 上面两条走端到端 HTTP，而它们在 `INBOUND_EVENT_ID_PATTERN` 被放宽成
   * `^[A-Za-z0-9:_-]{1,127}$` 之后**依然全绿**。逐层量出来的原因：
   *
   * | 层 | 放宽前 | 放宽后 |
   * |---|---|---|
   * | 票据闸门 `inspectAutomationEntitlementTicket` | 拒（`TICKET_INVALID`） | **放行**（`{ok:true}`） |
   * | 端到端 HTTP | 402 + `TICKET_INVALID` | **仍是 402 + `TICKET_INVALID`** |
   *
   * 端到端那一格没跟着变，是因为闸门放行之后请求一路走到业务写事务，而**这台假库的
   * `automationEntitlementTicketUse.create` 不在场** ⇒ 抛错被收成 `TICKET_REJECTED`。
   * ⇒ **那条 402 是桩的巧合，不是闸门判出来的**；拿端到端当形状判据就是一条假尺。
   *
   * 所以这一条直接调闸门那个纯函数（`inspectAutomationEntitlementTicket`，
   * 与 `redeemAutomationEntitlementTicket` 第一步调的**同一个**），喂一枚 claims 形状非法的
   * 真签名票据 —— 签名、keyring、issuer/instance 全都是真的，**只有 eventId 的形状不对**。
   *
   * 反向验证（必做）：把 `INBOUND_EVENT_ID_PATTERN` 放宽成 `^[A-Za-z0-9:_-]{1,127}$`
   * ⇒ 本用例转红（`ok` 从 `false` 翻成 `true`）；改回 `^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$` ⇒ 转绿。
   */
  it('形状（承重）：闸门对一枚 `-evt` 票据必须判不允许，码是 TICKET_INVALID', () => {
    const inspected = inspectAutomationEntitlementTicket(
      ticket({ eventId: '-evt', bypassIssueSideShapeCheck: true }),
      gateKeyring(),
      { action: 'ai-reserve', eventId: '-evt' },
    );
    expect(inspected.ok).toBe(false);
    expect(inspected).toMatchObject({ code: AUTOMATION_ENTITLEMENT_DENIALS.TICKET_INVALID });
  });

  it('形状（承重·超长）：闸门对一枚 65 字节 `eventId` 的票据必须判不允许', () => {
    const long = 'e'.repeat(65);
    const inspected = inspectAutomationEntitlementTicket(
      ticket({ eventId: long, bypassIssueSideShapeCheck: true }),
      gateKeyring(),
      { action: 'ai-reserve', eventId: long },
    );
    expect(inspected.ok).toBe(false);
    expect(inspected).toMatchObject({ code: AUTOMATION_ENTITLEMENT_DENIALS.TICKET_INVALID });
  });

  /**
   * 上面两条的**阳性对照**（环境陷阱 #274）：把 eventId 换成一个形状合法的值，
   * 同一枚 keyring、同一个调用点必须判**通过**。
   *
   * 没有这一条的话，"闸门恒拒"也能让上面两条全绿 —— 而那正是最容易写出的假尺。
   * 这一条绿，才说明上面那两条红是**形状**造成的。
   */
  it('阳性对照：同一枚票据换成合法形状（`ev-ok`）⇒ 闸门必须判通过', () => {
    const inspected = inspectAutomationEntitlementTicket(
      ticket({ eventId: 'ev-ok' }),
      gateKeyring(),
      { action: 'ai-reserve', eventId: 'ev-ok' },
    );
    expect(inspected.ok).toBe(true);
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
