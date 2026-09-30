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
  adminUnlockUser,
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
