/**
 * 列举分隔符与成对括号 —— **正字法，不是文案**。
 *
 * 🔴 为什么不放进词条表：`、` 与 `（` `）` 这类纯标点一个汉字都没有，而
 * 词条表有两条硬规则都要求 zh 词条至少含一个汉字：
 *   1. `scripts/check-ui-language.mjs` 规则 2；
 *   2. `packages/i18n/tests/catalog.spec.ts`（它的 CJK 判据比门禁更严，
 *      连全角标点都不算数）。
 * 所以它们只能待在词条表之外。`apps/mobile/src/lib/recurrence-display.ts` 的
 * `LIST_SEPARATOR` 是同一处置 —— 那里也刻意没有把它做成词条。
 *
 * ⚠️ 放在 `features/ai/` 而不是 `apps/web/src/lib/`：后者属于别的迁移批次，
 * 本轮不动。AI 面板与设置页（`features/settings/`）都从这里取。
 */
import type { Locale } from '@heyta/i18n';

/** 列举分隔符：中文用顿号，英文用逗号加空格。 */
export const LIST_SEPARATOR: Record<Locale, string> = {
  'zh-CN': '、',
  en: ', ',
};

/** 成对括号，顺序是 `[开, 闭]`。中文用全角，英文用半角。 */
export const PAIRED_PARENS: Record<Locale, readonly [open: string, close: string]> = {
  'zh-CN': ['（', '）'],
  en: ['(', ')'],
};

/**
 * 日期 + 人话剩余时间的外壳：中文 `2026-09-26（明天）`，英文 `2026-09-26 (tomorrow)`。
 *
 * ⚠️ 英文这边多一个空格，中文不加 —— 这同样是**正字法**，不是文案。
 * 汉字在 `remaining`（它由 `formatRemainingUntil()` / `formatDueDate()` 产出，
 * 两者都在跨包的 `packages/domain`，本轮不迁）。
 */
export function dateWithRemaining(date: string, remaining: string, locale: Locale): string {
  const [open, close] = PAIRED_PARENS[locale];
  const gap = locale === 'zh-CN' ? '' : ' ';
  return `${date}${gap}${open}${remaining}${close}`;
}
