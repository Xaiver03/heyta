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
 *     拿不到时退到 `AppleLanguages[0]`（如 `zh-Hans-CN`）；
 *   - Android：`I18nManager.localeIdentifier`（如 `zh_CN`）。
 *
 * 还有的形态是**语言列表**（`zh-Hans-CN,en-US`）—— 所以识别逻辑必须
 * 逐个候选找第一个能认出来的，而不是只切第一段。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ `classifyLocale` 是**纯函数**，单独可测（`tests/locale.spec.ts`）。
 * `resolveDeviceLocale` 是平台差异，放在 `apps/*` 是对的（AGENTS.md §3.5）。
 * 两者刻意放在**同一个文件**里：它们是"同一件事的两半"，拆开会让
 * "认哪些语言"这件事看起来有两个定义处。
 *
 * 🔴 `react-native` 用**延迟 require**，不是顶层 `import`。
 * 本仓库的移动端测试全部跑在 node 里、**刻意不加载 react-native**
 * （`tests/date.spec.ts` 文件头写着这条纪律：加载它会直接解析失败）。
 * 顶层 import 会让"只想测 classifyLocale"的用例根本跑不起来；
 * 而 `resolveDeviceLocale` 只在设备上初始化 `App.tsx` 时才会被调用。
 */

import { DEFAULT_LOCALE, type Locale } from '@heyta/i18n';

/**
 * 把系统给的语言串归一成我们支持的语言。
 *
 * 规则（大小写不敏感，`,` / `-` / `_` 都认）：
 *   - 主语言是 `zh` → `'zh-CN'`；
 *   - 主语言是 `en` → `'en'`；
 *   - 其余（含 `undefined` / `'fr-FR'` / `'ja-JP'`）→ `DEFAULT_LOCALE`。
 *
 * ⚠️ 列表形态**取第一个可识别的候选**，不是取第一段：
 * `'zh-Hans-CN,en-US'` 与 `'fr-FR,en-US'` 应该分别落到 `zh-CN` 与 `en`。
 * 只切第一段的话，第二种会错判成默认语言 —— 而那正是用户明明列了英文的场合。
 */
export function classifyLocale(raw: string | undefined | null): Locale {
  if (raw === undefined || raw === null) return DEFAULT_LOCALE;
  for (const candidate of raw.split(',')) {
    // 只取主语言子标签：`zh-Hans-CN` / `zh_CN` 的主语言都是 `zh`。
    const primary = candidate.trim().toLowerCase().split(/[-_]/)[0];
    if (primary === 'zh') return 'zh-CN';
    if (primary === 'en') return 'en';
  }
  return DEFAULT_LOCALE;
}

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
  try {
    const modules = readNativeModules();
    if (modules !== undefined) {
      const settings = modules.SettingsManager as { settings?: AppleSettings } | undefined;
      const appleLocale = settings?.settings?.AppleLocale;
      if (typeof appleLocale === 'string' && appleLocale !== '') return classifyLocale(appleLocale);

      const appleLanguages = settings?.settings?.AppleLanguages;
      if (Array.isArray(appleLanguages)) {
        const first = appleLanguages[0];
        if (typeof first === 'string' && first !== '') return classifyLocale(first);
      }

      const i18nManager = modules.I18nManager as { localeIdentifier?: unknown } | undefined;
      const androidLocale = i18nManager?.localeIdentifier;
      if (typeof androidLocale === 'string' && androidLocale !== '') {
        return classifyLocale(androidLocale);
      }
    }
  } catch {
    // 见文件头：系统语言的读取失败不是致命错误，默认语言是安全的落点。
  }
  return DEFAULT_LOCALE;
}
