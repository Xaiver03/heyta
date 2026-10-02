/**
 * React Native 侧的 token 消费层
 * ==============================
 *
 * `generated/tokens.native.ts` 是**数据**；这里补上 RN 特有的两件 CSS 帮我们做掉的事。
 *
 * 🔴 为什么 RN 需要额外一层，而 Web 不需要
 *
 * 1. **RN 没有 `var()`，也没有层叠。** CSS 里 `prefers-color-scheme` 和
 *    `prefers-reduced-motion` 由浏览器自动求值；RN 里这两个都得**自己判断并显式取值**。
 * 2. **`useColorScheme()` 会返回 `null`。** 它的类型是
 *    `'light' | 'dark' | null | undefined` —— `null` 表示"系统未指定"，
 *    不是"亮色"。直接拿它当索引会得到 `undefined`，而 RN 拿到 `undefined` 颜色
 *    **不报错，只是不渲染**。所以必须先归一化。
 * 3. **减少动效是覆盖层，不是主题。** 它只覆盖少数会动的 token，
 *    必须与主题表**合并**后再用，不能二选一。
 *
 * 这一层不做任何取值转换 —— 值全部来自生成产物，与 Web/Swift/ArkTS 同源。
 */

import {
  darkTokens,
  lightTokens,
  reducedMotionTokens,
  reducedTransparencyLightTokens,
  reducedTransparencyDarkTokens,
  THEME_NAMES,
  type HeytaNativeTokens,
  type ThemeName,
} from './generated/tokens.native.js';

export { darkTokens, lightTokens, reducedMotionTokens, reducedTransparencyLightTokens, reducedTransparencyDarkTokens, THEME_NAMES };
export type { HeytaNativeTokens, ThemeName };

/**
 * RN `useColorScheme()` / `Appearance.getColorScheme()` 的返回形态。
 *
 * ⚠️ `'unspecified'` 是**真的会出现**的：Android 在某些机型/系统版本上就是这样
 * 上报"用户没设过"的。漏掉它不会在运行时出错（`resolveThemeName` 只判 `=== 'dark'`），
 * 但会让调用方在类型检查时被迫写一次无意义的强转 —— 而强转正是把
 * "类型没表达真实情况"这件事盖住的东西（AGENTS.md §7 第 14 条）。
 */
export type ColorSchemeLike = 'light' | 'dark' | 'unspecified' | null | undefined;

/**
 * 把 RN 的配色方案归一化成主题名。
 *
 * 除 `'dark'` 外一律 `'light'` —— `null`/`undefined`/`'unspecified'` 都是
 * "系统没指定"，而 heyta 是蓝白亮色系。暗色必须实测过才交付
 * （见 `design-system/heyta/MASTER.md`），不能靠猜。
 */
export function resolveThemeName(scheme: ColorSchemeLike): ThemeName {
  return scheme === 'dark' ? 'dark' : 'light';
}

/** 取某一主题的**完整** token 表。 */
export function tokensForTheme(theme: ThemeName): HeytaNativeTokens {
  return theme === 'dark' ? darkTokens : lightTokens;
}

export interface ResolveOptions {
  theme: ThemeName;
  /** 系统是否开启「减少动效」。 */
  reducedMotion?: boolean;
  /**
   * 系统是否开启「减少透明度」（ADR-0042 §4：材质要能退让）。
   * web 上由共享层 theme 用 `matchMedia` 检测；RN 原生没有等价系统偏好，
   * 保持 false（原生端材质本来就是「诚实不透明」，见 material-surface.ts）。
   */
  reducedTransparency?: boolean;
}

/**
 * 取出最终要用的 token 表。
 *
 * 开启减少动效时把覆盖层合并进来。返回的仍是**完整**表：
 * 覆盖层只含少数 token，其余原样保留。
 */
export function resolveNativeTokens(options: ResolveOptions): HeytaNativeTokens {
  const base = tokensForTheme(options.theme);
  let tokens = base;
  if (options.reducedMotion) {
    tokens = { ...tokens, ...reducedMotionTokens };
  }
  if (options.reducedTransparency) {
    // 覆盖层是 per-theme 的：tint 压成的是 var(--ht-color-surface)，
    // 亮暗各解析各的（生成时已展开）。
    tokens = {
      ...tokens,
      ...(options.theme === 'dark' ? reducedTransparencyDarkTokens : reducedTransparencyLightTokens),
    };
  }
  return tokens;
}
