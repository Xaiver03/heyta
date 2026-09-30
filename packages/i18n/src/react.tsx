/**
 * React 绑定（**默认全表版**）。
 *
 * 为什么放在同一个包里，而不是让三个外壳各写一份 Provider：
 * 宿主接线**复制三次就会漂移**（AGENTS.md §3.5 末尾那条教训，
 * 以及 check:layering 的门禁来由）—— 三份 Provider 迟早在
 * 「默认语言是谁」「切换时要不要写 localStorage」上分出岔。
 *
 * `react` 是 peerDependency，三个外壳各带自己的一份：
 * react-dom 19.2/19.3 与 React Native 19.2.3 都能用同一套 context。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这个 Provider 会把**中英两份词条**都装进产物（因为它在 `translate.ts`
 * 取默认表）。web / mobile 无所谓（它们本来就只有一份整包），
 * **落地页不行** —— 它是多 HTML 入口的静态站，每个入口只服务一种语言。
 * 落地页走 `@heyta/i18n/provider` 的 `I18nCatalogProvider` + 按语言动态 import
 * 单份表（R7，见 `catalog.ts` / `provider.tsx` 文件头）。
 *
 * 两个 Provider 共用 `provider.tsx` 里的同一套 context，所以
 * `useI18n()` / `useLocale()` 在哪种 Provider 下都成立 —— 不会出现
 * "某个宿主包了 Provider、但 hooks 从另一个入口 import 于是取不到表"。
 */

import { useMemo, type ReactNode } from 'react';

import { translateIn } from './catalog.js';
import { I18nCatalogProvider, useCatalog, useLocale } from './provider.js';
import { CATALOGS, translate } from './translate.js';
import { DEFAULT_LOCALE, type Locale, type MessageVars } from './types.js';
import type { MessageKey } from './locales/zh-CN.js';
import type { I18nValue } from './provider.js';

export { useLocale };
export type { I18nValue } from './provider.js';

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <I18nCatalogProvider locale={locale} catalog={CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE]}>
      {children}
    </I18nCatalogProvider>
  );
}

/**
 * **宽松版 `useI18n`** —— 没有 Provider 时回落到默认全表。
 *
 * 🔴 与 `provider.tsx` 里的严格版**故意不同**，两边各有各的理由：
 *   · 严格版（`@heyta/i18n/provider`）：落地页单语言入口用。缺表必须**响亮地炸**,
 *     因为静默回落会把"忘了给表"变成"英文页渲染中文"；
 *   · 宽松版（本文件，根入口）：web / mobile / 大量既有测试用。它们要么自己包了
 *     Provider（走 catalog），要么在测试里**裸渲染**一个组件 —— 后者在本仓库里
 *     是既成事实（283 条用例），把"没有 Provider"变成硬失败等于要求全仓补测试
 *     脚手架，而那与本刀（落地页体积）无关。
 *
 * ⚠️ 两版的差别只在"没表时怎么办"，取词逻辑仍共用 `catalog.ts` 的 `translateIn`。
 */
export function useI18n(): I18nValue {
  const locale = useLocale();
  const catalog = useCatalog();
  return useMemo(
    () => ({
      locale,
      t: (key: MessageKey, vars?: MessageVars) =>
        catalog === undefined ? translate(locale, key, vars) : translateIn(catalog, locale, key, vars),
    }),
    [locale, catalog],
  );
}
