/**
 * 移动端的隐私同意装配（与 web 的 `features/privacy/consent-gate.ts` 同形）
 * ========================================================================
 *
 * 判定与持久化格式全在 `@heyta/app-host` 的 `privacy-consent.ts`
 * （AGENTS.md §3.5："同意之后才准出门"是产品语义，不是外壳的事）。
 * 本文件只做宿主注入的那部分，而且刻意只做三件事：
 *
 *   1. 给一个 **op-sqlite 设备偏好** 后端的 {@link PrivacyConsentPort}；
 *   2. 建**唯一一个**闸门实例，并把 `fetch` 包一层交出去；
 *   3. 装一道**进程级**的出口闸（替换 `globalThis.fetch`）。
 *
 * ## 🔴 为什么移动端也要进程级那道闸
 *
 * 移动端的显式闸门（`auto-sync` 的 `ready()`、`syncNow()`、`startRealtime()`）
 * 覆盖的是"已经想到的那三处"。但 `AuthScreen` 的注册/登录、`hosted-auth` 的
 * 每一次调用都是**直接吃 `globalThis.fetch`**（它们没传 `fetchImpl`）——
 * 也就是说"新加一个调用点忘了判同意"在移动端同样等于"合规前提悄悄失效"。
 * 这一层换掉全局 fetch，让忘了判也发不出去。
 *
 * ⚠️ **它拦不住 `WebSocket`**：RN 的实时通道走 `globalThis.WebSocket`，
 * 那一头由 `sync/realtime.ts` 的 `networkAllowed` 负责（全仓唯一构造点）。
 *
 * ## 为什么端口"永不抛"
 *
 * 调用点在**应用启动的第一帧**上（首启要不要弹面板）。在那里抛异常 = 应用起不来，
 * 而它本来只该影响"这次同意有没有被记住"。`prefs/device-prefs.ts` 已经守这条纪律，
 * 这里只是不给它加例外。
 */

import {
  createConsentGatedFetch,
  createPrivacyConsentGate,
  type PrivacyConsentPort,
} from '@heyta/app-host';

import { deleteDevicePref, readDevicePref, writeDevicePref } from '../prefs/device-prefs';

/**
 * 设备偏好后端。
 *
 * ⚠️ 每次调用**都重新走一遍** `readDevicePref` 而不缓存结果：那条路自己会
 * 懒开数据库并缓存"开不开得了"，闸门这里再缓存一份就会出现
 * "数据库在会话中途恢复/换掉，闸门还在用旧答案"的分裂。
 */
export const devicePrefsPrivacyConsentPort: PrivacyConsentPort = {
  read: (key) => readDevicePref(key),
  // `writeDevicePref` 返回的是"真的写进去了"（它自己会 catch），
  // 所以 `false` 只有一种含义：**这台设备记不住这个决定** —— 界面必须说出口。
  write: (key, value) => writeDevicePref(key, value),
  remove: (key) => deleteDevicePref(key),
};

/**
 * 本进程的**唯一**闸门实例。
 *
 * ⚠️ 只许有这一个：同意状态散成两份，就会出现"这个面板放行了、那个调用点拦住了"
 * 这种在最外层看不出来的分裂。
 */
export const privacyConsent = createPrivacyConsentGate(devicePrefsPrivacyConsentPort);

/**
 * 包了闸门的 `fetch`：**没有同意，一个字节都不出这台设备**。
 *
 * 与 `consentFetch` 同时存在的还有三处显式闸门（`auto-sync` / `syncNow` /
 * `startRealtime`）—— 那三处是为了**判据数得出**，这一处是为了**漏网也出不去**。
 */
export const consentFetch: typeof fetch = createConsentGatedFetch(
  globalThis.fetch.bind(globalThis),
  () => privacyConsent.networkAllowed(),
);

type ConsentListener = () => void;
const listeners = new Set<ConsentListener>();

function notify(): void {
  // 🔴 一个订阅者的异常不许影响其余的：这条通知同时驱动自动同步与实时通道，
  // 让"重建 WS 时抛了"变成"同意按钮点了没反应"是错的优先级。
  for (const listener of listeners) {
    try {
      listener();
    } catch (error: unknown) {
      console.warn('[privacy] 决定变更的订阅者抛错（不影响同意本身）：', error);
    }
  }
}

/**
 * 订阅同意状态的变化。返回取消订阅。
 *
 * 为什么是订阅而不是让面板直接去 `notifyConfigured()`：决定有**三个**来源
 * （首启面板、设置页撤回、注册成功后的顺带放行），而"要不要建实时通道"
 * 只有**一个**所有者。让每个来源都记得踢一次，就是"新加一个入口忘了踢"的开始。
 */
export function subscribePrivacyConsent(listener: ConsentListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 记下一次决定并通知订阅者。**界面只许走这三个方法**，
 * 直接调 `privacyConsent.decide()` 会让自动同步停在旧状态上。
 */
export const privacyConsentActions = {
  accept(): { persisted: boolean } {
    const readout = privacyConsent.decide('accepted');
    notify();
    return readout;
  },
  /** 不同意：只用本机。核心功能全部保留（PIPL 第 16 条的结构理由）。 */
  localOnly(): { persisted: boolean } {
    const readout = privacyConsent.decide('local-only');
    notify();
    return readout;
  },
  /** 撤回同意（PIPL 第 15 条要的那个"便捷的方式"）：清回"没问过"。 */
  revoke(): { persisted: boolean } {
    const readout = privacyConsent.revoke();
    notify();
    return readout;
  },
};

let installed = false;

/**
 * 把 `globalThis.fetch` 换成 {@link consentFetch}（**幂等**）。
 *
 * 🔴 必须在**任何一次请求之前**装上，实测落点是 `App.tsx` 的模块顶层
 * （`startPrivacyGate()`，见 `privacy/startup.ts` 那段理由）：ES module 的 import
 * 先于它执行，所以任何在**模块求值期**就发请求的代码都不在射程里 ——
 * 而移动端在模块求值期发请求的代码**今天不存在**，这条判据（源码级）钉的就是它别出现。
 *
 * ⚠️ 可以安全地换掉全局：{@link consentFetch} 包的正是原来那个 fetch
 * （`globalThis.fetch.bind(globalThis)` 在替换**之前**已经取好），不产生递归。
 */
export function installConsentGatedFetch(): void {
  if (installed) return;
  if (typeof globalThis.fetch !== 'function') return; // 非 RN/node 宿主
  globalThis.fetch = consentFetch;
  installed = true;
}

/** 仅供测试：把全局 `fetch` 换回去并清掉订阅者。 */
export function __resetConsentInstallForTests(): void {
  installed = false;
  listeners.clear();
}
