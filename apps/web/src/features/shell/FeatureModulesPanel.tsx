/**
 * 功能模块（设置页）
 * ==================
 *
 * 滴答设置页那一节的 heyta 版：**把不用的模块关掉，它就从左侧导航里消失**。
 *
 * ## 🔴 它同时回答两条产品要求
 *
 * 产品负责人 2026-09-29：
 * 1. 「左边的侧边栏那个按钮应该尽可能地减少」
 * 2. 看完滴答的设置页之后：「就是这样子的自定义也可以」
 *
 * ⇒ 只做"默认少"会砍掉别人正在用的东西；只做"可开关"则默认仍然很长。
 * **默认少 + 用户自己决定留哪些**，两个一起才对 —— 而这一节就是后半句的落点。
 *
 * ## 三个刻意的决定
 *
 * 1. **每张卡都有一句"它是什么"**，照滴答的做法（"在 6 种日历视图中规划任务"）。
 *    只有一个开关名的话，用户得先打开才知道那是什么 —— 而打开就意味着改了他的导航。
 *
 * 2. **开关立刻生效、立刻落盘**，没有"保存"按钮。理由与主题/语言切换一致：
 *    这是一个即时可见的偏好，加一步确认只会让"我关掉了但没生效"变成可能。
 *    ⚠️ 而它**不是**破坏性操作 —— 关掉只是从导航里收起来，数据一条都不会丢，
 *    再打开就回来。所以不需要确认对话框。
 *
 * 3. **说清它只影响这台设备**（`mobile.shell.modules.intro` 那句）。
 *    用户会预期"我在这台机器上的选择"与"我手机上的"是两件事 ——
 *    不说的话，他在手机上看不到刚打开的模块时会以为坏了。
 *    （为什么不做成同步：见 `modules.ts` 文件头。）
 */

import { useState } from 'react';

import { useI18n } from '@heyta/i18n';

import { SHELL_MODULES, type ShellModuleKey } from './modules.js';

export function FeatureModulesPanel({
  enabled,
  onToggle,
  testID = 'feature-modules',
}: {
  enabled: ReadonlySet<ShellModuleKey>;
  onToggle: (key: ShellModuleKey) => void;
  testID?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  /**
   * 是否已经动过至少一个开关。
   *
   * 🔴 那句"已保存"**只在真的改过之后才显示**。一直挂着它等于在说假话 ——
   * 用户刚进设置页什么都没动，界面却告诉他"已经保存了"。
   */
  const [touched, setTouched] = useState(false);

  return (
    <section className="ht-settings" data-testid={testID}>
      <h2 className="ht-settings__title ht-type-section-title">{t('web.shell.modules.title')}</h2>
      <p className="ht-settings__hint">{t('web.shell.modules.intro')}</p>

      <div className="ht-settings__cards" data-testid={`${testID}-cards`}>
        {SHELL_MODULES.map((m) => (
          <label key={m.key} className="ht-settings__card">
            <span className="ht-settings__cardText">
              <span className="ht-settings__cardTitle">{t(m.labelKey)}</span>
              <span className="ht-settings__cardNote">{t(m.noteKey)}</span>
            </span>
            <input
              type="checkbox"
              // 每个开关都要能单独定位 —— 名称进可访问名，别只靠位置。
              aria-label={t(m.labelKey)}
              data-testid={`${testID}-${m.key}`}
              checked={enabled.has(m.key)}
              onChange={() => {
                setTouched(true);
                onToggle(m.key);
              }}
            />
          </label>
        ))}
      </div>

      {touched ? (
        <p className="ht-settings__hint" data-testid={`${testID}-hint`}>
          {t('web.shell.modules.savedHint')}
        </p>
      ) : null}
    </section>
  );
}