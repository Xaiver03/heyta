/**
 * 主题（明暗）× 预设（表面色系）
 * ==============================
 *
 * 两个**正交**的维度，各写一个 DOM 钩子，tokens.css 各自有块：
 *   - 明暗 → `<html data-theme="light|dark">`（暗色覆盖挂在这个属性上）
 *   - 预设 → `<html data-theme-preset="default|warm|mist">`（只换表面色系）
 * **不做逐组件换色**：那样每个新组件都要记得处理明暗，必然漏。
 *
 * 🔴 全部是**设备属性**（ADR-0085）：写本机、零 op。"我这台机器长什么样"
 * 不是"这份数据变了"，所以这里一行 `dispatch(` 都不该有 —— 判据在
 * `apps/web/tests/theme-prefs.spec.ts`（换预设/切明暗后 op-log 条数不变）。
 *
 * ⚠️ 与 `locale.ts` / `focus-config.ts` 同一契约：读 `localStorage` 可能抛
 * （隐私模式），所以读/写两个纯函数各自 try/catch，静默降级。
 */

export type Theme = 'light' | 'dark';

/**
 * 表面色系预设。`default` = 不写 `data-theme-preset` 属性（=基准蓝白）。
 * 新增一个预设要同时：`tokens.css` 加两组块（亮/暗）、这里加成员、
 * `tokens.spec.ts` 的 `PRESETS` 加一项、设置页的选项列表加一条。
 */
export type ThemePreset = 'default' | 'warm' | 'mist';

/** 可选的预设，顺序即设置页里的显示顺序。 */
export const THEME_PRESETS: readonly ThemePreset[] = ['default', 'warm', 'mist'];

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

/**
 * 预设的存储键。与 `THEME_STORAGE_KEY` 同族，同样只导出给判据用。
 */
export const THEME_PRESET_STORAGE_KEY = 'heyta.themePreset';

/** 读预设。认不出（脏值 / 旧版本 / 已删掉的预设）一律回落 `default`。 */
export function resolveInitialThemePreset(): ThemePreset {
  try {
    const stored = localStorage.getItem(THEME_PRESET_STORAGE_KEY);
    if (stored !== null && (THEME_PRESETS as readonly string[]).includes(stored)) {
      return stored as ThemePreset;
    }
  } catch {
    // 隐私模式：读不到就当没设过。
  }
  return 'default';
}

/**
 * 把预设应用到 DOM。与 `applyTheme` 同一契约：**刻意不写盘**。
 *
 * `default` 是**删属性**而不是写 `data-theme-preset="default"`：
 * 让"没设过"与"显式选了默认"在 DOM 上完全同形，于是基准那套 token 的值
 * 一字不改（判据：不设预设时 tokens.spec 的基准对比度读数与改前一致）。
 */
export function applyThemePreset(preset: ThemePreset): void {
  const root = document.documentElement;
  if (preset === 'default') delete root.dataset['themePreset'];
  else root.dataset['themePreset'] = preset;
}

/** 记下用户选的预设。只有设置页那条路配调用它（同 `rememberThemeChoice`）。 */
export function rememberThemePreset(preset: ThemePreset): void {
  try {
    localStorage.setItem(THEME_PRESET_STORAGE_KEY, preset);
  } catch {
    // 存不上不影响本次生效
  }
}

/**
 * 自动深浅（跟随系统）。**三态**：`light` / `dark` / `system`。
 *
 * 与 `resolveInitialTheme` 的关系要说清，否则会打架：
 *   1. 读**显式选择**（`heyta.theme`）；有就是它 —— 用户明说过，系统不能再改主意；
 *   2. 没有显式选择 ⇒ 跟随 `prefers-color-scheme`（这也是历史行为）；
 *   3. `system` 只是"把显式选择删掉"的一种表示 —— 所以它**不写盘**，而是**删键**。
 *      这样"从没选过"与"选了跟随系统"在存储里同形（都读不到），
 *      两者行为本来就一样，没必要分成两种状态。
 */
export type ThemeMode = 'light' | 'dark' | 'system';

export function resolveInitialThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // 隐私模式：读不到 ⇒ 跟随系统。
  }
  return 'system';
}

/** 自动深浅当前该落成什么（`system` 时问系统）。 */
export function resolvedThemeOf(mode: ThemeMode): Theme {
  if (mode === 'light' || mode === 'dark') return mode;
  if (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }
  return 'light';
}

/**
 * 记下显式选择；`system` 是**删键**（见上）。
 * 只有设置页那条路配调用它 —— 启动时那次 `applyTheme` 不写盘。
 */
export function rememberThemeMode(mode: ThemeMode): void {
  try {
    if (mode === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // 存不上不影响本次生效
  }
}
