/**
 * 营收看板那一格的判据。
 * ======================
 *
 * 这一格的全部风险都在"界面临时算了一个服务端没说过的数"，所以这里钉的是：
 *
 *   1. 🔴 **净收入是从响应体里念出来的，不是界面减出来的** ——
 *      用一个 `net ≠ paid − refunded` 的响应体来证。只断言"显示了 12.00"
 *      挡不住界面自己减一次：那种实现今天恰好也对，而"哪些退款算数"这个判定
 *      一旦在服务端改动（比如将来把部分退款的口径并进来），看板与对账就会
 *      安静地差一笔，没人知道是哪一侧错了。
 *   2. 切到这一格才发这一次请求，且**带着这台设备的时区偏移** ——
 *      日界按谁裁是一个会改变数字的参数，不传就等于让服务器猜。
 *   3. 换窗口 ⇒ 用新的 `days` 重拉（不是本地把旧数组截断）。
 *   4. 窗口里什么都没有 ⇒ 走**共享空态**，而不是显示一排 0
 *      （"没有"与"都是零"是两件事）。
 *
 * ⚠️ 与 `admin-panel.spec.tsx` 同一告诫：这些不是安全判据。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@heyta/i18n';

import { AdminPanel } from '../src/features/admin/AdminPanel.js';
import { __resetAdminForTests, useAdminStore } from '../src/features/admin/store.js';
import { useSyncStore } from '../src/features/sync/store.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let seen: string[];

const OVERVIEW = {
  users: { total: 3, verified: 3, admins: 1, locked: 0 },
  subscriptions: { total: 0, active: 0, entitledStatuses: ['active'], byStatus: [] },
  orders: { total: 0, byStatus: [], paidByCurrency: [] },
  coupons: { total: 0, enabled: 0, settledRedemptions: 0 },
  invites: { codes: 0, codesDisabled: 0, referrals: 0, referralsActivated: 0, referralsRewarded: 0 },
};

/**
 * 一份**故意自相矛盾**的营收响应：`12.00 − 5.00 ≠ 4.00`。
 *
 * 界面只要是自己减出来的，就会显示 `7.00` 而不是 `4.00` —— 那正是这一条要抓的。
 * 服务端真实会不会给这样的三元组不重要（它当然给自洽的），重要的是
 * **界面不许依赖它自洽**。
 */
const REVENUE = {
  window: { days: 90, offsetMinutes: 480, fromMs: 1, toMs: 2 },
  series: [
    {
      currency: 'CNY',
      totalPaidMinor: 1_200,
      totalRefundedMinor: 500,
      totalNetMinor: 400,
      totalPaidOrders: 7,
      totalRefundedOrders: 2,
      points: [
        { dayMs: 1_759_000_000_000, paidMinor: 1_200, refundedMinor: 500, paidOrders: 7, refundedOrders: 2 },
      ],
    },
  ],
};

const EMPTY_REVENUE = {
  window: { days: 90, offsetMinutes: 480, fromMs: 1, toMs: 2 },
  series: [],
};

function stubFetch(revenueBody: unknown): void {
  seen = [];
  const fetchMock = vi.fn((url: string) => {
    seen.push(url);
    const body = url.includes('/overview')
      ? OVERVIEW
      : url.includes('/revenue')
        ? revenueBody
        : { items: [], total: 0, limit: 50, offset: 0 };
    return Promise.resolve({
      status: 200,
      ok: true,
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
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return container;
}

async function clickTab(label: string): Promise<void> {
  const el = container;
  if (el === undefined) throw new Error('先渲染');
  const button = [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((node) =>
    node.textContent?.includes(label),
  );
  if (button === undefined) throw new Error(`找不到标签「${label}」`);
  await act(async () => {
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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

describe('营收那一格', () => {
  it('没切到这一格之前，一次 `/revenue` 都不发', async () => {
    stubFetch(REVENUE);
    await renderPanel();
    expect(seen.filter((url) => url.includes('/revenue'))).toHaveLength(0);
  });

  it('切过来才拉，且带上这台设备的时区偏移与窗口天数', async () => {
    stubFetch(REVENUE);
    await renderPanel();
    await clickTab('营收');

    const request = seen.find((url) => url.includes('/revenue'));
    expect(request).toBeDefined();
    const query = new URL(request!).searchParams;
    expect(query.get('days')).toBe('90');
    // `getTimezoneOffset()` 是"本地→UTC 要加多少分钟"，取反才是服务端那个 offsetMinutes。
    expect(query.get('offsetMinutes')).toBe(String(-new Date().getTimezoneOffset()));
  });

  it('🔴 净收入念的是服务端那个字段，不是界面减出来的', async () => {
    stubFetch(REVENUE);
    const el = await renderPanel();
    await clickTab('营收');

    const group = el.querySelector('[data-testid="admin-revenue-CNY"]');
    expect(group).not.toBeNull();
    // 4.00 = 服务端给的 `totalNetMinor`；7.00 = 界面自己 12.00 − 5.00 的结果。
    expect(group!.textContent).toContain('4.00 CNY');
    expect(group!.textContent).not.toContain('7.00');
    // 另外两格照原样念，证明这一条不是"随便显示了一个数"。
    expect(group!.textContent).toContain('12.00 CNY');
    expect(group!.textContent).toContain('5.00 CNY');
  });

  it('换窗口那一档 ⇒ 用新的 days 重拉，而不是本地截断', async () => {
    stubFetch(REVENUE);
    const el = await renderPanel();
    await clickTab('营收');

    const thirty = [...el.querySelectorAll<HTMLButtonElement>('[role="group"] button')].find(
      (node) => node.textContent?.includes('30'),
    );
    expect(thirty).toBeDefined();
    await act(async () => {
      thirty!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const last = seen.filter((url) => url.includes('/revenue')).at(-1);
    expect(new URL(last!).searchParams.get('days')).toBe('30');
    // 重拉期间界面不许留着上一窗口的读数：那是一句关于**另一个窗口**的话。
    expect(useAdminStore.getState().revenueDays).toBe(30);
  });

  it('窗口里什么都没有 ⇒ 走共享空态，而不是一排 0', async () => {
    stubFetch(EMPTY_REVENUE);
    const el = await renderPanel();
    await clickTab('营收');

    expect(el.textContent).toContain('这个窗口里没有进账，也没有退款');
    // 没有币种分组 ⇒ 也就没有任何一个金额被画成 0.00。
    expect(el.querySelector('[data-testid="admin-revenue-CNY"]')).toBeNull();
    expect(el.textContent).not.toContain('0.00');
  });
});
