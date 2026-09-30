/**
 * 时间线（移动端宿主）
 * ======================
 *
 * `timeline` 整刀第 3 步：移动端拿到时间线，**复用 web 那一份共享实现**
 * （`@heyta/ui` 的 `TimelineView` + `GanttChart`），本文件只是宿主接线层 ——
 * 与 web 的 `apps/web/src/features/timeline/TimelinePanel.tsx` 一一对应。
 *
 * 职责只有三件，且**每一件都不允许在这里长出第二份实现**：
 *   1. **规划**：`@heyta/app-host` 的 `planTimelineBlocks()` —— "没有清单时整条
 *      任务自己算一条 / 有清单时怎么分摊 / 估时从备注哪里读"全是产品语义，
 *      放这里就等于移动端有第二份（M1 违规）；
 *   2. **渲染**：共享 `TimelineView`（RN 原语，四端同一份）；
 *   3. **文案**：`lib/timeline-labels.ts` 从词条表装配（共享层不 import
 *      `@heyta/i18n`）。
 *
 * ## 为什么这里**没有**内联一层 `<HeytaUiProvider>`
 *
 * web 的 `TimelinePanel` 要内联一层（它的 `App.tsx` 里那个 Provider 只包 tasks
 * 那棵树，时间线是兄弟节点）。移动端不需要：`./theme` 的 `ThemeProvider`
 * **本身就是** `HeytaUiProvider`（2026-09-28 收敛后删掉了 `UiThemeBridge`，
 * 见 `apps/mobile/src/App.tsx` 的说明）—— 它包住整个应用，所以这里再包一层
 * 只会多一份 context 实例。
 */

import { useMemo } from 'react';

import { planTimelineBlocks, type TimelineTaskLike } from '@heyta/app-host';
import type { LocalDate } from '@heyta/domain';
import { TimelineView } from '@heyta/ui';

import { useTimelineLabels } from '../lib/timeline-labels';

export interface TimelineScreenProps {
  /** 要排的任务。顺序 = 块序（与列表/象限读的是**同一批**）。 */
  readonly tasks: readonly TimelineTaskLike[];
  /** 计划的起始日（本地日历日）。给了就显示真实日期与钟点。 */
  readonly startDate?: LocalDate;
  /** 今天的本地日历日。给了才画"今天"。 */
  readonly today?: LocalDate;
  /** 用于日期格式化的时间戳。默认 `Date.now()`。 */
  readonly now?: number;
}

export function TimelineScreen(props: TimelineScreenProps): React.JSX.Element {
  const { tasks, startDate, today, now } = props;
  const labels = useTimelineLabels();
  // 规划是纯函数，但没必要每帧重算 —— `tasks` 变了才重排（与 web 同一条做法）。
  const blocks = useMemo(() => planTimelineBlocks(tasks), [tasks]);

  return (
    <TimelineView
      blocks={blocks}
      labels={labels}
      {...(startDate === undefined ? {} : { startDate })}
      {...(today === undefined ? {} : { today })}
      {...(now === undefined ? {} : { now })}
      testID="timeline-view"
    />
  );
}
