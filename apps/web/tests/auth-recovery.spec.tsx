/**
 * 找回通行密钥：**入口**的接线
 * ==============================
 *
 * `auth-passkey.spec.tsx` 钉的是"注册/登录通行密钥"，但那条路有个前提：
 * **用户还拿得到自己的通行密钥**。丢了之后呢？
 *
 * 这个问题的答案曾经是"没有答案"：
 *   - 服务端 `POST /api/recover/passkey` 是完整实现；
 *   - `@heyta/app-host` 的 `requestPasskeyRecovery` 也是完整实现；
 *   - **两边零调用方** ⇒ 用户丢了自己的通行密钥，**界面上没有任何入口**能拿到恢复链接。
 *
 * 也就是本仓库反复记过的那类缺陷：**功能做完了、用户做不到**。
 * 而它比"没做"更隐蔽 —— 门禁全绿、测试全绿、代码覆盖率里那两处还"被覆盖"了
 * （被它们自己的单测覆盖）。
 *
 * ## 分层：入口在这里，恢复本身不在这里
 *
 * 恢复本身（拿邮件里的令牌**注册一个新通行密钥**）由服务端渲染的
 * `/recover-passkey` 页面 + `recover-passkey.js` 完成 —— 那一步必须在真实浏览器里
 * 调 `navigator.credentials.create()`，不可能放进这个面板。
 * 所以本文件只钉**触发那封邮件**这一段，并且明确不假装钉了另一端。
 *
 * ⚠️ 2026-10-02：表单改成两步（邮箱 → 「继续」→ 口令），**恢复入口在第二步**。
 * 这不是措辞变化，是一条真实的可发现性代价：丢了通行密钥的人必须先走过"填邮箱"
 * 才看得见找回那一句。所以这一组判据现在**每次都把两步走完** —— 它钉的仍然是
 * "入口存在"，只是把"存在"定义为"用户真能点到的那个屏幕上存在"。
 *
 * 全程零联网：`fetch` 一律 stub。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider, translate, type Locale, type MessageKey } from '@heyta/i18n';

import { AuthPanel } from '../src/features/auth/AuthPanel.js';
import { __resetAuthForTests, useAuthStore } from '../src/features/auth/store.js';

const BASE_URL = 'https://sync.example.com';
const EMAIL = 'me@example.com';

interface FetchCall {
  url: string;
  body: unknown;
}

let calls: FetchCall[];

function stubFetch(status: number, body?: unknown): void {
  calls = [];
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
      json: () => Promise.resolve(body),
    } as unknown as Response);
  });
  vi.stubGlobal('fetch', mock);
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

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

/** 与 auth-panel.spec.tsx 同款：React 受控输入必须走原型 setter。 */
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

/**
 * 走过第一步（邮箱 → 「继续」）。
 *
 * 🔴 2026-10-02：表单改成两步之后，**所有二级入口**（通行密钥 / 邮件链接 / 找回 /
 * 粘贴兜底）都只在第二屏出现 —— 那是"一次只问一件事"的代价，也是这一组判据
 * 必须跟着改写的地方。这里的 `auth-form-email` 选择器是**故意**写成共享表单的
 * testID：它由 `@heyta/ui` 那份实现给出，各端共用，不是 web 自己的一套 DOM。
 */
async function toCredentialStage(el: HTMLElement, email = EMAIL): Promise<void> {
  await typeInto(el, '[data-testid="auth-form-email"]', email);
  await act(async () => {
    (el.querySelector('[data-testid="auth-form-continue"]') as HTMLButtonElement).click();
    await Promise.resolve();
  });
}

beforeEach(() => {
  __resetAuthForTests();
  stubFetch(200, { message: 'If an account with that email exists, a recovery link has been sent.' });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
  __resetAuthForTests();
});

describe('store：requestRecovery 真的打服务端的恢复端点', () => {
  it('打到 /api/recover/passkey，带上邮箱，并把状态置成 recovery-sent', async () => {
    stubFetch(200, { message: 'If an account with that email exists, a recovery link has been sent.' });

    await act(async () => {
      await useAuthStore.getState().requestRecovery(BASE_URL, EMAIL);
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${BASE_URL}/api/recover/passkey`);
    expect(calls[0]!.body).toEqual({ email: EMAIL, locale: 'zh-CN' });
    expect(useAuthStore.getState().status).toEqual({ kind: 'recovery-sent' });
  });

  /**
   * 🔴 这一条是**承重**的：服务端用中性文案防邮箱枚举，
   * 所以"没这个邮箱"和"发出去了"返回**同一个** 200。
   * 界面不许把它说成"已发送到这个邮箱" —— 只能照抄中性的说法。
   */
  it('成功的是中性响应，不是"邮箱存在"的证据', async () => {
    stubFetch(200, { message: 'If an account with that email exists, a recovery link has been sent.' });

    await act(async () => {
      await useAuthStore.getState().requestRecovery(BASE_URL, EMAIL);
    });

    expect(useAuthStore.getState().status).toEqual({ kind: 'recovery-sent' });
    // 状态里**不许**带任何"邮箱存在与否"的字段。
    expect(JSON.stringify(useAuthStore.getState().status)).not.toContain('exists');
  });

  it('失败时是 failed + 结构化原因，**不是** recovery-sent（不许把失败说成成功）', async () => {
    stubFetch(500, { error: 'boom' });

    await act(async () => {
      await useAuthStore.getState().requestRecovery(BASE_URL, EMAIL);
    });

    const status = useAuthStore.getState().status;
    expect(status.kind).toBe('failed');
    expect(status.kind === 'failed' && status.reason).toBe('server-error');
  });

  /**
   * 🔴 空输入**在本地就能判定**，所以一个请求都不发 ——
   * 发出去只会把"本地就确定的错误"伪装成一次失败的网络请求
   * （与通行密钥注册/登录同一条纪律）。
   *
   * ⚠️ 但**格式**判定不在客户端：`normalizedEmail` 只拒绝空串，
   * `'not-an-email'` 会照发。这是**故意的** —— 邮箱格式规则只应有一份，
   * 它在服务端的 schema 里；客户端再实现一遍就是第二份，迟早漂移。
   * 下面两条分别钉住这两半，别把它们混成一条"非法邮箱不发请求"。
   */
  it('空邮箱一个请求都不发，直接判 invalid-input', async () => {
    await act(async () => {
      await useAuthStore.getState().requestRecovery(BASE_URL, '   ');
    });

    expect(calls).toHaveLength(0);
    const status = useAuthStore.getState().status;
    expect(status.kind === 'failed' && status.reason).toBe('invalid-input');
  });

  it('格式错的邮箱**会**发给服务端，由服务端的 400 归成 invalid-input', async () => {
    stubFetch(400, { error: 'Validation failed' });

    await act(async () => {
      await useAuthStore.getState().requestRecovery(BASE_URL, 'not-an-email');
    });

    expect(calls, '格式判定属于服务端，客户端不该自己拦').toHaveLength(1);
    const status = useAuthStore.getState().status;
    expect(status.kind === 'failed' && status.reason).toBe('invalid-input');
  });
});

describe('面板：入口按钮真的存在，而且真的接上了 store', () => {
  it('面板里有恢复入口按钮（不是"功能做了但没入口"）', async () => {
    const el = await renderPanel('zh-CN');
    await toCredentialStage(el);
    expect(button(el, 'web.auth.recovery.request')).toBeTruthy();
  });

  it('点它真的会打恢复端点，并在界面上说出"已发出"', async () => {
    const el = await renderPanel('zh-CN');
    await toCredentialStage(el);

    stubFetch(200, { message: 'If an account with that email exists, a recovery link has been sent.' });
    await act(async () => {
      button(el, 'web.auth.recovery.request').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls.map((c) => c.url)).toContain(`${BASE_URL}/api/recover/passkey`);
    expect(el.textContent).toContain(translate('zh-CN', 'web.auth.sent.recovery'));
  });

  it('英文界面下同一个按钮用的是英文文案，不是中文', async () => {
    const el = await renderPanel('en');
    await toCredentialStage(el, 'me@example.com');
    const label = translate('en', 'web.auth.recovery.request');
    const found = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(label),
    );
    expect(found, '英文界面里没有英文的恢复入口').toBeTruthy();
  });
});

describe('词条：找回通行密钥的文案两种语言都真的翻了', () => {
  const keys = [
    'web.auth.recovery.request',
    'web.auth.sent.recovery',
  ] as const satisfies readonly MessageKey[];

  it('zh 里含汉字、en 里不含汉字，且两边都不为空', () => {
    for (const key of keys) {
      const zh = translate('zh-CN', key);
      const en = translate('en', key);
      expect(zh, `${key} 的 zh 是空的`).not.toBe('');
      expect(en, `${key} 的 en 是空的`).not.toBe('');
      expect(zh, `${key} 的 zh 里没有汉字`).toMatch(/[\u4e00-\u9fff]/);
      expect(en, `${key} 的 en 里混进了汉字`).not.toMatch(/[\u4e00-\u9fff]/);
    }
  });
});
