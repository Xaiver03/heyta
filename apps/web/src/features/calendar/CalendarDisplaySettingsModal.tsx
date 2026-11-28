/**
 * 日历「显示设置」弹窗（Web 宿主）
 * ==============================
 *
 * 四块白色圆角分组，视觉契约全部住在 `calendar-display.css`：
 *
 *   ① 颜色 / 样式（分段选择）
 *   ② 显示已完成 / 检查事项 / 所有重复周期
 *   ③ 显示习惯 / 专注记录 / 倒数纪念日 / 课程
 *   ④ 辅助时区
 *
 * 🔴 **这个文件不写一行样式**：类名逐条对应那份 CSS，布局、间距、圆角都由它给
 *   （`check:l4` 的判据就是 `features/**` 里出现样式字面量或 `style={{…}}`）。
 *   分组之间只靠 gap 分层，所以这里也不画分割标题 —— 加了就是同一件事说两遍。
 *
 * 🔴 **关闭通道走共享壳**（`WebModalShell` + `modal-readonly`）：Esc、点背景、×
 *   三条出口的判定只住 `packages/ui/src/overlay/dismissal.ts`，不在本页各写一遍。
 *   壳同时负责 `role="dialog"` / `aria-modal` / 焦点隔离，所以这里不手写那一层。
 */

import { ICON_SIZE } from '@heyta/design-system';
import { useI18n, type MessageKey } from '@heyta/i18n';
import { X } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { Switch } from '../../components/hta/index.js';
import { WebModalShell } from '../../lib/dialog/WebModalShell.js';
import { useCalendarViewStore } from './store.js';
import './calendar-display.css';

/** CSS 里那一族类名的根。拼错不会报错，只会让这一层悄悄没有样式。 */
const ROOT = 'ht-content__calendar-display';

/**
 * 弹窗自己的两条提示（`?` 按钮切换的那两枚）。
 * 用联合而不是两个布尔：同一时刻只说明一件事，另一枚自动收起。
 */
type TipName = 'focus' | 'timezone';

interface Choice<T extends string> {
  readonly value: T;
  readonly labelKey: MessageKey;
  readonly testId: string;
}

/** 分段选择（颜色 / 样式）。`aria-checked` 是 CSS 选中态的唯一依据。 */
function Segmented<T extends string>({
  label,
  value,
  choices,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly choices: readonly Choice<T>[];
  readonly onChange: (value: T) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className={`${ROOT}__segmented`} role="radiogroup" aria-label={label}>
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          role="radio"
          aria-checked={choice.value === value}
          className={`${ROOT}__segment`}
          data-testid={choice.testId}
          onClick={() => onChange(choice.value)}
        >
          {t(choice.labelKey)}
        </button>
      ))}
    </div>
  );
}

/** 开关行：左侧文字，右侧即时生效的开关。 */
function ToggleRow({
  label,
  checked,
  onChange,
  testId,
  children,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly testId: string;
  readonly children?: ReactNode;
}): React.JSX.Element {
  return (
    <div className={`${ROOT}__row`}>
      <span className={`${ROOT}__label`}>{children ?? label}</span>
      <Switch checked={checked} onChange={onChange} ariaLabel={label} testID={testId} />
    </div>
  );
}

/** `?` + 提示气泡。气泡的显隐由 CSS 接 `data-open`，这里只翻转那一格。 */
function HelpTip({
  id,
  text,
  open,
  onToggle,
  testId,
}: {
  readonly id: string;
  readonly text: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly testId: string;
}): React.JSX.Element {
  return (
    <span className={`${ROOT}__help-wrap`} data-open={open ? 'true' : 'false'}>
      <button
        type="button"
        className={`${ROOT}__help`}
        aria-label={text}
        aria-expanded={open}
        aria-describedby={id}
        data-testid={testId}
        onClick={onToggle}
      >
        ?
      </button>
      <span id={id} role="tooltip" className={`${ROOT}__tip`}>
        {text}
      </span>
    </span>
  );
}

export function CalendarDisplaySettingsModal(): React.JSX.Element | null {
  const { t } = useI18n();
  const titleId = useId();
  const {
    displaySettingsOpen,
    setDisplaySettingsOpen,
    colorMode,
    setColorMode,
    displayStyle,
    setDisplayStyle,
    showCompleted,
    setShowCompleted,
    showChecklist,
    setShowChecklist,
    showAllRepeats,
    setShowAllRepeats,
    showHabits,
    setShowHabits,
    showFocus,
    setShowFocus,
    showCountdown,
    setShowCountdown,
    showCourses,
    setShowCourses,
    secondaryTimezone,
    setSecondaryTimezone,
  } = useCalendarViewStore();
  const [tip, setTip] = useState<TipName | null>(null);

  const close = (): void => {
    setTip(null);
    setDisplaySettingsOpen(false);
  };

  // 钩子必须在早退之前全部调用（Rules of Hooks）；关着时整层不挂载。
  if (!displaySettingsOpen) return null;

  const toggleTip = (name: TipName): void => {
    setTip((current) => (current === name ? null : name));
  };

  return (
    <WebModalShell
      overlayClass={`${ROOT}-scrim`}
      dialogClass={ROOT}
      labelledBy={titleId}
      policy="modal-readonly"
      testId="calendar-display-modal"
      onCancel={close}
    >
      <div className={`${ROOT}__header`}>
        <h2 id={titleId} className={`${ROOT}__title ht-type-headline`}>
          {t('web.calendar.display.title')}
        </h2>
        <button
          type="button"
          className={`${ROOT}__close`}
          aria-label={t('web.calendar.display.close')}
          data-testid="calendar-display-close"
          onClick={close}
        >
          <X size={ICON_SIZE.md} aria-hidden="true" />
        </button>
      </div>

      <div className={`${ROOT}__groups`}>
        <div className={`${ROOT}__group`}>
          <div className={`${ROOT}__row`}>
            <span className={`${ROOT}__label`}>{t('web.calendar.display.color')}</span>
            <Segmented
              label={t('web.calendar.display.color')}
              value={colorMode}
              choices={[
                {
                  value: 'project',
                  labelKey: 'web.calendar.display.colorByProject',
                  testId: 'calendar-display-color-project',
                },
                {
                  value: 'quadrant',
                  labelKey: 'web.calendar.display.colorByQuadrant',
                  testId: 'calendar-display-color-quadrant',
                },
              ]}
              onChange={setColorMode}
            />
          </div>
          <div className={`${ROOT}__row`}>
            <span className={`${ROOT}__label`}>{t('web.calendar.display.style')}</span>
            <Segmented
              label={t('web.calendar.display.style')}
              value={displayStyle}
              choices={[
                {
                  value: 'classic',
                  labelKey: 'web.calendar.display.styleClassic',
                  testId: 'calendar-display-style-classic',
                },
                {
                  value: 'modern',
                  labelKey: 'web.calendar.display.styleModern',
                  testId: 'calendar-display-style-modern',
                },
              ]}
              onChange={setDisplayStyle}
            />
          </div>
        </div>

        <div className={`${ROOT}__group`}>
          <ToggleRow
            label={t('web.calendar.more.showCompleted')}
            checked={showCompleted}
            onChange={setShowCompleted}
            testId="calendar-display-show-completed"
          />
          <ToggleRow
            label={t('web.calendar.display.showChecklist')}
            checked={showChecklist}
            onChange={setShowChecklist}
            testId="calendar-display-show-checklist"
          />
          <ToggleRow
            label={t('web.calendar.display.showAllRepeats')}
            checked={showAllRepeats}
            onChange={setShowAllRepeats}
            testId="calendar-display-show-all-repeats"
          />
        </div>

        <div className={`${ROOT}__group`}>
          <ToggleRow
            label={t('web.calendar.display.showHabits')}
            checked={showHabits}
            onChange={setShowHabits}
            testId="calendar-display-show-habits"
          />
          <ToggleRow
            label={t('web.calendar.display.showFocus')}
            checked={showFocus}
            onChange={setShowFocus}
            testId="calendar-display-show-focus"
          >
            {t('web.calendar.display.showFocus')}
            <HelpTip
              id="calendar-display-focus-tip"
              text={t('web.calendar.display.showFocusTip')}
              open={tip === 'focus'}
              onToggle={() => toggleTip('focus')}
              testId="calendar-display-show-focus-help"
            />
          </ToggleRow>
          <ToggleRow
            label={t('web.calendar.more.showCountdown')}
            checked={showCountdown}
            onChange={setShowCountdown}
            testId="calendar-display-show-countdown"
          />
          <ToggleRow
            label={t('web.calendar.display.showCourses')}
            checked={showCourses}
            onChange={setShowCourses}
            testId="calendar-display-show-courses"
          />
        </div>

        <div className={`${ROOT}__group`}>
          <ToggleRow
            label={t('web.calendar.display.secondaryTimezone')}
            checked={secondaryTimezone}
            onChange={setSecondaryTimezone}
            testId="calendar-display-secondary-timezone"
          >
            {t('web.calendar.display.secondaryTimezone')}
            <HelpTip
              id="calendar-display-timezone-tip"
              text={t('web.calendar.display.secondaryTimezoneTip')}
              open={tip === 'timezone'}
              onToggle={() => toggleTip('timezone')}
              testId="calendar-display-secondary-timezone-help"
            />
          </ToggleRow>
        </div>
      </div>
    </WebModalShell>
  );
}
