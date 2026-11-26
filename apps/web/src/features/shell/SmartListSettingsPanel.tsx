/**
 * 智能清单设置（#18）
 * ===================
 *
 * 「显示哪几条智能清单 / 怎么排序」的配置面，落在设置「功能与 AI」组里，
 * 与「功能模块」同排 —— 两者回答的是同一句用户会说出口的话：**侧栏里出现哪些入口**。
 *
 * ## 为什么没有说明文字
 *
 * 行本身就是答案：勾选框 = 显示 / 不显示，上下两枚箭头 = 顺序。
 * 按 AGENTS §0.2 与 `design-system.md` 的设置禁令，不写任何 caption / hint。
 *
 * ## 判断不在这里
 *
 * 勾选与排序的语义在 `@heyta/domain` 的 `smart-list.ts`（纯函数 + 单测）；
 * 这里只把回调递上去。壳不自己算顺序 —— 那是第二份裁决。
 */

import { ArrowDown, ArrowUp } from 'lucide-react';

import type { SmartListConfig, SmartListKey } from '@heyta/domain';
import { ICON_SIZE } from '@heyta/design-system';
import { useI18n, type MessageKey } from '@heyta/i18n';

const LABEL: Record<SmartListKey, MessageKey> = {
  today: 'web.shell.nav.today',
  next7Days: 'web.shell.nav.next7Days',
  completed: 'web.shell.nav.completed',
};

export function SmartListSettingsPanel({
  config,
  onToggle,
  onMove,
}: {
  config: SmartListConfig;
  onToggle: (key: SmartListKey, visible: boolean) => void;
  onMove: (key: SmartListKey, direction: 'up' | 'down') => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <section className="ht-settings" data-testid="smart-list-settings">
      <h2 className="ht-settings__title ht-type-section-title">{t('web.settings.smartList.title')}</h2>
      <div className="ht-settings__rows" data-testid="smart-list-settings-rows">
        {config.entries.map((entry, index) => (
          <div key={entry.key} className="ht-settings__preference-row">
            <div className="ht-settings__preference-label">
              <h3 className="ht-settings__h3 ht-type-row-title">{t(LABEL[entry.key])}</h3>
            </div>
            <div className="ht-settings__option" data-testid={`smart-list-order-${entry.key}`}>
              <button
                type="button"
                className="ht-settings__preset-option"
                aria-label={`${t(LABEL[entry.key])} — ${t('web.settings.smartList.moveUp')}`}
                data-testid={`smart-list-up-${entry.key}`}
                disabled={index === 0}
                onClick={() => onMove(entry.key, 'up')}
              >
                <ArrowUp size={ICON_SIZE.sm} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="ht-settings__preset-option"
                aria-label={`${t(LABEL[entry.key])} — ${t('web.settings.smartList.moveDown')}`}
                data-testid={`smart-list-down-${entry.key}`}
                disabled={index === config.entries.length - 1}
                onClick={() => onMove(entry.key, 'down')}
              >
                <ArrowDown size={ICON_SIZE.sm} aria-hidden="true" />
              </button>
            </div>
            <span className="ht-settings__switch-cell">
              <input
                type="checkbox"
                role="switch"
                aria-label={t(LABEL[entry.key])}
                data-testid={`smart-list-visible-${entry.key}`}
                checked={entry.visible}
                onChange={() => onToggle(entry.key, !entry.visible)}
              />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
