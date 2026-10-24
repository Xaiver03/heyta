/**
 * 用户侧公告读面的传输契约（`packages/app-host/src/announcement-client.ts`）。
 *
 * 这一份只回答一件事："现在有没有挂着的话"。所以它的判据也只有三条：
 *
 *   1. 🔴 **未配服务器 / 未登录 ⇒ 一个请求都不发。**
 *      这条和 `admin-client.ts` 是同一个立场，但**这里是另一把尺** ——
 *      两半代码不共用，所以任何一半被改掉都得自己红一次。
 *   2. 🔴 **这一侧不判"有效"**：请求打的是 `/active`，响应给什么就画什么。
 *      这里不许出现 `Date.now()` 与 `publishedAt` / `expiresAt` 的比较。
 *   3. 拉不到 ⇒ `ok: false`，界面据此**不画那一横条**。
 *      失败被分成四类只是留给调用方说话用，这一层不做重试也不排队。
 *
 * 变异验证：① 拿掉 `getToken` 的空值短路 ⇒ 第 1 组转红；
 * ② 把 `if (!response.ok)` 那行删掉（什么状态都当成功）⇒ 第 3 组转红；
 * ③ 把 URL 尾巴 `/active` 改成别的 ⇒ 第 2 组转红。
 */
import { describe, expect, it, vi, type Mock } from 'vitest';

import { fetchActiveAnnouncements, type AnnouncementClientOptions } from '../src/announcement-client.js';

const BASE = 'https://example.test';

function withFetch(fetchImpl: Mock, overrides: Partial<AnnouncementClientOptions> = {}): AnnouncementClientOptions {
  return {
    baseUrl: BASE,
    getToken: async () => 'tok',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    ...overrides,
  };
}

function stubResponse(status: number, body: unknown, jsonBreaks = false): Mock {
  return vi.fn(() =>
    Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
      json: () => (jsonBreaks ? Promise.reject(new Error('not json')) : Promise.resolve(body)),
    } as unknown as Response),
  );
}

describe('🔴 不发无谓的请求', () => {
  it('未配服务器（baseUrl 空）⇒ 不发请求', async () => {
    const fetchImpl = stubResponse(200, { announcements: [] });

    const result = await fetchActiveAnnouncements(withFetch(fetchImpl, { baseUrl: '   ' }));

    expect(result).toEqual({ ok: false, reason: 'unconfigured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('未登录（令牌缺失或空串）⇒ 不发请求', async () => {
    for (const getToken of [async () => undefined, async () => ''] as const) {
      const fetchImpl = stubResponse(200, { announcements: [] });
      const result = await fetchActiveAnnouncements(withFetch(fetchImpl, { getToken }));

      expect(result).toEqual({ ok: false, reason: 'no-token' });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });
});

describe('请求形状', () => {
  it('打的是 /api/announcements/active，带 Bearer', async () => {
    const fetchImpl = stubResponse(200, { announcements: [] });

    await fetchActiveAnnouncements(withFetch(fetchImpl));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    // 🔴 `/active` 是"这一条的答案由服务端判过有效期"的标记：服务端只挂了这一条
    // 用户侧读面，写成别的都会 404，而 404 在这层的形状是 `server` ⇒ 界面**不画那一横条**。
    // 也就是说这一格坏了没有报错、只有静默的"今天没有公告" —— 所以路径必须钉死在这里。
    expect(url).toBe(`${BASE}/api/announcements/active`);
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tok');
  });

  it('baseUrl 带尾斜杠也不双斜杠', async () => {
    const fetchImpl = stubResponse(200, { announcements: [] });

    await fetchActiveAnnouncements(withFetch(fetchImpl, { baseUrl: `${BASE}/` }));

    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe(`${BASE}/api/announcements/active`);
  });

  it('响应体原样交出（这一层不裁剪、不排序、不判有效期）', async () => {
    const announcements = [
      { id: 2, title: 'B', body: 'b', level: 'warning', publishedAt: 10, expiresAt: null },
      { id: 1, title: 'A', body: 'a', level: 'info', publishedAt: 5, expiresAt: 20 },
    ];
    const fetchImpl = stubResponse(200, { announcements });

    const result = await fetchActiveAnnouncements(withFetch(fetchImpl));

    expect(result).toEqual({ ok: true, announcements });
  });

  it('服务端漏了 announcements 字段 ⇒ 空数组（不是崩溃、也不是"没有过"）', async () => {
    const fetchImpl = stubResponse(200, {});

    const result = await fetchActiveAnnouncements(withFetch(fetchImpl));

    expect(result).toEqual({ ok: true, announcements: [] });
  });
});

describe('🔴 拉不到的四种原因（界面只有一句"不画"，但台账要分得开）', () => {
  it.each([[401], [403], [500], [503]])('HTTP %i ⇒ server', async (status) => {
    const fetchImpl = stubResponse(status, { error: 'x' });

    expect(await fetchActiveAnnouncements(withFetch(fetchImpl))).toEqual({ ok: false, reason: 'server' });
  });

  it('断网 ⇒ network（不是 server）', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error('offline')));

    expect(await fetchActiveAnnouncements(withFetch(fetchImpl))).toEqual({ ok: false, reason: 'network' });
  });

  it('2xx 但响应不是 JSON ⇒ server', async () => {
    const fetchImpl = stubResponse(200, undefined, true);

    expect(await fetchActiveAnnouncements(withFetch(fetchImpl))).toEqual({ ok: false, reason: 'server' });
  });
});
