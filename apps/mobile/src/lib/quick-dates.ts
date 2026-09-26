/**
 * 截止日期的快捷选择
 * ====================
 *
 * 手机上手动翻月历选"下周一"是很烦的动作，而用户**天天**都要做这件事。
 * 快捷项把它变成一次点击。
 *
 * 🔴 这些计算全部走 `@heyta/domain` 的 `addDays` / `isoWeekday`，
 * 不自己算 `+7*86400000` —— 夏令时那天会错一小时，累积后可能整日偏差
 * （`packages/domain/src/date.ts` 里写明了这个理由）。
 *
 * ⚠️ 与 `@heyta/domain` 的 `capture.ts` 关系：那边是**文本规则**
 * （用户打"明天"），这里是**按钮**（用户点"明天"）。两者算出来的日期
 * 必须一致，所以都落到同一组 `addDays`/`today` 上。
 * 如果将来 Web 也要这套按钮，本文件应当整体提到 `packages/domain`。
 */

import { addDays, isoWeekday, type LocalDate } from '@heyta/domain';
import type { MessageKey } from '@heyta/i18n';

import type { Translate } from '../i18n/translate';

export interface QuickDatePick {
  /** 稳定 key，UI 用它做 `key` 与"当前选中"判定。 */
  key: string;
  label: string;
  date: LocalDate;
}

/**
 * 顺序固定：今天 → 明天 → 本周末 → 下周一。
 *
 * 「本周末」= **本周的周日**（ISO 周，周一到周日）。
 * 今天是周日时它就是今天 —— 这是刻意的：说"本周末"而给出**下**周日，
 * 会让用户在周日当天点"本周末"却跳到 7 天后。
 *
 * 「下周一」= 从今天算起的下一个周一。今天是周日时就是明天。
 *
 * ⚠️ `t` 由调用方传入：本函数是纯函数（有单测），**不能**从 context 取。
 */
export function quickDatePicks(now: LocalDate, t: Translate): QuickDatePick[] {
  const weekday = isoWeekday(now); // 1=周一 … 7=周日
  const pick = (key: string, labelKey: MessageKey, date: LocalDate): QuickDatePick => ({
    key,
    label: t(labelKey),
    date,
  });
  return [
    pick('today', 'mobile.common.today', now),
    pick('tomorrow', 'mobile.quickDate.tomorrow', addDays(now, 1)),
    pick('weekend', 'mobile.quickDate.weekend', addDays(now, 7 - weekday)),
    pick('next-week', 'mobile.quickDate.nextWeek', addDays(now, 8 - weekday)),
  ];
}
