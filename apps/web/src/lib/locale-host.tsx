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

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { I18nProvider, type Locale } from '@heyta/i18n';

import { activateLocale, applyLocale, resolveInitialLocale, subscribeLocale } from './locale.js';
import { LocalePreferenceProvider } from './locale-preference.js';

export function LocaleHost({ children }: { children: ReactNode }): React.JSX.Element {
  const [locale, setLocale] = useState<Locale>(resolveInitialLocale);

  /**
   * 🔴 **首启只激活、不落盘**：首启值来自推断（`navigator.language` / `?lang=`），
   * 不是用户的选择。落了盘，`hasStoredLocalePreference()` 就会把推断误判成
   * "选过"，登录后的**账号语言采纳**（解析链第 2 层）从此永远不触发 ——
   * 那正是"新设备首登即得账号语言"要走的门。之后每次真正的变化才 `applyLocale`。
   */
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      activateLocale(locale);
      return;
    }
    applyLocale(locale);
  }, [locale]);

  /**
   * 接住**非 React 侧**触发的切换：登录成功后采纳账号语言走的是
   * `applyLocale`（auth store，不在组件树里），没有这条订阅界面就不会跟上。
   * 不会成环：`setLocale(同值)` 被 React 的 Object.is 判定短路。
   */
  useEffect(() => subscribeLocale(setLocale), [setLocale]);

  return (
    <I18nProvider locale={locale}>
      <LocalePreferenceProvider locale={locale} setLocale={setLocale}>
        {children}
      </LocalePreferenceProvider>
    </I18nProvider>
  );
}
