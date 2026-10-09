/**
 * 登录会话 store（Web 壳）—— 只管"列出会话 / 撤销其中一台"
 * =====================================================
 *
 * "退出这台设备"和"退出所有设备"**不在这里**，在 `./signOutStore.js` ——
 * 那两个动作都要**同时**管服务端撤销与本机凭据，而凭据清理在四个入口里必须
 * 是同一件事（头像菜单、这一面板、以后移动的同一面板）。两份实现 = 两套
 * "到底退出了没有"的裁决，正是 AGENTS §3.5 记过两次的形状。
 *
 * ## 分层（AGENTS.md §3.5）
 *
 *   | 判什么 | 住在哪 |
 *   |---|---|
 *   | 路径 / 方法 / Bearer / `sessionId` 形状 / 失败归类 | `@heyta/app-host` 的 `account-security.ts` |
 *   | "哪一行是手上这一枚" | **服务端**（它比对自己验出来的 `jti`），界面上就是 `current` |
 *   | 一句话 | `@heyta/i18n` 的 `common.sessions.*` |
 *
 * 本文件只负责"什么时候调用一次"以及把结果放进 state。
 *
 * ## 🔴 三条纪律
 *
 *   1. **读侧失败不许画成空列表。** 一次 500 看起来像"没有别的设备登录着"，
 *      而那是这一面板里最贵的一句假话 —— 用户会以为共享电脑上的那次登录已经结束了。
 *   2. **撤完以服务端为准重拉**，不做本地 `filter`（与 `passkeysStore.ts` 同一条）。
 *   3. 🔴 **`unknown-session` 不重试、也不说"已退出"。** app-host 的契约是
 *      "不存在 / 不是你的 / 已经撤过"三者同一个码，处置都是**刷新这个列表**。
 *      把它报成一次失败是假话（那枚会话本来就不活着）；把它报成"已经退出那一台"
 *      也是假话（我们什么都没撤销）。所以这里只刷新，不说话。
 */

import { create } from 'zustand';

import {
  listHostedSessions,
  revokeHostedSession,
  type HostedAuthFailureReason,
} from '@heyta/app-host';
import type { SessionSummary } from '@heyta/shared-schema';

/**
 * 列表的读侧状态。`loaded` 与 `failed` 是两个世界 —— 见文件头第 1 条。
 */
export type SessionsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; sessions: SessionSummary[] }
  | { kind: 'failed'; reason: HostedAuthFailureReason };

export interface SessionsStoreState {
  state: SessionsState;
  /** 正在撤销的那一行（用来禁用**那一行**，不是整张表）。 */
  revokingId?: string;
  revokeFailure?: HostedAuthFailureReason;
  /** 刚撤销成功。 */
  justRevoked: boolean;

  load: (baseUrl: string, token: string | undefined) => Promise<void>;
  revoke: (baseUrl: string, token: string | undefined, sessionId: string) => Promise<void>;
  dismissNotices: () => void;
  reset: () => void;
}

export const useSessionsStore = create<SessionsStoreState>((set, get) => ({
  state: { kind: 'idle' },
  justRevoked: false,

  load: async (baseUrl, token) => {
    set({ state: { kind: 'loading' } });
    const outcome = await listHostedSessions({ baseUrl }, token ?? '');
    set({
      state: outcome.ok
        ? { kind: 'loaded', sessions: outcome.sessions }
        : { kind: 'failed', reason: outcome.reason },
    });
  },

  revoke: async (baseUrl, token, sessionId) => {
    if (get().revokingId !== undefined) return;
    set({ revokingId: sessionId, revokeFailure: undefined, justRevoked: false });
    const outcome = await revokeHostedSession({ baseUrl }, token ?? '', sessionId);

    if (!outcome.ok) {
      set({ revokingId: undefined, revokeFailure: outcome.reason });
      // 文件头第 3 条：这一句**不**留下失败提示，只把列表拉回真相。
      if (outcome.reason === 'unknown-session') {
        set({ revokeFailure: undefined });
        await get().load(baseUrl, token);
      }
      return;
    }

    set({ revokingId: undefined, justRevoked: true });
    await get().load(baseUrl, token);
  },

  dismissNotices: () => {
    set({ revokeFailure: undefined, justRevoked: false });
  },

  reset: () => {
    set({
      state: { kind: 'idle' },
      revokingId: undefined,
      revokeFailure: undefined,
      justRevoked: false,
    });
  },
}));

/**
 * 测试用：把 store 归零（与其它 feature store 的 `__resetXxxForTests` 同名同形）。
 */
export function __resetSessionsForTests(): void {
  useSessionsStore.setState({
    state: { kind: 'idle' },
    revokingId: undefined,
    revokeFailure: undefined,
    justRevoked: false,
  });
}
