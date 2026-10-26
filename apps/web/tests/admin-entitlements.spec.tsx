/**
 * 用户详情里那份**并集能力读数**的判据。
 * ======================================
 *
 * 这一格唯一的风险是：界面拿到逐行以后**自己判一次**"他能不能用"。
 * 那就是第二套标准，而漂移的表现不是报错，是后台说"能用"而闸门说"不能用"
 * （或反过来）。服务端那一格（`admin.routes.ts::projectEntitlements`）调的就是
 * 守卫那批函数，所以这里要钉住的是**界面只念不判**：
 *
 *   1. 🔴 勾还是叉，只跟随服务端那个 `allowed`。给一条"带着来源但 `allowed: false`"
 *      的形状 ⇒ 必须念 ✕。这条就是"界面自己数行"的变异探针。
 *   2. 🔴 并集这件事在界面上要看得见：付费行已过期 + 赠送行还活着 ⇒ 一个 ✓，
 *      而且来源只念活着的那一行。
 *   3. 🔴 ✕ 后面跟的是**服务端那枚码对应的那句话**；码表外的码 ⇒ 什么都不补。
 *      「已到期」与「没订过任何档」是两件不同的人工动作（催续费 vs 发一份），
 *      合成一句"没有订阅"就是让运营猜。
 *   4. 🔴 `allowed: true` 而来源为空 —— 那是 `selfhost-online` 下的自动收集，
 *      它的判据是官方签发的票据，本机订阅行**不参与**。界面不许为了排版好看
 *      把它念成"订阅给的"。
 *   5. 来源里那枚 `provider` 码念成人看得懂的名字（`'admin-grant'` ⇒ 运营赠送），
 *      而这一条顺带钉住 `ADMIN_GRANT_PROVIDER` 改了名而词表没跟的情况。
 *
 * ⚠️ 与 `admin-panel.spec.tsx` 同一告诫：这些不是安全判据。授权由服务端
 * `requireAdmin` 承担，判定由 `server/tests/admin-entitlements.spec.ts` 钉。
 * 这一组只钉"界面念的是服务端判的那件事"。
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

const NOW = Date.now();
const DAY = 86_400_000;

const USER_ROW = {
  id: 5,
  email: 'someone@example.test',
  isVerified: true,
  isAdmin: false,
  locked: false,
  lockedUntil: null,
  createdAt: NOW,
  storageUsedBytes: 1024,
  storageQuotaBytes: 2048,
};

type EntitlementFixture = {
  capability: string;
  allowed: boolean;
  reason: string | null;
  sources: { provider: string | null; priceId: string | null; currentPeriodEnd: number | null }[];
};

const source = (
  provider: string | null,
  priceId: string | null,
  endAt: number | null,
): EntitlementFixture['sources'][number] => ({
  provider,
  priceId,
  currentPeriodEnd: endAt,
});

/** 当前这一组用的读数。每个 `it` 自己换它。 */
let ENTITLEMENTS: EntitlementFixture[] = [];

function stubFetch(): void {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url.includes('/users/5')) {
      return Promise.resolve(
        jsonResponse({
          user: {
            ...USER_ROW,
            failedLoginAttempts: 0,
            tokenVersion: 1,
            termsAcceptedAt: null,
            termsDocumentVersion: null,
          },
          counts: { passkeys: 0, operations: 0, notifications: 0 },
          subscriptions: [],
          entitlements: ENTITLEMENTS,
          orders: [],
          devices: [],
        }),
      );
    }
    if (url.includes('/users')) {
      return Promise.resolve(
        jsonResponse({ items: [USER_ROW], total: 1, limit: 50, offset: 0 }),
      );
    }
    if (url.includes('/overview')) {
      return Promise.resolve(
        jsonResponse({
          users: { total: 1, verified: 1, admins: 1, locked: 0 },
          subscriptions: { total: 0, active: 0, entitledStatuses: ['active'], byStatus: [] },
          orders: { total: 0, byStatus: [], paidByCurrency: [] },
          coupons: { total: 0, enabled: 0, settledRedemptions: 0 },
          invites: { codes: 0, codesDisabled: 0, referrals: 0, referralsActivated: 0, referralsRewarded: 0 },
        }),
      );
    }
    return Promise.resolve(jsonResponse({ items: [], total: 0, limit: 50, offset: 0 }));
  });
  vi.stubGlobal('fetch', fetchMock);
}

function jsonResponse(body: unknown): Response {
  return {
    status: 200,
    ok: true,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** 渲染到"用户详情已经打开"。 */
async function openUser(): Promise<HTMLDivElement> {
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
  const el = container;
  const tabs = [...el.querySelectorAll('[role="tab"]')];
  const usersTab = tabs.find((node) => node.textContent === '用户');
  if (usersTab === undefined) throw new Error('没有「用户」这一格');
  await act(async () => {
    (usersTab as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const row = [...el.querySelectorAll('button')].find((node) =>
    (node.textContent ?? '').includes('someone@example.test'),
  ) as HTMLButtonElement | undefined;
  if (row === undefined) throw new Error('用户列表里没有那一行');
  await act(async () => {
    row.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return el;
}

function entitlementLine(el: HTMLElement, capability: string): string | undefined {
  return el.querySelector(`[data-testid="admin-user-entitlement-${capability}"]`)?.textContent;
}

beforeEach(() => {
  vi.clearAllMocks();
  ENTITLEMENTS = [];
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

describe('🔴 界面只念不判', () => {
  it('带着来源而服务端说 ✕ ⇒ 仍然念 ✕（勾叉只跟随 `allowed`）', async () => {
    ENTITLEMENTS = [
      {
        capability: 'ai',
        // 服务端给这个形状是有意考验探针的：行在、能力在，但那一判没过
        // （例如状态是 `past_due`）。界面如果按"有没有来源"画勾，这条就红。
        allowed: false,
        reason: 'STATUS_NOT_ENTITLED',
        sources: [source('wechat', 'hosted-ai-monthly', NOW + 10 * DAY)],
      },
    ];
    stubFetch();
    const el = await openUser();

    expect(entitlementLine(el, 'ai')).toContain('✕');
    expect(entitlementLine(el, 'ai')).not.toContain('✓');
  });

  it('三档各一行，且带「此刻能用」这一句抬头', async () => {
    ENTITLEMENTS = [
      { capability: 'hosting', allowed: true, reason: null, sources: [source('wechat', 'hosted-monthly', NOW + 3 * DAY)] },
      { capability: 'ai', allowed: false, reason: 'GRANT_NOT_INCLUDED', sources: [] },
      { capability: 'automation', allowed: false, reason: 'GRANT_NOT_INCLUDED', sources: [] },
    ];
    stubFetch();
    const el = await openUser();

    expect(el.querySelector('[data-testid="admin-user-entitlements"]')?.textContent).toContain(
      '此刻能用',
    );
    for (const capability of ['hosting', 'ai', 'automation']) {
      expect(entitlementLine(el, capability)).toBeDefined();
    }
    expect(entitlementLine(el, 'hosting')).toContain('✓');
    expect(entitlementLine(el, 'ai')).toContain('他那一档不含这项');
  });
});

describe('🔴 并集这件事要在界面上看得见', () => {
  it('付费行已过期 + 赠送行还活着 ⇒ 一个 ✓，来源只念活着那一行', async () => {
    ENTITLEMENTS = [
      {
        capability: 'hosting',
        allowed: true,
        reason: null,
        sources: [source('admin-grant', 'hosted-monthly', NOW + 20 * DAY)],
      },
    ];
    stubFetch();
    const el = await openUser();

    const line = entitlementLine(el, 'hosting') ?? '';
    expect(line).toContain('✓');
    expect(line).toContain('运营赠送');
    // 来源为空的那一行不该出现在这里 —— 界面不许把"曾经有过"念成"现在有"。
    expect(line).not.toContain('没订过');
  });

  it('`allowed: true` 而来源为空 ⇒ 说"不来自本机订阅行"，不假称订阅给的', async () => {
    ENTITLEMENTS = [
      { capability: 'automation', allowed: true, reason: null, sources: [] },
    ];
    stubFetch();
    const el = await openUser();

    const line = entitlementLine(el, 'automation') ?? '';
    expect(line).toContain('✓');
    expect(line).toContain('不来自本机订阅行');
  });

  it('两行都给（同一次裁决下的两个来源）⇒ 两行都念出来', async () => {
    ENTITLEMENTS = [
      {
        capability: 'hosting',
        allowed: true,
        reason: null,
        sources: [
          source('wechat', 'hosted-monthly', NOW + 30 * DAY),
          source('invite', null, NOW + 5 * DAY),
        ],
      },
    ];
    stubFetch();
    const el = await openUser();

    const line = entitlementLine(el, 'hosting') ?? '';
    expect(line).toContain('微信支付');
    expect(line).toContain('邀请奖励');
  });
});

describe('🔴 ✕ 后面那句只能是服务端给的码对应的', () => {
  it('「已到期」与「没订过任何档」是两句话，各自来自各自的码', async () => {
    ENTITLEMENTS = [
      { capability: 'hosting', allowed: false, reason: 'PERIOD_ENDED', sources: [] },
      { capability: 'ai', allowed: false, reason: 'NO_SUBSCRIPTION', sources: [] },
    ];
    stubFetch();
    const el = await openUser();

    expect(entitlementLine(el, 'hosting')).toContain('已到期');
    expect(entitlementLine(el, 'hosting')).not.toContain('没订过');
    expect(entitlementLine(el, 'ai')).toContain('没订过任何档');
  });

  it('服务端给的码在词表外 ⇒ 只念 ✕，不替它编一个原因', async () => {
    ENTITLEMENTS = [
      { capability: 'hosting', allowed: false, reason: 'SOMETHING_NEW_UPSTREAM', sources: [] },
    ];
    stubFetch();
    const el = await openUser();

    const line = entitlementLine(el, 'hosting') ?? '';
    expect(line).toContain('✕');
    expect(line).not.toContain('SOMETHING_NEW_UPSTREAM');
    expect(line).not.toContain('已到期');
  });

  it('这台实例没配自动收集的权益来源 ⇒ 念的是配置那一格，不是"这个人没买"', async () => {
    ENTITLEMENTS = [
      {
        capability: 'automation',
        allowed: false,
        reason: 'ENTITLEMENT_MODE_UNCONFIGURED',
        sources: [],
      },
    ];
    stubFetch();
    const el = await openUser();

    const line = entitlementLine(el, 'automation') ?? '';
    expect(line).toContain('这台实例没配');
    expect(line).not.toContain('没订过');
  });
});
