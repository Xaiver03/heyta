/**
 * 日历（移动端）
 * ================
 *
 * 月视图 + 选中某天看当天任务。
 *
 * 「任务」页回答"现在该干什么"，这一页回答"哪天有什么事" —— 本地优先的任务
 * 应用里，这两件事都得有，否则安排一周的活只能靠翻列表。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 **这个文件现在只做三件事**：取数据、把 i18n 翻成 `labels`、把动作转交 action 层。
 *
 * 界面本身（月网格、42 个格子、当天的行）**全部来自 `@heyta/ui` 的共享
 * `CalendarBoard`** —— 与 Web 是同一份实现。在此之前这份渲染只存在于移动端，
 * 于是 Web 上**根本没有日历**（产品负责人 2026-09-29 给的参考 IA 里，
 * 日历是 5 个主菜单之一）。
 *
 * ⚠️ 日历**数学**一行都不在共享板、也不在这里：
 * `monthGrid` / `startOfMonth` / `addMonths` / `isoWeekday` 全部来自 `@heyta/domain`。
 * 会**静默算错**的东西全集中在那一处（补白格属于上月还是本月、周一还是周日开头、
 * 1 月 31 日加一个月落到哪天）。
 *
 * ⚠️ 日期**措辞**也不在这里了：`formatMonthTitleText` / `formatDayTitleText` /
 * `WEEKDAY_MESSAGE_KEYS` 已上移到 `@heyta/ui` 的 `calendar/date-text.ts`
 *（`lib/date.ts` 里那三个已删掉 —— 该文件头自己就写着"不要在本文件里转发一层，
 * 转发会让下一个人以为这里还是定义处"）。`DatePicker` 也改从那一边引。
 *
 * 🔴 写入只有一处：勾选完成，走 `createTaskActions`。
 * 这一层**不做**任何自己的 op 构造（AGENTS.md §3.5）。
 * ─────────────────────────────────────────────────────────────────────────
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { startOfMonth, toLocalDate, type LocalDate, type Task } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { createTaskActions, type AppHost, type TaskActions } from '@heyta/app-host';
import {
  CalendarBoard,
  formatDayTitleText,
  formatMonthTitleText,
  WEEKDAY_MESSAGE_KEYS,
} from '@heyta/ui';
import { useToday } from '../lib/use-today';

import { openTaskHost } from '../db/open-host';
import { useMobileSync } from '../sync/store';
import { Screen, Text } from '../ui/kit';

export function CalendarScreen(): React.JSX.Element {
  const { t } = useI18n();
  const [host, setHost] = useState<AppHost | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** 正在写入的任务 id —— 防止连点产生两次 toggle。 */
  const [busyId, setBusyId] = useState<string | null>(null);

  // 🔴 "现在"由 `useToday` 提供：回到前台与跨过本地零点时会刷新。
  // 原来的 `useMemo(() => Date.now(), [])` 会让"今天"永远停在打开应用的那一天。
  const { today } = useToday();
  // 同步完成 → `dataRevision` 变 → 上面的 effect 重读物化状态。
  const { dataRevision } = useMobileSync();

  /** 正在显示的月份（用该月里任意一天表示）。 */
  const [cursor, setCursor] = useState<LocalDate>(() => startOfMonth(toLocalDate(Date.now())));
  /** 选中的那一天。 */
  const [selected, setSelected] = useState<LocalDate>(() => toLocalDate(Date.now()));

  /** 上一次的"今天"，用来判断跨零点时选中框要不要跟着走。 */
  const prevToday = useRef(today);

  useEffect(() => {
    // 🔴 跨零点后，若选中框还停在**上一个"今天"**（说明用户没手动挑过别的日子），
    // 就把它带到新的今天。否则第二天打开时选中框仍框着昨天、下面列表还是昨天那一列，
    // 而「回到今天」按钮看起来毫无反应。
    //
    // ⚠️ 这个 effect 必须放在 `selected` / `cursor` **声明之后** ——
    // 放在 `useToday()` 旁边会引用尚未初始化的 `selected`，
    // 而这正是 `pnpm typecheck` 抓到的（TS2448 / TS2454）。
    if (prevToday.current !== today && selected === prevToday.current) {
      setSelected(today);
      setCursor(startOfMonth(today));
    }
    prevToday.current = today;
  }, [today, selected]);

  useEffect(() => {
    let alive = true;
    // 🔴 驱动是工厂不是实例：`SqliteAdapter` 会在 close 后靠它重开。
    void openTaskHost()
      .then((h) => {
        if (alive) setHost(h);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const actions = useMemo<TaskActions | null>(
    () => (host ? createTaskActions(host) : null),
    [host],
  );

  const refresh = useCallback(() => {
    if (!actions) return;
    // ⚠️ `listTasks()` 是**同步**的（读已物化的内存状态），不是 Promise。
    setTasks(actions.listTasks());
  }, [actions]);

  useEffect(() => {
    if (!host) return;
    // 🔴 必须等 `recover()` 走完再读 —— openTaskHost 已经保证了这一点
    // （AGENTS.md §7 第 9 条）。
    refresh();
    // 🔴 `dataRevision`：同步完成后重读。少了它，日历屏会一直显示同步前的快照。
  }, [host, refresh, dataRevision]);

  const onToggleTask = useCallback(
    (taskId: string) => {
      if (!actions || busyId !== null) return;
      setBusyId(taskId);
      void actions
        .toggleCompleted(taskId)
        .then(() => {
          refresh();
        })
        .catch((e: unknown) => {
          // 必须让用户看见：否则点一下什么都没发生，看起来像按钮坏了。
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          setBusyId(null);
        });
    },
    [actions, busyId, refresh],
  );

  /**
   * 共享板要的全部文案。
   *
   * 🔴 共享层**不许 `import '@heyta/i18n'`**（会拖进第二份 React），
   * 所以文案由宿主注入 —— 而日期措辞走的是**共享**的 `date-text.ts`，
   * 不是这里另写一份（两端各写一份的必然结果是同一个日子显示成
   * 「9月26日 星期五」和「9月26日 周五」，而没人会为此报 bug）。
   */
  const labels = useMemo(
    () => ({
      monthTitle: (d: LocalDate) => formatMonthTitleText(d, t),
      dayTitle: (d: LocalDate) => formatDayTitleText(d, t),
      weekdays: WEEKDAY_MESSAGE_KEYS.map((k) => t(k)) as unknown as readonly [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ],
      // 英文单复数在调用方分支：恰好 1 个走 `…One` 兄弟词条，
      // 否则英文会渲染成 "1 tasks"（词条表刻意没有 ICU）。
      dayWithTasks: ({ date, count }: { date: string; count: number }) =>
        count === 1
          ? t('mobile.calendar.a11y.dayWithTasksOne', { date, count })
          : t('mobile.calendar.a11y.dayWithTasks', { date, count }),
      dayNoTasks: ({ date }: { date: string }) => t('mobile.calendar.a11y.dayNoTasks', { date }),
      // `+3` 读屏会念成"加三"，给它一句人话（视觉不变，两端同一份词条）。
      moreTasks: (count: number) => t('mobile.calendar.a11y.moreTasks', { count }),
      prevMonth: t('mobile.common.prevMonth'),
      nextMonth: t('mobile.common.nextMonth'),
      backToToday: t('mobile.calendar.backToToday'),
      dayEmpty: t('mobile.calendar.dayEmpty'),
      footnote: t('mobile.calendar.footnote'),
      taskRow: {
        toggleOn: (row: { title: string }) => t('mobile.calendar.a11y.markDone', { title: row.title }),
        toggleOff: (row: { title: string }) =>
          t('mobile.calendar.a11y.unmarkDone', { title: row.title }),
      },
    }),
    [t],
  );

  return (
    <Screen title={t('mobile.calendar.title')}>
      {error !== null ? (
        <Text variant="row-meta" tone="danger">
          {error}
        </Text>
      ) : null}

      <CalendarBoard
        tasks={tasks}
        today={today}
        cursor={cursor}
        selected={selected}
        onCursorChange={setCursor}
        onSelect={setSelected}
        onToggleTask={onToggleTask}
        busyTaskId={busyId}
        labels={labels}
        testID="calendar-board"
      />
    </Screen>
  );
}
