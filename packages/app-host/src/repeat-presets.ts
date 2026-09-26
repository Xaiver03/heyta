/**
 * 重复规则的**预设**
 * ==================
 *
 * 🔴 这个文件存在的理由是 §3.5 那条判据：**"这段代码里有没有一行在决定业务上该怎么做？"**
 *
 * "每周"到底等于哪一天、"每月"是 15 号还是 1 号、"工作日"包含哪几天 ——
 * 这些**全是产品语义**。把它们写在 `apps/mobile` 的组件里，Web 端落地时会写出第二份，
 * 而两份对"工作日"的理解只要差一天，同一个用户在两台设备上就会看到不同的重复日期，
 * 且两边都不报错。
 *
 * 所以：**规则串怎么拼在这里，界面只负责选哪个 id、以及把它显示成什么文字。**
 * 文字（标签）刻意留在界面层 —— 那是展示，不是语义。
 *
 * ⚠️ 规则串一律走 `Recurrence.*` 构造器，不手拼：
 * `FREQ=WEEKLY;BYDAY=MO` 这种字面串在调用点看不出对错，
 * 拼错一个分号不会报错，只会**静默变成另一条规则**。
 */

import { Recurrence, isoWeekday, parseLocalDate, type LocalDate } from '@heyta/domain';

/**
 * 预设的稳定标识。
 *
 * 🔴 **不要用界面上的文字当标识** —— 换一个说法（「每周」→「每周一次」）
 * 就会让所有存过状态的路径失效。id 是数据，文字是展示。
 */
export type RepeatPresetId = 'daily' | 'weekly' | 'weekdays' | 'monthly';

/** 预设的顺序（界面按这个顺序排）。`none`（不重复）由界面自己加，不是规则。 */
export const REPEAT_PRESET_IDS: readonly RepeatPresetId[] = [
  'daily',
  'weekly',
  'weekdays',
  'monthly',
];

/** ISO 星期（1=周一 … 7=周日）→ RRULE 的 BYDAY 取值。 */
const BYDAY_BY_ISO: Record<number, string> = {
  1: 'MO',
  2: 'TU',
  3: 'WE',
  4: 'TH',
  5: 'FR',
  6: 'SA',
  7: 'SU',
};

/**
 * 把一个预设展开成 RRULE 串。
 *
 * `anchor` 必须与 `TaskActions.setRepeat` 将要钉的锚点是**同一个日期**
 * （即 `dueDate ? toLocalDate(dueDate) : today()`）—— 否则「每周」会选中
 * 锚点所在的那一周的另一天，用户看到的日期和他点的那一项对不上。
 *
 * 传 `undefined` 表示这条规则无法构造（例如锚点串非法）；调用方应把它当成
 * "这次操作无效"而不是写入一条垃圾规则。
 */
export function repeatPresetRule(id: RepeatPresetId, anchor: LocalDate): string | undefined {
  switch (id) {
    case 'daily':
      return Recurrence.daily();

    case 'weekly': {
      const day = BYDAY_BY_ISO[isoWeekday(anchor)];
      // `isoWeekday` 只可能返回 1..7，这里仍显式判一次：
      // 拿到 `undefined` 拼进串里会变成 `BYDAY=undefined` ——
      // 那**能通过** `isValidRecurrenceRule`（FREQ 还在），但一条都不匹配。
      if (day === undefined) return undefined;
      return Recurrence.weekly([day]);
    }

    case 'weekdays':
      return Recurrence.weekly(['MO', 'TU', 'WE', 'TH', 'FR']);

    case 'monthly': {
      // `parseLocalDate` 会对越界日期**抛错**（回读校验），所以这里先确认锚点合法。
      let dayOfMonth: number;
      try {
        dayOfMonth = parseLocalDate(anchor).getDate();
      } catch {
        return undefined;
      }
      if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return undefined;
      return Recurrence.monthlyOnDay(dayOfMonth);
    }

    default: {
      // 穷尽性检查：往 `RepeatPresetId` 加一个成员却忘了在这里处理，typecheck 就红。
      const exhaustive: never = id;
      return exhaustive;
    }
  }
}