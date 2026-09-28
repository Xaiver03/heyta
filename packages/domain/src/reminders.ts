/**
 * 提醒的领域规则 —— **"什么时候算到期"只有一个定义**
 * ==================================================
 *
 * 这个文件补的是 B1-1（`docs/plans/site-and-parity-alignment.md` §B1）的
 * **领域层**。实体形状在 `entities.ts` 的 {@link Reminder}，op 的构造在
 * `packages/app-host/src/reminder-actions.ts`；这里只有**纯函数**。
 *
 * ## 为什么提醒是独立实体，而不是 `Task.dueDate` 的派生视图
 *
 * 1. **没有 ADR 管这件事。** `grep -rn "提醒\|REMINDER" docs/adr/` 只命中
 *    ADR-0020 的订阅到期提醒，与任务提醒无关 —— 所以这里不是"照 ADR 做"，
 *    而是新拍的产品决定，判据如下。
 * 2. **`dueDate` 语义已被 ADR-0015 占满**：它是象限的紧迫性轴（一个瞬间）。
 *    提醒是**通知规则**（"截止前 30 分钟"、一条任务挂多个、只看时刻不看截止），
 *    塞进 `dueDate` 会让一个字段同时表达两件事，必有一次编辑让它们漂移。
 * 3. **一个用户意图 = 一个 op**（AGENTS.md §3.4）。做成 `Task.reminders[]`：
 *    加一条提醒就要重写整条任务 → 与"改标题"在同一实体上 LWW 互斥，
 *    且单条提醒的删除/顺延根本表达不出来。独立实体让每条提醒有自己的 id
 *    与时钟 —— 与 `HabitLog` 相对 `Habit` 是同一条推理。
 * 4. 计划里已经登记了结论：§B1-1 写的是「**物化 `REMINDER`** + 调度 + 本地通知」。
 *
 * ## 这个文件钉住的三件事（写在 UI 里就会各端漂移）
 *
 * 1. **到期判定**（{@link reminderPhase} / {@link dueReminders}）：
 *    看的是 `snoozedUntil ?? triggerAt`，不是 `triggerAt` 一个字段；
 *    而且 `dismissed` / `fired` 都**优先于**"到点了"。顺序写反的后果是
 *    "用户关掉的提醒到点又弹一次"，而且只在跨端时出现。
 * 2. **状态机是单调的**：`firedAt` 一旦写上，稍后再 snooze 不会让它复活
 *    （见 {@link reminderPhase} 的判定顺序）。复活只能靠显式清字段。
 * 3. **重复任务怎么顺延**（{@link nextTriggerAfterRepeat}）：
 *    带 `offsetMs` 的提醒跟着 `dueDate` 走，不带的是**绝对时刻**、不移动。
 *    两句话分开说，是因为"每天 9 点提醒我"里的 9 点是绝对时间，
 *    跟着 dueDate 漂移反而是错的。
 *
 * ⚠️ **不发明默认值**：`Fired` / `Dismissed` 的写路径全在 app-host 的动作层，
 * 这里不提供"投递后自动删除"之类的策略 —— 那是产品决策，而且删除会让
 * 另一端把提醒同步回来（同 `habit-actions.ts` 文件头第 3 条）。
 */

import type { Reminder } from './entities.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * 界面可以提供的"提前量"预设（ms）。
 *
 * ⚠️ 只有数字，**没有文案**。文案是 i18n 的事（`packages/i18n`），
 * 把"提前 30 分钟"这种句子写进领域层会让它无法翻译 —— 这不是风格洁癖：
 * 界面语言门禁（`check:ui-language`）抓的就是硬编码文案。
 */
export const REMINDER_OFFSET_PRESETS_MS = [
  0,
  5 * MINUTE_MS,
  15 * MINUTE_MS,
  30 * MINUTE_MS,
  HOUR_MS,
  DAY_MS,
] as const;

/**
 * 允许的最大提前量 / 未来跨度（365 天）。
 *
 * 它不是产品玩法，是**病态数据的闸门**：`triggerAt` 是从界面/导入进来的数字，
 * 一个手滑写成 `Date.now() * 1000` 会把提醒排到公元 5 万年 ——
 * 而调度器会一直把它当成"最远的那条"，任何"最近一条提醒"的读数都被污染。
 */
export const MAX_REMINDER_LEAD_MS = 365 * DAY_MS;

/**
 * 允许"略微在过去"的窗口（1 分钟）。
 *
 * 为什么会存在：`triggerAt` 由宿主按本机时钟算出（建提醒 → 立刻落库，
 * 中间可能过了几百毫秒），设备之间也有时钟偏移。窗口设 0 会让
 * "现在提醒我"这类正常操作偶发失败；设太大则会让用户看到"凭空弹出一条通知"。
 */
export const REMINDER_PAST_GRACE_MS = MINUTE_MS;

/** 单条任务允许的**存活**提醒数上限。 */
export const MAX_REMINDERS_PER_TASK = 5;

/** 「稍后提醒」允许的最大推迟量（7 天）。同 `MAX_REMINDER_LEAD_MS`，是闸门不是玩法。 */
export const MAX_SNOOZE_MS = 7 * DAY_MS;

/**
 * 一条提醒的**对外状态**。
 *
 * - `scheduled` —— 排着，还没到
 * - `snoozed`   —— 被推迟到未来某刻（`snoozedUntil`）
 * - `due`       —— 到点了且还没投递 → **调度器该发通知的就是它**
 * - `fired`     —— 已经投递过（`firedAt`）
 * - `dismissed` —— 用户主动关闭（`dismissedAt`）
 */
export type ReminderPhase = 'scheduled' | 'snoozed' | 'due' | 'fired' | 'dismissed';

/** 建提醒 / 改时间的拒绝原因。**返回原因而不是抛错** —— 调用方要能给出提示。 */
export type ReminderTriggerRejection = 'not-a-time' | 'in-the-past' | 'too-far';

/**
 * 一条提醒的**有效触发时刻**。
 *
 * 🔴 读"何时触发"一律走这里，不要各端自己写 `reminder.snoozedUntil ?? reminder.triggerAt`
 * —— 那就是第二份定义，而它必然在某一端漏掉 snooze（症状：用户按了"稍后提醒"，
 * 到点又弹一次）。
 */
export function reminderEffectiveAt(reminder: Reminder): number {
  return reminder.snoozedUntil ?? reminder.triggerAt;
}

/**
 * 判定状态。**判定顺序就是语义**，不要重排：
 *
 *   `dismissed` → `fired` → `due` → `snoozed` → `scheduled`
 *
 * 为什么 `dismissed` / `fired` 在 `due` 之前：它们表达的是"这条已经结束了"，
 * 而一个结束了的提醒到点不该再弹。若把 `due` 放前面，用户关掉提醒后
 * 只要时间过了触发点就**又弹一次**。
 */
export function reminderPhase(reminder: Reminder, at: number): ReminderPhase {
  if (reminder.dismissedAt !== undefined) return 'dismissed';
  if (reminder.firedAt !== undefined) return 'fired';
  if (at >= reminderEffectiveAt(reminder)) return 'due';
  if (reminder.snoozedUntil !== undefined) return 'snoozed';
  return 'scheduled';
}

/** 未删除、未关闭、未投递，且**已到点** —— 调度器真正要发通知的集合。 */
export function isReminderPending(reminder: Reminder, at: number): boolean {
  return reminder.deletedAt === undefined && reminderPhase(reminder, at) === 'due';
}

/**
 * 到点的提醒，**顺序确定**：先按有效触发时刻，再按 id 字典序。
 *
 * 顺序必须确定：两台设备同时到点，弹通知的顺序若不同，用户会以为
 * "漏了一条"或"弹了两次"。同刻按 id 是唯一在任何端都一致的决胜规则。
 */
export function dueReminders(reminders: readonly Reminder[], at: number): Reminder[] {
  return reminders
    .filter((reminder) => isReminderPending(reminder, at))
    .sort((a, b) => {
      const byTime = reminderEffectiveAt(a) - reminderEffectiveAt(b);
      if (byTime !== 0) return byTime;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/** 未删除的提醒，按 id 字典序（用于展示与稳定比较）。 */
export function aliveReminders(reminders: readonly Reminder[]): Reminder[] {
  return reminders
    .filter((reminder) => reminder.deletedAt === undefined)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * 把创建/改期请求**校验成**一个可落库的时刻。合法则返回 `undefined`。
 *
 * ⚠️ `at` 必须由调用方注入（`Date.now()`），**不要在这个纯函数里读时钟** ——
 * 否则同一份数据在两次调用之间会得到不同答案，测试也无法稳定断言。
 */
export function reminderRejection(
  triggerAt: number,
  at: number,
): ReminderTriggerRejection | undefined {
  if (!Number.isFinite(triggerAt) || !Number.isInteger(triggerAt) || triggerAt <= 0) {
    return 'not-a-time';
  }
  if (triggerAt < at - REMINDER_PAST_GRACE_MS) return 'in-the-past';
  if (triggerAt > at + MAX_REMINDER_LEAD_MS) return 'too-far';
  return undefined;
}

/**
 * 由任务截止时间 + 提前量算出触发时刻。负数提前量（= 截止之后）会被拒绝。
 */
export function reminderTriggerFromOffset(dueDate: number, offsetMs: number): number {
  if (!Number.isFinite(dueDate) || !Number.isFinite(offsetMs) || offsetMs < 0) {
    throw new Error('提前量必须是非负有限数，且截止时间必须是有限数');
  }
  return dueDate - offsetMs;
}

/**
 * 重复任务顺延时，一条提醒的**新触发时刻**；`undefined` = **保持原样**。
 *
 * 规则（两句话，缺一条都会出错）：
 *
 *   - **带 `offsetMs`**（"截止前 30 分钟提醒"）：新触发 = 新截止 − 提前量。
 *     这就是"重复提醒怎么算"的答案 —— 提醒跟着截止走，而不是钉在第一次的
 *     时刻上（钉住的话，第二次之后的提醒会在任务还没到期时就弹）。
 *   - **不带 `offsetMs`**（"9 点提醒我"）：**不动**。绝对时刻跟着 dueDate 漂移
 *     是错的。
 *
 * `undefined` 同时覆盖了三种"不必写 op 的情况"：没有提前量、没有新的截止时间、
 * 算出来的时刻与现在相同。**调用方因此不会产出空 op** —— 一个什么都不改的
 * `UPD` 会白白推高 `updatedAt`，在两端同时编辑时制造本不存在的冲突。
 */
export function nextTriggerAfterRepeat(
  reminder: Reminder,
  nextDueDate: number | undefined,
): number | undefined {
  if (reminder.offsetMs === undefined) return undefined;
  if (nextDueDate === undefined || !Number.isFinite(nextDueDate)) return undefined;
  const next = nextDueDate - reminder.offsetMs;
  if (!Number.isFinite(next) || next <= 0) return undefined;
  if (next === reminder.triggerAt) return undefined;
  return next;
}

/**
 * 「稍后提醒」的目标时刻。`minutes` 缺省 10 分钟，上限 {@link MAX_SNOOZE_MS}。
 *
 * 上限是**钳制**而不是抛错：推迟按钮是交互动作，钳制到上限并让界面显示
 * 实际值，比让用户的点击失败要好。下限不钳 —— 传入 0 或负数会抛，
 * 因为那说明调用方（不是用户）算错了，静默钳成"1 秒后"只会掩盖 bug。
 */
export function snoozeDeadline(at: number, minutes = 10): number {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error(`稍后提醒的分钟数必须是正有限数，收到 ${String(minutes)}`);
  }
  return at + Math.min(minutes * MINUTE_MS, MAX_SNOOZE_MS);
}