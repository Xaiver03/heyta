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
 * ## 两个刻意的决定
 *
 * 1. **开关立刻生效、立刻落盘**，没有"保存"按钮。理由与主题/语言切换一致：
 *    这是一个即时可见的偏好，加一步确认只会让"我关掉了但没生效"变成可能。
 *    ⚠️ 而它**不是**破坏性操作 —— 关掉只是从导航里收起来，数据一条都不会丢，
 *    再打开就回来。所以不需要确认对话框。
 *
 * 2. **不加说明文字**（2026-11-27 收敛）。这一节原来有 1 句开场白 + 每行一句
 *    "它是什么"，一共 9 句 —— 全删。判据是 `docs/agents/ux-principles.md` §11：
 *    删掉它，用户不会少知道任何**会改变行为**的事：
 *      · 开关拨一下就看见左边导航跟着变，这件事由**动作本身**说明，不需要预告；
 *      · 模块名就是它是什么（「日历」「四象限」「看板」），一句话复述等于噪音；
 *      · "只影响这台设备"此前是唯一有信息量的那句 —— 现在由**布局**承担：
 *        它是设置页里的一节，与账号/同步那几节物理分开，且不带任何"同步"字样。
 *
 *    🔴 所以这一节**不许再加回副标题**。`check:settings-prose` 会按容器类名判红
 *    （见那道门的 `BANNED_CLASS`）。
 */

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

  return (
    <section className="ht-settings" data-testid={testID}>
      <h2 className="ht-settings__title ht-type-section-title">{t('web.shell.modules.title')}</h2>

      {/* 🔴 2026-10-25：这一节原本是**两列复选框卡片**，与上面几节的"左标签 / 右控件"
          不是同一种语法 —— 一屏里两种列表语法，眼睛每翻一节就得重新学一遍。
          现在改成同一套 `preference-row`：标签在左，开关在最右，
          与「任务与显示」那几行**逐格同构**。行为一个字没改（仍是即时生效、仍只影响本设备）。 */}
      <div className="ht-settings__rows" data-testid={`${testID}-cards`}>
        {SHELL_MODULES.map((m) => (
          <div key={m.key} className="ht-settings__preference-row">
            <div className="ht-settings__preference-label">
              <h3 className="ht-settings__h3 ht-type-row-title">{t(m.labelKey)}</h3>
            </div>
            {/* 尾格：让"开关"成为一个 44px 的单元格，而不是一枚 13px 的原生方框 ——
                否则同一列里它比别的控件矮一档，右缘也会差几像素（量到过 1264 vs 1267）。 */}
            <span className="ht-settings__switch-cell">
            <input
              type="checkbox"
              role="switch"
              // 每个开关都要能单独定位 —— 名称进可访问名，别只靠位置。
              aria-label={t(m.labelKey)}
              data-testid={`${testID}-${m.key}`}
              checked={enabled.has(m.key)}
              onChange={() => {
                onToggle(m.key);
              }}
            />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
