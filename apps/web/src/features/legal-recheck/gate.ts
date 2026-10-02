/**
 * Web 宿主的账号级补签闸门装配（G-27）
 * ===================================
 *
 * 判定逻辑全在 `@heyta/app-host` 的 `legal-recheck.ts`（AGENTS.md §3.5：
 * "不补签就不许数据出门"是产品语义，不是外壳的事）。本文件只做宿主注入的那部分：
 * **凭据从哪来** 与 **走哪条 fetch**。
 *
 * ## 🔴 为什么这里要一个 `bind`，而不是直接 import 同步 store
 *
 * 闸门要读当前令牌与服务端地址，而那两个值归 `features/sync/store.ts` 所有；
 * 反过来，同步 store 的两道出站闸又要读这道闸。直接互相 import 就是模块循环，
 * 而循环的坏不在"跑不起来"，在**谁先被求值** —— 打包顺序一变，一边拿到的就是
 * 还没初始化的绑定。`consent-gate.ts` 与 `privacy/store.ts` 用的是同一种单向形状：
 * 闸门不认识 store，store 在初始化时把值交给它。
 *
 * ⚠️ 代价是"忘了 bind ⇒ 闸门永远停在 `anonymous` ⇒ 一个都不拦"，
 * 那是本仓库最讨厌的一类静默失效。所以它有一条**承重判据**：
 * `tests/legal-recheck-gate.spec.ts` 里"没绑定时一个请求都不发"与
 * "绑定之后才发得出那次询问（带 Bearer、打对端点）"两条**一起**钉住这个接缝 ——
 * 只测前一半是一种假通过：把 `getToken()` 写死成 `() => undefined` 也照样全绿。
 * 这里钉的是"值进得去、问得出去"，判定本身在 `@heyta/app-host` 那 19 条里。
 *
 * ## 为什么 `fetchImpl` 传的是带链 5 闸门的 `consentFetch`
 *
 * "这个账号要不要补签"这一问**本身也是一个请求**。设备级同意还没作出时它不该发出去
 * （G-12 的射程是"任何出站"，没有理由放过一条元问题）。
 * 🔴 但**反向不成立**：账号级闸门**不**包 `window.fetch` —— 那样"发确认"这条 POST
 * 会被自己拦住，用户点完按钮永远得到一次失败。这正是两道闸必须分层的原因。
 */

import { createLegalRecheckGate, type LegalRecheckGate } from '@heyta/app-host';

import { consentFetch } from '../privacy/consent-gate.js';

interface WebCredentials {
  token?: string;
  baseUrl: string;
}

let credentials: WebCredentials = { baseUrl: '' };

export const legalRecheck: LegalRecheckGate = createLegalRecheckGate({
  getToken: () => credentials.token,
  getBaseUrl: () => credentials.baseUrl,
  fetchImpl: consentFetch,
});

/** 只交值、**不问**。用在冷启动：那时设备级闸门多半还是关的，问了也只是白问。 */
export function bindLegalRecheckCredentials(next: WebCredentials): void {
  credentials = { token: next.token, baseUrl: next.baseUrl };
}

/** 只问、不动值。启动序列里那一步（`arm()`）与每次凭据变化都调它。 */
export function askLegalRecheck(): void {
  void legalRecheck.refresh();
}

/**
 * 由同步 store 在**模块求值期**交一次冷启动的凭据（`bind`），并在每次凭据变化后
 * 交一次并**重问**（本函数）。
 *
 * 重问的理由不是"传参"而是上一轮的答案已经不作数了：换令牌、换服务端地址、
 * 换账号，都可能意味着另一个版本、另一台实例、甚至另一个法律主体。
 */
export function syncLegalRecheckCredentials(next: WebCredentials): void {
  bindLegalRecheckCredentials(next);
  askLegalRecheck();
}

/** 登出：把凭据与上一个人的答案一起清掉（闸门不许留着它们）。 */
export function clearLegalRecheckCredentials(): void {
  credentials = { baseUrl: '' };
  legalRecheck.reset();
}
