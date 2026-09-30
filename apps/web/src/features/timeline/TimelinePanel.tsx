/**
 * 时间线视图 —— **web 宿主的接线层**
 * ====================================
 *
 * 这一刀（`timeline` 整刀第 2 步）把 web 的实现换成共享层：
 *
 *   · **规划**：`@heyta/app-host` 的 `planTimelineBlocks()`（此前是本目录里
 *     `TimelineView.tsx` 的一个私有函数 —— 那属于 M1 违规：移动端要画时间线
 *     时只能再抄一份）；
 *   · **渲染**：`@heyta/ui` 的 `TimelineView`（RN 原语，`GanttChart` 在它内部）；
 *   · **文案**：`labels.ts` 的 `useTimelineLabels()` 从词条表装配 ——
 *     共享层**不 import `@heyta/i18n`**（理由见 `TaskList.tsx` 文件头）。
 *
 * 🔴 原来的 `TimelineView.tsx` / `GanttChart.tsx` **已删除**：同一件事只有一份实现。
 *
 * ## 为什么要在这里内联一层 `<HeytaUiProvider>`
 *
 * `App.tsx` 里那个 Provider 只包 **tasks 那棵树**（它是按视图分支挂的），
 * 时间线是**兄弟节点**，不在其内。共享组件会 `useHeytaUiTheme()`，
 * 缺 Provider 是**运行时抛错**（P0 形状，仓库里踩过一次）。
 * 与 `features/capture/CaptureComposer.tsx` 同一条做法。
 *
 * ⚠️ `TimelineView` / `GanttChart` 已登记进 `scripts/check-ui-provider.mjs`
 * 的 `PROVIDER_DEPENDENT` —— 漏登记 = 没有门禁。
 */

import { useMemo } from 'react';

import { planTimelineBlocks, type TimelineTaskLike } from '@heyta/app-host';
import type { LocalDate } from '@heyta/domain';
import { HeytaUiProvider, TimelineView } from '@heyta/ui';

import { useTimelineLabels } from './labels.js';

export interface TimelinePanelProps {
  /** 要排的任务。顺序 = 块序。 */
  readonly tasks: readonly TimelineTaskLike[];
  /** 计划的起始日（本地日历日）。给了就显示真实日期与钟点。 */
  readonly startDate?: LocalDate;
  /** 今天的本地日历日。给了才画"今天"。 */
  readonly today?: LocalDate;
  /** 用于日期格式化的时间戳。默认 `Date.now()`。 */
  readonly now?: number;
}

export function TimelinePanel(props: TimelinePanelProps): React.JSX.Element {
  const { tasks, startDate, today, now } = props;
  const labels = useTimelineLabels();
  // 规划是纯函数，但没必要每帧重算 —— `tasks` 变了才重排。
  const blocks = useMemo(() => planTimelineBlocks(tasks), [tasks]);

  return (
    <HeytaUiProvider>
      <TimelineView
        blocks={blocks}
        labels={labels}
        {...(startDate === undefined ? {} : { startDate })}
        {...(today === undefined ? {} : { today })}
        {...(now === undefined ? {} : { now })}
        testID="timeline-view"
      />
    </HeytaUiProvider>
  );
}
