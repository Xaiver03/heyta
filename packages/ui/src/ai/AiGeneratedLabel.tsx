/**
 * AI 生成合成内容的**显式标识**（共享层，四端同一份）
 * =====================================================
 *
 * 《人工智能生成合成内容标识办法》与 GB 45438-2025 要求生成合成的文本内容在界面的
 * 适当位置带上"这是 AI 生成的"提示。这个组件就是那句提示本身：它不是解释、不是
 * 免责声明、也不是"来源：本机/远程"那种端点标签（那是 `AiPanelHead` 的 `tag`，
 * 说的是数据去了哪里，不回答"这段话是谁写的"）。
 *
 * ## 文案一律宿主注入
 *
 * 与 `AiPanel` 同一理由：本包不 import `@heyta/i18n`（i18n 自带一份 React，
 * 四端会同时中招）。宿主从 `common.ai.generatedLabel` 取词后传进来。
 *
 * 🔴 `label` **必填、没有默认值**：默认值会让"某个 AI 输出面接漏了"表现为
 * 一个仍然渲染着正确文字的位置，而那正是这件事最容易失效的方式。
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useHeytaText, useHeytaTokens } from '../theme.js';

export interface AiGeneratedLabelProps {
  /** 已翻好的标识文字（`common.ai.generatedLabel`）。 */
  readonly label: string;
  /** 各输出面自己的 testID；判据按它定位。 */
  readonly testID?: string;
}

export function AiGeneratedLabel({
  label,
  testID,
}: AiGeneratedLabelProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        mark: {
          alignSelf: 'flex-start',
          paddingHorizontal: tokens['space.2'],
          paddingVertical: tokens['space.1'],
          borderRadius: tokens['radius.sm'],
          backgroundColor: tokens['color.primary-subtle'],
        },
      }),
    [tokens],
  );

  return (
    <View style={styles.mark} testID={testID ?? 'ai-generated-label'}>
      <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>{label}</Text>
    </View>
  );
}
