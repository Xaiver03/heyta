/**
 * Web 宿主的隐私同意装配（闸门的那**三处平台事实**）
 * =================================================
 *
 * 判定逻辑全在 `@heyta/app-host` 的 `privacy-consent.ts`（AGENTS.md §3.5：
 * "同意之后才准出门"是产品语义，不是外壳的事）。本文件只做宿主注入的那部分，
 * 而且刻意**只做三件事**：
 *
 *   1. 给一个 localStorage 后端、**永不抛**的 {@link PrivacyConsentPort}；
 *   2. 建**唯一一个**闸门实例，并把 `fetch` 包一层交出去；
 *   3. 装一道**进程级**的出口闸（替换 `window.fetch`），让"新加一个调用点忘了传
 *      `fetchImpl`"不再等于"合规前提悄悄失效"。
 *
 * ## 🔴 为什么既有注入点、又替换 `window.fetch`
 *
 * 注入（`buildClient({ fetchImpl })`）是**可断言**的那一层：单测里数得出底层调用次数。
 * 但它只覆盖"记得传"的调用点。替换 `window.fetch` 覆盖的是**其余全部 HTTP 出口**
 * —— 包括以后新写的、以及第三方代码里冒出来的那些。
 * 两者都包在**同一个 pristine fetch** 上，所以不会出现"闸中闸"的双重拒绝，
 * 也意味着注入点拿到的是同一个实例。
 *
 * ⚠️ **替换 `window.fetch` 拦不住、也不该拦的三类**，各自另有闸：
 *   · `<script src>` / `import()` / `<img>` —— 浏览器自己的加载器，不经 `fetch`。
 *     它们拉的是**本站静态资源**，不是用户数据，所以不在这条规则的射程里。
 *   · `WebSocket` —— 由 `restartRealtime()` 那一处开关负责（全仓只有一个构造点）。
 *   · `navigator.serviceWorker.register()` —— 由 `main.tsx` 在同意之前不调用负责
 *     （计划 G-12 点名的正是这一条：它会把 `scope` 下的一次请求提前发出去）。
 *
 * ## 为什么端口"永不抛"
 *
 * 调用点之一是应用启动路径。隐私模式下**访问** `localStorage` 这个属性本身就会抛，
 * 而不是返回 `null`（`lib/locale.ts`、`lib/theme.ts` 都为此包了 try/catch）。
 * 这里抛出去的代价是"应用起不来"，而它本来只该影响"这次同意有没有被记住"，
 * 所以异常一律降级成 `undefined` / `false` —— `false` 会让闸门回落到**会话内**的值，
 * 那正是 `privacy-consent.ts` 文件头"写不进去时这一轮仍然算同意过"那条的落点。
 */

import {
  createConsentGatedFetch,
  createPrivacyConsentGate,
  type PrivacyConsentPort,
  type PrivacyConsentRecord,
} from '@heyta/app-host';

const STORAGE_UNAVAILABLE_MESSAGE =
  '[privacy] localStorage 不可用：同意只在本次会话内生效，下次启动会重新询问';

/**
 * localStorage 后端。
 *
 * 🔴 每次调用**都重新访问** `globalThis.localStorage`，不在模块顶层取一次：
 * 顶层取会在"模块被测试环境先加载、存储随后才可用"的场景里永久缓存成不可用，
 * 而那会让闸门在真实浏览器里也一起关掉（本仓库在 `VITE_SYNC_URL` 上写过同一条理由）。
 */
export const localStoragePrivacyConsentPort: PrivacyConsentPort = {
  read(key) {
    try {
      return globalThis.localStorage.getItem(key) ?? undefined;
    } catch {
      return undefined;
    }
  },
  write(key, value) {
    try {
      globalThis.localStorage.setItem(key, value);
      // 写完之后**验一遍**：Safari 的隐私模式与配额耗尽时 `setItem` 会静默不落地，
      // 只有不抛、也不生效。返回"真的写进去了"才有意义，否则界面的那句"已记住"是假话。
      return globalThis.localStorage.getItem(key) === value;
    } catch {
      console.warn(STORAGE_UNAVAILABLE_MESSAGE);
      return false;
    }
  },
  remove(key) {
    try {
      globalThis.localStorage.removeItem(key);
      return globalThis.localStorage.getItem(key) === null;
    } catch {
      console.warn(STORAGE_UNAVAILABLE_MESSAGE);
      return false;
    }
  },
};

/**
 * 本进程的**唯一**闸门实例。
 *
 * ⚠️ 只许有这一个：同意状态散成两份，就会出现"这个面板放行了、那个调用点拦住了"
 * 这种在最外层看不出来的分裂（`privacy-consent.ts` 用闭包而不是模块级可变状态，
 * 就是为了由宿主显式决定"哪一个是那道闸"）。
 */
export const privacyConsent = createPrivacyConsentGate(localStoragePrivacyConsentPort);

/**
 * 包了闸门的 `fetch`：**没有同意，一个字节都不出这个进程**。
 *
 * 拿它作为所有出站客户端的 `fetchImpl`（`buildClient`、认证客户端、AI 客户端、
 * 收件箱 / 权益探测）。判据在调底层**之前**，所以未同意时底层次数必须是 0。
 */
export const consentFetch: typeof fetch = createConsentGatedFetch(
  globalThis.fetch.bind(globalThis),
  () => privacyConsent.networkAllowed(),
);

/**
 * 一次决定的通知回执。
 *
 * 会话状态会立即生效，但写盘可能失败；设置页需要区分“后续决定已经
 * 可靠落盘”与“只是又发生了一次决定”，否则会把真实的失败提示清掉。
 */
type ConsentChange = Readonly<{
  record: PrivacyConsentRecord | null;
  persisted: boolean;
}>;
type ConsentListener = (change: ConsentChange) => void;
const listeners = new Set<ConsentListener>();
let lastConsentPersisted = true;

/** 本次进程中最后一次保存的回执，供重新显示的设置页读取。 */
export function readPrivacyConsentPersistence(): boolean {
  return lastConsentPersisted;
}

function notify(change: ConsentChange): void {
  lastConsentPersisted = change.persisted;
  // 🔴 一个订阅者的异常不许影响其余的：这条通知同时驱动实时通道与小组件，
  // 让"重建 WS 时抛了"变成"同意按钮点了没反应"是错的优先级。
  for (const listener of listeners) {
    try {
      listener(change);
    } catch (error: unknown) {
      console.warn('[privacy] 决定变更的订阅者抛错（不影响同意本身）：', error);
    }
  }
}

/**
 * 订阅同意状态的变化。返回取消订阅。
 *
 * 为什么用订阅而不是让界面直接调 `startRealtime()`：
 * 决定有**三个**来源（首启面板、设置页的撤回、将来可能的深链），
 * 而"实时通道要不要连着"只有**一个**所有者（`features/sync/store.ts`）。
 * 让每个来源都记得去踢一次同步，就是"新加一个入口忘了踢"的开始。
 */
export function subscribePrivacyConsent(listener: ConsentListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 记下一次决定并通知订阅者。**界面只许走这两个方法**，
 * 直接用 `privacyConsent.decide()` 会让实时通道停在旧状态上。
 *
 * ⚠️ 只接受**用户明确的一次动作**（文件头那条纪律在 app-host 里，这里不重复实现）。
 */
export const privacyConsentActions = {
  accept(): { persisted: boolean } {
    const readout = privacyConsent.decide('accepted');
    notify(readout);
    return { persisted: readout.persisted };
  },
  /** 不同意：只用本机。核心功能全部保留（PIPL 第 16 条的结构理由）。 */
  localOnly(): { persisted: boolean } {
    const readout = privacyConsent.decide('local-only');
    notify(readout);
    return { persisted: readout.persisted };
  },
  /** 撤回同意（PIPL 第 15 条要的那个"便捷的方式"）：清回"没问过"。 */
  revoke(): { persisted: boolean } {
    const readout = privacyConsent.revoke();
    notify({ record: null, persisted: readout.persisted });
    return readout;
  },
};

let installed = false;

/**
 * 把 `window.fetch` 换成 {@link consentFetch}（**幂等**）。
 *
 * 🔴 必须是 `main.tsx` 里的**第一条语句**：ES module 的 import 会先于本函数执行，
 * 所以任何在**模块求值期**就发请求的代码都不在这道闸的射程里 —— 那是要防的第二类失效，
 * 判据（`tests/consent-gate.spec.ts`）里有一条就是"启动期零请求"。
 *
 * ⚠️ 为什么可以安全地换掉全局：{@link consentFetch} 包的正是原来那个 `window.fetch`
 * （`globalThis.fetch.bind(globalThis)` 在替换**之前**已经取好），
 * 换上去之后不产生递归，也只多一次布尔判断。
 *
 * ⚠️ 只装一次：重复装会把闸再包一层（无害但让"底层调用次数"这个判据翻倍）。
 */
export function installConsentGatedFetch(): void {
  if (installed) return;
  if (typeof globalThis.fetch !== 'function') return; // 非浏览器宿主（测试里可能没有）
  globalThis.fetch = consentFetch;
  installed = true;
}

/** 仅供测试：把全局 `fetch` 换回去并清掉订阅者。 */
export function __resetConsentInstallForTests(): void {
  installed = false;
  listeners.clear();
}
