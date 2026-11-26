/**
 * 用户字号偏好（Web）。
 *
 * 产品负责人 2026-11-25：字体整体偏大（对照滴答清单），要做**全局字号调整 + 个人设置**。
 *
 * 两条路径必须同时生效，否则界面会"一半大一半小"：
 *   1. **CSS 文本**（`.ht-type-*`、直接 `var(--ht-font-size-*)` 的样式）——
 *      由 `applyFontScale` 在 `<html>` 上覆盖字号变量。
 *   2. **共享 RN 组件**（`@heyta/ui` 里用数值 token 的 Text）——
 *      由 `resolveHeytaUiTheme({ fontScale })` 缩放 `font-size.*` token（见 theme.tsx）。
 *
 * 只缩放 `font-size.*`：间距、图标、触控目标保持原样。
 */

const STORAGE_KEY = 'heyta.fontScale';

export const FONT_SCALES = ['compact', 'standard', 'comfortable'] as const;
export type FontScale = (typeof FONT_SCALES)[number];

/** 相对设计基准（1 = tokens.css 原值）的比例。 */
export const FONT_SCALE_RATIO: Record<FontScale, number> = {
  compact: 0.88,
  standard: 1,
  comfortable: 1.12,
};

export function loadFontScale(): FontScale {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null && (FONT_SCALES as readonly string[]).includes(raw)) {
      return raw as FontScale;
    }
  } catch {
    /* 隐私模式 / 存储不可用时退回默认 */
  }
  // 默认「紧凑」：设计基准的 0.88，对齐滴答那种克制的字号比例。
  return 'compact';
}

export function saveFontScale(scale: FontScale): void {
  try {
    localStorage.setItem(STORAGE_KEY, scale);
  } catch {
    /* ignore */
  }
}

/** tokens.css 里定义的 11 档字号变量名（顺序无关）。 */
const FONT_SIZE_KEYS = [
  '2xs',
  'xs',
  'sm',
  'md',
  'base',
  'lg',
  'xl',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
] as const;

/**
 * 第一次调用时把 tokens.css 的**原始**字号值记下来。
 *
 * 🔴 必须缓存：覆盖写回 `<html>` 之后，`getComputedStyle` 读到的是覆盖值，
 * 再乘比例会反复叠乘（0.88、0.77、0.68…）。原值只在首次（尚未覆盖时）正确。
 */
let originals: Map<string, string> | null = null;

function captureOriginals(): void {
  if (originals !== null) return;
  originals = new Map();
  const cs = getComputedStyle(document.documentElement);
  for (const key of FONT_SIZE_KEYS) {
    originals.set(key, cs.getPropertyValue(`--ht-font-size-${key}`).trim());
  }
}

/** 把字号比例写到 `<html>` 的 style 上（幂等）。 */
export function applyFontScale(scale: FontScale): void {
  if (typeof document === 'undefined') return;
  captureOriginals();
  const ratio = FONT_SCALE_RATIO[scale];
  const root = document.documentElement;
  for (const key of FONT_SIZE_KEYS) {
    const base = originals?.get(key);
    if (base === undefined || base === '') continue;
    const match = /^([\d.]+)(rem|px|em)$/.exec(base);
    if (match === null) continue;
    const value = parseFloat(match[1]!) * ratio;
    root.style.setProperty(`--ht-font-size-${key}`, `${value}${match[2]!}`);
  }
}
