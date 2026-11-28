/**
 * 专注屏（番茄钟 · 单轴沉浸布局）
 * ================================
 *
 * 🔴 这里**没有一行业务逻辑**（AGENTS.md §3.5）：
 *   - 状态机、进度、"哪一段该落盘" → `@heyta/domain` 的 `focus.ts`
 *   - 专注记录的 op 构造          → `@heyta/app-host` 的 `createFocusActions`
 *   - "什么算待办任务"            → `@heyta/app-host` 的 `listPendingTasks()`
 *   - 计时状态与重绘              → `../lib/focus-timer`
 *   - 文案映射                    → `../lib/focus-display`
 *
 * 界面解剖（对齐 `ux-principles.md` §6b/§11/§12.1 与滴答清单沉浸式计时面）：
 *   1. 单轴居中、整屏不滚动（`scroll={false}`），消除居中环与左对齐卡片的轴线冲突；
 *   2. 顶栏左侧无框下划线分段切换「番茄计时 | 正计时」，右侧仅留「专注统计」与「⋯」；
 *   3. 环正上方居中唯一轻入口 `专注 ›`（已关联时显示 `{任务名} ›`），点开半屏面板选择或搜索任意待办任务；
 *   4. 空闲倒计时态点击中央大数字 `25:00` 直接弹出时长选择（`ChoiceRows` 单选件），零冗余说明文字。
 */

import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type FocusSessionKind, type Task } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { BottomSheet, EmptyState, FocusPanel, focusLogFailureMessageKey } from '@heyta/ui';

import { useTokens } from '../theme';
import { useMobileNavigation } from '../nav/navigation';
import { TopBarMenu, type TopBarMenuItem } from '../ui/top-bar-menu';
import { GrowthScreen } from './GrowthScreen';
import { ChoiceRows, Screen, Stack, Text, TextField } from '../ui/kit';
import { Icon } from '../ui/icons';
import {
  getOpenTaskHostIfReady,
  getTaskHostEpoch,
  openTaskHost,
  subscribeTaskHostEpoch,
} from '../db/open-host';
import { readFocusTaskSource } from '../lib/focus-task-source';
import { useMobileSync } from '../sync/store';
import { onLocalWrite } from '../sync/write-signal';
import {
  abortFocus,
  clearFocusTask,
  getFocusWorkMinutes,
  linkFocusTask,
  pauseFocus,
  resumeFocus,
  selectFocusKind,
  selectFocusMode,
  setFocusWorkMinutes,
  startFocus,
  useFocusTimer,
} from '../lib/focus-timer';
import {
  kindLabel,
  primaryActionLabel,
} from '../lib/focus-display';

const KIND_ORDER: ReadonlyArray<FocusSessionKind> = ['work', 'shortBreak', 'longBreak'];
const SEARCH_THRESHOLD = 5;

export function FocusScreen(): React.JSX.Element {
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const timer = useFocusTimer();
  const { state } = timer;
  const navigation = useMobileNavigation();

  const [statsOpen, setStatsOpen] = useState(false);
  const [targetOpen, setTargetOpen] = useState(false);
  const [durationOpen, setDurationOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [taskQuery, setTaskQuery] = useState('');

  const styles = useMemo(
    () =>
      StyleSheet.create({
        segmentBar: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens['space.5'],
        },
        segmentTab: {
          minHeight: tokens['touch-target.min'],
          justifyContent: 'center',
          alignItems: 'center',
          position: 'relative',
        },
        segmentIndicator: {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: tokens['space.1'],
          height: tokens['border-width.thick'],
          borderRadius: tokens['radius.full'],
          backgroundColor: tokens['color.primary'],
        },
        targetTrigger: {
          minHeight: tokens['touch-target.min'],
          maxWidth: '80%',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: tokens['space.1'],
          paddingHorizontal: tokens['space.3'],
          borderRadius: tokens['radius.full'],
        },
        targetReadonly: {
          maxWidth: '80%',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: tokens['space.3'],
        },
        disabledTab: {
          opacity: tokens['state.disabled-opacity'],
        },
      }),
    [tokens],
  );

  const [tasks, setTasks] = useState<Task[]>([]);
  const [pendingTasks, setPendingTasks] = useState<Task[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { dataRevision } = useMobileSync();

  const refresh = useCallback(() => {
    const source = readFocusTaskSource(getOpenTaskHostIfReady);
    setTasks(source.tasks);
    setPendingTasks(source.pendingTasks);
  }, []);

  const hostEpoch = useSyncExternalStore(
    subscribeTaskHostEpoch,
    getTaskHostEpoch,
    getTaskHostEpoch,
  );

  useEffect(() => {
    let alive = true;
    void openTaskHost()
      .then(() => {
        if (alive) refresh();
      })
      .catch((error: unknown) => {
        if (alive) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      alive = false;
    };
  }, [refresh, hostEpoch]);

  useEffect(() => {
    refresh();
  }, [refresh, timer.savedAt, dataRevision]);

  useEffect(() => onLocalWrite(refresh), [refresh]);

  const linkedTask = useMemo(
    () => (state.taskId === undefined ? undefined : tasks.find((task) => task.id === state.taskId)),
    [tasks, state.taskId],
  );

  const filteredTasks = useMemo(() => {
    const needle = taskQuery.trim().toLowerCase();
    if (needle === '') return pendingTasks;
    return pendingTasks.filter((task) => task.title.toLowerCase().includes(needle));
  }, [pendingTasks, taskQuery]);

  const taskOptions = useMemo(
    () => [
      { key: '', label: t('mobile.focus.task.none') },
      ...filteredTasks.map((task) => ({ key: task.id, label: task.title })),
    ],
    [filteredTasks, t],
  );

  const durationOptions = useMemo(
    () =>
      [15, 25, 45, 60].map((m) => ({
        key: String(m),
        label: t('mobile.focus.durationPreset.minutes', { n: m }),
      })),
    [t],
  );

  const idle = state.phase === 'idle';
  const targetTitle = linkedTask?.title ?? kindLabel(state.kind, t);

  const moreItems = useMemo((): readonly TopBarMenuItem[] => {
    const idleItems: TopBarMenuItem[] =
      idle && state.mode === 'countdown'
        ? [
            {
              id: 'kind',
              label: t('mobile.focus.title'),
              value: kindLabel(state.kind, t),
              icon: 'focus.work',
              children: KIND_ORDER.map((kind) => ({
                key: kind,
                label: kindLabel(kind, t),
                selected: state.kind === kind,
                onSelect: () => {
                  selectFocusKind(kind);
                  setMoreOpen(false);
                },
              })),
            },
            {
              id: 'duration',
              label: t('mobile.focus.action.duration'),
              icon: 'task.due',
              onPress: () => {
                setMoreOpen(false);
                setDurationOpen(true);
              },
            },
            {
              id: 'reset',
              label: t('mobile.focus.action.resetDuration'),
              icon: 'action.sync',
              groupEnd: true,
              onPress: () => {
                setFocusWorkMinutes(25);
                setMoreOpen(false);
              },
            },
          ]
        : [];
    return [
      ...idleItems,
      {
        id: 'settings',
        label: t('mobile.focus.action.settings'),
        icon: 'action.settings',
        onPress: () => {
          setMoreOpen(false);
          navigation.setTab('profile');
        },
      },
    ];
  }, [idle, navigation, state.kind, state.mode, t]);

  const saveFailedKey =
    focusLogFailureMessageKey(timer.error?.code) ?? 'mobile.focus.error.saveFailed';
  const errorText =
    timer.error !== undefined
      ? t(saveFailedKey, { reason: timer.error.reason })
      : loadError !== null
        ? t('mobile.focus.error.openFailed', { reason: loadError })
        : undefined;

  const targetHeader = idle ? (
    <Pressable
      testID="focus-target-trigger"
      accessibilityRole="button"
      accessibilityLabel={
        linkedTask !== undefined
          ? t('mobile.focus.a11y.linkTask', { title: linkedTask.title })
          : t('mobile.focus.linkedTask')
      }
      onPress={() => {
        setTaskQuery('');
        setTargetOpen(true);
      }}
      style={styles.targetTrigger}
    >
      <Text variant="row-title" numberOfLines={1}>
        {targetTitle}
      </Text>
      <Icon name="action.disclose" size="sm" color={tokens['color.foreground-subtle']} />
    </Pressable>
  ) : (
    <View style={styles.targetReadonly}>
      <Text variant="row-title" tone="muted" numberOfLines={1}>
        {targetTitle}
      </Text>
    </View>
  );

  return (
    <Screen
      title=""
      scroll={false}
      background="surface"
      actions={[
        {
          icon: 'tab.categories',
          label: t('mobile.focus.action.stats'),
          testID: 'focus-action-stats',
          onPress: () => {
            setStatsOpen(true);
          },
        },
        {
          icon: 'action.more',
          label: t('mobile.focus.action.more'),
          testID: 'focus-action-more',
          onPress: () => {
            setMoreOpen(true);
          },
        },
      ]}
      titleLeading={
        <View
          style={styles.segmentBar}
          accessibilityRole="tablist"
          accessibilityLabel={t('mobile.focus.mode.group')}
        >
          {(['countdown', 'countup'] as const).map((mode) => {
            const selected = state.mode === mode;
            const label =
              mode === 'countdown'
                ? t('mobile.focus.segment.pomodoro')
                : t('mobile.focus.segment.countup');
            return (
              <Pressable
                key={mode}
                testID={`focus-segment-${mode}`}
                accessibilityRole="tab"
                aria-selected={selected}
                accessibilityLabel={label}
                disabled={!idle}
                onPress={() => {
                  if (idle) selectFocusMode(mode);
                }}
                style={[styles.segmentTab, !idle && !selected ? styles.disabledTab : null]}
              >
                <Text variant="headline" tone={selected ? 'default' : 'muted'}>
                  {label}
                </Text>
                {selected ? <View style={styles.segmentIndicator} /> : null}
              </Pressable>
            );
          })}
        </View>
      }
    >
      <FocusPanel
        state={state}
        now={timer.now}
        fill
        header={targetHeader}
        onTimePress={() => {
          setDurationOpen(true);
        }}
        timePressA11y={t('mobile.focus.action.duration')}
        labels={{
          phase: (s) =>
            s.phase === 'paused'
              ? t('mobile.focus.phase.paused')
              : s.phase === 'running' && s.kind !== 'work'
                ? t('mobile.focus.phase.breaking')
                : undefined,
          primary: (action, s) => primaryActionLabel(action, s, t),
          primaryA11y: (action, s) => primaryActionLabel(action, s, t),
          abort: t('mobile.focus.abort'),
          ring: (percent) => t('mobile.focus.a11y.progress', { percent }),
          ...(errorText === undefined ? {} : { error: errorText }),
        }}
        onStart={() => {
          startFocus(state.taskId);
        }}
        onPause={pauseFocus}
        onResume={resumeFocus}
        onAbort={() => {
          void abortFocus();
        }}
      />

      <Modal
        visible={statsOpen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => {
          setStatsOpen(false);
        }}
      >
        <GrowthScreen
          onBack={() => {
            setStatsOpen(false);
          }}
          onOpenHabits={() => {
            setStatsOpen(false);
          }}
        />
      </Modal>

      <BottomSheet
        visible={targetOpen}
        title={t('mobile.focus.linkedTask')}
        labels={{
          close: t('mobile.settings.close'),
          expand: t('mobile.detail.sheet.expand'),
          collapse: t('mobile.detail.sheet.collapse'),
        }}
        onDismiss={() => {
          setTargetOpen(false);
        }}
        detents={['medium', 'large']}
        defaultDetent="medium"
        bottomInset={insets.bottom}
        testID="focus-target-sheet"
      >
        <Stack gap="default">
          {pendingTasks.length > SEARCH_THRESHOLD ? (
            <TextField
              label={t('mobile.focus.task.search')}
              value={taskQuery}
              onChangeText={setTaskQuery}
              testID="focus-target-search"
            />
          ) : null}

          {pendingTasks.length === 0 ? (
            <EmptyState
              size="section"
              title={t('mobile.focus.task.empty')}
              testID="focus-target-empty"
            />
          ) : filteredTasks.length === 0 ? (
            <EmptyState
              size="section"
              title={t('mobile.focus.task.empty')}
              testID="focus-target-no-match"
            />
          ) : (
            <ChoiceRows
              value={state.taskId ?? ''}
              options={taskOptions}
              onChange={(next) => {
                if (next === '') clearFocusTask();
                else linkFocusTask(next);
                setTargetOpen(false);
              }}
              testID="focus-target-choices"
            />
          )}
        </Stack>
      </BottomSheet>

      <BottomSheet
        visible={durationOpen}
        title={t('mobile.focus.durationPreset.title')}
        labels={{
          close: t('mobile.settings.close'),
          expand: t('mobile.detail.sheet.expand'),
          collapse: t('mobile.detail.sheet.collapse'),
        }}
        onDismiss={() => {
          setDurationOpen(false);
        }}
        detents={['small', 'medium']}
        defaultDetent="small"
        bottomInset={insets.bottom}
        testID="focus-duration-sheet"
      >
        <ChoiceRows
          value={String(getFocusWorkMinutes())}
          options={durationOptions}
          onChange={(next) => {
            setFocusWorkMinutes(Number(next));
            setDurationOpen(false);
          }}
          testID="focus-duration-choices"
        />
      </BottomSheet>

      <TopBarMenu
        visible={moreOpen}
        label={t('mobile.focus.action.more')}
        onClose={() => {
          setMoreOpen(false);
        }}
        items={moreItems}
      />
    </Screen>
  );
}
