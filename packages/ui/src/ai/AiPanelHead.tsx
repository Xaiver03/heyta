/**
 * AI 面板的**头部**（共享层）
 * ============================
 *
 * 这一块在 web 里被手抄了 **15 份**（5 个面板 × 3 种屏幕：披露 / 提案 / 失败）。
 * 抄出来的每一份都只差标题与 testid —— 正是"复制 5 份、第 5 份漏一维"那种
 * 漂移最爱的土壤（披露块与失败文案都已经各栽过一次，见
 * `docs/plans/site-and-parity-alignment.md` 里那两节）。
 *
 * ## 形状
 *
 * ```
 * ┌──────────────────────────────────────────────┐
 * │ [lead]  标题                    [tag] [close]│
 * └──────────────────────────────────────────────┘
 * ```
 *
 * · `lead`：标题前的装饰图标（`AiToolRun` 的 原创助手图形）。**不给就不渲染**。
 * · `tag`：右端的来源标签（本机 / 远端）。**不给就不渲染** —— 不开分支。
 * · `close`：`onClose` + `closeLabel` 都给才渲染。
 *   🔴 **`closeLabel` 必填**（与 `onClose` 成对）：一个没有可访问名的关闭按钮
 *   对读屏用户等于不存在，而这类缺陷在评审里几乎看不出来。
 *
 * ## 与 web 的 CSS 的关系
 *
 * 提取之前这一行是 `.ht-ai__head`（`app.css`）：flex / space-between / gap 8px /
 * `font-weight: 600`。这里用 token 复现同一形状，字号取语义样式 `panel-title`
 * （**这一刀新加的**：`xs` + `semibold` —— 语义样式里原本没有"小标题"这个角色）。
 *
 * ⚠️ 文案一律由宿主注入（本文件**不 import `@heyta/i18n`**）：i18n 包自带一份
 * React，四端会同时中招（与 `AiDisclosure` / `TaskList` 同一条纪律）。
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide';

import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';

export interface AiPanelHeadProps {
  /** 标题。可以是拼好的句子（`AiDuration` 的提案标题里嵌着 `<strong>`）。 */
  readonly title: React.ReactNode;
  /** 标题前的装饰图标。**不给就不渲染**。 */
  readonly lead?: React.ReactNode;
  /** 右端的来源标签（本机 / 远端）。 */
  readonly tag?: {
    readonly text: string;
    /** 沿用改造前各面板自己的 testid（`ai-proposal-source` / `capture-proposal-source`…）。 */
    readonly testID: string;
  };
  readonly onClose?: (() => void) | undefined;
  /** 关闭按钮的可访问名。与 `onClose` 成对出现 —— 见文件头。 */
  readonly closeLabel?: string | undefined;
  /** 关闭按钮的 testid（各面板实测值不同；不给就只有可访问名）。 */
  readonly closeTestID?: string | undefined;
  readonly testID?: string;
}

export function AiPanelHead(props: AiPanelHeadProps): React.JSX.Element {
  const { title, lead, tag, onClose, closeLabel, closeTestID } = props;
  const tokens = useHeytaTokens();
  const text = useHeytaText();

  const styles = StyleSheet.create({
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: tokens['space.2'],
    },
    group: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
      // 长标题要能被压缩（否则它会把右端的关闭按钮挤出可视区）。
      flexShrink: 1,
    },
    tag: {
      paddingHorizontal: tokens['space.2'],
      borderRadius: tokens['radius.sm'],
      backgroundColor: tokens['color.surface-sunken'],
      color: tokens['color.foreground-subtle'],
    },
    close: {
      // 触控区不能小于下限 —— 关闭是这一行唯一的主操作。
      minWidth: tokens['touch-target.min'],
      minHeight: tokens['touch-target.min'],
      alignItems: 'center',
      justifyContent: 'center',
    },
  });

  const closeVisible = onClose !== undefined && closeLabel !== undefined;

  return (
    <View style={styles.head} {...(props.testID === undefined ? {} : { testID: props.testID })}>
      <View style={styles.group}>
        {lead}
        <Text style={[text['panel-title'], { color: tokens['color.foreground'], flexShrink: 1 }]}>
          {title}
        </Text>
      </View>
      {tag === undefined && !closeVisible ? null : (
        <View style={styles.group}>
          {tag === undefined ? null : (
            <Text style={[text['panel-title'], styles.tag]} testID={tag.testID}>
              {tag.text}
            </Text>
          )}
          {closeVisible ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              {...(closeTestID === undefined ? {} : { testID: closeTestID })}
              onPress={onClose}
              style={styles.close}
            >
              <HeytaIcon
                data={X}
                size={tokens['icon.xs']}
                color={tokens['color.foreground-muted']}
              />
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}
