/**
 * 带 `?settings=<节 id>` 冷启动时，设置必须**直接开在那一节**
 * ============================================================
 *
 * ## 这组测试钉的是哪条断链（2026-10-24）
 *
 * 产品负责人说两档「可以开始卖了」，于是落地页付费两档有了真入口。落地页**不**拉
 * 第二份收银台（AGENTS §3.5），它做的是把人送进应用里**已经存在**的那一节：
 * 设置 → 订阅（`SubscriptionPanel` → `RenewPanel` → `@heyta/app-host` 的 `startCheckout`）。
 *
 * 那条链接长这样：`https://…/app/?lang=zh-CN&settings=settings-group-subscription`。
 * **这一端要接住它** —— 接不住的症状不是报错，是"点了没反应"：人落到任务列表，
 * 得自己找「设置 → 订阅」。那就不是购买按钮了。
 *
 * 与 `auth-deep-link.spec.tsx`（`?signin`）的分工：同一条模式、不同的意图。
 * 与 `settings-exit.spec.tsx` 的分工：那一组管**关得掉**，这一组管**开得对**。
 *
 * ## 为什么断言"订阅那一节可见"而不是"state 变成了某个 id"
 *
 * state 变了只证明有人调了 setter；而 `activeSettingsSection` 认不出时，
 * **每一节都是 `hidden`** —— state 有个值、界面却是一张空白设置页。
 * 所以主判据是 DOM：那一节 `<section>` 不带 `hidden`，且里面真的画着订阅面板。
 *
 * ## 为什么必须挂整个 `<App />`
 *
 * 主体是根组件上的一段 `useEffect`（与 `?signin` 那条同构）。挂 `SettingsScreen`
 * 之类的子组件测不到它 —— 那正是本仓库反复记过的"每一段都绿、接起来断"。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/features/privacy/consent-gate.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/features/privacy/consent-gate.js')>(),
  consentFetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init),
}));

import { emptyState } from '@heyta/op-log';

import { __resetAuthForTests } from '../src/features/auth/store.js';
import { privacyConsentActions } from '../src/features/privacy/consent-gate.js';
import { __resetOpLogForTests, initOpLog } from '../src/lib/oplog.js';
import { useSyncStore } from '../src/features/sync/store.js';
import { useTaskStore } from '../src/features/tasks/store.js';
import { SUBSCRIPTION_SETTINGS_SECTION } from '../src/lib/settings-deep-link.js';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();

const { App } = await import('../src/App.js');
// 🔴 用**线上同一个**壳（`main.tsx` 也用它）—— 在测试里自己拼 Provider 就是第二份接线。
import { LocaleHost } from '../src/lib/locale-host.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

/** 把地址换成 `search`，然后挂根组件（地址必须在挂载**之前**换好）。 */
async function mountApp(search: string): Promise<HTMLDivElement> {
  window.history.replaceState({}, '', search);
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
}

/** 某一节**真的在屏幕上**：那个 `<section>` 存在且没被 `hidden`。 */
function sectionVisible(view: HTMLElement, id: string): boolean {
  const section = view.querySelector<HTMLElement>(`#${id}`);
  return section !== null && !section.hasAttribute('hidden');
}

beforeEach(async () => {
  const originalFetch = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    String(input).endsWith('/api/auth/central/config')
      ? Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({
        mode: 'oidc', loginPath: '/api/auth/oidc/start', documentVersion: 'v1',
      }) } as Response)
      : originalFetch(input, init)));
  __resetAuthForTests();
  // 每条用例**自己的库**（与 `auth-deep-link.spec.tsx` 同一条教训：会互相污染）。
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  __resetOpLogForTests();
  useTaskStore.setState({ entities: emptyState(), filter: { kind: 'all' } });
  await initOpLog(`settings-deep-link-${Math.random().toString(36).slice(2)}`);
  useSyncStore.setState({
    baseUrl: '',
    token: undefined,
    password: undefined,
    syncSettingsRequested: false,
    signInOpen: false,
  });
  // 首启隐私面板会盖住首屏 ⇒ 走生产代码接受掉，不往 localStorage 手写自造串。
  privacyConsentActions.accept();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
});

describe('🔴 带 `?settings=<节 id>` 冷启动 = 设置直接开在那一节', () => {
  it('带订阅那一节：订阅面板出现在屏幕上', async () => {
    const view = await mountApp(`/app?settings=${SUBSCRIPTION_SETTINGS_SECTION}`);
    expect(sectionVisible(view, SUBSCRIPTION_SETTINGS_SECTION)).toBe(true);
    // 面板本体也在（标题/CTA 由它渲染）—— 只断"section 没 hidden"会漏掉
    // "壳开了、面板没挂"的那种半截状态。
    expect(view.querySelector('[data-testid="subscription-panel"], [data-testid="renew-panel"]')).not.toBeNull();
    // 别的节不许同时露出来（认错 id 的典型症状是"开了但开在默认那一节"）。
    expect(sectionVisible(view, 'settings-group-appearance')).toBe(false);
  });

  it('🔴 认不出的 id：不开设置，也**绝不**把整页弄成空白', async () => {
    // 一个手打的地址、或一条旧链接会带着不存在的 id 进来。若实现直接把 URL 值
    // 断言成 `SettingsSectionId` 就 `setSettingsSection(...)`，后果不是报错：
    // `activeSettingsSection` 不等于任何一节 ⇒ **每一节都 `hidden`** ⇒
    // 用户看到一张空白设置页（state 有个值、屏幕什么都没有）。
    //
    // 实测的契约（2026-10-24）：认不出 ⇒ **一个字节都不动**，人留在原来的视图上。
    // 断言两件事：① 没有空白设置页；② 人还能看见主界面（任务列表）。
    const view = await mountApp('/app?settings=settings-group-does-not-exist');
    const sections = [...view.querySelectorAll<HTMLElement>('section.ht-settings__group')];
    const visible = sections.filter((s) => !s.hasAttribute('hidden'));

    // 两条都不许出现：① 设置面开着却**一节都不可见**（空白页）；
    // ② 认出的 id 让用户莫名其妙落进某一节（我们不做这种猜测）。
    // 实测契约：认不出 ⇒ 设置面根本不开（0 个 section）。
    expect(sections.length).toBe(0);
    expect(visible.length).toBe(0);
    // 而人还留在主界面上 —— 不是一片空白。
    expect(view.textContent ?? '').toMatch(/任务|Tasks/);
  });

  it('没有这个参数：不打开设置（否则每次冷启动都会跳设置）', async () => {
    const view = await mountApp('/app');
    expect(sectionVisible(view, SUBSCRIPTION_SETTINGS_SECTION)).toBe(false);
    expect(view.querySelector('section.ht-settings__group')).toBeNull();
  });

  it('与 `?lang=` 共存时同样生效（落地页真的会生成这种地址）', async () => {
    const view = await mountApp(`/app?lang=en&settings=${SUBSCRIPTION_SETTINGS_SECTION}`);
    expect(sectionVisible(view, SUBSCRIPTION_SETTINGS_SECTION)).toBe(true);
  });
});

describe('🔴 `standalone=1`：这一页只画设置（桌面端独立窗口的载荷）', () => {
  it('带 standalone：设置开在指定节，且根元素标明"收起壳"', async () => {
    const view = await mountApp(`/app?settings=${SUBSCRIPTION_SETTINGS_SECTION}&standalone=1`);
    expect(sectionVisible(view, SUBSCRIPTION_SETTINGS_SECTION)).toBe(true);
    // 判据是**根元素上的属性**：CSS 按它收起 rail / 主区 / 详情列。
    const root = view.querySelector('.ht-app');
    expect(root?.hasAttribute('data-settings-standalone')).toBe(true);
  });

  it('不带 standalone：壳必须在（落地页送人进来的那种用法）', async () => {
    // ⚠️ 这条是上一条的反面对照。少了它，"顺手把 standalone 设成默认"这种改动
    //    会让落地页的购买入口把整个应用壳吞掉，而没有任何判据会红。
    const view = await mountApp(`/app?settings=${SUBSCRIPTION_SETTINGS_SECTION}`);
    expect(sectionVisible(view, SUBSCRIPTION_SETTINGS_SECTION)).toBe(true);
    const root = view.querySelector('.ht-app');
    expect(root?.hasAttribute('data-settings-standalone')).toBe(false);
  });

  it('没有 settings 时 standalone 不生效（不猜"只画设置"这种上下文）', async () => {
    const view = await mountApp('/app?standalone=1');
    const root = view.querySelector('.ht-app');
    expect(root?.hasAttribute('data-settings-standalone')).toBe(false);
  });
});

describe('设置导航：每个菜单都要有图标（独立窗口里那一列是唯一导航）', () => {
  it('8 个分类逐项都有 svg，且文字仍在（图标不替代可访问名）', async () => {
    const view = await mountApp(`/app?settings=${SUBSCRIPTION_SETTINGS_SECTION}`);
    const links = [...view.querySelectorAll<HTMLElement>('.ht-settings__nav-link')];
    expect(links.length, '分类数量').toBeGreaterThanOrEqual(8);
    for (const link of links) {
      expect(link.querySelector('svg'), `「${link.textContent ?? ''}」缺图标`).not.toBeNull();
      // 🔴 图标 aria-hidden，可访问名必须仍是文字 —— 少这条，读屏用户听到的是"按钮"。
      expect(link.textContent?.trim().length ?? 0, '图标不能替代文字').toBeGreaterThan(0);
      expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    }
  });
});
