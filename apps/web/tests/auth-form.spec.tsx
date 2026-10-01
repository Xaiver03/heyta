/**
 * 判据：**登录/注册表单只有 `packages/ui` 那一份实现**，而且它在真 DOM 里说得对
 * ==========================================================================
 *
 * 出处：`docs/plans/user-journey-and-auth.md` §10（W6 那一行）。它要的不是
 * "组件写出来了"，而是「**共享层那一份**在各端渲染出来的东西」在**属性层面**成立 ——
 * 而 `packages/ui` 自己的测试**没有 jsdom、一张 DOM 都不碰**（那里只能写
 * "不该存在的形状"这种源码级断言）。所以行为判据只能挂在这里：
 * jsdom + react-native-web，也就是 web 壳实际用的那套渲染栈。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么这一组值得逐条写（每条都对应一个"看起来对、实际错"的实现）
 *
 * **A. 两步而不是两个可编辑来源。** 「继续」之后邮箱框**必须离开 DOM**：
 *    留着它，用户会改邮箱而**不重新走「继续」**，于是口令打在 A、界面显示 B。
 *    反向的坑也钉住：回第一步**不许清空**已输入的口令（他只是改个字母）。
 *    ⚠️ 后者只能靠**再按一次「继续」**证明 —— 口令字段此刻也离开了 DOM，读不到值。
 *
 * **B. `autocomplete` 的取值是功能，不是装饰。** RN 的类型检查抓不到写反 ——
 *    `current-password` 用在新口令字段上，浏览器会把**旧口令**填进注册表单，
 *    症状是"我明明填了新口令却注册失败"。只有 DOM 上的那一个字符串能证明它对了，
 *    而 RN 侧根本没有这个属性可读。`username webauthn` 那一串同理：
 *    它是浏览器**提议通行密钥**的开关（FIDO 混合登录）。
 *    🔴 同组还有**反向**判据：全表单**不许**出现 `maxlength` ——
 *    NIST 禁止静默截断口令，超长只能由服务端按码点判并给那一句。
 *
 * **C. 显隐默认档 + 开关。** 桌面默认遮、移动默认显示（NNG/NIST），
 *    两档都**保留**按钮（默认值不是能力）。`aria-pressed` 必须跟着翻 ——
 *    读屏用户听到的应该是"已选中：显示密码"，不是"一个按钮"。
 *
 * **D. in-flight guard 而不是禁用按钮。** `busy` 时动作只放行一次，
 *    而控件**必须仍然可聚焦**（DOM 里一个 `disabled`/`aria-disabled` 都不许有）：
 *    禁用态按钮让人困惑，提交后禁用还会把焦点从用户正站着的地方抽走。
 *
 * **E. 同意项是用户的决定。** 没勾就不发（服务端是 `z.literal(true)`），
 *    而且**界面绝不替他勾**；`role="checkbox"` + `aria-checked` 是真的语义，
 *    不是"一个会变色的方块"。邀请码形状不对时**这一个字段不发**（少一次注定被拒的往返），
 *    但权威判定仍在服务端 —— 这里只提前说一句。⚠️ 这条判据**必须先把字打进去**才成立：
 *    空着那一栏时"不发"是默认行为，注入"照发"的坏实现也测不出来（变异 #10 抓到过我）。
 *
 * **F. 降级 ≠ 删除，而且降级要有位置。** 产品负责人 2026-10-01 那句
 *    「绝对不允许什么用自己正在用的域名才能够注册」拆掉的正是**位置**：
 *    服务端地址原来是**第一栏**。所以这一组断言的是 **DOM 顺序**：
 *    口令主按钮 → 通行密钥/邮件链接/找回（文字链）→ 服务端地址（**最后**）。
 *    ⚠️ 顺序判据只能在这里做：`packages/ui` 的源码级断言读不出渲染顺序。
 *
 * **G. 错误是文字 + live region，服务端失败不指字段。** WCAG SC 3.3.1 不许只靠红框；
 *    而"邮箱不存在 / 没设口令 / 口令错"三者同码同句是**服务端**的反枚举裁决 ——
 *    界面若硬标一个框，就是在替服务端猜原因，等于把那条裁决又拆掉一遍。
 *
 * ⚠️ 本测试用 `@heyta/ui` 的 **`dist/`**（package exports）。
 *    改完 `packages/ui` 源码必须先 `pnpm --filter @heyta/ui build`，
 *    否则看到的是上一次构建的结果（假红或假绿都可能）。
 * ⚠️ RNW 的 `Pressable` 渲染成 `<button role="button">`、`accessibilityLiveRegion`
 *    落 `aria-live`、平铺 `aria-pressed`/`aria-checked` 原样进 DOM；
 *    对象形态 `accessibilityState` 会被 RNW **整个丢掉**（`pnpm check:rn-aria` 拦的就是它）。
 *    所以这里一律按 `data-testid` 寻址、按**真实 DOM 属性**断言。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 变异验证（2026-10-01）：**12 条**各自独立的"看起来对、实际错"的实现
 * 注入 `packages/ui/src/auth/{model.ts,AuthForm.tsx}` 后重跑本文件，**12/12 都有具名用例转红**，
 * 结束时源码与注入前**逐字节相同**。注入的分别是：
 *
 * | # | 注入的坏实现 | 抓到它的判据 |
 * |---|---|---|
 * | 1 | 「继续」后邮箱框只 `display:none`、不离开 DOM | A「邮箱框不在 DOM 里」 |
 * | 2 | 回第一步时清空口令 | A「重走继续后口令仍在」 |
 * | 3 | 空邮箱放行到第二步（**两层各去掉一遍**） | A「空邮箱不前进」 |
 * | 4 | 登录态口令框用 `new-password` | B「autofill 跟着模式翻」 |
 * | 5 | 显隐开关不翻 `aria-pressed` | C「属性 + label 同翻」 |
 * | 6 | 移动档把显隐按钮删掉 | C「默认明文但开关仍在」 |
 * | 7 | `busy` 时改成 `disabled` 控件 | D「DOM 里 0 个 disabled」 |
 * | 8 | 未勾同意项也发注册 | E「没勾不发 + 那句由你自己做出」 |
 * | 9 | 服务端失败默认标 `email` 字段 | G「两屏都不标字段」 |
 * | 10 | 形状不对的邀请码照样发出去 | E「形状不对时这一个字段不发」 |
 * | 11 | 三条降级链在 `passkeyAvailable=false` 时整块消失 | F「降级 ≠ 删除」 |
 * | 12 | 给口令框加 `maxLength` | B「全表单无 maxlength 且 400 字符原样保留」 |
 *
 * 🔴 三条**由这轮变异自己查出来**的事（不是 footnote，是这套判据的边界）：
 *
 * 1. **#3 一层去掉是行为中性的**：空邮箱同时在 `onContinue` 与
 *    `authFormStageAfterContinue` 各挡一遍，只拆一层测试照样绿 —— 那层是冗余防护，
 *    不是判据没用的东西。⇒ 变异要**两层同时去掉**才算验到。
 * 2. **#10 判据要先打字**：邀请栏空着时"不发"是默认，注入"照发"抓不到。
 * 3. **#9/#11 只在第二步跑会漏**：第二步根本没有邮箱框，第一条坏实现无从现形；
 *    降级链在第一步也在。⇒ 这两组都在**两个 stage** 各断言一遍。
 *
 * ⚠️ 变异工具本身的一次失败值得留档：vitest 的 `FAIL` 带 ANSI 色码，
 * 直接正则匹配会得到"注入后没有任何测试变红"的**假绿**。必须先剥色码。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { I18nProvider, translate, type MessageKey, type MessageVars } from '@heyta/i18n';
import {
  AuthForm,
  AUTH_TERMS_REQUIRED_KEY,
  HeytaUiProvider,
  type AuthFormLabels,
  type AuthFormProps,
} from '@heyta/ui';

/* ════════════════════════════════════════════════════════════════════════
 * 桩与渲染
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * 标签里**有共享词条的那几条**走 `translate()`：编译期就要求 key 真的存在，
 * 而这条测试跑在 zh-CN 上，所以"中文有没有这句"也是它的判据之一。
 * 其余用字面量 —— 宿主本来就用 `t()` 解析后传进来，这里只保证"传得出"。
 */
const t = (key: MessageKey, vars?: MessageVars): string => translate('zh-CN', key, vars);

const LABELS: AuthFormLabels = {
  title: '认证',
  titleText: '登录 / 注册',
  close: '关闭',
  email: '邮箱',
  emailPlaceholder: '你的邮箱地址',
  continue: t('common.auth.form.continue'),
  accountSummary: (email) => t('common.auth.form.accountSummary', { email }),
  changeEmail: t('common.auth.form.changeEmail'),
  password: t('common.auth.signInPassword.label'),
  signIn: t('common.auth.form.signIn'),
  signUp: '创建账号',
  showPassword: t('common.auth.form.showPassword'),
  hidePassword: t('common.auth.form.hidePassword'),
  passwordHint: t('common.auth.form.passwordHint'),
  forgotPassword: t('common.auth.form.forgotPassword'),
  switchToRegister: t('common.auth.form.switchToRegister'),
  switchToSignIn: t('common.auth.form.switchToSignIn'),
  otherWays: t('common.auth.form.otherWays'),
  terms: '我已阅读并同意条款',
  magicLink: '用邮件链接登录',
  recovery: '找回通行密钥',
  passkeyRegister: '用通行密钥注册',
  passkeyLogin: '用通行密钥登录',
  passkeyUnavailable: '这台设备不支持通行密钥',
  passkeyWaiting: '去看系统弹窗',
  emptyTitle: '还没有登录',
  emptyBody: '填邮箱继续。',
  invite: {
    label: '邀请码（选填）',
    placeholder: 'ABCDEF',
    invalid: (length) => `邀请码长度不对：${String(length)} 个字符。`,
  },
  legal: { terms: '《服务条款》', privacy: '《隐私政策》' },
  busyText: t('common.auth.busy.signIn'),
  localErrors: {
    baseUrl: '要先填服务端地址。',
    email: t('common.auth.form.emailRequired'),
    password: t('common.auth.form.passwordRequired'),
    // 组件递过来的就是那个 key：界面不许自己另造一句"请同意"。
    terms: (key) => t(key),
  },
};

const NO_INVITE: AuthFormLabels = { ...LABELS, invite: undefined };

const SERVER_URL_LABELS: AuthFormLabels = {
  ...LABELS,
  serverUrl: { label: '服务端地址', placeholder: 'https://sync.example.com' },
};

const PASTE_LABELS: AuthFormLabels = {
  ...LABELS,
  paste: { label: '粘贴登录链接或令牌', placeholder: '把邮件里的链接整段贴进来', verify: '确认' },
};

let root: Root | undefined;
let container: HTMLDivElement | undefined;

const signIn = vi.fn();
const register = vi.fn();
const magicLink = vi.fn();
const passkey = vi.fn();
const recovery = vi.fn();
const forgot = vi.fn();
const close = vi.fn();
const openLegal = vi.fn();
const verifyToken = vi.fn();
const serverUrlChange = vi.fn();

function render(props: Partial<AuthFormProps> = {}): HTMLElement {
  // 一条用例里可能连开两三个表单（有/无邀请栏、busy/不 busy），先收掉上一个：
  // 只 `remove()` 而不 unmount 会让旧 root 挂着，React 为"同一棵树多个 root"记警告，
  // 警告会淹没真问题（`auth-journey.spec.tsx` 同一处踩过）。
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
            onClose={close}
            onSignIn={signIn}
            onRegister={register}
            onMagicLink={magicLink}
            onPasskey={passkey}
            onRecovery={recovery}
            onForgotPassword={forgot}
            {...props}
          />
        </HeytaUiProvider>
      </I18nProvider>,
    );
  });
  return container;
}

/** 走到第二步（口令那一屏）：默认档 = 登录。 */
function renderCredential(props: Partial<AuthFormProps> = {}, email = 'me@example.com'): HTMLElement {
  const el = render(props);
  typeIn(el, 'auth-form-email', email);
  press(el, 'auth-form-continue');
  return el;
}

function node(el: HTMLElement, testID: string): HTMLElement {
  const found = el.querySelector<HTMLElement>(`[data-testid="${testID}"]`);
  if (found === null) throw new Error(`DOM 里没有 ${testID}`);
  return found;
}

function maybe(el: HTMLElement, testID: string): HTMLElement | null {
  return el.querySelector<HTMLElement>(`[data-testid="${testID}"]`);
}

function inputOf(el: HTMLElement, testID: string): HTMLInputElement {
  const found = node(el, testID);
  if (found.tagName !== 'INPUT') throw new Error(`${testID} 不是 <input>，而是 ${found.tagName}`);
  return found as unknown as HTMLInputElement;
}

/**
 * 真输入：走 `HTMLInputElement` 的原生 setter + `input` 事件。
 * 直接改 `.value` 会被 React 的受控值覆盖，那条路**测不到** `onChangeText`。
 */
function typeIn(el: HTMLElement, testID: string, value: string): void {
  const input = inputOf(el, testID);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('HTMLInputElement.value setter 不存在');
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function press(el: HTMLElement, testID: string): void {
  const target = node(el, testID);
  act(() => {
    target.click();
  });
}

function texts(el: HTMLElement): string {
  return el.textContent ?? '';
}

/** 焦点在哪一个 `data-testid` 上（本地校验要把焦点移过去，GOV.UK 的校验模式）。 */
function focusedTestID(): string | null {
  const active = document.activeElement;
  if (active === null || !(active instanceof HTMLElement)) return null;
  return active.getAttribute('data-testid');
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  vi.clearAllMocks();
});

/* ════════════════════════════════════════════════════════════════════════
 * A. 两步：一个邮箱框 + 「继续」，口令紧随其后
 * ══════════════════════════════════════════════════════════════════════ */

describe('A 两步旅程', () => {
  it('第一步只有邮箱：口令框与主按钮**都不在** DOM 里', () => {
    const el = render();
    expect(maybe(el, 'auth-form-email')).not.toBeNull();
    expect(maybe(el, 'auth-form-password')).toBeNull();
    expect(maybe(el, 'auth-form-submit')).toBeNull();
    // 二级链也还没出现：没有身份就没有"用别的方式"的对象。
    expect(maybe(el, 'auth-form-passkey')).toBeNull();
  });

  it('「继续」之后邮箱框**离开 DOM**，身份以一回执（不是第二个可编辑来源）', () => {
    const el = renderCredential();
    expect(maybe(el, 'auth-form-email')).toBeNull();
    expect(texts(el)).toContain('登录到：me@example.com');
    expect(node(el, 'auth-form-password')).not.toBeNull();
  });

  it('「改邮箱」回第一步：邮箱**值还在**，已输入的口令**也还在**', () => {
    const el = renderCredential();
    typeIn(el, 'auth-form-password', 'correct horse');
    press(el, 'auth-form-change-email');
    expect(inputOf(el, 'auth-form-email').value).toBe('me@example.com');
    // 口令框在第一步**不在 DOM 里**，所以"没清空"只能这样证明：
    // 再走一次「继续」，看到的必须还是他打过的那一句。
    press(el, 'auth-form-continue');
    expect(inputOf(el, 'auth-form-password').value).toBe('correct horse');
  });

  it('空邮箱点「继续」**不前进**：标字段、说出那句话、焦点落在邮箱框', () => {
    const el = render();
    press(el, 'auth-form-continue');
    expect(maybe(el, 'auth-form-password')).toBeNull();
    expect(inputOf(el, 'auth-form-email').getAttribute('aria-invalid')).toBe('true');
    expect(texts(el)).toContain(LABELS.localErrors.email);
    expect(focusedTestID()).toBe('auth-form-email');
  });

  it('本地校验只在按下之后出现：不逐键飘红（NNG/GOV.UK）', () => {
    const el = render();
    expect(texts(el)).not.toContain(LABELS.localErrors.email);
    inputOf(el, 'auth-form-email').focus();
    typeIn(el, 'auth-form-email', '  ');
    expect(texts(el)).not.toContain(LABELS.localErrors.email);
    press(el, 'auth-form-continue');
    expect(texts(el)).toContain(LABELS.localErrors.email);
    // 一开始修改就把错误清掉：留着红字是最劝退的形态。
    typeIn(el, 'auth-form-email', 'me@example.com');
    expect(texts(el)).not.toContain(LABELS.localErrors.email);
    expect(inputOf(el, 'auth-form-email').getAttribute('aria-invalid')).toBe('false');
  });

  it('全空格邮箱不算"填过了"：前进的判据是 trim 之后有没有内容', () => {
    const el = render();
    typeIn(el, 'auth-form-email', '   ');
    press(el, 'auth-form-continue');
    expect(maybe(el, 'auth-form-password')).toBeNull();
  });

  it('这里**不判**邮箱格式：格式归服务端裁决，组件不许长出第二套规则', () => {
    const el = render();
    typeIn(el, 'auth-form-email', 'not-an-email');
    press(el, 'auth-form-continue');
    expect(node(el, 'auth-form-password')).not.toBeNull();
    expect(signIn).not.toHaveBeenCalled();
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * B. autofill / 显隐 / 不截断：只有 DOM 上那一层能证明
 * ══════════════════════════════════════════════════════════════════════ */

describe('B autofill 与显隐（DOM 属性级）', () => {
  it('邮箱框是 `username webauthn`：管理器能填，浏览器也会在这格提议通行密钥', () => {
    const el = render();
    const autocomplete = inputOf(el, 'auth-form-email').getAttribute('autocomplete');
    expect(autocomplete).toBe('username webauthn');
  });

  it('登录档口令 = `current-password`，切到注册档 = `new-password`', () => {
    const el = renderCredential();
    expect(inputOf(el, 'auth-form-password').getAttribute('autocomplete')).toBe('current-password');
    press(el, 'auth-form-switch-mode');
    expect(inputOf(el, 'auth-form-password').getAttribute('autocomplete')).toBe('new-password');
  });

  it('注册档**不许**退化到 `on`，也不许留在 `current-password`', () => {
    const el = renderCredential();
    press(el, 'auth-form-switch-mode');
    const autocomplete = inputOf(el, 'auth-form-password').getAttribute('autocomplete');
    expect(['current-password', 'on', 'off', null]).not.toContain(autocomplete);
    expect(autocomplete).toBe('new-password');
  });

  it('桌面默认遮住，开关翻的是 `type` 与 `aria-pressed` 两件事（一起翻）', () => {
    const el = renderCredential();
    expect(inputOf(el, 'auth-form-password').type).toBe('password');
    expect(node(el, 'auth-form-reveal').getAttribute('aria-pressed')).toBe('false');
    press(el, 'auth-form-reveal');
    expect(inputOf(el, 'auth-form-password').type).toBe('text');
    expect(node(el, 'auth-form-reveal').getAttribute('aria-pressed')).toBe('true');
    // 名字跟着状态走：读屏用户按到的应该是"隐藏密码"。
    expect(node(el, 'auth-form-reveal').getAttribute('aria-label')).toBe(LABELS.hidePassword);
  });

  it('移动档默认明文**但开关仍在**：默认值不是能力', () => {
    const el = renderCredential({ platform: 'mobile' });
    expect(inputOf(el, 'auth-form-password').type).toBe('text');
    expect(node(el, 'auth-form-reveal').getAttribute('aria-pressed')).toBe('true');
    press(el, 'auth-form-reveal');
    expect(inputOf(el, 'auth-form-password').type).toBe('password');
  });

  it('🔴 全表单**没有一处** `maxlength`：NIST 禁止静默截断口令输入', () => {
    const el = renderCredential({
      labels: SERVER_URL_LABELS,
      serverUrl: { value: 'https://sync.example.com', onChange: serverUrlChange },
    });
    const long = 'x'.repeat(400);
    typeIn(el, 'auth-form-password', long);
    // 截断若发生在这一层，下面两行之一必红：属性存在 / 值变短。
    expect(el.querySelectorAll('input[maxlength]').length).toBe(0);
    expect(inputOf(el, 'auth-form-password').value).toBe(long);
  });

  it('口令原样交出去：不 trim、不改大小写、不做任何归一化', () => {
    const el = renderCredential();
    typeIn(el, 'auth-form-password', ' Pa55w0rd  ');
    press(el, 'auth-form-submit');
    expect(signIn).toHaveBeenCalledWith({
      email: 'me@example.com',
      password: ' Pa55w0rd  ',
    });
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * C. in-flight guard：busy 时不响应，但控件一个都不许禁用
 * ══════════════════════════════════════════════════════════════════════ */

describe('C 进行中的守卫', () => {
  it('`busy` 时主按钮**不响应**第二次提交', () => {
    const el = renderCredential({ busy: true });
    typeIn(el, 'auth-form-password', 'hunter2');
    press(el, 'auth-form-submit');
    expect(signIn).not.toHaveBeenCalled();
  });

  it('🔴 `busy` 时 DOM 里**没有任何** `disabled` / `aria-disabled`：禁用会丢焦点', () => {
    const el = renderCredential({ busy: true });
    expect(el.querySelectorAll('[disabled]').length).toBe(0);
    expect(el.querySelectorAll('[aria-disabled]').length).toBe(0);
    // 每条降级仍然可聚焦（有 tabindex），守卫的是动作不是控件。
    expect(node(el, 'auth-form-submit').getAttribute('tabindex')).toBe('0');
  });

  it('进行中说的是**在做什么**，不是与动作无关的一句通用文案', () => {
    const el = renderCredential({ busy: true });
    const busyRow = node(el, 'auth-form-busy');
    expect(busyRow.textContent).toBe(LABELS.busyText);
    // 同一时刻"或者用别的方式"那组仍然在（降级不等于删除），但动作全部拦住了。
    expect(texts(el)).toContain(LABELS.otherWays);
  });

  it('`busy` 时三条降级入口（通行密钥 / 邮件链接 / 找回）也都不放行', () => {
    const el = renderCredential({ busy: true });
    press(el, 'auth-form-passkey');
    press(el, 'auth-form-magic-link');
    press(el, 'auth-form-recovery');
    press(el, 'auth-form-forgot');
    expect(passkey).not.toHaveBeenCalled();
    expect(magicLink).not.toHaveBeenCalled();
    expect(recovery).not.toHaveBeenCalled();
    expect(forgot).not.toHaveBeenCalled();
  });

  it('不 `busy` 时它们各就各位：一次点击一次动作，带上此刻的身份', () => {
    const el = renderCredential();
    press(el, 'auth-form-magic-link');
    press(el, 'auth-form-recovery');
    press(el, 'auth-form-forgot');
    expect(magicLink).toHaveBeenCalledWith('me@example.com');
    expect(recovery).toHaveBeenCalledWith('me@example.com');
    expect(forgot).toHaveBeenCalledWith('me@example.com');
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * D. 注册那一档：同意项、邀请码、两条对外文本
 * ══════════════════════════════════════════════════════════════════════ */

/** 切到注册档：同一个邮箱框 +「继续」，注册与登录靠这一行文字链分开。 */
function toRegister(el: HTMLElement): void {
  press(el, 'auth-form-switch-mode');
}

describe('D 注册档', () => {
  it('没勾同意项**发不出**注册，并且这句话明说"由你自己做出"', () => {
    const el = renderCredential();
    toRegister(el);
    typeIn(el, 'auth-form-password', 'a fairly long passphrase');
    press(el, 'auth-form-submit');
    expect(register).not.toHaveBeenCalled();
    expect(texts(el)).toContain(LABELS.localErrors.terms('common.auth.error.termsRequired'));
    expect(node(el, 'auth-form-terms').getAttribute('aria-checked')).toBe('false');
  });

  it('勾上之后 `aria-checked` 翻真、注册带 `termsAccepted: true`', () => {
    const el = renderCredential();
    toRegister(el);
    press(el, 'auth-form-terms');
    expect(node(el, 'auth-form-terms').getAttribute('aria-checked')).toBe('true');
    typeIn(el, 'auth-form-password', 'a fairly long passphrase');
    press(el, 'auth-form-submit');
    expect(register).toHaveBeenCalledWith({
      email: 'me@example.com',
      password: 'a fairly long passphrase',
      termsAccepted: true,
    });
  });

  it('界面**不替他勾**：初始态就是 false，而"同意"只能来自一次真实点击', () => {
    const el = renderCredential();
    toRegister(el);
    expect(node(el, 'auth-form-terms').getAttribute('aria-checked')).toBe('false');
    expect(register).not.toHaveBeenCalled();
  });

  it('邀请码空着 = 请求里**没有这个键**（不是空串，服务端会把它当成一个码）', () => {
    const el = renderCredential();
    toRegister(el);
    press(el, 'auth-form-terms');
    typeIn(el, 'auth-form-password', 'pass');
    press(el, 'auth-form-submit');
    const sent = register.mock.calls[0]?.[0] as Record<string, unknown>;
    expect('inviteCode' in sent).toBe(false);
  });

  it('填了邀请码就**原样**带出去（不归一化：大小写与空格属于签发方）', () => {
    const el = renderCredential();
    toRegister(el);
    typeIn(el, 'auth-form-invite', ' ab12 ');
    press(el, 'auth-form-terms');
    typeIn(el, 'auth-form-password', 'pass');
    press(el, 'auth-form-submit');
    expect(register.mock.calls[0]?.[0]).toMatchObject({ inviteCode: ' ab12 ' });
  });

  it('形状不对时**这一个字段不发**、并说出长度那句：注册本身照发', () => {
    // 这里不发的是一个"注定被拒的码"，不是一笔交易：邀请码错了不该让注册也停住。
    // ⚠️ 判据要**真打进去一个码**：框子是空的时"不发"本来就成立，
    //    那条实现改成"照发"也不会红 —— 假绿就是这么来的。
    const el = renderCredential({ inviteInvalid: true, inviteCodeLength: 3 });
    toRegister(el);
    typeIn(el, 'auth-form-invite', 'ab1');
    press(el, 'auth-form-terms');
    typeIn(el, 'auth-form-password', 'pass');
    press(el, 'auth-form-submit');
    expect(register).toHaveBeenCalledTimes(1);
    const sent = register.mock.calls[0]?.[0] as Record<string, unknown>;
    expect('inviteCode' in sent).toBe(false);
    expect(texts(el)).toContain('3 个字符');
    expect(inputOf(el, 'auth-form-invite').getAttribute('aria-invalid')).toBe('true');
  });

  it('没有邀请机制的实例：那一栏**根本不出现**（不是灰掉）', () => {
    const el = renderCredential({ labels: NO_INVITE });
    toRegister(el);
    expect(maybe(el, 'auth-form-invite')).toBeNull();
  });

  it('两条对外文本是真的 `role="link"`，点出去的是**种类**而不是 URL', () => {
    const el = renderCredential({ onOpenLegal: openLegal });
    toRegister(el);
    expect(node(el, 'auth-form-legal-terms').getAttribute('role')).toBe('link');
    press(el, 'auth-form-legal-terms');
    press(el, 'auth-form-legal-privacy');
    expect(openLegal.mock.calls.map((c) => c[0])).toEqual(['terms', 'privacy']);
    // 组件不拼地址：地址与打开方式都是宿主的决定（自建实例发的是运营者自己的文本）。
    expect(el.querySelectorAll('a[href]').length).toBe(0);
  });

  it('「忘记密码」只在登录档出现：注册档里它是一句误导', () => {
    const signInEl = renderCredential();
    expect(maybe(signInEl, 'auth-form-forgot')).not.toBeNull();
    toRegister(signInEl);
    expect(maybe(signInEl, 'auth-form-forgot')).toBeNull();
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * E. 降级 ≠ 删除，而且降级要有**位置**（DOM 顺序就是视觉主路）
 * ══════════════════════════════════════════════════════════════════════ */

describe('E 主路只有一条：位置是判据', () => {
  /** 两个 `data-testid` 在 DOM 里的先后下标（文档序）。缺一个就抛，不返回 `-1`。 */
  function order(el: HTMLElement, first: string, second: string): [number, number] {
    const all = [...el.querySelectorAll<HTMLElement>('[data-testid]')];
    const at = (id: string): number => {
      const index = all.findIndex((n) => n.getAttribute('data-testid') === id);
      if (index < 0) throw new Error(`DOM 里没有 ${id}`);
      return index;
    };
    return [at(first), at(second)];
  }

  it('口令主按钮排在通行密钥**之前**（FIDO 2023：autofill 才是主路）', () => {
    const el = renderCredential();
    const [submit, passkeyAt] = order(el, 'auth-form-submit', 'auth-form-passkey');
    expect(submit).toBeLessThan(passkeyAt);
  });

  it('🔴 服务端地址在 DOM 的**最后**：它原来是第一栏，那正是被点名拆掉的那道墙', () => {
    const el = renderCredential({
      labels: SERVER_URL_LABELS,
      serverUrl: { value: 'https://sync.example.com', onChange: serverUrlChange },
    });
    const all = [...el.querySelectorAll<HTMLElement>('[data-testid]')];
    const urlIndex = all.findIndex((n) => n.getAttribute('data-testid') === 'auth-form-server-url');
    const submitIndex = all.findIndex((n) => n.getAttribute('data-testid') === 'auth-form-submit');
    expect(urlIndex).toBeGreaterThan(submitIndex);
    // 而且它是**预填**的：空着等用户填地址的默认态不是这个组件的默认态。
    expect(inputOf(el, 'auth-form-server-url').value).toBe('https://sync.example.com');
  });

  it('降级**不等于删除**：passkey / 邮件链接 / 找回 / 忘记密码四条全在 DOM 里', () => {
    const el = renderCredential();
    for (const id of [
      'auth-form-passkey',
      'auth-form-magic-link',
      'auth-form-recovery',
      'auth-form-forgot',
    ]) {
      expect(maybe(el, id)).not.toBeNull();
    }
  });

  it('设备不支持通行密钥：**说清原因**，而不是把按钮禁掉', () => {
    const el = renderCredential({ passkeyAvailable: false });
    expect(texts(el)).toContain(LABELS.passkeyUnavailable);
    expect(maybe(el, 'auth-form-passkey')).not.toBeNull();
    expect(el.querySelectorAll('[disabled]').length).toBe(0);
  });

  it('在等系统弹窗时说的是"去看弹窗"（否则用户以为界面卡住）', () => {
    const el = renderCredential({ waitingForPasskey: true });
    expect(texts(el)).toContain(LABELS.passkeyWaiting);
  });

  it('通行密钥那一次交出去的是**当前档 + 此刻的字段值**', () => {
    const el = renderCredential();
    typeIn(el, 'auth-form-password', 'typed');
    press(el, 'auth-form-passkey');
    expect(passkey).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'login', email: 'me@example.com', password: 'typed' }),
    );
  });

  it('粘贴兜底那一栏只在宿主给了回调时出现（它是兜底，不是主路）', () => {
    const noPaste = renderCredential({ labels: PASTE_LABELS });
    expect(maybe(noPaste, 'auth-form-paste')).toBeNull();
    const withPaste = renderCredential({ labels: PASTE_LABELS, onVerifyToken: verifyToken });
    typeIn(withPaste, 'auth-form-paste', 'tok-42');
    press(withPaste, 'auth-form-verify');
    expect(verifyToken).toHaveBeenCalledWith('tok-42');
    // 交出去之后清空：一条用过的令牌留在框里，下一次会照着它再发一遍。
    expect(inputOf(withPaste, 'auth-form-paste').value).toBe('');
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * F. 状态区：文字 + live region；服务端失败不指字段
 * ══════════════════════════════════════════════════════════════════════ */

describe('F 状态与错误落点', () => {
  it('状态区是一条 live region：新句子会被读屏念出来', () => {
    const el = render();
    expect(node(el, 'auth-form-status').getAttribute('aria-live')).toBe('polite');
  });

  it('空状态明说"还没有登录"，不是"什么都不显示"', () => {
    const el = render();
    expect(texts(el)).toContain(LABELS.emptyTitle);
    expect(texts(el)).toContain(LABELS.emptyBody);
  });

  it('🔴 服务端失败**不标任何字段**：那三类同码同句没有"哪个框错了"的答案', () => {
    const message = { tone: 'error', message: t('common.auth.error.invalidCredentials') } as const;
    // 第一步：这一屏**有一个真的输入框**，"不许标它"才有东西可标。
    // （只在第二步判是不够的：那一屏邮箱框已经离开 DOM，
    //   实现里"默认标 email"那种错法恰好看不见 —— 变异验证 #11 抓到过我这条。）
    const first = render({ status: message });
    expect(inputOf(first, 'auth-form-email').getAttribute('aria-invalid')).toBe('false');
    expect([...first.querySelectorAll<HTMLElement>('[aria-invalid="true"]')].length).toBe(0);
    expect(texts(first)).toContain('邮箱或密码不正确');
    // 第二步：口令框同样不标 —— 口令错与邮箱不存在在服务端是同一句话。
    const second = renderCredential({ status: message });
    expect(inputOf(second, 'auth-form-password').getAttribute('aria-invalid')).toBe('false');
    expect([...second.querySelectorAll<HTMLElement>('[aria-invalid="true"]')].length).toBe(0);
  });

  it('本地校验才指字段：`field: password` 让口令框带 `aria-invalid`', () => {
    const el = renderCredential({
      status: { tone: 'error', message: LABELS.localErrors.password, field: 'password' },
    });
    expect(inputOf(el, 'auth-form-password').getAttribute('aria-invalid')).toBe('true');
  });

  it('成功句与失败句用**不同**的语义（不是同一个红字换内容）', () => {
    // 颜色住在 RNW 生成的 class 里（`r-color-*`），不是 inline style：
    // inline 只有字号/字重/行高。所以比的是 class 里那一个颜色类。
    // ⚠️ 每次渲染**当场**读出来：`render()` 会把上一个 root unmount 掉，
    //    旧容器随之变空 —— 先存引用再统一读，读到的就是三张空壳。
    const toneClass = (status: NonNullable<AuthFormProps['status']>): string => {
      const message = node(renderCredential({ status }), 'auth-form-status').querySelector('div');
      if (message === null) throw new Error('状态区没渲染出句子');
      const color = message.className.split(/\s+/).find((c) => c.includes('color'));
      if (color === undefined) throw new Error('句子没有颜色类');
      return color;
    };
    const errorClass = toneClass({
      tone: 'error',
      message: t('common.auth.error.invalidCredentials'),
    });
    const successClass = toneClass({ tone: 'success', message: t('common.auth.sent.reset') });
    const infoClass = toneClass({ tone: 'info', message: t('common.auth.busy.verify') });
    // 三档各不相同：error 与 success 共用一档就是"界面分不清好消息和坏消息"。
    expect(errorClass).not.toBe(successClass);
    expect(errorClass).not.toBe(infoClass);
    expect(successClass).not.toBe(infoClass);
  });

  it('口令被策略拒绝时，界面上是**那一条**具体的话（不是统称）', () => {
    // 第二层映射（policyCode → 句子）住在共享层，宿主只负责把成品句子递进来；
    // 这里钉的是"这一层能显示一句具体的话"，映射本身在 packages/ui 的源码级测试里。
    const el = renderCredential({
      status: {
        tone: 'error',
        message: t('common.auth.policy.breached'),
        field: 'password',
      },
    });
    expect(texts(el)).toContain('已泄露');
    expect(inputOf(el, 'auth-form-password').getAttribute('aria-invalid')).toBe('true');
  });
});
