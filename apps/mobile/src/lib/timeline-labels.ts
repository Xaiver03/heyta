/**
 * 时间线的文案装配（移动端）
 * ============================
 *
 * 与 `apps/web/src/features/timeline/labels.ts` **逐条对应** —— 同一个共享组件
 * `@heyta/ui` 的 `TimelineView`，两端只是各自把词条表装成 `TimelineViewLabels`。
 *
 * ## 🔴 复用的全是 `web.gantt.*` / `web.timeline.*`
 *
 * 与 `lib/quadrant-display.ts` 复用 `web.quadrant.*`、`lib/habits-display.ts`
 * 复用 `web.habits.*` 是**同一个先例**（那两个文件头都写了理由）：
 * `packages/i18n` 不在本刀白名单，而同义键会让"两端同一句话"变成两处维护 ——
 * 改了一处、另一处忘改，两端就开始说不同的话，而**没有任何门禁会红**。
 *
 * ⚠️ 它是一笔如实的债：词条表里 `web.*` 被移动端借用。收口方式与
 * `mobile.growth.*` 那次一样 —— 等真有第三端要同一句话时再统一改名。
 *
 * ## 单复数在这里选，不在共享层
 *
 * `span` / `unestimated` / `aiSummary` / `ariaGroup` 每一项都有一个单数分支，
 * 对应词条表里成对的两条 key。共享层只负责"该显示了"，不认识词条表。
 *
 * ⚠️ 纯函数版 `timelineLabels(t)` 是给单测用的（与 `lib/` 里其它 `*-display.ts`
 * 同形状：不依赖 React context 就能被断言）。
 */

import { useMemo } from 'react';

import { useI18n } from '@heyta/i18n';
import type { GanttLabels, TimelineViewLabels } from '@heyta/ui';

import type { Translate } from '../i18n/translate';

/** 纯函数版：给一个 `t` 就能建出全部文案。 */
export function timelineLabels(t: Translate): TimelineViewLabels {
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

/** 组件里用。`useMemo` 依赖只有 `t`，所以同一次渲染里它是稳定引用。 */
export function useTimelineLabels(): TimelineViewLabels {
  const { t } = useI18n();
  return useMemo(() => timelineLabels(t), [t]);
}
