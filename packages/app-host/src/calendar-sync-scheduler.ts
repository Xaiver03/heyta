/**
 * 外部日历自动同步的**纯调度判断**（宿主无关）
 * =============================================
 *
 * 本文件**只回答一个问题**：「现在这一个时刻，该不该自动去拉一次 Hub？」
 * 它不建定时器、不碰 DOM、不读 META —— 那三件都是壳的事。
 *
 * ## 为什么判断要与调度分开
 *
 * 定时器/事件（`visibilitychange` / `focus` / `setInterval`）是**平台差异**：
 * 标签页会被节流、移动端会被挂起、桌面端窗口可能一整天在前台。这些差异只该待在
 * `apps/web` 这一层的浏览器接线里（AGENTS §3.5）。
 *
 * 而「多久算该同步一次」是**产品语义**：它与具体是哪个事件触发无关，只与
 * 「上次成功同步到现在过了多久」有关。把它写成纯函数，四个壳才有可能给出
 * **完全一致**的节流行为 —— 否则每端各写一个 `now - lastSync > ???`，
 * 那堆阈值迟早各漂各的，而漂移在界面上表现为"这台设备总是不更新。
 *
 * `calendar-mirror.ts` 文件头那条「本模块不建内部定时器」的硬约束在这里继续成立：
 * 本模块连 `setTimeout` 都不 import。
 */

/** 自动同步的最小间隔：5 分钟。间隔短于它的一律不自动同步（手动同步不受此限）。 */
export const CALENDAR_AUTO_SYNC_MIN_INTERVAL_MS = 5 * 60_000;

export interface ShouldAutoSyncInput {
  /** 上次成功同步的本地毫秒时间戳；`undefined` = 从未同步过。 */
  readonly lastSyncMs: number | undefined;
  /** 当前时刻的本地毫秒时间戳。 */
  readonly nowMs: number;
  /** 覆盖最小间隔（默认 {@link CALENDAR_AUTO_SYNC_MIN_INTERVAL_MS}）。 */
  readonly minIntervalMs?: number;
}

/**
 * 该不该自动同步。
 *
 * 判定顺序（每条都对应一种被实测排过的"静默不更新"）：
 *
 * 1. **从未同步过** ⇒ `true`。第一次挂载就该拉一次，否则用户配完 Hub 得等五分钟
 *    或手动点一次才看得见日程。
 * 2. **`lastSyncMs` 非法 / 非正** ⇒ 当作从未同步。`0`、负数、`NaN` 都不是"很久以前"，
 *    而是"没有有效记录"，按从未同步处理最不容易把日历判死。
 * 3. **`lastSyncMs` 在将来**（`nowMs < lastSyncMs`，时钟回拨）⇒ `false`。
 *    保守不动：一台时钟被调回去的机器若判定"该同步"，会在回拨后的每一轮都触发一次，
 *    把一次时间错误放大成持续的请求风暴；等它的钟追上来再自动同步即可。
 * 4. 距上次 **≥ 阈值**（含等于）⇒ `true`；否则 `false`。
 */
export function shouldAutoSync(input: ShouldAutoSyncInput): boolean {
  const { lastSyncMs, nowMs } = input;
  const minIntervalMs = input.minIntervalMs ?? CALENDAR_AUTO_SYNC_MIN_INTERVAL_MS;

  if (lastSyncMs === undefined || !Number.isFinite(lastSyncMs) || lastSyncMs <= 0) {
    return true;
  }

  const elapsed = nowMs - lastSyncMs;
  if (elapsed < 0) return false;
  return elapsed >= minIntervalMs;
}
