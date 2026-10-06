/**
 * 时间线视图 —— **web 宿主的接线层**
 * ====================================
 *
 * 2026-10-01 重画（goal：`docs/plans/goal-timeline-rework.md`）：
 *   · **规划**：`@heyta/app-host` 的 `planTimelineRows()`（三态推导是产品语义）；
 *   · **渲染**：`@heyta/ui` 的 `TimelineBoard`（一根共轴、行=任务、三态降级）；
 *   · **文案**：`labels.ts` 的 `useTimelineLabels()` 从词条表装配 ——
 *     共享层**不 import `@heyta/i18n`**（理由见 `TaskList.tsx` 文件头）。
 *
 * 🔴 旧的 `TimelineView`（每任务一张自归一化甘特图）**已删除**：同一件事只有一份实现。
 *   任务内清单排程降级进详情预览（`ChecklistPlanPreview`，当前只有移动端详情面
 *   有挂载点 —— web 没有任务详情面是既有缺口，见台账）。
 *
 * ## 为什么在这里内联一层 `<HeytaUiProvider>`
 *
 * `App.tsx` 里那个 Provider 只包 **tasks 那棵树**（它是按视图分支挂的），
 * 时间线是**兄弟节点**，不在其内。共享组件会 `useHeytaUiTheme()`，
 * 缺 Provider 是**运行时抛错**（P0 形状，仓库里踩过一次）。
 * 与 `features/capture/CaptureComposer.tsx` 同一条做法。
 *
 * ⚠️ `TimelineBoard` / `ChecklistPlanPreview` / `GanttChart` 已登记进
 * `scripts/check-ui-provider.mjs` 的 `PROVIDER_DEPENDENT` —— 漏登记 = 没有门禁。
 */

import { useMemo } from 'react';

import { planTimelineRows, type TimelineTaskLike } from '@heyta/app-host';
import type { LocalDate } from '@heyta/domain';
import { HeytaUiProvider, TimelineBoard, type TimelineScheduleChange } from '@heyta/ui';

import { useTimelineLabels } from './labels.js';

export interface TimelinePanelProps {
  /** 要排的任务。顺序 = 输入序；板上的**显示**序由共享层按落笔时刻排序。 */
  readonly tasks: readonly TimelineTaskLike[];
  /**
   * 排期拖拽出口（P2）。给了才启用手势；宿主把它接到 store 的 `setSchedule`
   * （一次调用 = 一条 op）。不传 = 只读板。
   */
  readonly onScheduleTask?: (taskId: string, change: TimelineScheduleChange) => void;
  /**
   * 「点空白建任务带日期」出口（goal §3.2 手势 4）：轴上某时刻被点击。
   * 宿主接**既有建任务 op**（create 带日期字段，一个 CRT 不 fan-out）。
   */
  readonly onCreateAt?: (atMs: number) => void;
  /**
   * 点行 = 选中（与列表/四象限同一个值）。不给 = 行不可点。
   * 🔴 触屏端的这一条早就接了；web 此前往这里只递拖拽出口，于是同一个界面两端能力不同。
   */
  readonly onOpenTask?: (taskId: string) => void;
  /** 选中的那一条 ⇒ 板上高亮。宿主递的是**全局选中**，不是"这一屏自己记住的 id"。 */
  readonly activeTaskId?: string | null;
  /** 今天的本地日历日（窗口的周锚点 + 今天线）。 */
  readonly today?: LocalDate;
  /** 用于日期格式化的时间戳。默认 `Date.now()`。 */
  readonly now?: number;
}

export function TimelinePanel(props: TimelinePanelProps): React.JSX.Element {
  const { tasks, today, now, onScheduleTask, onCreateAt, onOpenTask, activeTaskId } = props;
  const labels = useTimelineLabels();
  // 规划是纯函数，但没必要每帧重算 —— `tasks` 变了才重排。
  const rows = useMemo(() => planTimelineRows(tasks), [tasks]);

  return (
    <HeytaUiProvider>
      <TimelineBoard
        rows={rows}
        labels={labels.board}
        {...(onScheduleTask === undefined ? {} : { onScheduleTask })}
        {...(onCreateAt === undefined ? {} : { onCreateAt })}
        {...(today === undefined ? {} : { today })}
        {...(now === undefined ? {} : { now })}
        onOpenTask={onOpenTask}
        activeTaskId={activeTaskId}
        testID="timeline-view"
      />
    </HeytaUiProvider>
  );
}
