/**
 * 提醒的**投递路径** —— 到点了真的告诉用户
 * ===========================================
 *
 * ## 🔴 它补的是"最后一米"，而且是本仓最典型的那种
 *
 * 2026-09-29 实测：`apps/web/src/features/reminders/store.ts` 里
 * `due: Reminder[]`（注释写着"**已到点、还没投递的提醒**"）**已经被算出来并写进 state**，
 * 而**没有任何东西读它**（`ReminderPanel` 只读 `byTask` / `error` / 那几个 action）。
 *
 * 全仓也**一个 `new Notification(` 都没有**。⇒ 用户可以建提醒、提醒能同步、能到点，
 * 但**到点之后什么事都不会发生**。这就是 13 项幻觉复核里第 2 项
 *（"只有订阅，**没有显示路径**"）的真实形态。
 *
 * ## 为什么投递的是**本地提醒**而不是推送
 *
 * 推送载荷是**刻意无数据**的（`{"type":"heyta:widget-refresh"}`）——
 * 服务端解不开 E2EE 载荷，所以它**不可能**说"该交周报了"。
 * 而**本地提醒手里有真数据**（任务标题就在本机），所以它能说清楚。
 *
 * ⇒ 于是这里投递的是"应用**开着**的时候到点的提醒"。
 *
 * ## ⚠️ 如实写出的局限
 *
 * **应用没开就不会响。** 真正的后台提醒需要 Service Worker + 推送，
 * 而那条路与 E2EE 的"服务端不知道内容"直接冲突 —— 要做得先有一个
 * **不泄露内容**的唤醒协议（服务端只知道"某设备有 N 条待提醒"，内容由端上补全）。
 * 那是独立的一项工作，不是这里顺手能做的；**现在就假装它已经做了才是真问题**。
 *
 * ## 契约：**永不抛**
 *
 * 与 `theme.ts` / `push-subscribe.ts` 一致。通知是**增强**：
 * 权限被拒、浏览器不支持、构造失败 —— 都不该让应用出问题。
 * 而"投递失败"必须能被察觉（返回 `{delivered, reason}`），不能静默。
 */

import type { Reminder, Task } from '@heyta/domain';

/** 浏览器通知的最小接口（可注入，便于测试）。 */
export interface NotificationCtor {
  new (title: string, options?: { body?: string; tag?: string; silent?: boolean }): unknown;
  permission: NotificationPermission;
  requestPermission?: () => Promise<NotificationPermission>;
}

/** 能力探测：这台浏览器/这个上下文有没有通知。 */
export function notificationsSupported(
  ctor: NotificationCtor | undefined = globalThis.Notification as NotificationCtor | undefined,
): boolean {
  // ⚠️ `new Notification(...)` 在**非安全上下文**下直接抛（http:// 的自托管实例），
  // 所以只判 `typeof` 不够 —— 还要判 `permission` 属性在不在
  //（不在时构造会 TypeError，而那是"不支持"而不是"被拒"）。
  return typeof ctor === 'function' && typeof ctor.permission === 'string';
}

/** 当前权限。不支持时返回 `'denied'` —— 与"用户拒绝"同一个后果，调用方无需分支。 */
export function notificationPermission(
  ctor: NotificationCtor | undefined = globalThis.Notification as NotificationCtor | undefined,
): NotificationPermission {
  if (!notificationsSupported(ctor)) return 'denied';
  return ctor!.permission;
}

/**
 * 申请权限。
 *
 * 🔴 **只能在用户手势里调。** 浏览器会忽略（Chrome）或直接拒绝（Safari）
 * 非手势的 `requestPermission()` —— 而"页面加载时顺手申请一次"的写法
 * 表现成"用户从没看到过那个询问框，权限却已经是 denied"，**再也要不回来**。
 * 所以这里**不**在 effect 里自动调，只由按钮触发。
 */
export async function requestNotificationPermission(
  ctor: NotificationCtor | undefined = globalThis.Notification as NotificationCtor | undefined,
): Promise<NotificationPermission> {
  if (!notificationsSupported(ctor)) return 'denied';
  const request = ctor!.requestPermission;
  if (request === undefined) {
    // 老浏览器只有 `permission` 没有 `requestPermission`：按当前值处理。
    return ctor!.permission;
  }
  try {
    return await request.call(ctor);
  } catch {
    return 'denied';
  }
}

/** 一次投递的结果 —— **失败要说清为什么**，不能静默。 */
export interface DeliveryOutcome {
  /** 真的投出去几条。 */
  readonly delivered: number;
  /**
   * 真的投出去的**提醒 id**（`Reminder.id`，形如 `taskId:triggerAt`）。
   *
   * 🔴 调用方要用它把"已经弹过了"写成 `firedAt` op。只返回条数不够：
   * 内存里的 `shown` 集合只在**一次页面加载**内有效，刷新或换一台设备就会再弹
   * 一遍（缺陷 D14）—— 而"哪几条投过"这个信息只有这一层知道。
   */
  readonly deliveredIds: readonly string[];
  /** 没投的原因；`undefined` = 全部都投了（或本来就没有可投的）。 */
  readonly reason?: 'unsupported' | 'permission' | 'empty';
}

/** 投递时用到的文案（宿主注入 —— 本层不引 i18n，理由同 `SearchPanel`）。 */
export interface ReminderNotifyLabels {
  readonly title: string;
  /** 正文：任务标题。 */
  readonly body: (taskTitle: string) => string;
}

/**
 * 把到点的提醒投出去。
 *
 * ## 去重
 *
 * `shown` 是调用方持有的"已经投过"集合，键是 `Reminder.id`（形如 `taskId:triggerAt`）。
 * 🔴 **必须去重**：投递是由 store 变化驱动的，而 store 在每次 op 之后都会
 * 重新落一次 `due` —— 一个 10 分钟前到点的提醒会在用户接下来的每一次操作里
 * 被重新投一遍，表现成"通知栏被同一条刷屏"。
 *
 * ⚠️ `shown` 只在**内存**里 —— 它是"同一次页面加载内别刷屏"的那道门。
 * **跨刷新与跨设备的去重不落在这里**：调用方要把 `deliveredIds` 经
 * `markReminderFired` 写成提醒的 `firedAt` op（领域层判 `fired` 优先于 `due`），
 * 否则刷新一次、或另一台设备上线，同一条到点提醒会**再弹一遍**（缺陷 D14）。
 *
 * ## 纯的部分与不纯的部分
 *
 * 选哪几条、跳过哪几条、键怎么拼 —— **全是纯逻辑**（返回值可断言）；
 * 只有最后 `new Notification(...)` 那一下不纯。测试注入一个假的 ctor 即可全覆盖。
 */
export function deliverDueReminders(
  due: readonly Reminder[],
  tasks: Readonly<Record<string, Task>>,
  shown: Set<string>,
  labels: ReminderNotifyLabels,
  ctor: NotificationCtor | undefined = globalThis.Notification as NotificationCtor | undefined,
): DeliveryOutcome {
  if (due.length === 0) return { delivered: 0, deliveredIds: [], reason: 'empty' };
  if (!notificationsSupported(ctor)) return { delivered: 0, deliveredIds: [], reason: 'unsupported' };
  if (ctor!.permission !== 'granted') return { delivered: 0, deliveredIds: [], reason: 'permission' };

  const deliveredIds: string[] = [];
  for (const reminder of due) {
    if (shown.has(reminder.id)) continue;
    const task = tasks[reminder.taskId];
    // 🔴 **两道门，缺一不可。**
    // `task === undefined` 只挡"任务从来不在这张表里"；而**已软删除的任务在表里
    // 是存在的**（墓碑是一条记录，`deletedAt` 有值）—— 此前这里的注释写着
    // "这种情况不投"，而代码照投（缺陷 D1 的投递面那一半）。
    // 主修在动作层 `due()`（那里连"该不该算到点"一起判），这一道是**同一层内的
    // 第二道**：`tasks` 由调用方递进来，本函数不该假设递进来的表已经滤过。
    if (task === undefined || task.deletedAt !== undefined) continue;
    try {
      new ctor!(labels.title, {
        body: labels.body(task.title),
        // `tag` 用提醒 id：同一条提醒的重复投递在通知中心会**合并**而不是堆叠。
        tag: reminder.id,
      });
      shown.add(reminder.id);
      deliveredIds.push(reminder.id);
    } catch {
      // 构造失败（权限在两次检查之间被撤销、系统级静默…）——
      // 不中断其余几条，也**不**把这一条标记成已投（下次还会再试）。
    }
  }
  return deliveredIds.length > 0
    ? { delivered: deliveredIds.length, deliveredIds }
    : { delivered: 0, deliveredIds: [], reason: 'permission' };
}
