/**
 * 主题切换（亮色 / 暗色）
 * =======================
 *
 * 直接改 `<html data-theme>` —— tokens.css 里的暗色覆盖就挂在这个属性上。
 * **不做逐组件换色**：那样每个新组件都要记得处理暗色，必然漏。
 */

export type Theme = 'light' | 'dark';

/**
 * 存储键。🔴 导出只给判据用（测试里"启动后没记账"要看的就是这一个键），
 * 产品代码一律通过下面两个函数访问它 —— 免得键名在别处被抄第二份。
 */
export const THEME_STORAGE_KEY = 'heyta.theme';

/**
 * 读取初始主题。
 *
 * 优先级：用户已选 > 系统偏好。
 * **不用 `prefers-color-scheme` 覆盖用户选择** —— 用户明确选了亮色，
 * 系统入夜自动切暗色会很唐突。
 */
export function resolveInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
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

/**
 * 把主题应用到 DOM。**刻意不写盘**。
 *
 * 🔴 为什么必须把"应用"与"记住"分开（2026-10-02 实测到的缺陷）：启动时也要应用一次
 * 主题，而如果应用顺手写盘，那么**每一次启动都在替用户做一次选择** ——
 * 上面那条"用户已选 > 系统偏好"的优先级从此永远命中那一条没人做过的选择。
 * 症状是"操作系统入夜切暗色，应用永远是亮的"，而且**没人能复现成 bug**：
 * 界面上那个开关明明在，用户以为是自己没点。
 * 真浏览器验收里这条更难看见：`emulateMedia({colorScheme:'dark'})` 之后刷新，
 * `<html data-theme>` 仍是 `light`，读起来像"暗色主题坏了"。
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;
}

/**
 * 记下**用户自己**做过的选择（只有开关那条路配调用它）。
 *
 * ⚠️ 存不上不致命（隐私模式），与 `applyTheme` 一样静默降级。
 */
export function rememberThemeChoice(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 存不上不影响本次生效
  }
}
