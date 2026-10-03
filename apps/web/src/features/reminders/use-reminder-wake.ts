/**
 * 提醒的**到点自醒**定时器（W9 ②）
 * ==================================
 *
 * ## 补的是哪个洞
 *
 * 投递路径是**订阅 `due`** 的（`use-reminder-notifications.ts`），而 `due` 只在
 * **引擎变化**时重算（`store.ts` 的 `refresh()` 挂在 `onEngineChange` 上）。
 * 于是：
 *
 *   用户 09:00 建了"09:30 提醒我" → 09:00:01 之后就**再没有任何事件** →
 *   09:30 那一刻没人去问一次"到点了没" → **通知不响**，而界面全绿。
 *
 * `App.tsx` 里唯一的周期 tick 是 `store.refreshNow()`（60 秒，喂"今天"视图的
 * `now`），它**不重算 `due`**。所以缺的不是"一个定时器"，缺的是
 * "**到点时去问一次那份唯一判据**"。
 *
 * ## 🔴 这个文件里没有、也永不会有的东西：第二份"算不算到点"
 *
 * 它只回答一个**排程**问题（"下一个要看的时刻是什么时候"，读
 * {@link reminderEffectiveAt}），醒来后做的事是 `store.recheck()` ——
 * 而 `recheck()` 里面只有一个调用：动作层的 `due()`，也就是领域层的
 * `dueReminders()`。判据、去重、投递全在原来那两处。
 *
 * 这条分界不是洁癖：如果这里写一句 `if (now >= triggerAt) notify()`，
 * 那么 snooze / fired / dismissed 三种优先关系就得在这里再实现一遍，
 * 漏一个的症状是"用户关掉的提醒到点又弹一次"，而且只在跨设备时出现。
 *
 * ## 三条实现约束（每条都对应一个会真实发生的坑）
 *
 * 1. **只排"严格在未来"的时刻**。已过点的提醒由 `recheck()` 处理，
 *    不能再排 —— 否则 `setTimeout(0)` 会立刻回来、再算、再排，
 *    变成一个**把主线程转死的空转循环**（这是这类定时器最经典的死法）。
 * 2. **单次最多睡 {@link MAX_WAKE_SLEEP_MS}**。两个理由：
 *    `setTimeout` 的 delay 超过 2³¹−1 毫秒（≈24.8 天）在浏览器里会**溢出**
 *    并**立即触发**（"提前 30 天"正好落在这一档）；而笔记本合盖时定时器
 *    根本不跑，分段睡让它开盖后很快补一次。
 * 3. **回到前台立刻补一次**。后台标签页的定时器被节流到分钟级甚至更久，
 *    `visibilitychange` 是给"用户切回来想看有没有漏"那一下的兜底。
 *
 * ⚠️ **仍然如实写出的局限**：应用**关掉**（进程没了）不会响。那需要
 * Service Worker + 推送，而推送载荷在 E2EE 下必须不含内容 —— 见
 * `notify.ts` 文件头。这条不是这里能补的，**假装补上了才是问题**。
 */

import { useEffect } from 'react';
import { reminderEffectiveAt, type Reminder } from '@heyta/domain';

import { useReminderStore } from './store.js';

/**
 * 一次最多睡多久（6 小时）。
 *
 * 🔴 推导而不是抄来的数字：必须**小于** `setTimeout` 的 2³¹−1 ms（≈24.85 天）
 * 上限，否则"提前 30 天"这一档的 delay 会溢出成立即触发；同时要让合盖之后再打开
 * 的笔记本尽快补一次。判据 `reminder-wake.spec.tsx` 拿 `30 * DAY` 与它对着算。
 */
export const MAX_WAKE_SLEEP_MS = 6 * 60 * 60 * 1000;

/** 浏览器 `setTimeout` 的 delay 上限（约 24.85 天）。超过它会**立即触发**。 */
export const TIMER_OVERFLOW_MS = 2_147_483_647;

/**
 * 下一个**该看的时刻**：所有存活提醒里严格晚于 `at` 的最早有效触发时刻。
 *
 * 读的是 {@link reminderEffectiveAt}（含 snooze 的那一个），不是 `triggerAt` ——
 * 但**这只是排程**：它不产出通知，也不决定"到没到点"。
 * 已投递 / 已关闭的提醒也会参与排程（多醒一次、`recheck()` 得到空集合），
 * 因为在这里判 `firedAt` 就等于把领域层那份顺序又抄了一遍。
 *
 * `undefined` = 没有任何未来触发点 ⇒ **完全不排定时器**（不是排一个远的）。
 */
export function nextReminderWakeAt(
  byTask: Readonly<Record<string, readonly Reminder[]>>,
  at: number,
): number | undefined {
  let next: number | undefined;
  for (const list of Object.values(byTask)) {
    for (const reminder of list) {
      const effectiveAt = reminderEffectiveAt(reminder);
      if (effectiveAt <= at) continue; // 已过点的交给 recheck()，不排（防空转）
      if (next === undefined || effectiveAt < next) next = effectiveAt;
    }
  }
  return next;
}

/**
 * 挂上"到点自己醒"的定时器。
 *
 * 没有参数、不返回东西、**不投递任何通知** —— 它唯一做的事是在该醒的时刻
 * 调一次 `useReminderStore.getState().recheck()`，剩下全部交给既有的
 * `due` 订阅链（`use-reminder-notifications.ts` → `deliverDueReminders`）。
 *
 * 🔴 挂载点：由 `useReminderNotifications()` 自己调（那个 hook 已经挂在
 * `App.tsx` 的根组件上），所以**不需要动 `App.tsx`**。提醒的"什么时候醒"
 * 与"醒了投给谁"因此在同一个子树里，不会出现一处挂了另一处没挂。
 */
export function useReminderWakeTimer(): void {
  // ⚠️ 取整个 `byTask` 对象作为"提醒列表变了没有"的信号（建/删/改期/顺延都会
  //    换引用）；它只用来**重新排程**，不用来判断到点。
  const byTask = useReminderStore((s) => s.byTask);

  useEffect(() => {
    let timer: number | undefined;
    let stopped = false;

    const arm = (): void => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
      if (stopped) return;
      // 🔴 每次都从 store 现读，不用闭包里那份 `byTask`：`recheck()` 之后
      //    数据没变、effect 不会重跑，而排程必须按**当下**的 snooze 重算。
      const at = Date.now();
      const wake = nextReminderWakeAt(useReminderStore.getState().byTask, at);
      if (wake === undefined) return;
      const delay = Math.min(wake - at, MAX_WAKE_SLEEP_MS);
      timer = window.setTimeout(() => {
        timer = undefined;
        useReminderStore.getState().recheck();
        arm(); // 醒来后接着排下一次（这一次睡过去可能是 6 小时，也可能马上就是下一条）
      }, delay);
    };

    arm();

    // 后台标签页的定时器被节流（Chrome 可到分钟级、系统休眠期间干脆不跑）。
    // 切回前台这一瞬间补一次：先问一遍到点没，再重新排程。
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      useReminderStore.getState().recheck();
      arm();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [byTask]);
}
