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

/* ──────────────────────────────────────────────────────────────────────────
 * 下面两组是真浏览器那一支（`e2e/tests/admin-console.spec.ts`）查出来的
 * 两条缺陷的回归判据。它们钉的是**修好之后**的行为 —— 拿掉修复就会红，
 * 而不是把当时的错误行为钉成期望。
 * ────────────────────────────────────────────────────────────────────────── */

const T0 = Date.UTC(2026, 8, 20, 4, 0, 0);

function json(body: unknown): Response {
  return { status: 200, ok: true, json: () => Promise.resolve(body) } as unknown as Response;
}

/** 那一行有三种可读出来的状态，假服务端必须每一种都能扮演。 */
const NO_CONSENT = { termsAcceptedAt: null, termsDocumentVersion: null };
/** 2026-10-02 生产上真实落库的那一枚指纹（L4 实跑从那一行读回来的形状）。 */
const FINGERPRINT = [
  'ai-and-transfer@1.0',
  'data-rights@1.1',
  'minors@1.1',
  'permissions@1.0',
  'personal-info-list@1.0',
  'privacy@1.1',
  'subscription-refund@1.0',
  'terms@1.1',
  'third-parties@1.0',
].join(';');

/**
 * 一台**带状态**的假服务端：`/users/7/unlock` 真的把 `locked` 改掉。
 *
 * 🔴 这是"界面显示的是服务端的新值"唯一可行的证法 —— 如果假服务端自己不变，
 * 那么一个只改本地副本的实现也能让断言通过（§7 第 50 条）。
 */
function stubAdminServer(
  consent: { termsAcceptedAt: number | null; termsDocumentVersion: string | null } = NO_CONSENT,
): { locked: boolean; listFetches: number } {
  const state = { locked: true, listFetches: 0 };
  fetchMock = vi.fn((url: string) => {
    const path = url.replace(/^.*\/api\/admin/, '').split('?')[0];
    if (path === '/overview') return Promise.resolve(json(OVERVIEW));
    if (path === '/users') {
      state.listFetches += 1;
      return Promise.resolve(
        json({
          items: [userRow(state.locked)],
          total: 1,
          limit: 50,
          offset: 0,
        }),
      );
    }
    if (path === '/users/7') {
      return Promise.resolve(
        json({
          user: {
            ...userRow(state.locked),
            failedLoginAttempts: 5,
            tokenVersion: 3,
            ...consent,
          },
          counts: { passkeys: 2, operations: 41, notifications: 3 },
          subscriptions: [],
          orders: [],
          devices: [],
        }),
      );
    }
    if (path === '/users/7/unlock') {
      state.locked = false;
      return Promise.resolve(json({ ok: true }));
    }
    if (path === '/invites') {
      return Promise.resolve(
        json({
          codes: {
            items: [
              {
                id: 31,
                code: 'ABCD2345',
                disabled: false,
                createdAt: T0,
                userId: 1,
                email: 'boss@example.test',
              },
            ],
            total: 4,
            limit: 50,
            offset: 0,
          },
          referrals: {
            items: [
              {
                id: 41,
                code: 'ABCD2345',
                createdAt: T0,
                activatedAt: T0 + 1,
                rewardDays: 5,
                rewardedAt: T0 + 1,
                inviter: { id: 1, email: 'boss@example.test' },
                invitee: { id: 9, email: 'newcomer@example.test' },
              },
            ],
            total: 2,
            limit: 50,
            offset: 0,
          },
        }),
      );
    }
    return Promise.resolve(json({ items: [], total: 0, limit: 50, offset: 0 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return state;
}

function userRow(locked: boolean) {
  return {
    id: 7,
    email: 'locked@example.test',
    isVerified: true,
    isAdmin: false,
    locked,
    lockedUntil: locked ? T0 : null,
    createdAt: T0,
    storageUsedBytes: 100,
    storageQuotaBytes: 104_857_600,
  };
}

/** 让 store 里那条 POST → GET → GET 的链子跑完（微任务在 timer 之前清空）。 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

async function clickByTestId(el: HTMLElement, testId: string, text: string): Promise<void> {
  const target = [...el.querySelectorAll(`[data-testid="${testId}"] button`)].find((button) =>
    (button.textContent ?? '').includes(text),
  );
  if (target === undefined) throw new Error(`找不到 ${testId} 里的「${text}」`);
  await act(async () => {
    (target as HTMLButtonElement).click();
  });
  await flush();
}

async function clickTab(el: HTMLElement, label: string): Promise<void> {
  const tab = [...el.querySelectorAll('[role="tab"]')].find((entry) => entry.textContent === label);
  if (tab === undefined) throw new Error(`找不到标签页「${label}」`);
  await act(async () => {
    (tab as HTMLButtonElement).click();
  });
  await flush();
}

describe('🔴 邀请页必须把响应的两面都渲染出来', () => {
  it('codes.items 非空 ⇒ 界面上有邀请码列表（缺陷：拉回来却一块都不渲染）', async () => {
    stubAdminServer();
    const el = await renderPanel();
    await clickTab(el, '邀请');

    const codes = el.querySelector('[data-testid="admin-codes"]');
    expect(codes).not.toBeNull();
    expect(codes!.textContent).toContain('ABCD2345');
    expect(codes!.textContent).toContain('boss@example.test');
    // 新列表不该把原有那一面挤掉。
    expect(el.querySelector('[data-testid="admin-referrals"]')!.textContent).toContain(
      'newcomer@example.test',
    );
  });
});

describe('🔴 动作之后，列表与详情都要重新读回服务端', () => {
  it('解锁后，用户列表那一行的「已锁定」徽标必须消失', async () => {
    const state = stubAdminServer();
    const el = await renderPanel();
    await clickTab(el, '用户');

    const badge = () =>
      [...el.querySelectorAll('[data-testid="admin-users"] .ht-settings__admin-badge')].filter(
        (node) => (node.textContent ?? '').includes('已锁定'),
      );
    expect(badge()).toHaveLength(1);
    expect(state.listFetches).toBe(1);

    await clickByTestId(el, 'admin-users', 'locked@example.test'); // 打开详情
    const detail = el.querySelector('[data-testid="admin-user-detail"]');
    expect(detail).not.toBeNull();
    await clickIn(detail as HTMLElement, '解锁账号');

    // 🔴 判据在这里：徽标消失**只能**来自第二次列表请求（假服务端真的解了锁）。
    // 拿掉 `reloadAfterUserAction` 里那句 `loadUsers` ⇒ 这里仍是 1 个徽标 ⇒ 红。
    expect(badge()).toHaveLength(0);
    expect(state.listFetches, '动作后必须重新拉列表，否则那一行停在旧值').toBe(2);
  });
});

/**
 * 🔴 G-36①：同意留痕那一行**必须被钉住**。
 *
 * 对外文本（`terms.ts`）承诺"注册时记下的是一整套版本指纹"，而这一行是那句
 * 承诺**唯一面向运营者的出口**。库里和 API 都能答"哪一版"，界面上没有那一行
 * 就等于没有 —— 而"没有那一行"这件事**没有任何一层会报错**，除非有人钉住它。
 *
 * 三条用例各钉一种可读出来的状态，关键在**后两条必须互不相同**：
 * "根本没同意"与"同意了但证明不了版本"混成一句，就是让运营者替数据库说谎。
 */
describe('🔴 同意留痕那一行', () => {
  async function openDetail(
    consent: { termsAcceptedAt: number | null; termsDocumentVersion: string | null },
  ): Promise<string | null> {
    stubAdminServer(consent);
    const el = await renderPanel();
    await clickTab(el, '用户');
    await clickByTestId(el, 'admin-users', 'locked@example.test');
    const row = el.querySelector('[data-testid="admin-user-consent"]');
    return row?.textContent ?? null;
  }

  it('没有同意记录 ⇒ 说"没有"，且不许出现"版本无法证明"', async () => {
    const text = await openDetail(NO_CONSENT);
    expect(text).not.toBeNull();
    expect(text).toContain('同意留痕');
    expect(text).toContain('没有同意记录');
    expect(text).not.toContain('版本无法证明');
  });

  it('有时间也有指纹 ⇒ 两个值逐字出现在同一行（这就是那条证据）', async () => {
    const text = await openDetail({ termsAcceptedAt: T0, termsDocumentVersion: FINGERPRINT });
    expect(text).toContain(FINGERPRINT);
    expect(text).not.toContain('没有同意记录');
    expect(text).not.toContain('版本无法证明');
  });

  it('有时间但没有指纹 ⇒ 单独一句"版本无法证明"，且不冒充成没同意', async () => {
    const text = await openDetail({ termsAcceptedAt: T0, termsDocumentVersion: null });
    expect(text).toContain('版本无法证明');
    expect(text).not.toContain('没有同意记录');
    // 不许把空指纹渲染成一个假的版本号（`undefined` 漏进模板也是这一类）。
    expect(text).not.toMatch(/@1\.\d/);
    expect(text).not.toContain('undefined');
  });
});

/** 在详情面板里按文字找按钮并点它（三个动作的控件都只在详情里）。 */
async function clickIn(scope: HTMLElement, text: string): Promise<void> {
  const button = [...scope.querySelectorAll('button')].find((node) =>
    (node.textContent ?? '').includes(text),
  );
  if (button === undefined) throw new Error(`找不到按钮「${text}」`);
  await act(async () => {
    (button as HTMLButtonElement).click();
  });
  await flush();
}
