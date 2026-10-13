/**
 * 移动端宿主打开
 * ==============
 *
 * 🔴 这是 `apps/mobile` 里**唯一**允许存在平台差异的地方（AGENTS.md §3.5 / ADR-0003 §2.1）：
 * 注入哪个 SQLite 驱动。
 *
 * 除此之外这里什么都不做 —— `clientId` 的读取与持久化、同步游标、schema 初始化顺序、
 * 任务 op 的构造，全部在 `@heyta/app-host` 里。判断标准：
 * **这段代码里有没有任何一行在决定"业务上该怎么做"？**
 *
 * 原来这段逻辑内联在 `App.tsx` 里。抽出来的原因是它要被多个屏复用 ——
 * 两处各写一份 `openAppHost({...})` 就是漂移的开始（本项目已经因此吃过一次亏，
 * 见 AGENTS.md §3.5 末尾那两段真实的漂移）。
 */

import { openAppHost, type AppHost } from '@heyta/app-host';
import { readSyncConfig } from '../sync/config';
import { consentFetch } from '../privacy/consent-gate';
import { emitLocalWrite } from '../sync/write-signal';
import { hostPublishSource } from '../widgets/publish-source';
import { publishWidgetSnapshot } from '../widgets/publish';
import {
  isVaultRootAutoUnlockDisabled,
  loadVaultRootKey,
} from '../lib/vault-secure-storage';
import { opSqliteDriverFactory } from './op-sqlite-driver';

const DB_NAME = 'heyta.sqlite';

let pending: Promise<AppHost> | null = null;
let resolvedHost: AppHost | undefined;

/**
 * 在宿主外面包一层：**每次写入之后喊一声"写了"**，自动同步据此把改动推出去，
 * 小组件据此重发快照。
 *
 * 🔴 包在 `dispatch` 这个**唯一写入口**上，而不是在各个界面里逐处调用。
 * 理由是"以后有人加一个新动作，忘了通知同步"这件事一定会发生 ——
 * 而它的表现是"这个功能创建的数据从来不同步"，且**没有任何一处会报错**
 * （本地一切正常，只有另一台设备上看不见）。
 * 挂在写入口上，新增动作自动被覆盖，不需要任何人记得。
 *
 * ⚠️ 顺序：**先落库、后喊**。反过来会让同步先查队列、查不到刚写的那条。
 */
function withWriteSignal(host: AppHost): AppHost {
  const widgetSource = hostPublishSource(host);

  return {
    ...host,
    dispatch: async (intent) => {
      await host.dispatch(intent);
      emitLocalWrite();

      /**
       * 🔴 **重发小组件快照**。
       *
       * 挂在这里而不是挂在"任务被勾选"那一处：小组件显示的是**今天的整体视图**
       * （任务 + 四象限 + 习惯 + 专注 + 清单颜色），能影响它的写入有很多种 ——
       * 完成任务、改标题、换清单颜色、记一次习惯…… 逐个挂钩必然漏掉某个，
       * 而漏掉的表现是"某个操作之后组件要等下一次别的写入才更新"，**不会报错**。
       *
       * ⚠️ **不 `await`**：这条管线和用户正在做的写入无关，让它挡在 `dispatch`
       * 的返回路径上，会把一次本地写入的延迟变成"读状态 + AES + 写盘"的总和。
       * [publishWidgetSnapshot] 自己保证永不抛异常，所以不 await 不会产生
       * 未处理的 rejection。
       *
       * ⚠️ 也**不 `void` 掉就完**：它自己被合并，密集写入不会打成一堆并发。
       */
      void publishWidgetSnapshot(widgetSource);
    },
  };
}

/**
 * 打开（或复用一个已打开的）应用宿主。
 *
 * 🔴 **必须单例。** 每个屏幕各自 `openAppHost()` 会开出**多个 SQLite 连接
 * 与多条 op-log 重放路径**，表现为：在一个 tab 建的任务，切到另一个 tab 看不见，
 * 而且两条写入路径会互相覆盖向量时钟 —— 数据损坏且极难定位。
 *
 * 缓存的是 **Promise 而不是结果**：并发调用（两个屏幕同时挂载）时，
 * 缓一个已 resolve 的值会让第二次调用拿到 null 并再开一次连接。
 * 缓 Promise 让两次调用等的是同一个打开过程。
 */
export function openTaskHost(): Promise<AppHost> {
  if (pending === null) {
    pending = openAppHost({
      // 🔴 驱动是工厂不是实例：`SqliteAdapter` 会在 close 后靠它重开。
      driverFactory: opSqliteDriverFactory({ name: DB_NAME }),
      dbPath: DB_NAME,
      /**
       * 🔴 **凭据必须是活的取值器，不能是快照。**
       *
       * 这里原来传的是 `serverUrl: SERVER_URL`（一个硬编码常量），
       * 而且**根本不传 token / 口令** —— 于是移动端一条都同步不出去：
       * 那些值只能由用户在应用起来之后输入，而 `openAppHost` 在启动时就跑完了。
       *
       * `getSyncConfig` 每次同步都会被调用，所以用户在「我的」里改完
       * 立刻生效，不需要重启应用。
       */
      getSyncConfig: readSyncConfig,
      // The host reads the opt-in root before constructing the first vault
      // sync client. Settings UI is only the control surface; it is not part
      // of the unlock path required for background/automatic sync.
      vaultRootKeyStore: {
        load: (scope) => loadVaultRootKey(scope),
        isAutoUnlockDisabled: async (scope) => isVaultRootAutoUnlockDisabled(scope),
      },
      /**
       * 🔴 **显式注入闸门，而不是靠"全局那个 `fetch` 已经被换掉了"。**
       *
       * `SyncClient` 是在**构造函数里**取走的（`client.ts:670`
       * `this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)`），
       * 不是每次调用时现取。所以全局替换只覆盖**替换之后**建起来的客户端 ——
       * 移动端确实满足这个顺序（`startPrivacyGate()` 在 `App.tsx` 模块顶层，
       * 而 `openTaskHost()` 最早也要等到第一帧之后的 effect），
       * 但"合规前提成立"这件事**不该依赖一个模块求值顺序**：
       * 把 `startPrivacyGate()` 挪进 effect、或者哪天在 import 期就开宿主，
       * 症状是"同意之前发了一次请求"，而**没有任何一层会报错**。
       *
       * 全局那道（`installConsentGatedFetch()`）继续留着，它管的是另一半：
       * **以后新加的调用点忘了传 `fetchImpl`**。两半各拦一类失效，都要在。
       */
      fetchImpl: consentFetch,
      /**
       * 🔴 本机明文被销毁（主动注销或别的设备注销后同步读到信号）之后，
       * **把这个单例作废**：`pending`/`resolvedHost` 里那个 `AppHost` 已经持着一个
       * 按口径 B 拒绝读写的 adapter，留着它，下一屏拿到的还是同一个死实例。
       * 作废之后下一次 `openTaskHost()` 会重开一份全新空库 —— 那才是政策承诺的形状。
       */
      onLocalDataErased: resetTaskHostCache,
    }).then(withWriteSignal).then((host) => {
      resolvedHost = host;
      return host;
    });
  }
  return pending;
}

/** Return the singleton only when it has already finished opening. */
export function getOpenTaskHostIfReady(): AppHost | undefined {
  return resolvedHost;
}

/** Synchronously fence the host session during logout; never opens a host. */
export function invalidateTaskHostVaultSession(): void {
  resolvedHost?.invalidateVaultSession();
}

/** 仅供测试与"重开数据库"这类显式场景使用。 */
export function resetTaskHostCache(): void {
  pending = null;
  resolvedHost = undefined;
}
