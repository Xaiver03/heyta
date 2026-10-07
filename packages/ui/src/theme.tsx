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
 * （`apps/web` 起步时就不必先写一个主题层）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这里现在是 token / 文本样式的**唯一来源**（2026-09-28 收敛）
 *
 * 收敛之前 `apps/mobile/src/theme.tsx` 是第二份实现：它自己调
 * `resolveNativeTokens` / `resolveAllTextStyles` 建表，再通过 `UiThemeBridge`
 * 把值回灌给这个 Provider —— 同一份主题被解析了两遍，两边各订阅一次
 * `reduceMotionChanged`。现在移动端只做**转发**（
 * `apps/mobile/src/theme.tsx` 只剩 re-export），门禁
 * `scripts/check-theme-single-source.mjs` 钉住这一点。
 *
 * `native` 那组归一化访问器（字体栈 / 行高 / 字距 / 阴影 / 缓动）也收在这一层：
 * 它是**同一份 token 的 RN 视图**（字体栈 / box-shadow / cubic-bezier 只在 CSS 里
 * 合法），不是平台差异。唯一的宿主差异是"打包了哪些字体"，由 `packagedFonts`
 * 显式表达 —— 默认空数组 = 全用系统字体。
 */

import React, { createContext, useContext, useMemo } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';
import {
  parseCssShadow,
  parseCubicBezier,
  resolveAllTextStyles,
  resolveFontFamily,
  resolveLineHeight,
  resolveNativeTokens,
  resolveThemeName,
  resolveTracking,
  TEXT_STYLES,
  type CubicBezier,
  type HeytaNativeTokens,
  type RnShadow,
  type RnTextStyle,
  type TextStyleName,
  type ThemeName,
} from '@heyta/design-system';

/**
 * RN 侧的归一化访问器 —— **别直接读 `tokens` 里的 font / shadow / ease**。
 *
 * 那三个分组的原始值只在 CSS 里合法（理由见 `design-system/src/native-values.ts`
 * 的文件头）：行高在 CSS 里是**倍数**、字距是 **em**、阴影是 `box-shadow` 字符串、
 * 缓动是 `cubic-bezier(...)`。原样塞给 RN 会"不报错但画错"。
 */
export interface HeytaUiNativeAccessors {
  /** RN 的 `fontFamily`：要么是已打包的字体名，要么 `undefined`（系统字体）。 */
  readonly fontSans: string | undefined;
  readonly fontMono: string | undefined;
  /** 绝对行高（px）。`tokens['line-height.*']` 是**倍数**，不能直接传给 RN。 */
  readonly lineHeight: (
    key: 'line-height.tight' | 'line-height.normal' | 'line-height.relaxed',
    fontSize: number,
  ) => number;
  /** 绝对字距（px）。`tokens['tracking.*']` 是 **em 比例**，不能直接传给 RN。 */
  readonly tracking: (key: TextStyleName, fontSize: number) => number;
  readonly shadow: (
    key: 'shadow.sm' | 'shadow.md' | 'shadow.lg' | 'shadow.xl' | 'shadow.focus',
  ) => RnShadow | null;
  readonly easing: (
    key: 'ease.standard' | 'ease.enter' | 'ease.exit' | 'ease.spring',
  ) => CubicBezier | null;
}

/** 共享组件能用到的一切样式来源。 */
export interface HeytaUiTheme {
  readonly theme: ThemeName;
  readonly reducedMotion: boolean;
  /**
   * 系统是否开了「减少透明度」（ADR-0042 §4：材质要能退让）。
   * web 由本层用 matchMedia 订阅；RN 原生没有等价偏好，恒 false。
   * 消费方不需要直接读它 —— 合并后的 `tokens` 里材质 tint 已经是实色。
   */
  readonly reducedTransparency: boolean;
  readonly tokens: HeytaNativeTokens;
  /**
   * 语义文字样式。**排版一律用它，不要自己拼 fontSize/lineHeight。**
   *
   * 理由写在 `native-values.ts`：行高在 CSS 里是**倍数**、字距是 **em**，
   * 而 RN 要的都是**点值**。自己拼就一定会有人漏掉那次乘法，
   * 而漏掉的结果是行高塌成字号本身 —— 不报错，只是难看。
   */
  readonly text: Record<TextStyleName, RnTextStyle>;
  /** token 的 RN 视图（见 `HeytaUiNativeAccessors`）。 */
  readonly native: HeytaUiNativeAccessors;
}

const ThemeContext = createContext<HeytaUiTheme | null>(null);

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
 * 并把这个清单传给 `<HeytaUiProvider packagedFonts={…}>`。那是需要单独决定的事，
 * 不该顺手做掉。
 *
 * ⚠️ 它是**宿主差异**，所以走 prop 而不是写死在这里：某个端将来打包了字体，
 * 不该为了登记它去改共享层。
 */
const DEFAULT_PACKAGED_FONTS: readonly string[] = [];

/** 从一份 token 表派生 RN 归一化访问器。纯函数（字体清单除外）。 */
function resolveNativeAccessors(
  tokens: HeytaNativeTokens,
  packagedFonts: readonly string[],
): HeytaUiNativeAccessors {
  return {
    fontSans: resolveFontFamily(tokens['font.sans'], packagedFonts),
    fontMono: resolveFontFamily(tokens['font.mono'], packagedFonts),
    lineHeight: (key, fontSize) => resolveLineHeight(tokens[key], fontSize),
    tracking: (key, fontSize) => resolveTracking(tokens[TEXT_STYLES[key].tracking], fontSize),
    shadow: (key) => parseCssShadow(tokens[key]),
    easing: (key) => parseCubicBezier(tokens[key]),
  };
}

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

/**
 * 订阅系统的「减少透明度」偏好（web；ADR-0042 §4）。
 *
 * 🔴 为什么不用 AccessibilityInfo：RN 没有把 iOS 的
 * `isReduceTransparencyEnabled` 桥接出来（reduceMotion 有、transparency 没有），
 * 而 web 上这条偏好恰好只存在于 CSS 媒体查询 —— matchMedia 是唯一通道。
 * 平台分叉住在**主题基础设施层**（不是业务组件，ADR-0042 的分叉纪律管的是
 * 材质表面）；原生端恒 false，材质本来也是「诚实不透明」。
 */
function useReducedTransparency(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = matchMediaMaybe();
    if (mq === null) return;
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return reduced;
}

/** 类型安全的 matchMedia（RN 原生 / SSR 上不存在，返回 null）。 */
function matchMediaMaybe(): {
  matches: boolean;
  addEventListener(type: 'change', fn: () => void): void;
  removeEventListener(type: 'change', fn: () => void): void;
} | null {
  const w = globalThis as unknown as {
    matchMedia?: (query: string) => {
      matches: boolean;
      addEventListener?: (type: 'change', fn: () => void) => void;
      removeEventListener?: (type: 'change', fn: () => void) => void;
    };
  };
  if (typeof w.matchMedia !== 'function') return null;
  const mq = w.matchMedia('(prefers-reduced-transparency: reduce)');
  const { addEventListener: add, removeEventListener: remove } = mq;
  if (typeof add !== 'function' || typeof remove !== 'function') return null;
  // 适配器：把「检查过存在的可选方法」收窄成返回类型的必选方法。
  return {
    matches: mq.matches,
    addEventListener: (type, fn) => add.call(mq, type, fn),
    removeEventListener: (type, fn) => remove.call(mq, type, fn),
  };
}

/** 同步读一次（resolveHeytaUiTheme 省略 reducedTransparency 时用）。 */
function readReducedTransparencyOnce(): boolean {
  return matchMediaMaybe()?.matches ?? false;
}

/** 从系统配色方案解析出一套完整主题。`value` 省略时由 Provider 调用。 */
export function resolveHeytaUiTheme(options?: {
  scheme?: ReturnType<typeof useColorScheme>;
  reducedMotion?: boolean;
  /**
   * 系统「减少透明度」。**省略时在 web 上同步读一次 matchMedia** ——
   * 宿主（如 apps/web 的根）只传 scheme 也能拿到正确材质；代价是不订阅，
   * 会话中途改系统设置要等下一次重渲染才生效（与 reducedMotion 的
   * 「web 由 CSS 媒体查询负责」同类的取舍）。需要订阅的走 Provider 的自动解析。
   */
  reducedTransparency?: boolean;
  /** 宿主已打包的字体名清单。省略 = 全用系统字体。 */
  packagedFonts?: readonly string[];
}): HeytaUiTheme {
  // 🔴 `resolveThemeName` 负责把 `null` / `'unspecified'` 归一成 `'light'`。
  // 直接拿 scheme 当索引会得到 undefined，而 RN 拿到 undefined 颜色
  // **不报错、只是不渲染** —— "白屏但不崩"是最难查的一类问题。
  const theme = resolveThemeName(options?.scheme ?? null);
  const reducedMotion = options?.reducedMotion ?? false;
  const reducedTransparency = options?.reducedTransparency ?? readReducedTransparencyOnce();
  const tokens = resolveNativeTokens({ theme, reducedMotion, reducedTransparency });
  return {
    theme,
    reducedMotion,
    reducedTransparency,
    tokens,
    // 排版与主题无关 —— 换主题只该换颜色，不该让版面重排。
    text: resolveAllTextStyles(tokens),
    native: resolveNativeAccessors(tokens, options?.packagedFonts ?? DEFAULT_PACKAGED_FONTS),
  };
}

const UiLocaleContext = createContext<'zh-CN' | 'en'>('zh-CN');

/** 装饰素材继承宿主语言；共享 UI 不依赖 i18n 包。 */
export function useHeytaUiLocale(): 'zh-CN' | 'en' {
  return useContext(UiLocaleContext);
}

export interface HeytaUiProviderProps {
  readonly locale?: 'zh-CN' | 'en';
  /** 宿主自己解析好的主题值（有应用级主题开关的端才需要传）。省略则自动解析。 */
  readonly value?: HeytaUiTheme;
  /** 宿主已打包的字体名清单，透传给 `native.fontSans` / `native.fontMono`。 */
  readonly packagedFonts?: readonly string[];
  readonly children: React.ReactNode;
}

export function HeytaUiProvider({
  locale,
  value,
  packagedFonts,
  children,
}: HeytaUiProviderProps): React.JSX.Element {
  const scheme = useColorScheme();
  const reducedMotion = useReducedMotion();
  const reducedTransparency = useReducedTransparency();
  // 🔴 **继承外层**：一个宿主里嵌套挂多层 Provider 是既成事实（apps/web 有 25 处
  // 各自包一棵子树），而每包一层就按**系统配色**重新解析一遍主题。
  // Web 的应用开关只改 `<html data-theme>`（`apps/web/src/lib/theme.ts`），
  // 于是嵌套层的色板来自 `prefers-color-scheme` 而**不是用户选的那套** ——
  // 实测：OS 亮 + 应用暗 ⇒ 日历卡片在暗色界面里画成纯白，25 个文字元素对比度 < 3:1。
  // 这里改成"外层已有主题就直接沿用"，宿主只需要在**根上**交一次 `value`。
  //
  // ⚠️ `packagedFonts` 也参与判断：它是宿主级差异，显式给了就说明这一层
  //    想说的是"我打包了字体"，此时不能拿外层的值糊过去（那是静默吞掉一个 prop）。
  const inherited = useContext(ThemeContext);
  const inheritedLocale = useContext(UiLocaleContext);
  // hooks 必须无条件调用，所以即使传了 `value` 也照常订阅 ——
  // 代价是宿主传值时这里多订阅一次；换来的是**调用顺序不会随 props 变化**，
  // 而条件式 hook 是 React 里最典型的一类"有时才崩"。
  const fallback = useMemo(
    () => resolveHeytaUiTheme({ scheme, reducedMotion, reducedTransparency, packagedFonts }),
    [scheme, reducedMotion, reducedTransparency, packagedFonts],
  );
  const resolved =
    value ?? (packagedFonts === undefined && inherited !== null ? inherited : fallback);
  return (
    <UiLocaleContext.Provider value={locale ?? inheritedLocale}>
      <ThemeContext.Provider value={resolved}>{children}</ThemeContext.Provider>
    </UiLocaleContext.Provider>
  );
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
