/**
 * TaskList —— 四端共用的第一块 UI
 * ==============================
 *
 * M1 的**验证切片**：如果这一个组件能在 Web / iOS / Android / 鸿蒙上
 * 用同一份源码渲染出来，那么"一套代码多端"这条路就成立；
 * 如果它不成立，越早发现越好 —— 所以这块刻意选了一个**有真实复杂度**的组件
 * （列表、状态、命中区、无障碍、主题），而不是一个 Hello World。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本文件刻意**不 import `@heyta/i18n`**
 *
 * i18n 包曾自己带了一份 React，导致 Android 产物里出现**两个 React 实例**
 * （钩子报 Invalid hook call，而报错位置离根因很远）。这件事已经踩过一次，
 * 仓库里因此有 `check:mobile-bundle` 门禁盯着。
 *
 * 共享组件是**被所有人依赖**的那一层，它一旦引入一个会拖进 React 的包，
 * 四个端会同时中招。所以文案一律由宿主以 props 传入，本包只收 `string`。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 只用 RN 原语，不 import 任何 DOM 标签
 *
 * `View` / `Text` / `Pressable` / `FlatList` 在 `react-native-web` 上都有等价实现；
 * 而 `<div>` 在 iOS 上不存在。**写错一次的代价是三个端各改一遍**，
 * 所以这条必须从第一个组件就守住。
 */

import React, { useCallback, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Task } from '@heyta/domain';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import { toTaskRows, type TaskRow } from './model.js';

export interface TaskListProps {
  readonly tasks: readonly Task[];
  /** 勾选/取消勾选。**不要在组件内部改数据** —— 变更必须走宿主的 action 层。 */
  readonly onToggleTask: (taskId: string) => void;
  /** 标题为空时的替代文案（空标题是真实存在的，见 `model.ts`）。 */
  readonly fallbackTitle?: string;
  /** 没有任务时显示什么。省略则不渲染空态。 */
  readonly emptyMessage?: string;
  /** 列表根节点的测试标识。 */
  readonly testID?: string;
}

export function TaskList({
  tasks,
  onToggleTask,
  fallbackTitle,
  emptyMessage,
  testID,
}: TaskListProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();

  // `fallbackTitle` 参与 rows 的派生，但它是个 string（原始值），
  // 放进 deps 是安全的 —— 不要在这里传对象/数组，否则 useMemo 每轮都会重算。
  const rows = useMemo(
    () => toTaskRows(tasks, { fallbackTitle }),
    [tasks, fallbackTitle],
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        list: { paddingHorizontal: tokens['screen.gutter'] },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: tokens['size.row-min-height'],
          gap: tokens['space.3'],
          paddingVertical: tokens['space.2'],
        },
        box: {
          width: tokens['size.checkbox'],
          height: tokens['size.checkbox'],
          borderRadius: tokens['radius.sm'],
          borderWidth: tokens['border-width.thin'],
          borderColor: tokens['color.border-strong'],
          alignItems: 'center',
          justifyContent: 'center',
        },
        boxDone: {
          backgroundColor: tokens['color.primary'],
          borderColor: tokens['color.primary'],
        },
        // 勾的形状用文字画，避免为它引入一个图标依赖（图标库是各端不同的那一类依赖）。
        tick: { color: tokens['color.on-primary'] },
        body: { flex: 1, gap: tokens['space.1'] },
        titleDone: {
          color: tokens['color.foreground-subtle'],
          // 已完成加删除线。**不能只靠颜色变淡** —— 那会漏掉色觉障碍用户，
          // 而"这条到底做完了没有"是列表里最要紧的一个判断。
          // `textDecorationLine` 是 RN 的样式枚举，不是设计尺度，无需 token。
          textDecorationLine: 'line-through',
        },
        empty: {
          paddingVertical: tokens['space.8'],
          alignItems: 'center',
        },
      }),
    [tokens],
  );

  const renderItem = useCallback(
    ({ item }: { item: TaskRow }) => (
      <Pressable
        accessibilityRole="checkbox"
        // 无障碍状态必须显式给：读屏用户靠它知道"这条是待办还是已完成"，
        // 而勾选框的**颜色**对他们完全不可见。
        accessibilityState={{ checked: item.done }}
        accessibilityLabel={item.title}
        onPress={() => onToggleTask(item.id)}
        style={styles.row}
        testID={`task-row-${item.id}`}
      >
        <View style={[styles.box, item.done ? styles.boxDone : null]}>
          {item.done ? <Text style={[text.badge, styles.tick]}>✓</Text> : null}
        </View>
        <View style={styles.body}>
          <Text
            style={[text['row-title'], item.done ? styles.titleDone : null]}
            numberOfLines={2}
          >
            {item.title}
          </Text>
        </View>
      </Pressable>
    ),
    [onToggleTask, styles, text],
  );

  const keyExtractor = useCallback((item: TaskRow) => item.id, []);

  const empty = useMemo(
    () =>
      emptyMessage === undefined ? null : (
        <View style={styles.empty}>
          <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>
            {emptyMessage}
          </Text>
        </View>
      ),
    [emptyMessage, styles.empty, text.caption, tokens],
  );

  return (
    <FlatList
      data={rows}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      ListEmptyComponent={empty}
      contentContainerStyle={styles.list}
      testID={testID}
    />
  );
}
