/**
 * 共享 `DatePicker` 的 mobile 侧文案
 * ====================================
 *
 * 共享层不 import i18n（见 `packages/ui/src/date-picker/DatePicker.tsx`
 * 文件头），各端注入自己的 `labels`。本文件就是 mobile 的那份注入：
 * 周几/月份标题的**词条 key**来自 `@heyta/ui` 的 `calendar/date-text.ts`
 * （同一处定义，两端不会一个说「周五」一个说「星期五」），措辞词条仍是
 * mobile 消费的 common 命名空间。
 */

import type { DatePickerLabels } from '@heyta/ui';
import { WEEKDAY_MESSAGE_KEYS, formatMonthTitleText } from '@heyta/ui';

import type { Translate } from '../i18n/translate';

export function datePickerLabels(t: Translate): DatePickerLabels {
  return {
    // `t` 的形参（MessageKey）比 date-text 要求的更宽，可直接传（见 date-text.ts:52）。
    weekdays: WEEKDAY_MESSAGE_KEYS.map((key) => t(key)),
    monthTitle: (month) => formatMonthTitleText(month, t),
    clear: t('mobile.datePicker.clear'),
    prevMonth: t('mobile.common.prevMonth'),
    nextMonth: t('mobile.common.nextMonth'),
    dayLabel: (month, day) => t('mobile.datePicker.dayLabel', { month, day }),
  };
}
