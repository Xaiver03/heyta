/**
 * ChecklistPlanPreview —— 一条任务**内部**的清单排程预览
 * ====================================================
 *
 * 时间线重画（goal：`docs/plans/goal-timeline-rework.md`）把「每任务一张甘特图」
 * 从板上撤下之后，清单排程能力**降级到这里**：任务详情里的一个区块。
 *
 * 🔴 它与板**不是同一个坐标系** —— 板是日历时间（全视图一根轴），这里是
 * 「这条任务第 0 分钟起」的相对排程。所以区块开头必须有一句**标明**的说明文字
 * （`labels.caption`），否则用户会拿它和板对位置，而两边对不上。
 *
 * 单个任务自己的图**允许自己归一化**：它只有一个坐标系，不存在旧板上
 * "每张图各一把尺却长得像共尺"的欺骗（R4 类 D 的前提是 small multiples）。
 *
 * 🔴 文案宿主注入、只用 RN 原语、全 token —— 与本目录其它文件同一套纪律。
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { LocalDate, TimelineBlock } from '@heyta/domain';

import { useHeytaText, useHeytaTokens } from '../theme.js';
import { GanttChart } from './GanttChart.js';
import { formatDuration, type GanttLabels } from './model.js';

/** 详情预览的文案契约（宿主装配；key 见 `web.timeline.*` / `web.board.planCaption`）。 */
export interface ChecklistPlanLabels {
  readonly gantt: GanttLabels;
  /** 区块说明：标明这是任务内部坐标系（🔴 不许省，见文件头）。 */
  readonly caption: string;
  /** 没有可排期清单时的说明（复用 `web.timeline.noChecklist`）。 */
  readonly noChecklist: string;
  /** 整条估时分摊不了时的警告（复用 `web.timeline.unattributable`）。 */
  readonly unattributable: (duration: string, count: number) => string;
}

export interface ChecklistPlanPreviewProps {
  /** 宿主用 `planTimelineBlock()` 算好的块。 */
  readonly block: TimelineBlock;
  readonly labels: ChecklistPlanLabels;
  /** 预览里把相对偏移印成日历时间的起点；不给就只显示相对偏移（任务内部坐标）。 */
  readonly startDate?: LocalDate;
  readonly today?: LocalDate;
  readonly now?: number;
  readonly testID?: string;
}

export function ChecklistPlanPreview(props: ChecklistPlanPreviewProps): React.JSX.Element {
  const { block, labels, startDate, today, now, testID } = props;
  const tokens = useHeytaTokens();
  const text = useHeytaText();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { gap: tokens['space.2'] },
        caption: { color: tokens['color.foreground-subtle'] },
        warning: { color: tokens['color.warning-strong'] },
      }),
    [tokens],
  );

  return (
    <View testID={testID ?? 'checklist-plan-preview'} role="group" style={styles.root}>
      <Text testID="checklist-plan-caption" style={[text.caption, styles.caption]}>
        {labels.caption}
      </Text>
      {block.unattributable && (
        <Text testID="checklist-plan-unattributable" style={[text.caption, styles.warning]}>
          {labels.unattributable(
            formatDuration(block.aiMinutes ?? 0, labels.gantt),
            block.unitCount,
          )}
        </Text>
      )}
      {!block.hasChecklist && (
        <Text testID="checklist-plan-no-checklist" style={[text.caption, styles.caption]}>
          {labels.noChecklist}
        </Text>
      )}
      <GanttChart
        entries={[...block.plan.entries]}
        labels={labels.gantt}
        {...(startDate === undefined ? {} : { startDate })}
        {...(today === undefined ? {} : { today })}
        {...(now === undefined ? {} : { now })}
        testID="checklist-plan-gantt"
      />
    </View>
  );
}
