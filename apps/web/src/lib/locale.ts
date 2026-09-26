/**
 * 语言偏好（应用侧的语言来源）
 * ============================
 *
 * 🔴 **web 的语言由 localStorage 里的用户偏好决定**，与 `apps/landing` 的
 * "语言由 URL 决定" 刻意不同（`docs/plans/i18n-multilingual.md` §3）：
 * 落地页要 SEO，中英必须是两个可被收录、可被分享的地址；应用在本地存储之后，
 * 没有 SEO 需求，也没有路由 —— 用 URL 表达语言会凭空引入一套路由。
 *
 * 🔴 **不读 `navigator.language`、更不按 `Accept-Language` 自动跳转。**
 * 设备语言识别那一半属于移动端（`apps/mobile/src/i18n/locale.ts`）：
 * 它没有用户可用的语言开关，只能问系统。web 有偏好，就问偏好；
 * 自动判断会让用户明确选了英文之后、换个浏览器又被翻回中文。
 *
 * 形状照 `lib/theme.ts`：用户已选 > 默认值，读/apply 两个纯函数，
 * 读取整体包 try/catch（隐私模式下 localStorage 会抛）。
 */

import { DEFAULT_LOCALE, LOCALES, type Locale } from '@heyta/i18n';

/** 与 `heyta.theme` 并列。键名只在这里定义一次。 */
const STORAGE_KEY = 'heyta.locale';

/** 运行时校验存储里的值 —— 存了旧版本不认得的语言时不能被它带走。 */
export function isLocale(value: string | null): value is Locale {
  return value !== null && (LOCALES as readonly string[]).includes(value);
}

/**
 * 读取初始语言：**已存的有效偏好 > 默认语言**。
 *
 * ⚠️ 与 `resolveInitialTheme` 不同，这里**没有"系统偏好"这一层** ——
 * 见文件头：web 刻意不做设备语言自动判断。
 */
export function resolveInitialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // 隐私模式下 localStorage 可能抛错。降级到默认语言，不要崩。
  }
  return DEFAULT_LOCALE;
}

/**
 * 应用语言：同步 `<html lang>` 并持久化。
 *
 * `<html lang>` 不是装饰 —— 屏幕阅读器按它选发音、浏览器按它选断行规则。
 * 与 `applyTheme` 一样，存不上不影响本次生效。
 */
export function applyLocale(locale: Locale): void {
  document.documentElement.lang = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // 见上。
  }
}
