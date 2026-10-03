/**
 * 提醒面板的文案接线（移动壳）
 * ==============================
 *
 * 结构在 `@heyta/ui`（`ReminderList` + `reminders/model.ts`），这里只剩
 * "把语义结果映射到本端词条"这一层 —— 所以它是 `ReminderListLabels` 的构造器，
 * 字段与共享层一一对应（少给一个**编译期**就报，共享层的 `labels` 是必填的）。
 *
 * ⚠️ 与 `lib/habits-display.ts` 同一个取舍：**本文件不 import 任何
 * `@heyta/ui` 的"值"**，只 import 它的类型。原因很硬 —— 移动端单测跑在
 * vitest / node 里，`@heyta/ui` 的 `dist` 顶层 import `react-native`（Flow 源码），
 * node 解析不了它：
 *   · `import type { ReminderListLabels }` 没问题（编译期擦除）；
 *   · `import { offsetPresets }`（**值**）会把整条 react-native 依赖拉进来，
 *     整个 spec 文件转译失败（实测：`0 test`，报 Flow 语法错误，见
 *     `tests/habits-display.spec.ts` 的文件头）。
 * ⇒ 所以 `offsets` 的**顺序**不能从 `offsetPresets()` 取，只能从
 * `@heyta/domain` 的 `REMINDER_OFFSET_PRESETS_MS` 派生（它就是
 * `offsetPresets()` 返回的**同一个数组**，共享层只做了一次转发）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 两处"文案与数字分居两地"，键名是唯一能把它们钉在一起的东西
 *
 *   1. `reminder.absolute.1h` —— 键名里的 `1h` 是**契约的一部分**：
 *      文案写"1 小时后提醒"，宿主就必须建 `now + 1h`。所以下面把
 *      `ABSOLUTE_REMINDER_LEAD_MS` 与那条键写在同一个文件里、紧挨着，
 *      并让测试同时断言两者。
 *   2. `reminder.a11y.snooze` 的中文写着"推迟 10 分钟"、英文写着
 *      "by 10 minutes" —— 而真正的推迟量走 `snoozeDeadline`（领域层）。
 *      两个人各改一处就会得到"读屏说 10 分钟、实际推迟 1 天"，且**不报错**。
 *      所以 `SNOOZE_MINUTES` 也在这里显式声明，测试拿它和文案对账。
 */

import type { MessageKey } from '@heyta/i18n';
import type { ReminderListLabels } from '@heyta/ui';
import { REMINDER_OFFSET_PRESETS_MS, snoozeDeadline } from '@heyta/domain';

import type { Translate } from '../i18n/translate';
import { formatStamp } from './date';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * 没有截止时间时唯一入口的提前量：**正好 1 小时**。
 *
 * 🔴 与词条 `reminder.absolute.1h` 的键名同生共死。改这里就必须改键名
 * （以及中英文案），否则按钮会写着"1 小时后"却排到别处 —— 那种错位
 * 界面上完全看不出来，只会在用户等着通知的时候才暴露。
 */
export const ABSOLUTE_REMINDER_LEAD_MS = HOUR_MS;

/** 「稍后提醒」的推迟量（分钟）。与 `reminder.a11y.snooze` 文案里的数字一致。 */
export const SNOOZE_MINUTES = 10;

/** 绝对时刻入口要建的时刻：`now + 1 小时`。 */
export function absoluteReminderTriggerAt(now: number): number {
  return now + ABSOLUTE_REMINDER_LEAD_MS;
}

/**
 * 「稍后提醒」的目标时刻。**必须走领域层的 `snoozeDeadline`** ——
 * 它内含上限（`MAX_SNOOZE_MS`，7 天）与 `minutes` 缺省值；
 * 自己写 `now + 10 * 60000` 就是第二份定义，将来领域层夹上限时这里不会跟着变。
 */
export function snoozeTargetAt(now: number): number {
  return snoozeDeadline(now, SNOOZE_MINUTES);
}

/**
 * 一个预设提前量 → 它的词条 key。
 *
 * 🔴 `switch` 而不是数组下标：`REMINDER_OFFSET_PRESETS_MS` 的元素类型是
 * 那六个数字的字面量联合，`switch` 能让 `default` 分支在"领域层加了预设"
 * 时**仍然可达**（数组下标访问在 `noUncheckedIndexedAccess` 下永远是
 * `T | undefined`，会逼出一句走不到的兜底）。
 *
 * ⚠️ 未知提前量**直接抛**，不返回空串也不跳过。理由与 `ReminderList` 文件头
 * 那条"截断数组会把档位与回调拆开"是同一条：跳过会让 `labels.offsets` 比
 * `presets` 短，共享组件按下标取文案 → 按钮写着"提前 5 分钟"、实际建"提前 1 天"，
 * 而**没有任何一处会报错**。抛错至少能在开发/测试时立刻看见。
 */
function offsetMessageKey(offsetMs: number): MessageKey {
  switch (offsetMs) {
    case 0:
      return 'reminder.offset.0';
    case 5 * MINUTE_MS:
      return 'reminder.offset.5m';
    case 15 * MINUTE_MS:
      return 'reminder.offset.15m';
    case 30 * MINUTE_MS:
      return 'reminder.offset.30m';
    case HOUR_MS:
      return 'reminder.offset.1h';
    case DAY_MS:
      return 'reminder.offset.1d';
    default:
      throw new Error(
        `提醒预设 ${String(offsetMs)} 没有对应的词条 key —— ` +
          '`REMINDER_OFFSET_PRESETS_MS` 与 `reminder.offset.*` 已经漂移，' +
          '请同时补上词条与本函数的映射。',
      );
  }
}

/**
 * 预设提前量 → 词条 key，**顺序与 `REMINDER_OFFSET_PRESETS_MS` 逐项一致**。
 *
 * 导出来是为了让测试能直接对账（不必先把文案渲染出来）。
 */
export function reminderOffsetKeys(): readonly MessageKey[] {
  return REMINDER_OFFSET_PRESETS_MS.map(offsetMessageKey);
}

/** 构造 `ReminderList` 需要的整份文案。每一项都走真的词条表（缺 key 会抛）。 */
export function reminderListLabels(t: Translate): ReminderListLabels {
  return {
    title: t('reminder.title'),
    deliveryUncertain: t('reminder.delivery.uncertain'),
    empty: t('reminder.empty'),
    add: t('reminder.add'),
    // ⚠️ 顺序即契约：共享组件用 `labels.offsets[i]` 配 `presets[i]`。
    offsets: reminderOffsetKeys().map((key) => t(key)),
    snooze: t('reminder.snooze'),
    dismiss: t('reminder.dismiss'),
    remove: t('reminder.remove'),
    noDueDate: t('reminder.hint.noDueDate'),
    // 见文件头第 1 条：这条文案与 `absoluteReminderTriggerAt` 是一对。
    absolute: t('reminder.absolute.1h'),
    // 五个状态一个都不能漏 —— `Record<ReminderPhase, string>` 会在编译期钉住。
    phase: {
      scheduled: t('reminder.phase.scheduled'),
      snoozed: t('reminder.phase.snoozed'),
      due: t('reminder.phase.due'),
      fired: t('reminder.phase.fired'),
      dismissed: t('reminder.phase.dismissed'),
    },
    // 🔴 先把时刻格式化成字符串再进词条 —— `formatStamp` 是移动端唯一的
    // 时刻格式化实现，且**不用 `Intl`**（Hermes 上 Intl 是可选编译的，
    // 拿不到时会在渲染中途抛）。见 `lib/date.ts` 文件头。
    a11yRemove: (when) => t('reminder.a11y.remove', { when: formatStamp(when) }),
    a11ySnooze: (when) => t('reminder.a11y.snooze', { when: formatStamp(when) }),
    a11yDismiss: (when) => t('reminder.a11y.dismiss', { when: formatStamp(when) }),
    a11yList: (title) => t('reminder.a11y.list', { title }),
  };
}
