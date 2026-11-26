/**
 * 通知的**行为默认值**（纯函数，零文案）
 * =====================================
 *
 * 覆盖图谱 #57：「提醒与通知」缺的那一半 —— 权限 / 共享 / 小组件已经在，
 * 缺的是**新建任务 / 新提醒时的初值**（滴答把这一族叫「行为默认值」：
 * 改的不是"看起来怎样"，而是"默认发生什么"）。
 *
 * ## 为什么住在这里
 *
 * "有哪几个默认值、取值范围、越界怎么回落"是产品语义 —— 四端必须一致；
 * "这台设备上选了哪个值"是**本机偏好**（与 `modules.ts` / `smart-list.ts` 同一条：
 * 不进 op-log，因为同一份数据同步到另一台设备，默认提醒不该跟着跳）。
 *
 * 所以词表与归一在这里，存储与渲染在壳里。
 *
 * ## 归一规则
 *
 * 读的是 localStorage 里的 `unknown`（旧版本写过的、手改过的都可能）。类型运行时不存在，
 * 所以每个字段都要过一遍：认不出的值回落默认，不抛、不把坏值带进界面。
 */

/** 有时间的任务默认提前多少分钟提醒。`0` = 到点提醒。 */
export const REMINDER_LEAD_MINUTES_OPTIONS = [0, 5, 10, 15, 30, 60] as const;
export type ReminderLeadMinutes = (typeof REMINDER_LEAD_MINUTES_OPTIONS)[number];

/** 全天任务的默认提醒时机。 */
export const ALL_DAY_REMINDER_OPTIONS = ['none', 'sameDay', 'dayBefore'] as const;
export type AllDayReminder = (typeof ALL_DAY_REMINDER_OPTIONS)[number];

export interface NotificationDefaults {
  readonly leadMinutes: ReminderLeadMinutes;
  readonly allDayReminder: AllDayReminder;
  /** 完成一个任务时是否响一声。 */
  readonly completionSound: boolean;
  /** 通知里是否显示任务标题等详情。 */
  readonly showDetail: boolean;
}

/** 默认：提前 10 分钟、全天任务当天提醒、有完成音、显示详情。 */
export const DEFAULT_NOTIFICATION_DEFAULTS: NotificationDefaults = {
  leadMinutes: 10,
  allDayReminder: 'sameDay',
  completionSound: true,
  showDetail: true,
};

function isLeadMinutes(value: unknown): value is ReminderLeadMinutes {
  return (
    typeof value === 'number' &&
    (REMINDER_LEAD_MINUTES_OPTIONS as readonly number[]).includes(value)
  );
}

function isAllDayReminder(value: unknown): value is AllDayReminder {
  return (
    typeof value === 'string' &&
    (ALL_DAY_REMINDER_OPTIONS as readonly string[]).includes(value)
  );
}

/** 把任意持久化值归一成合法的 `NotificationDefaults`（逐字段回落，永不抛）。 */
export function normalizeNotificationDefaults(value: unknown): NotificationDefaults {
  if (value === null || typeof value !== 'object') return DEFAULT_NOTIFICATION_DEFAULTS;
  const raw = value as Record<string, unknown>;
  return {
    leadMinutes: isLeadMinutes(raw.leadMinutes)
      ? raw.leadMinutes
      : DEFAULT_NOTIFICATION_DEFAULTS.leadMinutes,
    allDayReminder: isAllDayReminder(raw.allDayReminder)
      ? raw.allDayReminder
      : DEFAULT_NOTIFICATION_DEFAULTS.allDayReminder,
    completionSound:
      typeof raw.completionSound === 'boolean'
        ? raw.completionSound
        : DEFAULT_NOTIFICATION_DEFAULTS.completionSound,
    showDetail:
      typeof raw.showDetail === 'boolean'
        ? raw.showDetail
        : DEFAULT_NOTIFICATION_DEFAULTS.showDetail,
  };
}
