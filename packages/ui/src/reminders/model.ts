/**
 * 提醒列表（共享模型）
 * ======================
 *
 * M3 第十刀（reminders / notes 同一刀）的**判断层**：一条提醒现在是什么状态、
 * 它的有效触发时刻是哪一刻、行上该出现哪几个动作。**组件里因此没有分支**，
 * 不需要靠快照测试兜。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 领域规则**一条都不在这里重写**（这是本文件最重要的约束）
 *
 * "什么时候算到期"只有一个定义：`@heyta/domain` 的
 * {@link reminderPhase} / {@link reminderEffectiveAt}。`reminders.ts` 的文件头
 * 点名禁止各端自己写 `reminder.snoozedUntil ?? reminder.triggerAt` ——
 * 那就是**第二份定义**，而它必然在某一端漏掉 snooze，症状是
 * "用户按了稍后提醒，到点又弹一次"，且只在跨端时出现。
 *
 * 所以本文件的 `when` 一律来自 `reminderEffectiveAt()`，`phase` 一律来自
 * `reminderPhase()`，**一个 `??` 都不自己写**。
 *
 * 🔴 判定顺序也是语义，不许重排：`dismissed → fired → due → snoozed → scheduled`。
 * 一个"已关闭"的提醒即使时间过了触发点也不该再弹（`dismissed` 排在 `due` 前）。
 * 本文件由此得出：**`fired` / `dismissed` 是"结束态"，只能移除**，不能
 * 再 snooze / dismiss —— 对一条已经投递过的提醒再点"稍后提醒"，
 * 领域层并不会让它复活（`firedAt` 一旦写上就是单调的），按钮点了也白点。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本文件**不 import `react-native`，也不 import `@heyta/i18n`**
 *
 * 前者：`packages/ui/vitest.config.ts` 跑在 **node** 环境，`react-native`
 * 是 Flow 源码，node 解析不了它。这条约束顺带钉住了"model 必须宿主无关"。
 * 后者：i18n 包自己带过一份 React，四端会同时中招（见 `TaskList.tsx` 文件头）。
 * 文案一律由宿主注入 —— 这也是 {@link offsetPresets} 只回数字不回文案的原因。
 */

import {
  REMINDER_OFFSET_PRESETS_MS,
  reminderEffectiveAt,
  reminderPhase,
  type Reminder,
  type ReminderPhase,
} from '@heyta/domain';

/**
 * 提前量预设（ms）。**直接转发领域层的数组，不重新定义一份。**
 *
 * 🔴 返回的是**同一个数组引用**（`toBe` 相同），不是副本。理由有两层：
 *
 *   1. 重新 `[...REMINDER_OFFSET_PRESETS_MS]` 或手抄一份数字，就出现了
 *      **第二份定义** —— 领域层调整预设（比如加"提前 2 小时"）时，
 *      共享层这份不会跟着变，而没有任何测试会红，只有一个端少一个按钮。
 *   2. 界面上的按钮文案 `labels.offsets[i]` 靠**下标**与它对齐。
 *      一旦两边长度/顺序漂移，"提前 30 分钟"的按钮会显示成"提前 1 天"，
 *      用户点下去得到的是另一个时刻。`toReminderRows` 与 offsetPresets 的
 *      一致性判据正是由"同一个引用"保证的。
 *
 * ⚠️ 只有数字，**没有文案**：文案是 i18n 的事（`packages/i18n`），
 * 把"提前 30 分钟"这种句子写进这里会让它无法翻译（`check:ui-language` 抓这个）。
 */
export function offsetPresets(): readonly number[] {
  return REMINDER_OFFSET_PRESETS_MS;
}

/**
 * 一行的**展示状态徽标**能用的颜色 token 名。
 *
 * 🔴 刻意不是 `TokenName`（那是全部 token 的联合，含间距/圆角等**数字** token）。
 * 标成 `TokenName` 会让 `tokens[token]` 的类型变成 `string | number`，
 * 喂给 `textStyle.color` 直接编译不过 —— 这个联合每一项都是**颜色**，
 * 与 `categories/model.ts` / `habits/model.ts` 同一个理由。
 */
export type ReminderBadgeToken =
  | 'color.foreground-muted'
  | 'color.info-strong'
  | 'color.warning-strong'
  | 'color.success-strong'
  | 'color.foreground-subtle';

/**
 * 状态 → 徽标颜色。**放在 model 里而不是组件里**：
 *
 * 同一个 `ReminderPhase` 在四个端必须画成同一个颜色，否则用户会以为
 * "这一条在手机上和在网页上是两种状态"。映射只有这一处，
 * 改色时不会只改一个端。`Record<ReminderPhase, …>` 同时钉住"五个状态
 * 一个都不能漏"—— 少一个 `tsc` 就红。
 */
const BADGE_TOKENS: Record<ReminderPhase, ReminderBadgeToken> = {
  scheduled: 'color.foreground-muted',
  snoozed: 'color.info-strong',
  due: 'color.warning-strong',
  fired: 'color.success-strong',
  dismissed: 'color.foreground-subtle',
};

/** 状态 → 徽标颜色 token 名。 */
export function reminderPhaseToken(phase: ReminderPhase): ReminderBadgeToken {
  return BADGE_TOKENS[phase];
}

/**
 * 一条提醒在列表里的一行。
 *
 * `id` 是这个行模型的稳定 key（React key / testID），`entityId` 是**动作要作用
 * 的那个实体 id**。两者今天的取值相同（`Reminder.id`），但它们不是同一个概念：
 * 行模型将来若长出"不指向实体的行"，`id` 不必是实体 id。⚠️ 保留两个字段是
 * 任务书定的接口，不要为了"看起来重复"把其中一个删掉 —— 组件与宿主按 `entityId`
 * 接线，删了它调用处会静默拿到 `undefined`。
 *
 * 🔴 `entityId` **必须是 `Reminder.id`，不是 `Reminder.taskId`**（这一点踩过坑）：
 * `@heyta/app-host#createReminderActions` 的 `snoozeReminder` / `dismissReminder` /
 * `removeReminder` 收的 `entityId` 会走 `reminderOf(entityId)`，也就是在
 * `state.reminders[entityId]` 里找提醒。`Reminder.id` 是
 * `` `${taskId}:${triggerAt}` ``（见 `reminder-actions.ts#reminderId`），
 * 而 `taskId` 只是它的前缀。传 `taskId` 会在宿主里抛
 * 「找不到提醒「…」」—— 一条任务的提醒最多 5 条，光靠 `taskId` 也定位不到是哪一条。
 * 本文件曾经写成 `reminder.taskId`，是**错的**；测试当时是绿的，因为它只断言了
 * 自己写下的那个错值。
 */
export interface ReminderRow {
  /** 行模型的稳定 key（今天 = 提醒 id）。 */
  readonly id: string;
  /**
   * 动作回调收的实体 id = `Reminder.id`（**不是 `taskId`**，理由见上）。
   */
  readonly entityId: string;
  /** 领域层判定的状态。 */
  readonly phase: ReminderPhase;
  /**
   * 有效触发时刻（epoch ms）。**来自 `reminderEffectiveAt()`** ——
   * 已 snooze 的提醒这里必须是 `snoozedUntil`，不是 `triggerAt`。
   */
  readonly when: number;
  /** 还能不能"稍后提醒"。`fired` / `dismissed` 为 `false`。 */
  readonly canSnooze: boolean;
  /** 还能不能关闭。`fired` / `dismissed` 为 `false`。 */
  readonly canDismiss: boolean;
  /** 能不能移除。**任何存活状态都能移除**（见下）。 */
  readonly canRemove: boolean;
}

/**
 * 一条提醒是不是"已经结束"。
 *
 * 🔴 **唯一的结束态判据**：`fired`（已投递）/ `dismissed`（用户关闭）。
 * `toReminderRows` 与两个 `can*Reminder` 都走它 —— 三个地方各写一遍
 * `phase === 'fired' || phase === 'dismissed'` 就是第二份定义，
 * 将来加"过期自动作废"时只会改到一半。
 */
function isClosedPhase(phase: ReminderPhase): boolean {
  return phase === 'fired' || phase === 'dismissed';
}

/**
 * 未删除的提醒 → 每个提醒一行的展示模型。
 *
 * `now` 显式传入而不是读 `Date.now()`：否则同一次渲染里不同提醒可能跨过
 * 触发点，显示不一致；而且测试无法稳定断言（与 `toHabitProgressRows` 同一约定）。
 *
 * ⚠️ 传进来的 `reminders` 必须已经滤掉墓碑（宿主的 `listReminders()` 已经是）。
 * 这里**不再滤一遍**：两处都滤会让"删除之后这一条还算不算数"出现两个答案，
 * 而领域层已经提供了 `aliveReminders()` —— 重复实现正是本文件要避免的漂移。
 */
export function toReminderRows(reminders: readonly Reminder[], now: number): ReminderRow[] {
  return reminders.map((reminder) => {
    const phase = reminderPhase(reminder, now);
    const closed = isClosedPhase(phase);
    return {
      id: reminder.id,
      // 🔴 `reminder.id`（=`${taskId}:${triggerAt}`），**不是 `reminder.taskId`** ——
      // 宿主的 snooze / dismiss / remove 都按它查 `state.reminders`（见 `ReminderRow`）。
      entityId: reminder.id,
      phase,
      when: reminderEffectiveAt(reminder),
      canSnooze: !closed,
      canDismiss: !closed,
      // 移除**永远可用**：删除一条排着但还没到点的提醒是完全正常的操作，
      // 而结束态的提醒除了移除已经没有别的动作。所以它是个常量 `true`，
      // 但仍然登记进行里 —— 宿主据它决定要不要画删除按钮，不需要
      // 在四个端各判断一次"什么状态能删"。
      canRemove: true,
    };
  });
}

/**
 * 这一行还能不能 snooze。
 *
 * 收的是**行模型**而不是 `Reminder`：宿主的渲染路径上只有行，
 * 而且"能不能"必须与 `toReminderRows` 里写进 `canSnooze` 的答案逐字一致 ——
 * 拿同一个字段转发是保证一致的最省事方式。
 */
export function canSnoozeReminder(row: ReminderRow): boolean {
  return row.canSnooze;
}

/**
 * 这一行还能不能 dismiss。
 *
 * ⚠️ 与 {@link canSnoozeReminder} 是两个函数而不是一个 `canActOn`：
 * 产品上它们**将来可能分叉**（比如"到点但还没投递"允许关闭、
 * 却不该允许再往后推）。现在它们恰好同值，但共用入口会把这个巧合
 * 变成契约，之后再拆就有人依赖。
 */
export function canDismissReminder(row: ReminderRow): boolean {
  return row.canDismiss;
}
