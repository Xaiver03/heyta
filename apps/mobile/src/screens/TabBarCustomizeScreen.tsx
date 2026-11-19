/**
 * 「自定义底部导航」——底栏 DIY 设置面（我的 → 自定义底部导航）。
 *
 * 只做一件事：让用户从六个工作空间里选 2–4 个、排序、恢复默认。
 * 所有读写与校验都在 `nav/tab-preferences.ts`（device-prefs，本地保存、损坏回默认）；
 * 本屏只负责交互与把结果写回去。保存后由 `subscribeTabBarWorkspaces` 通知外壳实时重排。
 * 「我的」固定在最右，不在此列、不参与排序。
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '@heyta/i18n';

import { useText, useTokens } from '../theme';
import { Button, Screen, Text } from '../ui/kit';
import { Icon } from '../ui/icons';
import { WORKSPACE_TAB_META } from '../nav/workspaces';
import {
  DEFAULT_TAB_BAR_WORKSPACES,
  getTabBarWorkspacesSnapshot,
  resetTabBarWorkspaces,
  writeTabBarWorkspaces,
  type WorkspaceKey,
} from '../nav/tab-preferences';

const MIN_WORKSPACES = 2;
const MAX_WORKSPACES = 4;

export function TabBarCustomizeScreen({ onBack }: { onBack: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();
  const text = useText();
  const [draft, setDraft] = useState<WorkspaceKey[]>(() => [...getTabBarWorkspacesSnapshot()]);
  const [error, setError] = useState<string | undefined>(undefined);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: { gap: tokens['space.4'] },
        card: {
          backgroundColor: tokens['color.surface'],
          borderRadius: tokens['radius.lg'],
          paddingHorizontal: tokens['space.2'],
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens['space.2'],
          minHeight: tokens['touch-target.min'],
          paddingVertical: tokens['space.1'],
        },
        grow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: tokens['space.2'] },
        order: {
          width: tokens['icon.sm'],
          textAlign: 'center',
          fontVariant: ['tabular-nums'],
          color: tokens['color.foreground-subtle'],
        },
        divider: { height: tokens['border-width.thin'], backgroundColor: tokens['color.border'], marginLeft: tokens['space.2'] },
        actions: { flexDirection: 'row', alignItems: 'center', gap: tokens['space.1'] },
        iconBtn: {
          minWidth: tokens['touch-target.min'],
          minHeight: tokens['touch-target.min'],
          alignItems: 'center',
          justifyContent: 'center',
        },
        footer: { gap: tokens['space.2'] },
      }),
    [tokens],
  );

  const commit = (next: WorkspaceKey[]): void => {
    setDraft(next);
    writeTabBarWorkspaces(next);
  };

  const toggle = (key: WorkspaceKey): void => {
    if (draft.includes(key)) {
      if (draft.length <= MIN_WORKSPACES) {
        setError(t('mobile.tabbarCustomize.error.min', { min: MIN_WORKSPACES }));
        return;
      }
      setError(undefined);
      commit(draft.filter((k) => k !== key));
      return;
    }
    if (draft.length >= MAX_WORKSPACES) {
      setError(t('mobile.tabbarCustomize.error.max', { max: MAX_WORKSPACES }));
      return;
    }
    setError(undefined);
    commit([...draft, key]);
  };

  const move = (key: WorkspaceKey, dir: -1 | 1): void => {
    const from = draft.indexOf(key);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= draft.length) return;
    const next = [...draft];
    next[from] = next[to]!;
    next[to] = key;
    commit(next);
  };

  const restore = (): void => {
    resetTabBarWorkspaces();
    setDraft([...DEFAULT_TAB_BAR_WORKSPACES]);
    setError(undefined);
  };

  return (
    <Screen
      title={t('mobile.tabbarCustomize.title')}
      actions={[{ icon: 'action.back', label: t('mobile.growth.back'), onPress: onBack }]}
    >
      <View style={styles.wrap}>
        <Text variant="caption" tone="subtle">
          {t('mobile.tabbarCustomize.hint', { min: MIN_WORKSPACES, max: MAX_WORKSPACES })}
        </Text>

        <View style={styles.card} testID="tabbar-customize-list">
          {WORKSPACE_TAB_META.map((meta, index) => {
            const position = draft.indexOf(meta.key);
            const selected = position >= 0;
            return (
              <View key={meta.key}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <View style={styles.row}>
                  <Pressable
                    accessibilityRole="checkbox"
                    aria-checked={selected}
                    accessibilityLabel={t(meta.labelKey)}
                    testID={`tabbar-toggle-${meta.key}`}
                    onPress={() => { toggle(meta.key); }}
                    style={styles.grow}
                  >
                    <Icon
                      name={selected ? 'task.done' : meta.icon}
                      size="sm"
                      color={selected ? tokens['color.primary'] : tokens['color.foreground-muted']}
                    />
                    {selected ? (
                      <Text variant="row-title">{t(meta.labelKey)}</Text>
                    ) : (
                      <Text variant="row-title" tone="muted">{t(meta.labelKey)}</Text>
                    )}
                  </Pressable>
                  {selected ? (
                    <Text style={[text['row-meta'], styles.order]}>{position + 1}</Text>
                  ) : null}
                  <View style={styles.actions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('mobile.tabbarCustomize.up')}
                      disabled={!selected || position <= 0}
                      testID={`tabbar-up-${meta.key}`}
                      onPress={() => { move(meta.key, -1); }}
                      style={[styles.iconBtn, { opacity: !selected || position <= 0 ? tokens['state.disabled-opacity'] : 1 }]}
                    >
                      <Icon name="action.disclose-down" size="sm" color={tokens['color.foreground-muted']} />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('mobile.tabbarCustomize.down')}
                      disabled={!selected || position === draft.length - 1}
                      testID={`tabbar-down-${meta.key}`}
                      onPress={() => { move(meta.key, 1); }}
                      style={[styles.iconBtn, { opacity: !selected || position === draft.length - 1 ? tokens['state.disabled-opacity'] : 1 }]}
                    >
                      <Icon name="action.expand" size="sm" color={tokens['color.foreground-muted']} />
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })}
        </View>

        {error === undefined ? null : (
          <Text variant="row-meta" tone="danger" selectable>{error}</Text>
        )}

        <View style={styles.footer}>
          <Button label={t('mobile.tabbarCustomize.restore')} tone="ghost" onPress={restore} />
        </View>
      </View>
    </Screen>
  );
}
