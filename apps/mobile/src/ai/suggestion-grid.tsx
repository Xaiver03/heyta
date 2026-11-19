/**
 * AI 空态的「建议」卡（对齐 assistant-ui 的 Suggestion primitive）。
 *
 * 用 2×2 的卡面展示能做什么，而不是一排光秃秃的文字标签 —— 让布局本身
 * 说明"这里可以点"，点一下就把那句话填进输入框。
 */
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useText, useTokens } from '../theme';
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
  const text = useText();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        grid: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.2'] },
        cell: {
          flexBasis: '48%',
          flexGrow: 1,
          backgroundColor: tokens['color.surface'],
          borderRadius: tokens['radius.lg'],
          paddingVertical: tokens['space.3'],
          paddingHorizontal: tokens['space.3'],
          gap: tokens['space.1'],
          ...(tokens['shadow.sm'] !== undefined ? { boxShadow: tokens['shadow.sm'] } : {}),
        },
        pressed: { opacity: tokens['state.pressed-opacity'] },
      }),
    [tokens],
  );
  return (
    <View style={styles.grid}>
      {items.map((item) => (
        <Pressable
          key={item.key}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          testID={`ai-suggestion-${item.key}`}
          onPress={() => { onPick(item); }}
          style={({ pressed }) => [styles.cell, pressed ? styles.pressed : null]}
        >
          <Icon name={item.icon} size="sm" color={tokens['color.primary']} />
          <Text variant="row-title" numberOfLines={1}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
