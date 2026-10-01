/**
 * 账号语言在 web 的两端（应用语言解析链第 2 层，2026-10-01 拍板）：
 *
 *   - 读侧：登录成功（所有路径汇聚的 `applyAuthSession`）时，本机**没有**显式选择
 *     才采纳 `user.locale`；有显式选择则绝不覆盖（第 1 层 > 第 2 层）。
 *     采纳必须**当场**切换界面（经 `subscribeLocale` 进 LocaleHost），不是只写存储。
 *   - 写侧：`pushLocaleToAccount` 登录态下 PUT 回账号；未登录/未配置时一个请求都不发。
 */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useI18n } from '@heyta/i18n';

import { useAuthStore, __resetAuthForTests } from '../src/features/auth/store.js';
import { useSyncStore } from '../src/features/sync/store.js';
import { pushLocaleToAccount } from '../src/lib/locale-account.js';
import { LocaleHost } from '../src/lib/locale-host.js';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const BASE_URL = 'https://sync.example.com';

interface FetchCall {
  url: string;
  method: string | undefined;
  headers: Record<string, string> | undefined;
  body: unknown;
}
let calls: FetchCall[] = [];

function stubFetch(status: number, body?: unknown): void {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method,
        headers: init?.headers as Record<string, string> | undefined,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      return Promise.resolve({
        status,
        ok: status >= 200 && status < 300,
        json: () => Promise.resolve(body),
      } as unknown as Response);
    }),
  );
}

/** 挂 LocaleHost + 一个读 useI18n 的探针 —— 证明采纳能**当场**切换界面。 */
function Probe(): React.JSX.Element {
  const { locale } = useI18n();
  return <div data-testid="locale-probe">{locale}</div>;
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function mount(): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <LocaleHost>
        <Probe />
      </LocaleHost>,
    );
  });
  return container;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = '';
  __resetAuthForTests();
  useSyncStore.setState({ baseUrl: '', token: undefined, password: '' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => {
    root?.unmount();
  });
  root = undefined;
  container?.remove();
  container = undefined;
});

describe('登录后采纳账号语言（applyAuthSession 的读侧）', () => {
  it('本机无显式选择 ⇒ 采纳：落盘 + <html lang> + 界面当场切换', async () => {
    const el = mount();
    // setup.ts 把 jsdom 的 navigator.language 钉成 zh-CN：首启是中文。
    expect(el.querySelector('[data-testid="locale-probe"]')?.textContent).toBe('zh-CN');

    stubFetch(200, { token: 'jwt-abc', user: { id: 3, email: 'me@example.com', locale: 'en' } });
    await act(async () => {
      await useAuthStore.getState().verify(BASE_URL, 'tok-123');
    });

    // 三个落点一个都不能少：只写存储不切界面 = "要刷新才生效"，那是半成品。
    expect(el.querySelector('[data-testid="locale-probe"]')?.textContent).toBe('en');
    expect(localStorage.getItem('heyta.locale')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('🔴 本机已有显式选择 ⇒ 账号语言绝不覆盖（第 1 层永远更高）', async () => {
    localStorage.setItem('heyta.locale', 'zh-CN');
    const el = mount();
    expect(el.querySelector('[data-testid="locale-probe"]')?.textContent).toBe('zh-CN');

    stubFetch(200, { token: 'jwt-abc', user: { id: 3, email: 'me@example.com', locale: 'en' } });
    await act(async () => {
      await useAuthStore.getState().verify(BASE_URL, 'tok-123');
    });

    expect(el.querySelector('[data-testid="locale-probe"]')?.textContent).toBe('zh-CN');
    expect(localStorage.getItem('heyta.locale')).toBe('zh-CN');
  });

  it('服务端不带 locale（老版本/未设置） ⇒ 什么都不动', async () => {
    const el = mount();
    stubFetch(200, { token: 'jwt-abc', user: { id: 3, email: 'me@example.com' } });
    await act(async () => {
      await useAuthStore.getState().verify(BASE_URL, 'tok-123');
    });
    expect(el.querySelector('[data-testid="locale-probe"]')?.textContent).toBe('zh-CN');
    expect(localStorage.getItem('heyta.locale')).toBeNull();
  });
});

describe('pushLocaleToAccount（语言切换器的写侧）', () => {
  it('未登录/未配置 ⇒ 一个请求都不发', async () => {
    stubFetch(200, {});
    await pushLocaleToAccount('en');
    expect(calls).toHaveLength(0);
  });

  it('登录态 ⇒ PUT /api/account/locale，带 Bearer 与语言', async () => {
    useSyncStore.setState({ baseUrl: BASE_URL, token: 'jwt-tok' });
    stubFetch(200, { locale: 'en' });
    await pushLocaleToAccount('en');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE_URL}/api/account/locale`);
    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.headers?.['authorization']).toBe('Bearer jwt-tok');
    expect(calls[0]?.body).toEqual({ locale: 'en' });
  });
});
