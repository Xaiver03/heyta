/**
 * React 绑定。
 *
 * 为什么放在同一个包里，而不是让三个外壳各写一份 Provider：
 * 宿主接线**复制三次就会漂移**（AGENTS.md §3.5 末尾那条教训，
 * 以及 check:layering 的门禁来由）—— 三份 Provider 迟早在
 * 「默认语言是谁」「切换时要不要写 localStorage」上分出岔。
 *
 * `react` 是 peerDependency，三个外壳各带自己的一份：
 * react-dom 19.2/19.3 与 React Native 19.2.3 都能用同一套 context。
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { MessageKey } from './locales/zh-CN.js';
import { translate } from './translate.js';
import { DEFAULT_LOCALE, type Locale, type MessageVars } from './types.js';

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export interface I18nValue {
  locale: Locale;
  /** 取词条。key 是编译期校验的联合类型，拼错会直接报类型错误。 */
  t: (key: MessageKey, vars?: MessageVars) => string;
}

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}): React.JSX.Element {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/** 只关心当前语言时用它（语言切换器、`<html lang>` 同步）。 */
export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/**
 * 组件里取词条。
 *
 * `useMemo` 依赖只有 locale，所以同一次渲染里 `t` 是稳定引用 ——
 * 把它放进 `useEffect` 依赖数组不会每帧重跑。
 */
export function useI18n(): I18nValue {
  const locale = useLocale();
  return useMemo(
    () => ({
      locale,
      t: (key: MessageKey, vars?: MessageVars) => translate(locale, key, vars),
    }),
    [locale],
  );
}
