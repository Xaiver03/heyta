/**
 * 设置里的「同步」一节：**输入框必须与已保存的配置对齐**
 * ======================================================
 *
 * ## 它钉住的是一个真实缺陷（2026-09-30 由 Windows 桌面壳旅程验收 W3 抓到）
 *
 * 用户真实路径：
 *
 *   点头像 → 登录 / 注册 → 打开 设置 → 同步 → 补端到端加密口令 → 保存并同步
 *
 * 而口令**从不落盘**（`sync/store.ts` 的安全取舍），所以每个新会话用户都要再走一次。
 * 这条路径曾经是**破坏性**的：
 *
 *   - `SyncBar` 里的 `baseUrl` / `token` / `password` 是**局部 state**，
 *     初值只在组件**挂载**那一刻取一次；
 *   - 而 `SyncBar` 是常驻顶栏，冷启动时 `sync.baseUrl` 还是空的，
 *     登录把它写进 store 之后**局部 state 不会跟着更新**；
 *   - 于是「保存并同步」调用 `sync.configure('', token, password)`，
 *     把**空地址**写进内存配置 ⇒ 状态条当场变成"还没配置"。
 *
 * 磁盘上的凭据没被覆盖（`configure` 只在两者都非空时才落盘），
 * 所以刷新一次又能好 —— 这正是最难归因的那种形态：**看着像网络问题**。
 *
 * ## 2026-10-06（H9 第 3 刀）之后这条判据测的是哪一个不变量
 *
 * 表单不再是对话框，它住在 `SyncSettingsPanel.tsx`，随设置浮层挂载/卸载。
 * "局部 state 停在过期快照上"这个**风险本身没有消失**，只是换了载体：
 * 草稿现在在 store 里（`syncDraft`），它必须由**写配置的那三个动作**一起推进 ——
 * `configure`（用户自己保存）、`applyAuthToken`（登录成功）、`clearCredentials`（登出）。
 * 少写其中任何一个，都会长出同一个缺陷的另一半：
 *
 *   · 少 `applyAuthToken` ⇒ 登录完回到还开着的那一节，框里是空的 ⇒ 保存把地址抹掉；
 *   · 少 `configure` ⇒ 配置已生效、框里还留着上一次的内容；
 *   · 少 `clearCredentials` ⇒ 下一个人（另一个账号）拿着**上一个人的令牌**去保存。
 *
 * 🔴 所以判据不看"输入框里有字"这一层就算完 —— 真正的判据是
 * **保存之后 store 没被清空**，而下面三条各自打一次上面三个动作之一。
 * 变异验证：把 `store.ts` 里对应那一半草稿镜像删掉，本文件对应那条必须转红。
 *
 * 全程零联网：`fetch` 一律 stub。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@heyta/i18n';

import { SyncSettingsPanel } from '../src/features/sync/SyncSettingsPanel.js';
import { useSyncStore } from '../src/features/sync/store.js';

const SERVER = 'https://sync.example.test';
const TOKEN = 'token-from-login';
const PASSWORD = 'e2ee-passphrase';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // 同步 store 是模块级单例 —— 不重置的话用例之间会互相带状态。
  localStorage.clear();
  act(() => {
    const sync = useSyncStore.getState();
    sync.closeSettings();
    sync.closeSignIn();
    useSyncStore.setState({
      baseUrl: undefined,
      token: undefined,
      password: undefined,
      email: undefined,
      accountId: undefined,
      status: { kind: 'idle' },
      // 🔴 本文件只关心**这一节字段的对齐**，不关心真的同步。
      //    jsdom 里没有 op-log 引擎，真实的 `syncNow()` / 实时通道会抛
      //    `op-log 引擎尚未初始化` —— 那是**环境**，不是被测行为，
      //    让它冒出来会变成"用例通过但报 2 个错"，比失败还难读。
      syncNow: async () => ({ kind: 'idle' }),
      startRealtime: () => undefined,
    });
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root.render(
      <I18nProvider locale="zh-CN">
        <SyncSettingsPanel />
      </I18nProvider>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/** 触发一次 React 状态更新并等它落地。 */
const flush = () => act(async () => undefined);

/** 面板里当前显示的那几个输入框的值。 */
function fieldValues(): string[] {
  return [...container.querySelectorAll('input')].map((el) => el.value);
}

function saveButton(): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find(
    (b) => b.textContent === '保存并同步',
  );
}

describe('设置 → 同步 那一节的输入框对齐', () => {
  it('登录发生在面板挂载**之后**时，框里必须显示已保存的地址与令牌', async () => {
    // 冷启动：面板已挂载，此时还没有任何凭据。
    expect(useSyncStore.getState().baseUrl ?? '').toBe('');

    // 模拟"点头像登录成功" —— 认证 store 把令牌写进同步配置（挂载之后）。
    act(() => {
      useSyncStore.getState().applyAuthToken(SERVER, TOKEN, 'a@example.test');
    });
    await flush();

    const values = fieldValues();
    expect(values, '地址输入框必须显示已保存的服务端地址').toContain(SERVER);
    expect(values, '令牌输入框必须已经填上刚拿到的令牌').toContain(TOKEN);
  });

  it('面板开着时点「保存并同步」**不得**把已配置的同步清空（那条缺陷的判据）', async () => {
    act(() => {
      useSyncStore.getState().applyAuthToken(SERVER, TOKEN, 'a@example.test');
    });
    await flush();

    const save = saveButton();
    expect(save, '找不到「保存并同步」按钮').toBeDefined();

    act(() => {
      save?.click();
    });
    await flush();

    // 🔴 判据本体：保存之后配置**还在**。
    //    缺陷版本会在这里得到 baseUrl === ''（同步变成"还没配置"）。
    const after = useSyncStore.getState();
    expect(after.baseUrl, '保存不得清空服务端地址').toBe(SERVER);
    expect(after.token, '保存不得清空访问令牌').toBe(TOKEN);
  });

  it('已经建立的口令在"进这一节 → 保存"之后仍然保留', async () => {
    act(() => {
      useSyncStore.getState().configure(SERVER, TOKEN, PASSWORD);
    });
    await flush();

    // 重新挂载一次 = 用户关掉设置再进来。播种必须按**当前配置**做。
    act(() => root.unmount());
    root = createRoot(container);
    act(() => {
      root.render(
        <I18nProvider locale="zh-CN">
          <SyncSettingsPanel />
        </I18nProvider>,
      );
    });
    await flush();

    const save = saveButton();
    act(() => {
      save?.click();
    });
    await flush();

    expect(
      useSyncStore.getState().password,
      '口令只在内存里，一次"进出这一节 → 保存"不得把它抹掉',
    ).toBe(PASSWORD);
  });

  it('登出之后框里不许留着**上一个人**的令牌（否则下一次保存会把它写回去）', async () => {
    act(() => {
      useSyncStore.getState().configure(SERVER, TOKEN, PASSWORD);
    });
    await flush();
    expect(fieldValues(), '前置条件：登出之前令牌确实在框里').toContain(TOKEN);

    act(() => {
      useSyncStore.getState().clearCredentials();
    });
    await flush();

    expect(fieldValues(), '登出后框里还留着旧令牌').not.toContain(TOKEN);
    expect(fieldValues(), '登出后框里还留着旧口令').not.toContain(PASSWORD);
  });
});
