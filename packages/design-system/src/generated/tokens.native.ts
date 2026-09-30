/**
 * heyta 设计变量的 React Native 产物 —— **自动生成，请勿手改**。
 *
 * 唯一事实源：`packages/design-system/src/tokens.css`
 * 重新生成：`pnpm --filter @heyta/design-system run generate`
 *
 * 与 `tokens.json` 的区别（重要）：
 *   - 这里是**完整**的主题表。暗色已与亮色合并，**没有 undefined 空洞**。
 *   - 数值 token 是 `number`，颜色是 `string`；拼错名字是编译期错误。
 *   - `tokens.json` 的 dark 段是稀疏覆盖，只适合数据流水线，不适合直接消费。
 */

export type ThemeName = 'light' | 'dark';

/** 全部 token 在某一主题下的完整取值。 */
export interface HeytaNativeTokens {
  readonly 'color.primary': string;
  readonly 'color.primary-hover': string;
  readonly 'color.primary-active': string;
  readonly 'color.primary-subtle': string;
  readonly 'color.primary-subtle-hover': string;
  readonly 'color.on-primary': string;
  readonly 'color.background': string;
  readonly 'color.surface': string;
  readonly 'color.surface-raised': string;
  readonly 'color.surface-sunken': string;
  readonly 'color.foreground': string;
  readonly 'color.foreground-muted': string;
  readonly 'color.foreground-subtle': string;
  readonly 'color.foreground-inverse': string;
  readonly 'color.border': string;
  readonly 'color.border-strong': string;
  readonly 'color.border-subtle': string;
  readonly 'color.ring': string;
  readonly 'color.hover': string;
  readonly 'color.active': string;
  readonly 'color.disabled-bg': string;
  readonly 'color.disabled-fg': string;
  readonly 'color.success': string;
  readonly 'color.success-strong': string;
  readonly 'color.success-subtle': string;
  readonly 'color.warning': string;
  readonly 'color.warning-strong': string;
  readonly 'color.warning-subtle': string;
  readonly 'color.danger': string;
  readonly 'color.danger-strong': string;
  readonly 'color.danger-subtle': string;
  readonly 'color.info': string;
  readonly 'color.info-strong': string;
  readonly 'color.info-subtle': string;
  readonly 'color.quadrant-1': string;
  readonly 'color.quadrant-1-subtle': string;
  readonly 'color.quadrant-2': string;
  readonly 'color.quadrant-2-subtle': string;
  readonly 'color.quadrant-3': string;
  readonly 'color.quadrant-3-subtle': string;
  readonly 'color.quadrant-4': string;
  readonly 'color.quadrant-4-subtle': string;
  readonly 'color.priority-high': string;
  readonly 'color.priority-medium': string;
  readonly 'color.priority-low': string;
  readonly 'color.priority-none': string;
  readonly 'color.heat-0': string;
  readonly 'color.heat-1': string;
  readonly 'color.heat-2': string;
  readonly 'color.heat-3': string;
  readonly 'color.heat-4': string;
  readonly 'color.category-1': string;
  readonly 'color.category-2': string;
  readonly 'color.category-3': string;
  readonly 'color.category-4': string;
  readonly 'color.category-5': string;
  readonly 'color.category-6': string;
  readonly 'color.category-7': string;
  readonly 'color.category-8': string;
  readonly 'color.focus-work': string;
  readonly 'color.focus-break': string;
  readonly 'color.overlay': string;
  readonly 'space.0': number;
  readonly 'space.1': number;
  readonly 'space.2': number;
  readonly 'space.3': number;
  readonly 'space.4': number;
  readonly 'space.5': number;
  readonly 'space.6': number;
  readonly 'space.8': number;
  readonly 'space.10': number;
  readonly 'space.12': number;
  readonly 'space.16': number;
  readonly 'font-size.2xs': number;
  readonly 'font-size.xs': number;
  readonly 'font-size.sm': number;
  readonly 'font-size.base': number;
  readonly 'font-size.lg': number;
  readonly 'font-size.xl': number;
  readonly 'font-size.2xl': number;
  readonly 'font-size.3xl': number;
  readonly 'font-size.4xl': number;
  readonly 'font-weight.regular': number;
  readonly 'font-weight.medium': number;
  readonly 'font-weight.semibold': number;
  readonly 'font-weight.bold': number;
  readonly 'line-height.tight': number;
  readonly 'line-height.normal': number;
  readonly 'line-height.relaxed': number;
  /** CSS 字体栈不是原生端的字体选择方式；原样导出仅作参考，请配置等价系统字体（iOS: SF Pro / PingFang SC，HarmonyOS: HarmonyOS Sans）。 */
  readonly 'font.sans': string;
  /** CSS 字体栈不是原生端的字体选择方式；原样导出仅作参考，请配置等价系统字体（iOS: SF Pro / PingFang SC，HarmonyOS: HarmonyOS Sans）。 */
  readonly 'font.mono': string;
  readonly 'radius.none': number;
  readonly 'radius.sm': number;
  readonly 'radius.md': number;
  readonly 'radius.lg': number;
  readonly 'radius.xl': number;
  readonly 'radius.full': number;
  /** box-shadow 是 CSS 复合语法，与 SwiftUI / ArkUI 的阴影模型不同；已原样导出，需各端自行构造（偏移 / 模糊 / 颜色）。 */
  readonly 'shadow.none': string;
  /** box-shadow 是 CSS 复合语法，与 SwiftUI / ArkUI 的阴影模型不同；已原样导出，需各端自行构造（偏移 / 模糊 / 颜色）。 */
  readonly 'shadow.sm': string;
  /** box-shadow 是 CSS 复合语法，与 SwiftUI / ArkUI 的阴影模型不同；已原样导出，需各端自行构造（偏移 / 模糊 / 颜色）。 */
  readonly 'shadow.md': string;
  /** box-shadow 是 CSS 复合语法，与 SwiftUI / ArkUI 的阴影模型不同；已原样导出，需各端自行构造（偏移 / 模糊 / 颜色）。 */
  readonly 'shadow.lg': string;
  /** box-shadow 是 CSS 复合语法，与 SwiftUI / ArkUI 的阴影模型不同；已原样导出，需各端自行构造（偏移 / 模糊 / 颜色）。 */
  readonly 'shadow.xl': string;
  /** box-shadow 是 CSS 复合语法，与 SwiftUI / ArkUI 的阴影模型不同；已原样导出，需各端自行构造（偏移 / 模糊 / 颜色）。 */
  readonly 'shadow.focus': string;
  readonly 'duration.instant': number;
  readonly 'duration.fast': number;
  readonly 'duration.normal': number;
  readonly 'duration.slow': number;
  readonly 'duration.exit': number;
  readonly 'duration.press': number;
  /** cubic-bezier 是 CSS 时序函数，SwiftUI / ArkUI 没有同名类型；已导出控制点，需各端自行映射为动画曲线。 */
  readonly 'ease.standard': string;
  /** cubic-bezier 是 CSS 时序函数，SwiftUI / ArkUI 没有同名类型；已导出控制点，需各端自行映射为动画曲线。 */
  readonly 'ease.enter': string;
  /** cubic-bezier 是 CSS 时序函数，SwiftUI / ArkUI 没有同名类型；已导出控制点，需各端自行映射为动画曲线。 */
  readonly 'ease.exit': string;
  /** cubic-bezier 是 CSS 时序函数，SwiftUI / ArkUI 没有同名类型；已导出控制点，需各端自行映射为动画曲线。 */
  readonly 'ease.spring': string;
  readonly 'z.base': number;
  readonly 'z.sticky': number;
  readonly 'z.dropdown': number;
  readonly 'z.overlay': number;
  readonly 'z.modal': number;
  readonly 'z.popover': number;
  readonly 'z.toast': number;
  readonly 'z.tooltip': number;
  readonly 'icon.xs': number;
  readonly 'icon.sm': number;
  readonly 'icon.md': number;
  readonly 'icon.lg': number;
  readonly 'icon.xl': number;
  readonly 'touch-target.min': number;
  readonly 'focus-ring.width': number;
  readonly 'layout.rail-width': number;
  readonly 'layout.sidebar-width': number;
  readonly 'layout.header-height': number;
  readonly 'layout.content-max': number;
  /** 相对单位依赖当前字号，无法换算为原生数值常量；已原样导出为字符串。 */
  readonly 'layout.prose-max': string;
  readonly 'layout.quadrant-min-height': number;
  readonly 'layout.panel-max-height': number;
  readonly 'layout.two-column-min': number;
  readonly 'layout.input-min': number;
  readonly 'layout.modal-max': number;
  readonly 'border-width.thin': number;
  readonly 'border-width.thick': number;
  readonly 'nav.tab-bar-height': number;
  readonly 'nav.tab-icon-size': number;
  readonly 'nav.tab-label-size': number;
  readonly 'nav.tab-item-min-width': number;
  readonly 'nav.tab-indicator-inset': number;
  readonly 'nav.tab-indicator-width': number;
  readonly 'nav.tab-indicator-height': number;
  readonly 'nav.app-bar-height': number;
  readonly 'nav.app-bar-title-size': number;
  readonly 'nav.safe-top-min': number;
  readonly 'nav.safe-bottom-min': number;
  readonly 'screen.gutter': number;
  readonly 'screen.section-gap': number;
  readonly 'screen.bottom-inset': number;
  readonly 'size.checkbox': number;
  readonly 'size.row-min-height': number;
  readonly 'size.swipe-action': number;
  readonly 'size.avatar-sm': number;
  readonly 'size.avatar-md': number;
  readonly 'size.avatar-lg': number;
  readonly 'size.fab': number;
  readonly 'size.chip-height': number;
  readonly 'size.chip-padding-x': number;
  readonly 'size.divider-inset': number;
  readonly 'size.badge-min-width': number;
  readonly 'size.badge-height': number;
  readonly 'size.badge-dot': number;
  readonly 'size.badge-ring': number;
  readonly 'size.field-height': number;
  readonly 'size.field-padding-x': number;
  readonly 'size.progress-height': number;
  readonly 'size.focus-ring': number;
  readonly 'size.focus-ring-stroke': number;
  /** 🔴 导出的是**比例**（em），不是点数。RN 的 letterSpacing、SwiftUI 的 .tracking()、ArkTS 的 letterSpacing 都要的是点值，必须按 `比例 × 字号` 换算（见 native-values.ts 的 resolveTracking）。直接把比例当点用会让字距小到等于没有，且两端都不报错。 */
  readonly 'tracking.display': number;
  /** 🔴 导出的是**比例**（em），不是点数。RN 的 letterSpacing、SwiftUI 的 .tracking()、ArkTS 的 letterSpacing 都要的是点值，必须按 `比例 × 字号` 换算（见 native-values.ts 的 resolveTracking）。直接把比例当点用会让字距小到等于没有，且两端都不报错。 */
  readonly 'tracking.title': number;
  /** 🔴 导出的是**比例**（em），不是点数。RN 的 letterSpacing、SwiftUI 的 .tracking()、ArkTS 的 letterSpacing 都要的是点值，必须按 `比例 × 字号` 换算（见 native-values.ts 的 resolveTracking）。直接把比例当点用会让字距小到等于没有，且两端都不报错。 */
  readonly 'tracking.body': number;
  /** 🔴 导出的是**比例**（em），不是点数。RN 的 letterSpacing、SwiftUI 的 .tracking()、ArkTS 的 letterSpacing 都要的是点值，必须按 `比例 × 字号` 换算（见 native-values.ts 的 resolveTracking）。直接把比例当点用会让字距小到等于没有，且两端都不报错。 */
  readonly 'tracking.caption': number;
  readonly 'motion.spring-damping-default': number;
  readonly 'motion.spring-damping-momentum': number;
  readonly 'motion.spring-response-move': number;
  readonly 'motion.spring-response-sheet': number;
  readonly 'motion.spring-response-rotation': number;
  readonly 'motion.press-scale': number;
  readonly 'motion.deceleration-rate': number;
  readonly 'motion.rubber-band-constant': number;
  readonly 'gesture.hysteresis': number;
  readonly 'gesture.hit-slop': number;
  readonly 'state.pressed-opacity': number;
  readonly 'state.hover-opacity': number;
  readonly 'state.disabled-opacity': number;
  readonly 'blur.chrome': number;
  readonly 'blur.sheet': number;
  readonly 'material.chrome-tint': string;
  readonly 'material.chrome-tint-strong': string;
  readonly 'material.edge-highlight': string;
  readonly 'material.sheet-tint': string;
  readonly 'material.scrim': string;
  readonly 'material.scrim-strong': string;
}

export const lightTokens: HeytaNativeTokens = {
  'color.primary': "#2563eb",
  'color.primary-hover': "#1d4ed8",
  'color.primary-active': "#1e40af",
  'color.primary-subtle': "#eff6ff",
  'color.primary-subtle-hover': "#dbeafe",
  'color.on-primary': "#ffffff",
  'color.background': "#f8fafc",
  'color.surface': "#ffffff",
  'color.surface-raised': "#ffffff",
  'color.surface-sunken': "#f1f5f9",
  'color.foreground': "#0f172a",
  'color.foreground-muted': "#64748b",
  'color.foreground-subtle': "#94a3b8",
  'color.foreground-inverse': "#ffffff",
  'color.border': "#e2e8f0",
  'color.border-strong': "#cbd5e1",
  'color.border-subtle': "#f1f5f9",
  'color.ring': "#2563eb",
  'color.hover': "#f1f5f9",
  'color.active': "#e2e8f0",
  'color.disabled-bg': "#f1f5f9",
  'color.disabled-fg': "#94a3b8",
  'color.success': "#059669",
  'color.success-strong': "#047857",
  'color.success-subtle': "#ecfdf5",
  'color.warning': "#d97706",
  'color.warning-strong': "#b45309",
  'color.warning-subtle': "#fffbeb",
  'color.danger': "#dc2626",
  'color.danger-strong': "#b91c1c",
  'color.danger-subtle': "#fef2f2",
  'color.info': "#0284c7",
  'color.info-strong': "#0369a1",
  'color.info-subtle': "#f0f9ff",
  'color.quadrant-1': "#dc2626",
  'color.quadrant-1-subtle': "#fef2f2",
  'color.quadrant-2': "#2563eb",
  'color.quadrant-2-subtle': "#eff6ff",
  'color.quadrant-3': "#b45309",
  'color.quadrant-3-subtle': "#fffbeb",
  'color.quadrant-4': "#64748b",
  'color.quadrant-4-subtle': "#f1f5f9",
  'color.priority-high': "#dc2626",
  'color.priority-medium': "#b45309",
  'color.priority-low': "#0284c7",
  'color.priority-none': "#94a3b8",
  'color.heat-0': "#f1f5f9",
  'color.heat-1': "#bfdbfe",
  'color.heat-2': "#93c5fd",
  'color.heat-3': "#3b82f6",
  'color.heat-4': "#1d4ed8",
  'color.category-1': "#991b1b",
  'color.category-2': "#ea580c",
  'color.category-3': "#16a34a",
  'color.category-4': "#0d9488",
  'color.category-5': "#0e7490",
  'color.category-6': "#1d4ed8",
  'color.category-7': "#a21caf",
  'color.category-8': "#be185d",
  'color.focus-work': "#2563eb",
  'color.focus-break': "#059669",
  'color.overlay': "#0f172a80",
  'space.0': 0,
  'space.1': 4,
  'space.2': 8,
  'space.3': 12,
  'space.4': 16,
  'space.5': 20,
  'space.6': 24,
  'space.8': 32,
  'space.10': 40,
  'space.12': 48,
  'space.16': 64,
  'font-size.2xs': 11,
  'font-size.xs': 12,
  'font-size.sm': 14,
  'font-size.base': 16,
  'font-size.lg': 18,
  'font-size.xl': 20,
  'font-size.2xl': 24,
  'font-size.3xl': 30,
  'font-size.4xl': 36,
  'font-weight.regular': 400,
  'font-weight.medium': 500,
  'font-weight.semibold': 600,
  'font-weight.bold': 700,
  'line-height.tight': 1.25,
  'line-height.normal': 1.5,
  'line-height.relaxed': 1.75,
  'font.sans': "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
  'font.mono': "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  'radius.none': 0,
  'radius.sm': 4,
  'radius.md': 8,
  'radius.lg': 12,
  'radius.xl': 16,
  'radius.full': 9999,
  'shadow.none': "none",
  'shadow.sm': "0 1px 2px rgb(15 23 42 / 0.05)",
  'shadow.md': "0 2px 8px rgb(15 23 42 / 0.08)",
  'shadow.lg': "0 8px 24px rgb(15 23 42 / 0.12)",
  'shadow.xl': "0 16px 48px rgb(15 23 42 / 0.16)",
  'shadow.focus': "0 0 0 3px rgb(37 99 235 / 0.25)",
  'duration.instant': 80,
  'duration.fast': 150,
  'duration.normal': 200,
  'duration.slow': 300,
  'duration.exit': 140,
  'duration.press': 100,
  'ease.standard': "cubic-bezier(0.2, 0, 0.2, 1)",
  'ease.enter': "cubic-bezier(0, 0, 0.2, 1)",
  'ease.exit': "cubic-bezier(0.4, 0, 1, 1)",
  'ease.spring': "cubic-bezier(0.34, 1.56, 0.64, 1)",
  'z.base': 0,
  'z.sticky': 100,
  'z.dropdown': 200,
  'z.overlay': 300,
  'z.modal': 400,
  'z.popover': 500,
  'z.toast': 600,
  'z.tooltip': 700,
  'icon.xs': 14,
  'icon.sm': 16,
  'icon.md': 20,
  'icon.lg': 24,
  'icon.xl': 32,
  'touch-target.min': 44,
  'focus-ring.width': 2,
  'layout.rail-width': 176,
  'layout.sidebar-width': 240,
  'layout.header-height': 56,
  'layout.content-max': 1200,
  'layout.prose-max': "65ch",
  'layout.quadrant-min-height': 192,
  'layout.panel-max-height': 384,
  'layout.two-column-min': 768,
  'layout.input-min': 224,
  'layout.modal-max': 640,
  'border-width.thin': 1,
  'border-width.thick': 2,
  'nav.tab-bar-height': 64,
  'nav.tab-icon-size': 24,
  'nav.tab-label-size': 11,
  'nav.tab-item-min-width': 64,
  'nav.tab-indicator-inset': 4,
  'nav.tab-indicator-width': 20,
  'nav.tab-indicator-height': 3,
  'nav.app-bar-height': 56,
  'nav.app-bar-title-size': 16,
  'nav.safe-top-min': 20,
  'nav.safe-bottom-min': 8,
  'screen.gutter': 16,
  'screen.section-gap': 24,
  'screen.bottom-inset': 88,
  'size.checkbox': 22,
  'size.row-min-height': 56,
  'size.swipe-action': 72,
  'size.avatar-sm': 24,
  'size.avatar-md': 32,
  'size.avatar-lg': 40,
  'size.fab': 56,
  'size.chip-height': 28,
  'size.chip-padding-x': 10,
  'size.divider-inset': 52,
  'size.badge-min-width': 18,
  'size.badge-height': 18,
  'size.badge-dot': 8,
  'size.badge-ring': 2,
  'size.field-height': 44,
  'size.field-padding-x': 12,
  'size.progress-height': 6,
  'size.focus-ring': 180,
  'size.focus-ring-stroke': 10,
  'tracking.display': -0.022,
  'tracking.title': -0.019,
  'tracking.body': -0.011,
  'tracking.caption': 0.006,
  'motion.spring-damping-default': 1,
  'motion.spring-damping-momentum': 0.8,
  'motion.spring-response-move': 0.4,
  'motion.spring-response-sheet': 0.3,
  'motion.spring-response-rotation': 0.4,
  'motion.press-scale': 0.97,
  'motion.deceleration-rate': 0.998,
  'motion.rubber-band-constant': 0.55,
  'gesture.hysteresis': 10,
  'gesture.hit-slop': 10,
  'state.pressed-opacity': 0.08,
  'state.hover-opacity': 0.04,
  'state.disabled-opacity': 0.38,
  'blur.chrome': 20,
  'blur.sheet': 30,
  'material.chrome-tint': "#ffffffb8",
  'material.chrome-tint-strong': "#ffffffd9",
  'material.edge-highlight': "#ffffff80",
  'material.sheet-tint': "#ffffffeb",
  'material.scrim': "#0f172a52",
  'material.scrim-strong': "#0f172a80",
};

export const darkTokens: HeytaNativeTokens = {
  'color.primary': "#60a5fa",
  'color.primary-hover': "#93c5fd",
  'color.primary-active': "#bfdbfe",
  'color.primary-subtle': "#2563eb29",
  'color.primary-subtle-hover': "#2563eb3d",
  'color.on-primary': "#020617",
  'color.background': "#020617",
  'color.surface': "#0d1526",
  'color.surface-raised': "#131e33",
  'color.surface-sunken': "#080e1a",
  'color.foreground': "#f1f5f9",
  'color.foreground-muted': "#94a3b8",
  'color.foreground-subtle': "#64748b",
  'color.foreground-inverse': "#020617",
  'color.border': "#1e2b45",
  'color.border-strong': "#2b3b5c",
  'color.border-subtle': "#16203a",
  'color.ring': "#60a5fa",
  'color.hover': "#94a3b81f",
  'color.active': "#94a3b833",
  'color.disabled-bg': "#16203a",
  'color.disabled-fg': "#475569",
  'color.success': "#34d399",
  'color.success-strong': "#6ee7b7",
  'color.success-subtle': "#05966929",
  'color.warning': "#fbbf24",
  'color.warning-strong': "#fcd34d",
  'color.warning-subtle': "#d9770629",
  'color.danger': "#f87171",
  'color.danger-strong': "#fca5a5",
  'color.danger-subtle': "#dc262629",
  'color.info': "#38bdf8",
  'color.info-strong': "#7dd3fc",
  'color.info-subtle': "#0284c729",
  'color.quadrant-1': "#f87171",
  'color.quadrant-1-subtle': "#dc262629",
  'color.quadrant-2': "#60a5fa",
  'color.quadrant-2-subtle': "#2563eb29",
  'color.quadrant-3': "#fbbf24",
  'color.quadrant-3-subtle': "#d9770629",
  'color.quadrant-4': "#94a3b8",
  'color.quadrant-4-subtle': "#94a3b824",
  'color.priority-high': "#f87171",
  'color.priority-medium': "#fbbf24",
  'color.priority-low': "#38bdf8",
  'color.priority-none': "#64748b",
  'color.heat-0': "#16203a",
  'color.heat-1': "#1e3a8a",
  'color.heat-2': "#1d4ed8",
  'color.heat-3': "#3b82f6",
  'color.heat-4': "#93c5fd",
  'color.category-1': "#f87171",
  'color.category-2': "#fb923c",
  'color.category-3': "#34d399",
  'color.category-4': "#99f6e4",
  'color.category-5': "#22d3ee",
  'color.category-6': "#6366f1",
  'color.category-7': "#e879f9",
  'color.category-8': "#f472b6",
  'color.focus-work': "#60a5fa",
  'color.focus-break': "#34d399",
  'color.overlay': "#020617b3",
  'space.0': 0,
  'space.1': 4,
  'space.2': 8,
  'space.3': 12,
  'space.4': 16,
  'space.5': 20,
  'space.6': 24,
  'space.8': 32,
  'space.10': 40,
  'space.12': 48,
  'space.16': 64,
  'font-size.2xs': 11,
  'font-size.xs': 12,
  'font-size.sm': 14,
  'font-size.base': 16,
  'font-size.lg': 18,
  'font-size.xl': 20,
  'font-size.2xl': 24,
  'font-size.3xl': 30,
  'font-size.4xl': 36,
  'font-weight.regular': 400,
  'font-weight.medium': 500,
  'font-weight.semibold': 600,
  'font-weight.bold': 700,
  'line-height.tight': 1.25,
  'line-height.normal': 1.5,
  'line-height.relaxed': 1.75,
  'font.sans': "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
  'font.mono': "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  'radius.none': 0,
  'radius.sm': 4,
  'radius.md': 8,
  'radius.lg': 12,
  'radius.xl': 16,
  'radius.full': 9999,
  'shadow.none': "none",
  'shadow.sm': "0 1px 2px rgb(0 0 0 / 0.4)",
  'shadow.md': "0 2px 8px rgb(0 0 0 / 0.5)",
  'shadow.lg': "0 8px 24px rgb(0 0 0 / 0.6)",
  'shadow.xl': "0 16px 48px rgb(0 0 0 / 0.7)",
  'shadow.focus': "0 0 0 3px rgb(96 165 250 / 0.35)",
  'duration.instant': 80,
  'duration.fast': 150,
  'duration.normal': 200,
  'duration.slow': 300,
  'duration.exit': 140,
  'duration.press': 100,
  'ease.standard': "cubic-bezier(0.2, 0, 0.2, 1)",
  'ease.enter': "cubic-bezier(0, 0, 0.2, 1)",
  'ease.exit': "cubic-bezier(0.4, 0, 1, 1)",
  'ease.spring': "cubic-bezier(0.34, 1.56, 0.64, 1)",
  'z.base': 0,
  'z.sticky': 100,
  'z.dropdown': 200,
  'z.overlay': 300,
  'z.modal': 400,
  'z.popover': 500,
  'z.toast': 600,
  'z.tooltip': 700,
  'icon.xs': 14,
  'icon.sm': 16,
  'icon.md': 20,
  'icon.lg': 24,
  'icon.xl': 32,
  'touch-target.min': 44,
  'focus-ring.width': 2,
  'layout.rail-width': 176,
  'layout.sidebar-width': 240,
  'layout.header-height': 56,
  'layout.content-max': 1200,
  'layout.prose-max': "65ch",
  'layout.quadrant-min-height': 192,
  'layout.panel-max-height': 384,
  'layout.two-column-min': 768,
  'layout.input-min': 224,
  'layout.modal-max': 640,
  'border-width.thin': 1,
  'border-width.thick': 2,
  'nav.tab-bar-height': 64,
  'nav.tab-icon-size': 24,
  'nav.tab-label-size': 11,
  'nav.tab-item-min-width': 64,
  'nav.tab-indicator-inset': 4,
  'nav.tab-indicator-width': 20,
  'nav.tab-indicator-height': 3,
  'nav.app-bar-height': 56,
  'nav.app-bar-title-size': 16,
  'nav.safe-top-min': 20,
  'nav.safe-bottom-min': 8,
  'screen.gutter': 16,
  'screen.section-gap': 24,
  'screen.bottom-inset': 88,
  'size.checkbox': 22,
  'size.row-min-height': 56,
  'size.swipe-action': 72,
  'size.avatar-sm': 24,
  'size.avatar-md': 32,
  'size.avatar-lg': 40,
  'size.fab': 56,
  'size.chip-height': 28,
  'size.chip-padding-x': 10,
  'size.divider-inset': 52,
  'size.badge-min-width': 18,
  'size.badge-height': 18,
  'size.badge-dot': 8,
  'size.badge-ring': 2,
  'size.field-height': 44,
  'size.field-padding-x': 12,
  'size.progress-height': 6,
  'size.focus-ring': 180,
  'size.focus-ring-stroke': 10,
  'tracking.display': -0.022,
  'tracking.title': -0.019,
  'tracking.body': -0.011,
  'tracking.caption': 0.006,
  'motion.spring-damping-default': 1,
  'motion.spring-damping-momentum': 0.8,
  'motion.spring-response-move': 0.4,
  'motion.spring-response-sheet': 0.3,
  'motion.spring-response-rotation': 0.4,
  'motion.press-scale': 0.97,
  'motion.deceleration-rate': 0.998,
  'motion.rubber-band-constant': 0.55,
  'gesture.hysteresis': 10,
  'gesture.hit-slop': 10,
  'state.pressed-opacity': 0.08,
  'state.hover-opacity': 0.04,
  'state.disabled-opacity': 0.38,
  'blur.chrome': 20,
  'blur.sheet': 30,
  'material.chrome-tint': "#0d1526c7",
  'material.chrome-tint-strong': "#0d1526e6",
  'material.edge-highlight': "#ffffff1f",
  'material.sheet-tint': "#0d1526f0",
  'material.scrim': "#02061780",
  'material.scrim-strong': "#020617ad",
};

/** `prefers-reduced-motion` 的覆盖层；只需覆盖真的会动的 token。 */
export const reducedMotionTokens: Partial<HeytaNativeTokens> = {
  'duration.instant': 1,
  'duration.fast': 1,
  'duration.normal': 1,
  'duration.slow': 1,
  'duration.exit': 1,
  'duration.press': 1,
};

export const THEME_NAMES: readonly ThemeName[] = ['light', 'dark'];
