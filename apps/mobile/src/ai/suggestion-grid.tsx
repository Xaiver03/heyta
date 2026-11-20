/**
 * AI 空态的「建议」列表（对齐 assistant-ui 的 Suggestion primitive，按 Apple 列表收紧）。
 *
 * 竖排单卡、每行一个建议：图标 + 文本 + 细分割线，行高 44。比 2×2 大卡更紧凑，
 * 不把内容堆成板块；点一行把对应提示词填进输入框。
 */
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTokens } from '../theme';
import { Icon, type IconName } from '../ui/icons';
import { Text } from '../ui/kit';

export interface SuggestionItem {
  readonly key: string;
  readonly label: string;
  readonly icon: IconName;
}

export function AiSuggestionGrid({
  items,
  onPick,
}: {
  items: readonly SuggestionItem[];
  onPick: (item: SuggestionItem) => void;
}): React.JSX.Element {
  const tokens = useTokens();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          // 空态建议只是几行轻量入口：无卡片底、无阴影、无外框。
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens['space.2'],
          minHeight: tokens['touch-target.min'],
          paddingHorizontal: tokens['space.3'],
        },
        pressed: { opacity: tokens['state.pressed-opacity'] },
        grow: { flex: 1 },
        divider: { height: tokens['border-width.thin'], backgroundColor: tokens['color.border'], marginLeft: tokens['space.3'] + tokens['icon.sm'] + tokens['space.2'] },
      }),
    [tokens],
  );
  return (
    <View style={styles.card}>
      {items.map((item, index) => (
        <View key={item.key}>
          {index > 0 ? <View style={styles.divider} /> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.label}
            testID={`ai-suggestion-${item.key}`}
            onPress={() => { onPick(item); }}
            style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
          >
            <Icon name={item.icon} size="sm" color={tokens['color.primary']} />
            <Text variant="row-title" numberOfLines={1} style={styles.grow}>{item.label}</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}
