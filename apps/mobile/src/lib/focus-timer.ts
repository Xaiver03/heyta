/**
 * 专注计时器（移动端粘合层）
 * ============================
 *
 * 🔴 **这里没有任何业务判断。** 状态机（开始/暂停/恢复/推进/中止）、
 * "哪一段该落盘"、"一次专注该写哪些字段"，全部来自：
 *
 *   - `@heyta/domain` 的 `focus.ts` —— 纯状态机与统计
 *   - `@heyta/app-host` 的 `createFocusActions` —— op 的构造（唯一写入口）
 *
 * 这里只做三件事，全是平台/UI 粘合：
 *   1. **按真实时间触发重绘**（`setInterval` 只负责唤醒，倒计时由 `remainingMs` 重算）
 *   2. 把到时的段落交给 `createFocusActions().log()` 落盘
 *   3. 让 React 订阅这个模块级单例
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么是**模块级单例**而不是组件内 `useState`：
 *
 * 移动端的标签栏（`App.tsx`）是**条件渲染** —— 切到「任务」时 `FocusScreen`
 * 会被卸载。计时状态放组件里，用户去「任务」看一眼再切回来，番茄钟就归零了。
 * 这是"计时器能日常用"的底线，不是锦上添花。
 *
 * 为什么不用 zustand（Web 端用的是它）：Web 那份 store 的存在理由之一是
 * 它有跨 feature 的订阅需求；这里只有一个订阅者、一个状态对象。
 * `useSyncExternalStore` 是 React 内置的订阅原语，为这一个 store
 * 引一个状态库到移动端 bundle 不划算（且新依赖要过两道门并逐项登记）。
 * **这不是重复造轮子** —— 它没有重新实现任何状态机，只做订阅转发。
 * ─────────────────────────────────────────────────────────────────────────
 */

import { useSyncExternalStore } from 'react';

import {
  DEFAULT_FOCUS_CONFIG,
  abort as abortFn,
  advance,
  clearTask,
  focusDisplayMs,
  initialFocusState,
  isFinished,
  pause as pauseFn,
  resume as resumeFn,
  selectKind,
  shouldPersistSession,
  start as startFn,
  type FocusConfig,
  type FocusSession,
  type FocusSessionKind,
  type FocusState,
} from '@heyta/domain';
import { createFocusActions } from '@heyta/app-host';

import { openTaskHost } from '../db/open-host';

/**
 * 重绘节拍（ms）。
 *
 * 250 而不是 1000：这是**唤醒**节拍，不是**重绘**节拍（见 `publish`）。
 * 若按 1 秒唤醒，定时器抖动会让「还剩 1 秒」偶尔整秒跳过去；
 * 4 次/秒唤醒 + 只在显示秒变化时重绘，既不会跳秒，也不会白重绘。
 */
const TICK_MS = 250;

export interface FocusTimerSnapshot {
  state: FocusState;
  /** 最近一次唤醒的时刻。值本身无意义，只用于让组件重算剩余时间。 */
  now: number;
  /** 落盘失败时的错误。**必须显式暴露**，不能静默吞掉。 */
  error?: string;
  /**
   * 最近一次**成功落盘**的时刻。
   *
   * 有了它，订阅者才能确定地知道"现在该去重新读一遍专注记录"，
   * 而不必靠轮询或猜。没有它的话，界面上的"今天专注了 3 段"会在
   * 用户放弃一轮之后仍然显示旧值 —— 看起来像记录没保存。
   */
  savedAt?: number;
}

let snapshot: FocusTimerSnapshot = { state: initialFocusState(), now: Date.now() };
const listeners = new Set<() => void>();
let tickHandle: ReturnType<typeof setInterval> | undefined;

/** 防重入：落盘是异步的，定时器可能在它完成前再触发一次。 */
let persisting = false;

/**
 * 上一次**已经发布出去**的显示秒。
 *
 * 🔴 只用来做一件事：**抑制重复重绘**。
 *
 * 定时器 250ms 唤醒一次，但界面显示的是 `MM:SS` —— 也就是说
 * **4 次唤醒里有 3 次算出的是和上一帧完全一样的画面**。原来的实现每次都
 * `publish({ now })`，等于每秒让 React 重绘 4 次、每秒抛出 4 次无障碍事件。
 *
 * 代价是实测出来的，不是推测：真机验收脚本靠 `uiautomator dump` 读界面，
 * 而它需要**等界面空闲**才能取到快照。计时器运行中实测 **8 次只有 1 次成功**；
 * 点一下「暂停」让重绘停下来，立刻 **8 次全部成功**。
 * 对读屏软件来说是同一件事：一个纯数字的倒计时每秒播报 4 次。
 *
 * 所以这是**可访问性 + 性能**的修复（UIX Pro 优先级 1、3 高于动画的 7），
 * 不是为了让测试变绿：显示出来的秒数一个都没少，重绘次数降到 1/4。
 */
let lastPublishedSecond: number | undefined;

/** 界面此刻显示的秒数（`ceil` —— 与 `formatDuration` 的显示口径一致）。 */
function displayedSecond(state: FocusState, now: number): number {
  return Math.ceil(focusDisplayMs(state, now) / 1000);
}

function publish(patch: Partial<FocusTimerSnapshot>): void {
  // 🔴 必须是**新对象**。`useSyncExternalStore` 用引用相等判断是否需要重绘，
  // 原地改字段会让 React 认为"没变"，界面就永远不动。
  snapshot = { ...snapshot, ...patch };
  lastPublishedSecond = displayedSecond(snapshot.state, snapshot.now);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): FocusTimerSnapshot {
  return snapshot;
}

/** 订阅计时器状态。组件只在需要显示倒计时的地方用它。 */
export function useFocusTimer(): FocusTimerSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** 当前配置。界面要用它显示"这一轮多长"。 */
export const FOCUS_CONFIG: FocusConfig = DEFAULT_FOCUS_CONFIG;

// ─────────────────────────────────────────────────────────────
// 落盘
// ─────────────────────────────────────────────────────────────

/** 把一段已结束的专注写进 op-log。失败必须让用户看见。 */
async function persist(session: FocusSession): Promise<void> {
  if (persisting) return;
  persisting = true;
  try {
    const host = await openTaskHost();
    await createFocusActions(host).log(session);
    publish({ error: undefined, savedAt: Date.now() });
  } catch (error: unknown) {
    // 🔴 必须捕获。这段代码在**定时器回调**里跑，未捕获的拒绝在 RN 上
    // 会变成 unhandledRejection —— 存储故障不该让应用崩掉，但也不能静默。
    publish({
      error: `专注记录保存失败：${error instanceof Error ? error.message : String(error)}`,
    });
  } finally {
    persisting = false;
  }
}

/** 定时器唤醒：要么只是重绘，要么推进到下一轮并落盘。 */
async function onTick(): Promise<void> {
  const now = Date.now();
  const current = snapshot.state;

  if (!isFinished(current, now)) {
    // 🔴 只在**显示出来的秒数真的变了**的时候才发布 —— 见 `lastPublishedSecond`。
    // 语义完全不变（倒计时本来就只有秒），但重绘从 4 次/秒降到 1 次/秒。
    if (displayedSecond(current, now) === lastPublishedSecond) return;
    publish({ now });
    return;
  }

  // 到时了：推进状态。`advance()` 已经算好下一轮类型与已完成轮数，
  // **不要自己再判一次**（Web 端第一版就重复判过，见其注释）。
  const { next, finished } = advance(current, now, FOCUS_CONFIG);
  stopTicking();
  publish({ state: next, now });

  if (finished === null) return;
  // 休息不落盘 —— 这条判断在领域层，不在这里（AGENTS.md §3.5）。
  if (!shouldPersistSession(finished)) return;

  await persist(finished);
}

function startTicking(): void {
  if (tickHandle !== undefined) return;
  tickHandle = setInterval(() => {
    void onTick();
  }, TICK_MS);
}

function stopTicking(): void {
  if (tickHandle === undefined) return;
  clearInterval(tickHandle);
  tickHandle = undefined;
}

// ─────────────────────────────────────────────────────────────
// 用户动作（全部委托给领域层）
// ─────────────────────────────────────────────────────────────

/** 开始一轮。`taskId` 可选 —— 允许无任务的纯计时。 */
export function startFocus(taskId?: string): void {
  publish({ state: startFn(snapshot.state, Date.now(), FOCUS_CONFIG, taskId), now: Date.now() });
  startTicking();
}

export function pauseFocus(): void {
  publish({ state: pauseFn(snapshot.state, Date.now()), now: Date.now() });
  // 暂停后不需要唤醒：剩余时间已经冻在 `remainingMsOnPause` 里，是常量。
  stopTicking();
}

export function resumeFocus(): void {
  publish({ state: resumeFn(snapshot.state, Date.now(), FOCUS_CONFIG), now: Date.now() });
  startTicking();
}

/**
 * 中止当前轮并落盘（记为**未**自然完成）。
 *
 * 未捕获拒绝的另一半：`abort()` 是从按钮回调里调的，异常会冒到 React 事件里 ——
 * 同样必须自己接住并展示，而不是让界面看起来"点了没反应"。
 */
export async function abortFocus(): Promise<void> {
  const { next, finished } = abortFn(snapshot.state, Date.now());
  stopTicking();
  publish({ state: next, now: Date.now() });

  // idle 时中止不产生记录。
  if (finished === null) return;
  if (!shouldPersistSession(finished)) return;
  await persist(finished);
}

/** 换下一轮的类型。只在 idle 时生效（领域层负责这条约束）。 */
export function selectFocusKind(kind: FocusSessionKind): void {
  // 不能在界面里自己查"短休息多少分钟" —— 那是配置语义，领域层已经有映射。
  publish({ state: selectKind(snapshot.state, kind, FOCUS_CONFIG) });
}

/** 清除关联任务。只在 idle 时生效（领域层负责这条约束）。 */
export function clearFocusTask(): void {
  publish({ state: clearTask(snapshot.state), now: Date.now() });
}

/** 仅供测试：停表并复位。 */
export function __resetFocusTimerForTests(): void {
  stopTicking();
  persisting = false;
  // 也要清掉"上次发布的显示秒" —— 留着它会让复位后的第一帧被判成"没变"而不重绘。
  lastPublishedSecond = undefined;
  snapshot = { state: initialFocusState(), now: Date.now() };
}
