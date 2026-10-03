/**
 * 公共事实（调休 / 补班）在 web 的接线（W4b）
 * ==========================================
 *
 * 判断**一行都不在这里**：匿名、失败不动缓存、坏形状不覆盖好数据、装进领域层的覆盖表，
 * 全在 `@heyta/app-host` 的 `public-facts.ts`（AGENTS §3.5）。本文件只回答两个 web 的事：
 *
 * 1. **什么时候做**：启动 + 回前台 + 刚点到「同意」之后。
 *    🔴 拉取必须**带外**做 —— 让 `adjustmentOn()` 变 async 是被明确否证的方案
 *    （`packages/domain/src/holidays.ts` 文件头），因为"不确定"在日历上就是空白块，
 *    而那正是判据①要防的东西。
 * 2. **做完了怎么让界面重算**：领域层那份覆盖表是模块级状态，React 不知道它变了。
 *    所以每次装上/更新都经 `onFactsChanged` 敲一下日历 store 的 `publicFactsEpoch` ——
 *    格子读到的仍然是同一个同步的 `adjustmentOn()`，变的是**重渲染的触发**。
 *
 * ⚠️ 同意闸门排在了拉取之前（`networkAllowed`）：这条请求虽然是匿名的，
 * 但它仍然是一次"这台应用会不会跟服务端说话"，G-12 那句"同意之前一个字节都不许出去"
 * 不区分带不带身份。闸门关着时**一个请求都不发**，而装缓存照做（纯本地）。
 */

import {
  installPublicFactsFromCache,
  refreshPublicFacts,
  type PublicFactsCachePort,
  type PublicFactsRefreshResult,
} from '@heyta/app-host';

import { requireStore } from '../../lib/oplog.js';
import { consentFetch, privacyConsent, subscribePrivacyConsent } from '../privacy/consent-gate.js';
import { useSyncStore } from '../sync/store.js';
import { useCalendarViewStore } from './store.js';

export type PublicFactsSyncOutcome =
  /** 闸门还没开：**不发请求**，但缓存照装（那一步纯本地）。 */
  | { readonly kind: 'blocked' }
  | PublicFactsRefreshResult;

export interface PublicFactsPorts {
  /** 服务端根地址（空串 = 未配置）。每次现取，不缓存 —— 用户可能在设置里换服务器。 */
  baseUrl: () => string;
  /** META 读写那对方法所在的 store（web 三条后端路径唯一都能到达 `STORES.META` 的口子）。 */
  cache: () => PublicFactsCachePort;
  /** 带同意闸门的 fetch。 */
  fetchImpl: () => typeof fetch;
  networkAllowed: () => boolean;
  /** 闸门变化（用户刚点了同意）。返回取消订阅。 */
  onNetworkAllowed: (listener: () => void) => () => void;
  /** 回到前台。返回取消订阅。 */
  onForeground: (listener: () => void) => () => void;
  /** 覆盖表变了，界面要重算。 */
  onFactsChanged: () => void;
  /** 失败留痕。这条通道的失败在产品上不是事件（判据①），但不能是**没人知道**的事件。 */
  log: (message: string) => void;
}

export interface PublicFactsWiring {
  /** 幂等：重复调用只会留一套订阅。 */
  start: () => void;
  stop: () => void;
  /** 走一次"装缓存 →（闸门开着才）拉取"。测试与手动重试用它。 */
  syncNow: () => Promise<PublicFactsSyncOutcome>;
}

export function createPublicFactsWiring(ports: PublicFactsPorts): PublicFactsWiring {
  let started = false;
  let unsubscribes: readonly (() => void)[] = [];

  const installQuietly = async (): Promise<void> => {
    try {
      const installed = await installPublicFactsFromCache(ports.cache());
      if (installed !== undefined) ports.onFactsChanged();
    } catch (error) {
      // 存储读不出来（配额 / 被回收）不该拖垮启动：退回随包表。
      ports.log(`public facts cache read failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const syncNow = async (): Promise<PublicFactsSyncOutcome> => {
    // 🔴 本地这一步**不受闸门管**：它一个字节都不出这个进程。
    await installQuietly();

    if (!ports.networkAllowed()) return { kind: 'blocked' };

    const result = await refreshPublicFacts({
      baseUrl: ports.baseUrl(),
      cache: ports.cache(),
      fetchImpl: ports.fetchImpl(),
      log: ports.log,
    });
    if (result.kind === 'ok') ports.onFactsChanged();
    return result;
  };

  /**
   * `syncNow()` 自己**不抛**（网络失败是一个 `kind`），但存储读写出错会 ——
   * 那些必须落到日志里，而不是变成一个 unhandled rejection：
   * "启动时没标记"和"这条链根本没跑"在界面上长得一模一样。
   */
  const syncNowAndReport = async (): Promise<void> => {
    try {
      await syncNow();
    } catch (error) {
      ports.log(`public facts sync crashed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return {
    start() {
      if (started) return;
      started = true;

      void syncNowAndReport();

      const onAllowed = (): void => {
        void syncNowAndReport();
      };
      unsubscribes = [
        ports.onNetworkAllowed(onAllowed),
        ports.onForeground(onAllowed),
      ];
    },

    stop() {
      for (const unsubscribe of unsubscribes) unsubscribe();
      unsubscribes = [];
      started = false;
    },

    syncNow,
  };
}

// ── 装配（真正的端口）───────────────────────────────────────────────

let wiring: PublicFactsWiring | undefined;

/**
 * 启动公共事实这条链（**幂等**）。入口在 `main.tsx`，排在 `initOpLog()` 之后 ——
 * `requireStore()` 在引擎就绪前会抛，而那是一条永远不会好起来的抛。
 */
export function startPublicFacts(): void {
  wiring ??= createPublicFactsWiring({
    baseUrl: () => useSyncStore.getState().baseUrl,
    cache: () => requireStore(),
    fetchImpl: () => consentFetch,
    networkAllowed: () => privacyConsent.networkAllowed(),
    onNetworkAllowed: (listener) => subscribePrivacyConsent(listener),
    onForeground: (listener) => {
      const onVisibility = (): void => {
        if (!document.hidden) listener();
      };
      document.addEventListener('visibilitychange', onVisibility);
      return () => document.removeEventListener('visibilitychange', onVisibility);
    },
    onFactsChanged: () => {
      useCalendarViewStore.getState().bumpPublicFactsEpoch();
    },
    log: (message) => {
      // 这条通道的失败**不进界面**（判据①），但必须进控制台 ——
      // "没标记"与"这条链根本没跑"在界面上长得一样，只有这里能分开它们。
      console.warn(`[public-facts] ${message}`);
    },
  });
  wiring.start();
}

/** 只为测试与热重载存在：拆掉订阅、丢掉单例。 */
export function stopPublicFacts(): void {
  wiring?.stop();
  wiring = undefined;
}
