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
  extractAuthLinkToken,
  registerWithMagicLink,
  requestMagicLink,
  verifyMagicLink,
  type HostedAuthFailureReason,
  type HostedAuthSession,
} from '@heyta/app-host';

import { useSyncStore } from '../sync/store.js';

/** 正在进行的动作。用来禁用按钮并把状态如实说出来（"正在发送…"）。 */
export type AuthBusyAction = 'login-link' | 'register' | 'verify';

export type AuthStatus =
  /** 还没有凭据 —— 界面必须给出**明确的空状态**，而不是假装成功。 */
  | { kind: 'signed-out' }
  | { kind: 'busy'; action: AuthBusyAction }
  /** 登录链接已发出（服务端用中性文案防邮箱枚举，所以这里也不许断言"邮箱存在"）。 */
  | { kind: 'link-sent' }
  /** 注册申请已提交，还需要去邮箱点验证链接。**这不是"已登录"。** */
  | { kind: 'registered' }
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
  ) => Promise<void>;
  /**
   * 用邮件里的链接或令牌完成登录。
   *
   * 成功时**已经把令牌写进同步配置**，并把会话返回给调用方
   * （壳要拿它把设置对话框里的输入框也同步上，否则用户一点"保存并同步"
   * 就会用空的输入框把刚拿到的令牌覆盖掉）。
   */
  verify: (baseUrl: string, input: string) => Promise<HostedAuthSession | undefined>;
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
  useSyncStore.getState().applyAuthToken(baseUrl, session.token);
}

export const useAuthStore = create<AuthStoreState>((set) => ({
  status: { kind: 'signed-out' },

  sendLoginLink: async (baseUrl, email) => {
    set({ status: { kind: 'busy', action: 'login-link' } });
    const outcome = await requestMagicLink({ baseUrl }, email);
    set({ status: outcome.ok ? { kind: 'link-sent' } : { kind: 'failed', reason: outcome.reason } });
  },

  registerAccount: async (baseUrl, email, termsAccepted) => {
    set({ status: { kind: 'busy', action: 'register' } });
    const outcome = await registerWithMagicLink(
      { baseUrl },
      termsAccepted ? { email, termsAccepted: true } : { email },
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
