/**
 * 系统给的语言串 → 我们支持的语言。
 * =================================
 *
 * 🔴 **为什么住在 i18n 包里**：这个判定此前只在移动端有一份（设备语言标签），
 * 2026-10-01 起 web 的首启层也要读 `navigator.language`（四层解析链，
 * `docs/plans/i18n-multilingual.md` §3）—— 同一逻辑的两份实现必然漂移
 * （本仓库的老教训），所以收成一份。
 *
 * 输入形状刻意宽容，因为各平台给的东西不一样：
 *
 *   - web：`navigator.language`，单标签（`zh-CN` / `en-US`）；
 *   - iOS：`AppleLocale` / `AppleLanguages[0]`（`zh-Hans-CN`）；
 *   - Android：`I18nManager.localeIdentifier`（`zh_CN` —— 下划线）；
 *   - 还会遇到逗号列表（`zh-Hans-CN,en-US`）。
 *
 * ⚠️ server 的 Accept-Language 解析（带 q 值、多条目排序）是**另一个函数**，
 * 留在服务端 —— 等第三种语言落地时再决定搬运方式（镜像里没有本包）。
 */

import { DEFAULT_LOCALE, LOCALES, type Locale } from './types.js';

/**
 * 把一个（或一串逗号分隔的）语言标签归一成我们支持的语言。
 *
 * 规则（大小写不敏感，`-` / `_` 都认）：
 *   1. **整串精确匹配**优先 —— 当前两种语言下没有「同主语言不同地区」的组合，
 *      这一遍主要服务于将来（例如同时有 `en` 与 `en-GB` 时，`en-GB` 的设备该精确命中后者）；
 *   2. 其次**主语言子标签**匹配：`zh-Hans-CN` / `zh_CN` / `zh-Hant-TW` 的主语言都是 `zh`；
 *   3. 列表形态**取第一个可识别的候选**，不是取第一段：
 *      `'zh-Hans-CN,en-US'` 与 `'fr-FR,en-US'` 应分别落到 `zh-CN` 与 `en`；
 *   4. 都认不出来（含 `undefined` / `null` / 空串 / `'fr-FR'`）→ `DEFAULT_LOCALE`。
 *      **产品明确：兜底必须是中文**（不猜 `fr → en` 这类映射）。
 *
 * 🔴 主子标签必须是**相等**比较，不是 `startsWith`：`et-EE`（爱沙尼亚语）
 * 以 `et` 开头但与 `en` 无关，`zhu` 也不是 `zh` —— 用前缀字符串匹配会把它们
 * 误判（mobile 时代的测试钉过这两条，用例已迁到本包的 `tests/match.spec.ts`）。
 */
export function matchLocale(raw: string | undefined | null): Locale {
  if (raw === undefined || raw === null) return DEFAULT_LOCALE;
  const candidates = raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '');
  if (candidates.length === 0) return DEFAULT_LOCALE;

  for (const candidate of candidates) {
    for (const locale of LOCALES) {
      if (candidate === locale.toLowerCase()) return locale;
    }
  }

  for (const candidate of candidates) {
    const primary = candidate.split(/[-_]/)[0] ?? '';
    if (primary === '') continue;
    for (const locale of LOCALES) {
      const localePrimary = locale.split('-')[0]?.toLowerCase() ?? '';
      if (localePrimary === primary) return locale;
    }
  }
  return DEFAULT_LOCALE;
}
