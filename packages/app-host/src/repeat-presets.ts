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
export type RepeatPresetId = 'daily' | 'weekly' | 'weekdays' | 'monthly' | 'yearly';

/** 预设的顺序（界面按这个顺序排）。`none`（不重复）由界面自己加，不是规则。 */
export const REPEAT_PRESET_IDS: readonly RepeatPresetId[] = [
  'daily',
  'weekly',
  'weekdays',
  'monthly',
  'yearly',
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

    /**
     * 「每年」= 锚点所在的那月那日，逐年推进。
     *
     * 🔴 **2 月 29 日的锚点会退化成"只在闰年重复"** —— 这不是这里的疏漏，
     * 而是 RFC 5545 的 `BYMONTH=2;BYMONTHDAY=29` 的字面语义，且 Google / Apple
     * 日历的"每年重复"对 2/29 事件做的就是这件事。实测（ical.js）：
     * `2024-02-29 → 2028-02-29 → 2032-02-29`，中间三年**不产出日期**。
     *
     * 另一种口径（平年过 2 月最后一天）用 `BYMONTHDAY=-1` 表达，ical.js 实测
     * 能正确展开成 `2/28, 2/28, 2/28, 2/29…`，但**两条界面措辞路径都会把它渲染成
     * 「每年 2 月 -1 日」**（`describeRecurrence` 与移动端 `recurrence-display` 都把
     * 数字直接拼进句子），要改就得同时改域层措辞 + 壳层措辞 + 两套中英词条。
     * 所以：**本单不引入 `-1`**，把它留到有真实消费者时（倒数纪念日要显示
     * 「在一起多少天」，那一天是不是 2/29 才是产品问题；任务重复不是），
     * 并把这条边界钉在测试里，而不是留成没人知道的暗坑。
     */
    case 'yearly': {
      // 不做额外的月/日范围检查：`parseLocalDate` 会**回读校验**（`2026-13-40` 直接抛错），
      // 成功返回的 `Date` 必然给出 `month ∈ 1..12`、`day ∈ 1..31`。
      // 再判一次就是给一条永远不会为假的分支写测试。
      let month: number;
      let day: number;
      try {
        const d = parseLocalDate(anchor);
        month = d.getMonth() + 1;
        day = d.getDate();
      } catch {
        return undefined;
      }
      return Recurrence.yearly(month, day);
    }

    default: {
      // 穷尽性检查：往 `RepeatPresetId` 加一个成员却忘了在这里处理，typecheck 就红。
      const exhaustive: never = id;
      return exhaustive;
    }
  }
}