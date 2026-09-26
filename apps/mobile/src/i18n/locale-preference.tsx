/**
 * 语言偏好的宿主 context
 * ========================
 *
 * 🔴 `@heyta/i18n` 的 `I18nProvider` **只读不写** —— 它把语言交给 `useI18n()`，
 * 没有 setter。落地页不需要 setter（切语言就是整页跳到另一个 URL），
 * 而移动端没有 URL，切换必须在内存里改 state。
 *
 * 为什么不把 setter 塞进 `I18nProvider`：那是三个宿主共用的包，
 * 落地页的"语言由地址决定"是**刻意的**（见 `apps/landing/src/lib/locale.ts`），
 * 给它加一个 setter 会诱导别人写出"改了语言但地址没变"的落地页。
 * 所以 setter 只属于移动端：放在这个 `apps/*` 的小 context 里。
 *
 * 🔴 **不用模块级可变状态 + 手写订阅**（那是 `sync/store.ts` 那类东西的写法，
 * 因为它要给非 React 层读）。这里唯一的消费者是「我的」屏，而它本来就在
 * React 树里 —— `useState` + `useMemo` 就够了，多一层订阅只会多一处能漂移的代码。
 *
 * 🔴 **语言只在内存里**：重启回到设备语言。与 `sync/config.ts` 的
 * 「凭据刻意不落盘」是同一条纪律 —— 不把用户偏好写进我们自己的存储。
 * 代价是每次冷启动都要重选一次，而目前的证据（单用户、单语言设备）
 * 还不支持为它引入一个持久化通道。
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
  // `setLocale` 是 React 的稳定 setter，`locale` 变才需要新对象。
  const value = useMemo<LocalePreferenceValue>(() => ({ locale, setLocale }), [locale, setLocale]);
  return (
    <LocalePreferenceContext.Provider value={value}>{children}</LocalePreferenceContext.Provider>
  );
}

export function useLocalePreference(): LocalePreferenceValue {
  const value = useContext(LocalePreferenceContext);
  if (value === null) {
    throw new Error('useLocalePreference 必须在 <LocalePreferenceProvider> 内使用。');
  }
  return value;
}
