/**
 * 自动同步的**调度决策**（纯逻辑，可单测）
 * ==========================================
 *
 * 🔴 这个文件存在的理由：移动端此前**只**在「我的」页那个「立即同步」按钮被按下时
 * 才同步（`apps/mobile/src/screens/ProfileScreen.tsx` 是 `syncNow()` 的唯一调用点）。
 *
 * 也就是说：**用户建了一条任务，它不会自己出去**。要让它到另一台设备，
 * 用户必须自己想到"去我的页点一下同步"。
 *
 * 这不是"少个功能"，这是**本地优先应用最核心的承诺没兑现**：
 * 用户的心智模型是"我记下来了，它就同步了"，而不是"我记下来了，我还得去某个页面点一下"。
 * 而它**不会报错、界面上也看不出异常** —— 数据就在本地，用起来一切正常。
 *
 * ---
 *
 * ## 为什么决策要单独拆出来
 *
 * 这里真正容易写错的不是"什么时候触发"，而是**并发**：
 *
 *   1. **同步进行中又来了本地写入** —— 那次写入**必须**在本次同步结束后再同步一次。
 *      写成"结束时统一把 dirty 清掉"，那次写入就**永久丢了**（要等下次前台才出去），
 *      而且和"同步成功"长得一模一样。所以这里用**代际计数**而不是一个布尔：
 *      记下"本次推的是第几代写入"，结束时只有**代数没变**才清 dirty。
 *   2. **失败后的重试** —— 不能退化成热循环（离线时每 2 秒打一次服务端）。
 *   3. **不在前台不跑** —— 后台同步既耗电，iOS 也只给几秒。
 *
 * 这三条都不是"触发时机"问题，而是**状态机**问题。所以按本仓库既有的做法
 * （见 `apps/mobile/src/lib/use-today.ts` 的 `msUntilNextMidnight`）：
 * **把决策拆成纯函数/纯状态机，单测覆盖；`auto-sync.ts` 只负责把它接到
 * 平台的两个时钟和真正的 `syncNow` 上。**
 *
 * ⚠️ 这里**不碰** `react-native`、不碰 `syncNow`、不碰凭据 —— 全部由调用方注入。
 */

/** 本地写入之后，安静这么久才同步（连续操作合并成一次）。 */
export const WRITE_DEBOUNCE_MS = 2_000;

/**
 * 两次自动同步之间的**最小间隔**。
 *
 * 🔴 没有它就会出现热循环：`dispatch` 每写一条 op 都会 `notifyLocalWrite()`，
 * 而同步本身可能触发物化重放（进而又写 op）。2 秒防抖挡不住"每 3 秒写一次、
 * 每次都被当成新的一批"这种情形。
 */
export const MIN_GAP_MS = 5_000;

/** 失败之后的冷却时间。冷却期内的触发**不会**取消，只会被推迟到冷却结束。 */
export const FAILURE_BACKOFF_MS = 15_000;

/** 定时器句柄。交由调用方决定是什么类型（RN / node / 测试的假定时器）。 */
export type TimerHandle = unknown;

export interface AutoSyncDeps {
  now(): number;
  setTimer(fn: () => void, ms: number): TimerHandle;
  clearTimer(handle: TimerHandle): void;
  /**
   * 同步一次。**返回 `true` = 已结算**（成功，或"有冲突等用户决定"）。
   *
   * 结算之后不再自动重试：冲突要人去选，自动重试既解决不了也会刷屏。
   * 返回 `false`（离线 / 可重试的错）则保留 dirty，等下一次触发。
   */
  sync(): Promise<boolean>;
  /**
   * 现在允许同步吗？**未配置凭据、或不在前台，都必须返回 false。**
   *
   * ⚠️ 未配置时**必须**挡住：否则每次回到前台都会跑一次注定失败的同步，
   * 把界面上的状态刷成一条吓人的错误 —— 而用户其实只是还没填凭据。
   */
  ready(): boolean;
  /** 意外异常的上报口（`sync()` 自己不该抛，但契约上防一手）。 */
  onError?(error: unknown): void;
}

export interface AutoSyncScheduler {
  /** 发生了一次本地写入（op 已落库）。 */
  notifyLocalWrite(): void;
  /** 应用回到前台。 */
  notifyForeground(): void;
  /** 用户刚填完同步凭据 —— 这一刻应当立刻同步一次。 */
  notifyConfigured(): void;
  dispose(): void;
  /** 仅供测试观察内部状态。 */
  debugState(): { dirty: boolean; running: boolean; scheduled: boolean; writeGen: number };
}

/**
 * 建一个调度器。
 *
 * 🔴 **所有时间来源都靠注入**，不在内部调 `Date.now()` / `setTimeout`：
 * 决策逻辑（防抖、最小间隔、失败冷却、代际合并）必须能用假定时器**确定性地**复现，
 * 否则"同步进行中又来了一次写入"这种时序根本没法测 ——
 * 而它恰恰是这里唯一会**丢数据**的分支。
 */
export function createAutoSyncScheduler(deps: AutoSyncDeps): AutoSyncScheduler {
  /** 已经发生过多少次本地写入。用来判断"本次同步之后又有没有新写入"。 */
  let writeGen = 0;
  /** 已经**推出去**（或正在推）的那一代写入。 */
  let syncedGen = 0;
  let running = false;
  let timer: TimerHandle | undefined;
  let nextAllowedAt = 0;
  let disposed = false;

  const dirty = (): boolean => writeGen > syncedGen;
  const scheduled = (): boolean => timer !== undefined;

  function cancelTimer(): void {
    if (timer !== undefined) {
      deps.clearTimer(timer);
      timer = undefined;
    }
  }

  /** 排一次同步；`delay` 是"最早多久之后"，实际会被最小间隔/冷却推迟。 */
  function schedule(delay: number): void {
    if (disposed || running) return;
    // 未配置 / 不在前台就不排。写入产生的 dirty 会留着，
    // 等 `notifyForeground()` 或 `notifyConfigured()` 再把它带出去。
    if (!deps.ready()) return;
    const earliest = Math.max(deps.now() + delay, nextAllowedAt);
    const wait = Math.max(0, earliest - deps.now());
    cancelTimer();
    timer = deps.setTimer(() => {
      timer = undefined;
      void fire();
    }, wait);
  }

  async function fire(): Promise<void> {
    if (disposed || running) return;
    if (!deps.ready()) return;

    // 🔴 记住"这一趟推的是第几代"。结束时代数变了就说明**期间又有写入**，
    //    那一代必须再推一次 —— 否则它要等到下一次前台/写入才出去，
    //    而表现是"我明明刚改了，另一台设备上没有"，且完全不报错。
    const gen = writeGen;
    running = true;
    nextAllowedAt = deps.now() + MIN_GAP_MS;

    let settled = false;
    try {
      settled = await deps.sync();
    } catch (error) {
      // `sync()` 的契约是不抛（宿主会把可预期的失败表达成 SyncStatus），
      // 但真抛了也不能让 `running` 卡住 —— 那会让自动同步**永久停摆**。
      deps.onError?.(error);
    } finally {
      running = false;
    }

    if (settled) {
      // 只有"这一代是最后一代"才清。用 `writeGen > gen` 而不是 `dirty()`，
      // 因为 `syncedGen` 可能还落后于更早的代数。
      syncedGen = gen;
      if (disposed) return;
      // 🔴 期间又来了一次写入 → **必须**再推一次。这是本文件唯一会
      //    "静默丢一次写入"的分支：写成"结束时统一清 dirty"，
      //    那一代写入就要等到下一次前台/写入才出去，
      //    而表现是"我明明刚改了，另一台设备上没有"，且完全不报错。
      if (dirty() && deps.ready()) schedule(0);
      return;
    }

    // 没结算（离线 / 可重试的错）：保留 dirty，**但不自动重排** ——
    // 排了就会在离线时变成每 15 秒一次的热循环，而它并不能让网络恢复。
    // 等下一次前台 / 本地写入再来试（那时 `nextAllowedAt` 已把冷却算进去）。
    nextAllowedAt = deps.now() + FAILURE_BACKOFF_MS;
  }

  return {
    notifyLocalWrite(): void {
      if (disposed) return;
      writeGen += 1;
      if (!deps.ready()) return;
      schedule(WRITE_DEBOUNCE_MS);
    },

    notifyForeground(): void {
      if (disposed) return;
      // 前台**不做防抖**：用户切回来就是要看最新的，等一下没有意义。
      schedule(0);
    },

    notifyConfigured(): void {
      if (disposed) return;
      schedule(0);
    },

    dispose(): void {
      disposed = true;
      cancelTimer();
    },

    debugState(): { dirty: boolean; running: boolean; scheduled: boolean; writeGen: number } {
      return { dirty: dirty(), running, scheduled: scheduled(), writeGen };
    },
  };
}
