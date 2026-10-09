/**
 * 换绑登录邮箱 store（Web 壳）
 * ===========================
 *
 * 这条流程的**裁决全在别处**，本文件只做"什么时候调一次、结果放在哪儿"：
 *
 *   | 判什么 | 住在哪 |
 *   |---|---|
 *   | 路径 / 方法 / 令牌怎么带 / 失败归类 | `@heyta/app-host` 的 `account-security.ts` |
 *   | "还等哪一边点" | **服务端**，经 `getEmailChangeStatus` 读回来 |
 *   | 冷却窗口、令牌有效期、两边点齐才生效 | `@heyta/shared-schema` 的 `email-change-contract.ts` + 服务端 |
 *   | 用户看到的句子 | `@heyta/i18n`（`common.emailChange.*`） |
 *
 * ## 🔴 这里刻意**不记**"我刚才点了哪一边"
 *
 * 界面上那句"还在等新邮箱点一次"**只**能来自 `getEmailChangeStatus` 的
 * `awaitingOld` / `awaitingNew`。本地记一份的症状：刷新一次标记就丢了，
 * 而界面会继续说一句它已经不知道的话 —— 换绑这件事**用户点两下可能跨两台设备、
 * 隔几个小时**（旧邮箱和新邮箱的收件人甚至是两个人），本地态在这个流程里
 * 结构上不可能正确。`emailChangeStage()` 是共享层给的纯函数，四个壳共用同一份判断。
 *
 * ## 🔴 发起 / 取消之后一律**重读服务端**，不做本地乐观更新
 *
 * 与 `passkeysStore.ts` 同一条纪律：把 `state` 就地改成"我以为的样子"，
 * 会在"这张请求其实已经被别的设备取消了 / 已经点齐生效了"时显示出一个
 * 服务端并不存在的世界，而用户下一步就基于那个错的世界点按钮。
 *
 * ## 这里**没有** confirm
 *
 * 点那两封信的人手上没有会话（他可能在另一台电脑上），所以那一侧的出口是
 * **服务端渲染的 `/change-email?token=`**。客户端不许再开一条 confirm 通路
 * —— 见 `account-security.ts` 文件头。
 */

import { create } from 'zustand';

import {
  cancelEmailChange,
  getEmailChangeStatus,
  requestEmailChange,
  type HostedAuthFailureReason,
  type HostedAuthLocale,
} from '@heyta/app-host';
import type { EmailChangeStatusResponse } from '@heyta/shared-schema';

/**
 * 那张活请求的读侧状态。
 *
 * 🔴 `loaded` 与 `failed` 是**两个世界**：前者才有权说"没有待办的换绑"，
 * 后者不行 —— 把"读不到"画成"没有进行中的换绑"，用户会以为上次那两封信
 * 白发了，于是再发起一次，而服务端那边那张请求还活着。
 */
export type EmailChangeState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; status: EmailChangeStatusResponse }
  | { kind: 'failed'; reason: HostedAuthFailureReason };

/** 发起失败。`retryAfterSeconds` 只有冷却那一条会带。 */
export interface EmailChangeRequestFailure {
  reason: HostedAuthFailureReason;
  retryAfterSeconds?: number;
}

export interface EmailChangeStoreState {
  state: EmailChangeState;
  requesting: boolean;
  cancelling: boolean;
  requestFailure?: EmailChangeRequestFailure;
  cancelFailure?: HostedAuthFailureReason;
  /** 刚发起成功（两封信在路上）。 */
  justSent: boolean;
  /** 刚取消成功。 */
  justCancelled: boolean;

  load: (baseUrl: string, token: string | undefined) => Promise<void>;
  request: (
    baseUrl: string,
    token: string | undefined,
    newEmail: string,
    locale?: HostedAuthLocale,
  ) => Promise<void>;
  cancel: (baseUrl: string, token: string | undefined) => Promise<void>;
  dismissNotices: () => void;
  reset: () => void;
}

export const useEmailChangeStore = create<EmailChangeStoreState>((set, get) => ({
  state: { kind: 'idle' },
  requesting: false,
  cancelling: false,
  justSent: false,
  justCancelled: false,

  load: async (baseUrl, token) => {
    set({ state: { kind: 'loading' } });
    const outcome = await getEmailChangeStatus({ baseUrl }, token ?? '');
    set({
      state: outcome.ok ? { kind: 'loaded', status: outcome } : { kind: 'failed', reason: outcome.reason },
    });
  },

  request: async (baseUrl, token, newEmail, locale) => {
    // 🔴 in-flight guard，不是 `disabled`（与 `PasswordPanel` 同一条 ADR-0040 §3.7 的取舍）。
    if (get().requesting) return;
    set({ requesting: true, requestFailure: undefined, justSent: false, justCancelled: false });
    const outcome = await requestEmailChange({ baseUrl, ...(locale === undefined ? {} : { locale }) }, token ?? '', newEmail);

    if (!outcome.ok) {
      set({
        requesting: false,
        requestFailure: {
          reason: outcome.reason,
          ...(outcome.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: outcome.retryAfterSeconds }),
        },
      });
      // 冷却意味着"那张请求本来就还在"，于是"还等哪一边"这句话**只有服务端能答**。
      // 重读一次，界面就不必靠这次失败的响应去猜活请求的剩余时限。
      if (outcome.reason === 'email-change-cooldown') {
        await get().load(baseUrl, token);
      }
      return;
    }

    set({ requesting: false, justSent: true });
    await get().load(baseUrl, token);
  },

  cancel: async (baseUrl, token) => {
    if (get().cancelling) return;
    set({ cancelling: true, cancelFailure: undefined, justCancelled: false });
    const outcome = await cancelEmailChange({ baseUrl }, token ?? '');

    if (!outcome.ok) {
      set({ cancelling: false, cancelFailure: outcome.reason });
      return;
    }

    set({ cancelling: false, justCancelled: true });
    await get().load(baseUrl, token);
  },

  dismissNotices: () => {
    set({
      requestFailure: undefined,
      cancelFailure: undefined,
      justSent: false,
      justCancelled: false,
    });
  },

  reset: () => {
    set({
      state: { kind: 'idle' },
      requesting: false,
      cancelling: false,
      requestFailure: undefined,
      cancelFailure: undefined,
      justSent: false,
      justCancelled: false,
    });
  },
}));

/**
 * 测试用：把 store 归零（跨测试残留是"随机变红"的常见来源）。
 * 与其它 feature store 的 `__resetXxxForTests` 同名同形。
 */
export function __resetEmailChangeForTests(): void {
  useEmailChangeStore.setState({
    state: { kind: 'idle' },
    requesting: false,
    cancelling: false,
    requestFailure: undefined,
    cancelFailure: undefined,
    justSent: false,
    justCancelled: false,
  });
}
