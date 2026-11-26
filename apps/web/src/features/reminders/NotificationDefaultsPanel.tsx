/**
 * 通知的**行为默认值**设置（#57）
 * ==============================
 *
 * 这一节回答的是「新建任务 / 新提醒时的初值是什么」，与同组的
 * `ReminderNotifyPanel`（系统授权）是两件事：那个管"准不准它吵你"，
 * 这个管"它按什么默认值吵"。
 *
 * ## 为什么没有说明文字
 *
 * 每行 = 一个标签 + 一个控件，控件本身就是答案。按 AGENTS §0.2 与
 * `design-system.md` 的设置禁令，不写 caption / hint。
 *
 * ## 判断不在这里
 *
 * 取值范围与逐字段回落在 `@heyta/domain` 的 `notification-defaults.ts`（纯函数 + 单测）；
 * 存储在本目录 `notification-defaults-pref.ts`。这里只把回调解上去。
 */

import type {
  AllDayReminder,
  NotificationDefaults,
  ReminderLeadMinutes,
} from '@heyta/domain';
import { REMINDER_LEAD_MINUTES_OPTIONS, ALL_DAY_REMINDER_OPTIONS } from '@heyta/domain';
import { useI18n, type MessageKey } from '@heyta/i18n';

const ALL_DAY_LABEL: Record<AllDayReminder, MessageKey> = {
  none: 'web.reminder.defaults.allDay.none',
  sameDay: 'web.reminder.defaults.allDay.sameDay',
  dayBefore: 'web.reminder.defaults.allDay.dayBefore',
};

export function NotificationDefaultsPanel({
  defaults,
  onChange,
}: {
  defaults: NotificationDefaults;
  onChange: (next: NotificationDefaults) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const setLead = (leadMinutes: ReminderLeadMinutes): void => onChange({ ...defaults, leadMinutes });
  const setAllDay = (allDayReminder: AllDayReminder): void => onChange({ ...defaults, allDayReminder });

  return (
    <section className="ht-settings" data-testid="notification-defaults-panel">
      <h2 className="ht-settings__title ht-type-section-title">{t('web.reminder.defaults.title')}</h2>

      <div className="ht-settings__preference-row">
        <h3 className="ht-settings__h3 ht-type-row-title">{t('web.reminder.defaults.leadLabel')}</h3>
        <div
          className="ht-settings__preset-grid"
          role="radiogroup"
          aria-label={t('web.reminder.defaults.leadLabel')}
          data-testid="notification-defaults-lead"
        >
          {REMINDER_LEAD_MINUTES_OPTIONS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              role="radio"
              aria-checked={defaults.leadMinutes === minutes}
              className="ht-settings__preset-option"
              data-testid={`notification-defaults-lead-${minutes}`}
              onClick={() => setLead(minutes)}
            >
              <span>
                {minutes === 0
                  ? t('web.reminder.defaults.leadAtTime')
                  : t('web.reminder.defaults.leadOption', { minutes })}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="ht-settings__preference-row">
        <h3 className="ht-settings__h3 ht-type-row-title">{t('web.reminder.defaults.allDayLabel')}</h3>
        <div
          className="ht-settings__preset-grid"
          role="radiogroup"
          aria-label={t('web.reminder.defaults.allDayLabel')}
          data-testid="notification-defaults-allday"
        >
          {ALL_DAY_REMINDER_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={defaults.allDayReminder === option}
              className="ht-settings__preset-option"
              data-testid={`notification-defaults-allday-${option}`}
              onClick={() => setAllDay(option)}
            >
              <span>{t(ALL_DAY_LABEL[option])}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="ht-settings__preference-row">
        <h3 className="ht-settings__h3 ht-type-row-title">{t('web.reminder.defaults.completionSound')}</h3>
        <span className="ht-settings__switch-cell">
          <input
            type="checkbox"
            role="switch"
            aria-label={t('web.reminder.defaults.completionSound')}
            data-testid="notification-defaults-completion-sound"
            checked={defaults.completionSound}
            onChange={() => onChange({ ...defaults, completionSound: !defaults.completionSound })}
          />
        </span>
      </div>

      <div className="ht-settings__preference-row">
        <h3 className="ht-settings__h3 ht-type-row-title">{t('web.reminder.defaults.showDetail')}</h3>
        <span className="ht-settings__switch-cell">
          <input
            type="checkbox"
            role="switch"
            aria-label={t('web.reminder.defaults.showDetail')}
            data-testid="notification-defaults-show-detail"
            checked={defaults.showDetail}
            onChange={() => onChange({ ...defaults, showDetail: !defaults.showDetail })}
          />
        </span>
      </div>
    </section>
  );
}
