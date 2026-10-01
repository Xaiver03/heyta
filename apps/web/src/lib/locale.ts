/**
 * 语言偏好（应用侧的语言来源）
 * ============================
 *
 * 🔴 **web 的语言由四层解析链决定**（2026-10-01 产品拍板，
 * `docs/plans/i18n-multilingual.md` §3），与 `apps/landing` 的
 * "语言由 URL 决定" 刻意不同：落地页要 SEO，中英必须是两个可被收录、
 * 可被分享的地址；应用在本地存储之后，没有 SEO 需求，也没有路由 ——
 * 用 URL 表达语言会凭空引入一套路由。
 *
 *   1. 本机显式选择（localStorage，由本文件的 `applyLocale` 落盘）
 *   2. 账号语言（登录后采纳；接线在 auth store，不在本文件）
 *   3. 系统语言（`navigator.language`，本文件负责）
 *   4. `zh-CN` 兜底（产品明确：兜底必须是中文）
 *
 * 🔴 **`navigator.language` 只填第 3 层，永远盖不过第 1 层。**
 * 此前这里刻意不读设备语言，理由是"自动判断会让明确选过英文的用户
 * 换个浏览器又被翻回中文"—— 那个担忧只成立于"存储被忽略"的时候；
 * 四层链下同一浏览器的显式选择永远更高，而新浏览器上系统语言是比
 * 锁死中文更好的首启猜测。2026-10-01 拍板推翻旧决策，
 * `tests/locale.spec.ts` 的反向断言同步翻转（改成钉"已存偏好胜过系统语言"）。
 *
 * 形状照 `lib/theme.ts`：读/apply 两个纯函数，
 * 读取整体包 try/catch（隐私模式下 localStorage 会抛）。
 */

import { LOCALES, matchLocale, type Locale } from '@heyta/i18n';

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
 * 读取初始语言：**已存的有效偏好 > 落地页带来的 `?lang=` > 系统语言 > 默认语言**。
 *
 * 🔴 **参数必须排在已存偏好之后，顺序不能反。** `?lang=` 会**留在地址栏里**，
 * 若它更强就会出现"落地页带参数进来 → 在应用里手动切成中文 → 刷新"被那个陈旧
 * 参数翻回英文的情形 —— 用户明确的意图被 URL 覆盖，且看起来像"设置没保存"。
 * 反过来不会丢东西：没存过偏好的人（真正需要这个参数的访客）照样拿得到它。
 *
 * 🔴 **`?lang=` 排在系统语言之前**：那是用户**刚在落地页读着**的语言 ——
 * 落地页的 URL 语言本身就是一次显式选择，比设备语言的猜测更可信。
 *
 * 系统语言只在「没偏好、没参数」时填首启（文件头第 3 层）；
 * 标签匹配统一走 `@heyta/i18n` 的 `matchLocale`，不受支持的系统语言
 * 落回默认语言。
 */
export function resolveInitialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // 隐私模式下 localStorage 可能抛错。降级到下一层，不要崩。
  }
  // 没存过偏好 —— 接受落地页带来的 `?lang=`（高于系统语言，见上）。
  const fromUrl = localeFromSearch(window.location.search);
  if (fromUrl !== null) return fromUrl;
  // 连参数也没有 —— 这才是首启访客：问系统语言（2026-10-01 拍板的第 3 层）。
  return matchLocale(navigator.language);
}

/**
 * 激活一门语言：同步 `<html lang>`、维护模块级现状、通知订阅者 —— **不落盘**。
 *
 * `<html lang>` 不是装饰 —— 屏幕阅读器按它选发音、浏览器按它选断行规则。
 * 首启的推断值（`navigator.language` / `?lang=`）只激活不落盘，见 `applyLocale`。
 */
export function activateLocale(locale: Locale): void {
  activeLocale = locale;
  document.documentElement.lang = locale;
  for (const listener of localeListeners) listener(locale);
}

/**
 * 应用一门语言并**持久化**。存储层只收**显式选择**（切换器点击、登录后采纳
 * 的账号语言）—— 首启推断值走 `activateLocale`，否则"看起来像选过"，
 * 账号语言就永远没机会被采纳（`hasStoredLocalePreference` 会误判）。
 */
export function applyLocale(locale: Locale): void {
  activateLocale(locale);
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // 见上。
  }
}

// ── 当前语言：非 React 侧的读取口 ────────────────────────────
//
// auth store 发邮件类请求时要带当前语言（`body.locale`），而它不在 React 里、
// 拿不到 useI18n。让每个调用点自己读 localStorage 是错的 —— 那读到的只是
// 「显式选择」，首启经 `navigator.language` 推断出来的语言不在里面。

let activeLocale: Locale | undefined;

/** 当前生效的界面语言（任何来源：显式选择 / `?lang=` / 系统 / 登录后采纳的账号语言）。 */
export function currentLocale(): Locale {
  return activeLocale ?? resolveInitialLocale();
}

/**
 * 是否存在**本机显式选择**（localStorage 里真的存过）—— 账号语言只在没有它时
 * 被采纳。首启推断值不落盘（见 `applyLocale`），所以这里读到的必然是选择过的。
 */
export function hasStoredLocalePreference(): boolean {
  try {
    return isLocale(localStorage.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
}

type LocaleListener = (locale: Locale) => void;
const localeListeners = new Set<LocaleListener>();

/**
 * 订阅语言变化。`LocaleHost` 用它把**非 React 侧**触发的切换（登录后采纳
 * 账号语言）同步进 React 状态；返回退订函数。
 */
export function subscribeLocale(listener: LocaleListener): () => void {
  localeListeners.add(listener);
  return () => {
    localeListeners.delete(listener);
  };
}
