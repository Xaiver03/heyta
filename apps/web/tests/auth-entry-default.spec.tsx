/**
 * 判据：**登录 / 注册的第一屏是"注册或登录"，不是"凭据与令牌"**
 * =============================================================
 *
 * 出处：产品负责人 2026-10-02 对着 macOS 壳那张图说的两段话——
 *
 * > 「为什么还是默认就是要什么粘贴服务器地址和令牌之类的东西？不应该是默认这样子的，
 * > 绝对不应该这样子呀，一定是默认是我们提供公共服务的，如果他自建的话再说。
 * > 然后我们应该有完整的注册登录的流程呀，就像普通应用一样……
 * > 这不是把那些普通用户给拒之门外了吗？」
 * >
 * > 「还有继续这两个继续这个按钮怎么跟上面那个框隔得那么近呢？
 * > 难道设计系统没有规范好吗？」
 *
 * 那张图里第一屏从上到下是：「还没有凭据」→「同步需要服务端签发的访问令牌…」→
 * 邮箱 → 「继续」（离输入框 **4px**）→ 服务端地址（预填 `heyta-local://app`）→
 * 「或者粘贴登录链接 / 令牌」→「完成登录」。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么这几条值得单独一个文件（而不是并进 `auth-form.spec.tsx`）
 *
 * 那个文件判的是**表单机制**（两步流转、autocomplete、显隐档、同意项）。
 * 这里判的是**第一屏对一个陌生用户说了什么** —— 那是信息架构，
 * 机制全对也可能把人说跑。两类判据的改动理由不同，不该混在一个文件里互相误伤。
 *
 *   A. **词汇**：状态区那两行不许出现"令牌 / 凭据 / 服务端签发"。
 *      那三样是实现细节，被写在用户第一眼的位置上，等于要求他先理解架构再开始用。
 *   B. **默认收起**：服务端地址与粘贴令牌**不在默认 DOM 里**，两个入口在。
 *      ⚠️ 这条只判"看得见"，不判"够得着"——见下面 D 组。
 *   C. **间距**：「继续」与上方输入框之间必须是表单节奏（`space.3` = 12px），
 *      不是一个控件内部的 `space.1`（4px）。
 *   D. **降级通过渐进披露实现**：展开后两条路一条不少，展开入口可被键盘与读屏发现；
 *      而且地址被判"没填"时那一栏**必须自己出现** ——
 *      否则红字指向一个界面上不存在的东西，那是比常驻更坏的状态。
 *
 * 🔴 每条都做过变异（记录在 `docs/plans/ui-review-fill-zh-timeline.md` 的 **R8** 行。
 * ⚠️ 本刀起初写作 G-28，与 `docs/plans/legal-compliance-before-filing.md` 里
 * 那条已存在的 **G-28（同意留痕缺来源端）**撞号 —— 那两笔提交的信息里还留着旧号，
 * 不回改（改已提交的说明等于制造第二个事实源），以这行为准。）
 *
 * ⚠️ **本文件读的是 `@heyta/ui` 的 `dist/`**（package exports）。改完
 * `packages/ui/src` 不重新 build 的话，这里看到的仍是**上一次构建**的组件 ——
 * 症状是"变异产品源码，判据照样全绿"，看起来像判据没牙齿，其实是它没在测当前代码。
 * 本轮三臂变异全部重跑过 `pnpm --filter @heyta/ui build`，各自精确报红：
 * 去掉 `marginTop` ⇒ 2 红；地址栏永远常驻 ⇒ 3 红；粘贴栏永远常驻 ⇒ 1 红。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider, translate, type MessageKey, type MessageVars } from '@heyta/i18n';
import { AuthForm, HeytaUiProvider, type AuthFormLabels, type AuthFormProps } from '@heyta/ui';

const HERE = dirname(fileURLToPath(import.meta.url));
const FORM_SRC = resolve(HERE, '../../../packages/ui/src/auth/AuthForm.tsx');

/** 与 `AuthPanel` 同一套映射 —— 判据读的是**真词条**，不是测试自己编的句子。 */
function labelsFor(t: (key: MessageKey, vars?: MessageVars) => string): AuthFormLabels {
  return {
    title: t('web.auth.title'),
    titleText: t('web.auth.title'),
    close: t('web.auth.close'),
    email: t('web.auth.email.label'),
    emailPlaceholder: t('web.auth.email.placeholder'),
    continue: t('common.auth.form.continue'),
    accountSummary: (email) => t('common.auth.form.accountSummary', { email }),
    changeEmail: t('common.auth.form.changeEmail'),
    password: t('common.auth.signInPassword.label'),
    signIn: t('common.auth.form.signIn'),
    signUp: t('web.auth.register'),
    showPassword: t('common.auth.form.showPassword'),
    hidePassword: t('common.auth.form.hidePassword'),
    passwordHint: t('common.auth.form.passwordHint'),
    forgotPassword: t('common.auth.form.forgotPassword'),
    switchToRegister: t('common.auth.form.switchToRegister'),
    switchToSignIn: t('common.auth.form.switchToSignIn'),
    otherWays: t('common.auth.form.otherWays'),
    terms: t('web.auth.terms.label'),
    magicLink: t('web.auth.sendLoginLink'),
    recovery: t('web.auth.recovery.request'),
    passkeyRegister: t('web.auth.passkey.register'),
    passkeyLogin: t('web.auth.passkey.login'),
    passkeyUnavailable: t('web.auth.passkey.unavailable'),
    passkeyWaiting: t('web.auth.passkey.waiting'),
    emptyTitle: t('web.auth.empty.title'),
    emptyBody: t('web.auth.empty.body'),
    serverUrl: {
      label: t('web.auth.server.label'),
      placeholder: t('web.auth.server.placeholder'),
    },
    paste: {
      label: t('web.auth.paste.label'),
      placeholder: t('web.auth.paste.placeholder'),
      verify: t('web.auth.verify'),
    },
    selfHostToggle: {
      open: t('web.auth.selfHost.open'),
      close: t('web.auth.selfHost.close'),
    },
    haveTokenToggle: {
      open: t('web.auth.haveToken.open'),
      close: t('web.auth.haveToken.close'),
    },
    localErrors: {
      baseUrl: t('common.auth.form.serverUrlRequired'),
      email: t('common.auth.form.emailRequired'),
      password: t('common.auth.form.passwordRequired'),
      terms: (key) => t(key),
    },
  };
}

/**
 * `labelsFor` 是个"要用 t()"的函数，而 `t` 来自 context。
 * 这里不挂 hook：词条表是纯数据，直接按 key 取 zh-CN 的译文即可。
 */
const t = (key: MessageKey, vars?: MessageVars): string => translate('zh-CN', key, vars);
const LABELS = labelsFor(t);

let root: Root | undefined;
let container: HTMLDivElement | undefined;

const noop = vi.fn();

function render(props: Partial<AuthFormProps> = {}): HTMLElement {
  if (root !== undefined) {
    act(() => {
      root?.unmount();
    });
    root = undefined;
  }
  container?.remove();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <HeytaUiProvider>
          <AuthForm
            labels={LABELS}
            onClose={noop}
            onSignIn={noop}
            onRegister={noop}
            onMagicLink={noop}
            onPasskey={noop}
            onRecovery={noop}
            onForgotPassword={noop}
            onVerifyToken={noop}
            serverUrl={{ value: 'https://heyta.waytofuture.cn', onChange: noop }}
            {...props}
          />
        </HeytaUiProvider>
      </I18nProvider>,
    );
  });
  return container as HTMLDivElement;
}

function query(el: HTMLElement, testID: string): HTMLElement | null {
  return el.querySelector<HTMLElement>(`[data-testid="${testID}"]`);
}

function press(el: HTMLElement, testID: string): void {
  const target = query(el, testID);
  if (target === null) throw new Error(`DOM 里没有 ${testID}`);
  act(() => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  container?.remove();
  container = undefined;
  noop.mockClear();
});

describe('A 第一屏的词汇：说的是"做什么"，不是"底层有什么"', () => {
  it('🔴 状态区那两行里不许出现「令牌」「凭据」「服务端签发」', () => {
    const el = render();
    const status = query(el, 'auth-form-status');
    expect(status, '状态区没渲染出来').not.toBeNull();
    const text = status?.textContent ?? '';
    expect(text.length, '第一屏的状态区是空的 —— 那等于什么都不说').toBeGreaterThan(0);
    // 「同步需要服务端签发的访问令牌。用邮箱注册或登录即可获得…」就是这张图的第一屏。
    for (const word of ['令牌', '凭据', '服务端签发']) {
      expect(text, `第一屏还在对用户说「${word}」`).not.toContain(word);
    }
    // 反过来必须说清"这是一次注册或登录"。
    expect(text).toContain('注册');
  });

  it('英文那一半同步收窄（词条表不许只改一边）', () => {
    const title = translate('en', 'web.auth.empty.title');
    const body = translate('en', 'web.auth.empty.body');
    const joined = `${title} ${body}`.toLowerCase();
    for (const word of ['token', 'credential']) {
      expect(joined, `en 的第一屏还在说「${word}」`).not.toContain(word);
    }
    expect(joined).toContain('register');
  });
});

describe('B 自建与"已有令牌"默认收起', () => {
  it('默认 DOM 里**没有**服务端地址栏与粘贴栏，但有两个展开入口', () => {
    const el = render();
    expect(query(el, 'auth-form-server-url')).toBeNull();
    expect(query(el, 'auth-form-paste')).toBeNull();
    expect(query(el, 'auth-form-self-host-toggle')).not.toBeNull();
    expect(query(el, 'auth-form-have-token-toggle')).not.toBeNull();
  });

  it('点「我自己部署」⇒ 地址栏出现，而且带着**已经填好的默认值**（不是空框）', () => {
    const el = render();
    press(el, 'auth-form-self-host-toggle');
    const input = query(el, 'auth-form-server-url');
    expect(input).not.toBeNull();
    expect((input as HTMLInputElement).value).toBe('https://heyta.waytofuture.cn');
  });

  it('两条门**各自独立**开合：展开"已有令牌"不该把地址栏也摊开', () => {
    const el = render();
    press(el, 'auth-form-have-token-toggle');
    expect(query(el, 'auth-form-paste')).not.toBeNull();
    expect(query(el, 'auth-form-server-url')).toBeNull();
  });

  it('🔴 宿主不给 toggle 时**保持常驻**（移动壳现状，不许被 web 的裁决顺手改掉）', () => {
    const el = render({
      labels: {
        ...LABELS,
        selfHostToggle: undefined,
        haveTokenToggle: undefined,
      } as AuthFormLabels,
    });
    expect(query(el, 'auth-form-server-url')).not.toBeNull();
    expect(query(el, 'auth-form-paste')).not.toBeNull();
  });
});

describe('D 渐进披露且错误不许指向看不见的东西', () => {
  it('🔴 地址为空 ⇒ 提交时那一栏**自己展开**（红字不许指向一个不存在的输入框）', () => {
    const el = render({ serverUrl: { value: '', onChange: noop } });
    const email = query(el, 'auth-form-email') as HTMLInputElement;
    act(() => {
      // RNW 的受控输入：走原生 setter + input 事件，直接改 .value React 收不到。
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(email, 'me@example.com');
      email.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // 地址校验和邮箱 + 口令提交在同一条主路上。
    press(el, 'auth-form-submit');
    const input = query(el, 'auth-form-server-url');
    expect(input, '地址被判没填，可那一栏还收着 —— 红字指向了不存在的东西').not.toBeNull();
    expect(el.textContent ?? '').toContain(LABELS.localErrors.baseUrl);
  });

  it('粘贴栏展开后「完成登录」这个动作还在（折叠不许把能力一起收掉）', () => {
    const el = render();
    press(el, 'auth-form-have-token-toggle');
    expect(query(el, 'auth-form-verify')).not.toBeNull();
  });
});

describe('C 主提交按钮与上方输入框的间距', () => {
  it('🔴 实测间距是表单节奏 12px，不是一个控件内部的 4px', () => {
    const el = render();
    const input = query(el, 'auth-form-email');
    const button = query(el, 'auth-form-submit');
    expect(input).not.toBeNull();
    expect(button).not.toBeNull();
    // jsdom 不跑布局（getBoundingClientRect 全是 0），所以量的是**样式值**：
    // 按钮自己声明的那一段外边距 + 容器 gap 共同构成视觉间距，
    // 而"按钮属于下一个控件"这件事只体现在它自己声明的那一段上。
    const marginTop = getComputedStyle(button as Element).marginTop;
    expect(marginTop, `「继续」的上外边距是 ${marginTop}，间距仍由 field 的 4px 决定`).toBe('8px');
  });

  it('值来自 token，不是新造的一个数（`space.2` = 8px，与容器 4px 合起来正好落在 space.3）', () => {
    const source = readFileSync(FORM_SRC, 'utf8');
    const primary = source.slice(source.indexOf('    primary: {'));
    expect(primary.slice(0, 900)).toContain("marginTop: tokens['space.2']");
    expect(primary.slice(0, 900)).not.toMatch(/marginTop:\s*['"]?\d/);
  });
});
