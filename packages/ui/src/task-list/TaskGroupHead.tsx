/**
 * `TaskGroupHead` —— 任务列表**日期分组头**，四端同一份
 * =====================================================
 *
 * ## 它是什么
 *
 * 滴答同款的分组头：组名 + 组内计数 + 一条细横线，右侧可挂一个动作
 * （web 的逾期组挂「顺延」）。2026-09-30 排版审计（goal-layout-audit.md 页 7）
 * 由 web 手写 CSS 升为共享组件 —— 升级的原因不是"想复用"，而是 web 侧的
 * `check:row-single-source` 门禁**挡住了它**：`.ht-task-group` 是一个净增的
 * CSS 前缀族，而这条门禁的判据就是"任务列表的实现只长在 packages/ui"。
 * 门禁是对的：组头是**列表的机制**（归属规则在领域 `groupTasksByDate`），
 * 不是某个壳的皮肤 —— 留在 web 里，mobile 想要滴答同款分组时就得抄第二遍。
 *
 * ## 分工
 *
 * - **归属规则**在 `@heyta/domain` 的 `groupTasksByDate`（哪条任务进哪组）；
 * - **措辞**在宿主（共享层不 `import '@heyta/i18n'`，见 `calendar/model.ts` 文件头）；
 * - **本组件**只管这一层皮：横排、计数靠右、细横线、动作槽。
 *   `action` 是宿主渲染的节点（与 `TaskList.renderTrailing` 同一分工）——
 *   动作是按钮还是菜单由宿主决定，本层不造第二种按钮。
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { HeytaNativeTokens } from '@heyta/design-system';

import { useHeytaText, useHeytaTokens } from '../theme.js';

export interface TaskGroupHeadProps {
  /** 组名（宿主已措辞，如「今天, 周三」）。 */
  readonly title: string;
  /** 组内任务数 —— **渲染什么数字由调用方给**，本层不数。 */
  readonly count: number;
  /** 组头右侧的动作槽（宿主渲染的节点；不传就没有）。 */
  readonly action?: React.ReactNode;
  readonly testID?: string | undefined;
}

export function TaskGroupHead({
  title,
  count,
  action,
  testID = 'task-group-head',
}: TaskGroupHeadProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  return (
    <View style={styles.head} testID={testID}>
      {/* 读屏时组头是一个标题：先念组名再进组内行，而不是把计数混在正文里。 */}
      <Text accessibilityRole="header" style={text['section-title']}>
        {title}
      </Text>
      {/* 计数必须 tabular：数字宽度不稳会让整排组头的"计数列"看着在抖。 */}
      <Text style={styles.count}>{count}</Text>
      {action !== undefined ? action : null}
    </View>
  );
}

function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
      paddingTop: tokens['space.2'],
      paddingBottom: tokens['space.2'],
      borderBottomWidth: tokens['border-width.thin'],
      borderBottomColor: tokens['color.border'],
    },
    title: {
      // 🔴 只留颜色与布局，**不覆盖字号字重** —— 那是 `section-title`
      //    语义样式的职责（web 端曾在此覆盖成 sm，与移动端分组头漂移；
      //    2026-09-30 排版审计修正：语义样式必须整条消费，不许拆开挑）。
      flex: 1,
      color: tokens['color.foreground-muted'],
    },
    count: {
      fontSize: tokens['font-size.xs'],
      color: tokens['color.foreground-subtle'],
      fontVariant: ['tabular-nums'],
    },
  });
}
