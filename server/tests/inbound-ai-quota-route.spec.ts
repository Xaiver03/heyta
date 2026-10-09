import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * AC-1 那句"额度耗尽…拒绝且**不产生业务效果**"的 **HTTP 形状**判卷。
 *
 * 真库那一半（既不落 `automation_ai_attempts` 也不抬计数器、本机/自带端点不受托管额度挡）
 * 在 `tests/automation-ai-metering.pglite.spec.ts` 的「额度耗尽」那一节，因为只有真
 * PostgreSQL 能回答"没有落行"。这一档钉的是**判定怎么变成响应**：
 *
 * 1. 🔴 额度耗尽必须回 **402** + `reason: 'QUOTA_EXCEEDED'`。改之前它和"租约掉了"一起
 *    落进那个"任何异常都算 409"的 `catch` —— 而 409 在宿主里读作"这次传输失败了"，
 *    于是 `inbound-worker.ts` 会退避重试**一整周期**，界面只显示报错，永远不显示
 *    "本月 300 次用完了"。那一档文件头写着"把它混进传输失败会让用户对着一条报错反复点
 *    同一个按钮"，说的就是这一格。
 * 2. 🔴 **反向不许顺手做过头**：租约/数据库故障那类仍然必须是 409。把该重试的说成
 *    "停止重试"与把不该重试的说成"可重试"同样是错的。
 * 3. 402 的响应体形状与闸门那一路同源（`errorCode` 用同一枚导出常量，`limit` 用唯一数字源）。
 *
 * ⚠️ 这一档**不**证明的事，逐条写清楚免得被读成端到端：
 * `authenticate` 被换成"直接写好身份"（JWT 那一路有自己的判据），数据库是一台按 SQL
 * 文本回行的假机器 —— 所以 worker 凭据、租约有效性、计数器原子性在这里都**没有被验**，
 * 它们分别由 `automation-entitlement-ticket` / `inbound-worker-identity.integration`
 * / `ai-metering.pglite` 那三份负责。这里唯一的被测对象是**状态码映射**。
 */

const mocks = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
    /** 闸门与吊销下限都在 `$queryRaw`（模板标签）上读；计量那一路读的是 `$queryRawUnsafe`。 */
    $queryRaw: vi.fn(),
    subscription: { findMany: vi.fn() },
  },
  /** 事务内那两台：读回行 / 写账行。写账行的调用次数就是"有没有业务效果"的读数。 */
  txQuery: vi.fn(),
  txExecute: vi.fn(),
  audit: vi.fn(),
  /** 这一次预留里计数器怎么答：`exhausted` ⇒ UPSERT 的 RETURNING 回零行（= 超额不消耗）。 */
  counters: { mode: 'ok' as 'ok' | 'exhausted' | 'boom' },
}));

vi.mock('../src/db', () => ({ prisma: mocks.prisma }));
vi.mock('../src/logger', () => ({
  Logger: { audit: mocks.audit, warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn() },
}));
// 身份注入：JWT 那一路的判据在 `password-auth-routes` / `account-closed-signal` 那些档里，
// 这一档只把 `getAuthUser` 要的三元组准备好（真 `getAuthUser` 继续从 middleware 拿）。
vi.mock('../src/middleware', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/middleware')>()),
  authenticate: async (req: { user?: unknown }) => { req.user = { userId: 7, email: 'quota@test.local', tokenVersion: 0 }; },
}));

import { apiRoutes } from '../src/api';
import { ENTITLEMENT_ERROR_CODE } from '../src/entitlement';
import { MANAGED_AI_REQUESTS_PER_PERIOD } from '../src/ai/metering';

const PERIOD_END = Date.now() + 30 * 24 * 60 * 60 * 1000;
const WORKER_TOKEN = '44'.repeat(32);
const EPOCH = randomUUID();
const GRANTS = ['hosting', 'ai', 'automation'];
/**
 * 两位读者要的是**两种列名形状**，这不是挑剔，是它们各自的投影：
 * 闸门 `SELECT ... current_period_end AS "currentPeriodEnd" ... FOR SHARE` ⇒ camel；
 * 计量 `SELECT "status", "grants", "current_period_end" FROM "subscriptions"` ⇒ snake。
 * 给错一边的结果是 `MISSING_PERIOD_END` —— 一个看起来像"用户没订阅"的码，
 * 而真相是探针把列名喂错了。所以这里分开写死，不用一个对象糊两边。
 */
const GATE_SUBSCRIPTION_ROW = { status: 'active', grants: GRANTS, currentPeriodEnd: BigInt(PERIOD_END) };
const METERING_SUBSCRIPTION_ROW = { status: 'active', grants: GRANTS, current_period_end: BigInt(PERIOD_END) };

const rawRows = (sql: string): unknown[] => {
  if (sql.includes('FOR SHARE')) return [GATE_SUBSCRIPTION_ROW];
  if (sql.includes('automation_entitlement_revocations')) return [];
  if (sql.includes('FROM "subscriptions"')) return [METERING_SUBSCRIPTION_ROW];
  if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) return [{ id: 7 }];
  if (sql.includes('automation_workers')) return [{ id: 'worker-1' }];
  if (sql.includes('FROM automation_events')) return [{ ok: 1 }];
  if (sql.includes('FROM automation_ai_attempts')) return [];
  if (sql.includes('INSERT INTO "ai_usage_counters"')) {
    if (mocks.counters.mode === 'boom') throw new Error('注入：数据库故障');
    return mocks.counters.mode === 'exhausted' ? [] : [{ requests: 1n }];
  }
  if (sql.includes('FROM "ai_usage_counters"')) return [{ requests: 1n }];
  return [];
};

const reserve = async (eventId: string) => {
  const app = Fastify();
  // `requireTermsConsent` 是 `ApiRoutesOptions` 的**必填**项（`src/api.ts:609`），
  // 省略只会在运行时把注册页 schema 构型悄悄变成 `buildRegisterBodySchema(undefined)`。
  // 本文件不测注册，但它一次 `register` 就把那整个插件装起来了 ⇒ 按线上形状显式给值，
  // 别让它靠"没类型门禁"混过去（BLOCKED.md B123 记的就是这一层从来不被检查）。
  await app.register(apiRoutes, { prefix: '/api', requireTermsConsent: false });
  const response = await app.inject({
    method: 'POST',
    url: `/api/automation/events/${eventId}/ai-attempt/reserve`,
    headers: { authorization: 'Bearer injected', 'content-type': 'application/json',
      'x-heyta-worker-token': WORKER_TOKEN, 'x-heyta-database-epoch': EPOCH },
    payload: { clientId: `quota-${EPOCH}`, ruleId: randomUUID(), parseVersion: 1, attempt: 1,
      leaseGeneration: 1, billingSource: 'managed' },
  });
  await app.close();
  return response;
};

describe('托管额度耗尽的 HTTP 收口', () => {
  const saved = { gate: process.env.ENTITLEMENT_GATE_ENABLED, mode: process.env.AUTOMATION_ENTITLEMENT_MODE };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENTITLEMENT_GATE_ENABLED = 'true';
    process.env.AUTOMATION_ENTITLEMENT_MODE = 'official';
    mocks.counters.mode = 'ok';
    mocks.prisma.subscription.findMany.mockResolvedValue([GATE_SUBSCRIPTION_ROW]);
    mocks.prisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => rawRows(strings.join('')));
    mocks.txQuery.mockImplementation(async (sql: string) => rawRows(sql));
    mocks.txExecute.mockResolvedValue(1);
    // 事务必须是**真的跑回调**那一台：空 mock 会让事务体根本不执行，
    // 而 402/409 照样能各回一个码 —— 那正是这一档最假的过法。
    // 事务客户端要同时供得起两位读者：闸门用 `$queryRaw`（模板标签，读订阅与吊销下限），
    // 计量那一路用 `$queryRawUnsafe`/`$executeRawUnsafe`（位置参数）。
    mocks.prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({
      $queryRaw: async (strings: TemplateStringsArray) => rawRows(strings.join('')),
      $queryRawUnsafe: mocks.txQuery,
      $executeRawUnsafe: mocks.txExecute,
      automationEntitlementBinding: { findUnique: async () => null },
    }));
  });

  afterEach(() => {
    if (saved.gate === undefined) delete process.env.ENTITLEMENT_GATE_ENABLED; else process.env.ENTITLEMENT_GATE_ENABLED = saved.gate;
    if (saved.mode === undefined) delete process.env.AUTOMATION_ENTITLEMENT_MODE; else process.env.AUTOMATION_ENTITLEMENT_MODE = saved.mode;
  });

  it('额度用尽回 402 + QUOTA_EXCEEDED，把 used/limit 给宿主，且不写账行', async () => {
    mocks.counters.mode = 'exhausted';
    const response = await reserve(`ev-quota-${randomUUID()}`);
    expect(response.statusCode).toBe(402);
    const body = response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ errorCode: ENTITLEMENT_ERROR_CODE, reason: 'QUOTA_EXCEEDED', used: 1 });
    // `limit` 从唯一数字源推，不抄 300：抄了的那条在别人改价时仍然绿。
    expect(body.limit).toBe(MANAGED_AI_REQUESTS_PER_PERIOD);
    expect(typeof body.error).toBe('string');
    // 🔴 拒掉的这一次**没有业务效果**：授权之后那句 INSERT 不该发生。
    expect(mocks.txExecute).not.toHaveBeenCalled();
    // 审计里那条 DENIED 带着这一路的 reason 与能力，否则运营者查不到是谁被额度挡住。
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ reason: 'QUOTA_EXCEEDED', capability: 'automation' }));
  });

  it('反向：数据库故障仍然回 409，不许被一并变成"停止重试"', async () => {
    mocks.counters.mode = 'boom';
    const response = await reserve(`ev-boom-${randomUUID()}`);
    expect(response.statusCode).toBe(409);
    expect((response.json() as Record<string, unknown>).reason).toBeUndefined();
  });

  it('正向对照：额度够的时候同一条路是 200，且真的写了那一行账', async () => {
    const response = await reserve(`ev-ok-${randomUUID()}`);
    expect(response.statusCode).toBe(200);
    expect(mocks.txExecute).toHaveBeenCalled();
  });
});
