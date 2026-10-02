/**
 * 启动序列里那三步「同意之后才准做的事」（G-12）
 * ==============================================
 *
 * ## 为什么这个文件存在
 *
 * `main.tsx` 是**入口**：它有顶层副作用、要 `#root`、会拉起 op-log 与 React。
 * 把"注册 SW / 采用待消费的登录 / 建实时连接"写死在里面，这三条就**没有一条能被判据钉住**
 * —— 而它们恰好是本计划里最容易无声退化的部分：任何人在 `main.tsx` 里把那行
 * `registerWidgetServiceWorker()` 搬回顶部，全仓没有任何东西会失败，
 * 症状只是"同意前多发了一次请求"。
 *
 * 所以这里把三步收成一个**端口注入**的闭包：判据传三个计数器进去，
 * 数得出每一步在同意之前被调了几次（必须是 0）。`main.tsx` 只留装配与顺序。
 *
 * ## 三步各自的闸在哪一层（不要在这里重复实现判定）
 *
 * | 出口 | 闸 |
 * |---|---|
 * | HTTP `fetch` | `consent-gate.ts` 的带闸 fetch（进程级 + 注入两处） |
 * | `WebSocket` | `features/sync/store.ts` 的 `restartRealtime()`（全仓唯一构造点） |
 * | `serviceWorker.register()` | **本文件**：没同意就不调 `registerServiceWorker` |
 * | 采用待消费的登录（会发请求） | **本文件**：`holdPendingLogin` 的"收/用"分离 |
 *
 * ## 🔴 顺序：整段都在 `initOpLog()` **之后**
 *
 * 三条里有两条等不起：
 *   · **采用待消费的登录**会立刻触发同步，op-log 没就绪时落盘不安全
 *     （`main.tsx` 里 `startWidgetLifecycle` 同一个理由）；
 *   · **建实时连接**要拿 `engine.clientId`（LWW 的决胜依据，协议要求每条消息带上）。
 * ⚠️ `main.tsx` 里那一步原本的注释写着"放在 `initOpLog()` 之前、而且不等它"，
 * 那个顺序在三步被并成一束之后**已经不成立**，也不该恢复：
 * 小组件是增强，晚几百毫秒注册不改变任何用户可见行为，
 * 而"登录采用早于 op-log 就绪"是会写坏数据的那种早。
 *
 * ## 为什么「每次启动最多跑一次」只保证在 SW 那一步
 *
 * 注册 SW 是**不可逆**的（注册了就一直在），所以重复调必须有守卫。
 * 另外两步本来就该重跑：`startRealtime()` 每次重建连接（令牌可能换了），
 * 而那枚待消费的登录在采用时被**一次性取走**（`held` 置空），重跑取不到东西。
 */

import type { HeldPendingLogin } from '../auth/pending-login.js';

export interface StartupNetworkPorts {
  /** 闸门开没开。**判定的唯一事实源是 `privacyConsent`**，这里只接一个读法。 */
  networkAllowed(): boolean;
  /** 注册小组件的 service worker（这一步自己会发一次 `scope` 下的请求）。 */
  registerServiceWorker(): void;
  /** 建立/重建实时通道。未配置或未登录时它自己就是空操作。 */
  startRealtime(): void;
  /** 采用一枚已经收下的登录（**会发请求**，所以必须在同意之后）。 */
  adoptPendingLogin(held: HeldPendingLogin): void;
}

export interface StartupNetwork {
  /**
   * 记下"启动时收下了这样一枚登录"。
   *
   * ⚠️ **收下**（`holdPendingLogin`，把令牌从地址栏与存储里立刻抹掉）是安全动作，
   * 与同意无关，所以它发生在调用方；这里只负责"什么时候才**采用**"。
   * 传 `null` 表示这轮启动没有待消费的登录。
   */
  hold(held: HeldPendingLogin | null): void;
  /**
   * 按当前闸门补跑那三步。闸门关着 ⇒ **一次都不调**，并原样留着待消费的登录。
   *
   * 可以被反复调用（冷启动调一次、订阅者再调一次），守卫见文件头最后一条。
   */
  arm(): void;
}

export function createStartupNetwork(ports: StartupNetworkPorts): StartupNetwork {
  let serviceWorkerArmed = false;
  let pendingLogin: HeldPendingLogin | null = null;

  return {
    hold(held) {
      pendingLogin = held;
    },

    arm() {
      if (!ports.networkAllowed()) return;

      if (!serviceWorkerArmed) {
        serviceWorkerArmed = true;
        ports.registerServiceWorker();
      }

      const held = pendingLogin;
      if (held !== null) {
        pendingLogin = null;
        ports.adoptPendingLogin(held);
      }

      ports.startRealtime();
    },
  };
}
