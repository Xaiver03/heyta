/**
 * 日历「显示设置」面板（覆盖图谱 #40 · C 档 有靶子·缺功能）
 * ==========================================================
 *
 * 靶子（滴答 macOS 8.2.x 实拍，覆盖图谱附录 C12）：日历右上 `⋯` → **显示设置**。
 * 本文件把那一个入口做出来，但**只放现有数据模型真能支撑、且真生效的项**：
 *
 * | 控件 | 真效果 |
 * |---|---|
 * | 配色（按清单 / 按优先级 / 不着色） | `CalendarView` 的 `barAccentOf` 按模式换 token |
 * | 显示已完成 | `CalendarView` 按 `completedAt` 过滤 |
 * | 显示倒数纪念日 | 是否把倒数日这个第二数据源交给共享板 |
 *
 * 🔴 **不放进来的**（如实登记，不造假控件）：周起始日 / 密度 / 显示详细 / 检查事项 /
 * 重复周期 / 习惯 / 专注记录 / 辅助时区 —— 它们要么需要改共享 `CalendarBoard`
 * 的渲染分支或新增数据源、要么需要改 `@heyta/domain` 的 `monthGrid`（周一是硬编码），
 * 都在 `docs/plans/ticktack-calendar-features.md` §5.1「登记待合并」里。
 * 这里放一个按不动的开关，比没有更糟。
 *
 * 样式**只复用既有 `.ht-settings` 族**（不新造 ht-* 前缀族 —— `check:row-single-source` 盯着）。
 * 三项偏好由 `store.ts` 读 / 写 `calendar-display-pref`（`localStorage`，设备本地，
 * 不进 op-log —— 它是"我这台机器怎么看"，不是用户数据）。刷新后仍在。
 */

import { useI18n } from '@heyta/i18n';

import { RadioGroup, SideSheet, Switch } from '../../components/hta/index.js';
import { useCalendarViewStore } from './store.js';
import type { CalendarColorBy } from './calendar-display-pref.js';

export function CalendarDisplaySettingsSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const view = useCalendarViewStore();

  if (!open) return null;

  return (
    <SideSheet
      testId="calendar-display-settings"
      labelledBy="calendar-display-settings-title"
      title={t('web.calendar.display.title')}
      onCancel={onClose}
    >
      <div className="ht-settings">
        <div className="ht-settings__section">
          <RadioGroup
            name="calendar-color-by"
            legend={t('web.calendar.display.colorBy')}
            value={view.colorBy}
            onChange={(value) => {
              view.setColorBy(value as CalendarColorBy);
            }}
            options={[
              { value: 'list', label: t('web.calendar.display.colorByList') },
              { value: 'priority', label: t('web.calendar.display.colorByPriority') },
              { value: 'off', label: t('web.calendar.display.colorByOff') },
            ]}
            testID="calendar-color-by"
          />
        </div>
        <div className="ht-settings__section">
          <Switch
            label={t('web.calendar.more.showCompleted')}
            checked={view.showCompleted}
            onChange={view.setShowCompleted}
            testID="calendar-display-show-completed"
          />
          <Switch
            label={t('web.calendar.more.showCountdown')}
            checked={view.showCountdown}
            onChange={view.setShowCountdown}
            testID="calendar-display-show-countdown"
          />
        </div>
      </div>
    </SideSheet>
  );
}
