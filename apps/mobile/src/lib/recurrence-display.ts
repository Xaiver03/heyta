/**
 * 重复规则的显示
 * =================
 *
 * 🔴 **这里不重新实现 RRULE。** "这条规则是什么意思"由 `@heyta/domain` 的
 * `recurrenceParts` 给出（freq / interval / 星期码 / 几号 / 月份），
 * 本文件只负责"怎么说出来"。
 *
 * 为什么必须这样分：域层的 `describeRecurrence` 返回的是**中文句子**
 * （「每周一、三」），而它同时承担了"解析"和"措辞"两件事。
 * 移动端此前直接渲染它的返回值，于是英文界面上出现中文 ——
 * 而且它是跨包的返回值，`check:ui-language` 门禁**扫不到**
 * （门禁只看 JSX 属性与 JSX 文本节点）。
 *
 * 另一条路是移动端自己再写一遍 RRULE 解析，那是**两份实现**：
 * RFC 5545 的 `BYDAY`/`BYMONTHDAY` 组合语义极刁钻（`packages/domain/src/recurrence.ts`
 * 开头那段警告），两份迟早在一个边缘上分叉，而且是"看起来对、偶尔错一次"那种。
 * 所以解析留一份，措辞各写各的 —— 与 `remainingText` / `formatRemaining`
 * 是同一个套路。
 *
 * ⚠️ 中文那一份的措辞是**照抄** `describeRecurrence` 的，
 * `apps/mobile/tests/recurrence-display.spec.ts` 拿它当**独立参照**逐条比对：
 * 迁移不能让中文用户看到的话变一个字。
 */

import { recurrenceParts } from '@heyta/domain';
import type { Locale, MessageKey } from '@heyta/i18n';

import type { Translate } from '../i18n/translate';

/**
 * 列举分隔符：**正字法，不是文案**，所以它不进口词表。
 *
 * 🔴 它一度是一条词条（`mobile.recurrence.listSeparator`），
 * 但 `catalog.spec.ts` 的"中文词条必须含汉字"把它判为违规 —— 而那条规则是对的：
 * 一条只有标点的词条**没办法自查语言**。
 *
 * 于是它回到代码里，按语言查表。代价是"再加一种语言"要在两处各改一行
 * （这里 + 词条表）；收益是那条防"用英文占位中文"的规则不被开一个口子。
 * 这个取舍是刻意的。
 */
const LIST_SEPARATOR: Record<Locale, string> = {
  'zh-CN': '、',
  en: ', ',
};

const WEEKDAY_KEYS: Record<string, MessageKey> = {
  MO: 'mobile.recurrence.weekday.mo',
  TU: 'mobile.recurrence.weekday.tu',
  WE: 'mobile.recurrence.weekday.we',
  TH: 'mobile.recurrence.weekday.th',
  FR: 'mobile.recurrence.weekday.fr',
  SA: 'mobile.recurrence.weekday.sa',
  SU: 'mobile.recurrence.weekday.su',
};

const MONTH_KEYS: Record<number, MessageKey> = {
  1: 'mobile.recurrence.month.1',
  2: 'mobile.recurrence.month.2',
  3: 'mobile.recurrence.month.3',
  4: 'mobile.recurrence.month.4',
  5: 'mobile.recurrence.month.5',
  6: 'mobile.recurrence.month.6',
  7: 'mobile.recurrence.month.7',
  8: 'mobile.recurrence.month.8',
  9: 'mobile.recurrence.month.9',
  10: 'mobile.recurrence.month.10',
  11: 'mobile.recurrence.month.11',
  12: 'mobile.recurrence.month.12',
};

/**
 * 序数词条只列到 5。
 *
 * 一个月里同一个星期几最多出现五次，所以 1–5 覆盖了所有**合法**的
 * `BYDAY=+nXX`。更大的数只能来自手写的规则串（不合法），走 `ordinal.n` 兜底 ——
 * 兜底存在是为了"显示得难看"而不是"崩掉"。
 */
const ORDINAL_KEYS: Record<number, MessageKey> = {
  1: 'mobile.recurrence.ordinal.1',
  2: 'mobile.recurrence.ordinal.2',
  3: 'mobile.recurrence.ordinal.3',
  4: 'mobile.recurrence.ordinal.4',
  5: 'mobile.recurrence.ordinal.5',
};

/** `+2WE` / `-1FR` / `WE` 里的序数部分。 */
const BYDAY_ORDINAL = /^([+-]?\d+)?([A-Z]{2})$/;

function ordinalText(n: number, t: Translate): string {
  return ORDINAL_KEYS[n] === undefined
    ? t('mobile.recurrence.ordinal.n', { n })
    : t(ORDINAL_KEYS[n]);
}

function weekdayText(code: string, t: Translate): string {
  const key = WEEKDAY_KEYS[code];
  // 理论上到不了这里：`recurrenceParts` 遇到不认识的星期码会返回 `null`。
  // 仍然兜底，因为"显示成一个码"比"显示成 undefined"容易查。
  return key === undefined ? code : t(key);
}

function monthText(month: number, t: Translate): string {
  const key = MONTH_KEYS[month];
  return key === undefined ? String(month) : t(key);
}

/** `14` → 「14 日」/「day 14」；`-1` → 「最后一天」/「the last day」。 */
function monthDayText(day: number, t: Translate): string {
  if (day === -1) return t('mobile.recurrence.day.last');
  if (day < 0) return t('mobile.recurrence.day.beforeEnd', { n: -day });
  return t('mobile.recurrence.monthDay.n', { n: day });
}

/** 年度规则里的"几号"。与 {@link monthDayText} 分开：英文模板里不带 `day`。 */
function yearDayText(day: number, t: Translate): string {
  if (day === -1) return t('mobile.recurrence.day.last');
  if (day < 0) return t('mobile.recurrence.day.beforeEnd', { n: -day });
  return t('mobile.recurrence.yearDay.n', { n: day });
}

/** `+2WE` → 「第 2 个周三」/「the second Wednesday」；`WE` → 「周三」/「Wednesday」。 */
function byDayText(raw: string, t: Translate): string {
  const match = BYDAY_ORDINAL.exec(raw);
  const weekday = weekdayText(match?.[2] ?? raw, t);
  const nth = match?.[1];
  if (nth === undefined) return t('mobile.recurrence.byDay.plain', { weekday });

  const n = Number(nth);
  if (n === -1) return t('mobile.recurrence.byDay.last', { weekday });
  if (n < 0) {
    return t('mobile.recurrence.byDay.beforeLast', { ordinal: ordinalText(-n, t), weekday });
  }
  return t('mobile.recurrence.byDay.nth', { ordinal: ordinalText(n, t), weekday });
}

/**
 * 规则串 → 当前语言的句子。**描述不了就原样返回规则串**。
 *
 * 返回原始串而不是"未知规则"这类兜底话，是因为原始串至少是可行动的：
 * 用户能把它复制去别处、也能看出是哪一段没被支持。
 *
 * `locale` 只用来取列举分隔符（见 {@link LIST_SEPARATOR}）——
 * 它必须要，因为那个分隔符是正字法、不在词条表里。
 */
export function describeRecurrenceText(rule: string, t: Translate, locale: Locale): string {
  const parts = recurrenceParts(rule);
  if (parts === null) return rule;

  const separator = LIST_SEPARATOR[locale];
  const every = parts.interval === 1;
  const n = parts.interval;

  switch (parts.kind) {
    case 'daily':
      return every ? t('mobile.recurrence.daily') : t('mobile.recurrence.dailyEvery', { n });

    case 'weekly': {
      if (parts.weekdays.length === 0) {
        return every ? t('mobile.recurrence.weekly') : t('mobile.recurrence.weeklyEvery', { n });
      }
      const days = parts.weekdays.map((code) => weekdayText(code, t)).join(separator);
      return every
        ? t('mobile.recurrence.weeklyOn', { days })
        : t('mobile.recurrence.weeklyOnEvery', { n, days });
    }

    case 'monthlyByMonthDay':
    case 'monthlyByWeekday': {
      const days =
        parts.kind === 'monthlyByMonthDay'
          ? parts.monthDays.map((day) => monthDayText(day, t)).join(separator)
          : parts.byDays.map((raw) => byDayText(raw, t)).join(separator);
      return every
        ? t('mobile.recurrence.monthlyOn', { days })
        : t('mobile.recurrence.monthlyOnEvery', { n, days });
    }

    case 'monthly':
      return every ? t('mobile.recurrence.monthly') : t('mobile.recurrence.monthlyEvery', { n });

    case 'yearly': {
      if (parts.months.length === 0) {
        return every ? t('mobile.recurrence.yearly') : t('mobile.recurrence.yearlyEvery', { n });
      }
      const months = parts.months.map((month) => monthText(month, t)).join(separator);
      if (parts.monthDays.length === 0) {
        return every
          ? t('mobile.recurrence.yearlyInMonths', { months })
          : t('mobile.recurrence.yearlyInMonthsEvery', { n, months });
      }
      const days = parts.monthDays.map((day) => yearDayText(day, t)).join(separator);
      return every
        ? t('mobile.recurrence.yearlyOnMonthDays', { months, days })
        : t('mobile.recurrence.yearlyOnMonthDaysEvery', { n, months, days });
    }
  }
}