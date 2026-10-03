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
  adminForceUserLogout,
  adminDeleteHolidayYear,
  adminPutHolidayYear,
  adminUnlockUser,
  fetchAdminHolidayYears,
  fetchAdminOverview,
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
