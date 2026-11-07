/**
 * 错误态（共享）——**不是空态的第五档**
 * =====================================
 *
 * 判据出处：[`docs/plans/r11-states-audit-2026-11.md` §4.1] 与
 * [`docs/agents/overlay-feedback.md`]：一个容器的"没有内容"与"没读到内容"
 * 共用同一个根节点的 `padding` / `alignItems` / `justifyContent` 时，
 * **用户与判据都分不出这两件事**。
 *
 * 所以这个文件刻意**不复用** `EmptyState`：
 *   - 不 import 它、不传它的 `size`、不共用它的根样式；
 *   - 形态判据在 `packages/ui/tests/error-state-shape.spec.ts`（源码形状，
 *     因为本包跑 node 环境、加载不了 RN 渲染树）。
 *
 * 为什么落在这里而不是 `empty-state/`：`empty-state/model.ts` 的
 * `detailTone` 默认 `'danger'` 已经是"错误借用空态"的入口 —— 新件再长进那个
 * 命名空间，就把 PRD 明令否掉的方案**在目录结构上**做进去了。
 *
 * ───────────────────────────────────────────────────────────────────────
 * 文案由宿主注入，本文件**不 import `@heyta/i18n`**（同 `EmptyState`，
 * 理由见那个文件头：i18n 包曾带第二份 React）。
 * ───────────────────────────────────────────────────────────────────────
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useHeytaText, useHeytaTokens } from '../theme.js';

export interface ErrorStateLabels {
  /** 一句话说清"什么没读到"。必填且非空白。 */
  readonly title: string;
  /** 补充说明（例如"检查网络后重试"）。可选。 */
  readonly hint?: string | undefined;
  /** 重试按钮的文字。**给了就必须给 `onRetry`**，反之亦然。 */
  readonly retryLabel?: string | undefined;
}

export interface ErrorStateProps {
  readonly labels: ErrorStateLabels;
  /**
   * 重试。与 `labels.retryLabel` 成对出现：
   * 只有文案没有回调 ⇒ 画一枚按不动的按钮（假动作）；
   * 只有回调没有文案 ⇒ 用户不知道那枚按钮干什么。
   */
  readonly onRetry?: (() => void) | undefined;
  /** 可复制的技术详情（`error.message`）。默认**不**直接铺在正文里。 */
  readonly detail?: string | undefined;
  readonly testID?: string | undefined;
}

/**
 * 错误态。
 *
 * 🔴 三条与空态**刻意不同**的东西（判据钉的就是这三条）：
 *   1. 根节点 `accessibilityRole="alert"` + `aria-live` 语义 —— 它要**打断**；
 *   2. **没有**页面档的大内边距（`space.16`）—— 它不是"这里很空"，是"这里坏了"；
 *   3. 带一枚**具名**重试按钮（不是"再试一次"的图标），且与文案成对。
 */
export function ErrorState(props: ErrorStateProps): React.JSX.Element {
  const { labels, onRetry, detail, testID } = props;
  const tokens = useHeytaTokens();
  const text = useHeytaText();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        /**
         * 与 `EmptyState` 的 `root` 刻意不同：没有 `paddingVertical: space.16`、
         * 没有 `justifyContent: center`。它是一条**贴在内容位置上**的失败条，
         * 不是一块居中的"这里什么都没有"。
         */
        root: {
          gap: tokens['space.2'],
          paddingVertical: tokens['space.3'],
          paddingHorizontal: tokens['space.3'],
          borderWidth: tokens['border-width.thin'],
          borderColor: tokens['color.danger'],
          borderRadius: tokens['radius.md'],
          backgroundColor: tokens['color.surface-raised'],
        },
        title: { color: tokens['color.danger'] },
        hint: { color: tokens['color.foreground-muted'] },
        retry: {
          alignSelf: 'flex-start',
          minHeight: tokens['size.field-height'],
          justifyContent: 'center',
          paddingHorizontal: tokens['space.3'],
          borderRadius: tokens['radius.sm'],
          borderWidth: tokens['border-width.thin'],
          borderColor: tokens['color.danger'],
        },
        retryLabel: { color: tokens['color.danger'] },
        detail: { color: tokens['color.foreground-subtle'] },
      }),
    [tokens],
  );

  const retryLabel = (labels.retryLabel ?? '').trim();
  // 成对判据：文案与回调必须同时有，否则不画那枚按钮（画了就成假动作）。
  const showRetry = retryLabel.length > 0 && onRetry !== undefined;

  return (
    <View style={styles.root} accessibilityRole="alert" testID={testID}>
      <Text style={[text['row-title'], styles.title]}>{labels.title}</Text>
      {labels.hint === undefined || labels.hint.trim() === '' ? null : (
        <Text style={[text['row-meta'], styles.hint]}>{labels.hint}</Text>
      )}
      {showRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={styles.retry}
          testID={testID === undefined ? undefined : `${testID}-retry`}
        >
          <Text style={[text['row-meta'], styles.retryLabel]}>{retryLabel}</Text>
        </Pressable>
      ) : null}
      {detail === undefined || detail.trim() === '' ? null : (
        <Text selectable style={[text['caption'], styles.detail]}>
          {detail}
        </Text>
      )}
    </View>
  );
}
