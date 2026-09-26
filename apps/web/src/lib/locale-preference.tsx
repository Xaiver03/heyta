/**
 * 语言偏好的宿主 context（web）
 * =================================
 *
 * 🔴 `@heyta/i18n` 的 `I18nProvider` **只读不写** —— 它把语言交给 `useI18n()`，
 * 没有 setter。落地页不需要 setter（切语言就是整页跳到另一个 URL），
 * 而 web 与移动端一样要在内存里改 state。
 *
 * 与移动端那两个文件的唯一区别是**持久化**：移动端的语言只在内存里
 * （重启回到设备语言）；web 的语言来源本来就是用户偏好，所以
 * `LocaleHost`（在 `main.tsx`）会把每次选择经 `applyLocale` 写进
 * `localStorage` 并同步 `<html lang>`。
 *
 * 🔴 setter 仍只属于宿主，不塞进 `I18nProvider`：那是三个宿主共用的包，
 * 给它加 setter 会诱导别人写出"改了语言但地址没变"的落地页。
 */

import React, { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Locale } from '@heyta/i18n';

export interface LocalePreferenceValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
}

const LocalePreferenceContext = createContext<LocalePreferenceValue | null>(null);

export function LocalePreferenceProvider({
  locale,
  setLocale,
  children,
}: LocalePreferenceValue & { children: ReactNode }): React.JSX.Element {
  // `setLocale` 是宿主传进来的稳定引用，`locale` 变才需要新对象。
  const value = useMemo<LocalePreferenceValue>(() => ({ locale, setLocale }), [locale, setLocale]);
  return (
    <LocalePreferenceContext.Provider value={value}>{children}</LocalePreferenceContext.Provider>
  );
}

/**
 * 语言切换器用它取当前语言与切换动作。
 *
 * ⚠️ 这里**刻意**在 Provider 之外抛错：调用它的一定是应用内的切换器，
 * 而切换器必须在 Provider 内（否则 setLocale 无处落地，点了没反应）。
 * 崩溃屏 `ErrorScreen` 不走这条路 —— 它只用 `useI18n()`，见那边的注释。
 */
export function useLocalePreference(): LocalePreferenceValue {
  const value = useContext(LocalePreferenceContext);
  if (value === null) {
    throw new Error('useLocalePreference 必须在 <LocalePreferenceProvider> 内使用。');
  }
  return value;
}
