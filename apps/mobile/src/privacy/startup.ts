/**
 * 隐私同意的**启动接线**（移动端外壳）
 * ===================================
 *
 * `startPrivacyGate()` 把两件事一次做完，两件事必须一起成立：
 *
 * 1. `installConsentGatedFetch()` —— 把进程级 `fetch` 换成闸门后的那个。
 *    这一层覆盖的是**没有** `fetchImpl` 注入缝的调用点：`AuthScreen` 的五个动作、
 *    `hosted-auth` 的那些直接吃 `globalThis.fetch` 的路径，以及以后新写的那一类代码。
 *    🔴 不装这一层，未同意时它们会**照常发出去**，而界面上写着
 *    "还没有同意隐私规则，heyta 不会向任何服务器发出请求" —— 那是假话。
 *    ⚠️ 它**不是**同步那条路的唯一保障：`SyncClient` 在**构造函数**里就把 fetch
 *    取走了（`packages/sync-client/src/client.ts:670`），所以换全局只是**顺序**的
 *    兜底；`db/open-host.ts` 另外**显式**注入 `consentFetch`，让这条路不依赖顺序。
 * 2. 首启询问（G-11）—— 这台设备从没问过时把面板弹起来。
 *
 * ## 为什么做成一个函数、在 `App.tsx` 模块顶层调一次
 *
 * · **不是 effect**：严格模式下 effect 跑两次，第二次会把已经关掉的面板
 *   再打开一次（用户看到的是"我点了以后它又回来了"）。
 * · **不是 `useState` 初值**：初值不该有副作用 —— 它决定渲染结果，
 *   而这里的副作用改的是渲染**之外**的状态。
 * · 顶层调用发生在 `App` 首次渲染之前，也就是在任何一次同步触发之前。
 *
 * ## ⚠️ 与欢迎页的关系
 *
 * 首启时两块面板会重叠出现，而隐私面板在上面。这是**对的顺序**：
 * 欢迎页那个「注册 / 登录」按钮一按就会发请求，
 * 所以"这台设备能不能对外说话"必须先问。两件问的不是同一个决定
 * （一个是联网许可，一个是要不要登录），所以**不合并成一块面板** ——
 * 合并会让"只用本机"读成"不登录"。
 */

import { openPrivacySheet } from './consent-ui';
import { installConsentGatedFetch, privacyConsent } from './consent-gate';

/**
 * 装好闸门，并在**从没问过**的时候弹出首启面板。
 *
 * 🔴 判据是 `undecided()`，不是"还没同意"：明确选过「只用本机」的人
 * 不该每次冷启动被问一遍 —— 那会把"我们尊重你的决定"变成"我们其实不在乎"
 * （PIPL 第 16 条那一面）。
 */
export function startPrivacyGate(): void {
  installConsentGatedFetch();
  if (privacyConsent.undecided()) openPrivacySheet('first-launch');
}
