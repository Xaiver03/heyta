/**
 * 「会话」列表（对齐 assistant-ui 的 ThreadList 形态）。
 *
 * 支持：列出本机保存的多段会话、点一段切过去、给一段改名、新开一段。
 * 存储与切换由 `chat-controller` 负责（`sessions` / `activeSessionId` /
 * `switchSession` / `renameSession`）；这里只负责呈现与收集动作。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@heyta/i18n';
import { BottomSheet } from '@heyta/ui';

import { useTokens } from '../theme';
import { Icon } from '../ui/icons';
import { Button, IconButton, Text, TextField } from '../ui/kit';

export interface SessionListEntry {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: number;
}

export function SessionListSheet({
  visible,
  sessions,
  activeId,
  onSelect,
  onRename,
  onNew,
  onClose,
}: {
  visible: boolean;
  sessions: readonly SessionListEntry[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onNew: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const [renamingId, setRenamingId] = useState<string | undefined>(undefined);
  const [renameText, setRenameText] = useState('');

  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
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
        col: { flex: 1 },
        divider: { height: tokens['border-width.thin'], backgroundColor: tokens['color.border'], marginLeft: tokens['space.3'] },
        renameActions: { flexDirection: 'row', gap: tokens['space.2'] },
      }),
    [tokens],
  );

  useEffect(() => {
    if (!visible) {
      setRenamingId(undefined);
      setRenameText('');
    }
  }, [visible]);

  const titleOf = (entry: SessionListEntry): string =>
    entry.title.trim() !== '' ? entry.title : t('mobile.ai.sessions.untitled');

  const resetRename = (): void => {
    setRenamingId(undefined);
    setRenameText('');
  };
  const close = (): void => {
    resetRename();
    onClose();
  };
  const beginRename = (entry: SessionListEntry): void => {
    setRenameText(entry.title);
    setRenamingId(entry.id);
  };
  const commitRename = (): void => {
    if (renamingId !== undefined) onRename(renamingId, renameText);
    resetRename();
  };

  return (
    <BottomSheet
      visible={visible}
      title={renamingId !== undefined ? t('mobile.ai.sessions.rename') : t('mobile.ai.sessions.title')}
      labels={{
        close: t('mobile.ai.attach.done'),
        expand: t('mobile.detail.sheet.expand'),
        collapse: t('mobile.detail.sheet.collapse'),
      }}
      onDismiss={close}
      detents={['small', 'medium', 'large']}
      defaultDetent="small"
      bottomInset={insets.bottom}
      footer={
        renamingId !== undefined ? (
          <View style={styles.renameActions}>
            <Button label={t('mobile.common.cancel')} tone="ghost" onPress={resetRename} />
            <Button label={t('mobile.ai.sessions.save')} tone="primary" onPress={commitRename} testID="ai-session-rename-save" />
          </View>
        ) : undefined
      }
    >
      {renamingId !== undefined ? (
        <TextField
          label={t('mobile.ai.sessions.renameTitle')}
          value={renameText}
          onChangeText={setRenameText}
          autoCapitalize="sentences"
          onSubmitEditing={commitRename}
          testID="ai-session-rename-input"
        />
      ) : (
        <View style={styles.card}>
          {sessions.map((entry) => {
            const active = entry.id === activeId;
            return (
              <View key={entry.id}>
                <View style={styles.row}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={titleOf(entry)}
                    accessibilityState={{ selected: active }}
                    testID={`ai-session-item-${entry.id}`}
                    onPress={() => { onSelect(entry.id); close(); }}
                    style={({ pressed }) => [
                      { flexDirection: 'row', alignItems: 'center', gap: tokens['space.2'], flex: 1, minHeight: tokens['touch-target.min'] },
                      pressed ? { opacity: tokens['state.pressed-opacity'] } : null,
                    ]}
                  >
                    <Icon name={active ? 'task.done' : 'assistant.new-session'} size="sm" color={active ? tokens['color.primary'] : tokens['color.foreground-subtle']} />
                    <Text variant="row-title" style={styles.col} numberOfLines={1}>{titleOf(entry)}</Text>
                  </Pressable>
                  <IconButton
                    icon="action.rename"
                    label={t('mobile.ai.sessions.rename')}
                    testID={`ai-session-rename-${entry.id}`}
                    onPress={() => { beginRename(entry); }}
                  />
                </View>
                <View style={styles.divider} />
              </View>
            );
          })}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('web.ai.chat.newSession')}
            testID="ai-session-new"
            onPress={() => { close(); onNew(); }}
            style={({ pressed }) => [styles.row, pressed ? { opacity: tokens['state.pressed-opacity'] } : null]}
          >
            <Icon name="assistant.new-session" size="sm" color={tokens['color.primary']} />
            <Text variant="row-title" style={styles.col}>{t('web.ai.chat.newSession')}</Text>
          </Pressable>
        </View>
      )}
    </BottomSheet>
  );
}
