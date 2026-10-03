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

import type { DatePickerLabels, DatePickerTime } from '@heyta/ui';
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

/**
 * 「时刻」那一行的措辞（`DatePickerTime['labels']`）。
 *
 * 🔴 四句读 `common.due.*`，**不是**新写一份 `mobile.due.*`：这一行说的是
 * "这条截止有没有时刻"，两端同一个事实。抄一份值就是第二次裁决 ——
 * 而「全天」一旦在两处漂成两种说法，界面上会出现"时间线画在 16:00，
 * 编辑器却说它全天"，且**没有任何一层会报错**。
 * 它与日历那条「全天」带（`common.calendar.dayAllDay`）的同源由
 * `apps/mobile/tests/task-due-time.spec.ts` 的等值判据钉住。
 *
 * `aria` 带**是哪一条任务**：读屏在任务列表里逐个点开详情时，
 * 一句"截止时刻"分不清说的是哪条（与 web 的 `DueEditor` 同一理由）。
 */
export function datePickerTimeLabels(t: Translate, title: string): DatePickerTime['labels'] {
  return {
    timeLabel: t('common.due.timeLabel'),
    allDay: t('common.due.allDay'),
    placeholder: t('common.due.timePlaceholder'),
    aria: t('common.due.timeAria', { title }),
  };
}
