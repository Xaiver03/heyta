/**
 * 「发放」那一格的判据（后台侧，ADR-0076）。
 * ==========================================
 *
 * 风险不在"能不能点"，在**界面会不会替服务端说一句它不知道的话**。五条各自的形状：
 *
 *   1. 🔴 **收回是两步**：第一次点一个请求都不发。它会让一个人立刻失去一项
 *      他现在能用的能力 —— 与公告下架、退款批准同一档（危险但可逆的那一级）。
 *   2. 🔴 **交付不了的那一档留在下拉里**，只多一个后缀。把它从列表里删掉 =
 *      把"现在发不了"说成"这一档不存在"，而那一格是**这一刻**的实例状态。
 *   3. 🔴 **天数上界念的是服务端随响应给的那个数**（这里故意用一个界面上
 *      绝对写不出来的 `1234`）。写死一份的话，下一次改上界就是两处不同步。
 *   4. 🔴 **三个动作打三条不同的端点**，而「免费升级」的请求体里**没有天数** ——
 *      那一条是"它一天都不加"这件事在界面上的唯一可见证明。
 *   5. 🔴 被 409 拒时说出**服务端给的那枚码对应的句子**，且**不清空表单**：
 *      运营改一格再点的应该是他刚填的那几格；把表单洗掉会让他忘了自己填过谁。
 *
 * ⚠️ 与 `admin-panel.spec.tsx` 同一告诫：这些不是安全判据。授权由服务端
 * `requireAdmin` 承担，三道闸门由 `server/tests/admin-subscription-grant.spec.ts` 钉。
 * 这一组只钉"界面说的话是不是服务端说的那句"。
 *
 * 变异验证（四臂）：把收回改成一步 ⇒ 第 1 条红；把不可交付的档位 `filter` 掉 ⇒ 第 2 条红；
 * 把 hint 里的 `{max}` 换成写死的 3650 ⇒ 第 3 条红；让 upgrade 复用 grant 那条端点 ⇒ 第 4 条红。
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
  subscriptions: { total: 1, active: 1, entitledStatuses: ['active'], byStatus: [] },
  orders: { total: 0, byStatus: [], paidByCurrency: [] },
  coupons: { total: 0, enabled: 0, settledRedemptions: 0 },
  invites: { codes: 0, codesDisabled: 0, referrals: 0, referralsActivated: 0, referralsRewarded: 0 },
};

const NOW = Date.now();
const DAY = 86_400_000;

/**
 * 🔴 一份**故意把上界改成非默认值**的档位投影。
 *
 * `1234` 不是随手挑的：它是一个人在界面上**永远写不出来**的数（真实上界是 3650）。
 * 如果哪一天 hint 里那个数被写死成 3650，这一条就会红 —— 而那正是本文件头第 3 条要防的。
 */
const SKUS_BODY = {
  skus: [
    { priceId: 'hosted-monthly', grants: ['hosting'], sellable: true },
    { priceId: 'hosted-ai-monthly', grants: ['hosting', 'ai', 'automation'], sellable: false },
  ],
  grantDaysMax: 1234,
};

const GRANT_ROWS_BODY = {
  items: [
    {
      id: 3,
      userId: 5,
      actorUserId: 1,
      action: 'grant',
      sku: 'hosted-ai-monthly',
      days: 30,
      grants: ['hosting', 'ai', 'automation'],
      beforePeriodEnd: null,
      afterPeriodEnd: NOW + 30 * DAY,
      reason: '内测授权',
      createdAt: NOW,
    },
    {
      id: 2,
      userId: 7,
      actorUserId: 1,
      action: 'revoke',
      sku: null,
      days: null,
      grants: [],
      beforePeriodEnd: NOW + 3 * DAY,
      afterPeriodEnd: NOW,
      reason: '内测结束',
      createdAt: NOW - 1000,
    },
  ],
  total: 2,
  limit: 50,
  offset: 0,
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

let GRANT_ROWS: unknown = GRANT_ROWS_BODY;
let GRANT_POST = { status: 200, body: { ok: true, subscription: {}, audit: {} } } as {
  status: number;
  body: unknown;
};

const okAll = (call: Call): { status: number; body: unknown } => {
  if (call.method !== 'GET') return GRANT_POST;
  if (call.url.includes('/skus')) return { status: 200, body: SKUS_BODY };
  // ⚠️ 判序是刻意的：`/subscriptions/grants` 里也含 `/subscriptions`，
  // 先判后者会让发放记录那一页拿到订阅列表，于是这一组测的是一个不存在的响应形状。
  if (call.url.includes('/subscriptions/grants')) return { status: 200, body: GRANT_ROWS };
  if (call.url.includes('/overview')) return { status: 200, body: OVERVIEW };
  return { status: 200, body: { items: [], total: 0, limit: 50, offset: 0 } };
};

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
  const tab = [...el.querySelectorAll('[role="tab"]')].find((node) => node.textContent === label);
  if (tab === undefined) throw new Error(`没有这个 tab：${label}`);
  await act(async () => {
    (tab as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** 按可见文字找一个按钮。 */
function buttonBy(label: string): HTMLButtonElement | undefined {
  const el = container;
  if (el === undefined) throw new Error('先渲染');
  return [...el.querySelectorAll('button')].find(
    (node) => (node.textContent ?? '').trim() === label,
  ) as HTMLButtonElement | undefined;
}

async function clickButton(label: string): Promise<void> {
  const button = buttonBy(label);
  if (button === undefined) throw new Error(`没有这个按钮：${label}`);
  await act(async () => {
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function setField(label: string, value: string): Promise<void> {
  const el = container;
  if (el === undefined) throw new Error('先渲染');
  const field = [...el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')].find(
    (node) => {
      const id = node.getAttribute('id');
      if (id === null) return false;
      const labelled = el.querySelector(`label[for="${id}"]`)?.textContent ?? '';
      return labelled.includes(label);
    },
  );
  if (field === undefined) throw new Error(`没有这个字段：${label}`);
  await act(async () => {
    // 🔴 React 用 value tracker 去重：直接写 `.value` 会被它当成"没变过"而**吞掉**，
    // 症状不是报错，是提交的载荷永远是空的（`{userId: 0, reason: ''}`）。
    // 必须走原型上的原生 setter，再派发事件 —— 与 `admin-announcements.spec.tsx`
    // 的 `setValue` 同一条坑、同一个解法。
    const proto =
      field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value);
    field.dispatchEvent(
      new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const posts = (calls: Call[]): Call[] => calls.filter((call) => call.method === 'POST');

beforeEach(() => {
  vi.clearAllMocks();
  GRANT_ROWS = GRANT_ROWS_BODY;
  GRANT_POST = { status: 200, body: { ok: true, subscription: {}, audit: {} } };
  __resetAdminForTests();
  useSyncStore.setState({ baseUrl: 'https://example.test', token: 'tok' });
});

afterEach(() => {
  root?.unmount();
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

describe('打开「发放」那一格', () => {
  it('tab 没点开之前，一个 `/skus` 请求都不发', async () => {
    const calls = stubFetch(okAll);
    await renderPanel();

    expect(calls.some((call) => call.url.includes('/skus'))).toBe(false);
    expect(calls.some((call) => call.url.includes('/subscriptions/grants'))).toBe(false);
  });

  it('点开时档位与发放记录**各读一次**（同一次进格子，两把 GET 并发）', async () => {
    const calls = stubFetch(okAll);
    await renderPanel();
    await clickTab('发放');

    expect(calls.filter((call) => call.url.includes('/skus'))).toHaveLength(1);
    expect(calls.filter((call) => call.url.includes('/subscriptions/grants'))).toHaveLength(1);
  });
});

describe('🔴 档位下拉里那一枚不可交付的档', () => {
  it('它**留在列表里**，并带一句"现在发不了"', async () => {
    stubFetch(okAll);
    await renderPanel();
    await clickTab('发放');

    const el = container as HTMLDivElement;
    const options = [...el.querySelectorAll('select option')].map((node) => node.textContent ?? '');
    const ai = options.find((text) => text.includes('hosted-ai-monthly'));

    expect(ai).toBeDefined();
    expect(ai).toContain('现在发不了');
    // 能发的那一档**不该**带这个后缀 —— 否则这句就等于没说什么。
    expect(options.find((text) => text.startsWith('hosted-monthly'))).not.toContain('现在发不了');
  });
});

describe('🔴 天数上界是服务端给的数', () => {
  it('提示里念的是响应里那个 `grantDaysMax`（这里是故意写不出的 1234）', async () => {
    stubFetch(okAll);
    await renderPanel();
    await clickTab('发放');

    const hint = (container as HTMLDivElement).querySelector('[data-testid="admin-grants-daysHint"]');
    expect(hint?.textContent).toContain('1234');
    expect(hint?.textContent).not.toContain('3650');
  });
});

describe('三个动作各打各的端点', () => {
  it('「赠送订阅」发 /grant，载荷四个键（没有 `grants`）', async () => {
    const calls = stubFetch(okAll);
    await renderPanel();
    await clickTab('发放');
    await setField('账号编号', '5');
    await setField('档位', 'hosted-ai-monthly');
    await setField('天数（只有「赠送」用得到）', '30');
    await setField('理由（会进发放记录）', '内测授权');

    await clickButton('赠送订阅');

    const sent = posts(calls).at(-1) as Call;
    expect(sent.url).toBe('https://example.test/api/admin/subscriptions/grant');
    expect(sent.body).toEqual({ userId: 5, sku: 'hosted-ai-monthly', days: 30, reason: '内测授权' });
  });

  it('🔴「免费升级」发 /upgrade，而且请求体里**没有 days**', async () => {
    const calls = stubFetch(okAll);
    await renderPanel();
    await clickTab('发放');
    await setField('账号编号', '5');
    await setField('档位', 'hosted-ai-monthly');
    // 天数那一格**填着** —— "升级不加天数"这件事必须由服务端那一条判据兜住，
    // 所以界面不许在这里替它把 days 抹掉（抹掉=界面在裁决），也**不许把它发出去**。
    await setField('天数（只有「赠送」用得到）', '30');
    await setField('理由（会进发放记录）', '内测授权');

    await clickButton('免费升级');

    const sent = posts(calls).at(-1) as Call;
    expect(sent.url).toBe('https://example.test/api/admin/subscriptions/upgrade');
    expect(Object.keys(sent.body as Record<string, unknown>)).not.toContain('days');
  });

  it('动作成功后**重新读回**档位与记录，而不是把返回的那一行本地拼进去', async () => {
    const calls = stubFetch(okAll);
    await renderPanel();
    await clickTab('发放');
    const readsBefore = calls.filter((call) => call.url.includes('/subscriptions/grants')).length;

    await setField('账号编号', '5');
    await setField('档位', 'hosted-monthly');
    await setField('天数（只有「赠送」用得到）', '7');
    await setField('理由（会进发放记录）', '续一周');
    await clickButton('赠送订阅');

    expect(
      calls.filter((call) => call.url.includes('/subscriptions/grants')).length,
    ).toBe(readsBefore + 1);
  });

  it('成功之后表单清空，回执说的是**这一个**动作', async () => {
    stubFetch(okAll);
    await renderPanel();
    await clickTab('发放');
    await setField('账号编号', '5');
    await setField('档位', 'hosted-monthly');
    await setField('天数（只有「赠送」用得到）', '7');
    await setField('理由（会进发放记录）', '续一周');
    await clickButton('赠送订阅');

    const el = container as HTMLDivElement;
    expect(
      (el.querySelector('[data-testid="admin-grants-notice"]')?.textContent ?? '').trim(),
    ).toBe('已发放：这个账号的赠送周期往后延了。');
    expect([...el.querySelectorAll('input')].every((node) => node.value === '')).toBe(true);
  });

  it('收回成功的回执不许念成"已发放"（三句话是三个人工动作）', async () => {
    stubFetch(okAll);
    await renderPanel();
    await clickTab('发放');
    await setField('账号编号', '5');
    await setField('理由（会进发放记录）', '内测结束');
    await clickButton('收回发放');
    await clickButton('收回会让这个账号立刻失去赠送那一份能力（已经付费的不动）。确认吗？');

    expect(
      (container as HTMLDivElement).querySelector('[data-testid="admin-grants-notice"]')?.textContent,
    ).toContain('已收回');
  });
});

describe('🔴 收回是两步', () => {
  it('第一次点「收回发放」一个请求都不发，只出确认', async () => {
    const calls = stubFetch(okAll);
    await renderPanel();
    await clickTab('发放');
    await setField('账号编号', '5');
    await setField('理由（会进发放记录）', '内测结束');

    await clickButton('收回发放');

    expect(posts(calls)).toHaveLength(0);
    expect(buttonBy('收回会让这个账号立刻失去赠送那一份能力（已经付费的不动）。确认吗？')).toBeDefined();
  });

  it('点「关闭」回到一步状态，仍然一个请求都没发', async () => {
    const calls = stubFetch(okAll);
    await renderPanel();
    await clickTab('发放');
    await setField('账号编号', '5');
    await setField('理由（会进发放记录）', '内测结束');

    await clickButton('收回发放');
    await clickButton('关闭');

    expect(posts(calls)).toHaveLength(0);
    expect(buttonBy('收回发放')).toBeDefined();
  });

  it('确认之后才打 /revoke，载荷只有 userId 与 reason', async () => {
    const calls = stubFetch(okAll);
    await renderPanel();
    await clickTab('发放');
    await setField('账号编号', '5');
    await setField('理由（会进发放记录）', '内测结束');

    await clickButton('收回发放');
    await clickButton('收回会让这个账号立刻失去赠送那一份能力（已经付费的不动）。确认吗？');

    const sent = posts(calls).at(-1) as Call;
    expect(sent.url).toBe('https://example.test/api/admin/subscriptions/revoke');
    expect(sent.body).toEqual({ userId: 5, reason: '内测结束' });
  });
});

describe('🔴 被 409 拒的时候', () => {
  it('说出服务端那枚码对应的那句话，而且**不清空表单**', async () => {
    GRANT_POST = {
      status: 409,
      body: { code: 'sku_not_deliverable', reason: 'SKU_NOT_DELIVERABLE', sku: 'hosted-ai-monthly' },
    };
    const calls = stubFetch(okAll);
    await renderPanel();
    await clickTab('发放');
    await setField('账号编号', '5');
    await setField('档位', 'hosted-ai-monthly');
    await setField('天数（只有「赠送」用得到）', '30');
    await setField('理由（会进发放记录）', '内测授权');

    await clickButton('赠送订阅');

    const notice = (container as HTMLDivElement).querySelector(
      '[data-testid="admin-grants-notice"]',
    )?.textContent;
    expect(notice).toContain('服务端拒了这一次');
    expect(notice).toContain('这一档现在交付不了');
    // 表单留着：运营改的应该是他刚填的那几格，而不是从头再填一遍账号编号。
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    const userField = [...(container as HTMLDivElement).querySelectorAll('input')].find(
      (node) => node.value === '5',
    );
    expect(userField).toBeDefined();
  });

  it('🔴 409 但服务端**没给码** ⇒ 界面只说"状态冲突"，不替它编一个原因', async () => {
    GRANT_POST = { status: 409, body: { code: 'no_active_grant' } };
    stubFetch(okAll);
    await renderPanel();
    await clickTab('发放');
    await setField('账号编号', '9');
    await setField('理由（会进发放记录）', '内测结束');

    await clickButton('收回发放');
    await clickButton('收回会让这个账号立刻失去赠送那一份能力（已经付费的不动）。确认吗？');

    const notice = (container as HTMLDivElement).querySelector(
      '[data-testid="admin-grants-notice"]',
    )?.textContent;
    expect(notice).toBe('这一条当前的状态不允许这个动作，具体原因见下方提示。');
  });

  it('词表外的码（服务端给了一句没登记过的码）⇒ 同样不许编原因', async () => {
    GRANT_POST = { status: 409, body: { code: 'x', reason: 'SOMETHING_NEW' } };
    stubFetch(okAll);
    await renderPanel();
    await clickTab('发放');
    await setField('账号编号', '9');
    await setField('理由（会进发放记录）', '内测结束');

    await clickButton('收回发放');
    await clickButton('收回会让这个账号立刻失去赠送那一份能力（已经付费的不动）。确认吗？');

    const notice = (container as HTMLDivElement).querySelector(
      '[data-testid="admin-grants-notice"]',
    )?.textContent;
    // `no_active_grant` 那一句里含"没有有效的发放行"。这一条断的是它**不该**出现。
    expect(notice).not.toContain('没有有效的发放行');
  });
});

describe('发放记录那一页', () => {
  it('🔴 每一行念出**理由与操作者**（少了这两样，它就退化成一条状态流水）', async () => {
    stubFetch(okAll);
    await renderPanel();
    await clickTab('发放');

    const text = (container as HTMLDivElement).querySelector('[data-testid="admin-grants-rows"]')
      ?.textContent;
    expect(text).toContain('内测授权');
    expect(text).toContain('操作者 #1');
    expect(text).toContain('赠送');
    expect(text).toContain('收回');
  });

  it('收回那一行**不显示档位**，而是说"不带档位"（那一档由它自己那条记录说）', async () => {
    stubFetch(okAll);
    await renderPanel();
    await clickTab('发放');

    const rows = [...(container as HTMLDivElement).querySelectorAll('.ht-settings__admin-row')];
    const revokeRow = rows.find((node) => node.textContent?.includes('内测结束'));
    expect(revokeRow?.textContent).toContain('不带档位');
  });

  it('一条记录都没有 ⇒ 走共享空态，不是一句"加载失败"', async () => {
    GRANT_ROWS = { items: [], total: 0, limit: 50, offset: 0 };
    stubFetch(okAll);
    await renderPanel();
    await clickTab('发放');

    const el = container as HTMLDivElement;
    expect(el.textContent).toContain('还没有过任何一条发放记录。');
    // 警告性的那句常驻说明**不许**因为没数据就消失（与公告那一格同一判据）。
    expect(el.querySelector('[data-testid="admin-grants-lead"]')).not.toBeNull();
  });

  it('500 ⇒ 界面说"服务端出错了"，不清空已有的行假装列表是空的', async () => {
    const calls = stubFetch((call) =>
      call.url.includes('/skus') || call.url.includes('/subscriptions/grants')
        ? { status: 500, body: {} }
        : okAll(call),
    );
    await renderPanel();
    await clickTab('发放');

    const el = container as HTMLDivElement;
    expect(el.textContent).toContain('服务端出错了');
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });
});
