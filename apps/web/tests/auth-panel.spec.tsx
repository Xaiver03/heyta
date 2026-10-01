/**
 * 登录 / 注册面板的界面测试
 * ============================
 *
 * 这里钉住的是两件事，而且**两件都必须能失败**：
 *
 *   1. **未登录时是明确的空状态** —— 不是"什么都不显示"，也不是假装成功；
 *   2. **拿到令牌之后真的接上了同步配置** —— 少了这一步，界面会显示"已登录"
 *      而同步仍然说未配置（本仓库反复记过的那种"界面说成功、功能没接上"）。
 *
 * 🔴 第 2 条由 `useSyncStore.getState().token` 的断言把关：把
 * `store.ts` 的 `applyAuthSession(...)` 那一行删掉，这一组立刻变红。
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

/** 有没有汉字。用于"两种语言都真的翻了"这一类断言。 */
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF]/;

/**
 * 这一组词条必须两种语言都有，且都真的翻了。
 *
 * 全局词条表由 `pnpm check:ui-language` 的规则 2/3/4 兜底；这里再钉住
 * **用户真会看到的那一批**，并且把它们写死，漏加一条不会悄悄溜过。
 */
const AUTH_MESSAGE_KEYS = [
  'web.auth.title',
  'web.auth.close',
  'web.auth.open',
  'web.auth.tokenHint',
  'web.auth.empty.title',
  'web.auth.empty.body',
  'web.auth.email.label',
  'web.auth.email.placeholder',
  'web.auth.sendLoginLink',
  'web.auth.register',
  'web.auth.terms.label',
  'web.auth.paste.label',
  'web.auth.paste.placeholder',
  'web.auth.verify',
  'web.auth.sent.login',
  'web.auth.sent.register',
  'web.auth.signedIn.title',
  'web.auth.signedIn.body',
  'common.auth.error.unconfigured',
  'common.auth.error.invalidInput',
  'common.auth.error.notAllowed',
  'common.auth.error.unauthorized',
  'common.auth.error.rateLimited',
  'common.auth.error.network',
  'common.auth.error.server',
  'common.auth.error.unknown',
] as const satisfies readonly MessageKey[];

const BASE_URL = 'https://sync.example.com';
const SESSION = { token: 'jwt-abc', user: { id: 3, email: 'me@example.com' } };

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let fetchMock: ReturnType<typeof vi.fn>;

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
  body: unknown;
}

let calls: FetchCall[];

/** 让 fetch 回一个指定响应，并记录调用。 */
function stubFetch(status: number, body?: unknown): void {
  calls = [];
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      init,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
      json: () => Promise.resolve(body),
    } as unknown as Response);
  });
  vi.stubGlobal('fetch', fetchMock);
}

async function renderPanel(locale: Locale = 'zh-CN'): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <I18nProvider locale={locale}>
        <AuthPanel baseUrl={BASE_URL} onClose={() => undefined} />
      </I18nProvider>,
    );
    await Promise.resolve();
  });
  return container;
}

function button(el: HTMLElement, key: MessageKey): HTMLButtonElement {
  const label = translate('zh-CN', key);
  const found = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(label));
  if (found === undefined) throw new Error(`没有找到按钮：${key}`);
  return found;
}

/**
 * 往受控输入框里"打字"。
 *
 * 🔴 直接 `input.value = x` 对 React 的受控组件**无效**（React 20 用 value tracker
 * 判定"是不是用户改的"），必须走原型上的原生 setter 再派发 input 事件。
 * 绕不过去就说明这条测试根本没在测界面接线 —— 它会一直绿。
 */
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

describe('未登录 / 未配置时是明确的空状态', () => {
  it('明说"还没有凭据"，并说清凭据怎么来 —— 不是一片空白', async () => {
    const el = await renderPanel('zh-CN');
    const text = el.textContent ?? '';

    expect(text).toContain(translate('zh-CN', 'web.auth.empty.title'));
    expect(text).toContain(translate('zh-CN', 'web.auth.empty.body'));
    // 空状态不能说成"已登录"。
    expect(text).not.toContain(translate('zh-CN', 'web.auth.signedIn.title'));
  });

  it('英文界面也是英文（不是中文漏出来）', async () => {
    const el = await renderPanel('en');
    const text = el.textContent ?? '';

    expect(text).toContain(translate('en', 'web.auth.empty.title'));
    expect(CJK.test(text)).toBe(false);
  });
});

describe('发登录链接', () => {
  it('点「发送登录链接」会打服务端端点，并如实说"链接已发出"', async () => {
    stubFetch(200, { message: 'If an account with that email exists…' });
    const el = await renderPanel('zh-CN');
    await typeInto(el, 'input[type="email"]', 'me@example.com');

    await act(async () => {
      button(el, 'web.auth.sendLoginLink').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${BASE_URL}/api/login/magic-link`);
    expect(calls[0]!.init?.method).toBe('POST');
    // 发信请求带上当前界面语言（邮件按收件人当前语言渲染）；逐字 toEqual 拦住多余字段。
    expect(calls[0]!.body).toEqual({ email: 'me@example.com', locale: 'zh-CN' });

    const text = el.textContent ?? '';
    expect(text).toContain(translate('zh-CN', 'web.auth.sent.login'));
    // 🔴 服务端用中性文案防邮箱枚举，所以界面**不许**说"账号存在"。
    expect(text).not.toContain(translate('zh-CN', 'web.auth.signedIn.title'));
  });
});

describe('🔴 拿到令牌之后必须真的接上同步配置', () => {
  it('验证登录链接会把令牌写进同步配置，并显示已登录', async () => {
    stubFetch(200, SESSION);
    const el = await renderPanel('zh-CN');

    let session: unknown;
    await act(async () => {
      session = await useAuthStore
        .getState()
        .verify(BASE_URL, 'https://sync.example.com/magic-login?token=tok-123');
      await Promise.resolve();
    });

    // 端点、方法、请求体都对。
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${BASE_URL}/api/login/magic-link/verify`);
    expect(calls[0]!.body).toEqual({ token: 'tok-123' });

    // 🔴 承重断言：令牌真的进了同步配置。
    // 把 `store.ts` 里的 `applyAuthSession(baseUrl, outcome.session)` 删掉 → 这里红。
    expect(useSyncStore.getState().token).toBe('jwt-abc');
    expect(useSyncStore.getState().baseUrl).toBe(BASE_URL);

    expect(session).toEqual(SESSION);
    const text = el.textContent ?? '';
    expect(text).toContain(translate('zh-CN', 'web.auth.signedIn.title'));
    expect(text).toContain('me@example.com');
  });

  it('写回令牌**不会**抹掉已经填过的加密口令', async () => {
    stubFetch(200, SESSION);
    // 用户先在同步设置里输了口令，再走认证 —— 口令必须原样留着。
    useSyncStore.setState({ password: 'a-strong-passphrase' });

    await act(async () => {
      await useAuthStore.getState().verify(BASE_URL, 'tok-123');
      await Promise.resolve();
    });

    expect(useSyncStore.getState().token).toBe('jwt-abc');
    expect(useSyncStore.getState().password).toBe('a-strong-passphrase');
  });
});

describe('🔴 失败绝不能被当成成功', () => {
  it('401（链接过期）→ 令牌不写、显示过期提示、状态是 failed', async () => {
    stubFetch(401, { error: 'Invalid or expired login link' });
    const el = await renderPanel('zh-CN');

    await act(async () => {
      await useAuthStore.getState().verify(BASE_URL, 'expired-token');
      await Promise.resolve();
    });

    expect(useSyncStore.getState().token).toBeUndefined();
    expect(useAuthStore.getState().status).toEqual({ kind: 'failed', reason: 'unauthorized' });

    const text = el.textContent ?? '';
    expect(text).toContain(translate('zh-CN', 'common.auth.error.unauthorized'));
    expect(text).not.toContain(translate('zh-CN', 'web.auth.signedIn.title'));
  });

  it('断网 → network 提示，令牌不写', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await renderPanel('zh-CN');

    await act(async () => {
      await useAuthStore.getState().verify(BASE_URL, 'tok-123');
      await Promise.resolve();
    });

    expect(useSyncStore.getState().token).toBeUndefined();
    expect(useAuthStore.getState().status).toEqual({ kind: 'failed', reason: 'network' });
  });

  it('服务端地址为空 → unconfigured，且一个请求都不发', async () => {
    stubFetch(200, SESSION);
    await renderPanel('zh-CN');

    await act(async () => {
      await useAuthStore.getState().sendLoginLink('', 'me@example.com');
      await Promise.resolve();
    });

    expect(calls).toHaveLength(0);
    expect(useAuthStore.getState().status).toEqual({ kind: 'failed', reason: 'unconfigured' });
  });

  it('粘贴的东西里没有令牌 → invalid-input，且一个请求都不发', async () => {
    stubFetch(200, SESSION);
    const el = await renderPanel('zh-CN');

    await act(async () => {
      // 一条**没有 token 参数**的链接：这正是"粘错了东西"的常见形状。
      await useAuthStore.getState().verify(BASE_URL, 'https://sync.example.com/magic-login?foo=bar');
      await Promise.resolve();
    });

    expect(calls).toHaveLength(0);
    expect(useAuthStore.getState().status).toEqual({ kind: 'failed', reason: 'invalid-input' });
    expect(el.textContent ?? '').toContain(translate('zh-CN', 'common.auth.error.invalidInput'));
  });
});

describe('注册：同意必须由用户自己勾', () => {
  it('没勾同意时，注册请求体里**不出现** termsAccepted', async () => {
    stubFetch(201, { message: 'Registration successful.' });
    const el = await renderPanel('zh-CN');
    await typeInto(el, 'input[type="email"]', 'me@example.com');

    await act(async () => {
      button(el, 'web.auth.register').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls[0]!.url).toBe(`${BASE_URL}/api/register/magic-link`);
    expect(calls[0]!.body).toEqual({ email: 'me@example.com', locale: 'zh-CN' });
    expect(Object.keys(calls[0]!.body as object)).not.toContain('termsAccepted');
    expect(el.textContent ?? '').toContain(translate('zh-CN', 'web.auth.sent.register'));
  });

  it('勾了同意才带上 termsAccepted: true', async () => {
    stubFetch(201, { message: 'Registration successful.' });
    const el = await renderPanel('zh-CN');
    await typeInto(el, 'input[type="email"]', 'me@example.com');

    const checkbox = el.querySelector('input[type="checkbox"]');
    expect(checkbox).not.toBeNull();
    await act(async () => {
      (checkbox as HTMLInputElement).click();
      await Promise.resolve();
    });

    await act(async () => {
      button(el, 'web.auth.register').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls[0]!.body).toEqual({
      email: 'me@example.com',
      termsAccepted: true,
      locale: 'zh-CN',
    });
  });
});

describe('词条：两种语言都真的翻了', () => {
  it('每一条认证词条在 zh 里含汉字、在 en 里不含汉字', () => {
    for (const key of AUTH_MESSAGE_KEYS) {
      const zh = translate('zh-CN', key);
      const en = translate('en', key);
      expect(zh, `${key} 的 zh 词条`).not.toBe('');
      expect(CJK.test(zh), `${key} 的 zh 词条没有汉字：${zh}`).toBe(true);
      expect(CJK.test(en), `${key} 的 en 词条里有汉字：${en}`).toBe(false);
    }
  });
});
