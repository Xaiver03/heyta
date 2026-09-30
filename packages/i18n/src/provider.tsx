/**
 * React 绑定（**不含任何词条表**）—— 落地页的单语言入口用这一份
 * ==================================================================
 *
 * 与 `react.tsx` 的关系：那个文件导出的是"**默认全表版** `I18nProvider`"
 * （web / mobile / 测试用，行为与拆分前逐字不变）；这里导出的是
 * **必须显式给表**的 `I18nCatalogProvider`，于是 import 本文件的模块
 * **不会**顺带把中英两份词条拖进产物。
 *
 * 🔴 落地页为什么要走这条路：它是多 HTML 入口的静态站，`/signin/` 永远不需要
 * 英文表、`/en/signin/` 永远不需要中文表。实测两份表合计约 **93 KB gz**，
 * 而主包共 205 KB gz —— 不拆的话每个入口都为另一种语言付一半的体积。
 *
 * ⚠️ 两个 Provider 共用**同一套 context**（都在本文件里），所以
 * `useI18n()` 在两种 Provider 下都成立 —— 不会出现"某个宿主包了 Provider、
 * 但 hooks 从另一个入口 import 于是取不到表"这种只在运行时炸的错。
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { translateIn, type Catalog } from './catalog.js';
import type { MessageKey } from './locales/zh-CN.js';
import { DEFAULT_LOCALE, type Locale, type MessageVars } from './types.js';

/** 当前语言。**默认值是兜底语言**，与拆分前一致。 */
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/** 当前语言的表。`undefined` = 没人给表（此时取词条会**响亮地抛**）。 */
const CatalogContext = createContext<Catalog | undefined>(undefined);

export interface I18nValue {
  locale: Locale;
  /** 取词条。key 是编译期校验的联合类型，拼错会直接报类型错误。 */
  t: (key: MessageKey, vars?: MessageVars) => string;
}

/**
 * 显式给表的 Provider。
 *
 * `catalog` 必填 —— 这正是"不会拖进另一种语言"的机制：调用方按当前入口的
 * 语言**动态** import 那一份表（见 `apps/landing/src/main.tsx`）。
 */
export function I18nCatalogProvider({
  locale,
  catalog,
  children,
}: {
  locale: Locale;
  catalog: Catalog;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <LocaleContext.Provider value={locale}>
      <CatalogContext.Provider value={catalog}>{children}</CatalogContext.Provider>
    </LocaleContext.Provider>
  );
}

/** 只关心当前语言时用它（语言切换器、`<html lang>` 同步）。 */
export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/**
 * 当前上下文里的表（**可能就是 `undefined`**）。
 *
 * 给 `react.tsx` 的"宽松版 `useI18n`"用：那个版本在没有 Provider 时会回落到
 * 默认全表（web / mobile / 大量既有测试依赖这条旧行为），而本文件里的严格版
 * 刻意**不回落** —— 落地页的单语言入口一旦缺表，宁可响亮地炸，也不要静默
 * 渲染成另一种语言。
 */
export function useCatalog(): Catalog | undefined {
  return useContext(CatalogContext);
}

/**
 * 组件里取词条。
 *
 * `useMemo` 依赖只有 locale 与 catalog，所以同一次渲染里 `t` 是稳定引用 ——
 * 把它放进 `useEffect` 依赖数组不会每帧重跑。
 *
 * 🔴 没有表时**抛错而不是回落到某个语言的表**：静默回落会让
 * `/en/signin/` 在缺少英文表时渲染成中文，而爬虫与分享卡片拿到的就是那份 ——
 * 一个"看起来只是没翻译"的假象。
 */
export function useI18n(): I18nValue {
  const locale = useLocale();
  const catalog = useContext(CatalogContext);
  return useMemo(
    () => ({
      locale,
      t: (key: MessageKey, vars?: MessageVars) => {
        if (catalog === undefined) {
          throw new Error(
            '[@heyta/i18n] useI18n 必须在 I18nCatalogProvider（或 I18nProvider）内使用 —— ' +
              '这里刻意不回落：回落到另一种语言会静默渲染错语言。',
          );
        }
        return translateIn(catalog, locale, key, vars);
      },
    }),
    [locale, catalog],
  );
}

// ── 与语言有关的常量与类型（catalog-free）────────────────────────────
// 落地页只 import 本文件，所以这些必须从这里也能拿到，否则它会去 import 根入口
// —— 而根入口 Re-export 了 CATALOGS，两份表就又回来了。
export { DEFAULT_LOCALE, LOCALES, otherLocale } from './types.js';
export type { Locale, MessageVars } from './types.js';
export type { MessageKey } from './locales/zh-CN.js';
export type { Catalog } from './catalog.js';
