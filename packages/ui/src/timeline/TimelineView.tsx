/**
 * TimelineView —— 四端共用的时间线（一个任务一张甘特图）
 * =======================================================
 *
 * 这一层只负责**怎么画**：把 `@heyta/app-host` 的 `planTimelineBlocks()`
 * 算好的块摆出来。它**不做任何规划判断**（整条任务算几条、估时能不能落下去
 * 都在 app-host），也**不 import `@heyta/i18n`**（文案由 `labels` 注入）。
 *
 * ## 🔴 为什么每个任务一张图，而不是全塞进一张
 *
 * 每个任务的清单是**它自己的计划**：条目名会撞（两个任务都有"评审"），
 * 依赖也只在任务内部成立。塞进一张图会造出"跨任务的假依赖"。
 *
 * ⚠️ 但每张图各自归一化会带来一个陷阱：90 分钟的任务和 30 分钟的任务
 * **都会占满整行**（各自 100%），反而看不出谁更长。所以所有图共用
 * 一把尺子（`sharedTimelineSpan`），条就可以互相比。
 *
 * ## 🔴 三种"如实说明"必须留在界面上
 *
 *   1. **没有可排期内容**的任务不静默跳过 —— 用户会以为视图坏了；
 *   2. **估时摊不到子条目上**时明说，而不是按比例编一个用户没给过的工期；
 *   3. **块头写出 AI 估时**（如果有），这样条变宽时用户知道是为什么。
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { sharedTimelineSpan, type LocalDate, type TimelineBlock } from '@heyta/domain';

import { useHeytaText, useHeytaTokens } from '../theme.js';
import { EmptyState } from '../empty-state/EmptyState.js';
import { GanttChart } from './GanttChart.js';
import { formatDuration, type TimelineViewLabels } from './model.js';

export interface TimelineViewProps {
  /** 要排的块。顺序 = 块序。**由宿主用 `planTimelineBlocks()` 算好**。 */
  readonly blocks: readonly TimelineBlock[];
  /** 计划的起始日（本地日历日）。给了就显示真实日期与钟点。 */
  readonly startDate?: LocalDate;
  /** 今天的本地日历日。给了才画"今天"。 */
  readonly today?: LocalDate;
  /** 用于日期格式化的时间戳。默认 `Date.now()`。 */
  readonly now?: number;
  /** 覆盖空态文案。 */
  readonly emptyHint?: string;
  /** 全部文案。**宿主注入**（见文件头）。 */
  readonly labels: TimelineViewLabels;
  readonly testID?: string;
}

export function TimelineView(props: TimelineViewProps): React.JSX.Element {
  const { blocks, startDate, today, now, emptyHint, labels, testID } = props;
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const clock = now ?? Date.now();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { gap: tokens['space.5'] },
        block: { gap: tokens['space.2'] },
        blockHead: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: tokens['space.2'],
        },
      }),
    [tokens],
  );

  if (blocks.length === 0) {
    return (
      <View
        testID={testID ?? 'timeline-view'}
        role="group"
        aria-label={labels.ariaEmpty}
        style={styles.root}
      >
        {/*
          🔴 用**共享** `EmptyState`（"空态只有一个实现"）——
          它的注释里点名了 `timeline-view-empty` 这个 testID，
          收编时必须原样传进去，否则 e2e 定位钩子与门禁登记项会一起静默消失。
        */}
        <EmptyState title={emptyHint ?? labels.empty} testID="timeline-view-empty" />
      </View>
    );
  }

  // 🔴 所有任务共用一把尺子（见文件头）。计算在领域层，只有一份实现。
  const sharedSpan = sharedTimelineSpan(blocks);

  return (
    <View
      testID={testID ?? 'timeline-view'}
      role="group"
      aria-label={labels.ariaGroup(blocks.length)}
      style={styles.root}
    >
      {blocks.map((block) => (
        <View
          key={block.taskId}
          testID={`timeline-block-${block.taskId}`}
          style={styles.block}
          role="group"
        >
          <View style={styles.blockHead}>
            <Text
              testID={`timeline-task-title-${block.taskId}`}
              style={[text['row-title'], { color: tokens['color.foreground'] }]}
            >
              {block.title}
            </Text>
            {block.aiMinutes !== undefined && (
              <Text
                testID={`timeline-ai-${block.taskId}`}
                style={[text.caption, { color: tokens['color.foreground-muted'] }]}
              >
                {labels.aiEstimate(formatDuration(block.aiMinutes, labels.gantt))}
              </Text>
            )}
          </View>

          {/* 🔴 没有可排期内容也**不静默跳过** —— 用户会以为视图坏了。 */}
          {!block.hasChecklist && (
            <Text
              testID={`timeline-no-checklist-${block.taskId}`}
              style={[text.caption, { color: tokens['color.foreground-muted'] }]}
            >
              {labels.noChecklist}
            </Text>
          )}

          {/* 🔴 分摊不了就明说，而不是平均分下去编一个工期。 */}
          {block.unattributable && (
            <Text
              testID={`timeline-unattributable-${block.taskId}`}
              style={[text.caption, { color: tokens['color.warning'] }]}
            >
              {labels.unattributable(
                formatDuration(block.aiMinutes ?? 0, labels.gantt),
                block.unitCount,
              )}
            </Text>
          )}

          <GanttChart
            entries={[...block.plan.entries]}
            spanMinutes={sharedSpan}
            labels={labels.gantt}
            {...(startDate === undefined ? {} : { startDate })}
            {...(today === undefined ? {} : { today })}
            now={clock}
          />
        </View>
      ))}
    </View>
  );
}
