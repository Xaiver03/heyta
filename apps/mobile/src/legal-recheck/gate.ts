/**
 * 移动端的账号级补签闸门装配（G-27）
 * ================================
 *
 * 判定逻辑**一行都不在这里**（AGENTS.md §3.5）：那是
 * `packages/app-host/src/legal-recheck.ts` 的 `createLegalRecheckGate`。
 * 本文件只做宿主注入的两件事：**凭据从哪来**、**走哪条 fetch**，
 * 外加一条"登出 ⇒ 忘掉上一个人的答案"的接线。
 *
 * ## 🔴 为什么凭据是**活取值器**而不是快照
 *
 * `getToken: () => readSyncConfig()?.token` 里那个箭头函数**每次被调都要重新读**。
 * 写成快照的话，症状是"换了账号还在按上一个人的版本判" —— 一个看不见也点不着的状态。
 * 移动端的凭据本来就是一个字符一个字符写进活配置的（`credential-form.ts`），
 * 所以这里更没有快照的余地。
 *
 * web 那一份用的是 `bindLegalRecheckCredentials()` 把值**交进来**（令牌归它的
 * zustand store 所有），移动端反过来**去读** `sync/config.ts`（令牌归那里所有）。
 * 两个方向都是单向依赖，都不会长出模块循环。
 *
 * ## 为什么 `fetchImpl` 是带链 5 闸门的 `consentFetch`
 *
 * "这个账号要不要补签"这一问**本身也是一次出站请求**。设备级同意（G-12）还没作出时
 * 它不该发出去 —— 那条闸的射程是"任何出站"，没有理由放过一条元问题。
 * 🔴 但**反向不成立**：账号级闸门**不**包 `globalThis.fetch`。那样"发确认"这条 POST
 * 会被自己拦住，用户点完按钮永远得到一次失败。这正是两道闸必须分层的原因。
 *
 * ## 为什么"问"不在冷启动，而在 `notifyConfigured()`
 *
 * 移动端的同步凭据**刻意不落盘**（`sync/config.ts` 文件头：E2EE 口令落盘等于把
 * "服务端看不到明文"作废）⇒ 冷启动时 `readSyncConfig()` 必然是 `undefined`，
 * 那时问一句只会得到 `anonymous`，白问一次。
 * 凭据第一次真的存在的那一刻是 `notifyConfigured()`，而那一步**必须排在
 * `startRealtime()` 之前** —— 与 web `privacy/startup-network.ts` 第 4 端口同一条顺序：
 * 闸门在拿到答案前是 `checking`，而 `checking` 是拦的；反过来写就成了
 * "先把数据推出去、再收到要补签"，那道闸只剩事后弹个窗。
 */

import { createLegalRecheckGate, type LegalRecheckGate } from '@heyta/app-host';

import { consentFetch } from '../privacy/consent-gate';
import { onCredentialsCleared, readSyncConfig } from '../sync/config';

/** 本进程的**唯一**闸门实例（同 `privacyConsent` 那条纪律：散成两份就会给出不同答案）。 */
export const legalRecheck: LegalRecheckGate = createLegalRecheckGate({
  getToken: () => readSyncConfig()?.token,
  getBaseUrl: () => readSyncConfig()?.serverUrl ?? '',
  fetchImpl: consentFetch,
});

/**
 * 问一次"这个账号要不要重新确认条款"。**只问，不判**。
 *
 * ⚠️ 不 `await`：调用点（保存凭据那条路）不该被一次网络往返拖住，
 * 而答案回来时由订阅者（`sync/auto-sync.ts`）按新状态重建实时通道。
 */
export function askLegalRecheck(): void {
  void legalRecheck.refresh();
}

/**
 * 🔴 登出当场把上一个人的答案清掉。
 *
 * 判据用 `dataEgressAllowed()` 的地方都不会出问题（`anonymous` 是放行的），
 * 坏在**界面**：面板会留着按旧账号那一版展示文本，而那个版本此刻与他无关。
 * 订阅的是 `sync/config.ts` 那个**零依赖**的信号 —— 反过来让 config 引本模块
 * 就是循环（gate 要读 `readSyncConfig()`）。
 */
onCredentialsCleared(() => {
  legalRecheck.reset();
});
