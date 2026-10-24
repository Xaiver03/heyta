/**
 * 前台（in-process）提醒投递 —— 应用开着的时候到点就弹
 * =====================================================
 *
 * ## 为什么需要第二条投递路，而不是让桌面壳去实现 `ReminderDeliveryPort`
 *
 * `reminder-delivery.ts` 谈的是**排程模型**：JS 把"未来某一刻要提醒"交给操作系统
 * 的调度器（Android `AlarmManager`、iOS `UNUserNotificationCenter`），到点由系统
 * 唤醒，JS 事后回收据。桌面四端里只有 macOS 有等价的本地调度器；
 * Windows/Linux/Electron 没有"把一条本地通知排到系统里"的公开能力，
 * 它们的现实模型是**应用常驻 + 自己掐表**。
 *
 * 于是这里放的是那条掐表路，而**业务判定一行都不复制**：
 * 哪条算到点用领域层的 `due()`（含墓碑任务那道门），
 * 回执仍只经 `reminder-actions.ts` 的 `markReminderFired` 写 —— 全仓 `firedAt`
 * 只有那一个写入点，本文件不新增第二个。
 *
 * ## 与排程路共享的两条纪律
 *
 * 1. **投递成功才记账**：`show()` 返回 false（系统拒投、权限在两次检查之间被撤回）
 *    时既不写 `firedAt` 也不进 `shown`，下一轮还会再试。
 * 2. **回执带发生时刻**：`markReminderFired(id, reminderEffectiveAt(reminder))`，
 *    排在前面的一次改期会让这条回执作废，而不是把新时刻误标成已投。
 *
 * ## 局限（如实写出，不假装）
 *
 * 进程退出后不会响。桌面端要"关了也响"需要各系统的常驻调度，那是另一件事；
 * 这里只承诺"开着就响"，与 Web 端同一口径。
 */

import { reminderEffectiveAt, type Reminder, type Task } from '@heyta/domain';

import type { AppHost } from './host.js';
import { createReminderActions } from './reminder-actions.js';
import type { ReminderAuthorization } from './reminder-delivery.js';
import { planNativeReminders } from './reminder-scheduler.js';

/** 操作系统通知中心的最小能力面：怎么弹、能不能弹。业务判定不归它。 */
export interface ReminderForegroundPort {
  authorizationStatus(): Promise<ReminderAuthorization>;
  /**
   * 可选：**只在 `authorizationStatus()` 报 `default`（从没问过）时被调用**，
   * 也就是本机已经有待投递提醒、用户正在用这个功能的那一刻。
   * 不在启动时问，也不在没东西可投时问 —— 这条边界是刻意的，
   * 国内认定方法与 Apple/Google 的指南在这一点上是同一个方向。
   */
  requestAuthorization?(): Promise<ReminderAuthorization>;
  show(request: {
    readonly occurrenceId: string;
    readonly title: string;
    readonly body: string;
  }): Promise<boolean>;
  /** 引导用户去系统设置里放行通知；不支持的端可以不给。 */
  openSettings?(): Promise<boolean>;
}

/** 投递时用到的文案由宿主注入 —— 本层不引 i18n（理由同 Web 的 `notify.ts`）。 */
export interface ForegroundReminderLabels {
  readonly title: string;
  readonly body: (taskTitle: string) => string;
}

export interface ForegroundDeliveryResult {
  /** 真的弹出去的提醒 id；调用方不需要再写回执，本层已经写了 `firedAt`。 */
  readonly delivered: readonly string[];
  readonly reason?: 'empty' | 'permission' | 'unsupported' | 'failed';
}

/** 单次最多睡这么久：定时器溢出与"睡眠期间定时器根本不跑"两个理由都在这里。 */
export const MAX_WAKE_SLEEP_MS = 6 * 60 * 60 * 1000;

/**
 * 把此刻到点、还没投的提醒弹出去。
 *
 * `shown` 是调用方持有的内存去重，只挡"同一次运行里 `firedAt` 落库之前别刷屏"；
 * 跨重启与跨设备的去重靠写进同步事实的 `firedAt`，不落在这一层。
 */
export async function deliverForegroundReminders(
  host: AppHost,
  port: ReminderForegroundPort,
  options: {
    labels: ForegroundReminderLabels;
    now?: () => number;
    shown?: Set<string>;
  },
): Promise<ForegroundDeliveryResult> {
  const now = options.now ?? Date.now;
  const shown = options.shown ?? new Set<string>();
  const actions = createReminderActions(host, { now });
  const tasks = host.getState().tasks as Record<string, Task>;

  const due = actions.due().filter((reminder) => !shown.has(reminder.id));
  if (due.length === 0) return { delivered: [], reason: 'empty' };

  let permission = await port.authorizationStatus();
  // 此刻确实有一条要投（用户已经在用这个功能），才允许把"从没问过"升级成系统询问。
  if (permission === 'default' && port.requestAuthorization !== undefined) {
    permission = await port.requestAuthorization();
  }
  if (permission !== 'granted') {
    return { delivered: [], reason: permission === 'unsupported' ? 'unsupported' : 'permission' };
  }

  const delivered: string[] = [];
  for (const reminder of due) {
    const task = tasks[reminder.taskId];
    // `due()` 已经滤过墓碑，这里拿不到任务只可能是任务表还没加载齐 —— 不猜标题，跳过。
    if (task === undefined) continue;
    const triggerAt = reminderEffectiveAt(reminder);
    const showed = await port.show({
      occurrenceId: `${reminder.id}|${triggerAt}`,
      title: options.labels.title,
      body: options.labels.body(task.title),
    });
    if (!showed) continue;
    shown.add(reminder.id);
    delivered.push(reminder.id);
    await actions.markReminderFired(reminder.id, triggerAt);
  }

  return delivered.length > 0 ? { delivered } : { delivered: [], reason: 'failed' };
}

export interface ForegroundReminderLoopOptions {
  labels: ForegroundReminderLabels;
  now?: () => number;
  /** 注入定时器，便于测试；返回取消函数。默认用 `setTimeout`。 */
  sleep?: (delayMs: number, fire: () => void) => () => void;
  /** 每一轮投递的结果回调 —— 界面的"未授权，到点不会响"状态靠它更新。 */
  onDelivery?: (result: ForegroundDeliveryResult) => void;
  onError?: (error: unknown) => void;
}

/**
 * 挂上"到点自己醒"的循环，并在每次投递后接着排下一次。
 *
 * 返回取消函数。提醒集合在循环里从 `planNativeReminders` 取**下一个未来时刻**
 * （已过点的交给投递本身，不排，防空转），所以改期/顺延后最多多睡一次就被纠正，
 * 不需要调用方在每次写 op 后手动重排。
 */
export function startForegroundReminderLoop(
  host: AppHost,
  port: ReminderForegroundPort,
  options: ForegroundReminderLoopOptions,
): () => void {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((delay, fire) => { const t = setTimeout(fire, delay); return () => clearTimeout(t); });
  const shown = new Set<string>();
  let cancelTimer: (() => void) | undefined;
  let stopped = false;

  const deliver = (): Promise<ForegroundDeliveryResult> =>
    deliverForegroundReminders(host, port, { labels: options.labels, now, shown });

  const arm = (): void => {
    if (stopped) return;
    const at = now();
    const reminders = Object.values(host.getState().reminders) as Reminder[];
    const tasks = host.getState().tasks as Record<string, Task>;
    const next = planNativeReminders(reminders, tasks, at)
      .map((plan) => Number(plan.occurrenceId.slice(plan.occurrenceId.lastIndexOf('|') + 1)))
      .find((effectiveAt) => effectiveAt > at);
    if (next === undefined) return;
    cancelTimer = sleep(Math.min(next - at, MAX_WAKE_SLEEP_MS), () => {
      void deliver().then((result) => options.onDelivery?.(result)).catch((error) => options.onError?.(error)).then(arm);
    });
  };

  void deliver().then((result) => options.onDelivery?.(result)).catch((error) => options.onError?.(error)).then(arm);

  return () => {
    stopped = true;
    cancelTimer?.();
  };
}
