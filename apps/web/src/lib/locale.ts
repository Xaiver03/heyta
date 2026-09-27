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

/**
 * 落地页把语言带进应用时用的查询参数（`?lang=en`）。
 *
 * 来源是 `apps/landing/src/lib/app-url.ts`。落地页的语言由 **URL** 决定
 * （它要能被中英各自收录），应用的语言由**这里的偏好存储**决定，两边原本不通 ——
 * 于是"读完英文落地页 → 点进应用看到中文"。这个参数就是那座桥。
 */
const LANG_PARAM = 'lang';

/** 运行时校验存储里的值 —— 存了旧版本不认得的语言时不能被它带走。 */
export function isLocale(value: string | null): value is Locale {
  return value !== null && (LOCALES as readonly string[]).includes(value);
}

/**
 * 从 `?lang=` 取语言。取不到受支持的值就返回 `null` —— 不猜、不回落，
 * 由调用方决定兜底（见 `resolveInitialLocale`）。
 */
function localeFromSearch(search: string): Locale | null {
  const value = new URLSearchParams(search).get(LANG_PARAM);
  return isLocale(value) ? value : null;
}

/**
 * 读取初始语言：**已存的有效偏好 > 落地页带来的 `?lang=` > 默认语言**。
 *
 * ⚠️ 与 `resolveInitialTheme` 不同，这里**没有"系统偏好"这一层** ——
 * 见文件头：web 刻意不做设备语言自动判断。
 *
 * 🔴 **参数必须排在已存偏好之后，顺序不能反。** `?lang=` 会**留在地址栏里**，
 * 若它更强就会出现"落地页带参数进来 → 在应用里手动切成中文 → 刷新"被那个陈旧
 * 参数翻回英文的情形 —— 用户明确的意图被 URL 覆盖，且看起来像"设置没保存"。
 * 反过来不会丢东西：没存过偏好的人（真正需要这个参数的访客）照样拿得到它。
 */
export function resolveInitialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // 隐私模式下 localStorage 可能抛错。降级到默认语言，不要崩。
  }
  // 没存过偏好 —— 接受落地页带来的 `?lang=`。应用不读 `navigator.language`，
  // 所以这是访客此刻**唯一**的语言信号。
  const fromUrl = localeFromSearch(window.location.search);
  if (fromUrl !== null) return fromUrl;
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
