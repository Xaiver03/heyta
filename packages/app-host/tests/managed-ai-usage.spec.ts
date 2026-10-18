/**
 * `fetchManagedAiUsage` —— 法务 §5.3「设置页可以查到本周期已用 X / 300 次」的传输层。
 *
 * 这一组钉的是**四种读数不许被混成一种**：
 * `unconfigured`（没配服务器）/ `unavailable`（配了没读到）/ `ok + entitled:false`
 * （没有这一期）/ `ok + entitled:true`（真的有）。
 * 混掉任意两种，界面就会说反话 —— 而**说反话的界面没有任何一层会报错**。
 */
import { describe, expect, it, vi } from 'vitest';

import { MANAGED_AI_USAGE_PATH, fetchManagedAiUsage } from '../src/managed-ai-usage.js';

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const probe = (overrides: Partial<Parameters<typeof fetchManagedAiUsage>[0]> = {}) => ({
  baseUrl: 'https://heyta.waytofuture.cn',
  getToken: async () => 'T0K',
  ...overrides,
});

describe('fetchManagedAiUsage', () => {
  it('没配服务器 ⇒ `unconfigured`，且**一个请求都不发**', async () => {
    const fetchImpl = vi.fn();
    const out = await fetchManagedAiUsage(
      probe({ baseUrl: '   ', fetchImpl: fetchImpl as unknown as typeof fetch }),
    );
    expect(out.kind).toBe('unconfigured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('✅ 读到了 ⇒ `ok`，数原样带出', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({ used: 7, limit: 300, periodAnchor: 1762592000000, entitled: true }),
    );
    const out = await fetchManagedAiUsage(
      probe({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    );

    expect(out).toEqual({
      kind: 'ok',
      used: 7,
      limit: 300,
      periodAnchor: 1762592000000,
      entitled: true,
    });
    // 打的是读路由、带 Bearer、且**没有 body**
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://heyta.waytofuture.cn${MANAGED_AI_USAGE_PATH}`);
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({ authorization: 'Bearer T0K' });
    expect('body' in init).toBe(false);
  });

  it('🔴 没登录 / 取令牌抛 ⇒ `unavailable:no-token`（不是 0/300，也不是崩溃）', async () => {
    for (const getToken of [async () => undefined, async () => '', async () => { throw new Error('锁着'); }]) {
      const out = await fetchManagedAiUsage(probe({ getToken }));
      expect(out).toEqual({ kind: 'unavailable', cause: 'no-token' });
    }
  });

  it('🔴 断网 ⇒ `unavailable:network`（不许抛穿）', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    const out = await fetchManagedAiUsage(
      probe({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    );
    expect(out).toEqual({ kind: 'unavailable', cause: 'network' });
  });

  it('HTTP 非 2xx ⇒ `unavailable:http`', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ error: 'x' }, 402));
    const out = await fetchManagedAiUsage(
      probe({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    );
    expect(out).toEqual({ kind: 'unavailable', cause: 'http' });
  });

  it('🔴 响应体不是 JSON / 字段不对 ⇒ `unavailable:malformed`（不许 `as` 一下就信）', async () => {
    const cases: unknown[] = [
      'not json',
      {},
      { used: '7', limit: 300, entitled: true },
      { used: 7, limit: 300, entitled: 'yes' },
      { used: -1, limit: 300, entitled: true },
      { used: 1.5, limit: 300, entitled: true },
      { used: 7, limit: 300, entitled: true, periodAnchor: 'x' },
    ];
    for (const body of cases) {
      const fetchImpl = vi.fn().mockResolvedValue(
        typeof body === 'string'
          ? new Response(body, { status: 200 })
          : ok(body),
      );
      const out = await fetchManagedAiUsage(
        probe({ fetchImpl: fetchImpl as unknown as typeof fetch }),
      );
      expect(out.kind, JSON.stringify(body)).toBe('unavailable');
      if (out.kind === 'unavailable') expect(out.cause).toBe('malformed');
    }
  });

  it('🔴 `entitled:false` 与「这一期还没用过」**不是同一件事**：两者都能读出来，由界面分开渲染', async () => {
    const notEntitled = vi.fn().mockResolvedValue(
      ok({ used: 0, limit: 300, periodAnchor: null, entitled: false }),
    );
    const fresh = vi.fn().mockResolvedValue(
      ok({ used: 0, limit: 300, periodAnchor: 1762592000000, entitled: true }),
    );

    expect(await fetchManagedAiUsage(probe({ fetchImpl: notEntitled as unknown as typeof fetch }))).toMatchObject(
      { kind: 'ok', entitled: false },
    );
    expect(await fetchManagedAiUsage(probe({ fetchImpl: fresh as unknown as typeof fetch }))).toMatchObject(
      { kind: 'ok', entitled: true },
    );
  });
});
