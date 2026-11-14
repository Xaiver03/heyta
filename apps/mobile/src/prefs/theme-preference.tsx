/**
 * 主题偏好（设备本地，**永不进同步**）
 * ====================================
 *
 * 存在 `device-prefs` 那本 SQLite 里（`theme.scheme` 一个键），
 * 与「欢迎页看过没有」同一套读写 —— 不引新的原生依赖，理由见那边文件头。
 *
 * ## 为什么不放进同步 schema
 *
 * 主题是**这台设备这一刻的显示条件**：手机在暗处、桌面在窗边，
 * 同一套偏好跟到另一台设备上没有意义，反而会覆盖那台设备上更合适的设置。
 * 与语言偏好不同的是：语言有 `setWidgetLocale` 那个原生通道（小组件也要用），
 * 主题没有 —— 所以它走 device-prefs。
 *
 * ## 三档，不是两档
 *
 * `'system' | 'light' | 'dark'`。少了 `'system'` 就只能二选一，
 * 而"跟随系统"是最合理的默认（用户改系统设置时不必回来改一次）。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { readDevicePref, writeDevicePref } from './device-prefs';

export type ThemeScheme = 'system' | 'light' | 'dark';

const PREF_KEY_THEME_SCHEME = 'theme.scheme';

const SCHEMES: readonly ThemeScheme[] = ['system', 'light', 'dark'];

/** 把存下来的字符串收窄成三档。认不出来一律回 `'system'` —— 不猜用户意图。 */
export function normalizeThemeScheme(raw: string | undefined): ThemeScheme {
  return SCHEMES.find((s) => s === raw) ?? 'system';
}

/**
 * 冷启动读一次。**永不抛**：读盘失败等于"没设过"，回落到跟随系统。
 *
 * 🔴 与 `device-prefs` 同一条纪律：调用点在应用启动的第一帧上，
 * 在那里抛异常 = 应用起不来，而代价只是"主题没按上次的来"。
 */
export function resolveThemeScheme(): ThemeScheme {
  try {
    return normalizeThemeScheme(readDevicePref(PREF_KEY_THEME_SCHEME));
  } catch {
    return 'system';
  }
}

interface ThemePreferenceValue {
  readonly scheme: ThemeScheme;
  /** 写内存 + 落盘。落盘失败**不回滚** —— 本次会话已经生效，只是下次启动会回到旧值。 */
  readonly setScheme: (next: ThemeScheme) => void;
}

const ThemePreferenceContext = createContext<ThemePreferenceValue | null>(null);

export function ThemePreferenceProvider({
  scheme,
  setScheme,
  children,
}: ThemePreferenceValue & { children: ReactNode }): React.JSX.Element {
  // 落盘在 effect 里：`setScheme` 可能被同一帧调多次（用户连点），
  // 每次同步写一次 SQLite 没必要；effect 只跑最后那个值。
  useEffect(() => {
    try {
      writeDevicePref(PREF_KEY_THEME_SCHEME, scheme);
    } catch {
      // 写不进就写不进（见上面"永不抛"）。这次的显示已经对了。
    }
  }, [scheme]);

  const value = useMemo<ThemePreferenceValue>(
    () => ({ scheme, setScheme }),
    [scheme, setScheme],
  );
  return (
    <ThemePreferenceContext.Provider value={value}>{children}</ThemePreferenceContext.Provider>
  );
}

export function useThemePreference(): ThemePreferenceValue {
  const value = useContext(ThemePreferenceContext);
  if (value === null) {
    throw new Error('useThemePreference 必须在 <ThemePreferenceProvider> 内使用。');
  }
  return value;
}

/** 宿主根用：状态 + 读写一体，省掉在 `App.tsx` 里再拼一遍。 */
export function useThemeSchemeState(): {
  readonly scheme: ThemeScheme;
  readonly setScheme: (next: ThemeScheme) => void;
} {
  const [scheme, setSchemeState] = useState<ThemeScheme>(resolveThemeScheme);
  const setScheme = useCallback((next: ThemeScheme) => {
    setSchemeState(next);
  }, []);
  return { scheme, setScheme };
}
