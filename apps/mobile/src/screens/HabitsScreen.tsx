/**
 * 「习惯」—— 移动端的习惯打卡屏
 * ================================
 *
 * 🔴 这是 M3 第七刀（habits）的**移动端那一半**：在此之前移动端**一行都没有**。
 * `grep` 的结论很直接：`apps/mobile/src` 里没有 `HabitBoard`，也没有习惯的
 * 建/打卡入口 —— 成长屏（`GrowthScreen`）只是把同步过来的连续数字**读**出来，
 * 连"今天打一次卡"都做不到。也就是说这一刀承诺的
 * "让移动端从无到有拿到签名功能"（计划 §P8）在此之前**没有兑现**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这一屏只回答移动端自己的三个问题
 *
 *   1. 习惯与打卡记录从哪来 → `openTaskHost()` 的物化状态 +
 *      `@heyta/app-host` 的 `createHabitActions`（建 / 打卡 / 撤销 / 设色）；
 *   2. 文案从哪来 → `lib/habits-display.ts`（见那里的命名残差）；
 *   3. 周边挂什么 → 「新建习惯」的输入框与取色入口。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 形态 = **清单 → 详情**（2026-10-01 产品负责人定的两层，本轮补的是移动端）
 *
 * 移动端此前是 N 张详情卡**直接堆叠**：没有"扫一眼"的那一列，要看第三条习惯
 * 得先滚过前两条的热力图。现在与 web 同一个形状 ——
 *
 *   · 清单：`@heyta/ui` 的 `HabitProgressList`（图标 + 最近 7 天 + 三个具体数字）；
 *   · 详情：`@heyta/ui` 的 `HabitBoard`，只是把 `habits` 收成一条。
 *
 * **两块本体都在共享层**，本文件只做导航与输入。唯一与 web 不同的地方是**排法**：
 * 手机屏放不下并排两栏，所以详情是**推进去的一层**，返回走顶栏 ——
 * 而不是把窗格塞在清单下面逼用户滚。
 *
 * 连续与韧性的**配对**由宿主注入：这里传 `habitGrowth`
 * （`@heyta/app-host` 的 `motivation.ts`）—— 那是"两个数字必须用同一份日志、
 * 同一个 today"的唯一实现，本文件与共享层都不重算。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 入口走「我的」的第二层，**不加 tab**（P10）
 *
 * ADR-0015 §4 的判决是"四象限是同一份任务的另一种投影，不新增 tab"，
 * 而 P10 已把移动端第 6 个 tab（`tab.quadrant`）判为要撤销。
 * 习惯与四象限不同 —— 它读的是**另一批数据**（HABIT / HABIT_LOG）——
 * 但"不急着重排标签栏"这条同样适用：底部标签**保持 5 个**
 * （任务 / 日历 / 专注 / 分类 / 我的），本屏是「我的」下面的第二层，
 * 返回靠顶栏（与 `GrowthScreen` / `ExportScreen` / `TrashScreen` 同一个形状）。
 *
 * ⚠️ 这意味着**发现性不如一个 tab**：用户要「我的 → 习惯」两步才到。
 * 这是有意的取舍（标签栏塞第 6 个会让每个标签都读不清），
 * 但它是一个**需要产品负责人知道**的落差，不是实现细节。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 移动端与 web 的**刻意差异**（逐条列出，别默默加）
 *
 *   1. **没有 `cellTooltip`**（热力图的悬停提示）—— 手机没有鼠标。
 *      共享层据此完全不产出 `data-cell-title`。
 *   2. **取色是什么样**：web 是展开式按钮 + `Esc`；移动端是
 *      `ui/slot-picker.tsx` 的 radiogroup（触摸没有 hover/Esc）。
 *      两者调的是同一个动作（`HabitActions.setHabitColor`），
 *      色板映射也只有一处（`@heyta/ui` 的 `categorySlotToken`）。
 *   3. **没有拖放**：习惯卡片没有排序/拖拽 —— 习惯顺序是
 *      `(createdAt, id)`（`listHabits()` 给的），移动端不提供重排。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 `HeytaUiProvider` 已由整棵树提供
 *
 * `App.tsx` 的 `Root()` → `ThemeProvider`（它**就是** `HeytaUiProvider`，
 * 见 `apps/mobile/src/theme.tsx`）包住了所有屏幕，所以本屏不再自己包一层。
 * ✅ 这一屏是 `check:ui-provider` 扫得到的**新消费者**（`HabitBoard` 已由父 agent
 * 登记进该脚本的 `PROVIDER_DEPENDENT`），拆掉根 Provider 会真的红。
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppHost, HabitActions } from '@heyta/app-host';
import { createHabitActions, habitGrowth } from '@heyta/app-host';
import type { CategorySlot, Habit, HabitGoalType, HabitLog } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { HabitBoard, HabitProgressList } from '@heyta/ui';

import { openTaskHost } from '../db/open-host';
import { habitBoardLabels, habitListLabels } from '../lib/habits-display';
import { useToday } from '../lib/use-today';
import { useMobileSync } from '../sync/store';
import { Button, Card, EmptyState, Screen, Text, TextField } from '../ui/kit';
import { HabitGoalSlot } from '../ui/habit-goal-slot';
import { HabitColorSlot } from '../ui/slot-picker';

export function HabitsScreen({ onBack }: { onBack: () => void }): React.JSX.Element {
  const { t } = useI18n();
  // 🔴 "现在"由 `useToday` 提供：回到前台与跨过本地零点时会刷新。
  // 拿一个冻结的 `Date.now()` 会让"今天打过没打"在午夜之后一直停在昨天。
  const { now } = useToday();
  /**
   * 🔴 `dataRevision` 是**同步完成**的信号。少了它，这一屏在整个应用生命周期里
   * 都不会重读：冷启动落在本屏（空的）→ 去「我的」同步 → 切回来仍是空的，
   * 而数据库里那些远端习惯**已经应用了**（重启 App 就能看见）。
   */
  const { dataRevision } = useMobileSync();

  const [host, setHost] = useState<AppHost | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [logs, setLogs] = useState<HabitLog[]>([]);
  const [draft, setDraft] = useState('');
  /**
   * 🔴 详情层展开的那一条。`null` = 停在清单。
   *
   * 它是**本地导航态**，不是业务数据 —— 不进 op-log、不落盘：手机上的
   * "我正在看哪一条"换一台设备没有意义，同步过去反而是噪音。
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 正在落盘的那一条 —— 置灰它，防连点发出两条 op。 */
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // 🔴 驱动是工厂不是实例：`SqliteAdapter` 会在 close 后靠它重开。
    void openTaskHost()
      .then((next) => {
        if (alive) setHost(next);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const actions = useMemo<HabitActions | null>(() => (host ? createHabitActions(host) : null), [host]);

  const refresh = useCallback(() => {
    if (!actions) return;
    // ⚠️ 两个 list 都是**同步**的（读的是已物化的内存状态），不是 Promise。
    setHabits(actions.listHabits());
    setLogs(actions.listLogs());
  }, [actions]);

  useEffect(() => {
    if (!host) return;
    // `openTaskHost()` 已保证日志重放完毕（AGENTS.md §7 第 9 条）。
    refresh();
  }, [host, refresh, dataRevision]);

  const runFor = useCallback(
    (habitId: string, pending: Promise<unknown>): void => {
      setBusyId(habitId);
      void pending
        .then(() => {
          setError(null);
          refresh();
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          setBusyId(null);
        });
    },
    [refresh],
  );

  const labels = useMemo(() => habitBoardLabels(t), [t]);
  const listLabels = useMemo(() => habitListLabels(t), [t]);

  /**
   * 详情层展开的那一条。
   *
   * ⚠️ 它被**删掉**时回到清单，而不是像 web 那样 `?? rows[0]` 落到第一条：
   * 窗格没有历史，落在那儿用户看不出来自己换了对象；手机上是"退回来"，
   * 层级本身会说话。
   */
  const selected = useMemo(
    () => habits.find((habit) => habit.id === selectedId),
    [habits, selectedId],
  );

  const chooseColor = useCallback(
    (habit: Habit, slot: CategorySlot | undefined): void => {
      if (!actions) return;
      runFor(habit.id, actions.setHabitColor(habit.id, slot));
    },
    [actions, runFor],
  );

  const setHabitGoal = useCallback(
    (habit: Habit, goal: { target?: number; unit?: string; goalType?: HabitGoalType }) => {
      if (!actions) return Promise.resolve();
      // 返回 promise 本身：调用方（HabitGoalSlot）要用它显示失败。
      return actions.setHabitGoal(habit.id, goal).then(refresh);
    },
    [actions, refresh],
  );

  const renderColorSlot = useCallback(
    (habit: Habit): ReactNode => (
      <HabitColorSlot habit={habit} onChoose={(slot) => chooseColor(habit, slot)} />
    ),
    [chooseColor],
  );

  /**
   * 目标编辑入口（数值 / 单位 / 达成口径）。
   *
   * 🔴 与 `renderColorSlot` 同形：**编辑控件留在各端**，共享的 `HabitBoard`
   * 只负责让出位置（`renderGoalSlot`）。
   *
   * ⚠️ 刻意**不包 `runFor()`**：`runFor` 只 `.finally()`，没有 `.catch` ——
   * 而 `setHabitGoal` 会 reject（非法数值 / 找不到习惯）。
   * 交给 `HabitGoalSlot` 自己接住，它才显示得出那行错误
   *（直接交给 `runFor` 会变成一条 unhandled rejection，用户看到的是"点了没反应"）。
   */
  const renderGoalSlot = useCallback(
    (habit: Habit): ReactNode => (
      <HabitGoalSlot habit={habit} onSetGoal={(goal) => setHabitGoal(habit, goal)} />
    ),
    [setHabitGoal],
  );

  /**
   * 🔴 **两个提前 return 必须在**所有 hook **之后**（AGENTS.md §7 记录过这个真 bug：
   * "先 null 后就绪"的两次渲染会让 hook 数量不同 → `Rendered more hooks than
   * during the previous render.`，整屏白）。
   */
  if (error !== null) {
    return (
      <Screen
        title={t('web.shell.views.habits')}
        actions={[{ icon: 'action.back', label: t('mobile.growth.back'), onPress: onBack }]}
      >
        <EmptyState
          icon="group.overdue"
          title={t('mobile.tasks.loadError.title')}
          hint={t('mobile.tasks.loadError.hint')}
          // 🔴 原始错误原样附上：它多半是英文的系统信息，但**不能翻译** ——
          // 翻译之后就没法拿去搜索、也没法对照日志（与 `TasksScreen` 同一条分工）。
          detail={t('mobile.tasks.loadError.detail', { detail: error })}
        />
      </Screen>
    );
  }

  if (host === null || actions === null) {
    return (
      <Screen
        title={t('web.shell.views.habits')}
        actions={[{ icon: 'action.back', label: t('mobile.growth.back'), onPress: onBack }]}
      >
        <EmptyState
          icon="action.sync"
          title={t('mobile.tasks.loading.title')}
          hint={t('mobile.tasks.loading.hint')}
        />
      </Screen>
    );
  }

  /**
   * 🔴 详情层。**提前 return 在所有 hook 之后**（同 `ProfileScreen` 的规矩：
   * 先 return 后 hook 会让两次的 hook 数量不同 → 整屏白屏）。
   *
   * 窗格本体是**共享 `HabitBoard`**，只是把 `habits` 收成一条 ——
   * 不是另写一个详情组件，所以打卡 / 三个数字 / 冻结 / 补打卡 / 重新开始 /
   * 热力图与 web 右窗格逐字同一份实现。
   */
  if (selected !== undefined) {
    return (
      <Screen
        title={selected.name}
        actions={[
          {
            icon: 'action.back',
            label: t('mobile.growth.back'),
            onPress: () => {
              setSelectedId(null);
            },
          },
        ]}
      >
        <HabitBoard
          habits={[selected]}
          logs={logs}
          now={now}
          growth={habitGrowth}
          labels={labels}
          onCheckIn={(habitId, date) => {
            runFor(habitId, actions.checkIn(habitId, date));
          }}
          onUndoCheckIn={(habitId, date) => {
            runFor(habitId, actions.undoCheckIn(habitId, date));
          }}
          busyHabitId={busyId}
          renderColorSlot={renderColorSlot}
          renderGoalSlot={renderGoalSlot}
          testID="habit-detail"
        />
      </Screen>
    );
  }

  return (
    <Screen
      title={t('web.shell.views.habits')}
      actions={[{ icon: 'action.back', label: t('mobile.growth.back'), onPress: onBack }]}
    >
      {/*
        「新建习惯」的输入框留在宿主（见共享层文件头第 1 条）：
        移动端用 kit 的 `TextField`（44px 字段高、焦点边框、label/placeholder
        分离），web 用 DOM `<input>`（要处理 iOS Safari 聚焦缩放）——
        两者的规范不同，强行共享会逼一个端放弃自己的输入控件。
      */}
      <Card>
        <TextField
          label={t('web.habits.addLabel')}
          value={draft}
          onChangeText={setDraft}
          placeholder={t('web.habits.addPlaceholder')}
        />
        <Button
          label={t('web.habits.add')}
          icon="task.add"
          tone="primary"
          onPress={() => {
            const name = draft.trim();
            // 交互决策：空名字什么都不做（动作层对空名字抛错）。
            if (name === '') return;
            setDraft('');
            if (!actions) return;
            void actions
              .createHabit(name)
              .then(() => {
                setError(null);
                refresh();
              })
              .catch((e: unknown) => {
                setError(e instanceof Error ? e.message : String(e));
              });
          }}
        />
      </Card>

      {/*
        🔴 清单本体是**共享层**的 `HabitProgressList`，与 web 左列读的是同一批
        判据（`toHabitProgressRows` + `habitHeatmap` + `heatmapLevelToken`）。
        本文件**不许**自己数 `logs` 或算连续 —— 那会变成第三份答案。
        连"还没有习惯"那句话也不在这层：空态由共享清单自己渲染（`labels.empty`），
        因为"空态只有一个实现"是门禁判据（`check:empty-state` 断言 B）。
      */}
      <HabitProgressList
        habits={habits}
        logs={logs}
        now={now}
        growth={habitGrowth}
        labels={listLabels}
        onSelect={(habitId) => {
          setSelectedId(habitId);
        }}
        testID="habit-list"
      />
    </Screen>
  );
}
