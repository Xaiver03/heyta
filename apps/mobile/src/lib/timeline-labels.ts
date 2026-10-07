/**
 * 时间线的文案装配（移动端）
 * ============================
 *
 * 与 `apps/web/src/features/timeline/labels.ts` **逐条对应** —— 同一批共享组件
 * （`@heyta/ui` 的 `TimelineBoard` / `ChecklistPlanPreview`），两端只是各自把
 * 词条表装成标签对象。
 *
 * ## 🔴 复用的全是 `web.board.*` / `web.timeline.*` / `web.gantt.*`
 *
 * 与 `lib/quadrant-display.ts` 复用 `web.quadrant.*` 是**同一个先例**：
 * 同义键会让"两端同一句话"变成两处维护 —— 改了一处、另一处忘改，
 * 两端就开始说不同的话，而**没有任何门禁会红**。
 *
 * ## 单复数在这里选，不在共享层
 *
 * `ariaGroup` 的单数分支对应词条表里成对的两条 key。共享层只负责"该显示了"。
 *
 * ⚠️ 纯函数版 `timelineLabels(t)` 是给单测用的（与 `lib/` 里其它 `*-display.ts`
 * 同形状：不依赖 React context 就能被断言）。
 */

import { useMemo } from 'react';

import { useI18n } from '@heyta/i18n';
import { formatDuration, type ChecklistPlanLabels, type GanttLabels, type TimelineBoardLabels } from '@heyta/ui';

import type { Translate } from '../i18n/translate';

/** 纯函数版：给一个 `t` 就能建出全部文案。 */
export function timelineLabels(t: Translate): {
  board: TimelineBoardLabels;
  plan: ChecklistPlanLabels;
} {
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
      count === 1 ? t('web.gantt.aiSummaryOne', { count }) : t('web.gantt.aiSummary', { count }),
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
    emptyHint: t('web.timeline.empty.hint'),
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
    createAt: t('web.board.createTask'),
    editSchedule: (title) => t('web.board.editSchedule', { title }),
  };

  const plan: ChecklistPlanLabels = {
    gantt,
    caption: t('web.board.planCaption'),
    noChecklist: t('web.timeline.noChecklist'),
    unattributable: (duration, count) => t('web.timeline.unattributable', { duration, count }),
  };

  return { board, plan };
}

/** 组件里用。`useMemo` 依赖只有 `t`，所以同一次渲染里它是稳定引用。 */
export function useTimelineLabels(): { board: TimelineBoardLabels; plan: ChecklistPlanLabels } {
  const { t } = useI18n();
  return useMemo(() => timelineLabels(t), [t]);
}
