/**
 * 运营公告那一格的判据（后台侧，ADR-0075）。
 * ==========================================
 *
 * 风险集中在两处，所以这里也只钉这两处：
 *
 *   1. 🔴 **状态徽标念的是服务端那个 `state`，不是界面比时钟比出来的。**
 *      用一个"时间戳和状态互相矛盾"的响应体来证：`publishedAt` 在未来、
 *      `expiresAt` 在过去，而服务端说 `state: 'active'` ⇒ 界面必须说「挂着」。
 *      这条为什么值得单独写：界面自己 `Date.now()` 一比就会造出**第二个裁决者**，
 *      症状是运营在后台看到「已过期」、用户那边还挂着（或反过来）。
 *      两处的时钟本来就不一样（浏览器 / 服务器 / 用户另一台设备），
 *      所以"只许有一个裁决者"在这里是可以被这样一次断言钉住的。
 *   2. 🔴 **下架是两步**：第一次点一个请求都不发。
 *      公告是明文发给**所有用户**的东西，点一下就消失没有回头路。
 *
 * 另外几条是形状：空列表走共享空态、明文警告常驻（不许因为没数据就消失）、
 * 空时刻 = 立刻（`NaN` 进 JSON 会变 `null`，服务端只会回一句没头没尾的 400）。
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

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

const OVERVIEW = {
  users: { total: 3, verified: 3, admins: 1, locked: 0 },
  subscriptions: { total: 0, active: 0, entitledStatuses: ['active'], byStatus: [] },
  orders: { total: 0, byStatus: [], paidByCurrency: [] },
  coupons: { total: 0, enabled: 0, settledRedemptions: 0 },
  invites: { codes: 0, codesDisabled: 0, referrals: 0, referralsActivated: 0, referralsRewarded: 0 },
};

/**
 * 🔴 一份**故意自相矛盾**的公告列表。
 *
 * 三条的时间戳分别"应该"是 expired / pending / pending，但服务端给的状态是
 * active / active / expired。界面若自己比时钟，就会念出与 `state` 不同的词。
 */
const NOW_MS = Date.now();
const ANNOUNCEMENTS_BODY = {
  now: NOW_MS,
  announcements: [
    {
      id: 3,
      title: '挂着的那条',
      body: '今晚维护。',
      level: 'warning',
      // 未来才发布 —— 界面按时间判会说「还没生效」。
      publishedAt: NOW_MS + 86_400_000,
      // 已经过期 —— 界面按时间判还会说「已过期」。
      expiresAt: NOW_MS - 86_400_000,
      createdBy: 1,
      createdAt: NOW_MS,
      updatedAt: NOW_MS,
      state: 'active',
    },
    {
      id: 2,
      title: '不过期那条',
      body: '新账号需要邀请码。',
      level: 'info',
      publishedAt: NOW_MS - 1000,
      expiresAt: null,
      createdBy: null,
      createdAt: NOW_MS,
      updatedAt: NOW_MS,
      state: 'active',
    },
    {
      id: 1,
      title: '早就发过的',
      body: '旧话。',
      level: 'info',
      // 刚发布一秒 —— 界面按时间判**不会**说它过期，但服务端说它过期了。
      publishedAt: NOW_MS - 1000,
      expiresAt: NOW_MS + 86_400_000,
      createdBy: 1,
      createdAt: NOW_MS,
      updatedAt: NOW_MS,
      state: 'expired',
    },
  ],
};

function stubFetch(responder: (call: Call) => { status: number; body: unknown }): Call[] {
  const calls: Call[] = [];
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    };
    calls.push(call);
    const { status, body } = responder(call);
    return Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
      json: () => Promise.resolve(body),
    } as unknown as Response);
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

let ANNOUNCEMENT_LIST: unknown = ANNOUNCEMENTS_BODY;

/** 除公告列表外都回 200 的那个默认应答器。 */
const okAll: (call: Call) => { status: number; body: unknown } = (call) => ({
  status: 200,
  body: call.url.includes('/overview')
    ? OVERVIEW
    : call.url.includes('/announcements')
      ? ANNOUNCEMENT_LIST
      : { items: [], total: 0, limit: 50, offset: 0 },
});

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

/** 点文本里含这一串的可点元素（按钮 / 提交）。 */
async function clickByText(label: string): Promise<void> {
  const el = container;
  if (el === undefined) throw new Error('先渲染');
  const node = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.includes(label),
  );
  if (node === undefined) throw new Error(`找不到按钮「${label}」`);
  await act(async () => {
    node.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function setValue(selector: string, value: string): void {
  const el = container!.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (el === null) throw new Error(`找不到 ${selector}`);
  act(() => {
    // React 用 value tracker 去重，直接改 `.value` 会被吞掉；走原生 setter 才触发 onChange。
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  __resetAdminForTests();
  useSyncStore.setState({ baseUrl: 'https://example.test', token: 'tok' });
  ANNOUNCEMENT_LIST = ANNOUNCEMENTS_BODY;
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

describe('公告那一格', () => {
  it('没切到这一格之前，一次 `/announcements` 都不发', async () => {
    const calls = stubFetch(okAll);
    await renderPanel();

    expect(calls.filter((c) => c.url.includes('/announcements'))).toHaveLength(0);
  });

  it('切过来才拉全量列表（GET，无 body）', async () => {
    const calls = stubFetch(okAll);
    await renderPanel();
    await clickTab('公告');

    const list = calls.filter((c) => c.url.includes('/admin/announcements') && c.method === 'GET');
    expect(list).toHaveLength(1);
    expect(list[0]!.body).toBeUndefined();
  });

  it('🔴 状态徽标念的是服务端 `state`，不是界面比时钟比出来的', async () => {
    const calls = stubFetch(okAll);
    const el = await renderPanel();
    await clickTab('公告');
    expect(calls.some((c) => c.url.includes('/announcements'))).toBe(true);

    const rows = [...el.querySelectorAll<HTMLElement>('.ht-settings__admin-row')];
    expect(rows).toHaveLength(3);

    const badge = (title: string): string => {
      const row = rows.find((r) => r.querySelector('.ht-settings__admin-rowMain')?.textContent === title);
      if (row === undefined) throw new Error(`找不到行「${title}」`);
      return row.querySelector('.ht-settings__admin-badge')?.textContent ?? '';
    };

    // 第 1 条：publishedAt 在未来 + expiresAt 在过去，界面自己比时钟的话
    // 无论往哪边比都会说「还没生效」或「已过期」。服务端说挂着 ⇒ 只能说挂着。
    expect(badge('挂着的那条')).toContain('挂着');
    expect(badge('挂着的那条')).not.toContain('还没生效');
    expect(badge('挂着的那条')).not.toContain('已过期');

    // 第 3 条反方向：时间上"还没过期"，服务端说已过期 ⇒ 界面必须跟着服务端。
    expect(badge('早就发过的')).toContain('已过期');
    expect(badge('早就发过的')).not.toContain('挂着');
  });

  it('🔴 下架是两步：第一次点「下架」一个请求都不发', async () => {
    const calls = stubFetch(okAll);
    await renderPanel();
    await clickTab('公告');

    const before = calls.length;
    await clickByText('下架');

    // 只出确认，不发 DELETE。
    expect(calls).toHaveLength(before);
    expect(container!.textContent).toContain('确认下架这一条？');
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);

    await clickByText('确认下架这一条？');

    const del = calls.filter((c) => c.method === 'DELETE');
    expect(del).toHaveLength(1);
    expect(del[0]!.url).toMatch(/\/api\/admin\/announcements\/3$/);
  });

  it('确认之后还能取消：点「关闭」不发 DELETE', async () => {
    const calls = stubFetch(okAll);
    await renderPanel();
    await clickTab('公告');

    await clickByText('下架');
    const before = calls.length;
    await clickByText('关闭');

    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    expect(calls).toHaveLength(before);
  });

  it('发布：时刻留空 ⇒ 发出去的是一个有限毫秒数（不是 NaN / null）', async () => {
    const calls = stubFetch(okAll);
    await renderPanel();
    await clickTab('公告');

    setValue('[aria-label="标题"]', '系统维护');
    setValue('[aria-label="正文"]', '今晚 22:00 起同步暂停约 20 分钟。');
    await clickByText('发布');

    const post = calls.find((c) => c.method === 'POST');
    expect(post).toBeDefined();
    expect(post!.body).toMatchObject({ title: '系统维护', level: 'info' });
    const payload = post!.body as { publishedAtMs: number; expiresAtMs?: number };
    expect(Number.isFinite(payload.publishedAtMs)).toBe(true);
    // 🔴 "不过期"是**没有这个键**，不是 `expiresAtMs: null`。
    // 混过去的那一条让服务端收下"过期时刻 = 0"，公告会在发布当场就消失。
    expect(payload).not.toHaveProperty('expiresAtMs');
  });

  it('发布之后重新拉列表，而不是把返回的那一行本地插进去', async () => {
    const calls = stubFetch(okAll);
    await renderPanel();
    await clickTab('公告');

    const readsBefore = calls.filter((c) => c.method === 'GET' && c.url.includes('/announcements')).length;
    setValue('[aria-label="标题"]', 'a');
    setValue('[aria-label="正文"]', 'b');
    await clickByText('发布');

    const readsAfter = calls.filter((c) => c.method === 'GET' && c.url.includes('/announcements')).length;
    // 🔴 写完之后**重新拉一次**：界面显示的是服务端存下来的样子
    // （含它算的 `state` 与它的长度裁剪），而不是 POST 响应里那一行原样插进列表。
    expect(readsAfter).toBe(readsBefore + 1);
    expect(useAdminStore.getState().announcementNotice).toBe('done');
  });

  it('服务端 400 ⇒ 那一格说「操作失败」，列表不清空', async () => {
    stubFetch((call) =>
      call.method === 'POST'
        ? { status: 400, body: { error: 'invalid' } }
        : okAll(call),
    );
    const el = await renderPanel();
    await clickTab('公告');

    setValue('[aria-label="标题"]', '   ');
    setValue('[aria-label="正文"]', 'b');
    await clickByText('发布');

    expect(el.querySelector('[data-testid="admin-announcements-notice"]')?.textContent).toContain('操作失败');
    // 列表还在：一次失败不许把已经读到的数据抹掉。
    expect(el.querySelectorAll('.ht-settings__admin-row')).toHaveLength(3);
    expect(useAdminStore.getState().announcementNotice).toBe('failed');
  });

  it('空列表 ⇒ 走共享空态那一句话，而不是一个空表格', async () => {
    ANNOUNCEMENT_LIST = { now: NOW_MS, announcements: [] };
    stubFetch(okAll);
    await renderPanel();
    await clickTab('公告');

    expect(container!.textContent).toContain('还没有公告。');
    expect(container!.querySelectorAll('.ht-settings__admin-row')).toHaveLength(0);
  });

  it('🔴 明文警告常驻：没有公告时它也还在（不许把约束藏进数据里）', async () => {
    ANNOUNCEMENT_LIST = { now: NOW_MS, announcements: [] };
    stubFetch(okAll);
    const el = await renderPanel();
    await clickTab('公告');

    const warning = el.querySelector('[data-testid="admin-announcements-plaintext"]');
    expect(warning).not.toBeNull();
    expect(warning!.textContent).toContain('明文');
    expect(warning!.textContent).toContain('端到端加密');
  });
});
