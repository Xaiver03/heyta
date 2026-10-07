/**
 * 设置浮层的**落位**：滚到哪一节、焦点给到谁
 * ==========================================
 *
 * ## 它补的是哪一条
 *
 * 「从别处点一下 ⇒ 落在设置里的某一节」这件事有三条路（个人信息 / 同步 / 帮助）。
 * 已有的判据只量了**滚没滚**（`account-profile-entry.spec.tsx` 记的是
 * `scrollIntoView` 被谁调用），**没有任何一条读过 `document.activeElement`** ——
 * 而 `App.tsx` 里那句话写的是"滚完之后把焦点给昵称框"。
 *
 * 🔴 本文件当场量到那一句**从来没成立过**：`sheetRef.current?.focus()`
 * 声明在落位 effect **之后**，effect 按声明顺序跑，于是浮层容器把刚给出去的
 * 焦点又抢回去。修法不是改判据，是把落位 effect 挪到后面（`App.tsx` 里
 * "声明位置是承重的"那段注释）。
 *
 * ## 为什么不点那个按钮，而是发请求
 *
 * `useSyncStore.getState().openSettings()` 就是订阅提示那颗
 * 「改用你自己的服务器」的 `onClick` 本体。**按钮存在且点了会发请求**那一半
 * 由 `subscription-notice.spec.tsx:138` 钉；这一半钉的是**壳收到请求之后**
 * 有没有真的把人送到那一节。两半合起来才是那条用户路径，各钉一段比
 * 在这里重造一份订阅态更不容易漂。
 *
 * ⚠️ jsdom **不实现** `Element.prototype.scrollIntoView`（浏览器专有）。
 * 补法与理由照 `account-profile-entry.spec.tsx` / `search-panel.spec.tsx`：
 * 补在测试这边，不把宿主代码改成 `?.scrollIntoView?.()`（那是为了迁就夹具
 * 而弱化产品代码）。顺手把它变成一条真判据：记下滚的是哪一节。
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

/** 当前拿到焦点的那个东西是谁（`<div>` 用它的 testid 或 id 表达）。 */
function focusedLabel(el: HTMLElement): string {
  const active = document.activeElement;
  if (active === null || active === document.body) return '（BODY，谁都没拿到焦点）';
  const own = el.contains(active) ? active : null;
  if (own === null) return '（焦点在夹具外面）';
  return (
    own.getAttribute('data-testid') ??
    own.id ??
    `${own.tagName.toLowerCase()}${own.className ? `.${String(own.className)}` : ''}`
  );
}

beforeEach(async () => {
  scrolledTo.length = 0;
  Element.prototype.scrollIntoView = function (this: Element): void {
    scrolledTo.push(this.getAttribute('id') ?? this.tagName);
  };
  __resetAuthForTests();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  __resetOpLogForTests();
  useTaskStore.setState({ entities: emptyState(), filter: { kind: 'all' } });
  await initOpLog(`anchor-focus-${Math.random().toString(36).slice(2)}`);
  useSyncStore.setState({ baseUrl: '', token: undefined, password: undefined });
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

describe('设置浮层的落位与焦点', () => {
  it('设置页先给出分组目录与立即可见的关闭出口', async () => {
    const el = await render();
    act(() => {
      useSyncStore.getState().openSettings();
    });

    const sheet = el.querySelector('[data-testid="settings-sheet"]')!;
    const nav = sheet.querySelector('nav.ht-settings__nav')!;
    expect(nav.querySelectorAll('a')).toHaveLength(7);
    expect(nav.querySelector('a[href="#settings-group-sync"]')).not.toBeNull();
    const close = sheet.querySelector('[data-testid="settings-sheet-close"]')!;
    expect(close.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sheet.querySelector('#settings-group-profile')).not.toBeNull();
    expect(sheet.querySelector('#settings-group-help')).not.toBeNull();
  });

  it('同步设置请求 ⇒ 浮层打开、滚到「同步」那一节、焦点在**服务端地址框**里', async () => {
    const el = await render();

    act(() => {
      useSyncStore.getState().openSettings();
    });

    expect(el.querySelector('[data-testid="settings-sheet"]'), '请求没打开设置浮层').not.toBeNull();
    expect(
      el.querySelector('[data-testid="sync-settings-panel"]'),
      '设置里没有「同步」那一节 ⇒ 那个请求只会打开一个不含它的浮层',
    ).not.toBeNull();
    expect(scrolledTo, `没滚到同步那一节，实际滚过：${scrolledTo.join(', ') || '（无）'}`).toContain(
      'settings-sync',
    );
    // 🔴 本文件的主要判据：焦点落在**该填的那个框**，而不是浮层容器。
    expect(focusedLabel(el), `焦点没给到地址框，实际在：${focusedLabel(el)}`).toBe(
      'sync-server-url',
    );
    expect(
      el.querySelector('.ht-sheet') === document.activeElement,
      '浮层容器把焦点抢回去了（落位 effect 必须声明在它之后）',
    ).toBe(false);
  });

  it('请求**取到即清** ⇒ 关掉设置之后再发一次，还能再落一次', async () => {
    const el = await render();

    act(() => {
      useSyncStore.getState().openSettings();
    });
    expect(useSyncStore.getState().syncSettingsRequested, '请求没被壳消费掉').toBe(false);
    click(el.querySelector('[data-testid="settings-sheet-close"]')!);
    scrolledTo.length = 0;

    act(() => {
      useSyncStore.getState().openSettings();
    });

    // 🔴 不清的话，store 里仍是 `true` ⇒ React 看不见变化 ⇒ effect 不重跑。
    // 症状是"第二次点「改用你自己的服务器」什么也没发生"，而第一次完全正常。
    expect(
      scrolledTo,
      '第二次请求没落地（请求没被消费掉的话就是这个形状）',
    ).toContain('settings-sync');
    expect(focusedLabel(el)).toBe('sync-server-url');
  });

  it('头像 →「编辑个人信息」⇒ 焦点真的进了昵称框（此前只滚不聚焦）', async () => {
    useSyncStore.setState({
      baseUrl: 'https://sync.example.test',
      token: 'token-from-login',
      email: 'you@example.test',
    });
    const el = await render();

    click(el.querySelector('[data-testid="account-menu-avatar"]')!);
    click(el.querySelector('[data-testid="account-menu-profile"]')!);

    expect(scrolledTo).toContain('settings-profile');
    // 这条钉的是"焦点也要一起给"那句话**现在**才成立 ——
    // 写这条用例之前它不成立，而没有任何一层会发现（没有人读 activeElement）。
    expect(focusedLabel(el), `焦点没进昵称框，实际在：${focusedLabel(el)}`).toBe(
      'profile-nickname-input',
    );
  });
});
