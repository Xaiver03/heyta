/**
 * 「会话」列表（对齐 assistant-ui 的 ThreadList 形态）。
 *
 * 现存储每账号只保留**一条**会话，所以列表如实展示：当前会话 + 新建会话。
 * 多会话并存需要扩存储结构，属后续项；这里不伪造不存在的历史。
 */
import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '@heyta/i18n';

import { useTokens } from '../theme';
import { Icon } from '../ui/icons';
import { Button, Text } from '../ui/kit';

export function SessionListSheet({
  visible,
  preview,
  onNew,
  onClose,
}: {
  visible: boolean;
  /** 当前会话最后一句用户消息，作副标题。空串则显示占位。 */
  preview: string;
  onNew: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        overlay: { flex: 1, backgroundColor: tokens['color.background'], justifyContent: 'center', paddingHorizontal: tokens['screen.gutter'] },
        sheet: { gap: tokens['space.3'] },
        card: {
          backgroundColor: tokens['color.surface'],
          borderRadius: tokens['radius.lg'],
          ...(tokens['shadow.sm'] !== undefined ? { boxShadow: tokens['shadow.sm'] } : {}),
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens['space.2'],
          minHeight: tokens['touch-target.min'],
          paddingHorizontal: tokens['space.3'],
        },
        col: { flex: 1 },
      }),
    [tokens],
  );
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('mobile.ai.sessions.title')}>
        <View style={styles.sheet}>
          <Text variant="section-title">{t('mobile.ai.sessions.title')}</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Icon name="task.done" size="sm" color={tokens['color.primary']} />
              <View style={styles.col}>
                <Text variant="row-title" numberOfLines={1}>{t('mobile.ai.sessions.current')}</Text>
                {preview === '' ? null : <Text variant="caption" tone="subtle" numberOfLines={1}>{preview}</Text>}
              </View>
            </View>
            <View style={{ height: tokens['border-width.thin'], backgroundColor: tokens['color.border'], marginLeft: tokens['space.3'] }} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('web.ai.chat.newSession')}
              testID="ai-session-new"
              onPress={() => { onClose(); onNew(); }}
              style={({ pressed }) => [styles.row, pressed ? { opacity: tokens['state.pressed-opacity'] } : null]}
            >
              <Icon name="assistant.new-session" size="sm" color={tokens['color.primary']} />
              <Text variant="row-title" style={styles.col}>{t('web.ai.chat.newSession')}</Text>
            </Pressable>
          </View>
          <Button label={t('mobile.ai.attach.done')} tone="primary" onPress={onClose} />
        </View>
      </Pressable>
    </Modal>
  );
}
