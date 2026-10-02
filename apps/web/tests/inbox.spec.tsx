/**
 * 通知中心 + 活动的界面与 store 测试。
 *
 * 这里钉住的是几条**只有在这层才看得见**的性质：
 *
 * 1. **未知 `kind` 的那条被跳过，而且不会把别的通知挤掉** ——
 *    服务端加一类新事件时老客户端会遇到它。
 * 2. **未配置服务器 → 一个请求都不发**（fail-open 的第一道保证），
 *    并且提示说的是"先配置服务器"，不是"加载失败"。
 * 3. **读失败不清空已经读到的数据** —— 把一次失败显示成"没有通知"
 *    会让用户以为自己没有未读。
 * 4. 🔴 **活动只在「活动」Tab 真的被打开时才拉**。服务端那次 GET 会
 *    惰性创建邀请码，所以这条是"不给每个用户都写一行邀请码"的客户端一侧保证。
 * 5. **全部已读失败时不动本地状态**（徽标继续亮着）。
 * 6. 🔴 **自动拉取挡在同意决定之后**，而且未同意时界面**不说"稍后重试"** ——
 *    闸门保证发不出去，这一条保证界面不对着从没发出的请求说话。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PRIVACY_CONSENT_KEY } from '@heyta/app-host';
import { I18nProvider, translate, type Locale, type MessageKey } from '@heyta/i18n';

import { InboxBell } from '../src/features/inbox/InboxBell.js';
import { __resetInboxForTests, useInboxStore } from '../src/features/inbox/store.js';
import { privacyConsent, privacyConsentActions } from '../src/features/privacy/consent-gate.js';
import { useSyncStore } from '../src/features/sync/store.js';

const BASE = 'https://sync.example.com';

const NOTIFICATIONS_BODY = {
  notifications: [
    {
      id: 2,
      kind: 'referral-activated',
      payload: { displayName: 'star', days: 5 },
      createdAt: Date.UTC(2026, 8, 26),
      readAt: null,
    },
    {
      id: 1,
      kind: 'referral-activated',
      payload: { displayName: null, days: 5 },
      createdAt: Date.UTC(2026, 8, 25),
      readAt: Date.UTC(2026, 8, 25, 1),
    },
    {
      // 老客户端看不懂的事件：**必须被跳过**。
      id: 3,
      kind: 'spring-festival-2027',
      payload: { something: 'new' },
      createdAt: Date.UTC(2026, 8, 27),
      readAt: null,
    },
  ],
  unreadCount: 2,
};

const ACTIVITY_BODY = {
  campaigns: [
    {
      id: 'invite-friends',
      kind: 'invite',
      invite: {
        inviteCode: 'ABCD2345',
        rewardDays: 5,
        invited: 3,
        activated: 2,
        daysEarned: 10,
        windowInvited: 3,
        windowCap: 20,
        windowDays: 30,
        referrals: [
          {
            code: 'ABCD2345',
            displayName: 'star',
            createdAt: Date.UTC(2026, 8, 26),
            activatedAt: Date.UTC(2026, 8, 26, 2),
            rewardDays: 5,
          },
        ],
      },
    },
  ],
};

interface Call {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

/**
 * 一个按 URL 分派的 `fetch` 替身。
 *
 * ⚠️ 它记录**每一次调用**（含 method 与 body）—— 这个文件里好几条断言
 * 靠的是"到底发没发这个请求"，而不是"界面显示了什么"。
 */
function installFetch(
  overrides: Partial<Record<'notifications' | 'read' | 'activity', { status: number; body?: unknown }>> = {},
): Call[] {
  const calls: Call[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({
        method,
        url,
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      });

      const spec = url.includes('/api/notifications/read')
        ? (overrides.read ?? { status: 200, body: { updated: 2, unreadCount: 0 } })
        : url.includes('/api/notifications')
          ? (overrides.notifications ?? { status: 200, body: NOTIFICATIONS_BODY })
          : url.includes('/api/activity')
            ? (overrides.activity ?? { status: 200, body: ACTIVITY_BODY })
            : { status: 200, body: {} };

      return Promise.resolve({
        status: spec.status,
        ok: spec.status >= 200 && spec.status < 300,
        json: () => Promise.resolve(spec.body),
      } as unknown as Response);
    }),
  );

  return calls;
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function renderBell(locale: Locale = 'zh-CN'): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <I18nProvider locale={locale}>
        <InboxBell />
      </I18nProvider>,
    );
    // 让挂载时那次拉取的 promise 落定。
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

/** 等挂载/点击触发的 promise 落定。 */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const testId = (id: string): HTMLElement | null =>
  container?.querySelector(`[data-testid="${id}"]`) ?? null;

const click = async (id: string): Promise<void> => {
  const el = testId(id);
  if (el === null) throw new Error(`找不到 ${id}`);
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
  await settle();
};

/** 把闸门清回「还没问过」—— 与磁盘也断开（本文件末尾那条闸门用例要这个起点）。 */
function makeUndecided(): void {
  localStorage.removeItem(PRIVACY_CONSENT_KEY);
  privacyConsent.__resetSessionForTests();
}

beforeEach(() => {
  __resetInboxForTests();
  useSyncStore.setState({ baseUrl: BASE, token: 'token-123' });
  // 🔴 铃铛的**自动**拉取现在挡在同意闸门之后（`InboxBell` 的 `pollNotifications`）。
  // 本文件验的是"通知界面"，所以同意在这里是**前置条件**，不是被测对象 ——
  // 被测对象在 `privacy-consent-sheet.spec.tsx`，闸门本身在文件末尾那一条。
  makeUndecided();
  privacyConsentActions.accept();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

describe('挂载：只拉通知，**不拉活动**', () => {
  it('未读徽标在面板关着的时候就显示', async () => {
    installFetch();
    await renderBell();
    expect(testId('inbox-badge')?.textContent).toBe('2');
    expect(testId('inbox-panel')).toBeNull();
  });

  it('🔴 挂载只发一次通知请求，一个活动请求都不发（否则每个用户都被写一行邀请码）', async () => {
    const calls = installFetch();
    await renderBell();

    const urls = calls.map((c) => c.url);
    expect(urls.filter((u) => u.includes('/api/notifications'))).toHaveLength(1);
    expect(urls.filter((u) => u.includes('/api/activity'))).toHaveLength(0);
  });

  it('触发器不是 role=tab（rail 上的 tab 数量被 e2e 逐字钉住）', async () => {
    installFetch();
    await renderBell();
    const trigger = testId('inbox-trigger')!;
    expect(trigger.getAttribute('role')).toBeNull();
    // Playwright 的 getByRole('tab') 靠的可访问性角色，而这里必须是普通按钮。
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('通知 Tab', () => {
  it('打开面板 → 拉一次通知，渲染出两条，未知 kind 的那条不渲染', async () => {
    const calls = installFetch();
    await renderBell();
    await click('inbox-trigger');

    expect(testId('inbox-panel')).not.toBeNull();
    expect(testId('inbox-item-2')).not.toBeNull();
    expect(testId('inbox-item-1')).not.toBeNull();
    // 未知 kind：整条跳过，而不是画一张空白卡片。
    expect(testId('inbox-item-3')).toBeNull();
    expect(testId('inbox-list')!.querySelectorAll('li')).toHaveLength(2);
    // 打开时又拉了一次（挂载一次 + 打开一次）。
    expect(calls.filter((c) => c.url.includes('/api/notifications'))).toHaveLength(2);
  });

  it('没名字的那条走「一位好友」兜底，而不是渲染出空名字', async () => {
    installFetch();
    await renderBell();
    await click('inbox-trigger');

    expect(testId('inbox-item-1')!.textContent).toContain(
      translate('zh-CN', 'web.inbox.activity.invite.unknownName'),
    );
    expect(testId('inbox-item-2')!.textContent).toContain('star');
  });

  it('一条都渲染不出来时显示空态（而不是一个空列表）', async () => {
    installFetch({ notifications: { status: 200, body: { notifications: [], unreadCount: 0 } } });
    await renderBell();
    await click('inbox-trigger');
    expect(testId('inbox-empty')).not.toBeNull();
  });

  it('全是未知 kind 时也走空态，而不是留下一个空列表', async () => {
    installFetch({
      notifications: {
        status: 200,
        body: {
          notifications: [
            { id: 9, kind: 'brand-new-event', payload: {}, createdAt: 1, readAt: null },
          ],
          unreadCount: 0,
        },
      },
    });
    await renderBell();
    await click('inbox-trigger');
    expect(testId('inbox-empty')).not.toBeNull();
    expect(testId('inbox-list')).toBeNull();
  });
});

describe('全部已读', () => {
  it('发的是 `{ all: true }`，并把徽标清掉', async () => {
    const calls = installFetch();
    await renderBell();
    await click('inbox-trigger');
    await click('inbox-mark-all-read');

    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toContain('/api/notifications/read');
    expect(post?.body).toEqual({ all: true });
    expect(testId('inbox-badge')).toBeNull();
  });

  it('🔴 失败时**不动本地状态**：徽标继续亮着，用户能再点一次', async () => {
    installFetch({ read: { status: 500 } });
    await renderBell();
    await click('inbox-trigger');
    await click('inbox-mark-all-read');

    // 没有"清了徽标但服务端没清" —— 那会在下一次加载时凭空跳回来。
    expect(testId('inbox-badge')?.textContent).toBe('2');
    expect(useInboxStore.getState().unreadCount).toBe(2);
  });
});

describe('读不到时的两种提示必须分开', () => {
  it('没配服务器 → 「先配置服务器」，且一个请求都不发', async () => {
    const calls = installFetch();
    useSyncStore.setState({ baseUrl: '', token: undefined });
    await renderBell();
    await click('inbox-trigger');

    expect(testId('inbox-unconfigured')).not.toBeNull();
    expect(testId('inbox-unavailable')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('配了但读不到 → 错误 + 重试按钮（并**保留**上一次读到的数据）', async () => {
    // 先成功一次，把数据放进去。
    installFetch();
    await renderBell();
    await click('inbox-trigger');
    expect(testId('inbox-item-2')).not.toBeNull();

    // 再让它失败，并重新拉一次。
    installFetch({ notifications: { status: 500 } });
    await act(async () => {
      await useInboxStore.getState().refreshNotifications();
    });
    await settle();

    expect(testId('inbox-unavailable')).not.toBeNull();
    expect(testId('inbox-retry')).not.toBeNull();
    // 🔴 列表**不该被清空** —— 清空会让"这次没读到"看起来像"你没有通知"。
    expect(useInboxStore.getState().notifications).toHaveLength(3);
  });
});

/**
 * 🔴 铃铛的**自动**拉取挡在同意决定之后（`InboxBell` 的 `pollNotifications`）。
 *
 * 闸门本身（`consentFetch` / 进程级那道）保证"发不出去"，这几条钉的是另一件事：
 * **界面不许对着一件从没发出去的请求说话**。少了这一层，未同意时的表现是
 * "加载失败 / 稍后重试"（`fetchAccountNotifications` 把本机拦截归成 `cause: 'network'`），
 * 而选「只用本机」的人会每次刷新都被记成一次读取失败 —— 那是界面在说谎。
 */
describe('同意闸门：没决定就一个请求都不发，而且不说「稍后重试」', () => {
  it('还没决定 → 挂载与打开面板都零请求，状态停在「还没拉过」', async () => {
    makeUndecided();
    const calls = installFetch();
    await renderBell();
    await click('inbox-trigger');

    expect(calls).toHaveLength(0);
    expect(testId('inbox-unconfigured')).toBeNull();
    expect(testId('inbox-unavailable')).toBeNull();
    expect(useInboxStore.getState().notificationsState).toBeNull();
    expect(testId('inbox-badge')).toBeNull();
  });

  it('选了「只用本机」→ 同样零请求（这是一件正常事，不是一次失败）', async () => {
    makeUndecided();
    privacyConsent.decide('local-only');
    const calls = installFetch();
    await renderBell();
    await click('inbox-trigger');

    expect(calls).toHaveLength(0);
    expect(testId('inbox-unavailable')).toBeNull();
    expect(useInboxStore.getState().notificationsState).toBeNull();
  });

  it('🔴 切到「活动」Tab 但还没同意 → 一个活动请求都不发（否则给没同意的用户写一行邀请码）', async () => {
    makeUndecided();
    const calls = installFetch();
    await renderBell();
    await click('inbox-trigger');
    await click('inbox-tab-activity');

    expect(calls).toHaveLength(0);
    expect(testId('inbox-invite-code')).toBeNull();
  });

  it('同意之后**补拉一次**：徽标当场亮起来，不需要重开面板', async () => {
    makeUndecided();
    const calls = installFetch();
    await renderBell();
    expect(calls).toHaveLength(0);

    await act(async () => {
      privacyConsentActions.accept();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls.filter((c) => c.url.includes('/api/notifications'))).toHaveLength(1);
    expect(testId('inbox-badge')?.textContent).toBe('2');
  });

  it('撤回之后立刻收口：再打开面板不拉（撤回的效力不许等到下次冷启动）', async () => {
    const calls = installFetch();
    await renderBell();
    expect(calls.filter((c) => c.url.includes('/api/notifications'))).toHaveLength(1);

    await act(async () => {
      privacyConsentActions.revoke();
    });
    calls.length = 0;

    await click('inbox-trigger');
    expect(calls).toHaveLength(0);
  });
});

describe('活动 Tab', () => {
  it('🔴 切到活动才拉活动，并渲染邀请卡', async () => {
    const calls = installFetch();
    await renderBell();
    await click('inbox-trigger');

    // 打开面板（通知 Tab）时不拉活动。
    expect(calls.filter((c) => c.url.includes('/api/activity'))).toHaveLength(0);

    await click('inbox-tab-activity');
    expect(calls.filter((c) => c.url.includes('/api/activity'))).toHaveLength(1);
    expect(testId('inbox-invite-code')?.textContent).toBe('ABCD2345');
    expect(testId('inbox-invite-stats')?.textContent).toContain('10');
  });

  it('活动目录为空 → 空态（不是崩溃、也不是一张空卡片）', async () => {
    installFetch({ activity: { status: 200, body: { campaigns: [] } } });
    await renderBell();
    await click('inbox-trigger');
    await click('inbox-tab-activity');
    expect(testId('inbox-activity-empty')).not.toBeNull();
  });
});

describe('关闭方式', () => {
  it('关闭按钮关掉面板', async () => {
    installFetch();
    await renderBell();
    await click('inbox-trigger');
    await click('inbox-close');
    expect(testId('inbox-panel')).toBeNull();
  });

  it('Escape 关掉面板（监听挂在 document 上，所以焦点不在里面也生效）', async () => {
    installFetch();
    await renderBell();
    await click('inbox-trigger');

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await Promise.resolve();
    });
    expect(testId('inbox-panel')).toBeNull();
  });

  it('点面板外面关掉', async () => {
    installFetch();
    await renderBell();
    await click('inbox-trigger');

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await Promise.resolve();
    });
    expect(testId('inbox-panel')).toBeNull();
  });
});

describe('词条', () => {
  /**
   * 全局词条表整体由 `pnpm check:ui-language` 的规则 2/3/4 兜底
   * （中英键集必须一致、中文必须有汉字、英文不许有中日韩字符）。
   * 这里额外钉住**用户真会看到的那几条**，因为它们最容易在改动中被漏掉。
   */
  const USER_VISIBLE_KEYS = [
    'web.inbox.trigger',
    'web.inbox.badge.aria',
    'web.inbox.tab.notifications',
    'web.inbox.tab.activity',
    'web.inbox.markAllRead',
    'web.inbox.notifications.empty',
    'web.inbox.activity.empty',
    'web.inbox.unconfigured',
    'web.inbox.error',
    'web.inbox.retry',
    'web.inbox.notification.referral.title',
    'web.inbox.notification.referral.body',
    'web.inbox.notification.referral.bodyUnknownActor',
    'web.inbox.activity.invite.title',
    'web.inbox.activity.invite.body',
    'web.inbox.activity.invite.codeLabel',
    'web.inbox.activity.invite.copyCode',
    'web.inbox.activity.invite.copyLink',
    'web.inbox.activity.invite.copied',
    'web.inbox.activity.invite.copyFailed',
    'web.inbox.activity.invite.stats',
    'web.inbox.activity.invite.remaining',
    'web.inbox.activity.invite.listTitle',
    'web.inbox.activity.invite.status.activated',
    'web.inbox.activity.invite.status.pending',
    'web.inbox.activity.invite.unknownName',
    'web.inbox.activity.invite.empty',
  ] as const satisfies readonly MessageKey[];

  it('每一条都在英文表里有真正的英文翻译（不是回落到中文）', () => {
    for (const key of USER_VISIBLE_KEYS) {
      const en = translate('en', key);
      const zh = translate('zh-CN', key);
      expect(en, key).not.toBe(zh);
      expect(en, key).not.toMatch(/[\u3400-\u4DBF\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/u);
      expect(zh, key).toMatch(/[\u4E00-\u9FFF]/u);
    }
  });

  it('带参数的词条在两种语言里都保留了占位符', () => {
    for (const [key, vars] of [
      ['web.inbox.notification.referral.body', '{name} {days}'],
      ['web.inbox.notification.referral.bodyUnknownActor', '{days}'],
      ['web.inbox.activity.invite.body', '{days}'],
      ['web.inbox.activity.invite.stats', '{invited} {activated} {days}'],
      ['web.inbox.activity.invite.remaining', '{remaining}'],
      ['web.inbox.badge.aria', '{count}'],
    ] as const) {
      for (const locale of ['zh-CN', 'en'] as const) {
        const rendered = translate(locale, key, {
          name: 'star',
          days: 5,
          count: 2,
          invited: 3,
          activated: 2,
          remaining: 7,
        });
        expect(rendered, `${locale}/${key}`).not.toContain('{');
        expect(rendered.length, `${locale}/${key}`).toBeGreaterThan(0);
        expect(vars.length).toBeGreaterThan(0);
      }
    }
  });
});
