/**
 * 头像菜单与个人中心的统一账户 IA 判据
 * ====================================
 *
 * 挂**完整 App**，走真实头像 —— 与 `signin-entry.spec.tsx` 同一条纪律：
 * 自己拼一份 AccountMenu 的接线，测到的是夹具而不是产品。
 *
 * 未登录提供个人中心、应用设置、登录账号；已登录提供个人中心、应用设置、退出登录。
 * 资料编辑只从个人中心进入设置资料，成长不作为头像菜单动作。
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

// jsdom 没有布局引擎；个人中心返回“设置资料”时，宿主会滚动到设置锚点。
// 这里仅提供浏览器 API 的最小桩，菜单/返回路径本身仍走真实 App 接线。
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
  Element.prototype.scrollIntoView = function (): void {};
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

describe('身份菜单的统一账号 IA', () => {
  it('未登录时只保留个人中心、应用设置与登录账号', async () => {
    const el = await render();
    click(el.querySelector('[data-testid="account-menu-avatar"]')!);
    expect(document.querySelector('[data-testid="account-menu-profile"]')).toBeNull();
    expect(document.querySelector('[data-testid="account-menu-profile-center"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="account-menu-settings"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="sync-signin-entry"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="account-menu-signout"]')).toBeNull();
  });

  it('已登录时只显示个人中心、应用设置、退出登录，编辑不再直达', async () => {
    signIn();
    const el = await render();
    click(el.querySelector('[data-testid=' + '"account-menu-avatar"]')!);

    const items = Array.from(document.querySelectorAll('[role="menuitem"]')).map(
      (n) => n.getAttribute('data-testid') ?? '',
    );
    expect(items).toEqual(['account-menu-profile-center', 'account-menu-settings', 'account-menu-signout']);
  });
});

describe('头像菜单里的「个人中心」', () => {
  it('展示身份、近期状态与成就摘要，并把编辑动作交回设置', async () => {
    localStorage.setItem('heyta.shell.modules', JSON.stringify({ growth: true }));
    signIn();
    const el = await render();
    click(el.querySelector('[data-testid="account-menu-avatar"]')!);
    click(document.querySelector('[data-testid="account-menu-profile-center"]')!);

    expect(el.querySelector('[data-testid="profile-center"]')).not.toBeNull();
    expect(el.querySelector('.ht-settings__page-title')?.textContent).toContain('个人中心');
    expect(el.querySelector('#profile-center-identity-title')).not.toBeNull();
    expect(el.querySelector('#profile-center-recent-title')).not.toBeNull();
    expect(el.querySelector('[data-testid="profile-achievements"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="profile-panel"]')).toBeNull();

    click(el.querySelector('[data-testid="profile-center"] .ht-btn')!);
    expect(el.querySelector('[data-testid="profile-panel"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="settings-back-to-profile"]')).not.toBeNull();
  });

  it('成长模块关闭时，个人中心不绕过开关提供成长入口', async () => {
    localStorage.setItem('heyta.shell.modules', JSON.stringify({ growth: false }));
    signIn();
    const el = await render();
    click(el.querySelector('[data-testid="account-menu-avatar"]')!);
    click(document.querySelector('[data-testid="account-menu-profile-center"]')!);

    expect(el.querySelector('[data-testid="profile-center-growth"]')).toBeNull();
    expect(el.querySelector('[data-testid="profile-achievements"]')).toBeNull();
  });

  it('从个人中心进入设置后可以返回个人中心', async () => {
    signIn();
    const el = await render();
    click(el.querySelector('[data-testid="account-menu-avatar"]')!);
    click(document.querySelector('[data-testid="account-menu-profile-center"]')!);
    click(el.querySelector('[data-testid="profile-center-settings"]')!);

    expect(el.querySelector('[data-testid="settings-back-to-profile"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="profile-center"]')).toBeNull();

    click(el.querySelector('[data-testid="settings-back-to-profile"]')!);
    expect(el.querySelector('[data-testid="profile-center"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="settings-back-to-profile"]')).toBeNull();
  });
});
