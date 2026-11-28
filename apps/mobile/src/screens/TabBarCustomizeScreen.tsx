/**
 * 「自定义底部导航」——底栏 DIY 设置面（我的 → 自定义底部导航）。
 *
 * 只做一件事：让用户从六个工作空间里选 2–4 个、排序、恢复默认。
 * 所有读写与校验都在 `nav/tab-preferences.ts`（device-prefs，本地保存、损坏回默认）；
 * 本屏只负责交互与把结果写回去。保存后由 `subscribeTabBarWorkspaces` 通知外壳实时重排。
 * 「我的」固定在最右，不在此列、不参与排序。
 *
 * 🔴 交互（2026-11-27 产品改版，对标滴答清单的「功能模块」排序）：
 *   · **直接上下拖拽**排序。一整行握在手里、1:1 跟手，越过邻居就换位；
 *     不再用「上移 / 下移」两枚箭头（两个字号相同的下箭头既看不懂也没有必要）。
 *   · **不再用勾选框 / 序号**表达"已选"：是否上底栏是右侧那一枚开关的事，
 *     顺序就是列表从上到下的位置本身。勾 + 序号 + 位置三重表达同一件事，删到只剩位置。
 *   · 拖拽只作用在**已选**那一段（未选的在下面，拨开关才会进来）。
 *
 * 动画走 Apple《Designing Fluid Interfaces》那套：抓起来 1:1 跟手（§2）、
 * 松手从**当前值**弹回（§3，不用固定时长动画）、邻居让位用位移而不是重排（§7）。
 */
import React, { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Switch, View } from 'react-native';
import { useI18n } from '@heyta/i18n';

import { useTokens } from '../theme';
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

/** 一行的固定高度（拖拽位移按它换算索引）。取触控下限 + 一格内边距。 */
function useRowHeight(): number {
  const tokens = useTokens();
  return tokens['touch-target.min'] + tokens['space.2'];
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** 一排「≡」抓手：三条短横线，纯布局，不用矢量图标。 */
function GripDots(): React.JSX.Element {
  const tokens = useTokens();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: { gap: tokens['space.1'], alignItems: 'center', justifyContent: 'center' },
        bar: {
          width: tokens['space.4'],
          height: tokens['border-width.thick'],
          borderRadius: tokens['radius.full'],
          backgroundColor: tokens['color.foreground-subtle'],
        },
      }),
    [tokens],
  );
  return (
    <View style={styles.wrap}>
      <View style={styles.bar} />
      <View style={styles.bar} />
      <View style={styles.bar} />
    </View>
  );
}

export function TabBarCustomizeScreen({ onBack }: { onBack: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();
  const ROW_H = useRowHeight();

  const [draft, setDraft] = useState<WorkspaceKey[]>(() => [...getTabBarWorkspacesSnapshot()]);
  const [error, setError] = useState<string | undefined>(undefined);

  /**
   * 展示顺序 = **已选（按用户顺序）+ 未选（按规格表原序）**。
   * 已选永远在顶部那一段，所以"第几个上底栏"就是它在列表上半段的第几行 —— 不需要序号。
   */
  const display = useMemo<WorkspaceKey[]>(() => {
    const selected = draft;
    const rest = WORKSPACE_TAB_META.map((m) => m.key).filter((key) => !selected.includes(key));
    return [...selected, ...rest];
  }, [draft]);

  const displayRef = useRef(display);
  displayRef.current = display;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  /** 每一行的位移：被拖的那行用 `dragY`，邻居让位用自己的 `anims[key]`。 */
  const animsRef = useRef<Record<WorkspaceKey, Animated.Value> | null>(null);
  if (animsRef.current === null) {
    const map = {} as Record<WorkspaceKey, Animated.Value>;
    for (const meta of WORKSPACE_TAB_META) map[meta.key] = new Animated.Value(0);
    animsRef.current = map;
  }
  const anims = animsRef.current!;

  const dragY = useRef(new Animated.Value(0)).current;
  const dragKeyRef = useRef<WorkspaceKey | null>(null);
  const startIndexRef = useRef(0);
  const targetIndexRef = useRef(0);
  const [dragKey, setDragKey] = useState<WorkspaceKey | null>(null);

  const commit = (next: WorkspaceKey[]): void => {
    setDraft(next);
    writeTabBarWorkspaces(next);
  };

  const resetDragVisuals = (): void => {
    for (const meta of WORKSPACE_TAB_META) anims[meta.key].setValue(0);
    dragY.setValue(0);
  };

  const finishDrag = (): void => {
    const key = dragKeyRef.current;
    if (key === null) return;
    const from = startIndexRef.current;
    const to = targetIndexRef.current;
    dragKeyRef.current = null;
    setDragKey(null);
    resetDragVisuals();
    if (to !== from) {
      const next = [...draftRef.current];
      const [moved] = next.splice(from, 1);
      if (moved !== undefined) {
        next.splice(to, 0, moved);
        commit(next);
      }
    }
  };

  /** 松手弹回用**当前手速**接到临界阻尼弹簧上（不写死时长）。 */
  const settleActive = (): void => {
    Animated.spring(dragY, {
      toValue: 0,
      useNativeDriver: false,
      speed: 20,
      bounciness: 0,
    }).start(finishDrag);
  };

  const makePanResponder = useMemo(
    () =>
      (key: WorkspaceKey): ReturnType<typeof PanResponder.create> =>
        PanResponder.create({
          onStartShouldSetPanResponder: () => false,
          onMoveShouldSetPanResponder: (_e, g) =>
            Math.abs(g.dy) > tokens['space.1'] && Math.abs(g.dy) > Math.abs(g.dx),
          onPanResponderGrant: () => {
            const idx = displayRef.current.indexOf(key);
            const maxSelectedIndex = draftRef.current.length - 1;
            if (idx < 0 || idx > maxSelectedIndex) return; // 未选的行不可拖
            dragKeyRef.current = key;
            startIndexRef.current = idx;
            targetIndexRef.current = idx;
            dragY.setValue(0);
            setDragKey(key);
          },
          onPanResponderMove: (_e, g) => {
            if (dragKeyRef.current !== key) return;
            dragY.setValue(g.dy);
            const maxSelectedIndex = draftRef.current.length - 1;
            const start = startIndexRef.current;
            const target = clamp(start + Math.round(g.dy / ROW_H), 0, maxSelectedIndex);
            targetIndexRef.current = target;
            for (let j = 0; j < draftRef.current.length; j += 1) {
              const k = draftRef.current[j]!;
              if (k === key) continue;
              let shift = 0;
              if (start < target && j > start && j <= target) shift = -ROW_H;
              else if (start > target && j >= target && j < start) shift = ROW_H;
              anims[k].setValue(shift);
            }
          },
          onPanResponderRelease: () => settleActive(),
          onPanResponderTerminate: () => settleActive(),
        }),
    // anims / ROW_H / tokens 都是稳定引用（anims 由 ref 保证）
    [ROW_H, tokens, anims, dragY],
  );

  const panRespondersRef = useRef<Record<WorkspaceKey, ReturnType<typeof PanResponder.create>> | null>(null);
  if (panRespondersRef.current === null) {
    const map = {} as Record<WorkspaceKey, ReturnType<typeof PanResponder.create>>;
    for (const meta of WORKSPACE_TAB_META) map[meta.key] = makePanResponder(meta.key);
    panRespondersRef.current = map;
  }

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

  /** 无屏读用户的等价操作：把无障碍焦点所在行上移 / 下移一格（配合 accessibilityActions）。 */
  const nudge = (key: WorkspaceKey, dir: -1 | 1): void => {
    const from = draftRef.current.indexOf(key);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= draftRef.current.length) return;
    const next = [...draftRef.current];
    next[from] = next[to]!;
    next[to] = key;
    commit(next);
  };

  const restore = (): void => {
    resetTabBarWorkspaces();
    setDraft([...DEFAULT_TAB_BAR_WORKSPACES]);
    setError(undefined);
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: { gap: tokens['space.4'] },
        card: {
          backgroundColor: tokens['color.surface'],
          borderRadius: tokens['radius.lg'],
          paddingHorizontal: tokens['space.4'],
          paddingVertical: tokens['space.1'],
        },
        track: { position: 'relative' },
        rowAbs: {
          position: 'absolute',
          left: 0,
          right: 0,
          height: ROW_H,
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens['space.3'],
          paddingHorizontal: 0,
        },
        rowInner: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens['space.3'],
        },
        label: { flex: 1 },
        handle: {
          width: tokens['touch-target.min'],
          height: ROW_H,
          alignItems: 'center',
          justifyContent: 'center',
        },
        divider: {
          position: 'absolute',
          left: 0,
          right: 0,
          height: tokens['border-width.hairline'],
          backgroundColor: tokens['color.border'],
        },
        footer: { gap: tokens['space.2'] },
        hint: { color: tokens['color.foreground-muted'] },
      }),
    [tokens, ROW_H],
  );

  return (
    <Screen
      title={t('mobile.tabbarCustomize.title')}
      actions={[{ icon: 'action.back', label: t('mobile.growth.back'), onPress: onBack }]}
      scroll={false}
    >
      <View style={styles.wrap}>
        <Text variant="caption" style={styles.hint} testID="tabbar-customize-hint">
          {t('mobile.tabbarCustomize.hint', { min: MIN_WORKSPACES, max: MAX_WORKSPACES })}
        </Text>

        <View style={styles.card} testID="tabbar-customize-list">
          <View style={[styles.track, { height: display.length * ROW_H }]}>
            {display.map((key, index) => {
              const meta = WORKSPACE_TAB_META.find((m) => m.key === key);
              if (meta === undefined) return null;
              const selected = draft.includes(key);
              const isDragging = dragKey === key;
              const translateY = selected ? (isDragging ? dragY : anims[key]) : 0;
              return (
                <React.Fragment key={key}>
                  {index > 0 ? <View style={[styles.divider, { top: index * ROW_H }]} /> : null}
                  <Animated.View
                    style={[
                      styles.rowAbs,
                      {
                        top: index * ROW_H,
                        transform: [{ translateY }],
                        zIndex: isDragging ? tokens['z.sticky'] : tokens['z.base'],
                      },
                    ]}
                    testID={`tabbar-row-${key}`}
                  >
                    <Pressable
                      accessibilityRole="switch"
                      aria-checked={selected}
                      accessibilityLabel={t(meta.labelKey)}
                      testID={`tabbar-toggle-${key}`}
                      onPress={() => {
                        toggle(key);
                      }}
                      style={styles.rowInner}
                    >
                      <Icon
                        name={meta.icon}
                        size="sm"
                        color={selected ? tokens['color.foreground'] : tokens['color.foreground-muted']}
                      />
                      <Text variant="row-title" style={styles.label} tone={selected ? 'default' : 'muted'}>
                        {t(meta.labelKey)}
                      </Text>
                    </Pressable>
                    <Switch
                      value={selected}
                      onValueChange={() => {
                        toggle(key);
                      }}
                      trackColor={{ false: tokens['color.border'], true: tokens['color.primary'] }}
                      thumbColor={tokens['color.surface']}
                      ios_backgroundColor={tokens['color.border']}
                      testID={`tabbar-switch-${key}`}
                    />
                    {selected ? (
                      <View
                        style={styles.handle}
                        {...panRespondersRef.current![key].panHandlers}
                        accessible
                        accessibilityRole="adjustable"
                        accessibilityLabel={t('mobile.tabbarCustomize.reorder')}
                        accessibilityActions={[
                          { name: 'increment', label: t('mobile.tabbarCustomize.up') },
                          { name: 'decrement', label: t('mobile.tabbarCustomize.down') },
                        ]}
                        onAccessibilityAction={(event) => {
                          if (event.nativeEvent.actionName === 'increment') nudge(key, -1);
                          else if (event.nativeEvent.actionName === 'decrement') nudge(key, 1);
                        }}
                        testID={`tabbar-handle-${key}`}
                      >
                        <GripDots />
                      </View>
                    ) : (
                      <View style={styles.handle} />
                    )}
                  </Animated.View>
                </React.Fragment>
              );
            })}
          </View>
        </View>

        {error === undefined ? null : (
          <Text variant="row-meta" tone="danger" selectable>
            {error}
          </Text>
        )}

        <View style={styles.footer}>
          <Button label={t('mobile.tabbarCustomize.restore')} tone="ghost" onPress={restore} />
        </View>
      </View>
    </Screen>
  );
}
