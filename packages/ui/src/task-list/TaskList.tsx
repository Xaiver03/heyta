/**
 * TaskList —— 四端共用的任务列表
 * ==============================
 *
 * M1 的**验证切片**：如果这一个组件能在 Web / iOS / Android / 鸿蒙上
 * 用同一份源码渲染出来，那么"一套代码多端"这条路就成立；
 * 如果不成立，越早发现越好 —— 所以这块刻意选了**有真实复杂度**的组件
 * （列表、排序、命中区、无障碍、主题、插槽），而不是一个 Hello World。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 分工：**共享组件管机制，宿主管内容**
 *
 * 这是读完 `apps/mobile/src/screens/TasksScreen.tsx` 之后定下来的，
 * 不是一开始就设计好的。第一版 `TaskList` 只有"勾选框 + 标题"，而 mobile
 * 既有的行还有：截止徽章、优先级徽章、重复规则标记、删除按钮，
 * 以及**点行 = 打开详情**（不是切换完成）。
 *
 * 所以直接替换就是**产品退化**。仔细看那些差异会发现，里面只有
 * **文案与配色**是真差异，其余全都是可以共享的机制：
 *
 * | 共享组件负责（有判断、有测试） | 宿主负责（本地化、平台化） |
 * |---|---|
 * | 排序（未完成在前 / 截止升序 / 无截止垫底） | 截止文案（`t()`） |
 * | `TaskRow` 派生（含 `completedAt` 存在性判断） | 优先级徽章文字与颜色 |
 * | 行骨架、勾选框尺寸与 44 触控区补偿 | 重复规则的句子 |
 * | 无障碍 role / state / busy | 无障碍**文案**（必须整句，见下） |
 * | 空态与列表稳定性 | 尾部动作（删除按钮等） |
 *
 * 于是宿主注入 `renderMeta` / `renderTrailing` / `labels` 三个插槽，
 * 而**"一行长什么样"这件事本身**只写一次。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本文件刻意**不 import `@heyta/i18n`**
 *
 * i18n 包曾自己带了一份 React，导致 Android 产物里出现**两个 React 实例**
 * （钩子报 Invalid hook call，而报错位置离根因很远）。这件事已经踩过一次，
 * 仓库里因此有 `check:mobile-bundle` 门禁盯着。
 *
 * 共享组件是**被所有人依赖**的那一层，它一旦引入一个会拖进 React 的包，
 * 四个端会同时中招。所以文案一律靠宿主注入 —— 这也是 `labels` 里每一项
 * 都是 `(row) => string` 而不是 `string` 的原因：文案依赖行内容
 * （"完成：买牛奶"），而模板必须留在有 i18n 的那一侧。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 只用 RN 原语，不 import 任何 DOM 标签
 *
 * `View` / `Text` / `Pressable` / `FlatList` 在 `react-native-web` 上都有等价实现；
 * 而 `<div>` 在 iOS 上不存在。**写错一次的代价是三个端各改一遍**，
 * 所以这条必须从第一个组件就守住。
 */

import React, { useCallback, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import type { Task } from '@heyta/domain';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import { toTaskRows, type TaskRow } from './model.js';

/** 行级无障碍文案。**每一项都是一整句**，不要用前缀拼标题。 */
export interface TaskListLabels {
  /** 未完成时勾选框的念法，如「完成：买牛奶」。 */
  readonly toggleOn?: (row: TaskRow) => string;
  /** 已完成时勾选框的念法，如「取消完成：买牛奶」。 */
  readonly toggleOff?: (row: TaskRow) => string;
  /** 整行可点时它的念法，如「打开：买牛奶」。 */
  readonly open?: (row: TaskRow) => string;
}

export interface TaskListProps {
  readonly tasks: readonly Task[];
  /** 勾选/取消勾选。**不要在组件内部改数据** —— 变更必须走宿主的 action 层。 */
  readonly onToggleTask: (taskId: string) => void;
  /**
   * 点整行的行为。**给了就打开详情；不给时整行不可点。**
   *
   * ⚠️ mobile 的既有实现是"点行 = 打开详情"，理由是
   * 「行上的主操作应该是打开它」—— 切换完成有专门的勾选框，
   * 那样读屏用户不必先打开详情再去找按钮。
   *
   * 注意这里**刻意不把"没给 onOpenTask"降级成"点行=切换完成"**：
   * 那个默认值会让"忘了传 onOpenTask"表现成**点一下就误完成一条任务**，
   * 而这是不可撤销语义上的破坏。宁可不可点。
   */
  readonly onOpenTask?: (taskId: string) => void;
  readonly labels?: TaskListLabels;
  /** 标题下方的元信息行（截止 / 优先级 / 重复…）。 */
  readonly renderMeta?: (row: TaskRow) => React.ReactNode;
  /** 行尾的动作（比如删除按钮）。 */
  readonly renderTrailing?: (row: TaskRow) => React.ReactNode;
  /** 正在处理中的行 id —— 用于置灰该行，避免连点发出两条变更。 */
  readonly busyTaskId?: string | null;
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
  onOpenTask,
  labels,
  renderMeta,
  renderTrailing,
  busyTaskId,
  fallbackTitle,
  emptyMessage,
  testID,
}: TaskListProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();

  // `fallbackTitle` 参与 rows 的派生，但它是个 string（原始值），
  // 放进 deps 是安全的 —— 不要在这里传对象/数组，否则 useMemo 每轮都会重算。
  const rows = useMemo(() => toTaskRows(tasks, { fallbackTitle }), [tasks, fallbackTitle]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        list: { paddingHorizontal: tokens['screen.gutter'] },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: tokens['size.row-min-height'],
          gap: tokens['space.1'],
        },
        /**
         * 🔴 负外边距把勾选框的**触控区**拉回来与屏幕留白对齐。
         *
         * 它的可点区域按无障碍要求是 `touch-target.min`（44），比**视觉尺寸**
         * `size.checkbox` 大。不补偿的话整行会比其它界面元素多缩进几个点 ——
         * 看起来只是"没对齐"，而原因藏在触控区里，光读这一行看不出来。
         */
        checkboxHit: {
          marginLeft: -(tokens['touch-target.min'] - tokens['size.checkbox']) / 2,
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
        // 勾的形状用文字画，避免为它引入一个图标依赖
        //（图标库正是各端不一样的那一类依赖）。
        tick: { color: tokens['color.on-primary'] },
        body: { flex: 1, paddingVertical: tokens['space.2'], gap: tokens['space.1'] } as const,
        titleDone: {
          color: tokens['color.foreground-subtle'],
          // 已完成加删除线。**不能只靠颜色变淡** —— 那会漏掉色觉障碍用户，
          // 而"这条到底做完了没有"是列表里最要紧的一个判断。
          // `textDecorationLine` 是 RN 的样式枚举，不是设计尺度，无需 token。
          textDecorationLine: 'line-through',
        } as const,
        metaRow: { flexDirection: 'row', alignItems: 'center', gap: tokens['space.2'] },
        empty: { paddingVertical: tokens['space.8'], alignItems: 'center' },
      }),
    [tokens],
  );

  const renderItem = useCallback(
    ({ item }: { item: TaskRow }) => {
      const busy = busyTaskId === item.id;
      const toggleLabel = item.done
        ? (labels?.toggleOff?.(item) ?? item.title)
        : (labels?.toggleOn?.(item) ?? item.title);
      const openLabel = labels?.open?.(item);

      const title = (
        <Text style={[text['row-title'], item.done ? styles.titleDone : null]} numberOfLines={2}>
          {item.title}
        </Text>
      );

      return (
        <View style={styles.row}>
          <Pressable
            accessibilityRole="checkbox"
            // 无障碍状态必须显式给：读屏用户靠它知道"这条是待办还是已完成"，
            // 而勾选框的**颜色**对他们完全不可见。
            accessibilityState={{ checked: item.done, busy }}
            accessibilityLabel={toggleLabel}
            disabled={busy}
            onPress={() => onToggleTask(item.id)}
            style={styles.checkboxHit}
            testID={`task-toggle-${item.id}`}
          >
            <View style={[styles.box, item.done ? styles.boxDone : null]}>
              {item.done ? <Text style={[text.badge, styles.tick]}>✓</Text> : null}
            </View>
          </Pressable>

          {/*
            🔴 没有 `onOpenTask` 时，行体**不是**可点的。
            在勾选框外面再套一层可点区域会让读屏念两遍，
            而两个语义重叠的命中区在触屏上也很难区分。
          */}
          {onOpenTask === undefined ? (
            <View style={styles.body} testID={`task-row-${item.id}`}>
              {title}
              {renderMeta === undefined ? null : <View style={styles.metaRow}>{renderMeta(item)}</View>}
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              {...(openLabel === undefined ? {} : { accessibilityLabel: openLabel })}
              onPress={() => onOpenTask(item.id)}
              style={styles.body}
              testID={`task-row-${item.id}`}
            >
              {title}
              {renderMeta === undefined ? null : <View style={styles.metaRow}>{renderMeta(item)}</View>}
            </Pressable>
          )}

          {renderTrailing === undefined ? null : renderTrailing(item)}
        </View>
      );
    },
    [busyTaskId, labels, onOpenTask, onToggleTask, renderMeta, renderTrailing, styles, text],
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

/** 供插槽复用的标题样式类型。 */
export type TaskTitleStyle = StyleProp<TextStyle>;
