/**
 * 工具步骤的可折叠「思考链」（对齐 assistant-ui 的 ChainOfThought）。
 * 收起时只显示一行标题 + 步数；展开列出每一步工具与成败。
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '@heyta/i18n';

import { useTokens } from '../theme';
import { Icon } from '../ui/icons';
import { Text } from '../ui/kit';

export interface ChainStep {
  readonly tool: string;
  readonly ok: boolean;
}

export function ChainOfThought({ steps }: { steps: readonly ChainStep[] }): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();
  const [open, setOpen] = useState(false);
  const styles = useMemo(
    () =>
      StyleSheet.create({
        header: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens['space.1'],
          minHeight: tokens['touch-target.min'],
        },
        list: { gap: tokens['space.1'], paddingLeft: tokens['space.4'] },
        row: { flexDirection: 'row', alignItems: 'center', gap: tokens['space.1'] },
      }),
    [tokens],
  );
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('web.ai.chat.trace', { n: steps.length })}
        accessibilityState={{ expanded: open }}
        onPress={() => { setOpen((v) => !v); }}
        style={styles.header}
      >
        <Icon name={open ? 'action.collapse' : 'action.expand'} size="sm" color={tokens['color.foreground-muted']} />
        <Text variant="caption" tone="subtle">{t('web.ai.chat.trace', { n: steps.length })}</Text>
      </Pressable>
      {open ? (
        <View style={styles.list}>
          {steps.map((step, i) => (
            <View key={`${step.tool}-${String(i)}`} style={styles.row}>
              <Icon name={step.ok ? 'task.done' : 'conflict.warning'} size="sm" color={step.ok ? tokens['color.success'] : tokens['color.danger']} />
              <Text variant="caption" tone="subtle">{step.tool}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
