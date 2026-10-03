/**
 * 「编辑个人信息」这一项的入口判据（R10）
 * ======================================
 *
 * 挂**完整 App**，走真实头像 —— 与 `signin-entry.spec.tsx` 同一条纪律：
 * 自己拼一份 AccountMenu 的接线，测到的是夹具而不是产品。
 *
 * 钉四件事：
 *   1. 未登录 ⇒ 这一项**不在 DOM 里**（昵称与头像是账号上的行，
 *      没登录就没有可读写的那一行 —— 与"未登录不出现退出登录"同一类语义）；
 *   2. 已登录 ⇒ 它在**身份区之后、设置之前**（顺序是这条裁决的一部分，
 *      见 docs/plans/ui-review-fill-zh-timeline.md §8.4 第 1 条）；
 *   3. 点它 ⇒ 打开的是设置浮层**而且**个人信息面板在里面（不是只切了个视图）；
 *   4. 🔴 打开浮层时**下层视图仍在 DOM 里**（设置是 sheet 不是一路由，
 *      这条是既有判据，本用例顺手保证新入口没把它改成路由）。
 *
 * ⚠️ `fetch` 一律 stub：面板挂载会去读资料，这里不关心它读到什么
 *（那部分判据在 `profile-panel.spec.tsx` 与 app-host 那一层）。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetAuthForTests } from '../src/features/auth/store.js';
import { __resetOpLogForTests, initOpLog } from '../src/lib/oplog.js';
import { emptyState } from '@heyta/op-log';
import { privacyConsentActions } from '../src/features/privacy/consent-gate.js';
import { useSyncStore } from '../src/features/sync/store.js';
import { useTaskStore } from '../src/features/tasks/store.js';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');
import { LocaleHost } from '../src/lib/locale-host.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

/**
 * jsdom **没有实现** `Element.prototype.scrollIntoView`（浏览器专有），
 * 而 `App.tsx` 的 `scrollToProfile` 会调它。不补的话症状不是"断言不过"，
 * 是 `TypeError` 直接崩在 effect 里，报错指不到产品行为。
 * 补法与理由照 `search-panel.spec.tsx:148-186`：**补在测试这边**，
 * 不把宿主代码改成 `?.scrollIntoView?.()`（那是为了迁就夹具而弱化产品代码）。
 *
 * 🔴 顺手把它变成一条**真判据**：记下滚的是哪个元素。
 * 于是"点了编辑个人信息，页面没落到那一节"（第一版的失败形态）会红，
 * 而不是仅仅"不崩"。
 */
const scrolledTo: string[] = [];
const originalScrollIntoView = Element.prototype.scrollIntoView;

const render = async (): Promise<HTMLElement> => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleHost>
        <App />
      </LocaleHost>,
    );
  });
  return container;
};

const click = (el: Element): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const signIn = (): void => {
  useSyncStore.setState({
    baseUrl: 'https://sync.example.test',
    token: 'token-from-login',
    password: undefined,
    email: 'you@example.test',
  });
};

beforeEach(async () => {
  scrolledTo.length = 0;
  Element.prototype.scrollIntoView = function (this: Element): void {
    scrolledTo.push(this.getAttribute('id') ?? this.tagName);
  };
  __resetAuthForTests();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  __resetOpLogForTests();
  useTaskStore.setState({ entities: emptyState(), filter: { kind: 'all' } });
  await initOpLog(`profile-entry-${Math.random().toString(36).slice(2)}`);
  useSyncStore.setState({ baseUrl: '', token: undefined, password: undefined });
  // 🔴 桩**只回答资料那两条路由**，其余一律 404。
  // 第一版这里是 catch-all（任何 URL 都回 `{displayName, avatarHash}`），
  // 结果设置浮层里另一个会自己发请求的面板（运营后台）拿到了一个
  // "形状看起来对、字段全是 undefined"的 overview，直接在 `AdminPanel.tsx:211`
  // 崩掉 —— 而崩的是别人的用例，红字里完全看不出是我这行桩造成的。
  // 一份对所有人回真值的桩 = 给每个未知调用点造一份假数据。只答问过的路由。
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/account/profile') {
        return Response.json({ displayName: null, avatarHash: null });
      }
      return Response.json({ error: 'not part of this journey' }, { status: 404 });
    }),
  );
  // 冷启动会弹首启隐私面板；本文件的前提是"这台设备已经做过隐私决定"。
  privacyConsentActions.accept();
});

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

describe('身份菜单里的「编辑个人信息」', () => {
  it('未登录时不出现这一项', async () => {
    const el = await render();
    click(el.querySelector('[data-testid="account-menu-avatar"]')!);
    expect(
      el.querySelector('[data-testid="account-menu-profile"]'),
      '没登录也给"编辑个人信息"= 一个点了只会失败的入口',
    ).toBeNull();
  });

  it('已登录时出现，且排在身份区之后、设置之前', async () => {
    signIn();
    const el = await render();
    click(el.querySelector('[data-testid=' + '"account-menu-avatar"]')!);

    const items = Array.from(el.querySelectorAll('[role="menuitem"]')).map(
      (n) => n.getAttribute('data-testid') ?? '',
    );
    const profile = items.findIndex((id) => id === 'account-menu-profile');
    const settings = items.findIndex((id) => id === 'account-menu-settings');
    expect(profile, '菜单里没有「编辑个人信息」').toBeGreaterThanOrEqual(0);
    expect(settings).toBeGreaterThanOrEqual(0);
    // 🔴 顺序是判据不是审美：它表达"这一项改的是这个账号是谁"，
    // 而下面那组改的是"这个账号怎么行为"。
    expect(
      profile < settings,
      `「编辑个人信息」必须在「设置」之前，实际顺序 ${items.join(' → ')}`,
    ).toBe(true);
  });

  it('点它 ⇒ 设置浮层打开、个人信息面板在场、下层视图没有被换掉', async () => {
    signIn();
    const el = await render();
    // rail 的 tab 没有 data-testid（它的名字就是 accessible name），
    // 所以按文案找 —— 与 `app-mount.spec.tsx` 的 `railTab()` 同一取法。
    const railTab = (label: string): HTMLButtonElement | undefined =>
      [...el.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find(
        (b) => b.textContent?.includes(label) === true,
      );
    // 先落在日历上再从菜单进个人信息："下层视图还在不在"这条才有得测
    //（从任务页进看不出差别，任务页本来就是默认）。
    click(railTab('日历')!);
    expect(el.querySelector('[data-testid="calendar-board"]'), '日历没画出来').not.toBeNull();

    click(el.querySelector('[data-testid="account-menu-avatar"]')!);
    click(el.querySelector('[data-testid="account-menu-profile"]')!);

    expect(el.querySelector('[data-testid="settings-sheet"]'), '没打开设置浮层').not.toBeNull();
    expect(
      el.querySelector('[data-testid="profile-panel"]'),
      '浮层打开了但里面没有个人信息面板 ⇒ 入口是空的',
    ).not.toBeNull();
    // 同一条判据的另一半：昵称框真的渲染出来了（不是只挂了个壳）。
    expect(el.querySelector('[data-testid="profile-nickname-input"]')).not.toBeNull();
    // 🔴 而且它被**滚进视野**了。设置浮层里段数不少（显示 / 模块 / AI / 同步…），
    // 只"打开浮层"等于把人丢在一屏他不要的东西前面。
    expect(scrolledTo, `点了编辑个人信息却没滚到那一节，实际滚过：${scrolledTo.join(', ') || '（什么都没滚）'}`).toContain(
      'settings-profile',
    );
    // 🔴 设置是**浮层**不是一路由：下层的日历必须仍在 DOM 里。
    // 这一条不是顺手加的 —— 把新入口改成 `setView('profile')` 那种路由式写法，
    // 它会红，而"个人信息能用"这件事看起来完全正常（§11.5 的既有判据）。
    expect(
      el.querySelector('[data-testid="calendar-board"]'),
      '进个人信息把下层视图换掉了 ⇒ 设置不再是浮层',
    ).not.toBeNull();
  });
});
