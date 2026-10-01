/**
 * 语言切换器（web 外壳）
 * ========================
 *
 * 🔴 为什么它必须存在 —— 这是本轮的核心，不是"顺手补一个控件"。
 *
 * `lib/locale.ts`（读偏好 / 落盘 / 同步 `<html lang>`）、
 * `lib/locale-preference.tsx`（`LocalePreferenceProvider`）、
 * `lib/locale-host.tsx`（把它们接到 `<App />` 上）**早就都接通了**，
 * 但**没有任何控件调用 `setLocale`**。后果是：
 *
 *   真实用户无法把 web 切到英文 —— `web.*` 的 en 词条只有测试显式传
 *   `locale="en"` 才会被触发。多语言"测得出、用不到"，
 *   等于没有多语言。补上这个入口，比再迁一百条文案更有价值。
 *
 * ## 形态：一个按钮，显示**目标语言的自称**
 *
 * 中文界面显示 `English`，英文界面显示 `中文`。这不是偷懒，是词条表
 * `common.lang.*` 的既定用法（见 `zh-CN.ts` / `en.ts` 里那段注释）：
 * **看不懂当前语言的用户，恰恰是最需要找到这个入口的人**，
 * 把"英文"翻译成当前语言会把这部分用户挡在门外。
 *
 * ⚠️ 所以本组件**不新增任何词条**，只用 `common.lang.zh` / `common.lang.en`。
 *
 * ## 几个刻意的选择
 *
 * - **不做成两个按钮的分段控件**：那需要一个"语言"分组标签（新词条），
 *   而按上面的理由，一个"点一下就换过去"的按钮已经足够自解释。
 * - **`lang` 属性跟着目标语言走**：屏幕阅读器会用正确的发音规则读那个词
 *   （读 `中文` 用英文发音会很怪）。零成本的正确性。
 * - **样式复用 `.ht-btn--ghost`**，与主题切换按钮同一档 —— 它属于外壳顶栏的
 *   全局控件区，不该长成一个醒目的大组件。
 * - 它**必须在 `LocalePreferenceProvider` 之内**：`useLocalePreference()` 在
 *   Provider 之外**刻意抛错**，因为"点了没反应"比"直接报错"难查得多。
 */

import { useI18n } from '@heyta/i18n';

import { pushLocaleToAccount } from '../../lib/locale-account.js';
import { useLocalePreference } from '../../lib/locale-preference.js';

export function LanguageSwitcher(): React.JSX.Element {
  const { locale, t } = useI18n();
  const { setLocale } = useLocalePreference();

  // 目标语言 = 另一个。当前只有两种语言，所谓"另一个"就是取反。
  const next = locale === 'zh-CN' ? 'en' : 'zh-CN';

  // ⚠️ `t(cond ? 'a' : 'b')` 这种写法**门禁认不出来**（它只认"字面量紧跟 t("），
  // 所以分支写在 `t(...)` **外面** —— 两个字面量各自出现在 t( 后面。
  const label = next === 'en' ? t('common.lang.en') : t('common.lang.zh');

  return (
    <button
      type="button"
      className="ht-btn ht-btn--ghost"
      data-testid="language-switcher"
      // 用目标语言自己的发音规则读这个词，而不是当前界面的语言。
      lang={next}
      onClick={() => {
        setLocale(next);
        // 登录态下顺手写回账号（fire-and-forget）：未登录时函数内部直接返回。
        void pushLocaleToAccount(next);
      }}
    >
      {label}
    </button>
  );
}
