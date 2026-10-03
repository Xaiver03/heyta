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
 * ## 这个文件钉住的四件事（写在 UI 里就会各端漂移）
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
 * 4. **"提前 N 天"是日历算术不是减法**（{@link reminderTriggerFromOffset} /
 *    {@link localDayBefore}，W9 ③）：整天以上的提前量走本地日历日回退，
 *    跨夏令时不漂一小时。建提醒与重复顺延**共用这一个函数** ——
 *    分两处写就会有一处漏，而漏的那处只在一年里的两天出错。
 *
 * ⚠️ **不发明默认值**：`Fired` / `Dismissed` 的写路径全在 app-host 的动作层，
 * 这里不提供"投递后自动删除"之类的策略 —— 那是产品决策，而且删除会让
 * 另一端把提醒同步回来（同 `habit-actions.ts` 文件头第 3 条）。
 */

import { addDays, parseLocalDate, toLocalDate } from './date.js';
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
 * 「日级以上」的提前量档位（W9 ①）：倒数日场景要的是"提前 3 天告诉我"，
 * 而上面那张表最远只到"提前 1 天"。
 *
 * ## 🔴 为什么不直接把它并进 {@link REMINDER_OFFSET_PRESETS_MS}
 *
 * 那个数组是**下标契约**的一半：`packages/ui` 的 `ReminderList` 按
 * `labels.offsets[i] ↔ offsetPresets()[i]` 取文案，而文案映射在两处各自写了一遍
 * （`apps/mobile/src/lib/reminders-display.ts` 的 `offsetMessageKey`、
 * `apps/web/src/features/reminders/ReminderPanel.tsx` 的 `REMINDER_OFFSET_KEYS`）。
 * 并进原数组等于**同时改这两处 + 那两个端的词条**，而移动端的词条键
 * （`reminder.offset.*`）里根本没有 `2d` —— 症状是移动端提醒面板一打开就抛
 * "没有对应的词条 key"（那是 `offsetMessageKey` 的 `default` 分支，故意的）。
 *
 * ⇒ 所以这里是**新增一个档位组**而不是改老数组：
 *   · 老数组一字未动 ⇒ 已落库的提醒、两端的下标契约、旧档位的文案全部不变；
 *   · 谁能用这一组由各宿主决定（当前只有 web 的 `ReminderPanel` 渲染它），
 *     而"这条档位有没有对应文案"的判据在**宿主那一侧**复刻了同一个 `default: throw`
 *     （`apps/web/src/features/reminders/reminder-tiers.ts`）。
 *
 * ⚠️ 上限仍然是 `MAX_REMINDER_LEAD_MS`（365 天）：这里最大的 30 天远没碰到它，
 * 但这一组以后要加长（比如"提前半年"）时必须回头对账那条闸门。
 */
export const REMINDER_LONG_OFFSET_PRESETS_MS = [
  2 * DAY_MS,
  3 * DAY_MS,
  7 * DAY_MS, // 一周
  30 * DAY_MS, // 一个月（按 30 天，不是"上个月同一日"，见下）
] as const;

/**
 * 全部档位（短档 + 日级以上），**升序**。
 *
 * 存在的理由是"档位阶梯只有一处能回答全量"：宿主各自 `[...short, ...long]`
 * 拼一遍，就会有一处漏掉某档而没有任何东西会红。
 * 自检在 `packages/domain/tests/reminders.spec.ts`（升序、首项 0、都不超闸门）。
 */
export const ALL_REMINDER_OFFSET_PRESETS_MS: readonly number[] = [
  ...REMINDER_OFFSET_PRESETS_MS,
  ...REMINDER_LONG_OFFSET_PRESETS_MS,
];

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
 * `ms` 往前 `days` 个**本地日历日**的同一套钟表时间（W9 ③ 的唯一实现）。
 *
 * ## 为什么必须是日历日而不是 `days * 24 小时`
 *
 * "提前 3 天提醒我"里用户说的是**日期**，不是"72 小时"。跨夏令时的那三天只有
 * 71 或 73 小时，于是硬减 72 小时会得到**前一天/后一天的另一个钟点**：
 * 实测（`America/New_York`，2026-03-09 09:30 截止、提前 3 天）
 * 日历算法给 `2026-03-06 09:30 EST`，而 `dueDate − 72h` 给 `08:30 EST` ——
 * 用户提前一个钟点收到通知，而且**一年里只有两天错**，最难被发现了。
 *
 * 手法与本仓既有实现完全一致，且那两处都带着 DST 判据：
 *   · {@link addDays} 用 `setDate()` 做日历日加减（`date.ts` 里写着
 *     "不要自己算 `date + n*86400000` —— 夏令时切换那天会错一小时"）；
 *   · 时刻用 `new Date(y, m, d, hh, mm, ss, ms)` 构造，**不是**"零点 + 毫秒数"
 *     （`localDateTimeToEpoch` 的注释里就是同一条理由）。
 *
 * 两个边界由原生 `Date` 定义，不需要在这里发明：
 *   · 目标日没有这个钟点（春季拨快跳过的那一小时）→ 顺延到下一个存在的时刻；
 *   · 目标日这个钟点出现两次（秋季拨慢重复的那一小时）→ 取第一次。
 */
export function localDayBefore(ms: number, days: number): number {
  if (!Number.isFinite(ms)) throw new Error(`时刻必须是有限数，收到 ${String(ms)}`);
  if (!Number.isInteger(days) || days < 0) {
    throw new Error(`往前天数必须是非负整数，收到 ${String(days)}`);
  }
  if (days === 0) return ms;
  const src = new Date(ms);
  // 先由 date.ts 的日历函数定出**目标日**（addDays 走 setDate，跨月/跨年/闰年
  // 都交给原生逻辑），再在那一天上按本地钟点构造时刻。
  const target = parseLocalDate(addDays(toLocalDate(ms), -days));
  return new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate(),
    src.getHours(),
    src.getMinutes(),
    src.getSeconds(),
    src.getMilliseconds(),
  ).getTime();
}

/**
 * 由任务截止时间 + 提前量算出触发时刻。负数提前量（= 截止之后）会被拒绝。
 *
 * ## 🔴 两种提前量、两种算术（W9 ③）
 *
 *   · **不足一天**（0 / 5 分 / 15 分 / 30 分 / 1 小时）：按**瞬时**减毫秒。
 *     这是对的 —— "截止前 30 分钟"说的是那 30 分钟，不是某个日历位置。
 *   · **整天及以上**（1 天 / 2 天 / 3 天 / 1 周 / 30 天）：先按**本地日历日**
 *     回退整天（{@link localDayBefore}），再减不足一天的零头。
 *     这样"提前 3 天"永远落在**同一套钟表时间**上，跨夏令时不漂。
 *
 * ⚠️ 这条分界**只在有夏令时的时区**才看得见差别；无夏令时的时区（例如
 * `Asia/Shanghai`）两条路径逐字相同 —— 所以判据必须显式钉住时区，
 * 见 `packages/domain/tests/reminders-dst.spec.ts`。
 */
export function reminderTriggerFromOffset(dueDate: number, offsetMs: number): number {
  if (!Number.isFinite(dueDate) || !Number.isFinite(offsetMs) || offsetMs < 0) {
    throw new Error('提前量必须是非负有限数，且截止时间必须是有限数');
  }
  const wholeDays = Math.floor(offsetMs / DAY_MS);
  const restMs = offsetMs - wholeDays * DAY_MS;
  if (wholeDays === 0) return dueDate - restMs;
  return localDayBefore(dueDate, wholeDays) - restMs;
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
  // 病态提前量（导入/手改出来的 NaN / 负数）在这里**放弃顺延**而不是抛 ——
  // 这条路径是"完成一个重复任务"，为一个坏字段让用户的点击失败是不成比例的。
  if (!Number.isFinite(reminder.offsetMs) || reminder.offsetMs < 0) return undefined;
  // 🔴 与建提醒**同一个函数**（W9 ③）：顺延时若改回 `nextDueDate - offsetMs`，
  // 那么第一次建对的"提前 3 天"在第二个周期就会漂一小时，而界面上一切正常。
  const next = reminderTriggerFromOffset(nextDueDate, reminder.offsetMs);
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