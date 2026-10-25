/**
 * `/admin` 那个独立后台页的判据。
 * =================================
 *
 * 这里钉的三件事，各自挡的是不同的错法：
 *
 *   1. **地址判定是一整段相等，不是 `endsWith`** —— 后者会让自托管用户自己的
 *      某个 `…/admin` 路径把 heyta 切进后台壳；
 *   2. **管理员在这一页上看到的是同一份内容区**（不是第二个实现）——
 *      壳与内容分家之后两边会各自漂移，而 typecheck 抓不到；
 *   3. 🔴 **非管理员看到的是一句原因，不是一片空白** —— 这一页是有人**主动敲地址**
 *      进来的，空白会被读成"页面坏了"。设置页里那个壳对非管理员是 `return null`，
 *      那里合理（普通用户不该多看见一格），把那条规则照搬到这一页就是错。
 *
 * ⚠️ 与 `admin-panel.spec.tsx` 同一告诫：这些**不是安全判据**。
 * 授权在服务端 `requireAdmin`（ADR-0038 §4.3），证据在 `server/tests/admin-routes.spec.ts`。
 *
 * 全程真实链路：真实 store + 真实 `@heyta/app-host` 客户端 + 被 stub 的 `fetch`。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@heyta/i18n';

import { AdminConsolePage } from '../src/features/admin/AdminConsolePage.js';
import { isAdminConsolePath } from '../src/features/admin/route.js';
import { __resetAdminForTests, useAdminStore } from '../src/features/admin/store.js';
import { privacyConsentActions } from '../src/features/privacy/consent-gate.js';
import { useSyncStore } from '../src/features/sync/store.js';

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
  invites: { codes: 4, codesDisabled: 0, referrals: 2, referralsActivated: 1, referralsRewarded: 1 },
};

/**
 * 渲染这一页，并返回**它自己那一份**请求台账。
 *
 * 🔴 台账必须由这一枚函数造、由它返回。第一版是测试自己 `stubFetch(200, [])`
 * 再另拿一个 `seen` —— 两个数组不是同一个，于是"没登录 ⇒ 一个请求都不发"
 * 那条断言**恒真**（它数的是一个从没被写过的空数组），删掉短路逻辑它也照样绿。
 * 一条抓不住违规的判据比没有判据更糟：它会让下一个人以为这里有人守着。
 */
async function renderPage(
  overviewStatus = 200,
): Promise<{ el: HTMLDivElement; seen: string[]; root: Root }> {
  const seen: string[] = [];
  const fetchMock = vi.fn((url: string) => {
    seen.push(url);
    const isOverview = url.includes('/overview');
    const status = isOverview ? overviewStatus : 200;
    const body = isOverview
      ? OVERVIEW
      : {
          items: [
            {
              id: 1,
              email: 'a@b.test',
              createdAt: 1,
              lockedUntil: null,
              failedLoginAttempts: 0,
            },
          ],
          total: 1,
          limit: 50,
          offset: 0,
        };
    return Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
      json: () => Promise.resolve(body),
    } as unknown as Response);
  });
  vi.stubGlobal('fetch', fetchMock);

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider locale="zh-CN">
        <AdminConsolePage />
      </I18nProvider>,
    );
    // 排空挂载那一次 probe 的 promise 链（`getToken` 是 async ⇒ 至少两个微任务）。
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { el: container, seen, root };
}

/** 每次渲染都要被卸载掉：残留的 root 会把下一发的请求记到上一个用例的台账里。 */
const teardown: { el: HTMLDivElement; seen: string[]; root: Root }[] = [];

async function render(
  overviewStatus = 200,
): Promise<{ el: HTMLDivElement; seen: string[]; root: Root }> {
  const rendered = await renderPage(overviewStatus);
  teardown.push(rendered);
  return rendered;
}

describe('地址判定：一整段相等', () => {
  it.each(['/admin', '/admin/', '/admin//', '/app/admin', '/app/admin/'])('%s ⇒ 后台', (path) => {
    expect(isAdminConsolePath(path)).toBe(true);
  });

  /**
   * 🔴 这一组是这条判据的全部价值所在。
   * 把实现改成 `pathname.endsWith('/admin')`，上面那一组照样全绿，只有这里会红。
   */
  it.each(['/', '/app/', '/app', '/administration', '/team/admin', '/help/admin/topic', '/en/admin'])(
    '%s ⇒ 不是后台',
    (path) => {
      expect(isAdminConsolePath(path)).toBe(false);
    },
  );
});

describe('管理员在 /admin 上', () => {
  beforeEach(() => {
    __resetAdminForTests();
    // 走生产代码那一次同意，不往 localStorage 手写自造串。
    privacyConsentActions.accept();
    useSyncStore.setState({ baseUrl: 'https://example.test', token: 'tok' });
  });

  afterEach(() => {
    for (const item of teardown.splice(0)) {
      act(() => {
        item.root.unmount();
      });
      item.el.remove();
    }
    vi.unstubAllGlobals();
    __resetAdminForTests();
    // 同意状态是本进程的一份全局闸门，不撤回会漏给下一个文件。
    privacyConsentActions.revoke();
  });

  it('渲染壳：顶栏、十格侧栏、以及同一份内容区', async () => {
    const { el, seen } = await render(200);

    expect(el.querySelector('[data-testid="admin-console"]')).not.toBeNull();
    // 🔴 侧栏的**具体清单**，不是 `ADMIN_TABS.length`。
    // 拿清单自己当期望值的那一版是恒真的：从 `nav.ts` 里删掉一格，
    // "两个壳用的是同一份清单"这条断言照样绿 —— 而它要抓的恰恰是"某一边的壳少了一格"。
    const navLabels = [...el.querySelectorAll('.ht-settings__console-navItem')].map(
      (node) => node.textContent?.trim() ?? '',
    );
    expect(navLabels).toEqual([
      '概览',
      '用户',
      '订阅',
      // 2026-10-25：订阅赠予落地之后多出来的那一格（`nav.ts` 与 `AdminTab` 同批）。
      '发放',
      '订单',
      '优惠码',
      '邀请',
      '营收',
      '公告',
      '调休/补班',
      '退款',
    ]);
    // 内容区是 `AdminPanel` 本身（`chrome="console"`），不是第二份实现。
    expect(el.querySelector('[data-testid="admin-panel"]')).not.toBeNull();
    // 概览那一格按 `activeTab` 的初值画出来 —— 那个数字只可能来自服务端的响应体。
    expect(el.textContent).toContain('42');
    expect(seen.filter((url) => url.includes('/overview'))).toHaveLength(1);
  });

  it('设置页那排横向 tab 在这一页上不画（标题与导航由壳给）', async () => {
    const { el } = await render(200);
    expect(el.querySelector('.ht-settings__admin-tabs')).toBeNull();
  });

  it('点侧栏「用户」⇒ 切的是共享状态，并按需拉那一格', async () => {
    const { el, seen } = await render(200);

    const usersButton = Array.from(
      el.querySelectorAll<HTMLButtonElement>('.ht-settings__console-navItem'),
    ).find((node) => node.textContent?.includes('用户'));
    expect(usersButton).toBeDefined();

    await act(async () => {
      usersButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // 分区状态在 store（两个壳共用），不在组件的 useState 里。
    expect(useAdminStore.getState().activeTab).toBe('users');
    expect(usersButton!.getAttribute('aria-current')).toBe('page');
    // 这一发请求只可能由"切到用户那一格"引起。
    expect(seen.some((url) => url.includes('/api/admin/users'))).toBe(true);
  });

  it('「返回应用」指向构建期 base，不是写死的 /app/', async () => {
    const { el } = await render(200);
    const link = el.querySelector<HTMLAnchorElement>('.ht-settings__console-action[href]');
    expect(link?.getAttribute('href')).toBe(import.meta.env.BASE_URL);
  });
});

describe('🔴 非管理员 / 未登录在 /admin 上', () => {
  beforeEach(() => {
    __resetAdminForTests();
    // 走生产代码那一次同意，不往 localStorage 手写自造串。
    privacyConsentActions.accept();
    useSyncStore.setState({ baseUrl: 'https://example.test', token: 'tok' });
  });

  afterEach(() => {
    for (const item of teardown.splice(0)) {
      act(() => {
        item.root.unmount();
      });
      item.el.remove();
    }
    vi.unstubAllGlobals();
    __resetAdminForTests();
    // 同意状态是本进程的一份全局闸门，不撤回会漏给下一个文件。
    privacyConsentActions.revoke();
  });

  it('403 ⇒ 说明原因，且不渲染内容区', async () => {
    const { el } = await render(403);

    expect(el.querySelector('[data-testid="admin-console-status"]')).not.toBeNull();
    expect(el.textContent).toContain('当前账号没有管理后台权限');
    // 内容区那块**不许**出现（设置页里它是 null，这一页由状态块接管）。
    expect(el.querySelector('[data-testid="admin-panel"]')).toBeNull();
    // 导航仍然画：让人知道这个地址是干什么的，而不是撞上一堵墙。
    expect(el.querySelectorAll('.ht-settings__console-navItem').length).toBeGreaterThan(0);
  });

  it('没有令牌 ⇒ 一个后台请求都不发，并说明"尚未登录"', async () => {
    useSyncStore.setState({ token: undefined });
    const { el, seen } = await render(200);

    // 短路那条规则本身住在 `admin-client`，它的单点判据在
    // `packages/app-host/tests/admin-client.spec.ts`；这里只做端到端确认。
    expect(seen.filter((url) => url.includes('/api/admin'))).toHaveLength(0);
    expect(el.textContent).toContain('尚未登录');
  });

  it('🔴 未登录**且**地址也还没填（线上未登录那一屏的真实形状）⇒ 仍然只许说"尚未登录"', async () => {
    // 2026-10-25 线上取证抓到的：官方构建里 `baseUrl` 是账号态填进来的，
    // 所以没登录时它**必然**也是空 —— 而那一屏当时给的是
    // "没有配置服务器地址，管理后台不可用"，把一个人支去查一个没坏的配置。
    // 上面那条判据（地址在、令牌没）盖不住这一格：两格都为空时，
    // 谁先判就是谁说了算，而先判的必须是令牌。
    useSyncStore.setState({ baseUrl: '', token: undefined });
    const { el, seen } = await render(200);

    expect(seen.filter((url) => url.includes('/api/admin'))).toHaveLength(0);
    expect(el.textContent).toContain('尚未登录');
    expect(el.textContent).not.toContain('服务器地址');
  });
});

/**
 * 🔴 首启还没同意联网 —— 这一组是真浏览器那一趟抓出来的缺口，现在钉在快的那侧。
 *
 * `/admin` 是在 `App()` 的所有 hook **之后**才整棵换掉的：那个"该问就打开同意面板"
 * 的 effect 照样跑，而 `installConsentGatedFetch()` 挡的是整个 `window.fetch`。
 * 内容区一挂载就探测 ⇒ 探测被闸门挡下 ⇒ 界面停在「连不上服务器，请检查网络后重试」，
 * 而答完同意之后没有人再探一次。那句话是谎，真话是"你还没同意"。
 *
 * 修法不是"多探一次"，是**闸门放行之前不挂载会发请求的东西**
 * （`AdminConsolePage` 的 `useNetworkAllowed`）。
 */
describe('🔴 还没同意联网的 /admin', () => {
  beforeEach(() => {
    __resetAdminForTests();
    // 刻意**不** accept：这一组判的就是"没同意"那一个状态。
    privacyConsentActions.revoke();
    useSyncStore.setState({ baseUrl: 'https://example.test', token: 'tok' });
  });

  afterEach(() => {
    for (const item of teardown.splice(0)) {
      act(() => {
        item.root.unmount();
      });
      item.el.remove();
    }
    vi.unstubAllGlobals();
    __resetAdminForTests();
  });

  it('一个后台请求都不发', async () => {
    const { seen } = await render(200);
    expect(seen.filter((url) => url.includes('/api/admin'))).toHaveLength(0);
  });

  it('说的是"正在加载"，而不是"连不上服务器"', async () => {
    const { el } = await render(200);
    expect(el.textContent).toContain('正在加载');
    expect(el.textContent).not.toContain('连不上服务器');
    // 内容区没挂载 ⇒ 也没有管理员才看得见的那些数字。
    expect(el.querySelector('[data-testid="admin-panel"]')).toBeNull();
  });

  it('同意之后内容区才挂载，并在这一次才探测', async () => {
    const { el, seen } = await render(200);

    await act(async () => {
      privacyConsentActions.accept();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(el.querySelector('[data-testid="admin-panel"]')).not.toBeNull();
    expect(seen.filter((url) => url.includes('/overview'))).toHaveLength(1);
    expect(el.textContent).toContain('42');
  });
});
