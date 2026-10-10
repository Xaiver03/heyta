/**
 * 移动端的语言从哪来
 * ====================
 *
 * 🔴 **这里没有 URL 可读。** 落地页的语言由路径决定（`/` 与 `/en/`），
 * 移动端没有这个入口，只能问系统：设备设的是哪种语言。
 *
 * 为什么不引入 `expo-localization`：本仓库的依赖要过两道门（可维护性 + 许可证）
 * 并逐项登记，而这件事只需要读两个已存在的原生模块。**不引入任何新依赖。**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 两个平台给的东西**形状不一样**，这不是可以抹平的：
 *
 *   - iOS：`SettingsManager.settings.AppleLocale`（如 `zh-Hans-CN`），
 *     拿不到时退到 `AppleLanguages[0]`；
 *   - Android：`I18nManager.localeIdentifier`（如 `zh_CN`）。
 *
 * 还有的形态是**语言列表**（`zh-Hans-CN,en-US`）。
 * **「认哪些语言、怎么切子标签」的判定不在本文件** —— 2026-10-01 起统一用
 * `@heyta/i18n` 的 `matchLocale`：web 的 `navigator.language` 首启层用的是
 * 同一个函数，此前 mobile 自带的 `classifyLocale` 与它是同一逻辑的两份实现，
 * 先收掉防漂移。用例整体迁去了 `packages/i18n/tests/match.spec.ts`。
 * `resolveDeviceLocale`（问哪个原生模块、怎么防御）是平台差异，
 * 放在 `apps/*` 是对的（AGENTS.md §3.5）。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 🔴 `react-native` 用**延迟 require**，不是顶层 `import`。
 * 本仓库的移动端测试全部跑在 node 里、**刻意不加载 react-native**
 * （`tests/date.spec.ts` 文件头写着这条纪律：加载它会直接解析失败）。
 * 顶层 import 会让"只想测语言解析"的用例根本跑不起来；
 * 而 `resolveDeviceLocale` 只在设备上初始化 `App.tsx` 时才会被调用。
 */

import { DEFAULT_LOCALE, matchLocale, type Locale } from '@heyta/i18n';

/** iOS 的 `SettingsManager.settings` 里我们真正会读的两个字段。 */
interface AppleSettings {
  AppleLocale?: unknown;
  AppleLanguages?: unknown;
}

/** 原生模块在桥接失败时可能是 `undefined`，所以整条读取路径都必须防御。 */
function readNativeModules(): Record<string, unknown> | undefined {
  try {
    const modules = (require('react-native') as { NativeModules?: Record<string, unknown> })
      .NativeModules;
    return modules;
  } catch {
    // 测试环境（node）没有 react-native —— 这条路径不该被走到，
    // 真走到了也只是"拿不到系统语言"，兜底正好是默认语言。
    return undefined;
  }
}

/**
 * 读设备语言。**整体包 try/catch**：任何一步拿不到都回落到 `DEFAULT_LOCALE`。
 *
 * 🔴 语言判定失败**不该让应用起不来**。原生模块的属性访问在某些构建里会
 * 抛异常（而不是返回 `undefined`），所以这里不能只写 `?.` ——
 * 那挡不住"属性 getter 自己抛"这一类。
 */
export function resolveDeviceLocale(): Locale {
  return resolveNativeLocale(readNativeModules());
}

/** 平台输入的优先级可独立验证；已选设备偏好优先于系统语言。 */
export function resolveNativeLocale(modules: Record<string, unknown> | undefined): Locale {
  try {
    const widget = modules?.HeytaWidget as { preferredLocale?: unknown; deviceLocale?: unknown } | undefined;
    if (widget?.preferredLocale === 'zh-CN' || widget?.preferredLocale === 'en') return widget.preferredLocale;
    if (typeof widget?.deviceLocale === 'string' && widget.deviceLocale !== '') {
      return matchLocale(widget.deviceLocale);
    }
    if (modules !== undefined) {
      const settings = modules.SettingsManager as { settings?: AppleSettings } | undefined;
      const appleLocale = settings?.settings?.AppleLocale;
      if (typeof appleLocale === 'string' && appleLocale !== '') return matchLocale(appleLocale);
      const appleLanguages = settings?.settings?.AppleLanguages;
      if (Array.isArray(appleLanguages)) {
        const first = appleLanguages[0];
        if (typeof first === 'string' && first !== '') return matchLocale(first);
      }
      const i18nManager = modules.I18nManager as { localeIdentifier?: unknown } | undefined;
      const androidLocale = i18nManager?.localeIdentifier;
      if (typeof androidLocale === 'string' && androidLocale !== '') return matchLocale(androidLocale);
    }
  } catch {
    // 原生常量 getter 失败时仍可启动应用。
  }
  return DEFAULT_LOCALE;
}
