/**
 * 认证状态 store
 * ===============
 *
 * 服务端**早就有完整认证**，而在此之前没有任何客户端调用过它：
 * 用户唯一的凭据入口是同步设置里三个手填的输入框，而且没人告诉他令牌从哪来。
 * 这个 store 是补上的那一半的**状态一侧**。
 *
 * ## 职责边界（AGENTS.md §3.5）
 *
 * 这里**不做协议判断**：
 *   - 打哪个端点、发什么字段、凭据在响应体的哪个字段里、失败怎么归类 ——
 *     全在 `@heyta/app-host` 的 `hosted-auth.ts`；
 *   - "登录链接长什么样、令牌从哪一段里取"—— 也在那边（`extractAuthLinkToken`）；
 *   - 用户看到的句子 —— 在界面里按结构化 `reason` 取词条。
 * 本文件只负责"什么时候调用一次"以及把结果放进 state。
 *
 * ## 🔴 拿到令牌之后必须真的接上同步配置
 *
 * `verify` 成功的那一刻会调 `useSyncStore.getState().applyAuthToken(...)`。
 * 少了这一步，用户会看到"已登录"，而同步设置里仍然是空的 ——
 * 也就是**界面说成功、功能没接上**，正是本仓库反复记过的那种缺陷。
 *
 * ## 🔴 失败是状态，不是异常
 *
 * `auth` 的每个动作都返回结果、不抛错。`status.kind === 'failed'` 里带的是
 * **结构化的 `reason`**（`@heyta/app-host` 的封闭集合），句子留给界面。
 */

import { create } from 'zustand';

import {
  beginPasskeyLogin,
  beginPasskeyRegistration,
  changePassword as changePasswordRequest,
  completePasskeyLogin,
  completePasskeyRegistration,
  extractAuthLinkToken,
  loginWithEmailPassword,
  registerWithMagicLink,
  registerWithEmailPassword,
  requestMagicLink,
  requestPasswordReset,
  requestPasskeyRecovery,
  resetPasswordWithToken,
  verifyMagicLink,
  type HostedAuthFailure,
  type HostedAuthFailureReason,
  type HostedAuthSession,
  type HostedPasswordPolicyCode,
} from '@heyta/app-host';

import { maybeHandOffToShell } from './desktop-handoff.js';
import { useSyncStore } from '../sync/store.js';
import { applyLocale, currentLocale, hasStoredLocalePreference } from '../../lib/locale.js';
import {
  createPasskeyCredential,
  detectPasskeyBrowser,
  getPasskeyCredential,
  type PasskeyBrowser,
} from './passkey-browser.js';

/**
 * 正在进行的动作。用来禁用按钮并把状态如实说出来（"正在发送…"）。
 *
 * `passkey-*` 两条与邮件那条**分成不同的动作**：界面上要能显示
 * "等待系统弹窗…"，而不是笼统的"正在登录"（用户此刻应该去看系统弹窗）。
 */
export type AuthBusyAction =
  | 'login-link'
  | 'register'
  | 'verify'
  | 'passkey-register'
  | 'passkey-login'
  | 'recovery'
  /**
   * 口令这条路。四条各自是一个动作，**不是一个"正在处理"**：
   * `password-sign-in` 失败可能是"口令错"（要指到口令那一格），
   * `password-forgot` 成功是"信已发出"（不许说"已发送到你邮箱"那样肯定的话），
   * `password-change` 成功会让**其余设备全部掉线**（那句话必须在点之前就看到）。
   */
  | 'password-sign-in'
  | 'password-register'
  | 'password-forgot'
  | 'password-change';

export type AuthStatus =
  /** 还没有凭据 —— 界面必须给出**明确的空状态**，而不是假装成功。 */
  | { kind: 'signed-out' }
  | { kind: 'busy'; action: AuthBusyAction }
  /** 登录链接已发出（服务端用中性文案防邮箱枚举，所以这里也不许断言"邮箱存在"）。 */
  | { kind: 'link-sent' }
  /** 注册申请已提交，还需要去邮箱点验证链接。**这不是"已登录"。** */
  | { kind: 'registered' }
  /** 找回通行密钥的邮件已发出（入口见 `requestRecovery`）。同样不断言邮箱存在。 */
  | { kind: 'recovery-sent' }
  /**
   * "重置口令"的邮件已发出（ADR-0040）。
   *
   * 🔴 服务端在**这个请求里**永远回 200 + 同一句中性文案，连异常也回 200 ——
   * 状态码只要随"账号是否存在"变化，它就是一个邮箱存在性预言机。
   * 所以这一句只能渲染成"如果我们认得这个邮箱，信已经发出去了"。
   */
  | { kind: 'reset-sent' }
  | { kind: 'signed-in'; email: string }
  /**
   * 已登录改口令成功。
   *
   * 🔴 与 `signed-in` **分开**：改密的瞬间 `tokenVersion` 已 bump，
   * 手上那枚旧令牌当场失效，而当前设备拿到的是**新会话**。
   * 把它渲染成"已登录"会漏掉唯一需要告诉用户的那件事：别的设备要重新认证。
   */
  | { kind: 'password-changed'; email: string }
  /**
   * 失败。
   *
   * 🔴 `policyCode` / `retryAfterSeconds` **必须带出来**：
   *   · `password-policy` 不带 `policyCode`，界面只能说"口令不合格"，
   *     而用户要知道是哪一条（太短 / 太长 / 太常见 / 已泄露）——
   *     那四条的**做法完全不同**（尤其"已泄露"意味着他别处也在用同一个）；
   *   · `password-locked` 不带秒数，用户会对着一个不知道什么时候能再试的表单反复敲，
   *     而那正是失败计数设计要避免的行为。
   * 两者都是服务端给的，这里只搬运，**不自己判**（AGENTS.md §3.5）。
   */
  | {
      kind: 'failed';
      reason: HostedAuthFailureReason;
      policyCode?: HostedPasswordPolicyCode;
      retryAfterSeconds?: number;
    };

export interface AuthStoreState {
  status: AuthStatus;

  /** 发登录链接。`baseUrl` 由壳传入（用户可能刚改过地址但还没保存）。 */
  sendLoginLink: (baseUrl: string, email: string) => Promise<void>;
  /** 注册新账号。`termsAccepted` 只在用户真的勾了时为 true。 */
  registerAccount: (
    baseUrl: string,
    email: string,
    termsAccepted: boolean,
    /** 邀请码（原样，未归一化）。`undefined` = 用户在邀请链接之外自己注册的。 */
    inviteCode?: string,
  ) => Promise<void>;
  /**
   * 用邮件里的链接或令牌完成登录。
   *
   * 成功时**已经把令牌写进同步配置**，并把会话返回给调用方
   * （壳要拿它把设置对话框里的输入框也同步上，否则用户一点"保存并同步"
   * 就会用空的输入框把刚拿到的令牌覆盖掉）。
   */
  verify: (baseUrl: string, input: string) => Promise<HostedAuthSession | undefined>;
  /**
   * **直接采用一个已经签发好的会话**（ADR-0039 §2.3）。
   *
   * 🔴 它存在的理由：桌面壳的反向授权回跳把**会话本身**（JWT）交进来 ——
   *    那是**另一种东西**，不是"一次性链接令牌"。拿会话去走 `verify()` 会被
   *    服务端按链接令牌那一列查 ⇒ 必然 401（2026-09-30 实测）。
   *
   * ⚠️ 它**不新写**"登录成功后该做什么"：内部就调同一个 `applyAuthSession`，
   *    所以落盘凭据、桌面回跳、状态翻转都只有一份实现。
   */
  adoptSession: (
    baseUrl: string,
    session: HostedAuthSession,
  ) => void;
  /**
   * 用通行密钥注册。**与邮件注册是两条路，不是同一条的快捷方式**：
   * 这里多了一步"让系统弹窗创建凭据"，而它**必须发生在浏览器里**。
   *
   * `browser` 可注入（jsdom 没有 `navigator.credentials`）；不传时自动探测。
   *
   * ⚠️ 成功**不等于已登录** —— 服务端建的还是待验证账号，仍要去邮箱点验证链接，
   * 所以状态是 `registered` 而不是 `signed-in`。
   */
  registerPasskey: (
    baseUrl: string,
    email: string,
    termsAccepted: boolean,
    /**
     * 可选的附加项。
     *
     * 🔴 **刻意用对象而不是再加一个位置参数**：`registerPasskey` 原来第 4 个
     * 位置是 `browser`，而测试与调用点都按位置传它。往它前面插一个参数会让
     * 那些调用点把**浏览器适配器当成邀请码**发出去 —— 类型上恰好都能过
     * （`inviteCode?: string` 会拒，但如果写成 `unknown` 就完全静默），
     * 表现为注册请求 400，而排查方向会跑到认证上去。
     */
    options?: { inviteCode?: string; browser?: PasskeyBrowser },
  ) => Promise<void>;
  /**
   * 用通行密钥登录。**这是第二个（也是唯一另一个）产出令牌的入口**，
   * 成功时同样已经把令牌写进同步配置。
   */
  loginWithPasskey: (
    baseUrl: string,
    email: string,
    browser?: PasskeyBrowser,
  ) => Promise<HostedAuthSession | undefined>;
  /**
   * 申请**找回**通行密钥：让服务端把恢复链接发到邮箱。
   *
   * 🔴 这是恢复流程的**入口**，不是恢复本身。恢复本身（拿邮件里的令牌注册一个新通行密钥）
   * 由服务端渲染的 `/recover-passkey` 页面 + `recover-passkey.js` 完成 ——
   * 那一步必须在真实浏览器里调 `navigator.credentials.create()`，不可能放在这里。
   *
   * 补它的理由很具体：在此之前**丢了通行密钥的用户没有任何入口能拿到恢复链接**。
   * 服务端 `/api/recover/passkey` 与 app-host 的 `requestPasskeyRecovery` 都是完整实现，
   * 但**零调用方** —— 也就是"功能做完了、用户做不到"，本仓库反复记过的那类缺陷。
   *
   * 与登录链接一样，服务端用中性文案防邮箱枚举 ⇒ 成功也**不断言邮箱存在**。
   */
  requestRecovery: (baseUrl: string, email: string) => Promise<void>;
  /**
   * 用**邮箱 + 口令**登录（产出会话的第三条路）。
   *
   * 🔴 口令**原样**交出，不在这里 trim / normalize / 改大小写：
   * 归一化只在服务端一处发生，客户端多算一次就是第二套规则，
   * 表现是"同一句口令在两台设备上字节不同"（四端各一套归一化 = 四套账号系统）。
   *
   * 成功走**同一个** `applyAuthSession`。
   */
  signInWithPassword: (
    baseUrl: string,
    email: string,
    password: string,
  ) => Promise<HostedAuthSession | undefined>;
  /**
   * 用**邮箱 + 口令**注册。
   *
   * ⚠️ 成功**不等于已登录**：服务端建号但 `isVerified=0`，仍要去邮箱点验证链接，
   * 所以状态是 `registered`。邮箱已被占用时服务端给**同一句、同一个状态码**，
   * 界面也不许在这里说"账号已存在"。
   */
  registerWithPassword: (
    baseUrl: string,
    email: string,
    password: string,
    termsAccepted: boolean,
    /**
     * 邀请码（原样，不归一化 —— 形状规则属于签发方）。
     * 用对象收可选附加项，与 `registerPasskey` 同一条理由：位置参数往前插会
     * 让既有调用点把别的实参当成邀请码发出去，而那种错在类型上可以是静默的。
     */
    options?: { inviteCode?: string },
  ) => Promise<void>;
  /**
   * 申请一封"重置口令"的邮件。
   *
   * 🔴 这一条**没有**对应的 SPA 表单：真正填新口令的那张表是服务端渲染的
   * `/reset-password`（ADR-0040 —— 重置成功**不发会话**）。这里只是**发起**那封信。
   */
  forgotPassword: (baseUrl: string, email: string) => Promise<void>;
  /**
   * 已登录改口令：`{ kind: 'password-changed' }`，**不是** `signed-in`。
   *
   * 🔴 成功后当前设备必须换成服务端给的**新会话**：`tokenVersion` 是全局计数器，
   * bump 之后手上这枚也失效。只回一句"修改成功"的症状是"改个密码把自己这个
   * 标签页也踢出去"，而界面刚说完成功。其余设备此时全部需要重新认证 —— 那句话
   * 要在**点之前**就显示（见 `PasswordPanel`）。
   */
  changePassword: (
    baseUrl: string,
    token: string | undefined,
    currentPassword: string,
    newPassword: string,
  ) => Promise<HostedAuthSession | undefined>;
  /** 回到空状态（关闭/重开认证面板时用）。 */
  reset: () => void;
}

/**
 * 认证成功后写回同步配置。
 *
 * 🔴 抽成具名函数而不是内联在 `verify` 里，是为了让
 * `tests/auth-panel.spec.tsx` 那条"令牌必须被写上"的断言有一个
 * **可以被拿掉、并因此变红**的东西 —— 不改测试就能验证它承重。
 */
function applyAuthSession(baseUrl: string, session: HostedAuthSession): void {
  // 邮箱一起交过去：左侧导航顶部的头像要用它算首字母，
  // 而刷新之后 `useAuthStore` 会回到 signed-out —— 头像得能从落盘的凭据里拿到它。
  useSyncStore.getState().applyAuthToken(baseUrl, session.token, session.user.email);

  /**
   * 账号语言（应用语言解析链第 2 层，2026-10-01 拍板）：本机**没有**显式选择时
   * 采纳它 —— 新设备首登即得账号语言。有显式选择则绝不覆盖（第 1 层永远更高）。
   * `applyLocale` 会通知 `LocaleHost`，界面当场切换，不用刷新。
   */
  if (session.user.locale !== undefined && !hasStoredLocalePreference()) {
    applyLocale(session.user.locale);
  }

  /**
   * 🔴 桌面壳的**反向授权回跳**（ADR-0039 §2.3）。
   *
   * 这里挂着是刻意的：**所有登录路径都汇聚到这个函数**（通行密钥 / 邮箱链接 / 粘贴令牌），
   * 所以在它上面加一次判定，就不会漏掉某一条路。
   * 不是桌面流程时 `maybeHandOffToShell` 直接返回 `null`，什么都不做。
   */
  if (typeof window !== 'undefined') {
    maybeHandOffToShell(session.token, new URL(window.location.href), document, session.user.email);
  }
}

/**
 * 失败 → 状态。**唯一的构造点**。
 *
 * 🔴 为什么要一个函数而不是就地 `{ kind: 'failed', reason }`：
 * `policyCode` 与 `retryAfterSeconds` 是**服务端给的**，写在 `HostedAuthFailure` 上，
 * 而每一处手写的 `failedFrom(outcome)` 都会**静默丢掉**它们 ——
 * 丢掉的形状是"界面少说一句具体的话"，没有任何一层会报错，测试也不会红
 * （除非专门钉它）。这类"多字段的结果被单字段的构造点吃掉"是本仓库记过的老形状。
 *
 * `undefined` 的字段**不写进对象**（而不是写成 `undefined`）：状态要能被
 * `toEqual` 逐字段比较，多余的空键会让"没带秒数"和"带了 undefined"长得不一样。
 */
function failed(
  reason: HostedAuthFailureReason,
  extra?: Pick<HostedAuthFailure, 'policyCode' | 'retryAfterSeconds'>,
): AuthStatus {
  return {
    kind: 'failed',
    reason,
    ...(extra?.policyCode === undefined ? {} : { policyCode: extra.policyCode }),
    ...(extra?.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: extra.retryAfterSeconds }),
  };
}

/** 从一次失败的 outcome 里把**全部**结构化信息搬进状态。 */
function failedFrom(outcome: HostedAuthFailure): AuthStatus {
  return failed(outcome.reason, outcome);
}

export const useAuthStore = create<AuthStoreState>((set) => ({
  status: { kind: 'signed-out' },

  adoptSession: (baseUrl, session) => {
    applyAuthSession(baseUrl, session);
    set({ status: { kind: 'signed-in', email: session.user.email } });
  },

  sendLoginLink: async (baseUrl, email) => {
    set({ status: { kind: 'busy', action: 'login-link' } });
    // 带上当前界面语言：在中文浏览器里把应用切成英文的用户，邮件也该是英文。
    const outcome = await requestMagicLink({ baseUrl, locale: currentLocale() }, email);
    set({ status: outcome.ok ? { kind: 'link-sent' } : failedFrom(outcome) });
  },

  registerAccount: async (baseUrl, email, termsAccepted, inviteCode) => {
    set({ status: { kind: 'busy', action: 'register' } });
    const outcome = await registerWithMagicLink(
      { baseUrl, locale: currentLocale() },
      {
        email,
        ...(termsAccepted ? { termsAccepted: true } : {}),
        ...(inviteCode === undefined || inviteCode === '' ? {} : { inviteCode }),
      },
    );
    set({
      status: outcome.ok ? { kind: 'registered' } : failedFrom(outcome),
    });
  },

  verify: async (baseUrl, input) => {
    // 从"邮件里的链接"或"裸令牌"里取令牌是**协议知识**，在 app-host 里。
    const token = extractAuthLinkToken(input);
    if (token === undefined) {
      set({ status: failed('invalid-input') });
      return undefined;
    }

    set({ status: { kind: 'busy', action: 'verify' } });
    const outcome = await verifyMagicLink({ baseUrl }, token);
    if (!outcome.ok) {
      set({ status: failedFrom(outcome) });
      return undefined;
    }

    applyAuthSession(baseUrl, outcome.session);
    set({ status: { kind: 'signed-in', email: outcome.session.user.email } });
    return outcome.session;
  },

  registerPasskey: async (baseUrl, email, termsAccepted, options) => {
    const inviteCode = options?.inviteCode;
    const browser = options?.browser;
    // 🔴 能力探测必须发生在**发任何请求之前**。不支持的设备上先问服务端要
    // options 是白问，而且会把"这台设备不支持"伪装成一次失败的网络请求。
    const resolved = browser ?? detectPasskeyBrowser();
    if (resolved === undefined || !resolved.supported) {
      set({ status: failed('passkey-unsupported') });
      return;
    }

    set({ status: { kind: 'busy', action: 'passkey-register' } });

    // ① 取 options（协议在 app-host）。带上界面语言：verify 那步要发验证邮件。
    const begun = await beginPasskeyRegistration(
      { baseUrl, locale: currentLocale() },
      {
        email,
        ...(termsAccepted ? { termsAccepted: true } : {}),
        ...(inviteCode === undefined || inviteCode === '' ? {} : { inviteCode }),
      },
    );
    if (!begun.ok) {
      set({ status: failedFrom(begun) });
      return;
    }

    // ② 平台那一步（**这一段是本次补上的**）。用户在系统弹窗上操作，
    //    所以这里可能停住很久 —— 状态已经是 busy，界面会如实显示"等待系统弹窗…"。
    const created = await createPasskeyCredential(begun.options, resolved);
    if (!created.ok) {
      set({ status: failedFrom(created) });
      return;
    }

    // ③ 交回服务端回验（语言同样要带：发信发生在这里）
    const completed = await completePasskeyRegistration(
      { baseUrl, locale: currentLocale() },
      {
        email,
        credential: created.credential,
        // 🔴 options 与 verify 两次都要带：绑定发生在 verify，
        // 所以只带前一次等于没带（见 hosted-auth.ts 里的同一段注释）。
        ...(inviteCode === undefined || inviteCode === '' ? {} : { inviteCode }),
      },
    );
    set({
      status: completed.ok
        ? { kind: 'registered' }
        : failedFrom(completed),
    });
  },

  loginWithPasskey: async (baseUrl, email, browser) => {
    // 同上：不支持的设备一个请求都不发。
    const resolved = browser ?? detectPasskeyBrowser();
    if (resolved === undefined || !resolved.supported) {
      set({ status: failed('passkey-unsupported') });
      return undefined;
    }

    set({ status: { kind: 'busy', action: 'passkey-login' } });

    const begun = await beginPasskeyLogin({ baseUrl }, email);
    if (!begun.ok) {
      set({ status: failedFrom(begun) });
      return undefined;
    }

    const assertion = await getPasskeyCredential(begun.options, resolved);
    if (!assertion.ok) {
      set({ status: failedFrom(assertion) });
      return undefined;
    }

    const completed = await completePasskeyLogin(
      { baseUrl },
      { email, credential: assertion.credential },
    );
    if (!completed.ok) {
      set({ status: failedFrom(completed) });
      return undefined;
    }

    // 与 verify 走**同一个** applyAuthSession —— 令牌落进同步配置这件事
    // 只允许有一份实现，否则两个入口迟早有一个漏掉。
    applyAuthSession(baseUrl, completed.session);
    set({ status: { kind: 'signed-in', email: completed.session.user.email } });
    return completed.session;
  },

  requestRecovery: async (baseUrl, email) => {
    set({ status: { kind: 'busy', action: 'recovery' } });
    const outcome = await requestPasskeyRecovery({ baseUrl, locale: currentLocale() }, email);
    set({
      status: outcome.ok ? { kind: 'recovery-sent' } : failedFrom(outcome),
    });
  },

  signInWithPassword: async (baseUrl, email, password) => {
    // 🔴 口令**原样**交出：不 trim、不改大小写、不做 composition 判断。
    // 一次多余的 trim 会让"句口令末尾有个空格"的用户在别的设备上登不进去，
    // 而两边的字节确实不同 —— 这类缺陷只会在真用户身上出现，构建期抓不到。
    set({ status: { kind: 'busy', action: 'password-sign-in' } });
    const outcome = await loginWithEmailPassword({ baseUrl }, { email, password });
    if (!outcome.ok) {
      set({ status: failedFrom(outcome) });
      return undefined;
    }
    // 与 verify / loginWithPasskey **同一个** applyAuthSession。
    applyAuthSession(baseUrl, outcome.session);
    set({ status: { kind: 'signed-in', email: outcome.session.user.email } });
    return outcome.session;
  },

  registerWithPassword: async (baseUrl, email, password, termsAccepted, options) => {
    const inviteCode = options?.inviteCode;
    set({ status: { kind: 'busy', action: 'password-register' } });
    const outcome = await registerWithEmailPassword(
      { baseUrl, locale: currentLocale() },
      {
        email,
        password,
        ...(termsAccepted ? { termsAccepted: true } : {}),
        ...(inviteCode === undefined || inviteCode === '' ? {} : { inviteCode }),
      },
    );
    // ⚠️ 成功 → `registered`（还要去邮箱点验证链接），**不是** `signed-in`。
    // 把"号建了"渲染成"登录好了"是本仓库记过的那类"状态对、界面在说谎"。
    set({
      status: outcome.ok ? { kind: 'registered' } : failedFrom(outcome),
    });
  },

  forgotPassword: async (baseUrl, email) => {
    set({ status: { kind: 'busy', action: 'password-forgot' } });
    const outcome = await requestPasswordReset({ baseUrl, locale: currentLocale() }, email);
    // 🔴 成功 → `reset-sent`：服务端对"有这个账号 / 没有 / 异常"回**同一句 + 200**，
    // 所以这里拿到 ok 也**不能**说"信已发到你的邮箱"，只能说"如果我们认得这个邮箱…"。
    // ⚠️ 新口令那张表在服务端渲染的 `/reset-password` 页（ADR-0040），不在这里。
    set({
      status: outcome.ok ? { kind: 'reset-sent' } : failedFrom(outcome),
    });
  },

  changePassword: async (baseUrl, token, currentPassword, newPassword) => {
    set({ status: { kind: 'busy', action: 'password-change' } });
    const outcome = await changePasswordRequest(
      { baseUrl, locale: currentLocale() },
      token ?? '',
      { currentPassword, newPassword },
    );
    if (!outcome.ok) {
      set({ status: failedFrom(outcome) });
      return undefined;
    }
    // 🔴 必须把**新会话**换上：`tokenVersion` 刚 bump，手上那枚旧令牌已经作废。
    // 少了这一步，症状是"改密成功后当前这个标签页立刻同步失败"。
    applyAuthSession(baseUrl, outcome.session);
    set({ status: { kind: 'password-changed', email: outcome.session.user.email } });
    return outcome.session;
  },

  reset: () => {
    set({ status: { kind: 'signed-out' } });
  },
}));

/**
 * 测试用：把 store 归零。
 *
 * 与其它 feature store 的 `__resetXxxForTests` 同名同形 ——
 * 跨测试残留的状态是"随机变红"的常见来源（见 AGENTS.md #25）。
 */
export function __resetAuthForTests(): void {
  useAuthStore.setState({ status: { kind: 'signed-out' } });
}
