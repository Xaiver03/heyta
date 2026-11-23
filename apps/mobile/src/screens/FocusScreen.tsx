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
 * 🔴 **M3 第二刀之后，计时界面本身也不在这里了** —— 进度环、倒计时、阶段、
 * 主按钮 / 中止按钮全部来自 `@heyta/ui` 的共享 `FocusPanel`，与 web 端
 * **是同一份实现**。这个文件只负责"壳"：把面板放上去，再挂上两端各自
 * 才有的东西（类型胶囊、关联任务选择、今日统计卡）。
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

import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type FocusSessionKind, type Task } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { BottomSheet, FocusPanel, focusLogFailureMessageKey } from '@heyta/ui';
import { focusOverview, type AppHost, type FocusOverview } from '@heyta/app-host';

import { useText, useTokens } from '../theme';
import { useMobileNavigation } from '../nav/navigation';
import { TopBarMenu } from '../ui/top-bar-menu';
import { GrowthScreen } from './GrowthScreen';
import { Button, Card, Chip, HStack, Screen, SectionHeader, Text } from '../ui/kit';
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
  getFocusConfig,
  getFocusWorkMinutes,
  setFocusWorkMinutes,
  abortFocus,
  clearFocusTask,
  pauseFocus,
  resumeFocus,
  selectFocusKind,
  selectFocusMode,
  startFocus,
  useFocusTimer,
} from '../lib/focus-timer';
import {
  formatFocusDurationText,
  kindDurationLabel,
  kindLabel,
  phaseLabel,
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
        // 选中态用底色与图标语义表达，不给每个选项套一层框。
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
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const timer = useFocusTimer();
  const { state } = timer;
  const navigation = useMobileNavigation();
  const [statsOpen, setStatsOpen] = useState(false);
  const [durationOpen, setDurationOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const styles = useMemo(
    () =>
      StyleSheet.create({
        chips: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.2'] },
        gap2: { gap: tokens['space.2'] },
        gap1: { gap: tokens['space.1'] },
        statCell: { flex: 1, alignItems: 'center', gap: tokens['space.1'] },
      }),
    [tokens],
  );

  /**
   * 🔴 宿主**不进 state**。
   *
   * 它是"当前这一代的连接"，不是本屏的数据。存进 `useState` 就等于存了一个快照：
   * 换代（本机数据被销毁）之后它还是旧那一份，而 `setHost` 只在 `refresh()` 里被调 ——
   * 那条路正是"用户点进来才刷新"，于是本屏会拿着已作废的 adapter 去算专注概览。
   * 现在改成渲染时经 `getOpenTaskHostIfReady()` 现读，`hostEpoch` 负责在换代时重渲染。
   */
  /** 全部未删除任务 —— 用来**显示**已关联任务的名字。 */
  const [tasks, setTasks] = useState<Task[]>([]);
  /** 专注概览（「今天」那两格）。由 `refresh()` 在宿主就绪后写入，见那里的注释。 */
  const [overview, setOverview] = useState<FocusOverview | null>(null);
  /** 未完成任务 —— 只用它填选择列表。 */
  const [pendingTasks, setPendingTasks] = useState<Task[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 同步完成 → `dataRevision` 变 → 下面的 effect 重读物化状态。
  const { dataRevision } = useMobileSync();

  const refresh = useCallback(() => {
    const source = readFocusTaskSource(getOpenTaskHostIfReady);
    setTasks(source.tasks);
    setPendingTasks(source.pendingTasks);
    /**
     * 🔴 2026-11-15：**长期活在 `useMemo` 里的 overview 是这个 bug 的根**。
     *
     * `openTaskHost()` 成功之后只做 `resolvedHost = host`，**不 bump `hostEpoch`**
     * （`db/open-host.ts:269` 附近）。而 overview 的 memo 依赖的是
     * `[hostEpoch, timer.now, timer.savedAt, dataRevision]` —— 冷启动首帧
     * 宿主还没打开 ⇒ `getOpenTaskHostIfReady()` 是 `undefined` ⇒ 记下 `null`；
     * 之后宿主打开，四个依赖一个都没变 ⇒ **memo 永远不再算**。
     *
     * 真机症状：专注页「今天」只剩一个标题，下面什么都没有（`overview === null`），
     * 而同一屏的「关联任务」列表已经有数据（那条路走的是 `setTasks`，不是 memo）。
     * 跟着 `refresh()` 一起算，宿主一就绪这张卡就会出现。
     */
    const current = getOpenTaskHostIfReady();
    setOverview(current === undefined ? null : focusOverview(current, Date.now()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 🔴 宿主换代（本机数据被销毁）之后必须重取。
   *
   * 本屏与其它屏不同：它的 `host` 不是从 `openTaskHost()` 的返回值存下来的，
   * 而是 `refresh()` 里经 `readFocusTaskSource(getOpenTaskHostIfReady)` 现读的。
   * 所以"换代"这件事必须变成一个**依赖项**，否则那个 effect 一辈子只跑一次 ——
   * 擦除之后 `getOpenTaskHostIfReady()` 长期是 `undefined`，本屏停在空数据上，
   * 而用户看到的是一句"没有专注记录"（假的事实，不是错误）。
   */
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
    // 🔴 依赖里必须有 `timer.savedAt`：落盘是异步的，没有它的话
    // "今天专注了几段"会停在旧值上，看起来像记录没保存。
    // `dataRevision`：同步完成后也要重读 —— 别的设备上的专注记录同步下来时，
    // 本屏同样需要看见（与任务屏/日历屏同一种毛病，见 `sync/store.ts`）。
  }, [refresh, timer.savedAt, dataRevision]);

  // 标签切换只隐藏本屏，不会重新挂载。成功落库后重读，避免本机新任务
  // 要等同步或完成一轮专注才出现在任务选择器里。
  useEffect(() => onLocalWrite(refresh), [refresh]);

  /*
   * 🔴 工单 W7 判据 ③：这一屏的"今日专注时长 / 今日番茄"与 web 那一栏
   * **必须来自同一个出口** —— 所以这里调 `focusOverview`，不再自己
   * `focusStatsForDay(本地快照, now)`。
   *
   * 原来那一份是"同一个口径写两遍"的形状：本屏自己 `listSessions()` 存一份
   * state、再自己汇总，而 web 的 store 里还有另一份同样的推导。两端口径一旦
   * 分叉，症状是"手机说今天 4 个番茄、网页说 3 个"，且没有任何一层报错
   * （AGENTS §3.5）。现在两端都只剩一次转调。
   *
   * ⚠️ 依赖里 `dataRevision` 与 `timer.savedAt` 都在：前者让"别的设备同步下来的
   * 记录"进得来，后者让"刚落盘的那一轮"立刻可见 —— 少了任何一个，
   * 数字会停在旧值上，看起来像记录没保存。
   */

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

  /**
   * 错误**句子**在壳里拼，不在 store 里。
   *
   * `lib/focus-timer.ts` 是纯 store，拿不到 `t`，它只带**原因**（底层实现的
   * 原始文本，是数据）；句子来自词条表。反过来做的话英文界面会漏出中文。
   * 两条失败路径（落盘、打开本地库）各有自己的句子，别合并成一句含糊的。
   *
   * 🔴 落盘失败里能**认出码**的那三种（类型不认识 / 时长不是正数 / 缺产生时间）
   * 走共用词条（`common.focus.error.*`，Web 端用的是同一条）—— 它们自己就说清了
   * 原因，不该把内部诊断串摆给用户。认不出码的异常才带上 `{reason}`。
   */
  const saveFailedKey =
    focusLogFailureMessageKey(timer.error?.code) ?? 'mobile.focus.error.saveFailed';
  const errorText =
    timer.error !== undefined
      ? t(saveFailedKey, { reason: timer.error.reason })
      : loadError !== null
        ? t('mobile.focus.error.openFailed', { reason: loadError })
        : undefined;

  return (
    <Screen
      title={t('mobile.focus.title')}
      actions={[
        { icon: 'tab.categories', label: t('mobile.focus.action.stats'), onPress: () => { setStatsOpen(true); } },
        { icon: 'task.add', label: t('mobile.focus.action.duration'), onPress: () => { setDurationOpen(true); } },
        { icon: 'action.more', label: t('mobile.focus.action.more'), onPress: () => { setMoreOpen(true); } },
      ]}
      titleLeading={
        <HStack gap="default">
          <Chip label={t('mobile.focus.segment.pomodoro')} selected={state.mode === 'countdown'} onPress={() => { if (state.phase === 'idle') selectFocusMode('countdown'); }} />
          <Chip label={t('mobile.focus.segment.countup')} selected={state.mode === 'countup'} onPress={() => { if (state.phase === 'idle') selectFocusMode('countup'); }} />
        </HStack>
      }
    >
      {/*
        🔴 计时核心是**共享的**（`@heyta/ui`）—— 这里只注入文案与回调。
        进度环、倒计时、阶段、主按钮 / 中止按钮的骨架不在这份文件里，
        与 web 端是同一份实现（M3 第二刀）。
      */}
      <FocusPanel
        state={state}
        now={timer.now}
        // 手机的内容区有确定宽度：主按钮撑满才够按（见 FocusPanel 的说明）。
        fillControls
        labels={{
          phase: (s) => phaseLabel(s, t),
          // 文案跟着**共享层给出的动作**走，不在这里从 phase 再推一遍。
          primary: (action, s) => primaryActionLabel(action, s, t),
          primaryA11y: (action, s) => primaryActionLabel(action, s, t),
          abort: t('mobile.focus.abort'),
          ring: (percent) => t('mobile.focus.a11y.progress', { percent }),
          roundLength: t('mobile.focus.roundLength', {
            duration: kindDurationLabel(state.kind, getFocusConfig(), t),
          }),
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

      {/* 类型选择只在空闲时出现 —— 见文件头第 3 条。 */}
      {state.phase === 'idle' ? (
        <View style={styles.chips}>
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

      <SectionHeader title={t('mobile.focus.linkedTask')} />
      {/*
        🔴 2026-11-15：**没有待办任务时不画那张卡**。
        原来无论如何都包一层 `Card`，于是"现在没有待办任务"这句话住在一张
        高 88dp 的白底卡片正中 —— 产品负责人原话「关联任务下面有个框，整个框
        非常高，却只放了一个很简单的文字，这个空状态就很丑很丑」。
        空态本来就是一句提示，不需要容器；有内容时卡片仍然在。
      */}
      {linkedTask === undefined && pendingTasks.length === 0 ? (
        <Text variant="row-meta" tone="subtle">
          {t('mobile.focus.noPending')}
        </Text>
      ) : (
      <Card>
        {linkedTask !== undefined ? (
          <View style={styles.gap2}>
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
          <View style={styles.gap1}>
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
      )}

      <SectionHeader title={t('mobile.common.today')} />
      {overview === null ? null : (
        <Card>
          {/*
            🔴 2026-11-15：两行「标签 ……… 值」改成**两格横排**。
            产品负责人看这一屏：「关联任务下面有个框，整个框非常高，却只放了一个
            很简单的文字」。原来 Card 里是两枚 `StatRow`（各 24dp）＋ 上下 padding，
            一块 120dp 的白底上只有两行 14px 小字 —— 高度全花在留白上。
            横排两格把数字放到 `headline` 档（同步「我的」页的近期状态卡）：
            同样的信息，一张卡里一眼读完，纵向空间反而更省。
          */}
          <HStack gap="default">
            <View style={styles.statCell} testID="focus-today-completed">
              <Text variant="headline">{t('mobile.focus.stats.completedValue', { count: overview.todayCount })}</Text>
              <Text variant="caption" tone="subtle">{t('mobile.focus.stats.completed')}</Text>
            </View>
            <View style={styles.statCell} testID="focus-today-duration">
              <Text variant="headline">{formatFocusDurationText(overview.todayFocusMs, t)}</Text>
              <Text variant="caption" tone="subtle">{t('mobile.focus.stats.focusDuration')}</Text>
            </View>
          </HStack>
          {/* 放弃次数只在真的发生过时才显示 —— 一行常年的「0 次」不传达任何信息。 */}
          {overview.todayAbortedCount > 0 ? (
            <Text variant="caption" tone="subtle">
              {`${t('mobile.focus.stats.aborted')} ${t('mobile.focus.stats.abortedValue', { count: overview.todayAbortedCount })}`}
            </Text>
          ) : null}
        </Card>
      )}
      <Modal visible={statsOpen} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => { setStatsOpen(false); }}>
        <GrowthScreen onBack={() => { setStatsOpen(false); }} onOpenHabits={() => { setStatsOpen(false); }} />
      </Modal>

      <BottomSheet
        visible={durationOpen}
        title={t('mobile.focus.durationPreset.title')}
        labels={{
          close: t('mobile.settings.close'),
          expand: t('mobile.detail.sheet.expand'),
          collapse: t('mobile.detail.sheet.collapse'),
        }}
        onDismiss={() => { setDurationOpen(false); }}
        detents={['small', 'medium']}
        defaultDetent="small"
        bottomInset={insets.bottom}
        testID="focus-duration-sheet"
      >
        <View style={styles.chips}>
          {[15, 25, 45, 60].map((m) => (
            <Chip
              key={m}
              label={t('mobile.focus.durationPreset.minutes', { n: m })}
              selected={getFocusWorkMinutes() === m}
              onPress={() => { setFocusWorkMinutes(m); setDurationOpen(false); }}
            />
          ))}
        </View>
      </BottomSheet>

      <TopBarMenu
        visible={moreOpen}
        label={t('mobile.focus.action.more')}
        onClose={() => { setMoreOpen(false); }}
        items={[
          { id: 'stats', label: t('mobile.focus.action.stats'), icon: 'tab.categories', onPress: () => { setMoreOpen(false); setStatsOpen(true); } },
          { id: 'settings', label: t('mobile.focus.action.settings'), icon: 'action.settings', onPress: () => { setMoreOpen(false); navigation.setTab('profile'); } },
          { id: 'reset', label: t('mobile.focus.action.resetDuration'), icon: 'action.settings', onPress: () => { setFocusWorkMinutes(25); setMoreOpen(false); } },
        ]}
      />
    </Screen>
  );
}
