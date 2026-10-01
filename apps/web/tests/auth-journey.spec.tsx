/**
 * 注册旅程的形状（2026-10-01 重构）
 * =================================
 *
 * 产品负责人的原话是：**「绝对不允许什么用自己正在用的域名才能够注册，不可能是这样子的。」**
 *
 * 那之前这个面板上有两道墙，而且它们是**同一道墙的两面**：
 *
 *   1. `baseUrl === ''` 时先渲染一个**空的必填地址框** —— 于是"你知道自己的同步域名吗"
 *      成了注册的前置条件；
 *   2. 六个动作（发登录链接 / 注册 / 通行密钥注册 / 通行密钥登录 / 找回 / 粘贴完成）
 *      **并排同样重**，一个刚来的人看不出哪条是主路。
 *
 * 这里钉的是改完之后的**行为**，不是外观截图能代替的那类"看起来对了"：
 *
 *   - **未配置也必须发得出请求**（第 1 条）。把 `lib/auth-endpoint.ts` 的默认值拿掉，
 *     这一条立刻红 —— 因为空地址在 app-host 里是一个请求都不发 + `unconfigured`。
 *   - **主路上只有一个强调按钮，且它是注册**（第 2 条）。
 *   - **降级 ≠ 删掉**：登录、通行密钥三条、粘贴兜底全都还在 DOM 里。
 *     这是这一组里最容易做错的方向 —— 把次要动作删掉也能让"只有一个主按钮"变绿，
 *     所以每条降级都单独有一条"它必须还在"的断言。
 *   - **地址框是预填的、并且只在没配置时出现**：预填与空框是两种产品；
 *     而已配置时不再给第二个地址来源（唯一事实源是同步设置）。
 *
 * 全程零联网：`fetch` 一律 stub。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider, translate, type Locale, type MessageKey } from '@heyta/i18n';

import { AuthPanel } from '../src/features/auth/AuthPanel.js';
import { __resetAuthForTests, useAuthStore } from '../src/features/auth/store.js';
import { useSyncStore } from '../src/features/sync/store.js';

const BASE_URL = 'https://sync.example.com';

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let calls: { url: string }[];

function stubFetch(): void {
  calls = [];
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    calls.push({ url: String(input) });
    return Promise.resolve({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ message: 'ok' }),
    } as unknown as Response);
  });
  vi.stubGlobal('fetch', fetchMock);
}

async function renderPanelAtBaseUrl(
  baseUrl: string,
  locale: Locale = 'zh-CN',
): Promise<HTMLDivElement> {
  // 一条用例里会连开两三个面板（已配置 / 未配置 / 英文各一轮），先收掉上一个：
  // 光靠 afterEach 只能收最后一个，剩下的会挂在 document.body 上互相看不见，
  // 但 React 会为"同一棵树里多个 root"记警告，而警告会淹没真问题。
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <I18nProvider locale={locale}>
        <AuthPanel baseUrl={baseUrl} onClose={() => undefined} />
      </I18nProvider>,
    );
    await Promise.resolve();
  });
  return container;
}

function buttons(el: HTMLElement): HTMLButtonElement[] {
  return [...el.querySelectorAll('button')] as HTMLButtonElement[];
}

/** 按**词条**找按钮，不按视觉类名：降级之后它可能已经不是"一个按钮的样子"了。 */
function buttonByKey(el: HTMLElement, key: MessageKey): HTMLButtonElement {
  const label = translate('zh-CN', key);
  const found = buttons(el).find((b) => b.textContent?.includes(label));
  if (found === undefined) throw new Error(`没有找到按钮：${key}`);
  return found;
}

function emphasizedButtons(el: HTMLElement): HTMLButtonElement[] {
  return buttons(el).filter((b) => b.className.includes('ht-btn--primary'));
}

async function typeInto(el: HTMLElement, selector: string, value: string): Promise<void> {
  const input = el.querySelector(selector) as HTMLInputElement | null;
  if (input === null) throw new Error(`没有找到输入框：${selector}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('HTMLInputElement.value setter 不存在');
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  stubFetch();
  __resetAuthForTests();
  useSyncStore.setState({
    baseUrl: '',
    token: undefined,
    password: undefined,
    status: { kind: 'idle' },
    settingsOpen: false,
  });
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

describe('墙一：注册不许依赖"你知道自己的同步域名吗"', () => {
  it('🔴 什么都没配置时点注册，请求**真的发出去**，目标就是本机来源', async () => {
    const el = await renderPanelAtBaseUrl('');
    await typeInto(el, 'input[type="email"]', 'me@example.com');
    // 勾选框在这里**不是前置条件**：不勾它，注册照样发出去（服务端会拒，
    // 但那是它的一句话）。这一句同时挡住"顺手把主按钮 disabled 掉"的改法。
    await act(async () => {
      buttonByKey(el, 'web.auth.register').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${window.location.origin}/api/register/magic-link`);
    // 而且**不是**以 `unconfigured` 收场 —— 那正是旧代码的形态。
    expect(useAuthStore.getState().status.kind).toBe('registered');
  });

  it('地址框是**预填好**的，不是空着等用户填（空框与预填框是两种产品）', async () => {
    const el = await renderPanelAtBaseUrl('');
    const address = el.querySelector('input[inputmode="url"]') as HTMLInputElement | null;

    expect(address, '未配置时高级里要有自建部署的入口').not.toBeNull();
    expect(address!.value).toBe(window.location.origin);
    // 那句"不用你写"必须在：少了它，一个预填好的框读起来仍然是"这里要我核对域名"。
    expect(el.textContent ?? '').toContain(translate('zh-CN', 'web.auth.server.prefilled'));
  });

  it('已配置时**不给第二个地址来源**，但"这次会连到哪"仍然看得见', async () => {
    const el = await renderPanelAtBaseUrl(BASE_URL);

    expect(el.querySelector('input[inputmode="url"]')).toBeNull();
    expect(el.textContent ?? '').toContain(translate('zh-CN', 'web.auth.server.at', { baseUrl: BASE_URL }));
  });

  it('在高级里改地址，注册就发往改后的那台（自建部署是一条真的走得通的路）', async () => {
    const el = await renderPanelAtBaseUrl('');
    await typeInto(el, 'input[inputmode="url"]', `${BASE_URL}/`);
    await typeInto(el, 'input[type="email"]', 'me@example.com');
    await act(async () => {
      buttonByKey(el, 'web.auth.register').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 尾斜杠被归一掉了：`https://x//api/...` 与 `https://x/api/...` 在网关与缓存那里是两个地址。
    expect(calls[0]!.url).toBe(`${BASE_URL}/api/register/magic-link`);
  });
});

describe('墙二：六个并列按钮 → 一条主路', () => {
  it('强调按钮**只有一个**，它是注册', async () => {
    const el = await renderPanelAtBaseUrl(BASE_URL);
    const emphasized = emphasizedButtons(el).map((b) => b.textContent ?? '');

    // 「完成登录」（高级里的粘贴兜底）也是强调样式，所以这里按数量+身份一起钉：
    // 主路上不许再出现第二个与注册同重的邮箱动作。
    expect(emphasized.filter((text) => text.includes(translate('zh-CN', 'web.auth.register')))).toHaveLength(1);
    expect(emphasized.some((text) => text.includes(translate('zh-CN', 'web.auth.sendLoginLink')))).toBe(false);
  });

  it('🔴 「发送登录链接」**降级但没消失**：它是文字链，且仍在 DOM 里', async () => {
    const el = await renderPanelAtBaseUrl(BASE_URL);
    const loginLink = buttonByKey(el, 'web.auth.sendLoginLink');

    expect(loginLink.className).not.toContain('ht-btn');
    // 一句话把它放到主按钮之后（"已经有账号了？"），而不是并排摆第二个大按钮。
    expect(el.textContent ?? '').toContain(translate('zh-CN', 'web.auth.switchToSignin'));
  });

  it('通行密钥三条同样降级成文字链，**一条都不许掉**', async () => {
    const el = await renderPanelAtBaseUrl(BASE_URL);
    const keys = [
      'web.auth.passkey.register',
      'web.auth.passkey.login',
      'web.auth.recovery.request',
    ] as const;

    for (const key of keys) {
      const found = buttonByKey(el, key);
      expect(found.className, `${key} 应该已经是文字链`).not.toContain('ht-btn');
    }
    expect(el.textContent ?? '').toContain(translate('zh-CN', 'web.auth.passkey.group'));
  });

  it('「高级」默认折叠，但粘贴兜底**仍在 DOM 里**（折叠不是藏起来）', async () => {
    const el = await renderPanelAtBaseUrl(BASE_URL);
    const details = el.querySelector('details');

    expect(details, '高级整块必须是原生 details（键盘与屏幕阅读器原生可达）').not.toBeNull();
    expect(details!.hasAttribute('open')).toBe(false);
    expect(details!.querySelector('input')).not.toBeNull();
    expect(el.textContent ?? '').toContain(translate('zh-CN', 'web.auth.advanced'));
  });
});

describe('这一组句子两种语言都真的翻了', () => {
  const KEYS = [
    'web.auth.switchToSignin',
    'web.auth.passkey.group',
    'web.auth.advanced',
    'web.auth.server.prefilled',
    'web.auth.server.at',
  ] as const satisfies readonly MessageKey[];

  it('英文界面下不出现汉字，中文界面下不是英文漏过来', async () => {
    const en = await renderPanelAtBaseUrl(BASE_URL, 'en');
    const enText = en.textContent ?? '';
    for (const key of KEYS) {
      expect(translate('en', key).length, `${key} 缺英文`).toBeGreaterThan(0);
    }
    expect(/[\u3400-\u4DBF\u4E00-\u9FFF]/.test(enText), `英文界面里有汉字：${enText}`).toBe(false);

    // 已配置时可见的那几句（`server.prefilled` 按设计**只**在未配置时出现，另开一轮验）。
    const zh = await renderPanelAtBaseUrl(BASE_URL, 'zh-CN');
    for (const key of KEYS) {
      if (key === 'web.auth.server.prefilled') continue;
      // 带参数的词条要**渲染后**再比：拿裸模板比等于永远不相等（`{baseUrl}` 不会自己消失）。
      expect(zh.textContent ?? '').toContain(
        translate('zh-CN', key, { baseUrl: BASE_URL }),
      );
    }

    const zhUnconfigured = await renderPanelAtBaseUrl('', 'zh-CN');
    expect(zhUnconfigured.textContent ?? '').toContain(
      translate('zh-CN', 'web.auth.server.prefilled'),
    );
  });
});
