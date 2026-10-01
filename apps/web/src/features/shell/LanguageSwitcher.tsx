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
 * ## 形态：列出**所有已启用语言**，每一项写它自己的自称
 *
 * 以前这里是**二态取反**（`locale === 'zh-CN' ? 'en' : 'zh-CN'`）—— 只有两种语言
 * 时它是对的，而它的错法很特殊：**加了第三种语言，它不报错、不红、测试照样绿**，
 * 只是那门新语言在界面上永远点不到。`packages/i18n` 的 `LOCALES` 一旦扩到
 * 日/韩，用户就得到一个"能切回中文、切不到日文"的切换器。
 * 所以现在**遍历 `LOCALES`**：清单由语言枚举决定，组件本身不含任何语言数量假设。
 *
 * 每一项显示**这门语言自己的文字**（`中文` / `English`），而不是当前语言的翻译。
 * 这不是审美选择：看不懂当前语言的用户，恰恰是最需要找到这个入口的人，
 * 把"英文"翻成当前语言会把这部分用户正好挡在门外。词条表 `common.lang.*`
 * 的既定用法就是这个（见 `zh-CN.ts` / `en.ts` 里那段注释）。
 *
 * ## 几个刻意的选择
 *
 * - **当前语言那一项标出来而不是隐藏**：三项以上时，"我在这儿"必须看得见，
 *   否则用户要靠试错找当前位置。点它是无操作（不写盘、不发账号请求）。
 * - **不做成下拉**：顶栏里弹层要处理焦点与 Esc（见 §7 第 80 条 RNW 吞 keydown
 *   那一串），而几个短词根本不需要省这点空间。
 * - **样式复用 `.ht-chip` / `.ht-chip--on`**（设置面板里已在用的那一对），
 *   **零新增 CSS**：组件返回 Fragment，间距来自 `.ht-header__actions` 自己的
 *   `gap` —— 它属于外壳顶栏的全局控件区，不该长成一个醒目的大组件。
 * - **`lang` 属性写在自己的标签上**：屏幕阅读器用正确的发音规则读那个词
 *   （用英文发音读 `中文` 会很怪）。
 * - 它**必须在 `LocalePreferenceProvider` 之内**：`useLocalePreference()` 在
 *   Provider 之外**刻意抛错**，因为"点了没反应"比"直接报错"难查得多。
 *
 * ## 加一门语言时这里要动什么（就绪清单）
 *
 * **不用动这个组件。** 自称词条 key 在 `@heyta/i18n` 的 `LOCALE_LABEL_KEY`
 * 里，它是 `Record<Locale, MessageKey>` ⇒ 往 `LOCALES` 加一门语言而没登记自称，
 * **编译不过**。这份 key 表同时被落地页的界面复刻消费，写两处必然漂移，
 * 所以它只有一处。
 */

import { LOCALES, LOCALE_LABEL_KEY, useI18n } from '@heyta/i18n';

import { pushLocaleToAccount } from '../../lib/locale-account.js';
import { useLocalePreference } from '../../lib/locale-preference.js';

export function LanguageSwitcher(): React.JSX.Element {
  const { locale, t } = useI18n();
  const { setLocale } = useLocalePreference();

  return (
    <>
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          className={option === locale ? 'ht-chip ht-chip--on' : 'ht-chip'}
          data-testid={`language-option-${option}`}
          // 当前语言：标出来，但点了不做事（下面 onClick 直接返回）。
          aria-current={option === locale ? 'true' : undefined}
          // 用这门语言自己的发音规则读它自己的名字。
          lang={option}
          onClick={() => {
            if (option === locale) return;
            setLocale(option);
            // 登录态下顺手写回账号（fire-and-forget）：未登录时函数内部直接返回。
            void pushLocaleToAccount(option);
          }}
        >
          {t(LOCALE_LABEL_KEY[option])}
        </button>
      ))}
    </>
  );
}
