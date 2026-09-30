/**
 * 自动同步：把纯调度接到平台上
 * ==============================
 *
 * 决策全部在 `auto-sync-core.ts`（纯逻辑、有单测）。这里只做三件事：
 *   1. 提供**真实**的时钟与定时器；
 *   2. 回答"现在允许同步吗"（已配置凭据 **且** 在前台）；
 *   3. 把 `syncNow()` 的结果翻译成"算不算结算"。
 *
 * ---
 *
 * 🔴 **为什么必须有这个文件**：移动端此前**只**在「我的」页那个按钮被按下时同步。
 * 也就是用户建完任务，它不会自己出去 —— 要让它到另一台设备，
 * 用户得自己想到"去我的页点一下同步"。这不是缺个功能，
 * 这是本地优先应用最核心的承诺没兑现，而且**不报错、界面也看不出异常**。
 *
 * ---
 *
 * ## 三个触发点，为什么是这三个
 *
 * | 触发 | 为什么 |
 * |---|---|
 * | **回到前台** | 手机上最自然的同步时机。用户切回来就是要看最新的；拉取也靠它。|
 * | **本地写入之后**（防抖） | 这才是"我记下来了，它就同步了"。写一条推一条。|
 * | **刚填完凭据** | 用户刚配置完，此刻不同步的话他要自己再点一次按钮。|
 *
 * ⚠️ **不在这里做"每 N 秒轮询"**：那会在后台白耗电，而 iOS 挂起时定时器本来就不准。
 * 前台 + 写入这两个触发点已经覆盖了"用户在看"的全部时间。
 */

import { AppState, type AppStateStatus } from 'react-native';

import {
  createAutoSyncScheduler,
  type AutoSyncScheduler,
  type TimerHandle,
} from './auto-sync-core';
import { readSyncConfig } from './config';
import { startRealtime, stopRealtime } from './realtime';
import { syncNow } from './store';
import { onLocalWrite } from './write-signal';

/** 应用是否在前台。**挂起期间不做任何同步。** */
let foreground = isForeground(AppState.currentState);

/**
 * `inactive` 也算"不在前台"。
 *
 * iOS 上它在"下拉通知中心 / 切到应用切换器"时出现，此时界面已经不可交互；
 * 拿它当"前台"会在这些瞬时状态里排同步，纯属浪费。
 * ⚠️ 初值可能是 `null`（RN 尚未拿到状态），那种情况按**前台**处理：
 * 判成后台会让启动后的第一次同步被吞掉，而用户明明正看着屏幕。
 */
function isForeground(state: AppStateStatus | null | undefined): boolean {
  return state !== 'background' && state !== 'inactive';
}

let scheduler: AutoSyncScheduler | undefined;
let subscription: { remove(): void } | undefined;
let unsubscribeWrites: (() => void) | undefined;

/**
 * 现在允许同步吗。
 *
 * 🔴 **没配好必须挡住。** 否则每次回到前台都会跑一次注定失败的同步，
 * 把「我的」页的状态刷成一条吓人的错误 —— 而用户只是还没填。
 * 这跟"离线是正常工作状态，不该标红"是同一条纪律。
 *
 * ⚠️ 判据是**地址 + 令牌都齐**（与「我的」页那个 `configured` 同一口径），
 * 而不是"配置对象存在"：用户在表单里是**一个字段一个字段**填的，
 * 只填了地址的那一刻 `readSyncConfig()` 就已经不是 `undefined` 了。
 * 拿它当"已配置"，回到前台就会报一次 `not-signed-in`。
 */
function ready(): boolean {
  if (!foreground) return false;
  const config = readSyncConfig();
  if (config === undefined) return false;
  return config.serverUrl !== '' && (config.token ?? '') !== '';
}

/**
 * `SyncStatus` → "算不算结算"。
 *
 * 🔴 **"结算"不等于"成功"。** 这里返回 `true` 表示**不要自动重试**：
 *
 *   · `synced`   —— 成功；
 *   · `conflict` —— 两边的改动都合法，要**人去选**。自动重试既解决不了，
 *                   还会把冲突刷屏；
 *   · 不可重试的 `error`（没令牌 / 没加密口令）—— 重试一万次也一样，
 *                   真正的出路是让用户去「我的」补齐。
 *
 * 只有 `offline` 和**可重试**的错才返回 `false`（保留 dirty，等下次触发）。
 */
function settledFrom(status: Awaited<ReturnType<typeof syncNow>>): boolean {
  switch (status.kind) {
    case 'synced':
    case 'conflict':
      return true;
    case 'error':
      return !status.retryable;
    default:
      // `offline` / `idle` / `syncing`：没结算，等下次触发。
      return false;
  }
}

/**
 * 启动自动同步。**幂等** —— 重复调用只会拿到同一个实例（React 严格模式下
 * `useEffect` 会跑两次，不做幂等就会挂两个 AppState 监听 + 两套定时器，
 * 表现为同步请求翻倍）。
 *
 * 返回停止函数（给 `useEffect` 的清理用）。
 */
export function startAutoSync(): () => void {
  if (scheduler !== undefined) {
    return () => {
      /* 已经启动过：停止由拥有者负责，这里不重复注册。 */
    };
  }

  scheduler = createAutoSyncScheduler({
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms) as TimerHandle,
    clearTimer: (handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
    ready,
    sync: async () => {
      const status = await syncNow();
      return settledFrom(status);
    },
    onError: (error) => {
      // `syncNow()` 自己已经把意外异常表达成 `SyncStatus.error` 了，
      // 能走到这里的是更外层的意外。**如实打出来**，不吞。
      console.warn('[heyta] 自动同步意外失败', error);
    },
  });

  // 写入信号走 `write-signal`（零依赖那一层），**不**让数据库层直接引到这里 ——
  // 否则就是 `open-host → auto-sync → store → open-host` 的循环依赖。
  unsubscribeWrites = onLocalWrite(() => {
    scheduler?.notifyLocalWrite();
  });

  subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
    const next = isForeground(state);
    const cameBack = next && !foreground;
    foreground = next;
    // 只在**回到**前台时同步。"去后台"和"inactive"期间什么都不做。
    if (cameBack) scheduler?.notifyForeground();
  });

  return function stopAutoSync(): void {
    // 🔴 实时通道与自动同步**同一个生命周期**：只停调度器而留着那条连接，
    // 会让"应用已经不再自动同步了，却还在后台维持一条 WebSocket"。
    stopRealtime();
    subscription?.remove();
    subscription = undefined;
    unsubscribeWrites?.();
    unsubscribeWrites = undefined;
    scheduler?.dispose();
    scheduler = undefined;
    foreground = isForeground(AppState.currentState);
  };
}

/**
 * 用户刚保存了同步凭据 —— 立刻同步一次。
 *
 * ⚠️ **本地写入不走这里**：那条路是 `write-signal` 的 `emitLocalWrite()`，
 * 由宿主挂在 `dispatch` 上自动触发。留两个入口迟早漂移
 * （一处改了另一处没改，而表现是"某些改动不同步"）。
 */
export function notifyConfigured(): void {
  scheduler?.notifyConfigured();
  /**
   * 🔴 **实时通道在这里起**（不在 `startAutoSync` 里）。
   *
   * 原因是一条取舍的后果：移动端的同步凭据**刻意不落盘**
   *（E2EE 口令落盘就等于把"服务端看不到明文"作废，见 `sync/config.ts`）。
   * ⇒ 冷启动时 `readSyncConfig()` 必然是 `undefined`，
   * 在 `startAutoSync` 里起连**永远建不起来**，而且失败是静默的。
   * 这里才是凭据第一次真的存在的那一刻。
   *
   * ⚠️ 不 `await`：起不来只是"暂时靠前台/写入触发同步"，不是功能坏掉；
   * 而 `notifyConfigured` 的调用点在保存凭据那条路上，不该被一次连接拖住。
   */
  void startRealtime();
}
