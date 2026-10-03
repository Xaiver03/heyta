/**
 * 带 `?signin` 冷启动时，认证面板必须**直接打开**
 * =================================================
 *
 * ## 这组测试钉的是哪条断链
 *
 * 落地页导航上的「登录」过去落在站内 `/signin/` 那张页面，而那张页面第一屏是
 * 三段关于登录的**说明**。产品负责人 2026-10-03 实测后否掉了这个形状：点"登录"
 * 的人要的是登录界面。于是导航那条现在指向 `应用地址?signin=1`，而**这一端**要接住它。
 *
 * 与 `signin-entry.spec.tsx`（判据 J1）的分工：那一组管**站内的身份入口**
 * （头像 → 菜单第一项 → 面板，两次点击）；这一组管**从站点带参数进来的那一次冷启动**。
 * 两条路打开的是同一个面板，防的回归不同 —— 把 `App.tsx` 里那段 `useEffect` 删掉，
 * J1 一条都不会红。
 *
 * 🔴 关键在于"接住"这件事发生在**壳的挂载处**，不在 `AuthPanel` 里：
 * `AuthPanel` 也读一个参数（`?invite=`），但那是"面板已经开着"之后的字段初值；
 * "面板该不该开"的状态住在 store（`signInOpen`）。让一个"开了才存在"的组件去决定
 * 自己该不该存在，读到的永远是上一帧。理由写在 `src/lib/auth-deep-link.ts` 文件头。
 *
 * ## 为什么必须挂整个 `<App />`
 *
 * 这条判据的主体是**根组件上的一段 `useEffect`**。单独挂 `SyncBar` 或 `AuthPanel`
 * 都测不到它 —— 那正是本仓库反复记过的那类"每一段都绿、接起来断"
 * （见 `app-mount.spec.tsx` 文件头：在没有任何测试挂载过根组件之前，根组件坏了很久）。
 *
 * 🔴 判据是**产品结论**，不是 store 字段：断言的是"用户在屏幕上看到了登录表单"。
 * `signInOpen === true` 只证明有人调了 `openSignIn()`；面板被别的东西盖住时它是绿的
 * 而用户什么也没看到。所以两条一起断，DOM 那条是主的。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emptyState } from '@heyta/op-log';

import { __resetAuthForTests } from '../src/features/auth/store.js';
import { privacyConsentActions } from '../src/features/privacy/consent-gate.js';
import { __resetOpLogForTests, initOpLog } from '../src/lib/oplog.js';
import { useSyncStore } from '../src/features/sync/store.js';
import { useTaskStore } from '../src/features/tasks/store.js';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();

const { App } = await import('../src/App.js');
// 🔴 用**线上同一个**壳（`main.tsx` 也用它）—— 在测试里自己拼 Provider 就是第二份接线。
import { LocaleHost } from '../src/lib/locale-host.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

/**
 * 把地址换成 `search`，然后挂根组件。
 *
 * ⚠️ 地址必须在**挂载之前**换好：那段 `useEffect` 读的是挂载那一刻的
 * `location.search`，挂载后再改地址等于什么都没测。
 */
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

/** 登录表单**真在屏幕上**：共享 `AuthForm` 的邮箱字段（四端共用的契约）。 */
function signInFormVisible(view: HTMLElement): boolean {
  return view.querySelector('[data-testid="auth-form-email"]') !== null;
}

beforeEach(async () => {
  __resetAuthForTests();
  // 🔴 每条用例**自己的库**：App 挂的是真 op-log，不换库会互相污染
  //（J1 与 app-mount.spec.tsx 的 `freshDb` 各记过同一条教训）。
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  __resetOpLogForTests();
  useTaskStore.setState({ entities: emptyState(), filter: { kind: 'all' } });
  await initOpLog(`auth-deep-link-${Math.random().toString(36).slice(2)}`);
  useSyncStore.setState({
    baseUrl: '',
    token: undefined,
    password: undefined,
    settingsOpen: false,
    signInOpen: false,
  });
  // 首启隐私面板会盖住首屏，也会让"看到了登录表单"这条断言变成假红。
  // ⚠️ 走生产代码 `privacyConsentActions.accept()`，不往 localStorage 手写自造串
  //（与 J1 同一条做法；面板自己的判据在 `privacy-consent-sheet.spec.tsx`）。
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
});

describe('🔴 带 `?signin` 冷启动 = 登录界面直接出现', () => {
  it('地址里有那个参数：登录表单出现在屏幕上', async () => {
    const view = await mountApp('/app?signin=1');
    expect(signInFormVisible(view)).toBe(true);
    // 状态一起断：少了它，"DOM 里有某个表单"可能只是别处恰好渲染了它。
    expect(useSyncStore.getState().signInOpen).toBe(true);
  });

  it('🔴 地址里没有那个参数：不打开（否则每次冷启动都会弹登录）', async () => {
    const view = await mountApp('/app');
    expect(signInFormVisible(view)).toBe(false);
    expect(view.querySelector('[role="dialog"]')).toBeNull();
    expect(useSyncStore.getState().signInOpen).toBe(false);
  });

  /**
   * 判据是**有没有这个意图**，不是值等于 `'1'`。
   *
   * ⚠️ 这不是宽容：落地页那边写的是 `searchParams.set(name, '1')`，而人在收藏夹里、
   * 别的站点的链接里、把地址复制进聊天窗口时，留下的常常是裸 `?signin`。
   * 值一严格匹配，那条链接就变成"点了没反应" —— 而这正是这一组用例要消灭的形状。
   */
  it('裸 `?signin`（没有值）同样打开', async () => {
    const view = await mountApp('/app?signin');
    expect(useSyncStore.getState().signInOpen).toBe(true);
    expect(signInFormVisible(view)).toBe(true);
  });

  /**
   * 🔴 与其他查询串共存：语言参数（`?lang=en`）不能把它挤掉。
   * 落地页真的会生成 `?lang=en&signin=1` 这种地址（`app-url.spec.ts` 钉着），
   * 而英文那条如果在这边失效，就是"只在一种语言下坏"那种最难复现的形状。
   */
  it('`?lang=en&signin=1` 这种组合同样打开', async () => {
    await mountApp('/app?lang=en&signin=1');
    expect(useSyncStore.getState().signInOpen).toBe(true);
  });

  /**
   * 只在**挂载时**看一次：用户手动关掉之后，重渲染不该把它抢回来。
   *
   * 这条是"每次渲染都检查地址"那种写法的反例 —— 那种写法会让面板关掉后
   * 任何一次状态更新都重新弹出，用户永远关不掉。
   */
  it('关掉之后不会被一次重渲染抢回来', async () => {
    const view = await mountApp('/app?signin=1');
    expect(useSyncStore.getState().signInOpen).toBe(true);

    act(() => {
      useSyncStore.getState().closeSignIn();
    });
    await act(async () => {
      useTaskStore.setState({ entities: emptyState(), filter: { kind: 'today' } });
    });

    expect(useSyncStore.getState().signInOpen).toBe(false);
    expect(signInFormVisible(view)).toBe(false);
  });
});
