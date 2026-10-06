/**
 * 设置页「修改登录密码」面板（W6f 的判据）
 * ==========================================
 *
 * 这个文件钉的全是**界面会不会说谎**那一类失效，不是"组件会渲染"：
 *
 *   1. **改密成功必须真的换上新令牌** —— `tokenVersion` 一 bump，手上那枚就作废。
 *      症状是"刚说完成功，这个标签页自己掉线"。（变异：`submit` 里不换会话 ⇒ 组 4 红。）
 *   2. **失败不许清空输入、焦点必须落在真正错的那个框** —— 当前密码打错却要用户
 *      重打新密码，比不跳焦点更糟。（变异：`field` 全给 `'new'` ⇒ 组 5.1 红。）
 *   3. **"其余设备都要重新登录"要在点**之前**就在 DOM 里** —— 事后通知不是预告。
 *      （变异：把那句挪进 `outcome?.kind === 'changed'` 分支 ⇒ 组 2 红。）
 *   4. **忙时再点是空操作**，而按钮**不能**禁用（禁用会把焦点甩掉）。
 *      （变异：拿掉 `submit` 第一行的 guard ⇒ 那条用例会发两次请求。）
 *   5. **服务端说"这个账号还没有口令" ⇒ 换表，不是留一句红字** ——
 *      `no_password_set` 不是一种错误落点，而是"这张表摆错了"。收起来让用户干等
 *      是最初的形状，它唯一的出路是让用户自己想到还有另一张表；现在换过去，
 *      并且**设密那一屏不给"忘记密码"按钮** —— `requestPasswordReset` 对没有口令
 *      认证器的账号刻意不发信（`recovery.ts:117`），摆一个不会发信的按钮就是骗人。
 *      （变异：把 `switchMode('set')` 换回一句红字 ⇒ 组 5.5 红。）
 *   6. **两个秘密每次都划界**：标题说"登录密码"、lead 点名"加密口令不在这里"。
 *   7. 输入框**没有 `maxLength`**（NIST 禁止静默截断口令）、`autocomplete` 两框不同、
 *      长度数字来自 `@heyta/shared-schema` 而**不是写死的 8**。
 *
 * ⚠️ 全程零联网：`fetch` 一律 stub。协议字节那份在
 * `packages/app-host/tests/hosted-password-auth.spec.ts`，状态机那份在
 * `auth-store-password.spec.ts` —— 这一份只管**渲染与接线**。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider, zhCN } from '@heyta/i18n';
import { AUTH_PASSWORD_MIN_CODE_POINTS, AUTH_PASSWORD_PATHS } from '@heyta/shared-schema';

import { PasswordPanel } from '../src/features/settings/PasswordPanel.js';
import { __resetAuthForTests, useAuthStore } from '../src/features/auth/store.js';
import { useSyncStore } from '../src/features/sync/store.js';

const BASE_URL = 'https://sync.example.com';
const OLD_TOKEN = 'jwt-before-change';
const EMAIL = 'me@example.com';
/** `/password/change` 与登录同形：成功回**新会话**。 */
const FRESH_SESSION = { token: 'jwt-after-change', user: { id: 7, email: EMAIL } };

interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

let calls: RecordedCall[];

function flattenHeaders(init: RequestInit | undefined): Record<string, string> {
  const raw = init?.headers;
  const out: Record<string, string> = {};
  if (raw instanceof Headers) {
    raw.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
  } else if (typeof raw === 'object' && raw !== null) {
    for (const [key, value] of Object.entries(raw as Record<string, string>)) {
      out[key.toLowerCase()] = String(value);
    }
  }
  return out;
}

/** 只让某条路径命中，其余 404 —— 断言才能证明打的是**那条**请求。 */
function stubPath(path: string, spec: { status: number; body?: unknown }, method = 'POST'): void {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const raw = typeof init?.body === 'string' ? init.body : undefined;
      calls.push({
        url,
        method: String(init?.method ?? 'GET'),
        headers: flattenHeaders(init),
        body: raw === undefined ? undefined : JSON.parse(raw),
      });
      const hit = url.endsWith(`/api${path}`);
      return Promise.resolve({
        status: hit ? spec.status : 404,
        ok: hit && spec.status < 300,
        headers: new Headers(),
        json: () => Promise.resolve(hit ? (spec.body ?? {}) : {}),
      } as unknown as Response);
    }),
  );
}

/** 挂起的 fetch：用来观测"在飞"这一段（按钮文案、重复点击）。 */
function stubPending(body: unknown = FRESH_SESSION): () => void {
  calls = [];
  let release: ((value: Response) => void) | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const raw = typeof init?.body === 'string' ? init.body : undefined;
      calls.push({
        url,
        method: String(init?.method ?? 'GET'),
        headers: flattenHeaders(init),
        body: raw === undefined ? undefined : JSON.parse(raw),
      });
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }),
  );
  return () => {
    release?.({
      status: 200,
      ok: true,
      headers: new Headers(),
      json: () => Promise.resolve(body),
    } as unknown as Response);
  };
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <PasswordPanel />
      </I18nProvider>,
    );
  });
  return container;
}

const q = (testId: string): HTMLElement | null =>
  container?.querySelector(`[data-testid="${testId}"]`) ?? null;

const text = (testId: string): string => q(testId)?.textContent ?? '';

/**
 * 往受控输入框里"打字"。
 *
 * 🔴 直接 `input.value = x` 对 React 的受控组件**无效**（value tracker 会判定
 * 这不是用户改的），必须走原型上的原生 setter 再派发 input 事件。
 */
async function type(testId: string, value: string): Promise<void> {
  const input = q(testId) as HTMLInputElement | null;
  if (input === null) throw new Error(`没有找到输入框：${testId}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('HTMLInputElement.value setter 不存在');
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

async function click(testId: string): Promise<void> {
  const btn = q(testId);
  if (btn === null) throw new Error(`没有找到按钮：${testId}`);
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

const inputOf = (testId: string): HTMLInputElement =>
  q(testId) as unknown as HTMLInputElement;

beforeEach(() => {
  __resetAuthForTests();
  useSyncStore.setState({
    baseUrl: BASE_URL,
    token: OLD_TOKEN,
    email: EMAIL,
    status: { kind: 'idle' },
    syncSettingsRequested: false,
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

describe('1. 未登录时不摆表单（也没有可点的死按钮）', () => {
  it('没有令牌 ⇒ 只有"先登录"那句话，两个框和提交按钮都不在 DOM 里', async () => {
    useSyncStore.setState({ token: undefined });
    stubPath(AUTH_PASSWORD_PATHS.change, { status: 200, body: FRESH_SESSION });
    render();

    expect(q('password-needs-sign-in')).not.toBeNull();
    expect(q('password-current')).toBeNull();
    expect(q('password-new')).toBeNull();
    expect(q('password-submit')).toBeNull();

    await click('password-needs-sign-in');
    expect(calls.length).toBe(0);
  });

  it('🔴 两个秘密每次出现都划界：标题点名"登录密码"，lead 点名"加密口令"不在这里', () => {
    render();
    expect(text('password-panel')).toContain('登录密码');
    const lead = container?.querySelector('.ht-settings__hint')?.textContent ?? '';
    expect(lead).toContain('加密口令');
  });
});

describe('2. 🔴 后果在点之前就看得见', () => {
  it('"其它设备上的登录都会失效"在初次渲染的 DOM 里，而成功提示还没有出现', () => {
    render();
    expect(q('password-consequence')).not.toBeNull();
    expect(text('password-consequence')).toContain('其它设备');
    // 还没点过 ⇒ 没有任何结果区内容。
    expect(q('password-changed')).toBeNull();
    expect(q('password-failed')).toBeNull();
    expect(text('password-live')).toBe('');
  });

  it('长度提示念的是 shared-schema 里的那个数，不是写死的 8', () => {
    render();
    expect(text('password-hint')).toContain(String(AUTH_PASSWORD_MIN_CODE_POINTS));
  });
});

describe('3. 本地只拦"没填"，拦完不许发请求', () => {
  it('两个都空 ⇒ 零请求 + 文字错误 + 焦点落在当前密码框', async () => {
    stubPath(AUTH_PASSWORD_PATHS.change, { status: 200, body: FRESH_SESSION });
    render();
    await click('password-submit');

    expect(calls.length).toBe(0);
    expect(q('password-local-error')).not.toBeNull();
    expect(document.activeElement).toBe(inputOf('password-current'));
    expect(inputOf('password-current').getAttribute('aria-invalid')).toBe('true');
  });

  it('只填了当前密码 ⇒ 焦点落到新密码框', async () => {
    stubPath(AUTH_PASSWORD_PATHS.change, { status: 200, body: FRESH_SESSION });
    render();
    await type('password-current', 'old-one');
    await click('password-submit');

    expect(calls.length).toBe(0);
    expect(document.activeElement).toBe(inputOf('password-new'));
  });

  it('打字就把本地错误清掉（不让人对着一句已经过时的话改）', async () => {
    stubPath(AUTH_PASSWORD_PATHS.change, { status: 200, body: FRESH_SESSION });
    render();
    await click('password-submit');
    expect(q('password-local-error')).not.toBeNull();

    await type('password-current', 'old-one');
    expect(q('password-local-error')).toBeNull();
  });
});

describe('4. 🔴 改密成功必须把当前设备换到新会话', () => {
  it('渲染成功句、清空两个草稿、sync store 的令牌换成服务端给的那枚', async () => {
    stubPath(AUTH_PASSWORD_PATHS.change, { status: 200, body: FRESH_SESSION });
    render();
    await type('password-current', 'old-one');
    await type('password-new', 'a-longer-new-one');
    await click('password-submit');

    expect(text('password-changed')).toContain('已修改');
    expect(inputOf('password-current').value).toBe('');
    expect(inputOf('password-new').value).toBe('');
    // 少了这一步，症状是"改密成功后这个标签页立刻同步失败"。
    expect(useSyncStore.getState().token).toBe(FRESH_SESSION.token);
  });

  it('请求打的是 /password/change，带上旧令牌，两个口令原样交出', async () => {
    stubPath(AUTH_PASSWORD_PATHS.change, { status: 200, body: FRESH_SESSION });
    render();
    // 末尾空格必须保留：客户端任何一次"好心"的整理都会让它和别的设备不一致。
    await type('password-current', ' old-one ');
    await type('password-new', 'new-one');
    await click('password-submit');

    const call = calls.find((c) => c.url.endsWith(`/api${AUTH_PASSWORD_PATHS.change}`));
    expect(call?.method).toBe('POST');
    expect(call?.headers['authorization']).toContain(OLD_TOKEN);
    expect(call?.body).toMatchObject({
      currentPassword: ' old-one ',
      newPassword: 'new-one',
    });
  });
});

describe('5. 失败：话要说对，焦点要落对，输入要留着', () => {
  it('当前密码打错 ⇒ 说"口令不对"、焦点在**当前**框、两框内容都还在', async () => {
    stubPath(AUTH_PASSWORD_PATHS.change, {
      status: 401,
      body: { error: 'x', code: 'invalid_credentials' },
    });
    render();
    await type('password-current', 'wrong-but-typed');
    await type('password-new', 'the-new-one');
    await click('password-submit');

    expect(q('password-failed')).not.toBeNull();
    expect(document.activeElement).toBe(inputOf('password-current'));
    expect(inputOf('password-current').getAttribute('aria-invalid')).toBe('true');
    expect(inputOf('password-new').getAttribute('aria-invalid')).not.toBe('true');
    // 🔴 失败清空输入 = 让用户重打他根本没打错的东西。
    expect(inputOf('password-current').value).toBe('wrong-but-typed');
    expect(inputOf('password-new').value).toBe('the-new-one');
  });

  it('新口令不合格（泄露库）⇒ 焦点在**新**框，且说的是那一条具体的理由', async () => {
    stubPath(AUTH_PASSWORD_PATHS.change, {
      status: 400,
      body: { error: 'x', code: 'password_policy_violation', policyCode: 'breached' },
    });
    render();
    await type('password-current', 'old-one');
    await type('password-new', 'password123');
    await click('password-submit');

    expect(document.activeElement).toBe(inputOf('password-new'));
    expect(text('password-failed')).toContain('泄露');
  });

  it('服务端没给 policyCode ⇒ 只能退回那句不带具体理由的总说', async () => {
    stubPath(AUTH_PASSWORD_PATHS.change, {
      status: 400,
      body: { error: 'x', code: 'password_policy_violation' },
    });
    render();
    await type('password-current', 'old-one');
    await type('password-new', 'password123');
    await click('password-submit');

    expect(text('password-failed')).toContain('密码');
    // 没有具体理由时**也不**瞎指某个框：焦点保持原位。
    expect(document.activeElement).not.toBe(inputOf('password-new'));
  });

  it('锁定 ⇒ 句子带上服务端给的秒数，两个框都不标红', async () => {
    stubPath(AUTH_PASSWORD_PATHS.change, {
      status: 429,
      body: { error: 'x', code: 'account_locked' },
    });
    render();
    await type('password-current', 'old-one');
    await type('password-new', 'new-one');
    await click('password-submit');

    expect(q('password-failed')).not.toBeNull();
    expect(inputOf('password-current').getAttribute('aria-invalid')).not.toBe('true');
    expect(inputOf('password-new').getAttribute('aria-invalid')).not.toBe('true');
  });

  it('🔴 服务端说"这个账号还没有口令" ⇒ **换到设密那张表**，不是留一句红字', async () => {
    stubPath(AUTH_PASSWORD_PATHS.change, {
      status: 400,
      body: { error: 'x', code: 'no_password_set' },
    });
    render();
    await type('password-current', 'whatever');
    await type('password-new', 'whatever-too');
    await click('password-submit');

    // 换过去了：设密那一个框在，改密那两个框整张不在。
    expect(q('password-set-field')).not.toBeNull();
    expect(q('password-current')).toBeNull();
    expect(q('password-new')).toBeNull();
    expect(q('password-submit')).toBeNull();
    // 没有口令认证器的账号，重置信**不发**（`recovery.ts:117`）⇒ 死按钮不许摆。
    expect(q('password-forgot')).toBeNull();
    // 🔴 换表必须把草稿一起清掉：把"当前密码"的旧输入摆在"新密码"的位置上，
    // 等于把一个旧秘密写进新秘密的框。
    expect(inputOf('password-set-field').value).toBe('');
  });
});

describe('6. 🔴 按钮不禁用，但忙时再点是空操作', () => {
  it('在飞时按钮仍可点（无 disabled 属性）、文案换成"正在修改密码"、第二次点击不发请求', async () => {
    const release = stubPending();
    render();
    await type('password-current', 'old-one');
    await type('password-new', 'new-one');
    await click('password-submit');

    const btn = q('password-submit') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain('正在修改密码');

    await click('password-submit');
    expect(calls.filter((c) => c.url.endsWith(`/api${AUTH_PASSWORD_PATHS.change}`)).length).toBe(1);

    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect(q('password-changed')).not.toBeNull();
  });

  it('一次**别的动作**的忙/失败不会串到这张表上（状态按 action 收窄读）', async () => {
    stubPath(AUTH_PASSWORD_PATHS.change, { status: 200, body: FRESH_SESSION });
    render();

    // 登录那条路上正忙（`password-sign-in`）—— 这张表不许显示"正在修改密码"。
    act(() => {
      useAuthStore.setState({ status: { kind: 'busy', action: 'password-sign-in' } });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(text('password-submit')).toContain('修改密码');
    expect(text('password-submit')).not.toContain('正在修改密码');

    // 同理：全局有一条"口令不对"，但它不是这张表发出去的那次请求留下的。
    act(() => {
      useAuthStore.setState({ status: { kind: 'failed', reason: 'invalid-credentials' } });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(q('password-failed')).toBeNull();
    expect(q('password-submit')).not.toBeNull();
  });
});

describe('7. 「忘记密码」：只在知道邮箱时出现，成功句只能是条件句', () => {
  it('知道邮箱 ⇒ 有按钮、有"发到哪个邮箱"的交代，点击后说的是那句**中性**话', async () => {
    stubPath(AUTH_PASSWORD_PATHS.forgot, { status: 200, body: { message: 'neutral' } });
    render();

    expect(q('password-forgot')).not.toBeNull();
    expect(text('password-reset-to')).toContain(EMAIL);

    await click('password-forgot');
    const sentence = text('password-reset-sent');
    // `{' '}` 给图标和文字之间留了个空格 ⇒ 比 trim 后的正文。
    expect(sentence.trim()).toBe(zhCN['common.auth.sent.reset']);
    // 🔴 反枚举：服务端对"有账号/没账号/异常"回同一句 + 200，所以界面只能是条件句。
    expect(sentence).toContain('如果');
  });

  it('不知道邮箱 ⇒ 没有按钮，也没有那半句"会发到 …"', () => {
    useSyncStore.setState({ email: undefined });
    render();
    expect(q('password-forgot')).toBeNull();
    expect(q('password-reset-to')).toBeNull();
  });

  it('重置信失败也走同一份 reason→词条映射（不各写一遍）', async () => {
    stubPath(AUTH_PASSWORD_PATHS.forgot, { status: 429, body: { error: 'x', code: 'rate_limited' } });
    render();
    await click('password-forgot');
    expect(q('password-failed')).not.toBeNull();
  });
});

describe('8. 口令输入框的四条纪律', () => {
  it('两个框都**没有** maxLength（NIST 禁止静默截断口令）', () => {
    render();
    for (const id of ['password-current', 'password-new']) {
      expect(inputOf(id).getAttribute('maxLength')).toBeNull();
    }
  });

  it('autocomplete 两框不同：当前=current-password，新=new-password', () => {
    render();
    expect(inputOf('password-current').getAttribute('autocomplete')).toBe('current-password');
    expect(inputOf('password-new').getAttribute('autocomplete')).toBe('new-password');
  });

  it('默认遮住（桌面档），点开变明文，按钮**文案不变**、只翻 `aria-pressed`', async () => {
    render();
    expect(inputOf('password-current').type).toBe('password');
    const label = text('password-reveal-current');

    await click('password-reveal-current');
    expect(inputOf('password-current').type).toBe('text');
    expect(text('password-reveal-current')).toBe(label);
    expect(q('password-reveal-current')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('一框显隐不带动另一框（两个秘密各有各的开关）', async () => {
    render();
    await click('password-reveal-current');
    expect(inputOf('password-new').type).toBe('password');
  });
});

/**
 * 「给账号加上**第一个**登录密码」那张表。
 *
 * 🔴 这一组存在的理由是真实缺陷：passkey-only / 魔法链接注册的账号，
 * `change` 回 `no_password_set`、`forgot` 对没有口令认证器的账号**不发信** ——
 * 也就是说这类账号此前**永远**加不上登录密码，而词条
 * `web.passkeys.error.lastPasskey` 早就在建议"或者去设置页设一个登录密码"。
 * 那一句当时是**指向一条不存在的路**的谎话。
 *
 * 判据分两类：一是**这张表自己的形状**（一个框、没有当前密码、不给忘记密码），
 * 二是**它与改密那张表的分工**（后果相反、换表时草稿互不带过去、
 * 同一句失败在两张表上要说不一样的话）。
 */
describe('9. 「设第一个密码」那张表', () => {
  it('从改密那张表点「从来没设过？」就换过来 —— 不必先撞一次墙', async () => {
    stubPath(AUTH_PASSWORD_PATHS.set, { status: 200, body: { message: 'Password set' } });
    render();
    await click('password-switch-to-set');

    expect(q('password-set-field')).not.toBeNull();
    // 🔴 这张表**没有**"当前密码"：这个账号从来没有过口令，要求他打一个
    // 不存在的东西，是界面在编造一个前提。
    expect(q('password-current')).toBeNull();
    expect(q('password-new')).toBeNull();
  });

  it('🔴 后果那句与改密**相反**，而且必须在点之前就看得见', async () => {
    stubPath(AUTH_PASSWORD_PATHS.set, { status: 200, body: { message: 'Password set' } });
    render();
    const changeSentence = text('password-consequence');
    expect(changeSentence).toContain('其它设备');

    await click('password-switch-to-set');
    // 换表后这句不许还是那句"其余设备都要重新登录"。
    expect(q('password-consequence')).toBeNull();
    const setSentence = text('password-set-consequence');
    expect(setSentence).toContain('不会把任何地方踢下线');
    // 两张表的句子必须不同（同一条文案摆两张表 = 对一半人说错话）。
    expect(setSentence).not.toBe(changeSentence);
  });

  it('🔴 成功：打的是 /password/set、体里只有 newPassword、**令牌不换**、草稿清空', async () => {
    stubPath(AUTH_PASSWORD_PATHS.set, { status: 200, body: { message: 'Password set' } });
    render();
    await click('password-switch-to-set');
    await type('password-set-field', 'first-real-password');
    await click('password-set-submit');

    const call = calls.find((c) => c.url.endsWith(`/api${AUTH_PASSWORD_PATHS.set}`));
    expect(call?.method).toBe('POST');
    expect(call?.headers['authorization']).toContain(OLD_TOKEN);
    expect(call?.body).toMatchObject({ newPassword: 'first-real-password' });
    // 这条不验当前口令 ⇒ 字段表里不该出现 currentPassword（出现了服务端也不看，
    // 但界面就会有人以为"要填那个"）。
    expect(Object.keys((call?.body ?? {}) as object)).not.toContain('currentPassword');

    expect(text('password-set-done')).toContain('已设置');
    expect(inputOf('password-set-field').value).toBe('');

    // 🔴 这条**不换令牌**（不 bump tokenVersion）。照改密那样补一次 applyAuthSession
    // 会把一枚仍然有效的令牌换成 undefined ⇒ 症状是"加了个密码，这个标签页掉线"。
    expect(useSyncStore.getState().token).toBe(OLD_TOKEN);
  });

  it('空框点击 ⇒ 零请求 + 文字错误 + 焦点落在那一个框', async () => {
    stubPath(AUTH_PASSWORD_PATHS.set, { status: 200, body: { message: 'Password set' } });
    render();
    await click('password-switch-to-set');
    await click('password-set-submit');

    expect(calls.length).toBe(0);
    expect(q('password-set-local-error')).not.toBeNull();
    expect(document.activeElement).toBe(inputOf('password-set-field'));
    expect(inputOf('password-set-field').getAttribute('aria-invalid')).toBe('true');
  });

  it('服务端说"这个账号已经有口令" ⇒ 换回改密那张表（不是红字）', async () => {
    stubPath(AUTH_PASSWORD_PATHS.set, {
      status: 400,
      body: { error: 'x', code: 'password_already_set' },
    });
    render();
    await click('password-switch-to-set');
    await type('password-set-field', 'already-in-use-somehow');
    await click('password-set-submit');

    expect(q('password-current')).not.toBeNull();
    expect(q('password-new')).not.toBeNull();
    expect(q('password-set-field')).toBeNull();
    // 反向也不许把设密那格的内容带过来。
    expect(inputOf('password-new').value).toBe('');
    expect(q('password-set-failed')).toBeNull();
  });

  it('🔴 同一句"邮箱还没验证"，在两张表上说的是**两句话**', async () => {
    // 改密那张：那一次**确实**验过口令 ⇒ "密码是对的，只差最后一步"是真话。
    stubPath(AUTH_PASSWORD_PATHS.change, {
      status: 403,
      body: { error: 'x', code: 'email_not_verified' },
    });
    render();
    await type('password-current', 'old-one');
    await type('password-new', 'new-one');
    await click('password-submit');
    const onChange = text('password-failed');
    expect(onChange).toContain('密码是对的');

    // 设密那张：没有任何口令被验过 ⇒ 那句成了假话，必须换一句。
    stubPath(AUTH_PASSWORD_PATHS.set, {
      status: 403,
      body: { error: 'x', code: 'email_not_verified' },
    });
    render();
    await click('password-switch-to-set');
    await type('password-set-field', 'new-one');
    await click('password-set-submit');
    const onSet = text('password-set-failed');
    expect(onSet).not.toContain('密码是对的');
    expect(onSet).toContain('还没有验证');
  });

  it('忙时再点是空操作；在飞那句说"正在设置"，不许带"其余设备要重新认证"', async () => {
    const release = stubPending({ message: 'Password set' });
    render();
    await click('password-switch-to-set');
    await type('password-set-field', 'first-real-password');
    await click('password-set-submit');

    const btn = q('password-set-submit') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    // 🔴 `common.auth.busy.change` 字面带着"（其余设备需要重新认证）"，
    // 把它摆在这张表上就和它正下方那句"不会把任何地方踢下线"当场打脸。
    expect(btn.textContent).toContain('正在设置登录密码');
    expect(btn.textContent).not.toContain('其余设备');

    await click('password-set-submit');
    expect(calls.filter((c) => c.url.endsWith(`/api${AUTH_PASSWORD_PATHS.set}`))).toHaveLength(1);

    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect(q('password-set-done')).not.toBeNull();
  });

  it('设密那个框：没有 maxLength，autocomplete 是 new-password', async () => {
    stubPath(AUTH_PASSWORD_PATHS.set, { status: 200, body: { message: 'Password set' } });
    render();
    await click('password-switch-to-set');
    const input = inputOf('password-set-field');
    expect(input.getAttribute('maxLength')).toBeNull();
    expect(input.getAttribute('autocomplete')).toBe('new-password');
    expect(input.type).toBe('password');
  });

  it('显隐只翻这一个框，且按钮文案不变（只翻 aria-pressed）', async () => {
    stubPath(AUTH_PASSWORD_PATHS.set, { status: 200, body: { message: 'Password set' } });
    render();
    await click('password-switch-to-set');
    const label = text('password-reveal-set');

    await click('password-reveal-set');
    expect(inputOf('password-set-field').type).toBe('text');
    expect(text('password-reveal-set')).toBe(label);
    expect(q('password-reveal-set')?.getAttribute('aria-pressed')).toBe('true');
  });

  /**
   * 🔴 换表**来回**都要清草稿。
   *
   * 危害不是"看着乱"：在改密表打过"当前密码"，撞出 no_password_set 换到设密表，
   * 设好之后再切回改密表 —— 那句旧输入此时**已经是当前口令**，留在"新密码"的位置
   * 上就是界面把一个旧秘密写进了新秘密的框。反向同理（设密打了一半切回来）。
   */
  it('换表来回都把草稿清掉（旧秘密不许出现在任何框里）', async () => {
    stubPath(AUTH_PASSWORD_PATHS.change, { status: 200, body: FRESH_SESSION });
    stubPath(AUTH_PASSWORD_PATHS.set, { status: 200, body: { message: 'Password set' } });
    render();

    await type('password-current', 'old-secret');
    await type('password-new', 'a-new-one');
    await click('password-switch-to-set');
    expect(inputOf('password-set-field').value).toBe('');

    await type('password-set-field', 'half-typed');
    await click('password-switch-to-change');
    expect(inputOf('password-current').value).toBe('');
    expect(inputOf('password-new').value).toBe('');

    // 再切过去，那个半截的设密草稿也不许还阴着（它是上一轮的东西）。
    await click('password-switch-to-set');
    expect(inputOf('password-set-field').value).toBe('');
  });

  /**
   * 设密那句后果**初次渲染就在 DOM**，不是成功后才冒出来。
   *
   * ⚠️ 这条断的是"它在不在 DOM 里"，不是"样式可不可见" —— 把一句预告用
   * `display:none` 藏起来，和事后才通知，对读屏用户是同一件事。
   */
  it('设密的后果句在**初次渲染**就在 DOM 里，而结果区还是空的', () => {
    stubPath(AUTH_PASSWORD_PATHS.set, { status: 200, body: { message: 'Password set' } });
    render();
    // 先换到设密表（不点提交）。
    const switchBtn = q('password-switch-to-set');
    expect(switchBtn).not.toBeNull();
    act(() => {
      switchBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(q('password-set-consequence')).not.toBeNull();
    expect(text('password-set-consequence')).toContain('不会把任何地方踢下线');
    // 还没点过 ⇒ 没有任何结果。
    expect(q('password-set-done')).toBeNull();
    expect(q('password-set-failed')).toBeNull();
    expect(text('password-set-live')).toBe('');
  });

  it('🔴 一次别的动作的忙不会串到这张表上（按 action 收窄读）', async () => {
    stubPath(AUTH_PASSWORD_PATHS.set, { status: 200, body: { message: 'Password set' } });
    render();
    await click('password-switch-to-set');

    act(() => {
      useAuthStore.setState({ status: { kind: 'busy', action: 'password-change' } });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(text('password-set-submit')).toContain('设置登录密码');
    expect(text('password-set-submit')).not.toContain('正在');
  });
});
