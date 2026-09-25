/**
 * 移动端主题层
 * ============
 *
 * 把 `@heyta/design-system/native` 的 token 表接进 React，并补上 RN 独有的两件事：
 * 系统配色方案、系统「减少动效」。
 *
 * 🔴 设计系统的硬规则在这里同样适用（AGENTS.md §5）：
 * **组件禁止裸值。** 移动端没有 CSS 变量，所以"用 token" 的唯一形式
 * 就是**从 context 里取 `tokens['color.foreground']` 这种写法** ——
 * 类型是 `HeytaNativeTokens`，拼错 token 名**编译期就报错**，
 * 与 Web 端 `cssVar()` 提供的是同一种保护。
 */

import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme, AccessibilityInfo } from 'react-native';
import {
  resolveNativeTokens,
  resolveThemeName,
  resolveFontFamily,
  parseCssShadow,
  parseCubicBezier,
  resolveLineHeight,
  resolveTracking,
  resolveAllTextStyles,
  TEXT_STYLES,
  type HeytaNativeTokens,
  type ThemeName,
  type RnShadow,
  type CubicBezier,
  type RnTextStyle,
  type TextStyleName,
} from '@heyta/design-system';

export interface ThemeValue {
  tokens: HeytaNativeTokens;
  theme: ThemeName;
  reducedMotion: boolean;
  /**
   * 语义文字样式。**UI 排版一律用这个，不要自己拼 fontSize/lineHeight。**
   *
   * 每个样式已经把字号、字重、行高（绝对点值）、字距（点值）算好了 ——
   * 直接展开进 RN 的 `Text` style：`style={text['row-title']}`。
   *
   * 🔴 为什么不让组件自己拼：行高在 CSS 里是**倍数**，RN 要**点值**；
   * 字距在 CSS 里是 **em**，RN 要**点值**。自己拼就一定会有人漏掉那次乘法，
   * 而漏掉的结果是行高塌成 1.5pt / 字距变成 0 —— 都不报错。
   */
  text: Record<TextStyleName, RnTextStyle>;
  /**
   * 当归一化后的值。**UI 一律用这些，不要直接读 `tokens` 里的 font/shadow/ease** ——
   * 那三个分组的原始值只在 CSS 里合法（理由见
   * `packages/design-system/src/native-values.ts` 的文件头）。
   */
  native: {
    /** RN 的 `fontFamily`：要么是已打包的字体名，要么 `undefined`（系统字体）。 */
    fontSans: string | undefined;
    fontMono: string | undefined;
    /** 绝对行高（px）。`tokens['line-height.*']` 是**倍数**，不能直接传给 RN。 */
    lineHeight: (key: 'line-height.tight' | 'line-height.normal' | 'line-height.relaxed', fontSize: number) => number;
    /** 绝对字距（px）。`tokens['tracking.*']` 是 **em 比例**，不能直接传给 RN。 */
    tracking: (key: TextStyleName, fontSize: number) => number;
    shadow: (key: 'shadow.sm' | 'shadow.md' | 'shadow.lg' | 'shadow.xl' | 'shadow.focus') => RnShadow | null;
    easing: (key: 'ease.standard' | 'ease.enter' | 'ease.exit' | 'ease.spring') => CubicBezier | null;
  };
}

/**
 * 🔴 目前**没有打包任何自定义字体**。
 *
 * `font.sans` 的第一项是 `'Plus Jakarta Sans'`，但它没有随包分发 ——
 * 而 `resolveFontFamily` 只会在字体确实登记进这个清单时才返回它。
 *
 * 直接把它当 `fontFamily` 传给 RN 的后果是**实测过的**：不报错，
 * 屏幕上是条纹状的乱码文字。所以这里刻意留空，让 RN 用系统字体
 * （iOS/Android 的系统字体对中文支持本来就更好）。
 *
 * 要启用品牌字体，需要先确认字体许可证能进产品代码（AGENTS.md §3.2 的
 * 白名单里**没有 OFL**，而 Plus Jakarta Sans 正是 OFL），再打包字体文件
 * 并在这里登记。那是需要单独决定的事，不该顺手做掉。
 */
const PACKAGED_FONTS: readonly string[] = [];

const ThemeContext = createContext<ThemeValue | null>(null);

/**
 * 订阅系统的「减少动效」开关。
 *
 * 🔴 这一步不能省。RN 里没有 `prefers-reduced-motion` 媒体查询，
 * 必须自己查 + 自己订阅变化。只在挂载时查一次的话，
 * 用户在系统设置里打开「减弱动态效果」后，应用仍然会继续播放动画 ——
 * 而那正是这个无障碍开关要阻止的事。
 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) setReduced(v);
      })
      .catch(() => {
        // 查询失败时保守取 false：宁可播放动画，也不要因为一次查询失败
        // 就把整个应用的动效永久关掉。
      });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

export function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const scheme = useColorScheme();
  const reducedMotion = useReducedMotion();

  const value = useMemo<ThemeValue>(() => {
    // 🔴 `resolveThemeName` 负责把 `null`（系统未指定）归一成 `'light'`。
    // 直接拿 `scheme` 当索引会得到 undefined，而 RN 拿到 undefined 颜色
    // **不报错、只是不渲染** —— 那种"白屏但不崩"最难排查。
    const theme = resolveThemeName(scheme);
    const tokens = resolveNativeTokens({ theme, reducedMotion });
    return {
      theme,
      reducedMotion,
      tokens,
      // 排版与主题无关 —— 换主题只该换颜色，不该让版面重排。
      // （typography.spec.ts 有一条断言钉住亮暗两套解析结果必须完全相同。）
      text: resolveAllTextStyles(tokens),
      native: {
        fontSans: resolveFontFamily(tokens['font.sans'], PACKAGED_FONTS),
        fontMono: resolveFontFamily(tokens['font.mono'], PACKAGED_FONTS),
        lineHeight: (key, fontSize) => resolveLineHeight(tokens[key], fontSize),
        tracking: (key, fontSize) => resolveTracking(tokens[TEXT_STYLES[key].tracking], fontSize),
        shadow: (key) => parseCssShadow(tokens[key]),
        easing: (key) => parseCubicBezier(tokens[key]),
      },
    };
  }, [scheme, reducedMotion]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (value === null) {
    throw new Error('useTheme 必须在 <ThemeProvider> 内使用。');
  }
  return value;
}

/** 取 token 的快捷方式，配合解构使用：`const t = useTokens()`。 */
export function useTokens(): HeytaNativeTokens {
  return useTheme().tokens;
}

/** 取语义文字样式的快捷方式：`const text = useText()` 然后 `text['row-title']`。 */
export function useText(): Record<TextStyleName, RnTextStyle> {
  return useTheme().text;
}
