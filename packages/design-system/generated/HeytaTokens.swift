// HeytaTokens.swift
// ────────────────────────────────────────────────────────────
// HeytaTokens — heyta 设计系统原生常量
//
// ⚠️ 本文件由生成器产出，请勿手动编辑。
//    唯一事实源：packages/design-system/src/tokens.css
//    重新生成：pnpm --filter @heyta/design-system run generate
//
// 从 tokens.css 解析并**展开**所有 CSS 变量引用：产物里没有悬空引用，
// 全部是可直接使用的具体值。手改本文件会在下次生成时被覆盖，
// 而且会绕过 tokens.css 的对比度测试（AGENTS.md §5）。
//
// 主题：Light 是完整集合；Dark 只含 tokens.css 里 [data-theme='dark']
//       显式覆盖的 token，其余请在运行时回退到 Light。
//
// 减少动效：tokens.css 的 @media (prefers-reduced-motion: reduce) 单独导出为
//       ReducedMotion（时长压到 1ms）。CSS 媒体查询在原生不存在 ——
//       **两端都必须在运行时读取系统辅助功能设置**并在开启时用
//       ReducedMotion 覆盖 Light 的 duration 常量，而不是忽略 Media Query。
//       iOS/SwiftUI: @Environment(\.accessibilityReduceMotion)
//       HarmonyOS:   accessibility.isReduceMotionEnabled（或等价设置项）
//
// 以下 token 没有忠实的原生等价物，已原样导出为字符串：
//   - font.sans: CSS 字体栈不是原生端的字体选择方式；原样导出仅作参考，请配置等价系统字体（iOS: SF Pro / PingFang SC，HarmonyOS: HarmonyOS Sans）。
//   - font.mono: CSS 字体栈不是原生端的字体选择方式；原样导出仅作参考，请配置等价系统字体（iOS: SF Pro / PingFang SC，HarmonyOS: HarmonyOS Sans）。
//   - shadow.none: box-shadow 是 CSS 复合语法，与 SwiftUI / ArkUI 的阴影模型不同；已原样导出，需各端自行构造（偏移 / 模糊 / 颜色）。
//   - shadow.sm: box-shadow 是 CSS 复合语法，与 SwiftUI / ArkUI 的阴影模型不同；已原样导出，需各端自行构造（偏移 / 模糊 / 颜色）。
//   - shadow.md: box-shadow 是 CSS 复合语法，与 SwiftUI / ArkUI 的阴影模型不同；已原样导出，需各端自行构造（偏移 / 模糊 / 颜色）。
//   - shadow.lg: box-shadow 是 CSS 复合语法，与 SwiftUI / ArkUI 的阴影模型不同；已原样导出，需各端自行构造（偏移 / 模糊 / 颜色）。
//   - shadow.xl: box-shadow 是 CSS 复合语法，与 SwiftUI / ArkUI 的阴影模型不同；已原样导出，需各端自行构造（偏移 / 模糊 / 颜色）。
//   - shadow.focus: box-shadow 是 CSS 复合语法，与 SwiftUI / ArkUI 的阴影模型不同；已原样导出，需各端自行构造（偏移 / 模糊 / 颜色）。
//   - ease.standard: cubic-bezier 是 CSS 时序函数，SwiftUI / ArkUI 没有同名类型；已导出控制点，需各端自行映射为动画曲线。
//   - ease.enter: cubic-bezier 是 CSS 时序函数，SwiftUI / ArkUI 没有同名类型；已导出控制点，需各端自行映射为动画曲线。
//   - ease.exit: cubic-bezier 是 CSS 时序函数，SwiftUI / ArkUI 没有同名类型；已导出控制点，需各端自行映射为动画曲线。
//   - ease.spring: cubic-bezier 是 CSS 时序函数，SwiftUI / ArkUI 没有同名类型；已导出控制点，需各端自行映射为动画曲线。
//   - layout.prose-max: 相对单位依赖当前字号，无法换算为原生数值常量；已原样导出为字符串。
// ────────────────────────────────────────────────────────────

enum HeytaTokens {
  // SECTION: Light
  enum Light {
    static let colorPrimary: String = "#2563eb"
    static let colorPrimaryHover: String = "#1d4ed8"
    static let colorPrimaryActive: String = "#1e40af"
    static let colorPrimarySubtle: String = "#eff6ff"
    static let colorPrimarySubtleHover: String = "#dbeafe"
    static let colorOnPrimary: String = "#ffffff"
    static let colorBackground: String = "#f8fafc"
    static let colorSurface: String = "#ffffff"
    static let colorSurfaceRaised: String = "#ffffff"
    static let colorSurfaceSunken: String = "#f1f5f9"
    static let colorForeground: String = "#0f172a"
    static let colorForegroundMuted: String = "#64748b"
    static let colorForegroundSubtle: String = "#94a3b8"
    static let colorForegroundInverse: String = "#ffffff"
    static let colorBorder: String = "#e2e8f0"
    static let colorBorderStrong: String = "#cbd5e1"
    static let colorBorderSubtle: String = "#f1f5f9"
    static let colorRing: String = "#2563eb"
    static let colorHover: String = "#f1f5f9"
    static let colorActive: String = "#e2e8f0"
    static let colorDisabledBg: String = "#f1f5f9"
    static let colorDisabledFg: String = "#94a3b8"
    static let colorSuccess: String = "#059669"
    static let colorSuccessStrong: String = "#047857"
    static let colorSuccessSubtle: String = "#ecfdf5"
    static let colorWarning: String = "#d97706"
    static let colorWarningStrong: String = "#b45309"
    static let colorWarningSubtle: String = "#fffbeb"
    static let colorDanger: String = "#dc2626"
    static let colorDangerStrong: String = "#b91c1c"
    static let colorDangerSubtle: String = "#fef2f2"
    static let colorInfo: String = "#0284c7"
    static let colorInfoStrong: String = "#0369a1"
    static let colorInfoSubtle: String = "#f0f9ff"
    static let colorQuadrant1: String = "#dc2626"
    static let colorQuadrant1Subtle: String = "#fef2f2"
    static let colorQuadrant2: String = "#2563eb"
    static let colorQuadrant2Subtle: String = "#eff6ff"
    static let colorQuadrant3: String = "#b45309"
    static let colorQuadrant3Subtle: String = "#fffbeb"
    static let colorQuadrant4: String = "#64748b"
    static let colorQuadrant4Subtle: String = "#f1f5f9"
    static let colorPriorityHigh: String = "#dc2626"
    static let colorPriorityMedium: String = "#b45309"
    static let colorPriorityLow: String = "#0284c7"
    static let colorPriorityNone: String = "#94a3b8"
    static let colorHeat0: String = "#f1f5f9"
    static let colorHeat1: String = "#bfdbfe"
    static let colorHeat2: String = "#93c5fd"
    static let colorHeat3: String = "#3b82f6"
    static let colorHeat4: String = "#1d4ed8"
    static let colorFocusWork: String = "#2563eb"
    static let colorFocusBreak: String = "#059669"
    static let colorOverlay: String = "#0f172a80"
    static let space0: Double = 0  // px
    static let space1: Double = 4  // px
    static let space2: Double = 8  // px
    static let space3: Double = 12  // px
    static let space4: Double = 16  // px
    static let space5: Double = 20  // px
    static let space6: Double = 24  // px
    static let space8: Double = 32  // px
    static let space10: Double = 40  // px
    static let space12: Double = 48  // px
    static let space16: Double = 64  // px
    static let fontSize2xs: Double = 11  // px
    static let fontSizeXs: Double = 12  // px
    static let fontSizeSm: Double = 14  // px
    static let fontSizeBase: Double = 16  // px
    static let fontSizeLg: Double = 18  // px
    static let fontSizeXl: Double = 20  // px
    static let fontSize2xl: Double = 24  // px
    static let fontSize3xl: Double = 30  // px
    static let fontSize4xl: Double = 36  // px
    static let fontWeightRegular: Double = 400
    static let fontWeightMedium: Double = 500
    static let fontWeightSemibold: Double = 600
    static let fontWeightBold: Double = 700
    static let lineHeightTight: Double = 1.25
    static let lineHeightNormal: Double = 1.5
    static let lineHeightRelaxed: Double = 1.75
    static let fontSans: String = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif"
    static let fontMono: String = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    static let radiusNone: Double = 0  // px
    static let radiusSm: Double = 4  // px
    static let radiusMd: Double = 8  // px
    static let radiusLg: Double = 12  // px
    static let radiusXl: Double = 16  // px
    static let radiusFull: Double = 9999  // px
    static let shadowNone: String = "none"
    static let shadowSm: String = "0 1px 2px rgb(15 23 42 / 0.05)"
    static let shadowMd: String = "0 2px 8px rgb(15 23 42 / 0.08)"
    static let shadowLg: String = "0 8px 24px rgb(15 23 42 / 0.12)"
    static let shadowXl: String = "0 16px 48px rgb(15 23 42 / 0.16)"
    static let shadowFocus: String = "0 0 0 3px rgb(37 99 235 / 0.25)"
    static let durationInstant: Double = 80  // ms
    static let durationFast: Double = 150  // ms
    static let durationNormal: Double = 200  // ms
    static let durationSlow: Double = 300  // ms
    static let durationExit: Double = 140  // ms
    static let easeStandard: String = "cubic-bezier(0.2, 0, 0.2, 1)"
    static let easeEnter: String = "cubic-bezier(0, 0, 0.2, 1)"
    static let easeExit: String = "cubic-bezier(0.4, 0, 1, 1)"
    static let easeSpring: String = "cubic-bezier(0.34, 1.56, 0.64, 1)"
    static let zBase: Double = 0
    static let zSticky: Double = 100
    static let zDropdown: Double = 200
    static let zOverlay: Double = 300
    static let zModal: Double = 400
    static let zPopover: Double = 500
    static let zToast: Double = 600
    static let zTooltip: Double = 700
    static let iconXs: Double = 14  // px
    static let iconSm: Double = 16  // px
    static let iconMd: Double = 20  // px
    static let iconLg: Double = 24  // px
    static let iconXl: Double = 32  // px
    static let touchTargetMin: Double = 44  // px
    static let focusRingWidth: Double = 2  // px
    static let layoutSidebarWidth: Double = 240  // px
    static let layoutHeaderHeight: Double = 56  // px
    static let layoutContentMax: Double = 1200  // px
    static let layoutProseMax: String = "65ch"
    static let layoutQuadrantMinHeight: Double = 192  // px
    static let borderWidthThin: Double = 1  // px
    static let borderWidthThick: Double = 2  // px
  }

  // SECTION: Dark
  enum Dark {
    static let colorPrimary: String = "#60a5fa"
    static let colorPrimaryHover: String = "#93c5fd"
    static let colorPrimaryActive: String = "#bfdbfe"
    static let colorPrimarySubtle: String = "#2563eb29"
    static let colorPrimarySubtleHover: String = "#2563eb3d"
    static let colorOnPrimary: String = "#020617"
    static let colorBackground: String = "#020617"
    static let colorSurface: String = "#0d1526"
    static let colorSurfaceRaised: String = "#131e33"
    static let colorSurfaceSunken: String = "#080e1a"
    static let colorForeground: String = "#f1f5f9"
    static let colorForegroundMuted: String = "#94a3b8"
    static let colorForegroundSubtle: String = "#64748b"
    static let colorForegroundInverse: String = "#020617"
    static let colorBorder: String = "#1e2b45"
    static let colorBorderStrong: String = "#2b3b5c"
    static let colorBorderSubtle: String = "#16203a"
    static let colorRing: String = "#60a5fa"
    static let colorHover: String = "#94a3b81f"
    static let colorActive: String = "#94a3b833"
    static let colorDisabledBg: String = "#16203a"
    static let colorDisabledFg: String = "#475569"
    static let colorSuccess: String = "#34d399"
    static let colorSuccessStrong: String = "#6ee7b7"
    static let colorSuccessSubtle: String = "#05966929"
    static let colorWarning: String = "#fbbf24"
    static let colorWarningStrong: String = "#fcd34d"
    static let colorWarningSubtle: String = "#d9770629"
    static let colorDanger: String = "#f87171"
    static let colorDangerStrong: String = "#fca5a5"
    static let colorDangerSubtle: String = "#dc262629"
    static let colorInfo: String = "#38bdf8"
    static let colorInfoStrong: String = "#7dd3fc"
    static let colorInfoSubtle: String = "#0284c729"
    static let colorQuadrant1: String = "#f87171"
    static let colorQuadrant1Subtle: String = "#dc262629"
    static let colorQuadrant2: String = "#60a5fa"
    static let colorQuadrant2Subtle: String = "#2563eb29"
    static let colorQuadrant3: String = "#fbbf24"
    static let colorQuadrant3Subtle: String = "#d9770629"
    static let colorQuadrant4: String = "#94a3b8"
    static let colorQuadrant4Subtle: String = "#94a3b824"
    static let colorPriorityHigh: String = "#f87171"
    static let colorPriorityMedium: String = "#fbbf24"
    static let colorPriorityLow: String = "#38bdf8"
    static let colorPriorityNone: String = "#64748b"
    static let colorHeat0: String = "#16203a"
    static let colorHeat1: String = "#1e3a8a"
    static let colorHeat2: String = "#1d4ed8"
    static let colorHeat3: String = "#3b82f6"
    static let colorHeat4: String = "#93c5fd"
    static let colorFocusWork: String = "#60a5fa"
    static let colorFocusBreak: String = "#34d399"
    static let colorOverlay: String = "#020617b3"
    static let shadowSm: String = "0 1px 2px rgb(0 0 0 / 0.4)"
    static let shadowMd: String = "0 2px 8px rgb(0 0 0 / 0.5)"
    static let shadowLg: String = "0 8px 24px rgb(0 0 0 / 0.6)"
    static let shadowXl: String = "0 16px 48px rgb(0 0 0 / 0.7)"
    static let shadowFocus: String = "0 0 0 3px rgb(96 165 250 / 0.35)"
  }

  // SECTION: ReducedMotion
  enum ReducedMotion {
    static let durationInstant: Double = 1  // ms
    static let durationFast: Double = 1  // ms
    static let durationNormal: Double = 1  // ms
    static let durationSlow: Double = 1  // ms
    static let durationExit: Double = 1  // ms
  }
}
