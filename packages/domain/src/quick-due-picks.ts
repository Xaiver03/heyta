/**
 * 截止日期的快捷项（纯日期数学，零文案）
 * ========================================
 *
 * 从 `apps/mobile/src/lib/quick-dates.ts` 上提（那边的文件头早写了：
 * "如果将来 Web 也要这套按钮，本文件应当整体提到 packages/domain"）——
 * 批一给 web 补 due 事后编辑时，两端都要同一组按钮，于是按它自己的
 * 预言落到这里。文案（"今天/明天…"）留在各端：共享层不 import i18n。
 *
 * 🔴 全部走 `addDays` / `isoWeekday`，**不自己算** `+7*86400000`：
 * 夏令时那天一天不是 24 小时，常数加法会错一小时，累积后可能整日偏差
 * （`date.ts` 的文件头写明了这个理由）。
 *
 * ⚠️ 与 `capture.ts` 的关系：那边是**文本规则**（用户打"明天"），
 * 这里是**按钮**（用户点"明天"）。两者算出的日期必须一致，
 * 所以都落到同一组 `addDays` 上。
 */

import { addDays, isoWeekday, type LocalDate } from './date.js';

/** 稳定 key：UI 拿它做 `key`、"当前选中"判定与文案映射。 */
export type QuickDuePickKey = 'today' | 'tomorrow' | 'weekend' | 'next-week';

export interface QuickDuePickDate {
  readonly key: QuickDuePickKey;
  readonly date: LocalDate;
}

/**
 * 顺序固定：今天 → 明天 → 本周末 → 下周一。
 *
 * 「本周末」= **本周的周日**（ISO 周，周一到周日）。
 * 今天是周日时它就是今天 —— 这是刻意的：说"本周末"而给出**下**周日，
 * 会让用户在周日当天点"本周末"却跳到 7 天后。
 *
 * 「下周一」= 从今天算起的下一个周一。今天是周日时就是明天。
 */
export function quickDuePickDates(now: LocalDate): readonly QuickDuePickDate[] {
  const weekday = isoWeekday(now); // 1=周一 … 7=周日
  return [
    { key: 'today', date: now },
    { key: 'tomorrow', date: addDays(now, 1) },
    { key: 'weekend', date: addDays(now, 7 - weekday) },
    { key: 'next-week', date: addDays(now, 8 - weekday) },
  ];
}
