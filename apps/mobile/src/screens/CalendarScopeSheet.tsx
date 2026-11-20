/**
 * 日历「显示范围」半屏面板。
 * 勾选只改草稿，确认后才重排日历；取消、背景和下拉都放弃草稿。
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheet } from '@heyta/ui';
import { useI18n } from '@heyta/i18n';

import { Icon } from '../ui/icons';
import { Button, HStack, Text } from '../ui/kit';
import { useTokens } from '../theme';

export const SCOPE_INBOX = '__inbox__';
export const SCOPE_QUADRANT_PREFIX = 'q:';

export interface ScopeProject {
  readonly id: string;
  readonly name: string;
}

export interface CalendarScopeSheetProps {
  readonly visible: boolean;
  readonly projects: readonly ScopeProject[];
  readonly selected: readonly string[] | undefined;
  readonly quadrants: readonly { readonly id: string; readonly label: string }[];
  readonly onCancel: () => void;
  readonly onConfirm: (next: readonly string[] | undefined) => void;
}

export function CalendarScopeSheet({
  visible,
  projects,
  quadrants,
  selected,
  onCancel,
  onConfirm,
}: CalendarScopeSheetProps): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<readonly string[] | undefined>(selected);
  const [lastVisible, setLastVisible] = useState(visible);
  if (visible !== lastVisible) {
    setLastVisible(visible);
    if (visible) setDraft(selected);
  }

  const all = draft === undefined;
  const toggle = (id: string): void => {
    if (all) {
      setDraft([id]);
      return;
    }
    const next = draft.includes(id) ? draft.filter((value) => value !== id) : [...draft, id];
    setDraft(next.length === 0 ? undefined : next);
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          backgroundColor: tokens['color.surface'],
          borderRadius: tokens['radius.lg'],
          overflow: 'hidden',
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens['space.3'],
          minHeight: tokens['touch-target.min'],
          paddingHorizontal: tokens['space.4'],
          paddingVertical: tokens['space.3'],
        },
        rowLabel: { flex: 1 },
        divider: {
          height: StyleSheet.hairlineWidth,
          backgroundColor: tokens['color.border'],
          marginStart: tokens['space.4'],
        },
        grow: { flex: 1 },
      }),
    [tokens],
  );

  return (
    <BottomSheet
      visible={visible}
      title={t('mobile.calendar.scope.title')}
      labels={{
        close: t('mobile.calendar.scope.cancel'),
        expand: t('mobile.detail.sheet.expand'),
        collapse: t('mobile.detail.sheet.collapse'),
      }}
      onDismiss={onCancel}
      detents={['medium', 'large']}
      defaultDetent="medium"
      bottomInset={insets.bottom}
      testID="calendar-scope-sheet"
      footer={
        <HStack gap="default">
          <Button
            label={t('mobile.calendar.scope.cancel')}
            tone="ghost"
            onPress={onCancel}
            testID="calendar-scope-cancel"
            style={styles.grow}
          />
          <Button
            label={t('mobile.calendar.scope.confirm')}
            tone="primary"
            onPress={() => onConfirm(draft)}
            testID="calendar-scope-confirm"
            style={styles.grow}
          />
        </HStack>
      }
    >
      <View style={styles.card}>
        <Pressable
          style={styles.row}
          onPress={() => setDraft(undefined)}
          accessibilityRole="radio"
          accessibilityState={{ selected: all }}
          testID="calendar-scope-all"
        >
          <Icon name="group.inbox" size="sm" color={tokens['color.foreground-subtle']} />
          <Text style={styles.rowLabel}>{t('mobile.calendar.scope.all')}</Text>
          {all ? <Icon name="action.keep" size="sm" color={tokens['color.primary']} /> : null}
        </Pressable>
      </View>

      <View style={styles.card}>
        {quadrants.map((quadrant, index) => {
          const on = draft?.includes(quadrant.id) === true;
          return (
            <View key={quadrant.id}>
              {index === 0 ? null : <View style={styles.divider} />}
              <Pressable
                style={styles.row}
                onPress={() => toggle(quadrant.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                testID={`calendar-scope-${quadrant.id}`}
              >
                <Text style={styles.rowLabel}>{quadrant.label}</Text>
                {on ? <Icon name="action.keep" size="sm" color={tokens['color.primary']} /> : null}
              </Pressable>
            </View>
          );
        })}
      </View>

      <View style={styles.card}>
        <Pressable
          style={styles.row}
          onPress={() => toggle(SCOPE_INBOX)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: draft?.includes(SCOPE_INBOX) === true }}
          testID="calendar-scope-inbox"
        >
          <Icon name="group.inbox" size="sm" color={tokens['color.foreground-subtle']} />
          <Text style={styles.rowLabel}>{t('mobile.tasks.group.inbox')}</Text>
          {draft?.includes(SCOPE_INBOX) === true ? (
            <Icon name="action.keep" size="sm" color={tokens['color.primary']} />
          ) : null}
        </Pressable>
        {projects.map((project) => {
          const on = draft?.includes(project.id) === true;
          return (
            <View key={project.id}>
              <View style={styles.divider} />
              <Pressable
                style={styles.row}
                onPress={() => toggle(project.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                testID={`calendar-scope-project-${project.id}`}
              >
                <Text style={styles.rowLabel}>{project.name}</Text>
                {on ? <Icon name="action.keep" size="sm" color={tokens['color.primary']} /> : null}
              </Pressable>
            </View>
          );
        })}
      </View>
    </BottomSheet>
  );
}
