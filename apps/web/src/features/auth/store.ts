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
  completePasskeyLogin,
  completePasskeyRegistration,
  extractAuthLinkToken,
  registerWithMagicLink,
  requestMagicLink,
  requestPasskeyRecovery,
  verifyMagicLink,
  type HostedAuthFailureReason,
  type HostedAuthSession,
} from '@heyta/app-host';

import { useSyncStore } from '../sync/store.js';
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
  | 'recovery';

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
  | { kind: 'signed-in'; email: string }
  | { kind: 'failed'; reason: HostedAuthFailureReason };

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
}

export const useAuthStore = create<AuthStoreState>((set) => ({
  status: { kind: 'signed-out' },

  sendLoginLink: async (baseUrl, email) => {
    set({ status: { kind: 'busy', action: 'login-link' } });
    const outcome = await requestMagicLink({ baseUrl }, email);
    set({ status: outcome.ok ? { kind: 'link-sent' } : { kind: 'failed', reason: outcome.reason } });
  },

  registerAccount: async (baseUrl, email, termsAccepted, inviteCode) => {
    set({ status: { kind: 'busy', action: 'register' } });
    const outcome = await registerWithMagicLink(
      { baseUrl },
      {
        email,
        ...(termsAccepted ? { termsAccepted: true } : {}),
        ...(inviteCode === undefined || inviteCode === '' ? {} : { inviteCode }),
      },
    );
    set({
      status: outcome.ok ? { kind: 'registered' } : { kind: 'failed', reason: outcome.reason },
    });
  },

  verify: async (baseUrl, input) => {
    // 从"邮件里的链接"或"裸令牌"里取令牌是**协议知识**，在 app-host 里。
    const token = extractAuthLinkToken(input);
    if (token === undefined) {
      set({ status: { kind: 'failed', reason: 'invalid-input' } });
      return undefined;
    }

    set({ status: { kind: 'busy', action: 'verify' } });
    const outcome = await verifyMagicLink({ baseUrl }, token);
    if (!outcome.ok) {
      set({ status: { kind: 'failed', reason: outcome.reason } });
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
      set({ status: { kind: 'failed', reason: 'passkey-unsupported' } });
      return;
    }

    set({ status: { kind: 'busy', action: 'passkey-register' } });

    // ① 取 options（协议在 app-host）
    const begun = await beginPasskeyRegistration(
      { baseUrl },
      {
        email,
        ...(termsAccepted ? { termsAccepted: true } : {}),
        ...(inviteCode === undefined || inviteCode === '' ? {} : { inviteCode }),
      },
    );
    if (!begun.ok) {
      set({ status: { kind: 'failed', reason: begun.reason } });
      return;
    }

    // ② 平台那一步（**这一段是本次补上的**）。用户在系统弹窗上操作，
    //    所以这里可能停住很久 —— 状态已经是 busy，界面会如实显示"等待系统弹窗…"。
    const created = await createPasskeyCredential(begun.options, resolved);
    if (!created.ok) {
      set({ status: { kind: 'failed', reason: created.reason } });
      return;
    }

    // ③ 交回服务端回验
    const completed = await completePasskeyRegistration(
      { baseUrl },
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
        : { kind: 'failed', reason: completed.reason },
    });
  },

  loginWithPasskey: async (baseUrl, email, browser) => {
    // 同上：不支持的设备一个请求都不发。
    const resolved = browser ?? detectPasskeyBrowser();
    if (resolved === undefined || !resolved.supported) {
      set({ status: { kind: 'failed', reason: 'passkey-unsupported' } });
      return undefined;
    }

    set({ status: { kind: 'busy', action: 'passkey-login' } });

    const begun = await beginPasskeyLogin({ baseUrl }, email);
    if (!begun.ok) {
      set({ status: { kind: 'failed', reason: begun.reason } });
      return undefined;
    }

    const assertion = await getPasskeyCredential(begun.options, resolved);
    if (!assertion.ok) {
      set({ status: { kind: 'failed', reason: assertion.reason } });
      return undefined;
    }

    const completed = await completePasskeyLogin(
      { baseUrl },
      { email, credential: assertion.credential },
    );
    if (!completed.ok) {
      set({ status: { kind: 'failed', reason: completed.reason } });
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
    const outcome = await requestPasskeyRecovery({ baseUrl }, email);
    set({
      status: outcome.ok ? { kind: 'recovery-sent' } : { kind: 'failed', reason: outcome.reason },
    });
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
