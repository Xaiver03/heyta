/**
 * 专注屏（番茄钟）
 * ==================
 *
 * 🔴 这里**没有一行业务逻辑**（AGENTS.md §3.5）：
 *   - 状态机、进度、"哪一段该落盘" → `@heyta/domain` 的 `focus.ts`
 *   - 专注记录的 op 构造          → `@heyta/app-host` 的 `createFocusActions`
 *   - "什么算待办任务"            → `@heyta/app-host` 的 `listPendingTasks()`
 *   - 计时状态与重绘              → `../lib/focus-timer`
 *   - 文案映射                    → `../lib/focus-display`
 *
 * 本文件只负责**把上面这些拼成界面**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 三个刻意的产品决定：
 *
 * 1. **倒计时不靠累减。** 剩余时间由 `remainingMs(state, now)` 从结束时间戳重算，
 *    定时器只负责唤醒重绘。手机锁屏、切后台、系统降频下都准。
 *
 * 2. **"放弃"是独立按钮，且不叫"停止"。** 中止会留下一条 `completed: false`
 *    的记录（真实坐下来的时间是有效数据），而按钮文案必须让用户按下去之前
 *    就知道这一点。主按钮在运行中叫「暂停」—— 它不会丢进度。
 *
 * 3. **类型选择只在空闲时出现。** 计时中途改类型会让 `plannedMs` 与已过去的
 *    进度对不上（领域层的 `selectKind` 也拒绝在运行中生效，见那里的注释）。
 *    界面不显示，领域层也拦一道 —— 两处都做，是因为界面可能被将来别的入口绕过。
 * ─────────────────────────────────────────────────────────────────────────
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View, type DimensionValue } from 'react-native';

import {
  focusDisplayMs,
  focusProgress,
  focusStatsForDay,
  formatDuration,
  type FocusSession,
  type FocusSessionKind,
  type FocusState,
  type Task,
} from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { createFocusActions, createTaskActions, type AppHost } from '@heyta/app-host';

import { useText, useTokens } from '../theme';
import { Button, Card, Chip, Screen, SectionHeader, Text } from '../ui/kit';
import { Icon } from '../ui/icons';
import { openTaskHost } from '../db/open-host';
import { useMobileSync } from '../sync/store';
import {
  FOCUS_CONFIG,
  abortFocus,
  clearFocusTask,
  pauseFocus,
  resumeFocus,
  selectFocusKind,
  startFocus,
  useFocusTimer,
} from '../lib/focus-timer';
import {
  formatFocusDurationText,
  kindDurationLabel,
  kindLabel,
  phaseColorToken,
  phaseLabel,
  primaryActionIcon,
  primaryActionLabel,
} from '../lib/focus-display';

/** 类型选择的顺序。专注在前 —— 它是默认，也是绝大多数时候要点的那个。 */
const KIND_ORDER: ReadonlyArray<FocusSessionKind> = ['work', 'shortBreak', 'longBreak'];

/**
 * 待办任务最多列几个。
 *
 * 5 而不是把全部列出来：专注页的任务选择是**快捷入口**，不是任务列表 ——
 * 要翻找全部待办，那是「任务」页的事。列太长会把计时卡挤出第一屏。
 */
const MAX_PICKER_TASKS = 5;

// ─────────────────────────────────────────────────────────────
// 计时卡
// ─────────────────────────────────────────────────────────────

function TimerCard({ now, state }: { now: number; state: FocusState }): React.JSX.Element {
  const tokens = useTokens();
  const { t } = useI18n();
  const color = tokens[phaseColorToken(state)];
  // 空闲时显示的是**这一轮的长度**（25:00），不是 00:00 —— 见 `focusDisplayMs`。
  const shown = focusDisplayMs(state, now);
  const progress = focusProgress(state, now);

  /**
   * 进度条填充宽度。
   *
   * ⚠️ 这里的 `as DimensionValue` 是**准确的窄化**，不是拿来消音的强转：
   * 这个字符串一定由 `Math.round()` 产出，形态必然是 `${number}%`，
   * 而 TypeScript 不会把模板拼接的结果推断成那个字面量类型。
   * （AGENTS.md §7 第 14 条警告的是用强转**掩盖接口缺失**，不是这种。）
   */
  const fillWidth = `${String(Math.round(progress * 100))}%` as DimensionValue;

  return (
    <Card>
      <View style={{ alignItems: 'center', gap: tokens['space.3'] }}>
        <Text variant="row-meta" style={{ color }}>
          {phaseLabel(state, t)}
        </Text>

        {/* 大号倒计时。`numeric-display` 带 `tabular-nums` ——
            数字等宽，否则秒数跳动时整块会左右抖。 */}
        <Text variant="numeric-display" style={{ color }}>
          {formatDuration(shown)}
        </Text>

        {/* 进度条。轨道色用已有的 `color.surface-sunken`，填充色跟随阶段。 */}
        <View
          style={{
            width: '100%',
            height: tokens['size.progress-height'],
            borderRadius: tokens['radius.full'],
            backgroundColor: tokens['color.surface-sunken'],
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: fillWidth,
              height: '100%',
              backgroundColor: color,
            }}
          />
        </View>

        <Text variant="caption" tone="subtle">
          {t('mobile.focus.roundLength', {
            duration: kindDurationLabel(state.kind, FOCUS_CONFIG, t),
          })}
        </Text>
      </View>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
// 待办任务选择
// ─────────────────────────────────────────────────────────────

function TaskChoice({
  task,
  selected,
  onPress,
}: {
  task: Task;
  selected: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const tokens = useTokens();
  const { t } = useI18n();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={t('mobile.focus.a11y.linkTask', { title: task.title })}
      style={({ pressed }) => ({
        minHeight: tokens['size.row-min-height'],
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens['space.2'],
        paddingHorizontal: tokens['space.3'],
        borderRadius: tokens['radius.md'],
        // 选中态同时改**边框**与底色，不只改颜色 ——
        // 只改颜色的话色觉障碍用户看不出选中了哪一个（UIX Pro 第 1 条）。
        borderWidth: selected ? tokens['border-width.thick'] : tokens['border-width.thin'],
        borderColor: selected ? tokens['color.primary'] : tokens['color.border'],
        backgroundColor: selected
          ? tokens['color.primary-subtle']
          : pressed
            ? tokens['color.surface-sunken']
            : tokens['color.surface'],
      })}
    >
      <Icon
        name="task.done"
        size="sm"
        color={selected ? tokens['color.primary'] : tokens['color.border-strong']}
      />
      <Text variant="row-title" style={{ flex: 1 }} numberOfLines={1}>
        {task.title}
      </Text>
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────
// 统计
// ─────────────────────────────────────────────────────────────

function StatRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  const tokens = useTokens();
  const text = useText();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: tokens['space.3'],
      }}
    >
      <Text variant="row-meta" tone="muted">
        {label}
      </Text>
      {/* 值用等宽数字：统计数字变化时不该左右抖。 */}
      <Text variant="numeric-body">{value}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// 屏幕
// ─────────────────────────────────────────────────────────────

export function FocusScreen(): React.JSX.Element {
  const tokens = useTokens();
  const { t } = useI18n();
  const timer = useFocusTimer();
  const { state } = timer;

  const [host, setHost] = useState<AppHost | null>(null);
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  /** 全部未删除任务 —— 用来**显示**已关联任务的名字。 */
  const [tasks, setTasks] = useState<Task[]>([]);
  /** 未完成任务 —— 只用它填选择列表。 */
  const [pendingTasks, setPendingTasks] = useState<Task[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 同步完成 → `dataRevision` 变 → 下面的 effect 重读物化状态。
  const { dataRevision } = useMobileSync();

  useEffect(() => {
    let alive = true;
    void openTaskHost()
      .then((opened) => {
        if (alive) setHost(opened);
      })
      .catch((error: unknown) => {
        if (alive) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(() => {
    if (host === null) return;
    // 三个都是**同步**读物化状态（不是 Promise）。
    const taskActions = createTaskActions(host);
    setSessions(createFocusActions(host).listSessions());
    setTasks(taskActions.listTasks());
    setPendingTasks(taskActions.listPendingTasks());
  }, [host]);

  useEffect(() => {
    refresh();
    // 🔴 依赖里必须有 `timer.savedAt`：落盘是异步的，没有它的话
    // "今天专注了几段"会停在旧值上，看起来像记录没保存。
    // `dataRevision`：同步完成后也要重读 —— 别的设备上的专注记录同步下来时，
    // 本屏同样需要看见（与任务屏/日历屏同一种毛病，见 `sync/store.ts`）。
  }, [refresh, timer.savedAt, dataRevision]);

  const stats = useMemo(
    () => focusStatsForDay(sessions, timer.now),
    [sessions, timer.now],
  );

  /**
   * 已关联的任务。
   *
   * ⚠️ 从**全部任务**里找，不是从待办里找：任务在关联之后被完成（很常见 ——
   * 边专注边把这件事做完了），从待办里找就会找不到，界面随即退回选择列表，
   * 看起来像"关联丢了"。
   */
  const linkedTask = useMemo(
    () => (state.taskId === undefined ? undefined : tasks.find((task) => task.id === state.taskId)),
    [tasks, state.taskId],
  );

  const onPrimary = useCallback(() => {
    if (state.phase === 'running') {
      pauseFocus();
    } else if (state.phase === 'paused') {
      resumeFocus();
    } else {
      startFocus(state.taskId);
    }
  }, [state.phase, state.taskId]);

  const onAbort = useCallback(() => {
    void abortFocus();
  }, []);

  /**
   * 错误**句子**在壳里拼，不在 store 里。
   *
   * `lib/focus-timer.ts` 是纯 store，拿不到 `t`，它只带**原因**（底层实现的
   * 原始文本，是数据）；句子来自词条表。反过来做的话英文界面会漏出中文。
   * 两条失败路径（落盘、打开本地库）各有自己的句子，别合并成一句含糊的。
   */
  const errorText =
    timer.error !== undefined
      ? t('mobile.focus.error.saveFailed', { reason: timer.error.reason })
      : loadError !== null
        ? t('mobile.focus.error.openFailed', { reason: loadError })
        : undefined;

  return (
    <Screen title={t('mobile.focus.title')}>
      <TimerCard now={timer.now} state={state} />

      <View style={{ flexDirection: 'row', gap: tokens['space.2'] }}>
        <Button
          label={primaryActionLabel(state, t)}
          icon={primaryActionIcon(state)}
          tone="primary"
          onPress={onPrimary}
          style={{ flex: 1 }}
        />
        {/* 只有真的在计时才给"放弃" —— 空闲时它没有可放弃的东西。 */}
        {state.phase !== 'idle' ? (
          <Button
            label={t('mobile.focus.abort')}
            icon="focus.abort"
            tone="ghost"
            onPress={onAbort}
          />
        ) : null}
      </View>

      {/* 落盘失败必须看得见。静默的话用户会以为记录存下了。 */}
      {errorText !== undefined ? (
        <Card>
          <Text variant="row-meta" tone="danger">
            {errorText}
          </Text>
        </Card>
      ) : null}

      {/* 类型选择只在空闲时出现 —— 见文件头第 3 条。 */}
      {state.phase === 'idle' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.2'] }}>
          {KIND_ORDER.map((kind) => (
            <Chip
              key={kind}
              label={kindLabel(kind, t)}
              selected={state.kind === kind}
              onPress={() => {
                selectFocusKind(kind);
              }}
            />
          ))}
        </View>
      ) : null}

      <SectionHeader icon="focus.link" title={t('mobile.focus.linkedTask')} />
      <Card>
        {linkedTask !== undefined ? (
          <View style={{ gap: tokens['space.2'] }}>
            <Text variant="row-title" numberOfLines={2}>
              {linkedTask.title}
            </Text>
            {/* 计时中不给换/不给解除：那一轮的归属已经定了，
                中途改会让落盘时读到的 taskId 与用户看到的界面不一致。 */}
            {state.phase === 'idle' ? (
              <Button
                label={t('mobile.focus.changeTask')}
                tone="ghost"
                icon="action.close"
                onPress={clearFocusTask}
              />
            ) : null}
          </View>
        ) : pendingTasks.length === 0 ? (
          <Text variant="row-meta" tone="subtle">
            {t('mobile.focus.noPending')}
          </Text>
        ) : (
          <View style={{ gap: tokens['space.1'] }}>
            {pendingTasks.slice(0, MAX_PICKER_TASKS).map((task) => (
              <TaskChoice
                key={task.id}
                task={task}
                selected={state.taskId === task.id}
                onPress={() => {
                  // 选中即开始。少一步点击：用户点任务名的意图就是"现在做这个"。
                  startFocus(task.id);
                }}
              />
            ))}
          </View>
        )}
      </Card>

      <SectionHeader icon="focus.stats" title={t('mobile.common.today')} />
      <Card>
        <StatRow
          label={t('mobile.focus.stats.completed')}
          value={t('mobile.focus.stats.completedValue', { count: stats.completedWorkCount })}
        />
        <StatRow
          label={t('mobile.focus.stats.focusDuration')}
          value={formatFocusDurationText(stats.focusMs, t)}
        />
        {/* 放弃次数只在真的发生过时才显示 —— 一行常年的「0 次」不传达任何信息。 */}
        {stats.abortedWorkCount > 0 ? (
          <StatRow
            label={t('mobile.focus.stats.aborted')}
            value={t('mobile.focus.stats.abortedValue', { count: stats.abortedWorkCount })}
          />
        ) : null}
      </Card>
    </Screen>
  );
}
