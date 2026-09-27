/**
 * 共享 UI 的主题契约
 * ==================
 *
 * 🔴 **这一层解决的是"同一份主题在四个端上被写四遍"这件事。**
 *
 * 在它出现之前，`apps/mobile/src/theme.tsx` 是唯一的实现 —— 而 Web 端用 CSS 变量
 * （`var(--ht-*)`，见 `packages/design-system` 的 `cssVar()`），桌面端将来还要再接一次。
 * 四个宿主各写一份"把 token 接进框架"的胶水，就等于**四份会各自漂移的真相**。
 *
 * 所以这里只钉**契约**（`HeytaUiTheme`）与**取用方式**（`useHeytaUiTheme`），
 * 共享组件一律通过它拿样式值，永远不直接 import `react-native` 的样式常量。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 为什么是 Provider 而不是让组件自己解析
 *
 * 自己解析看着更省事（组件里 `useColorScheme()` 一调就完），但会带来两个问题：
 *
 * 1. **主题来源会被焊死。** 桌面端将来要支持"跟随应用设置而非系统"
 *    （桌面用户不会为了换主题去改操作系统），那是一个宿主级决策，
 *    组件无权替它做。Provider 让宿主交出 `value` 即可覆盖。
 * 2. **动效偏好要查一次、订阅一次。** 每个组件各查一次的话，
 *    N 个组件就订阅了 N 次 `reduceMotionChanged`；一旦有人在卸载时忘了
 *    `remove()`，就是一个只在特定导航路径下才复现的泄漏。
 *
 * Provider 内部**自带一份默认解析**，所以不传 `value` 也能工作
 * （`apps/web` 起步时就不必先写一个主题层）。移动端现在可以继续传自己的
 * `theme` 值 —— 两者形状相同，将来收敛到一处时不需要改组件。
 */

import React, { createContext, useContext, useMemo } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';
import {
  resolveAllTextStyles,
  resolveNativeTokens,
  resolveThemeName,
  type HeytaNativeTokens,
  type RnTextStyle,
  type TextStyleName,
  type ThemeName,
} from '@heyta/design-system';

/** 共享组件能用到的一切样式来源。 */
export interface HeytaUiTheme {
  readonly theme: ThemeName;
  readonly reducedMotion: boolean;
  readonly tokens: HeytaNativeTokens;
  /**
   * 语义文字样式。**排版一律用它，不要自己拼 fontSize/lineHeight。**
   *
   * 理由写在 `native-values.ts`：行高在 CSS 里是**倍数**、字距是 **em**，
   * 而 RN 要的都是**点值**。自己拼就一定会有人漏掉那次乘法，
   * 而漏掉的结果是行高塌成字号本身 —— 不报错，只是难看。
   */
  readonly text: Record<TextStyleName, RnTextStyle>;
}

const ThemeContext = createContext<HeytaUiTheme | null>(null);

/**
 * 订阅系统的「减少动效」。
 *
 * ⚠️ 只在挂载时查一次是不够的：RN 没有 `prefers-reduced-motion` 媒体查询，
 * 用户中途在系统设置里打开「减弱动态效果」后，应用不会收到任何通知 ——
 * 而那正是这个无障碍开关要阻止的事。
 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive) setReduced(value);
      })
      .catch(() => {
        // 查询失败时保守取 false：宁可播放动画，也不要因为一次查询失败
        // 就把整个应用的动效**永久**关掉（那会一直持续到下次重启）。
      });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/** 从系统配色方案解析出一套完整主题。`value` 省略时由 Provider 调用。 */
export function resolveHeytaUiTheme(options?: {
  scheme?: ReturnType<typeof useColorScheme>;
  reducedMotion?: boolean;
}): HeytaUiTheme {
  // 🔴 `resolveThemeName` 负责把 `null` / `'unspecified'` 归一成 `'light'`。
  // 直接拿 scheme 当索引会得到 undefined，而 RN 拿到 undefined 颜色
  // **不报错、只是不渲染** —— "白屏但不崩"是最难查的一类问题。
  const theme = resolveThemeName(options?.scheme ?? null);
  const reducedMotion = options?.reducedMotion ?? false;
  const tokens = resolveNativeTokens({ theme, reducedMotion });
  return {
    theme,
    reducedMotion,
    tokens,
    // 排版与主题无关 —— 换主题只该换颜色，不该让版面重排。
    text: resolveAllTextStyles(tokens),
  };
}

export interface HeytaUiProviderProps {
  /** 宿主自己的主题值（比如 `apps/mobile` 的 `ThemeValue`）。省略则自动解析。 */
  readonly value?: HeytaUiTheme;
  readonly children: React.ReactNode;
}

export function HeytaUiProvider({ value, children }: HeytaUiProviderProps): React.JSX.Element {
  const scheme = useColorScheme();
  const reducedMotion = useReducedMotion();
  // hooks 必须无条件调用，所以即使传了 `value` 也照常订阅 ——
  // 代价是宿主传值时这里多订阅一次；换来的是**调用顺序不会随 props 变化**，
  // 而条件式 hook 是 React 里最典型的一类"有时才崩"。
  const fallback = useMemo(
    () => resolveHeytaUiTheme({ scheme, reducedMotion }),
    [scheme, reducedMotion],
  );
  return <ThemeContext.Provider value={value ?? fallback}>{children}</ThemeContext.Provider>;
}

export function useHeytaUiTheme(): HeytaUiTheme {
  const value = useContext(ThemeContext);
  if (value === null) {
    // 不静默降级成默认主题：那样"忘了包 Provider"会表现成
    // **暗色系统下渲染成亮色**，是个不会崩、只会悄悄错的 bug。
    throw new Error('useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用。');
  }
  return value;
}

/** 取 token 的快捷方式：`const t = useHeytaTokens()`。 */
export function useHeytaTokens(): HeytaNativeTokens {
  return useHeytaUiTheme().tokens;
}

/** 取语义文字样式：`const text = useHeytaText()` 然后 `text['row-title']`。 */
export function useHeytaText(): Record<TextStyleName, RnTextStyle> {
  return useHeytaUiTheme().text;
}

export type { HeytaNativeTokens, RnTextStyle, TextStyleName, ThemeName };
