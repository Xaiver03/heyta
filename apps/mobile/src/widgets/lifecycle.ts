import { AppState, type AppStateStatus } from 'react-native';

import type { AppHost } from '@heyta/app-host';

import { openTaskHost } from '../db/open-host';
import { drainWidgetIntentsNow } from './drain';
import { publishWidgetSnapshot } from './publish';
import { syncFocusActivity } from './widget-bridge';
import { hostPublishSource } from './publish-source';

/**
 * 小组件的生命周期接线：应用什么时候醒、醒了做什么
 * ====================================================
 *
 * 纯逻辑都在 [publish.ts] 与 [drain.ts] 里（那两个文件**能在 node 里跑**，所以有测试）。
 * 本文件只做一件事：把两件事接到平台的两个时机上 —— **启动**与**回到前台**。
 *
 * ## 🔴 两件事，缺一不可
 *
 * | 顺序 | 做什么 | 少了它会怎样 |
 * |---|---|---|
 * | 1 | **drain**：把组件里攒下的点击落成 op | "我在组件上勾了，进应用还是没勾" —— 而那条数据好好地躺在容器里，只是没人去取 |
 * | 2 | **publish**：重发一份快照 | 第二天早上打开应用，`validUntil` 还是**昨天**的零点，组件一直显示"数据已过期"直到用户改点什么 |
 * | 3 | **syncFocusActivity**：推进灵动岛（W5-3，仅 iOS） | 灵动岛**永远不出现** —— 而"不出现"和"用户在设置里关了"看起来一模一样 |
 *
 * 第 2 条**不是优化**，它是补一个真实的空档：
 *
 * - 发布只挂在 `dispatch` 之后（见 `db/open-host.ts`）。所以"应用开了但用户什么都没改"
 *   —— 而那正是**每天早上最常见的情况** —— 不会触发任何发布。
 * - 组件侧按设计**不会自己推"今天"**（D1：`dayStr` 由应用算，原生只判 `now >= validUntil`），
 *   所以它不会自愈，只会显示"数据已过期"。
 *
 * 第 3 条同样不是优化：灵动岛的启动**只有这一条路径能触发**（见 W5-3 证据块 ⑧）。
 *
 * 合起来：**用户早上打开应用看一眼就走（不改任何东西）→ 组件一整天都是过期的。**
 * 这个缺陷只在"跨了一天且没有任何写入"时出现，而那恰恰是主路径。
 *
 * 顺序：**先 drain 后 publish**。drain 会经 `dispatch` 触发一次发布，
 * 但那一次用的 `dayStr` 与这里算的是同一个（同一毫秒级），所以第二次 publish 是**幂等**的
 * —— 换来的是"drain 什么都没做时也一定刷新过"这条确定性，值得多写一次容器。
 *
 * ## 为什么不去监听"组件被点击"的广播
 *
 * 那条路要在原生侧把应用拉起来（Android 上是 `broadcast` + 前台服务那一套），
 * 而它会带来一个更糟的默认行为：**用户每在组件上点一下，应用就被拉到前台**。
 * 组件存在的意义恰恰是"不用打开应用"，所以这里刻意选择"应用下次醒来时再落地"，
 * 并用**乐观显示**（组件立刻把那一行画成勾选态）保证点击的即时反馈。
 * 这个取舍与 D1（组件只做一次 AES-GCM、不跑 Argon2id）是同一类：
 * **把成本从"每次点击"挪到"每次打开"**。
 */

let subscription: { remove(): void } | undefined;
let foreground = isForeground(AppState.currentState);

function isForeground(state: AppStateStatus | null | undefined): boolean {
  // ⚠️ 与 `sync/auto-sync.ts` 同一判据：只把 `active` 当成前台。
  // `inactive` 在 iOS 上是"正在切走/来了电话"，那时做写操作会做到一半被打断。
  return state === 'active';
}

/**
 * 醒来一次：先 drain，再 publish。**永不抛** —— 它挂在应用启动路径上，
 * 为了一个组件里的点击让应用起不来是荒唐的。
 */
async function wake(): Promise<void> {
  let host: AppHost;
  try {
    host = await openTaskHost();
  } catch (error) {
    // **开宿主**就失败了（数据库打不开）。那不是小组件的问题，
    // 但也不该把应用启动卡住 —— 如实打出来，让真正的故障在别处被看见。
    console.warn('[widget] 无法打开宿主，跳过 drain 与发布：', error);
    return;
  }

  // 各自 try/catch：一个失败不该把另一个也带下去。
  // （两者内部都已经吞了异常，这里再包一层是为了"将来有人改了它们"也不会连带。）
  try {
    await drainWidgetIntentsNow(host);
  } catch (error) {
    console.warn('[widget] drain 抛出（不应发生）：', error);
  }

  try {
    await publishWidgetSnapshot(hostPublishSource(host));
  } catch (error) {
    console.warn('[widget] 发布抛出（不应发生）：', error);
  }

  // ③ W5-3 · 推进灵动岛。
  //
  // ⚠️ **必须放在 publish 之后**：`syncFocusActivity` 读的是**容器里的快照**，
  //    而不是上面这个 `host`。先推进的话它会读到**上一次**的快照 ——
  //    症状是灵动岛显示的还是上一场专注，而且下一次唤醒才会追上。
  //    （这与文件头"先 drain 后 publish"是同一类顺序约束，所以放在这一段里，
  //    而不是另起一个生命周期。）
  //
  // ⚠️ 平台差异：iOS 之外这个原生方法不存在，`callNativeSafely` 会回落到 `'none'`
  //    并**只警告一次** —— 所以安卓/鸿蒙上这行不是死代码，是一个空操作。
  try {
    await syncFocusActivity();
  } catch (error) {
    console.warn('[widget] 推进灵动岛抛出（不应发生）：', error);
  }
}

/**
 * 启动小组件生命周期。**幂等** —— React 的 StrictMode 会让 `useEffect` 跑两次，
 * 不做幂等就会挂两个 `AppState` 监听，于是每次回到前台醒来两遍。
 *
 * （醒来两遍本身是安全的：drain 第二遍读到空队列直接返回，publish 本来就有合并。
 * 但那会多开一次宿主读盘，而且**掩盖**了"监听重复注册"这件事。）
 *
 * 返回停止函数，供 `useEffect` 的清理调用。
 */
export function startWidgetLifecycle(): () => void {
  if (subscription !== undefined) {
    return () => {
      /* 已经启动过：停止由拥有者负责，这里不重复注册。 */
    };
  }

  // 启动时先醒一次：应用可能是被"从组件点进来"的路径拉起来的，
  // 也可能只是隔了一夜被重新打开。
  void wake();

  subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
    const next = isForeground(state);
    const cameBack = next && !foreground;
    foreground = next;
    // 只在**回到**前台时醒来。"去后台"和"inactive"期间什么都不做。
    if (cameBack) void wake();
  });

  return function stopWidgetLifecycle(): void {
    subscription?.remove();
    subscription = undefined;
    foreground = isForeground(AppState.currentState);
  };
}

/** 只给测试用：清掉模块级状态。 */
export function __resetWidgetLifecycleForTests(): void {
  subscription = undefined;
  foreground = isForeground(AppState.currentState);
}
