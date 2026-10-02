/**
 * 「注册 / 登录前置」判据 J1（W2）
 * =================================
 *
 * 产品要求：**注册登录一定要前置**。本仓对"前置"的落地解释写在
 * `docs/plans/user-journey-and-auth.md` §3.1。
 *
 * ## 🔴 2026-09-30 判据更新（产品负责人："应该是点击头像出来注册、登录吧？"）
 *
 * 入口从"头像**旁边**常驻的 pill"收进了**头像菜单的第一项**。理由与
 * `AccountMenu.tsx` 文件头一致：身份入口只能有一个，而那个 pill 让它变成了两个。
 *
 * 「前置」的**可执行**含义因此是：
 *   1. 冷启动首屏**身份入口可见且唯一**（头像）；
 *   2. **点一次**打开身份菜单 → 「登录 / 注册」是**第一项**（强调样式）；
 *   3. **再点一次**打开认证面板 —— 合计 2 次点击，远好过改动前的
 *      「齿轮 → 同步设置 → 按钮」三步；
 *   4. 未登录时菜单里**不出现「退出登录」**（那是已登录才存在的动作）；
 *   5. 已登录时菜单里**不出现「登录 / 注册」**（不给已登录的人看"去登录"）。
 *
 * 🔴 它防的回归：入口**退回设置深处**（改回同步设置对话框里 / 藏到设置页），
 * 或者**又长出第二个入口**（标题栏按钮 / 头像旁的 pill）。
 *
 * ⚠️ 2026-09-29 入口第一次搬家（产品负责人：身份动作该长在身份区 ——
 * 顶栏那块大主按钮撤了）时，夹具从"只挂 `SyncBar`"改为**挂完整 App**，
 * 现在仍然挂完整 App —— 判据必须走真实入口，不能在测试里自己拼一份接线。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetAuthForTests } from '../src/features/auth/store.js';
import { __resetOpLogForTests, initOpLog } from '../src/lib/oplog.js';
import { privacyConsentActions } from '../src/features/privacy/consent-gate.js';
import { useSyncStore } from '../src/features/sync/store.js';
import { useTaskStore } from '../src/features/tasks/store.js';
import { emptyState } from '@heyta/op-log';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');
// 🔴 用**线上同一个**壳（`main.tsx` 也用它）—— 在测试里自己拼 Provider 就是第二份接线。
import { LocaleHost } from '../src/lib/locale-host.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function render(): Promise<HTMLDivElement> {
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

/** 一次真实点击（含 React 的批处理刷新）。 */
function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function keydown(el: Element, key: string): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

/** 点开头像 —— 身份的**唯一**触发器。 */
function openAccountMenu(el: HTMLElement): void {
  const avatar = el.querySelector('[data-testid="account-menu-avatar"]');
  expect(avatar, '首屏必须有头像（身份入口）').not.toBeNull();
  click(avatar!);
}

beforeEach(async () => {
  __resetAuthForTests();
  // 🔴 每条用例**自己的库**：App 挂的是真 op-log，不换库会互相污染
  //（app-mount.spec.tsx 的 `freshDb` 记过同一条教训）。
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  __resetOpLogForTests();
  useTaskStore.setState({ entities: emptyState(), filter: { kind: 'all' } });
  await initOpLog(`signin-entry-${Math.random().toString(36).slice(2)}`);
  useSyncStore.setState({
    baseUrl: '',
    token: undefined,
    password: undefined,
    settingsOpen: false,
    signInOpen: false,
  });
  // 🔴 G-12（2026-10-01）：冷启动现在会弹首启隐私面板（`App.tsx` 的
  // `shouldAskOnFirstLaunch()`）。本文件钉的是**身份菜单**，它的隐含前提是
  // "这台设备已经做过隐私决定" —— 不先替用户点掉，第 3 条那句
  // 「点击之前还没有任何对话框」测的就是隐私面板而不是菜单。
  // 面板自己的判据在 `tests/privacy-consent-sheet.spec.tsx`。
  // ⚠️ 走生产代码 `privacyConsentActions.accept()`，不往 localStorage 手写自造串。
  privacyConsentActions.accept();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('J1：注册/登录在冷启动后可达，且身份入口唯一', () => {
  it('未登录时首屏只有头像这一个身份入口（不许再长第二个登录控件）', async () => {
    const el = await render();

    const avatar = el.querySelector('[data-testid="account-menu-avatar"]');
    expect(avatar).not.toBeNull();
    // 菜单关着 ⇒ 里面那项不在 DOM 里；首屏**没有**别的常驻登录入口。
    expect(el.querySelector('[data-testid="sync-signin-entry"]')).toBeNull();
  });

  it('🔴 一次点击打开身份菜单，「登录 / 注册」是**第一项**且带可见文案', async () => {
    const el = await render();

    openAccountMenu(el);

    const items = Array.from(el.querySelectorAll('[role="menuitem"]'));
    expect(items.length, '菜单里必须至少有一项').toBeGreaterThan(0);
    const first = items[0]!;
    expect(first.getAttribute('data-testid')).toBe('sync-signin-entry');
    // 它有明确的可见文案，不是一个只有图标的按钮 —— 图标按钮不算"看得见"
    expect(first.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    // 主操作要**看得出来是主操作**（与「设置 / 统计」同样的分量 = 入口被埋掉一半）
    expect(first.className).toContain('ht-accountmenu__item--primary');
  });

  it('🔴 再点一次就打开注册/登录表单（合计 2 次点击，这就是"前置"的全部含义）', async () => {
    const el = await render();

    // 点击之前：还没有任何对话框
    expect(el.querySelector('[role="dialog"]')).toBeNull();

    openAccountMenu(el);
    click(el.querySelector('[data-testid="sync-signin-entry"]')!);

    // 🔴 必须**直接**出现认证面板。改动前这里会失败：
    // 那时唯一入口是齿轮，点它只会打开「同步设置」，认证还要再点一次。
    const dialog = el.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    // 用认证面板自己的 aria-label 确认"开的是认证面板，不是同步设置" ——
    // 只断言"有个 dialog"会被同步设置对话框骗过。
    expect(dialog!.getAttribute('aria-label')).toBe('登录 / 注册');
  });

  it('未登录时菜单里**不出现**「退出登录」（没登录就没有可退的）', async () => {
    const el = await render();

    openAccountMenu(el);

    expect(el.querySelector('[data-testid="account-menu-signout"]')).toBeNull();
  });

  it('已登录时不再显示登录入口，但「退出登录」出现且在最底', async () => {
    useSyncStore.setState({ baseUrl: 'https://sync.example', token: 'JWT', email: 'me@example.com' });
    const el = await render();

    openAccountMenu(el);

    expect(el.querySelector('[data-testid="sync-signin-entry"]')).toBeNull();
    const items = Array.from(el.querySelectorAll('[role="menuitem"]'));
    const last = items[items.length - 1]!;
    expect(last.getAttribute('data-testid')).toBe('account-menu-signout');
    // 危险动作：颜色要说清这件事（见 app.css 的 `--danger` 规则）
    expect(last.className).toContain('ht-accountmenu__item--danger');
  });

  it('键盘可达：↓ 打开菜单并把焦点落在第一项，Esc 关掉并把焦点还给头像', async () => {
    const el = await render();

    const avatar = el.querySelector<HTMLButtonElement>('[data-testid="account-menu-avatar"]')!;
    keydown(avatar, 'ArrowDown');

    const first = el.querySelector<HTMLButtonElement>('[data-testid="sync-signin-entry"]');
    expect(first, '↓ 应当打开菜单').not.toBeNull();
    expect(document.activeElement).toBe(first);

    // Esc 挂在菜单上（焦点在菜单里）—— 关掉之后焦点要回到触发器，
    // 否则键盘用户被丢在 document.body 上，下一次 Tab 从页首开始。
    keydown(first!, 'Escape');
    expect(el.querySelector('[data-testid="sync-signin-entry"]')).toBeNull();
    expect(document.activeElement).toBe(avatar);
  });

  it('未配置服务端时，认证面板自己提供地址输入（两次点击仍然够）', async () => {
    const el = await render();
    expect(useSyncStore.getState().baseUrl).toBe('');

    openAccountMenu(el);
    click(el.querySelector('[data-testid="sync-signin-entry"]')!);

    // 面板里必须有一个地址输入，否则用户在点开之后无处可填服务端，
    // "前置"就变成了"前置到一个走不通的表单"。
    const inputs = Array.from(el.querySelectorAll('input'));
    expect(inputs.some((i) => i.getAttribute('type') === 'url')).toBe(true);
  });

  it('已配置服务端时，认证面板**不**再多要一次地址（不制造第二个地址来源）', async () => {
    useSyncStore.setState({ baseUrl: 'https://sync.example', token: undefined });
    const el = await render();

    openAccountMenu(el);
    click(el.querySelector('[data-testid="sync-signin-entry"]')!);

    const inputs = Array.from(el.querySelectorAll('input'));
    expect(inputs.some((i) => i.getAttribute('type') === 'url')).toBe(false);
  });
});
