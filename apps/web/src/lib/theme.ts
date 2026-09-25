/**
 * 主题切换（亮色 / 暗色）
 * =======================
 *
 * 直接改 `<html data-theme>` —— tokens.css 里的暗色覆盖就挂在这个属性上。
 * **不做逐组件换色**：那样每个新组件都要记得处理暗色，必然漏。
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'heyta.theme';

/**
 * 读取初始主题。
 *
 * 优先级：用户已选 > 系统偏好。
 * **不用 `prefers-color-scheme` 覆盖用户选择** —— 用户明确选了亮色，
 * 系统入夜自动切暗色会很唐突。
 */
export function resolveInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // 隐私模式下 localStorage 可能抛错。降级到系统偏好，不要崩。
  }
  if (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }
  return 'light';
}

/** 应用主题到 DOM 并持久化。 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // 存不上不影响本次生效
  }
}
