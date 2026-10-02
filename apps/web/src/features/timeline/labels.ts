/**
 * 时间线的文案装配：词条表 → 共享层的 `TimelineBoardLabels` + `ChecklistPlanLabels`
 * ========================================================================
 *
 * 单独一个文件，是因为**测试也要用它**：组件测试直接渲染共享组件时必须给一份
 * **真的**标签（而不是在测试里抄一份中文字符串 —— 抄的那份不会跟着词条表变，
 * 断言就变成了自证）。
 *
 * 🔴 **单复数在这里选**（宿主认识词条表），共享层只负责"该显示了"。
 * `ariaGroup` 有单数分支，对应词条表里成对的两条 key。
 *
 * 🔴 **AI 估时 badge 的措辞在宿主**：共享层只传原始分钟数（`aiBadge(minutes)`），
 * 这里用甘特图的单位词条把它拼成「AI 估 90 分钟」—— 单位的唯一实现在
 * `formatDuration`，英文界面不会出现「90 分钟」。
 */

import { useI18n } from '@heyta/i18n';
import type { ChecklistPlanLabels, GanttLabels, TimelineBoardLabels } from '@heyta/ui';
import { formatDuration } from '@heyta/ui';

export interface TimelineLabels {
  /** 时间线板（一根共轴）。 */
  readonly board: TimelineBoardLabels;
  /** 任务详情里的清单排程预览（任务内部坐标系）。 */
  readonly plan: ChecklistPlanLabels;
}

export function useTimelineLabels(): TimelineLabels {
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

  const board: TimelineBoardLabels = {
    empty: t('web.timeline.empty'),
    ariaEmpty: t('web.timeline.aria.empty'),
    ariaGroup: (count) =>
      count === 1
        ? t('web.timeline.aria.groupOne', { count })
        : t('web.timeline.aria.group', { count }),
    weekdayNames: [
      t('web.board.weekday.1'),
      t('web.board.weekday.2'),
      t('web.board.weekday.3'),
      t('web.board.weekday.4'),
      t('web.board.weekday.5'),
      t('web.board.weekday.6'),
      t('web.board.weekday.7'),
    ],
    monthNames: [
      t('web.board.month.1'),
      t('web.board.month.2'),
      t('web.board.month.3'),
      t('web.board.month.4'),
      t('web.board.month.5'),
      t('web.board.month.6'),
      t('web.board.month.7'),
      t('web.board.month.8'),
      t('web.board.month.9'),
      t('web.board.month.10'),
      t('web.board.month.11'),
      t('web.board.month.12'),
    ],
    todayWord: t('web.board.today'),
    unscheduledLane: (count) => t('web.board.unscheduledLane', { count }),
    aiBadge: (minutes) => t('web.board.aiBadge', { duration: formatDuration(minutes, gantt) }),
    overdue: t('web.board.overdue'),
    untitledTask: t('web.board.untitledTask'),
  };

  const plan: ChecklistPlanLabels = {
    gantt,
    caption: t('web.board.planCaption'),
    noChecklist: t('web.timeline.noChecklist'),
    unattributable: (duration, count) => t('web.timeline.unattributable', { duration, count }),
  };

  return { board, plan };
}
