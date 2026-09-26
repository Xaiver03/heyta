/**
 * 订阅权益状态 store
 * =====================
 *
 * 它只持有**一个很小的独立状态**：服务端对"官方托管同步"放不放行。
 * 与任务数据毫无关系 —— 既读不到任务，也不会写任务（E2EE 硬约束）。
 *
 * ## 职责边界（AGENTS.md §3.5）
 *
 * 这里**不做业务判断**：
 *   - "该不该降级"由 `@heyta/domain` 的 `decideHostedSyncAccess` 决定；
 *   - "该怎么措辞"由 `./copy` 与组件决定。
 * 本文件只负责"什么时候去问一次服务端"以及把结果放进 state。
 *
 * ## 什么时候去问
 *
 * 挂载时、以及服务器地址 / 令牌变化时。**未配置时连请求都不发**
 * （探测函数自己保证），所以自托管与"还没登账号"两种情况都不会产生流量，
 * 也不会出现任何提示。
 *
 * ## 🔴 fail-open 是默认值
 *
 * state 的初始值就是"不受限"。探测失败也只停留在"不受限"。
 * 换句话说：**这个 store 坏掉、探测服务端挂掉、断网，用户都不会被降级。**
 */

import { create } from 'zustand';

import {
  decideHostedSyncAccess,
  type HostedEntitlementReading,
  type HostedSyncAccess,
} from '@heyta/domain';
import { fetchHostedEntitlementReading } from '@heyta/app-host';

import { useSyncStore } from '../sync/store.js';

/** 默认"不受限"：在第一次探测回来之前，界面不许出现任何提示。 */
const UNKNOWN_ACCESS: HostedSyncAccess = {
  kind: 'unrestricted',
  because: 'entitlement-unknown',
};

export interface SubscriptionStoreState {
  /** 最近一次探到的权益观察（原始，便于排查）。 */
  reading: HostedEntitlementReading;
  /** 由观察推出的降级判定。 */
  access: HostedSyncAccess;
  /** 是否正在探测（只在探测期间为真；失败不会有任何 UI 后果）。 */
  checking: boolean;
  /**
   * 去服务端问一次。
   *
   * 🔴 **不抛异常。** 任何失败都停在"不受限"。
   * 返回判定结果，便于测试与调用方直接断言。
   */
  refresh: () => Promise<HostedSyncAccess>;
}

export const useSubscriptionStore = create<SubscriptionStoreState>((set) => ({
  reading: { kind: 'unconfigured' },
  access: UNKNOWN_ACCESS,
  checking: false,

  refresh: async () => {
    const { baseUrl, token } = useSyncStore.getState();
    set({ checking: true });

    const reading = await fetchHostedEntitlementReading({
      baseUrl,
      getToken: async () => token,
    });
    const access = decideHostedSyncAccess(reading, Date.now());

    set({ reading, access, checking: false });
    return access;
  },
}));

/**
 * 测试用：把 store 归零。
 *
 * 与其它 feature store 的 `__resetXxxForTests` 同名同形 ——
 * 跨测试残留的状态是"随机变红"的常见来源（见 AGENTS.md #25）。
 */
export function __resetSubscriptionForTests(): void {
  useSubscriptionStore.setState({
    reading: { kind: 'unconfigured' },
    access: UNKNOWN_ACCESS,
    checking: false,
  });
}
