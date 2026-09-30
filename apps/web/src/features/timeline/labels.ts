/**
 * 时间线的文案装配：词条表 → 共享层的 `TimelineViewLabels`
 * =========================================================
 *
 * 单独一个文件，是因为**测试也要用它**：`apps/web/tests/gantt-chart.spec.tsx`
 * 直接渲染共享 `GanttChart` 时必须给一份**真的**标签（而不是在测试里
 * 抄一份中文字符串 —— 抄的那份不会跟着词条表变，断言就变成了自证）。
 *
 * 🔴 **单复数在这里选**（宿主认识词条表），共享层只负责"该显示了"。
 * 所以 `span` / `unestimated` / `aiSummary` / `ariaGroup` 每一项里都有
 * 一个单数分支 —— 它们对应词条表里成对的两条 key。
 */

import { useI18n } from '@heyta/i18n';
import type { GanttLabels, TimelineViewLabels } from '@heyta/ui';

export function useTimelineLabels(): TimelineViewLabels {
  const { t } = useI18n();

  const gantt: GanttLabels = {
    title: t('web.gantt.title'),
    empty: t('web.gantt.empty'),
    minutes: (count) => t('web.gantt.minutes', { count }),
    hours: (count) => t('web.gantt.hours', { count }),
    hoursMinutes: (hours, minutes) => t('web.gantt.hoursMinutes', { hours, minutes }),
    day: (day) => t('web.gantt.dayBand', { day }),
    span: (count, total) =>
      count === 1
        ? t('web.gantt.spanOne', { count, total })
        : t('web.gantt.span', { count, total }),
    rangeFrom: (when) => t('web.gantt.rangeFrom', { when }),
    today: (day) => t('web.gantt.today', { day }),
    unestimated: (count, duration) =>
      count === 1
        ? t('web.gantt.unestimatedSummaryOne', { count, duration })
        : t('web.gantt.unestimatedSummary', { count, duration }),
    aiSummary: (count) =>
      count === 1
        ? t('web.gantt.aiSummaryOne', { count })
        : t('web.gantt.aiSummary', { count }),
    durationDefault: (duration) => t('web.gantt.durationDefault', { duration }),
    durationAi: (duration) => t('web.gantt.durationAi', { duration }),
    durationManual: (duration) => t('web.gantt.durationManual', { duration }),
    dependsOn: (title) => t('web.gantt.dependsOn', { title }),
    overlap: t('web.gantt.overlap'),
    ariaGroup: (count, total) =>
      count === 1
        ? t('web.gantt.aria.groupOne', { count, total })
        : t('web.gantt.aria.group', { count, total }),
  };

  return {
    gantt,
    empty: t('web.timeline.empty'),
    ariaEmpty: t('web.timeline.aria.empty'),
    ariaGroup: (count) =>
      count === 1
        ? t('web.timeline.aria.groupOne', { count })
        : t('web.timeline.aria.group', { count }),
    aiEstimate: (duration) => t('web.timeline.aiEstimate', { duration }),
    noChecklist: t('web.timeline.noChecklist'),
    unattributable: (duration, count) => t('web.timeline.unattributable', { duration, count }),
  };
}
