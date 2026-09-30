/**
 * 管理后台面板的界面测试。
 * ==========================
 *
 * 这里钉住的是**"谁能看见这个面板"**，而不是"表格画得好不好看"：
 *
 *   1. 🔴 **未登录时一个请求都不发**，面板不渲染 —— 设置页是所有用户都会打开的，
 *      不加这道闸，每个未登录访客都会往 `/api/admin/overview` 打一发 401；
 *   2. 🔴 **403（不是管理员）时什么都不渲染** —— 普通用户不该在设置页里
 *      看到一个点进去全是 403 的面板；
 *   3. 是管理员时才渲染，并把概览数字显示出来；
 *   4. 断网 / 服务端 5xx 也**不渲染**（而不是渲染一个红框给所有人看）。
 *
 * ⚠️ 这些断言**不是安全判据** —— 它们只证明"界面没多出来一块"。
 * 真正的授权由服务端 `requireAdmin` 承担（ADR-0038 §4.3），
 * 那一条的证据在 `server/tests/admin-routes.spec.ts`。
 *
 * 全程走真实链路：真实 store + 真实 `@heyta/app-host` 客户端 + 被 stub 的 `fetch`。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@heyta/i18n';

import { AdminPanel } from '../src/features/admin/AdminPanel.js';
import { __resetAdminForTests } from '../src/features/admin/store.js';
import { useSyncStore } from '../src/features/sync/store.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let fetchMock: ReturnType<typeof vi.fn>;

/** 概览的最小合法响应。 */
const OVERVIEW = {
  users: { total: 42, verified: 40, admins: 1, locked: 2 },
  subscriptions: {
    total: 7,
    active: 5,
    entitledStatuses: ['active'],
    byStatus: [{ status: 'active', count: 5 }],
  },
  orders: {
    total: 9,
    byStatus: [{ status: 'paid', count: 9 }],
    paidByCurrency: [{ currency: 'CNY', paidOrders: 9, revenueMinor: 12_300 }],
  },
  coupons: { total: 1, enabled: 1, settledRedemptions: 3 },
  invites: {
    codes: 4,
    codesDisabled: 0,
    referrals: 2,
    referralsActivated: 1,
    referralsRewarded: 1,
  },
};

/** 让 `fetch` 按 URL 后缀回不同响应。`overview` 之外的一律 200 空页。 */
function stubFetch(overviewStatus: number): void {
  fetchMock = vi.fn((url: string) => {
    const status = url.includes('/overview') ? overviewStatus : 200;
    const body = url.includes('/overview') ? OVERVIEW : { items: [], total: 0, limit: 50, offset: 0 };
    return Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
      json: () => Promise.resolve(body),
    } as unknown as Response);
  });
  vi.stubGlobal('fetch', fetchMock);
}

async function renderPanel(): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <I18nProvider locale="zh-CN">
        <AdminPanel />
      </I18nProvider>,
    );
    // 让挂载时的 probe 及其 promise 落定 —— 否则断言会看到初始（未探测）状态。
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

beforeEach(() => {
  __resetAdminForTests();
  useSyncStore.setState({ baseUrl: 'https://example.test', token: 'tok' });
});

afterEach(() => {
  if (root !== undefined) {
    act(() => {
      root!.unmount();
    });
    root = undefined;
  }
  container?.remove();
  container = undefined;
  vi.unstubAllGlobals();
  __resetAdminForTests();
});

describe('🔴 未登录：一个请求都不发', () => {
  it('没有令牌时面板不渲染，且 fetch 从未被调用', async () => {
    useSyncStore.setState({ baseUrl: 'https://example.test', token: undefined });
    stubFetch(200);

    const el = await renderPanel();

    expect(el.querySelector('[data-testid="admin-panel"]')).toBeNull();
    // "未登录不发请求"这条**规则本身**在 `@heyta/app-host` 的 admin-client 里
    // （`adminRequest` 先取令牌，取不到就直接返回 `no-token`）——
    // 那里有一条会因变异而转红的测试。
    // ⚠️ 我一开始把这条断言记在 store 的"提前 return"上，结果**把那段代码删掉
    //    测试依然全绿** —— 因为真正的闸在客户端。这正是"判据钉错了层"：
    //    断言看起来在保护一件事，其实保护的是另一件。所以这里保留它作为
    //    **端到端**的确认，规则的单点判据改在 admin-client 那一层。
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('🔴 不是管理员：什么都不渲染', () => {
  it('403 ⇒ 面板不出现', async () => {
    stubFetch(403);
    const el = await renderPanel();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-testid="admin-panel"]')).toBeNull();
    // 也不许把 403 渲染成一段给用户看的红字 —— 普通用户不该知道有这么个接口。
    expect(el.textContent ?? '').not.toContain('管理后台');
  });

  it('401（令牌过期）⇒ 面板不出现', async () => {
    stubFetch(401);
    const el = await renderPanel();
    expect(el.querySelector('[data-testid="admin-panel"]')).toBeNull();
  });
});

describe('失败不该被读成"权限被撤"以外的样子', () => {
  it('断网 ⇒ 不渲染（而不是渲染一个红框给所有人看）', async () => {
    fetchMock = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fetchMock);

    const el = await renderPanel();
    expect(el.querySelector('[data-testid="admin-panel"]')).toBeNull();
  });

  it('服务端 500 ⇒ 不渲染', async () => {
    stubFetch(500);
    const el = await renderPanel();
    expect(el.querySelector('[data-testid="admin-panel"]')).toBeNull();
  });
});

describe('是管理员：渲染面板与概览', () => {
  it('200 ⇒ 面板出现，概览数字是服务端给的那些', async () => {
    stubFetch(200);
    const el = await renderPanel();

    const panel = el.querySelector('[data-testid="admin-panel"]');
    expect(panel).not.toBeNull();

    const overview = el.querySelector('[data-testid="admin-overview"]');
    expect(overview).not.toBeNull();
    // 42 = 用户总数；123.00 CNY = 已付金额（12300 分）。
    expect(overview!.textContent).toContain('42');
    expect(overview!.textContent).toContain('123.00 CNY');
  });

  it('面板上有六个标签页，默认停在概览', async () => {
    stubFetch(200);
    const el = await renderPanel();

    const tabs = [...el.querySelectorAll('[role="tab"]')];
    expect(tabs).toHaveLength(6);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
  });

  it('切到「用户」标签会**另发一次**请求（概览那次不算）', async () => {
    stubFetch(200);
    const el = await renderPanel();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const usersTab = [...el.querySelectorAll('[role="tab"]')].find(
      (tab) => tab.textContent === '用户',
    );
    await act(async () => {
      (usersTab as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/api/admin/users');
  });
});
