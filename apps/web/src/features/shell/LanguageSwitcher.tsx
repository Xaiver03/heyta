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
 * ## 形态：一个**带标签的分组**，组里列出所有已启用语言的自称
 *
 * 每一项显示**这门语言自己的文字**（`中文` / `English`），而不是当前语言的翻译。
 * 这不是审美选择：看不懂当前语言的用户，恰恰是最需要找到这个入口的人，
 * 把"英文"翻成当前语言会把这部分用户正好挡在门外。词条表 `common.lang.*`
 * 的既定用法就是这个（见 `zh-CN.ts` / `en.ts` 里那段注释）。
 * 落地页的复刻（`apps/landing/src/mockup/AppWindow.tsx`）与移动端设置页
 * （`apps/mobile/src/screens/SettingsScreen.tsx` 的「语言」一节）用的是
 * **同一条规则**，所以三端只有摆位不同、语义相同。
 *
 * ## 🔴 2026-10-04 形态变更：从"两枚裸 `.ht-chip`"换成带标签的分组
 *
 * 产品负责人：「中英文的那个切换组件太离谱了，你看一下规范应该是什么样子的。」
 * 查到的规范**全在仓库里**，四条，每条都指得到具体出处（逐条的实测数字与
 * 令牌名记在 `apps/web/src/styles/app/main-area.css` 那段样式头上）：
 *
 *   1. 顶栏的控件必须**自己说明自己是什么** —— 同一个错法在
 *      `App.tsx`（排序下拉）与 `main-area.css`（`.ht-header__view`）里
 *      各记过一次，原话是"用户根本不知道它们是什么"。
 *   2. 顶栏这一区的既有语言是 `.ht-btn`（`SyncBar`、主题按钮都是），
 *      `.ht-chip` 是**设置/AI 面板内的筛选胶囊** —— 借错了层。
 *   3. 触控目标 ≥ 44px（`MASTER.md` §3，`--ht-touch-target-min`）。
 *   4. 选中态不许与焦点环同形（`--ht-color-ring` 在两套主题里就是主色）。
 *
 * 结论是**换摆位与外观，不换语义**：`LOCALES` 驱动、自称、`lang`、
 * `aria-current`、点当前项无操作，这五件一条都没动 ——
 * 判据仍在 `apps/web/tests/language-switcher.spec.tsx`。
 *
 * ## 几个刻意的选择
 *
 * - **不做成下拉**（落地页那颗 globe 菜单是营销面，切语言是**整页跳转**，
 *   弹层里放的是 `<a>`；这里切语言是**当场改状态**，弹层只会多一次点击，
 *   并且要额外处理焦点与 Esc（§7 第 80 条 RNW 吞 keydown 那一串）。
 *   更要紧的是：收进弹层之后"我当前是哪门语言"在收起状态就**看不见**了，
 *   而下面那条"标出当前位置"的裁决正是为了不让用户靠试错找自己在哪儿。
 * - **当前语言那一项标出来而不是隐藏**：三项以上时，"我在这儿"必须看得见，
 *   否则用户要靠试错找当前位置。点它是无操作（不写盘、不发账号请求）。
 *   标记是**勾 + 填充 + 中性边框**三通道冗余，不只是颜色（`MASTER.md` §3）。
 * - **标签用 `aria-labelledby` 指向那个可见的「语言」**：名称只有一处事实源。
 *   写成 `aria-label` 就会和可见文字各写一份，而这两份必然漂。
 * - `lang` 属性写在自己的标签上：屏幕阅读器用正确的发音规则读那个词
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

import { ICON_SIZE } from '@heyta/design-system';
import { LOCALES, LOCALE_LABEL_KEY, useI18n } from '@heyta/i18n';
import { Check } from 'lucide-react';

import { pushLocaleToAccount } from '../../lib/locale-account.js';
import { useLocalePreference } from '../../lib/locale-preference.js';

/** 可见标签的 `id`。只此一个实例（顶栏），所以不需要后缀。 */
const LABEL_ID = 'ht-header-lang-label';

export function LanguageSwitcher(): React.JSX.Element {
  const { locale, t } = useI18n();
  const { setLocale } = useLocalePreference();
  const label = t('web.shell.lang.label');

  return (
    <div
      className="ht-header__lang"
      // 一组互斥选项 = `role="group"`（不是 radiogroup：那要自己实现方向键漫游，
      // 而这里 Tab 到每一项本来就是可用的）。名字由**可见**的那个标签提供。
      role="group"
      aria-labelledby={LABEL_ID}
      data-testid="language-switcher"
    >
      <span id={LABEL_ID} className="ht-header__lang-label ht-type-caption">
        {label}
      </span>
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          className={
            option === locale
              ? 'ht-header__lang-option ht-header__lang-option--on ht-type-caption'
              : 'ht-header__lang-option ht-type-caption'
          }
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
          {option === locale ? <Check size={ICON_SIZE.xs} aria-hidden="true" /> : null}
        </button>
      ))}
    </div>
  );
}
