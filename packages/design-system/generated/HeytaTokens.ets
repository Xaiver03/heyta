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
//   - tracking.display: 🔴 导出的是**比例**（em），不是点数。RN 的 letterSpacing、SwiftUI 的 .tracking()、ArkTS 的 letterSpacing 都要的是点值，必须按 `比例 × 字号` 换算（见 native-values.ts 的 resolveTracking）。直接把比例当点用会让字距小到等于没有，且两端都不报错。
//   - tracking.title: 🔴 导出的是**比例**（em），不是点数。RN 的 letterSpacing、SwiftUI 的 .tracking()、ArkTS 的 letterSpacing 都要的是点值，必须按 `比例 × 字号` 换算（见 native-values.ts 的 resolveTracking）。直接把比例当点用会让字距小到等于没有，且两端都不报错。
//   - tracking.body: 🔴 导出的是**比例**（em），不是点数。RN 的 letterSpacing、SwiftUI 的 .tracking()、ArkTS 的 letterSpacing 都要的是点值，必须按 `比例 × 字号` 换算（见 native-values.ts 的 resolveTracking）。直接把比例当点用会让字距小到等于没有，且两端都不报错。
//   - tracking.caption: 🔴 导出的是**比例**（em），不是点数。RN 的 letterSpacing、SwiftUI 的 .tracking()、ArkTS 的 letterSpacing 都要的是点值，必须按 `比例 × 字号` 换算（见 native-values.ts 的 resolveTracking）。直接把比例当点用会让字距小到等于没有，且两端都不报错。
// ────────────────────────────────────────────────────────────

// SECTION: Light
export const HEYTA_COLOR_PRIMARY: string = '#2563eb';
export const HEYTA_COLOR_PRIMARY_HOVER: string = '#1d4ed8';
export const HEYTA_COLOR_PRIMARY_ACTIVE: string = '#1e40af';
export const HEYTA_COLOR_PRIMARY_SUBTLE: string = '#eff6ff';
export const HEYTA_COLOR_PRIMARY_SUBTLE_HOVER: string = '#dbeafe';
export const HEYTA_COLOR_ON_PRIMARY: string = '#ffffff';
export const HEYTA_COLOR_BACKGROUND: string = '#f8fafc';
export const HEYTA_COLOR_SURFACE: string = '#ffffff';
export const HEYTA_COLOR_SURFACE_RAISED: string = '#ffffff';
export const HEYTA_COLOR_SURFACE_SUNKEN: string = '#f1f5f9';
export const HEYTA_COLOR_FOREGROUND: string = '#0f172a';
export const HEYTA_COLOR_FOREGROUND_MUTED: string = '#475569';
export const HEYTA_COLOR_FOREGROUND_SUBTLE: string = '#64748b';
export const HEYTA_COLOR_FOREGROUND_INVERSE: string = '#ffffff';
export const HEYTA_COLOR_BORDER: string = '#e2e8f0';
export const HEYTA_COLOR_BORDER_STRONG: string = '#cbd5e1';
export const HEYTA_COLOR_BORDER_SUBTLE: string = '#f1f5f9';
export const HEYTA_COLOR_RING: string = '#2563eb';
export const HEYTA_COLOR_HOVER: string = '#f1f5f9';
export const HEYTA_COLOR_ACTIVE: string = '#e2e8f0';
export const HEYTA_COLOR_DISABLED_BG: string = '#f1f5f9';
export const HEYTA_COLOR_DISABLED_FG: string = '#94a3b8';
export const HEYTA_COLOR_SUCCESS: string = '#059669';
export const HEYTA_COLOR_SUCCESS_STRONG: string = '#047857';
export const HEYTA_COLOR_SUCCESS_SUBTLE: string = '#ecfdf5';
export const HEYTA_COLOR_WARNING: string = '#d97706';
export const HEYTA_COLOR_WARNING_STRONG: string = '#b45309';
export const HEYTA_COLOR_WARNING_SUBTLE: string = '#fffbeb';
export const HEYTA_COLOR_DANGER: string = '#dc2626';
export const HEYTA_COLOR_DANGER_STRONG: string = '#b91c1c';
export const HEYTA_COLOR_DANGER_SUBTLE: string = '#fef2f2';
export const HEYTA_COLOR_INFO: string = '#0284c7';
export const HEYTA_COLOR_INFO_STRONG: string = '#0369a1';
export const HEYTA_COLOR_INFO_SUBTLE: string = '#f0f9ff';
export const HEYTA_COLOR_QUADRANT_1: string = '#dc2626';
export const HEYTA_COLOR_QUADRANT_1_SUBTLE: string = '#fef2f2';
export const HEYTA_COLOR_QUADRANT_2: string = '#2563eb';
export const HEYTA_COLOR_QUADRANT_2_SUBTLE: string = '#eff6ff';
export const HEYTA_COLOR_QUADRANT_3: string = '#b45309';
export const HEYTA_COLOR_QUADRANT_3_SUBTLE: string = '#fffbeb';
export const HEYTA_COLOR_QUADRANT_4: string = '#64748b';
export const HEYTA_COLOR_QUADRANT_4_SUBTLE: string = '#f1f5f9';
export const HEYTA_COLOR_PRIORITY_HIGH: string = '#dc2626';
export const HEYTA_COLOR_PRIORITY_MEDIUM: string = '#b45309';
export const HEYTA_COLOR_PRIORITY_LOW: string = '#0284c7';
export const HEYTA_COLOR_PRIORITY_NONE: string = '#94a3b8';
export const HEYTA_COLOR_HEAT_0: string = '#f1f5f9';
export const HEYTA_COLOR_HEAT_1: string = '#bfdbfe';
export const HEYTA_COLOR_HEAT_2: string = '#93c5fd';
export const HEYTA_COLOR_HEAT_3: string = '#3b82f6';
export const HEYTA_COLOR_HEAT_4: string = '#1d4ed8';
export const HEYTA_COLOR_CATEGORY_1: string = '#991b1b';
export const HEYTA_COLOR_CATEGORY_2: string = '#ea580c';
export const HEYTA_COLOR_CATEGORY_3: string = '#16a34a';
export const HEYTA_COLOR_CATEGORY_4: string = '#0d9488';
export const HEYTA_COLOR_CATEGORY_5: string = '#0e7490';
export const HEYTA_COLOR_CATEGORY_6: string = '#1d4ed8';
export const HEYTA_COLOR_CATEGORY_7: string = '#a21caf';
export const HEYTA_COLOR_CATEGORY_8: string = '#be185d';
export const HEYTA_COLOR_FOCUS_WORK: string = '#2563eb';
export const HEYTA_COLOR_FOCUS_BREAK: string = '#059669';
export const HEYTA_COLOR_OVERLAY: string = '#0f172a80';
export const HEYTA_SPACE_0: number = 0;  // px
export const HEYTA_SPACE_1: number = 4;  // px
export const HEYTA_SPACE_2: number = 8;  // px
export const HEYTA_SPACE_3: number = 12;  // px
export const HEYTA_SPACE_4: number = 16;  // px
export const HEYTA_SPACE_5: number = 20;  // px
export const HEYTA_SPACE_6: number = 24;  // px
export const HEYTA_SPACE_8: number = 32;  // px
export const HEYTA_SPACE_10: number = 40;  // px
export const HEYTA_SPACE_12: number = 48;  // px
export const HEYTA_SPACE_16: number = 64;  // px
export const HEYTA_FONT_SIZE_2XS: number = 11;  // px
export const HEYTA_FONT_SIZE_XS: number = 12;  // px
export const HEYTA_FONT_SIZE_SM: number = 14;  // px
export const HEYTA_FONT_SIZE_BASE: number = 16;  // px
export const HEYTA_FONT_SIZE_LG: number = 18;  // px
export const HEYTA_FONT_SIZE_XL: number = 20;  // px
export const HEYTA_FONT_SIZE_2XL: number = 24;  // px
export const HEYTA_FONT_SIZE_3XL: number = 30;  // px
export const HEYTA_FONT_SIZE_4XL: number = 36;  // px
export const HEYTA_FONT_WEIGHT_REGULAR: number = 400;
export const HEYTA_FONT_WEIGHT_MEDIUM: number = 500;
export const HEYTA_FONT_WEIGHT_SEMIBOLD: number = 600;
export const HEYTA_FONT_WEIGHT_BOLD: number = 700;
export const HEYTA_LINE_HEIGHT_TIGHT: number = 1.25;
export const HEYTA_LINE_HEIGHT_NORMAL: number = 1.5;
export const HEYTA_LINE_HEIGHT_RELAXED: number = 1.75;
export const HEYTA_FONT_SANS: string = '\'Plus Jakarta Sans\', -apple-system, BlinkMacSystemFont, \'Segoe UI\', \'PingFang SC\', \'Hiragino Sans GB\', \'Microsoft YaHei\', \'Noto Sans SC\', sans-serif';
export const HEYTA_FONT_MONO: string = '\'JetBrains Mono\', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
export const HEYTA_RADIUS_NONE: number = 0;  // px
export const HEYTA_RADIUS_SM: number = 4;  // px
export const HEYTA_RADIUS_MD: number = 8;  // px
export const HEYTA_RADIUS_LG: number = 12;  // px
export const HEYTA_RADIUS_XL: number = 16;  // px
export const HEYTA_RADIUS_FULL: number = 9999;  // px
export const HEYTA_SHADOW_NONE: string = 'none';
export const HEYTA_SHADOW_SM: string = '0 1px 2px rgb(15 23 42 / 0.05)';
export const HEYTA_SHADOW_MD: string = '0 2px 8px rgb(15 23 42 / 0.08)';
export const HEYTA_SHADOW_LG: string = '0 8px 24px rgb(15 23 42 / 0.12)';
export const HEYTA_SHADOW_XL: string = '0 16px 48px rgb(15 23 42 / 0.16)';
export const HEYTA_SHADOW_FOCUS: string = '0 0 0 3px rgb(37 99 235 / 0.25)';
export const HEYTA_DURATION_INSTANT: number = 80;  // ms
export const HEYTA_DURATION_FAST: number = 150;  // ms
export const HEYTA_DURATION_NORMAL: number = 200;  // ms
export const HEYTA_DURATION_SLOW: number = 300;  // ms
export const HEYTA_DURATION_EXIT: number = 140;  // ms
export const HEYTA_DURATION_PRESS: number = 100;  // ms
export const HEYTA_EASE_STANDARD: string = 'cubic-bezier(0.2, 0, 0.2, 1)';
export const HEYTA_EASE_ENTER: string = 'cubic-bezier(0, 0, 0.2, 1)';
export const HEYTA_EASE_EXIT: string = 'cubic-bezier(0.4, 0, 1, 1)';
export const HEYTA_EASE_SPRING: string = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
export const HEYTA_Z_BASE: number = 0;
export const HEYTA_Z_STICKY: number = 100;
export const HEYTA_Z_DROPDOWN: number = 200;
export const HEYTA_Z_OVERLAY: number = 300;
export const HEYTA_Z_MODAL: number = 400;
export const HEYTA_Z_POPOVER: number = 500;
export const HEYTA_Z_TOAST: number = 600;
export const HEYTA_Z_TOOLTIP: number = 700;
export const HEYTA_ICON_XS: number = 14;  // px
export const HEYTA_ICON_SM: number = 16;  // px
export const HEYTA_ICON_MD: number = 20;  // px
export const HEYTA_ICON_LG: number = 24;  // px
export const HEYTA_ICON_XL: number = 32;  // px
export const HEYTA_TOUCH_TARGET_MIN: number = 44;  // px
export const HEYTA_FOCUS_RING_WIDTH: number = 2;  // px
export const HEYTA_LAYOUT_RAIL_WIDTH: number = 64;  // px
export const HEYTA_LAYOUT_SIDEBAR_WIDTH: number = 240;  // px
export const HEYTA_LAYOUT_SIDEBAR_MIN_WIDTH: number = 192;  // px
export const HEYTA_LAYOUT_SIDEBAR_MAX_WIDTH: number = 416;  // px
export const HEYTA_LAYOUT_HEADER_HEIGHT: number = 56;  // px
export const HEYTA_LAYOUT_CONTENT_MAX: number = 1200;  // px
export const HEYTA_LAYOUT_PROSE_MAX: string = '65ch';
export const HEYTA_LAYOUT_QUADRANT_MIN_HEIGHT: number = 192;  // px
export const HEYTA_LAYOUT_PANEL_MAX_HEIGHT: number = 384;  // px
export const HEYTA_LAYOUT_TWO_COLUMN_MIN: number = 768;  // px
export const HEYTA_LAYOUT_INPUT_MIN: number = 224;  // px
export const HEYTA_LAYOUT_MODAL_MAX: number = 640;  // px
export const HEYTA_BORDER_WIDTH_THIN: number = 1;  // px
export const HEYTA_BORDER_WIDTH_THICK: number = 2;  // px
export const HEYTA_NAV_TAB_BAR_HEIGHT: number = 64;  // px
export const HEYTA_NAV_TAB_ICON_SIZE: number = 24;  // px
export const HEYTA_NAV_TAB_LABEL_SIZE: number = 11;  // px
export const HEYTA_NAV_TAB_ITEM_MIN_WIDTH: number = 64;  // px
export const HEYTA_NAV_TAB_INDICATOR_INSET: number = 4;  // px
export const HEYTA_NAV_TAB_INDICATOR_WIDTH: number = 20;  // px
export const HEYTA_NAV_TAB_INDICATOR_HEIGHT: number = 3;  // px
export const HEYTA_NAV_APP_BAR_HEIGHT: number = 56;  // px
export const HEYTA_NAV_APP_BAR_TITLE_SIZE: number = 16;  // px
export const HEYTA_NAV_SAFE_TOP_MIN: number = 20;  // px
export const HEYTA_NAV_SAFE_BOTTOM_MIN: number = 8;  // px
export const HEYTA_SCREEN_GUTTER: number = 16;  // px
export const HEYTA_SCREEN_SECTION_GAP: number = 24;  // px
export const HEYTA_SCREEN_BOTTOM_INSET: number = 88;  // px
export const HEYTA_SIZE_CHECKBOX: number = 22;  // px
export const HEYTA_SIZE_ROW_MIN_HEIGHT: number = 56;  // px
export const HEYTA_SIZE_SWIPE_ACTION: number = 72;  // px
export const HEYTA_SIZE_AVATAR_SM: number = 24;  // px
export const HEYTA_SIZE_AVATAR_MD: number = 32;  // px
export const HEYTA_SIZE_AVATAR_LG: number = 40;  // px
export const HEYTA_SIZE_FAB: number = 56;  // px
export const HEYTA_SIZE_CHIP_HEIGHT: number = 28;  // px
export const HEYTA_SIZE_CHIP_PADDING_X: number = 10;  // px
export const HEYTA_SIZE_DIVIDER_INSET: number = 52;  // px
export const HEYTA_SIZE_BADGE_MIN_WIDTH: number = 18;  // px
export const HEYTA_SIZE_BADGE_HEIGHT: number = 18;  // px
export const HEYTA_SIZE_BADGE_DOT: number = 8;  // px
export const HEYTA_SIZE_BADGE_RING: number = 2;  // px
export const HEYTA_SIZE_FIELD_HEIGHT: number = 44;  // px
export const HEYTA_SIZE_FIELD_PADDING_X: number = 12;  // px
export const HEYTA_SIZE_PROGRESS_HEIGHT: number = 6;  // px
export const HEYTA_SIZE_FOCUS_RING: number = 180;  // px
export const HEYTA_SIZE_FOCUS_RING_STROKE: number = 10;  // px
export const HEYTA_TRACKING_DISPLAY: number = -0.022;  // em-ratio
export const HEYTA_TRACKING_TITLE: number = -0.019;  // em-ratio
export const HEYTA_TRACKING_BODY: number = -0.011;  // em-ratio
export const HEYTA_TRACKING_CAPTION: number = 0.006;  // em-ratio
export const HEYTA_MOTION_SPRING_DAMPING_DEFAULT: number = 1;
export const HEYTA_MOTION_SPRING_DAMPING_MOMENTUM: number = 0.8;
export const HEYTA_MOTION_SPRING_RESPONSE_MOVE: number = 0.4;
export const HEYTA_MOTION_SPRING_RESPONSE_SHEET: number = 0.3;
export const HEYTA_MOTION_SPRING_RESPONSE_ROTATION: number = 0.4;
export const HEYTA_MOTION_PRESS_SCALE: number = 0.97;
export const HEYTA_MOTION_DECELERATION_RATE: number = 0.998;
export const HEYTA_MOTION_RUBBER_BAND_CONSTANT: number = 0.55;
export const HEYTA_GESTURE_HYSTERESIS: number = 10;  // px
export const HEYTA_GESTURE_HIT_SLOP: number = 10;  // px
export const HEYTA_STATE_PRESSED_OPACITY: number = 0.08;
export const HEYTA_STATE_HOVER_OPACITY: number = 0.04;
export const HEYTA_STATE_DISABLED_OPACITY: number = 0.38;
export const HEYTA_BLUR_CHROME: number = 20;  // px
export const HEYTA_BLUR_SHEET: number = 30;  // px
export const HEYTA_MATERIAL_CHROME_TINT: string = '#ffffff9e';
export const HEYTA_MATERIAL_CHROME_TINT_STRONG: string = '#ffffffd9';
export const HEYTA_MATERIAL_PANEL_TINT: string = '#ffffffc7';
export const HEYTA_MATERIAL_EDGE_HIGHLIGHT: string = '#ffffff80';
export const HEYTA_MATERIAL_SHEET_TINT: string = '#ffffffeb';
export const HEYTA_MATERIAL_SCRIM: string = '#0f172a52';
export const HEYTA_MATERIAL_SCRIM_STRONG: string = '#0f172a80';

// SECTION: Dark
export const HEYTA_DARK_COLOR_PRIMARY: string = '#60a5fa';
export const HEYTA_DARK_COLOR_PRIMARY_HOVER: string = '#93c5fd';
export const HEYTA_DARK_COLOR_PRIMARY_ACTIVE: string = '#bfdbfe';
export const HEYTA_DARK_COLOR_PRIMARY_SUBTLE: string = '#2563eb29';
export const HEYTA_DARK_COLOR_PRIMARY_SUBTLE_HOVER: string = '#2563eb3d';
export const HEYTA_DARK_COLOR_ON_PRIMARY: string = '#020617';
export const HEYTA_DARK_COLOR_BACKGROUND: string = '#020617';
export const HEYTA_DARK_COLOR_SURFACE: string = '#0d1526';
export const HEYTA_DARK_COLOR_SURFACE_RAISED: string = '#131e33';
export const HEYTA_DARK_COLOR_SURFACE_SUNKEN: string = '#080e1a';
export const HEYTA_DARK_COLOR_FOREGROUND: string = '#f1f5f9';
export const HEYTA_DARK_COLOR_FOREGROUND_MUTED: string = '#cbd5e1';
export const HEYTA_DARK_COLOR_FOREGROUND_SUBTLE: string = '#94a3b8';
export const HEYTA_DARK_COLOR_FOREGROUND_INVERSE: string = '#020617';
export const HEYTA_DARK_COLOR_BORDER: string = '#1e2b45';
export const HEYTA_DARK_COLOR_BORDER_STRONG: string = '#2b3b5c';
export const HEYTA_DARK_COLOR_BORDER_SUBTLE: string = '#16203a';
export const HEYTA_DARK_COLOR_RING: string = '#60a5fa';
export const HEYTA_DARK_COLOR_HOVER: string = '#94a3b81f';
export const HEYTA_DARK_COLOR_ACTIVE: string = '#94a3b833';
export const HEYTA_DARK_COLOR_DISABLED_BG: string = '#16203a';
export const HEYTA_DARK_COLOR_DISABLED_FG: string = '#475569';
export const HEYTA_DARK_COLOR_SUCCESS: string = '#34d399';
export const HEYTA_DARK_COLOR_SUCCESS_STRONG: string = '#6ee7b7';
export const HEYTA_DARK_COLOR_SUCCESS_SUBTLE: string = '#05966929';
export const HEYTA_DARK_COLOR_WARNING: string = '#fbbf24';
export const HEYTA_DARK_COLOR_WARNING_STRONG: string = '#fcd34d';
export const HEYTA_DARK_COLOR_WARNING_SUBTLE: string = '#d9770629';
export const HEYTA_DARK_COLOR_DANGER: string = '#f87171';
export const HEYTA_DARK_COLOR_DANGER_STRONG: string = '#fca5a5';
export const HEYTA_DARK_COLOR_DANGER_SUBTLE: string = '#dc262629';
export const HEYTA_DARK_COLOR_INFO: string = '#38bdf8';
export const HEYTA_DARK_COLOR_INFO_STRONG: string = '#7dd3fc';
export const HEYTA_DARK_COLOR_INFO_SUBTLE: string = '#0284c729';
export const HEYTA_DARK_COLOR_QUADRANT_1: string = '#f87171';
export const HEYTA_DARK_COLOR_QUADRANT_1_SUBTLE: string = '#dc262629';
export const HEYTA_DARK_COLOR_QUADRANT_2: string = '#60a5fa';
export const HEYTA_DARK_COLOR_QUADRANT_2_SUBTLE: string = '#2563eb29';
export const HEYTA_DARK_COLOR_QUADRANT_3: string = '#fbbf24';
export const HEYTA_DARK_COLOR_QUADRANT_3_SUBTLE: string = '#d9770629';
export const HEYTA_DARK_COLOR_QUADRANT_4: string = '#94a3b8';
export const HEYTA_DARK_COLOR_QUADRANT_4_SUBTLE: string = '#94a3b824';
export const HEYTA_DARK_COLOR_PRIORITY_HIGH: string = '#f87171';
export const HEYTA_DARK_COLOR_PRIORITY_MEDIUM: string = '#fbbf24';
export const HEYTA_DARK_COLOR_PRIORITY_LOW: string = '#38bdf8';
export const HEYTA_DARK_COLOR_PRIORITY_NONE: string = '#64748b';
export const HEYTA_DARK_COLOR_HEAT_0: string = '#16203a';
export const HEYTA_DARK_COLOR_HEAT_1: string = '#1e3a8a';
export const HEYTA_DARK_COLOR_HEAT_2: string = '#1d4ed8';
export const HEYTA_DARK_COLOR_HEAT_3: string = '#3b82f6';
export const HEYTA_DARK_COLOR_HEAT_4: string = '#93c5fd';
export const HEYTA_DARK_COLOR_CATEGORY_1: string = '#f87171';
export const HEYTA_DARK_COLOR_CATEGORY_2: string = '#fb923c';
export const HEYTA_DARK_COLOR_CATEGORY_3: string = '#34d399';
export const HEYTA_DARK_COLOR_CATEGORY_4: string = '#99f6e4';
export const HEYTA_DARK_COLOR_CATEGORY_5: string = '#22d3ee';
export const HEYTA_DARK_COLOR_CATEGORY_6: string = '#6366f1';
export const HEYTA_DARK_COLOR_CATEGORY_7: string = '#e879f9';
export const HEYTA_DARK_COLOR_CATEGORY_8: string = '#f472b6';
export const HEYTA_DARK_COLOR_FOCUS_WORK: string = '#60a5fa';
export const HEYTA_DARK_COLOR_FOCUS_BREAK: string = '#34d399';
export const HEYTA_DARK_COLOR_OVERLAY: string = '#020617b3';
export const HEYTA_DARK_SHADOW_SM: string = '0 1px 2px rgb(0 0 0 / 0.4)';
export const HEYTA_DARK_SHADOW_MD: string = '0 2px 8px rgb(0 0 0 / 0.5)';
export const HEYTA_DARK_SHADOW_LG: string = '0 8px 24px rgb(0 0 0 / 0.6)';
export const HEYTA_DARK_SHADOW_XL: string = '0 16px 48px rgb(0 0 0 / 0.7)';
export const HEYTA_DARK_SHADOW_FOCUS: string = '0 0 0 3px rgb(96 165 250 / 0.35)';
export const HEYTA_DARK_MATERIAL_CHROME_TINT: string = '#0d1526b8';
export const HEYTA_DARK_MATERIAL_CHROME_TINT_STRONG: string = '#0d1526e6';
export const HEYTA_DARK_MATERIAL_PANEL_TINT: string = '#0d1526db';
export const HEYTA_DARK_MATERIAL_EDGE_HIGHLIGHT: string = '#ffffff1f';
export const HEYTA_DARK_MATERIAL_SHEET_TINT: string = '#0d1526f0';
export const HEYTA_DARK_MATERIAL_SCRIM: string = '#02061780';
export const HEYTA_DARK_MATERIAL_SCRIM_STRONG: string = '#020617ad';

// SECTION: ReducedMotion
// 需在系统开启「减少动效」时覆盖 Light 的 duration 常量。
export const HEYTA_REDUCED_MOTION_DURATION_INSTANT: number = 1;  // ms
export const HEYTA_REDUCED_MOTION_DURATION_FAST: number = 1;  // ms
export const HEYTA_REDUCED_MOTION_DURATION_NORMAL: number = 1;  // ms
export const HEYTA_REDUCED_MOTION_DURATION_SLOW: number = 1;  // ms
export const HEYTA_REDUCED_MOTION_DURATION_EXIT: number = 1;  // ms
export const HEYTA_REDUCED_MOTION_DURATION_PRESS: number = 1;  // ms
