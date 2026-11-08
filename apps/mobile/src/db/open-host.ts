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
// 换代窗口里读路由要返回**空态**：擦除之后数据本来就没了，这不是「降级」，是事实。
import { emptyState } from '@heyta/op-log';
import { readSyncConfig } from '../sync/config';
import { consentFetch } from '../privacy/consent-gate';
import { emitLocalWrite } from '../sync/write-signal';
import { hostPublishSource } from '../widgets/publish-source';
import { publishWidgetSnapshot } from '../widgets/publish';
import {
  isVaultRootAutoUnlockDisabled,
  loadVaultRootKey,
} from '../lib/vault-secure-storage';
import {
  bindMobileOplogBase,
  currentState as shareAwareState,
  dispatchChecked as shareAwareDispatchChecked,
  dispatchIntent as shareAwareDispatchIntent,
} from '../share/wiring';
import { opSqliteDriverFactory } from './op-sqlite-driver';

const DB_NAME = 'heyta.sqlite';

let pending: Promise<AppHost> | null = null;
let resolvedHost: AppHost | undefined;
/**
 * 当前这一代的**原始**宿主（`withWriteSignal` 包装之前的那一份）。
 *
 * 🔴 共享写路由只许拿这个，不许拿 `openTaskHost()` 的返回值：
 *    后者是包装过的，它的 `getState` 是 `shareAwareState` —— 再交给路由就会绕回
 *    `currentState()` 形成**共享读路由递归**（真机上那一屏写的正是这句话）。
 *    但路由又必须按"当前这一代"解析（否则擦除后有个必然报错的空窗），
 *    所以这里保留原始句柄，并跟着换代置空。
 */
let currentRawHost: AppHost | undefined;
let hostEpoch = 0;

/**
 * 宿主换代（`hostEpoch`）的订阅者。
 *
 * 🔴 为什么需要它（崩溃审计 2026-11-08 · §H.4 第 2 层，U16 那条 P0 的另一半）：
 * 单例的**作废**已经被 `resetTaskHostCache()` 处理了，但"作废"这件事只有清变量的
 * 那一方知道。19 个屏幕各自 `useState<AppHost>` + `useEffect(..., [])` 只取一次，
 * 拿到的是**快照**。擦除之后它们继续拿着那个 adapter 已被 `destroy()` 的实例，
 * 任何写入落到 `AdapterDestroyedError` —— 而且**不会自己好**，因为那个 effect
 * 的依赖数组是空的，永远不会再跑第二次。
 *
 * 所以这里提供的是"**换代可被观察**"这一件事本身，而不是逐个屏幕打补丁：
 * 屏幕通过 `useTaskHost()` 订阅它，换代即重新取宿主。
 * 判据见 `apps/mobile/tests/task-host-generation.spec.ts`。
 */
const epochListeners = new Set<() => void>();

/** 换代通知。**不允许**任何一个订阅者抛错把其余订阅者挡在门外。 */
function emitEpochChange(): void {
  for (const listener of [...epochListeners]) {
    try {
      listener();
    } catch {
      // 订阅者是界面回调；它自己坏了不等于"换代"这件事没发生。
    }
  }
}

/** `useSyncExternalStore` 的 `subscribe`：返回退订函数。 */
export function subscribeTaskHostEpoch(listener: () => void): () => void {
  epochListeners.add(listener);
  return () => {
    epochListeners.delete(listener);
  };
}

/**
 * `useSyncExternalStore` 的 `getSnapshot`。
 *
 * 🔴 必须返回**原始值**（number），不能返回对象 —— 每次 `getSnapshot` 返回一个新对象
 * 会让 React 认为快照一直在变，直接进入无限重渲染。
 */
export function getTaskHostEpoch(): number {
  return hostEpoch;
}

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
 *
 * 🔴 M6 之后这里同时是**共享写路由的装配点**（`share/wiring.ts`，对应 web 的
 * `lib/oplog.ts`）：交出去的是**原始宿主**的三件入口（路由判据在 app-host，
 * 壳里一个字不判），而 `dispatch` / `dispatchChecked` / `getState` 三件都过同一份
 * 晚绑定装配。**没装共享通道时逐字等于原来的 `dispatch`** ——
 * `shareAwareDispatchIntent` 的未装配分支就是 `host.dispatch(intent)`。
 */
/**
 * 给共享写路由用：拿到**当前这一代**的原始宿主。
 *
 * 换代窗口里 `currentRawHost` 是空的（作废时被置空），此时**等**一次重开 ——
 * `dispatch` / `dispatchChecked` 本来就是 async，这个等待不会把同步接口变异步。
 * 修复前这里是一个必然报错的窗口：真机上表现为「移动端宿主尚未打开，写路由无处可落」。
 */
async function hostForRouter(): Promise<AppHost> {
  if (currentRawHost !== undefined) return currentRawHost;
  await openTaskHost();
  if (currentRawHost === undefined) {
    throw new Error('移动端宿主尚未打开，写路由无处可落。请先 await openTaskHost()。');
  }
  return currentRawHost;
}

function withWriteSignal(host: AppHost): AppHost {
  const widgetSource = hostPublishSource(host);
  /**
   * 🔴 共享写路由按「**当前这一代**」装配，不装配某个实例的快照。
   *
   * 【为什么（2026-11-08 真机配对实测 · §H.9.9）】原来这里绑的是 `host.dispatch`
   * 这些**闭在实例上**的函数，而 `resetTaskHostCache()` 会在作废时把整个路由
   * `bindMobileOplogBase(undefined)` 摘掉、等新宿主开好再重新装上。中间那段窗口里
   * 任何一次写都落进 `requireBase()` 的守卫：
   *
   *     移动端宿主尚未打开，写路由无处可落。请先 await openTaskHost()。
   *
   * 真机上它的用户可见形态是一整屏「这个界面出错了 / 重试」，而且**变异版与修复版
   * 表现完全一致** ⇒ 是独立于"持有旧实例"的第二条通路。
   *
   * 改法：`dispatch` 先 `await openTaskHost()` 再落到当前宿主 —— 它本来就是 async，
   * 这个等待不会把同步接口变成异步；`getState` 是同步的，只能现读，拿不到就照旧抛
   * （同步读没有"等"这个选项）。
   */
  currentRawHost = host;
  bindMobileOplogBase({
    dispatch: async (intent) => (await hostForRouter()).dispatch(intent),
    dispatchChecked: async (build) => (await hostForRouter()).dispatchChecked(build),
    /**
     * 同步读：窗口里**返回空态**，不抛。
     *
     * 🔴 为什么空态是对的（而不是「降级」或「凑合」）：这条窗口只在**本机明文刚被销毁**
     * 之后出现，那一刻「这台设备上没有任何数据」本身就是事实 —— `emptyState()` 说的正是它。
     * 反过来两个选项都不行：抛错会让用户看到一整屏「这个界面出错了」（2026-11-08 真机实测）；
     * 返回上一次的快照等于**数据已销毁还把旧数据再显示一遍**，直接违背清除承诺。
     *
     * `emptyState()` 与 `host.getState()` 返回的是**同一个类型**（`MaterializedState`，
     * 见 `packages/op-log/src/state.ts:115` 与 `packages/app-host/src/host.ts:1532`），
     * 所以这不是新造一种形状，就是用它本来那个空态。
     */
    getState: () => currentRawHost?.getState() ?? emptyState(),
  });

  return {
    ...host,
    // 合并视图：没装共享通道时逐字 = `host.getState()`。
    getState: () => shareAwareState(),
    dispatchChecked: (build) => shareAwareDispatchChecked(build),
    dispatch: async (intent) => {
      await shareAwareDispatchIntent(intent);
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
    const epoch = hostEpoch;
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
      // Account/data cleanup may reset the singleton while native SQLite is
      // still opening. Never give that old connection a new session's identity.
      if (epoch !== hostEpoch) {
        host.close();
        throw new Error('Task host opening was superseded by a database reset');
      }
      resolvedHost = host;
      return host;
    }).catch((error: unknown) => {
      // A late failure from an old generation must not evict the current open.
      if (epoch === hostEpoch) pending = null;
      throw error;
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

/**
 * 仅供测试与"重开数据库"这类显式场景使用。
 *
 * 🔴 **必须先把旧宿主关掉再作废它**（崩溃审计 2026-11-08 · U16 第 2 条 P0）。
 *
 * 此前这里只清三个模块级变量，既不给旧 host 发信号、也不关它。后果有两层：
 *
 *   1. **原生句柄泄漏**：`resolvedHost` 一旦被置 `undefined`，JS 侧就再也没有
 *      引用去 `close()` 它了 —— SQLite 连接与 OPFS 同步访问句柄会一直开着，
 *      直到进程退出。而注销账号之后紧接着要做的正是"重新建库"。
 *   2. **已挂载的屏幕仍拿着死宿主**：32 处 `useEffect(..., [])` 只取一次 host，
 *      它们继续拿着那个 adapter 已被销毁的实例，任何写入落到
 *      `AdapterDestroyedError`。
 *
 * 这一轮只修第 1 层（contained，且是纯泄漏）。第 2 层需要一条
 * "宿主换代可订阅"的通道（`useSyncExternalStore` + `resolvedHost` 做快照），
 * 要把 32 个屏幕都改成通过钩子取 host —— 那是独立一轮的改动，已记在
 * `docs/plans/crash-audit-report-2026-11-08.md` §H.4。
 *
 * ⚠️ `close()` 允许抛（例如宿主已经因为别的原因半死）—— 吞掉它：
 * 这条路径的契约是"作废并放手"，不是"报告关闭失败"。
 */
export function resetTaskHostCache(): void {
  const previous = resolvedHost;
  hostEpoch += 1;
  pending = null;
  resolvedHost = undefined;
  if (previous !== undefined) {
    try {
      previous.close();
    } catch {
      // 宿主已经处于不可用状态；我们已经放手，剩下的交给 GC 与进程退出。
    }
  }
  // 🔴 原始宿主跟着换代置空：路由下一次解析时会等重开，而不是落到已销毁的实例上。
  currentRawHost = undefined;

  // 🔴 这里**不再** `bindMobileOplogBase(undefined)` 了。
  //
  // 原来摘掉它防的是"下一次 `dispatchIntent` 还写进那个已按口径 B 拒绝读写的旧 adapter"。
  // 但摘掉之后、新宿主开好之前是一段**必然空**的窗口，窗口里的任何一次写都会抛
  // 「写路由无处可落」，真机上是一整屏错误（§H.9.9）。现在路由改成按"当前这一代"
  // 解析（见 `withWriteSignal` 里那段），它自己就不会再落到旧 adapter 上 ——
  // 那个顾虑消失了，而摘掉反而亲手造出这个窗口。

  // 🔴 **最后一步**才通知，且**推到下一个宏任务**：订阅者收到通知就会重新
  // `openTaskHost()`，而这条路径紧接着一次**真的删库**（`adapter.destroy()` 刚返回）。
  //
  // 【为什么不能同步发（2026-11-08 真机实测）】同步发的时候，四张仍挂载的 tab
  // 在同一 tick 里重开宿主，与销毁的收尾（原生 `close()` / 文件删除的后半段）撞上，
  // 症状是**注销之后第一屏报「打开本地数据库失败」**：
  //
  //     技术细节：本地数据库恢复失败：读不出已存在的操作日志…
  //
  // 而同一台设备上：库的 `pragma integrity_check` = ok、`ops`/`state` 都是 0 行、
  // **杀进程重开一切正常**（「还没有任务」）。⇒ 那是**瞬时竞态**，不是数据损坏，
  // 更不能让它变成用户看到的那一屏。让 teardown 先退栈即可。
  setTimeout(emitEpochChange, 0);
}
