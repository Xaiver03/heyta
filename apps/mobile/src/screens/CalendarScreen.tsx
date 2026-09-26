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
 * 🔴 日历数学**一行都不在这个文件里。**
 *
 * `monthGrid` / `startOfMonth` / `addMonths` / `isoWeekday` / `monthGrid` 的
 * 周一开头约定 / `formatMonthTitle` / `formatDayTitle` / `WEEKDAY_LABELS`
 * 全部来自 `@heyta/domain`，而且 Web 端用的是**同一份**。
 *
 * 这不是"能省则省"。日历里会**静默算错**的东西全都集中在那几行：
 * 补白格属于上月还是本月、周一还是周日开头、1 月 31 日加一个月落到哪天。
 * 两端各写一份的必然结果不是"某天崩了"，而是"网页上 3 号是周三、
 * 手机上是周四"—— 而两边看起来都是正常的日历。
 *
 * 🔴 写入只有一处：勾选完成，走 `createTaskActions`。
 * 这一层**不做**任何自己的 op 构造（AGENTS.md §3.5）。
 * ─────────────────────────────────────────────────────────────────────────
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  WEEKDAY_LABELS,
  addMonths,
  formatDayTitle,
  formatMonthTitle,
  monthGrid,
  startOfMonth,
  toLocalDate,
  type LocalDate,
  type Task,
} from '@heyta/domain';
import { createTaskActions, type AppHost, type TaskActions } from '@heyta/app-host';
import { useToday } from '../lib/use-today';

import { openTaskHost } from '../db/open-host';
import { useTokens } from '../theme';
import {
  Button,
  Card,
  Checkbox,
  Divider,
  IconButton,
  Screen,
  SectionHeader,
  Text,
} from '../ui/kit';

/**
 * 一个格子里最多画几个点。
 *
 * 多于此只会糊成一片色块 —— 那时"这天有 14 件事"和"有 3 件事"看起来一样，
 * 用户得到的信息反而更少。点只回答"这天有没有事、大致什么状态"，
 * 具体有哪几件事由下面的当日列表回答。
 */
const MAX_DOTS = 3;

/** 一天的状态色。三档而不是五种：格子里只有 4px 的点，再细分就分不出来了。 */
type DayTone = 'plain' | 'primary' | 'danger' | 'subtle';

/** 从当天的任务推出格子里点的颜色。 */
function dayToneOf(tasks: readonly Task[], today: LocalDate, date: LocalDate): DayTone {
  if (tasks.length === 0) return 'plain';
  const pending = tasks.filter((task) => task.completedAt === undefined);
  if (pending.length === 0) return 'subtle';
  // 逾期用 danger：它是**需要被注意到**的状态，不是一种分类。
  return date < today ? 'danger' : 'primary';
}

/**
 * 月历里的一个格子。
 *
 * ⚠️ 单独提出来是为了不让它随主组件重渲染而重新挂载 ——
 * 内联定义组件会让 React 每次渲染都当成一个**新类型**，
 * 于是 42 个格子的状态与 Pressable 的按下反馈每次都被丢掉。
 */
function DayCell({
  date,
  day,
  inMonth,
  isToday,
  isSelected,
  tone,
  dotCount,
  onPress,
}: {
  date: LocalDate;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  tone: DayTone;
  dotCount: number;
  onPress: (date: LocalDate) => void;
}): React.JSX.Element {
  const t = useTokens();

  const numberColor = isSelected
    ? t['color.on-primary']
    : inMonth
      ? t['color.foreground']
      : // 补白格（上月/下月）视觉上次要，但**仍然可点** ——
        // "点上月 30 号"是合法意图，把它做成不可点才是意外。
        t['color.foreground-subtle'];

  const dotColor =
    tone === 'danger'
      ? t['color.danger']
      : tone === 'primary'
        ? t['color.primary']
        : tone === 'subtle'
          ? t['color.foreground-subtle']
          : 'transparent';

  return (
    <Pressable
      onPress={() => onPress(date)}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      // 读屏时一屏 42 个"数字"没有意义，必须念成一个完整的日期 + 有没有事。
      accessibilityLabel={`${formatDayTitle(date)}${dotCount > 0 ? `，${String(dotCount)} 个任务` : '，没有任务'}`}
      style={{
        flex: 1,
        // 触控目标不小于 44×44（UIX Pro 第 2 条）
        minHeight: t['touch-target.min'],
        alignItems: 'center',
        justifyContent: 'center',
        gap: t['space.1'],
        borderRadius: t['radius.md'],
        borderWidth: isToday && !isSelected ? t['border-width.thick'] : t['border-width.thin'],
        borderColor: isSelected
          ? t['color.primary']
          : isToday
            ? t['color.primary']
            : 'transparent',
        backgroundColor: isSelected ? t['color.primary'] : 'transparent',
      }}
    >
      <Text variant="numeric-body" style={{ color: numberColor }}>
        {day}
      </Text>
      <View style={{ flexDirection: 'row', gap: t['space.1'], height: t['size.badge-dot'] }}>
        {Array.from({ length: Math.min(dotCount, MAX_DOTS) }, (_, i) => (
          <View
            key={i}
            style={{
              width: t['size.badge-dot'],
              height: t['size.badge-dot'],
              borderRadius: t['radius.full'],
              backgroundColor: dotColor,
            }}
          />
        ))}
      </View>
    </Pressable>
  );
}

export function CalendarScreen(): React.JSX.Element {
  const t = useTokens();
  const [host, setHost] = useState<AppHost | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** 正在写入的任务 id —— 防止连点产生两次 toggle。 */
  const [busyId, setBusyId] = useState<string | null>(null);

  // 🔴 "现在"由 `useToday` 提供：回到前台与跨过本地零点时会刷新。
  // 原来的 `useMemo(() => Date.now(), [])` 会让"今天"永远停在打开应用的那一天。
  const { now, today } = useToday();

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
  }, [host, refresh]);

  /**
   * 按**本地日期**把任务分到各天。
   *
   * ⚠️ 用 `toLocalDate` 而不是 `new Date(ms).getDate()`：后者要自己拼回字符串，
   * 而拼的过程中极易用上 UTC 口径 —— 结果是"凌晨到期的任务落到前一天"。
   */
  const byDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      if (task.dueDate === undefined) continue;
      const key = toLocalDate(task.dueDate);
      const list = map.get(key);
      if (list === undefined) {
        map.set(key, [task]);
      } else {
        list.push(task);
      }
    }
    return map;
  }, [tasks]);

  const weeks = useMemo(() => monthGrid(cursor), [cursor]);
  const dayTasks = byDate.get(selected) ?? [];

  const toggle = useCallback(
    async (task: Task) => {
      if (!actions || busyId !== null) return;
      setBusyId(task.id);
      try {
        await actions.toggleCompleted(task.id);
        refresh();
      } catch (e: unknown) {
        // 必须让用户看见：否则点一下什么都没发生，看起来像按钮坏了。
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyId(null);
      }
    },
    [actions, busyId, refresh],
  );

  const pickDay = useCallback((date: LocalDate) => {
    setSelected(date);
    // 点到补白格时把月份也翻过去 —— 否则选了"上月 30 号"却还停在本月，
    // 下面列出的日子在网格里根本看不到。
    setCursor(startOfMonth(date));
  }, []);

  return (
    <Screen title="日历">
      {error !== null ? (
        <Text variant="row-meta" tone="danger">
          {error}
        </Text>
      ) : null}

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <IconButton
            icon="action.prev-month"
            label="上个月"
            onPress={() => {
              setCursor(addMonths(cursor, -1));
            }}
          />
          <Text variant="section-title" style={{ flex: 1, textAlign: 'center' }}>
            {formatMonthTitle(cursor)}
          </Text>
          <IconButton
            icon="action.next-month"
            label="下个月"
            onPress={() => {
              setCursor(addMonths(cursor, 1));
            }}
          />
        </View>

        <View style={{ flexDirection: 'row' }}>
          {WEEKDAY_LABELS.map((label) => (
            <View key={label} style={{ flex: 1, alignItems: 'center' }}>
              <Text variant="caption" tone="subtle">
                {label}
              </Text>
            </View>
          ))}
        </View>

        {weeks.map((week) => (
          <View key={week[0]!.date} style={{ flexDirection: 'row' }}>
            {week.map((cell) => {
              const cellTasks = byDate.get(cell.date) ?? [];
              return (
                <DayCell
                  key={cell.date}
                  date={cell.date}
                  day={Number(cell.date.slice(8, 10))}
                  inMonth={cell.inMonth}
                  isToday={cell.date === today}
                  isSelected={cell.date === selected}
                  tone={dayToneOf(cellTasks, today, cell.date)}
                  dotCount={cellTasks.length}
                  onPress={pickDay}
                />
              );
            })}
          </View>
        ))}
      </Card>

      <SectionHeader
        icon="task.due"
        title={formatDayTitle(selected)}
        count={dayTasks.length}
        tone={selected === today ? 'primary' : 'muted'}
      />

      <Card>
        {dayTasks.length === 0 ? (
          <Text variant="row-meta" tone="subtle">
            这一天没有到期的任务。
          </Text>
        ) : (
          dayTasks.map((task, index) => {
            const done = task.completedAt !== undefined;
            return (
              <View key={task.id}>
                {index > 0 ? <Divider /> : null}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: t['space.3'],
                    minHeight: t['size.row-min-height'],
                  }}
                >
                  <Checkbox
                    checked={done}
                    busy={busyId === task.id}
                    onToggle={() => void toggle(task)}
                    // 读屏时必须带标题，否则一屏十几行听到的全是"标记完成"。
                    label={`${done ? '取消完成' : '标记完成'}：${task.title}`}
                  />
                  <Text
                    variant="row-title"
                    tone={done ? 'subtle' : 'default'}
                    style={{ flex: 1 }}
                    numberOfLines={2}
                  >
                    {task.title}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </Card>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t['space.3'] }}>
        <Button
          label="回到今天"
          tone="ghost"
          onPress={() => {
            pickDay(today);
          }}
        />
      </View>

      {/* 如实说明这一页看不到什么 —— 否则"任务没设截止时间"会被读成"任务丢了"。 */}
      <Text variant="caption" tone="subtle">
        未设截止时间的任务不在日历上，它们在「任务」页的收集箱里。
      </Text>
    </Screen>
  );
}