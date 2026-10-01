/**
 * 滚轮翻月的**判据**（纯函数，不碰 DOM）
 * ======================================
 *
 * 产品负责人 2026-10-01：「日历做成类似这样的，上下滑动自由无限切换日历」，
 * 并明确交互模型 = **滚轮切月**。
 *
 * 先例不是凭空发明的：macOS 「日历」在"通用"设置里就有一条"使用滚动滚轮来更改
 * 月份"，行为是**指针停在月历网格上时，滚轮归月历所有**（上滚 = 上一月，
 * 下滚 = 下一月），页面不跟着滚。这里采同一套语义。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么"一格滚轮 = 一个月"要先归一化，而不是直接看 `deltaY`
 *
 * `WheelEvent.deltaMode` 三种取值给的是**不同单位**：
 *
 * | 设备 / 浏览器 | deltaMode | 一格的 deltaY |
 * |---|---|---|
 * | Chrome / Safari 鼠标滚轮 | 0（像素） | ±100 上下 |
 * | Firefox 鼠标滚轮 | 1（行） | ±3 |
 * | 触控板 | 0（像素） | ±1…20，一次手势几十条 |
 *
 * 拿 `deltaY > 0` 直接翻月，在 Firefox 上一格会翻**三次**（它一格报 3 行，
 * 每行都满足条件），而触控板一次轻扫会翻**十几屏**。所以先折算成像素，
 * 再用"一格"这个阈值卡住 —— 阈值不是随手写的数：
 * `LINE_PX × LINES_PER_NOTCH` 恰好等于 Firefox 一格的量，
 * 于是"一格 = 一个月"在两种单位下是同一件事。
 *
 * ⚠️ 阈值卡的是**单次事件**，卡不住惯性：手指离开触控板后浏览器还会继续派发
 * 一串递减的事件。所以翻完必须锁一小段时间（`WHEEL_MONTH_LOCK_MS`），
 * 否则症状是"轻轻一推，日历飞过去八个月"。
 *
 * ⚠️ 方向（下滚 = 未来）写反**不会**有任何报错 —— 界面照样翻月，只是每次翻反。
 * 判据必须钉住"下滚之后月份 +1"，不能只钉"月份变了"。
 */

/** 行模式下**一行**折算多少像素（与浏览器默认行高同量级）。 */
const LINE_PX = 16;

/** 行模式下**一格滚轮**的行数（CSSOM View 规范的默认滚动步长；Firefox 一格就报这个数）。 */
const LINES_PER_NOTCH = 3;

/** 页模式（少数触屏浏览器）下**一页**折算多少像素。 */
const PAGE_PX = 400;

/**
 * 翻一个月需要的累计量 = **一格滚轮**。
 *
 * 🔴 由 `LINE_PX × LINES_PER_NOTCH` 推导，不写字面量 —— 否则改了行高，
 * Chrome（像素模式）与 Firefox（行模式）会**一个还灵、一个失灵**。
 */
export const WHEEL_MONTH_NOTCH_PX = LINE_PX * LINES_PER_NOTCH;

/** 翻完一个月后锁定的时长（毫秒），用来吃掉触控板惯性尾巴。 */
export const WHEEL_MONTH_LOCK_MS = 220;

/** 跨事件累计量。放在外面由调用方持有，本文件不存任何全局状态。 */
export interface WheelAccumulator {
  /** 已累计的归一化像素，**带符号**（正 = 向下 = 未来）。 */
  readonly acc: number;
  /** 在此之前不再翻月（`Date.now()` 量纲）。 */
  readonly lockedUntil: number;
}

export const IDLE_WHEEL_ACCUMULATOR: WheelAccumulator = { acc: 0, lockedUntil: 0 };

/** 从真实事件里取的那几个字段（拆开传是为了这个文件在 jsdom 之外也能测）。 */
export interface WheelSignal {
  readonly deltaY: number;
  readonly deltaX: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

export interface WheelMonthStep {
  /** `-1` 上一月 / `0` 不动 / `1` 下一月。 */
  readonly step: -1 | 0 | 1;
  /**
   * 这个事件是否**归月历所有**（调用方据此 `preventDefault`）。
   *
   * 🔴 与 `step` 是两件事：累计中（还没到一格）也得吃掉，否则用户看到的是
   * "滚一下，日历翻了一格**同时页面也滚走了**"。反过来，缩放手势与横向手势
   * 一律不吃 —— 那是浏览器/别人的手势。
   */
  readonly consume: boolean;
  readonly accumulator: WheelAccumulator;
}

/** 把三种 `deltaMode` 折成同一种量（像素）。 */
function toPixels(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY * LINE_PX;
  if (deltaMode === 2) return deltaY * PAGE_PX;
  return deltaY;
}

/**
 * 一次滚轮事件 → 要不要翻月、翻几、吃不吃掉。
 *
 * `now` 显式传入（与领域层"判据函数不在函数里读时钟"同一条纪律）：
 * 锁定窗口是可测的，读时钟就不可测了。
 */
export function readWheelMonth(
  signal: WheelSignal,
  previous: WheelAccumulator,
  now: number,
): WheelMonthStep {
  // ① Ctrl/⌘ + 滚轮 = 浏览器缩放。不吃、不清累计，让浏览器自己处理。
  if (signal.ctrlKey || signal.metaKey) {
    return { step: 0, consume: false, accumulator: IDLE_WHEEL_ACCUMULATOR };
  }
  // ② 横向手势（触控板两指横滑）不属于"上下滑动切月"，整条让出去。
  if (Math.abs(signal.deltaX) > Math.abs(signal.deltaY)) {
    return { step: 0, consume: false, accumulator: { ...previous, acc: 0 } };
  }

  const pixels = toPixels(signal.deltaY, signal.deltaMode);
  if (pixels === 0) return { step: 0, consume: false, accumulator: previous };

  // ③ 反向就重新起算：先下滚 40 又上滚 40，不该翻成"下滚 80"。
  const sameDirection = previous.acc === 0 || Math.sign(previous.acc) === Math.sign(pixels);
  const acc = sameDirection ? previous.acc + pixels : pixels;

  // ④ 锁定窗口内：吃掉事件但丢掉累计量（惯性尾巴不许排队成下一次翻月）。
  if (now < previous.lockedUntil) {
    return { step: 0, consume: true, accumulator: { acc: 0, lockedUntil: previous.lockedUntil } };
  }

  if (Math.abs(acc) >= WHEEL_MONTH_NOTCH_PX) {
    return {
      step: acc > 0 ? 1 : -1,
      consume: true,
      accumulator: { acc: 0, lockedUntil: now + WHEEL_MONTH_LOCK_MS },
    };
  }

  return { step: 0, consume: true, accumulator: { acc, lockedUntil: previous.lockedUntil } };
}
