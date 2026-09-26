/**
 * 语言宿主（web）
 * =================
 *
 * 🔴 为什么它从 `main.tsx` 里搬出来单独放一个文件：**测试要能挂出和线上一样的壳。**
 *
 * `main.tsx` 在 import 时就有副作用（`createRoot`、`initOpLog`），测试 import 它会
 * 直接炸。于是"给 `<App />` 套上语言 Provider"这件事只有两条路：
 *   1. 测试里自己拼一遍 `I18nProvider` + `LocalePreferenceProvider` —— 那就是
 *      **第二份接线**，将来谁改了一处、另一处就悄悄漂移（本仓库最高发的失效形状）；
 *   2. 把这份接线搬到一个没有副作用、可以 import 的模块里，线上和测试共用。
 * 这里选 2。
 *
 * 三件事必须一起发生，缺一不可：
 *   - `I18nProvider` 提供 `useI18n()`（**只读**，没有 setter）；
 *   - `LocalePreferenceProvider` 提供 `setLocale`（切换器唯一的入口）；
 *   - `applyLocale(locale)` 落盘并把 `<html lang>` 同步过去。
 *     ⚠️ 它必须在 `useEffect` 里、**语言变了才跑**：初值来自 `localStorage`
 *     （`resolveInitialLocale`），启动时回写一次是多余的写。
 *
 * 与移动端 `App.tsx` 的 `LocaleHost` 一一对应：移动端是设备语言 + 仅内存的覆盖，
 * web 是用户偏好 + 落盘。
 */

import { useEffect, useState, type ReactNode } from 'react';

import { I18nProvider, type Locale } from '@heyta/i18n';

import { applyLocale, resolveInitialLocale } from './locale.js';
import { LocalePreferenceProvider } from './locale-preference.js';

export function LocaleHost({ children }: { children: ReactNode }): React.JSX.Element {
  const [locale, setLocale] = useState<Locale>(resolveInitialLocale);

  // 与 `App.tsx` 里 `applyTheme(theme)` 同一形状：语言变了才落盘并同步 <html lang>。
  useEffect(() => {
    applyLocale(locale);
  }, [locale]);

  return (
    <I18nProvider locale={locale}>
      <LocalePreferenceProvider locale={locale} setLocale={setLocale}>
        {children}
      </LocalePreferenceProvider>
    </I18nProvider>
  );
}
