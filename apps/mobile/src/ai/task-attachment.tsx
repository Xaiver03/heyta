/**
 * 「引用任务」附件选择面板（移动端 Attachment 的落地形态）。
 *
 * heyta 的 AI 端点是 BYOK/纯文本，图片附件需要额外的图像选择依赖与多模态端点，
 * 这里先把**可直接进 prompt 的上下文**做成附件：把选中任务的标题作为引用随消息发出。
 */
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@heyta/i18n';
import { BottomSheet } from '@heyta/ui';

import { useTokens } from '../theme';
import { Icon } from '../ui/icons';
import { Button, Text } from '../ui/kit';

export interface AttachTask {
  readonly id: string;
  readonly title: string;
}

export function TaskAttachmentSheet({
  visible,
  tasks,
  selected,
  onToggle,
  onClose,
}: {
  visible: boolean;
  tasks: readonly AttachTask[];
  selected: readonly AttachTask[];
  onToggle: (task: AttachTask) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        list: {
          backgroundColor: tokens['color.surface'],
          borderRadius: tokens['radius.lg'],
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens['space.2'],
          minHeight: tokens['touch-target.min'],
          paddingHorizontal: tokens['space.3'],
        },
        grow: { flex: 1 },
        pressed: { opacity: tokens['state.pressed-opacity'] },
        divider: { height: tokens['border-width.thin'], backgroundColor: tokens['color.border'], marginLeft: tokens['space.3'] },
      }),
    [tokens],
  );
  const isOn = (id: string): boolean => selected.some((s) => s.id === id);
  return (
    <BottomSheet
      visible={visible}
      title={t('mobile.ai.attach.title')}
      labels={{
        close: t('mobile.ai.attach.done'),
        expand: t('mobile.detail.sheet.expand'),
        collapse: t('mobile.detail.sheet.collapse'),
      }}
      onDismiss={onClose}
      detents={['medium', 'large']}
      defaultDetent="medium"
      bottomInset={insets.bottom}
      footer={<Button label={t('mobile.ai.attach.done')} tone="primary" onPress={onClose} />}
    >
      <View style={styles.list}>
        {tasks.length === 0 ? (
          <View style={styles.row}>
            <Text variant="row-meta" tone="subtle">{t('mobile.ai.attach.empty')}</Text>
          </View>
        ) : (
          tasks.map((task, index) => {
            const on = isOn(task.id);
            return (
              <View key={task.id}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <Pressable
                  accessibilityRole="checkbox"
                  aria-checked={on}
                  accessibilityLabel={task.title}
                  onPress={() => { onToggle(task); }}
                  style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
                >
                  <Icon name={on ? 'task.done' : 'task.due'} size="sm" color={on ? tokens['color.primary'] : tokens['color.foreground-muted']} />
                  <Text variant="row-title" numberOfLines={1} style={styles.grow}>{task.title}</Text>
                </Pressable>
              </View>
            );
          })
        )}
      </View>
    </BottomSheet>
  );
}
