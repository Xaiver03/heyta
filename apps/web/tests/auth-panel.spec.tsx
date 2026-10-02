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
 * ## 2026-10-02：表单本体换成共享的 `AuthForm`，这一组改的是**寻址方式**
 *
 * 面板现在是薄壳（字段、两步、显隐开关都在 `@heyta/ui`）。所以：
 *
 *   - 输入框一律按 `data-testid="auth-form-*"` 找 —— 那是**四端共用**的契约，
 *     不是 web 自己的一套 DOM；原来那些 `input[type="checkbox"]` 之类的选择器
 *     钉的是"web 恰好这么写"，共享实现一换就整片红，而红的原因与判断无关。
 *   - 二级入口（邮件链接、找回、粘贴兜底）在第二步才出现，所以每条都先走
 *     邮箱 → 「继续」（理由与代价见 `auth-recovery.spec.tsx` 文件头）。
 *   - 同意项不再是 `<input type=checkbox>` 而是 `role="checkbox"` + `aria-checked`：
 *     **判定一个字没改**（没勾就不该发出去），改的只是怎么读出"勾了没有"。
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
 *
 * ⚠️ `common.auth.form.*` 那几条是 2026-10-02 随共享表单加进来的：它们现在
 * 直接出现在这个面板上（「继续」「登录密码」「长一句比加符号有用」…），
 * 所以它们**是**界面文案，不再只是共享层的内部词汇。
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
  // 两条链接的文字本身也是文案，也得两种语言都真翻了。
  'common.legal.termsDoc',
  'common.legal.privacyDoc',
  'web.auth.paste.label',
  'web.auth.paste.placeholder',
  'web.auth.verify',
  'web.auth.sent.login',
  'web.auth.sent.register',
  'web.auth.signedIn.title',
  'web.auth.signedIn.body',
  'web.auth.server.at',
  'web.auth.server.prefilled',
  'web.auth.invite.label',
  'web.auth.invite.invalid',
  'common.auth.form.continue',
  'common.auth.form.accountSummary',
  'common.auth.form.signIn',
  'common.auth.form.showPassword',
  'common.auth.form.hidePassword',
  'common.auth.form.passwordHint',
  'common.auth.form.forgotPassword',
  'common.auth.form.switchToRegister',
  'common.auth.form.switchToSignIn',
  'common.auth.form.otherWays',
  'common.auth.signInPassword.label',
  'common.auth.error.unconfigured',
  'common.auth.error.invalidInput',
  'common.auth.error.notAllowed',
  'common.auth.error.unauthorized',
  'common.auth.error.rateLimited',
  'common.auth.error.network',
  'common.auth.error.server',
  'common.auth.error.unknown',
  'common.auth.error.termsRequired',
] as const satisfies readonly MessageKey[];

const BASE_URL = 'https://sync.example.com';
const SESSION = { token: 'jwt-abc', user: { id: 3, email: 'me@example.com' } };
const EMAIL = 'me@example.com';
/** 一句合规格（≥8 码点）且不泄露的口令；这里的值不参与任何判定，只是别空着。 */
const PASSWORD = 'correct horse battery';

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
function stubFetch(
  status: number,
  body?: unknown,
  headers?: Record<string, string>,
): void {
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
      // 🔴 `headers` 不是可选的装饰：`Retry-After` 就在头上，app-host 只从头上读。
      // 不给这个字段，"被锁了多久"那句话在任何测试里都永远取不到秒数 ——
      // 于是"界面印出字面量 `{seconds}`"这种回归可以一路全绿。
      headers: new Headers(headers),
      json: () => Promise.resolve(body),
    } as unknown as Response);
  });
  vi.stubGlobal('fetch', fetchMock);
}

async function renderPanel(locale: Locale = 'zh-CN'): Promise<HTMLDivElement> {
  return renderPanelAtBaseUrl(BASE_URL, locale);
}

/**
 * 同上，但**服务端地址由参数给**。
 *
 * 条款链接的分流判的就是这个地址，所以必须能在三种形状下渲染同一个面板：
 * 官方域、别的 host、还没填。
 */
async function renderPanelAtBaseUrl(
  baseUrl: string,
  locale: Locale = 'zh-CN',
): Promise<HTMLDivElement> {
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

/** 面板里的条款链接，按文档顺序返回 `[《服务条款》, 《隐私政策》]`。 */
function legalAnchors(el: HTMLElement): HTMLAnchorElement[] {
  return [...el.querySelectorAll('a[href]')] as HTMLAnchorElement[];
}

function button(el: HTMLElement, key: MessageKey): HTMLButtonElement {
  const label = translate('zh-CN', key);
  const found = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(label));
  if (found === undefined) throw new Error(`没有找到按钮：${key}`);
  return found;
}

function byTestId(el: HTMLElement, testId: string): HTMLElement {
  const found = el.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  if (found === null) throw new Error(`没有找到元素：${testId}`);
  return found;
}

async function tap(el: HTMLElement, testId: string): Promise<void> {
  await act(async () => {
    byTestId(el, testId).click();
    await Promise.resolve();
    await Promise.resolve();
  });
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

async function typeById(el: HTMLElement, testId: string, value: string): Promise<void> {
  await typeInto(el, `[data-testid="${testId}"]`, value);
}

/** 邮箱 → 「继续」，停在第二步的**登录档**。 */
async function toCredential(el: HTMLElement, email = EMAIL): Promise<void> {
  await typeById(el, 'auth-form-email', email);
  await tap(el, 'auth-form-continue');
}

/** 再切到**注册档**（同意项与邀请码在那一档才出现）。 */
async function toRegister(el: HTMLElement, email = EMAIL): Promise<void> {
  await toCredential(el, email);
  await tap(el, 'auth-form-switch-mode');
}

/** 同意项当前勾没勾（`role=checkbox` 的 `aria-checked`）。 */
function termsChecked(el: HTMLElement): string | null {
  return byTestId(el, 'auth-form-terms').getAttribute('aria-checked');
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

describe('🔴 口令这条路在界面上**可达**（此前它是"做了但点不到"）', () => {
  it('登录：填邮箱 → 继续 → 填口令 → 提交，打到 `/api/login/email-password` 并把令牌接上同步', async () => {
    stubFetch(200, SESSION);
    const el = await renderPanel('zh-CN');

    await toCredential(el);
    await typeById(el, 'auth-form-password', PASSWORD);
    await tap(el, 'auth-form-submit');

    expect(calls.map((c) => c.url)).toContain(`${BASE_URL}/api/login/email-password`);
    // 口令**原样**交出：不 trim、不改大小写（归一化只有服务端那一份）。
    expect(calls.find((c) => c.url.endsWith('/login/email-password'))!.body).toEqual({
      email: EMAIL,
      password: PASSWORD,
    });
    // 承重：令牌真的进了同步配置（删掉 `applyAuthSession` 那一行 → 这里红）。
    expect(useSyncStore.getState().token).toBe('jwt-abc');
    expect(el.textContent ?? '').toContain(translate('zh-CN', 'web.auth.signedIn.title'));
  });

  it('注册：切到创建账号档之后才有同意项，勾了才发得出去', async () => {
    stubFetch(201, { message: 'ok' });
    const el = await renderPanel('zh-CN');

    await toRegister(el);
    await tap(el, 'auth-form-terms');
    await typeById(el, 'auth-form-password', PASSWORD);
    await tap(el, 'auth-form-submit');

    const sent = calls.find((c) => c.url.endsWith('/register/email-password'))!;
    expect(sent).toBeDefined();
    expect(sent.body).toEqual({
      email: EMAIL,
      password: PASSWORD,
      termsAccepted: true,
      locale: 'zh-CN',
    });
    // 注册成功**不等于已登录**：状态必须是"去邮箱点验证链接"。
    expect(el.textContent ?? '').toContain(translate('zh-CN', 'web.auth.sent.register'));
    expect(el.textContent ?? '').not.toContain(translate('zh-CN', 'web.auth.signedIn.title'));
  });

  it('「忘记密码」在登录档，点了发的是重置邮件而不是登录链接', async () => {
    stubFetch(200, { message: 'ok' });
    const el = await renderPanel('zh-CN');

    await toCredential(el);
    await tap(el, 'auth-form-forgot');

    expect(calls.map((c) => c.url)).toContain(`${BASE_URL}/api/password/forgot`);
    // 🔴 中性文案：这句不许渲染成"已发送到你的邮箱"。
    expect(el.textContent ?? '').toContain(translate('zh-CN', 'common.auth.sent.reset'));
  });

  it('口令策略失败要说**具体哪一条**，而且指到口令那一格', async () => {
    stubFetch(400, {
      error: 'Password policy violation',
      code: 'password_policy_violation',
      policyCode: 'too_short',
    });
    const el = await renderPanel('zh-CN');

    await toRegister(el);
    await tap(el, 'auth-form-terms');
    await typeById(el, 'auth-form-password', 'short');
    await tap(el, 'auth-form-submit');

    expect(el.textContent ?? '').toContain(
      translate('zh-CN', 'common.auth.policy.tooShort', { min: 8 }),
    );
    expect(byTestId(el, 'auth-form-password').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('发登录链接（降级到二级链，但仍是一条真的路）', () => {
  it('点「发送登录链接」会打服务端端点，并如实说"链接已发出"', async () => {
    stubFetch(200, { message: 'If an account with that email exists…' });
    const el = await renderPanel('zh-CN');

    await toCredential(el);
    await tap(el, 'auth-form-magic-link');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${BASE_URL}/api/login/magic-link`);
    expect(calls[0]!.init?.method).toBe('POST');
    // 发信请求带上当前界面语言（邮件按收件人当前语言渲染）；逐字 toEqual 拦住多余字段。
    expect(calls[0]!.body).toEqual({ email: EMAIL, locale: 'zh-CN' });

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

  it('粘贴兜底走的是界面上那一个按钮，不是直接调 store', async () => {
    stubFetch(200, SESSION);
    const el = await renderPanel('zh-CN');

    await typeById(el, 'auth-form-paste', 'https://sync.example.com/magic-login?token=tok-123');
    await tap(el, 'auth-form-verify');

    expect(calls[0]!.url).toBe(`${BASE_URL}/api/login/magic-link/verify`);
    expect(useSyncStore.getState().token).toBe('jwt-abc');
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
      await useAuthStore.getState().sendLoginLink('', EMAIL);
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

  /**
   * 🔴 口令登录失败**不许**暗示"这个邮箱存不存在"。
   *
   * 服务端对"没有这个账号"和"口令不对"回的是同一个 401 与同一句 `invalid-credentials`
   * （否则登录接口就成了邮箱存在性预言机）。界面这边唯一能做的是照抄那句"重打一遍"，
   * 所以这一条钉的是：**不许**出现"账号不存在/未注册"那类词。
   */
  it('口令不对 → 说的是"重打一遍"，不是"这个账号不存在"', async () => {
    stubFetch(401, { error: 'Invalid email or password', code: 'invalid_credentials' });
    const el = await renderPanel('zh-CN');

    await toCredential(el);
    await typeById(el, 'auth-form-password', 'wrong wrong wrong');
    await tap(el, 'auth-form-submit');

    const text = el.textContent ?? '';
    expect(text).toContain(translate('zh-CN', 'common.auth.error.invalidCredentials'));
    expect(text).not.toContain('不存在');
  });

  /**
   * 🔴 屏幕上必须出现**那个数**，而不是 `{seconds}` 这个字面量。
   *
   * 2026-10-01 实测到的真缺陷：面板只取 key、不填 vars，而 `translateIn` 在 vars
   * 缺省时**原样保留占位符** —— 于是用户看到"…或 {seconds} 秒后再试"。
   * 共享层的不变量（`auth-model.spec.ts`）钉的是"函数拿不到一半"，
   * 这一条钉的是"这一半真的落到了屏幕上"，两层缺一不可：
   * 前者改坏会让模型测试红，后者改坏（比如有人又把 `vars` 丢掉）只有这条会红。
   */
  it('口令被锁 → 说"再等 37 秒"，不是字面量 {seconds}', async () => {
    stubFetch(
      429,
      { error: 'Too many password attempts', code: 'account_locked' },
      { 'retry-after': '37' },
    );
    const el = await renderPanel('zh-CN');

    await toCredential(el);
    await typeById(el, 'auth-form-password', 'wrong wrong wrong');
    await tap(el, 'auth-form-submit');

    expect(useAuthStore.getState().status).toMatchObject({
      kind: 'failed',
      reason: 'password-locked',
      retryAfterSeconds: 37,
    });
    const text = el.textContent ?? '';
    expect(text).not.toContain('{seconds}');
    expect(text).toContain(
      translate('zh-CN', 'common.auth.error.passwordLockedWithWait', { seconds: 37 }),
    );
  });

  it('同一句在英文下也说得出数字（占位符不是只有中文表要填）', async () => {
    stubFetch(
      429,
      { error: 'Too many password attempts', code: 'account_locked' },
      { 'retry-after': '90' },
    );
    const el = await renderPanel('en');

    await toCredential(el);
    await typeById(el, 'auth-form-password', 'wrong wrong wrong');
    await tap(el, 'auth-form-submit');

    const text = el.textContent ?? '';
    expect(text).not.toContain('{seconds}');
    expect(text).toContain('90');
  });
});

describe('邀请码：URL 带码要预填，形状不对不许发出去', () => {
  /** 上一条用例改过地址栏，这一条要一个干净的 URL。 */
  function setSearch(search: string): void {
    window.history.replaceState({}, '', `${search}`);
  }

  it('🔴 `?invite=` 带来的码预填进邀请栏，并随注册请求一起发出去', async () => {
    setSearch('/?invite=abcd-2345');
    stubFetch(201, { message: 'ok' });
    const el = await renderPanel('zh-CN');

    await toRegister(el);
    // 归一化（大写、去连字符）发生在**用户看不见的地方**，看得见的那一栏保留原样输入。
    expect(byTestId(el, 'auth-form-invite')).not.toBeNull();
    await tap(el, 'auth-form-terms');
    await typeById(el, 'auth-form-password', PASSWORD);
    await tap(el, 'auth-form-submit');

    const sent = calls.find((c) => c.url.endsWith('/register/email-password'))!;
    expect(sent.body).toMatchObject({ inviteCode: 'ABCD2345' });
    setSearch('/');
  });

  it('用户中途改过码，发出去的是**改后**的那一个（镜像不是挂载时的旧值）', async () => {
    setSearch('/?invite=abcd2345');
    stubFetch(201, { message: 'ok' });
    const el = await renderPanel('zh-CN');

    // ⚠️ 码的字母表**排除了易混字符** `0/O/1/I/L`（要能手抄口述，见 `@heyta/domain`
    // 的 `INVITE_CODE_ALPHABET`），所以这里不能随手敲个 `1111` —— 那不是"改过码"，
    // 那是一个**根本不可能存在**的码，界面会照实丢掉它（下一条用例钉的就是这个形状）。
    await toRegister(el);
    await typeById(el, 'auth-form-invite', 'ZZZZ2345');
    await tap(el, 'auth-form-terms');
    await typeById(el, 'auth-form-password', PASSWORD);
    await tap(el, 'auth-form-submit');

    const sent = calls.find((c) => c.url.endsWith('/register/email-password'))!;
    expect(sent.body).toMatchObject({ inviteCode: 'ZZZZ2345' });
    setSearch('/');
  });

  it('码形状不对时**照样注册**，只是不带邀请码（一个抄错的码不该把人挡在门外）', async () => {
    setSearch('/');
    stubFetch(201, { message: 'ok' });
    const el = await renderPanel('zh-CN');

    await toRegister(el);
    await typeById(el, 'auth-form-invite', 'to-short');
    expect(el.textContent ?? '').toContain(
      translate('zh-CN', 'web.auth.invite.invalid', { length: 8 }),
    );

    await tap(el, 'auth-form-terms');
    await typeById(el, 'auth-form-password', PASSWORD);
    await tap(el, 'auth-form-submit');

    const sent = calls.find((c) => c.url.endsWith('/register/email-password'))!;
    expect(Object.keys(sent.body as object)).not.toContain('inviteCode');
  });
});

describe('显隐默认档由**壳**覆盖（共享层只能按 Platform 判）', () => {
  it('桌面（fine pointer）默认遮住口令，开关在且不禁用按钮', async () => {
    const matches = vi.spyOn(window, 'matchMedia').mockImplementation(
      (() => ({ matches: false })) as unknown as typeof window.matchMedia,
    );
    stubFetch(200, SESSION);
    const el = await renderPanel('zh-CN');
    await toCredential(el);

    const field = byTestId(el, 'auth-form-password') as HTMLInputElement;
    expect(field.type).toBe('password');
    await tap(el, 'auth-form-reveal');
    expect((byTestId(el, 'auth-form-password') as HTMLInputElement).type).toBe('text');
    matches.mockRestore();
  });

  it('🔴 手机浏览器（coarse pointer）**默认显示口令** —— 桌面结论不许套到移动端浏览器上', async () => {
    const matches = vi.spyOn(window, 'matchMedia').mockImplementation(
      (() => ({ matches: true })) as unknown as typeof window.matchMedia,
    );
    stubFetch(200, SESSION);
    const el = await renderPanel('zh-CN');
    await toCredential(el);

    expect((byTestId(el, 'auth-form-password') as HTMLInputElement).type).toBe('text');
    matches.mockRestore();
  });
});

/**
 * 链 2：勾选框旁边那两条链接**点得开，且指向正确的那一份文本**。
 *
 * 钉的是三种坏法，每一种都对应一次真实的合规失败：
 *
 *   1. **没有链接** —— 要求用户同意一份读不到的政策（PIPL 第 17 条的"公开"没做到）。
 *      这一条在整个块被删掉时红。
 *   2. **指向错的那一份** —— 连别人的服务端却打开 heyta 的政策，
 *      等于替那位运营者作承诺；反过来在官方域上打开 `<baseUrl>/privacy.html`
 *      得到的是 404（生产没配 `PRIVACY_*`）。
 *   3. **链接嵌进了同意项那一行** —— 点同意区会切换同意，
 *      于是"我想先读条款"这个动作**本身就构成了同意**。这个形状在 DOM 上
 *      只差一层嵌套，肉眼看不出来，只能这样钉。
 *
 * ⚠️ 2026-10-02：这两条链接现在由**共享表单**渲染（`labels.legal.hrefs` 给出地址 ⇒
 * web 上落真的 `<a href target=_blank rel=noopener>`）。三条坏法一条没放松，
 * 只是每一轮都要先走到**注册档**（同意项在那一档，链接跟着它）。
 */
describe('条款链接：按连的那台服务端分流', () => {
  const OFFICIAL = 'https://heyta.waytofuture.cn';

  it('连别的 host 时，两条链接落在那台服务端自己发布的 `/terms.html` 与 `/privacy.html`', async () => {
    const el = await renderPanelAtBaseUrl(BASE_URL);
    await toRegister(el);
    const anchors = legalAnchors(el);

    expect(anchors.map((a) => a.getAttribute('href'))).toEqual([
      `${BASE_URL}/terms.html`,
      `${BASE_URL}/privacy.html`,
    ]);
    // 新标签打开（离开面板会丢掉已填的邮箱），而 `noopener` 不是装饰：
    // 目标页拿到 `window.opener` 就能回头改我们这一页。
    expect(anchors.every((a) => a.getAttribute('target') === '_blank')).toBe(true);
    expect(anchors.every((a) => a.rel.includes('noopener'))).toBe(true);
  });

  it('连官方域时落在落地页 `/legal/*`，**不是** `<baseUrl>/privacy.html`（那条是 404）', async () => {
    const el = await renderPanelAtBaseUrl(OFFICIAL);
    await toRegister(el);
    expect(legalAnchors(el).map((a) => a.getAttribute('href'))).toEqual([
      `${OFFICIAL}/legal/terms/`,
      `${OFFICIAL}/legal/privacy/`,
    ]);
  });

  it('英文界面落到 `/en/legal/*`', async () => {
    const el = await renderPanelAtBaseUrl(OFFICIAL, 'en');
    await toRegister(el);
    expect(legalAnchors(el)[0]!.getAttribute('href')).toBe(`${OFFICIAL}/en/legal/terms/`);
  });

  /**
   * 🔴 这一条在 2026-10-01 被**换掉**了，换它的不是别人是那道墙被拆掉这件事本身。
   *
   * 原文是「地址还没填时**不渲染链接**」—— 它当时的世界里"没填地址"是一个**停留状态**
   * （面板上挂着一个空的必填框，所以确实没有任何一台服务端可以解析条款）。
   * 现在那个状态不存在了：未配置时地址解析成**本机来源**（`lib/auth-endpoint.ts`），
   * 于是"没有链接"变成了"明明有目标却不给"，正好是这条链第 1 种坏法要拦的东西。
   *
   * 所以判据换形而**意图更严**：未配置时链接必须落在**当前来源**上，
   * 而且在官方托管的部署里那个来源就是官方域 ⇒ 落 `/legal/*`（下一条钉住它）。
   * 勾选框照常存在那一半**原样保留**。
   */
  it('未配置时链接落在**当前来源**（不再有"没有地址"这个停留状态）', async () => {
    const el = await renderPanelAtBaseUrl('');
    await toRegister(el);
    expect(legalAnchors(el).map((a) => a.getAttribute('href'))).toEqual([
      `${window.location.origin}/terms.html`,
      `${window.location.origin}/privacy.html`,
    ]);
    expect(el.querySelector('[role="checkbox"]')).not.toBeNull();
  });

  it('在面板里现敲一个官方地址，链接跟着换过去（分流读的是 `effectiveBaseUrl`）', async () => {
    const el = await renderPanelAtBaseUrl('');
    await typeInto(el, 'input[inputmode="url"]', `${OFFICIAL}/`);
    await toRegister(el);

    expect(legalAnchors(el)[0]!.getAttribute('href')).toBe(`${OFFICIAL}/legal/terms/`);
  });

  it('🔴 链接不在同意项里面 —— 点链接不能切换同意', async () => {
    const el = await renderPanelAtBaseUrl(BASE_URL);
    await toRegister(el);

    const terms = byTestId(el, 'auth-form-terms');
    for (const anchor of legalAnchors(el)) {
      expect(terms.contains(anchor), '条款链接嵌进了同意项里').toBe(false);
      await act(async () => {
        // 用 `dispatchEvent` 而不是 `.click()`：后者会让 jsdom 去实现 `_blank` 导航，
        // 除了噪声没有任何判据价值，而这里要验的只是"事件冒泡上去会不会把勾选切了"。
        anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
    }
    expect(termsChecked(el)).toBe('false');
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
