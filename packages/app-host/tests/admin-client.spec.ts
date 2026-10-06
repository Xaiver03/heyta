/**
 * 管理后台客户端的传输契约（`packages/app-host/src/admin-client.ts`）。
 *
 * 这里钉的是**"请求到底发没发、失败被读成什么"**，而不是界面：
 *
 *   1. 🔴 **未配服务器 / 未登录 ⇒ 一个请求都不发。**
 *      后台面板挂在设置页里，而设置页是所有用户都会打开的 ——
 *      这条规则如果不成立，每个未登录访客都会往 `/api/admin/overview`
 *      打一发 401，在网络面板里留下一串无意义的红。
 *   2. 🔴 **403 与 401 必须分开**：前者是"这个账号没有权限"（重试无意义），
 *      后者是"令牌过期"（重新登录就好）。合并会让界面给一个永远不会有权限的人
 *      一句"请重新登录"。
 *   3. 断网 ⇒ `network`，而不是 `server`。把网络问题说成服务端故障会把排查引偏。
 *   4. 2xx 但不是 JSON ⇒ `server`（服务端坏了，不是网络）。
 *
 * 变异验证：把 `adminRequest` 里取令牌的那段短路拿掉（直接带着空令牌发请求），
 * 第 1 条会转红。
 */
import { describe, expect, it, vi, type Mock } from 'vitest';

import {
  ADMIN_API_PREFIX,
  adminApproveRefund,
  adminCreateRefundRequest,
  adminForceUserLogout,
  adminRejectRefund,
  adminDeleteHolidayYear,
  adminPutHolidayYear,
  adminUnlockUser,
  fetchAdminHolidayYears,
  fetchAdminOverview,
  fetchAdminRefunds,
  fetchAdminUsers,
  type AdminClientOptions,
} from '../src/admin-client.js';

const BASE = 'https://example.test';

/**
 * 把 vi 的 mock 交给 `fetchImpl` 参数。
 *
 * ⚠️ 需要显式断言：`Mock` 不是 `typeof fetch`（签名多态，TS 不认）。
 * 这不是偷懒 —— `fetchImpl` 在**生产代码**里保持严格的 `typeof fetch`，
 * 只在测试的这一处放开，是为了"注入替身"这一件事本身，而不是放宽产品接口。
 */
function withFetch(fetchImpl: Mock, overrides: Partial<AdminClientOptions> = {}): AdminClientOptions {
  return {
    baseUrl: BASE,
    getToken: async () => 'tok',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    ...overrides,
  };
}

/** 一个永远回同一个响应的 fetch 替身。 */
function stubResponse(status: number, body: unknown, contentTypeIsJson = true): Mock {
  return vi.fn(() =>
    Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
      json: () => (contentTypeIsJson ? Promise.resolve(body) : Promise.reject(new Error('not json'))),
    } as unknown as Response),
  );
}

describe('🔴 不发无谓的请求', () => {
  it('未配服务器（baseUrl 为空）⇒ 不发请求，返回 unconfigured', async () => {
    const fetchImpl = stubResponse(200, {});

    const result = await fetchAdminOverview(withFetch(fetchImpl, { baseUrl: '' }));

    expect(result).toEqual({ ok: false, reason: 'unconfigured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('未登录（没有令牌）⇒ 不发请求，返回 no-token', async () => {
    const fetchImpl = stubResponse(200, {});

    const result = await fetchAdminOverview(withFetch(fetchImpl, { getToken: async () => undefined }));

    expect(result).toEqual({ ok: false, reason: 'no-token' });
    // 🔴 这条就是那条规则的单点判据。删掉 `getToken` 的空值短路会让它转红。
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('空串令牌也算未登录', async () => {
    const fetchImpl = stubResponse(200, {});
    const result = await fetchAdminOverview(withFetch(fetchImpl, { getToken: async () => '' }));
    expect(result).toEqual({ ok: false, reason: 'no-token' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('请求形状', () => {
  it('带上 Bearer 令牌，路径是 /api/admin/overview', async () => {
    const fetchImpl = stubResponse(200, { users: {} });

    await fetchAdminOverview(withFetch(fetchImpl));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}${ADMIN_API_PREFIX}/overview`);
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tok');
  });

  it('用户搜索把 q 拼进查询串（服务端按邮箱 contains）', async () => {
    const fetchImpl = stubResponse(200, { items: [], total: 0, limit: 50, offset: 0 });

    await fetchAdminUsers(withFetch(fetchImpl), { q: 'a b@example.test', offset: 50 });

    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toContain('q=a+b%40example.test');
    expect(url).toContain('offset=50');
  });

  it('写动作是 POST（解锁）', async () => {
    const fetchImpl = stubResponse(200, { ok: true });

    await adminUnlockUser(withFetch(fetchImpl), 7);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}${ADMIN_API_PREFIX}/users/7/unlock`);
    expect(init.method).toBe('POST');
  });
});

describe('🔴 失败原因是可区分的（403 ≠ 401 ≠ 网络）', () => {
  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not-found'],
    [400, 'invalid'],
    [500, 'server'],
    [503, 'server'],
  ] as const)('HTTP %i ⇒ %s', async (status, reason) => {
    const fetchImpl = stubResponse(status, { error: 'x' });
    const result = await fetchAdminOverview(withFetch(fetchImpl));
    expect(result).toEqual({ ok: false, reason, status });
  });

  it('断网 ⇒ network（不是 server）', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error('offline')));
    const result = await fetchAdminOverview(withFetch(fetchImpl));
    expect(result).toEqual({ ok: false, reason: 'network' });
  });

  it('2xx 但响应不是 JSON ⇒ server（服务端坏了，不是网络）', async () => {
    const fetchImpl = stubResponse(200, undefined, false);
    const result = await fetchAdminOverview(withFetch(fetchImpl));
    expect(result).toMatchObject({ ok: false, reason: 'server' });
  });

  it('成功时把响应体原样交出去', async () => {
    const payload = { users: { total: 1 } };
    const fetchImpl = stubResponse(200, payload);
    const result = await fetchAdminOverview(withFetch(fetchImpl));
    expect(result).toEqual({ ok: true, data: payload });
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * 调休 / 补班（W4b 的三条管理端点）。
 *
 * 这一组钉的是**传输**，不是界面：
 *   · 写面（PUT / DELETE）与读面（GET）**必须共用同一道令牌闸** ——
 *     `AGENTS` §3.5 说"第二份 fetch 意味着第二份令牌闸"，这条就是防它的；
 *   · PUT 是**整年替换**，所以年份只能出现在 body 里（契约 `holidayYearPutSchema`）；
 *   · DELETE 的年份只能出现在**查询串**里，且**不带动作体**。
 *     理由不是风格：契约 `HOLIDAY_ADJUSTMENT_PATHS.adminDelete` 写明
 *     "同一个数字两个来源"要额外一条守卫才拦得住，而那条守卫的缺失是静默的。
 * ──────────────────────────────────────────────────────────────────────── */
const HOLIDAY_PAYLOAD = {
  year: 2027,
  papers: ['https://www.gov.cn/gongbao/content/2026/content_12345.htm'],
  note: '据 2026-11 调整公告',
  days: [
    { day: '2027-01-02', isOffDay: true },
    { day: '2027-01-09', isOffDay: false },
  ],
};

describe('🔴 调休 / 补班三条端点的传输形状', () => {
  it('GET 打的是 /api/admin/holiday-adjustments，方法默认 GET 且无 body', async () => {
    const fetchImpl = stubResponse(200, { version: '1.1.2', years: [] });

    const result = await fetchAdminHolidayYears(withFetch(fetchImpl));

    expect(result.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}${ADMIN_API_PREFIX}/holiday-adjustments`);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('PUT 是整年替换：方法 PUT、路径不带年份、年份与逐日表都在 body 里', async () => {
    const fetchImpl = stubResponse(200, { ok: true, year: 2027, papers: [], dayCount: 2 });

    await adminPutHolidayYear(withFetch(fetchImpl), HOLIDAY_PAYLOAD);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}${ADMIN_API_PREFIX}/holiday-adjustments/years`);
    expect(url).not.toContain('2027');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual(HOLIDAY_PAYLOAD);
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('DELETE 的年份只在查询串里，且**不带动作体**（两个来源 = 一条多余的守卫）', async () => {
    const fetchImpl = stubResponse(200, { ok: true, year: 2027, deleted: 1 });

    await adminDeleteHolidayYear(withFetch(fetchImpl), 2027);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}${ADMIN_API_PREFIX}/holiday-adjustments/years?year=2027`);
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
    expect(init.headers as Record<string, string | undefined>).not.toHaveProperty('content-type');
  });

  it('🔴 未登录时 PUT 与 DELETE 也一个请求都不发（写面与读面同一道闸）', async () => {
    const fetchImpl = stubResponse(200, {});
    const options = withFetch(fetchImpl, { getToken: async () => undefined });

    expect(await fetchAdminHolidayYears(options)).toEqual({ ok: false, reason: 'no-token' });
    expect(await adminPutHolidayYear(options, HOLIDAY_PAYLOAD)).toEqual({
      ok: false,
      reason: 'no-token',
    });
    expect(await adminDeleteHolidayYear(options, 2027)).toEqual({ ok: false, reason: 'no-token' });
    // 这条是"第二份 fetch 会带出第二份令牌闸"的正面答案：新动词走的还是同一条短路。
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'invalid'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [500, 'server'],
  ] as const)('PUT 遇到 HTTP %i ⇒ %s（失败原因与读面同一套词表）', async (status, reason) => {
    const fetchImpl = stubResponse(status, { error: 'x' });
    const result = await adminPutHolidayYear(withFetch(fetchImpl), HOLIDAY_PAYLOAD);
    expect(result).toEqual({ ok: false, reason, status });
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * 🔴 409 与"服务端给的原因码" —— ADR-0053 §5 第 11 条要求接界面时**第一件事**就是这一格。
 *
 * 三元组 `{ok:false, reason, status}` 里的 `reason` 是 **HTTP 层**的原因，它答不了
 * "这一单为什么不能退"。退款恰恰是必须告诉运营**为什么**的操作：把 `WINDOW_PASSED`
 * 折成一句"服务端错误"，运营会去改参数重试，而改参数永远改不动"这一单已经过了 7 天"。
 *
 * 变异验证：把 `adminRequest` 里那次 `readServerReason` 拿掉（或把 409 折回 `server`），
 * 下面前三条各自转红。
 * ──────────────────────────────────────────────────────────────────────── */
describe('🔴 409 是可区分的原因，而且响应体里的业务码到得了调用方', () => {
  it('409 ⇒ conflict，不是 server（下一步是换动作，不是重试）', async () => {
    const fetchImpl = stubResponse(409, { error: 'Refund not allowed.', reason: 'WINDOW_PASSED' });

    const result = await adminCreateRefundRequest(withFetch(fetchImpl), { orderId: 3, note: 'x' });

    expect(result).toEqual({
      ok: false,
      reason: 'conflict',
      status: 409,
      serverReason: 'WINDOW_PASSED',
    });
  });

  it('409 而体里**没有** reason ⇒ 不带 serverReason（界面不许编一个原因）', async () => {
    const fetchImpl = stubResponse(409, { error: 'Refund already decided or finished.' });

    const result = await adminApproveRefund(withFetch(fetchImpl), 12, '批准');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.serverReason).toBeUndefined();
  });

  it('非 2xx 的体不是 JSON（反代给的 HTML 那一类）⇒ 不抛，按状态码说话', async () => {
    const fetchImpl = stubResponse(409, undefined, false);

    const result = await adminRejectRefund(withFetch(fetchImpl), 12, '驳回');

    expect(result).toEqual({ ok: false, reason: 'conflict', status: 409 });
  });

  it('体里的 reason 长得不像业务码 ⇒ 当没给（这一格要进 DOM，得有上界）', async () => {
    const fetchImpl = stubResponse(409, { reason: 'x'.repeat(200) });

    const result = await adminApproveRefund(withFetch(fetchImpl), 12, '批准');

    if (!result.ok) expect(result.serverReason).toBeUndefined();
    else throw new Error('测试前提不成立：409 不该被读成成功');
  });

  it('201 的成功路径**不**去读失败体（serverReason 只属于失败那一支）', async () => {
    const fetchImpl = stubResponse(201, {
      ok: true,
      outcome: 'requested',
      refundId: 12,
      outRefundNo: 'hyrf3x1x9',
      amountMinor: 4000,
    });

    const result = await adminCreateRefundRequest(withFetch(fetchImpl), { orderId: 3 });

    expect(result.ok).toBe(true);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * 退款四条端点的传输形状（服务端：`server/src/admin/admin.routes.ts`）。
 *
 * 钉的是"发出去的是什么"，不是"这一单该不该退" —— 后者只有一份，在服务端。
 * ──────────────────────────────────────────────────────────────────────── */
const REFUND_ROW = {
  id: 12,
  orderId: 3,
  userId: 7,
  provider: 'wechat',
  outRefundNo: 'hyrf3x1x9',
  amountMinor: 4000,
  currency: 'CNY',
  periodDays: 30,
  status: 'requested',
};

describe('退款四条端点的传输形状', () => {
  it('GET /refunds 把 userId 与 limit 拼进查询串，响应体原样交出', async () => {
    const fetchImpl = stubResponse(200, { refunds: [REFUND_ROW] });

    const result = await fetchAdminRefunds(withFetch(fetchImpl), { userId: 7, limit: 50 });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}${ADMIN_API_PREFIX}/refunds?userId=7&limit=50`);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(result).toEqual({ ok: true, data: { refunds: [REFUND_ROW] } });
  });

  it('GET /refunds 不带筛选时查询串是空的（服务端自己有默认 limit）', async () => {
    const fetchImpl = stubResponse(200, { refunds: [] });

    await fetchAdminRefunds(withFetch(fetchImpl));

    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe(`${BASE}${ADMIN_API_PREFIX}/refunds`);
  });

  it('POST /refunds 的载荷只有服务端认识的那三个键（金额与天数**没有**旋钮）', async () => {
    const fetchImpl = stubResponse(201, {
      ok: true,
      outcome: 'requested',
      refundId: 12,
      outRefundNo: 'hyrf3x1x9',
      amountMinor: 4000,
    });

    await adminCreateRefundRequest(withFetch(fetchImpl), {
      orderId: 3,
      note: '用户申请',
      operatorApproved: true,
    });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}${ADMIN_API_PREFIX}/refunds`);
    expect(init.method).toBe('POST');
    // 🔴 这条钉的是"客户端**没有**偷偷加一个金额或天数字段"。退款金额只能等于
    // 结算冻下的实付、天数只能等于授予那一段（ADR-0053 §3 选项 E 被否的理由就是
    // "第二个事实源"）—— 一旦界面能填，那三条 CHECK 就退化成装饰。
    expect(JSON.parse(String(init.body))).toEqual({
      orderId: 3,
      note: '用户申请',
      operatorApproved: true,
    });
  });

  it('approve 与 reject 打在 /refunds/:id/{approve,reject}，body 只有 note', async () => {
    const approve = stubResponse(200, { ok: true, outcome: 'submitted', status: 'processing', providerRefundId: '503' });
    await adminApproveRefund(withFetch(approve), 12, '批准');
    const [approveUrl, approveInit] = approve.mock.calls[0] as [string, RequestInit];
    expect(approveUrl).toBe(`${BASE}${ADMIN_API_PREFIX}/refunds/12/approve`);
    expect(approveInit.method).toBe('POST');
    expect(JSON.parse(String(approveInit.body))).toEqual({ note: '批准' });

    const reject = stubResponse(200, { ok: true, outcome: 'decided', status: 'rejected' });
    await adminRejectRefund(withFetch(reject), 12, '驳回');
    const [rejectUrl] = reject.mock.calls[0] as [string];
    expect(rejectUrl).toBe(`${BASE}${ADMIN_API_PREFIX}/refunds/12/reject`);
  });

  it('🔴 未登录时四条端点一个请求都不发（退款写面与读面同一道闸）', async () => {
    const fetchImpl = stubResponse(200, {});
    const options = withFetch(fetchImpl, { getToken: async () => undefined });

    expect(await fetchAdminRefunds(options)).toEqual({ ok: false, reason: 'no-token' });
    expect(await adminCreateRefundRequest(options, { orderId: 3 })).toEqual({
      ok: false,
      reason: 'no-token',
    });
    expect(await adminApproveRefund(options, 12, '批准')).toEqual({ ok: false, reason: 'no-token' });
    expect(await adminRejectRefund(options, 12, '驳回')).toEqual({ ok: false, reason: 'no-token' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
