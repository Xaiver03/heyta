/**
 * 时间线（移动端宿主）
 * ======================
 *
 * 2026-10-01 重画（goal：`docs/plans/goal-timeline-rework.md`）：共享实现从
 * 「每任务一张甘特图」换成 **`TimelineBoard`（一根共轴、行=任务、三态降级）**，
 * 规划从 `planTimelineBlocks()` 换成 `planTimelineRows()`。本文件仍只是宿主接线
 * —— 三条职责不变，且**每一件都不允许在这里长出第二份实现**：
 *   1. **规划**：`@heyta/app-host` 的 `planTimelineRows()`（三态推导是产品语义）；
 *   2. **渲染**：共享 `TimelineBoard`（RN 原语，四端同一份）；
 *   3. **文案**：`lib/timeline-labels.ts` 从词条表装配。
 *
 * ## `compactTicks`
 *
 * 窄屏放不下「周三 09-30」两段式刻度，紧凑档只留日期。**视口是平台概念**
 * （§3.5 的界），所以宽度判定在这里、不在共享层（与 `QuadrantScreen` 判
 * `twoColumns` 同一先例）。
 *
 * ## 为什么这里**没有**内联一层 `<HeytaUiProvider>`
 *
 * web 的 `TimelinePanel` 要内联一层（它的 `App.tsx` 里那个 Provider 只包 tasks
 * 那棵树）。移动端不需要：`./theme` 的 `ThemeProvider` **本身就是**
 * `HeytaUiProvider` —— 它包住整个应用，再包只会多一份 context 实例。
 */

import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

import { planTimelineRows, type TimelineTaskLike } from '@heyta/app-host';
import type { LocalDate } from '@heyta/domain';
import { TimelineBoard } from '@heyta/ui';

import { useTimelineLabels } from '../lib/timeline-labels';

/** 紧凑刻度的屏宽下限（dp）。手机竖屏几乎都低于它。 */
const COMPACT_BELOW_DP = 480;

export interface TimelineScreenProps {
  /** 要排的任务。顺序 = 输入序（板上的显示序由共享层按时间排序）。 */
  readonly tasks: readonly TimelineTaskLike[];
  /** 点任务行 / 泳道条目 ⇒ 打开详情（触屏端的排期入口，见板注释）。 */
  readonly onOpenTask?: (taskId: string) => void;
  /** 今天的本地日历日（窗口的周锚点 + 今天线）。 */
  readonly today?: LocalDate;
  /** 用于日期格式化的时间戳。默认 `Date.now()`。 */
  readonly now?: number;
  /** 选中的那一条 ⇒ 高亮。传的是宿主的**全局选中**，不是本屏自己记的 id。 */
  readonly activeTaskId?: string | null;
}

export function TimelineScreen(props: TimelineScreenProps): React.JSX.Element {
  const { tasks, today, now, onOpenTask, activeTaskId } = props;
  const labels = useTimelineLabels();
  const { width } = useWindowDimensions();
  // 规划是纯函数，但没必要每帧重算 —— `tasks` 变了才重排（与 web 同一条做法）。
  const rows = useMemo(() => planTimelineRows(tasks), [tasks]);

  return (
    <TimelineBoard
      rows={rows}
      labels={labels.board}
      onOpenTask={onOpenTask}
      activeTaskId={activeTaskId}
      compactTicks={width < COMPACT_BELOW_DP}
      {...(today === undefined ? {} : { today })}
      {...(now === undefined ? {} : { now })}
      testID="timeline-view"
    />
  );
}
