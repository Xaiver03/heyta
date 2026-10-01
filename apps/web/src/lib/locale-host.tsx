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
 *   - 显式选择要落盘、`<html lang>` 要跟着当前语言走。
 *
 * 🔴 **落盘挂在 setter 上，不挂在"locale 变了"这个 effect 上**（2026-10-01 实测改的）。
 * 以前这里是 `useRef(true)` 的"首启那一遍不落盘"写法，而它在**真浏览器里是坏的**：
 * `<StrictMode>`（`main.tsx` 四处都套着）在 dev 下把 effect **跑两遍、同一 dep、同一个 ref**，
 * 第一遍消耗掉 flag，第二遍就走落盘分支 —— 实测打印：
 *   effect pass 1 firstRun=true locale=en / effect pass 2 firstRun=false locale=en
 *   ⇒ 一个从没选过语言的访客，`localStorage['heyta.locale']` 已经是 `en`。
 * 后果不是"多写一个字节"：`hasStoredLocalePreference()` 从此为真 ⇒
 * **账号语言（解析链第 2 层）在 web 上永远不触发**，而界面看起来一切正常。
 * jsdom 那批用例挂的是没有 `<StrictMode>` 的 `LocaleHost`，所以它们测不到这件事。
 *
 * 现在的分工按**语义**而不是按"第几遍"：effect 只做幂等的 `activateLocale`
 * （同步 `<html lang>` 与订阅），写盘只发生在显式选择那一次调用里。
 *
 * 与移动端 `App.tsx` 的 `LocaleHost` 一一对应：移动端是设备语言 + 仅内存的覆盖，
 * web 是用户偏好 + 落盘。
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { I18nProvider, type Locale } from '@heyta/i18n';

import { activateLocale, applyLocale, resolveInitialLocale, subscribeLocale } from './locale.js';
import { LocalePreferenceProvider } from './locale-preference.js';

export function LocaleHost({ children }: { children: ReactNode }): React.JSX.Element {
  const [locale, setLocale] = useState<Locale>(resolveInitialLocale);

  /**
   * 只同步 DOM 与订阅 —— **不写盘**，因此跑几遍都一样（`<StrictMode>` 下会跑两遍）。
   */
  useEffect(() => {
    activateLocale(locale);
  }, [locale]);

  /**
   * 🔴 显式选择 = **一次动作**，不是一次"值变了"。落盘写在这里，
   * 于是"首启的推断值"无论被 React 重放多少次都不会冒充用户的选择
   * （文件头那条实测：以前它会冒充，账号语言从此永不触发）。
   *
   * ⚠️ 不把 `applyLocale` 塞进 `setLocale( updater )` 里：StrictMode 同样会
   * **重放 updater**，那就又回到"副作用跑两遍"。依赖数组带 `locale` ——
   * 引用只在语言真的变了才换，Provider 的 `useMemo` 因此不会每帧重建。
   */
  const selectLocale = useCallback(
    (next: Locale): void => {
      if (next === locale) return;
      applyLocale(next);
      setLocale(next);
    },
    [locale],
  );

  /**
   * 接住**非 React 侧**触发的切换：登录成功后采纳账号语言走的是
   * `applyLocale`（auth store，不在组件树里），没有这条订阅界面就不会跟上。
   * 不会成环：`setLocale(同值)` 被 React 的 Object.is 判定短路。
   */
  useEffect(() => subscribeLocale(setLocale), [setLocale]);

  return (
    <I18nProvider locale={locale}>
      <LocalePreferenceProvider locale={locale} setLocale={selectLocale}>
        {children}
      </LocalePreferenceProvider>
    </I18nProvider>
  );
}
