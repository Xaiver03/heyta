/**
 * 习惯视图（Web 壳）
 * ==================
 *
 * 产品负责人 2026-10-01 定的形态：**列表 + 窗格**。
 *
 *   · 左列 `HabitsList` —— 一行一个习惯：行首图标、名字、最近 7 天打没打、
 *     三个具体数字（连续 / 最长 / 累计）。负责**扫一眼**。
 *   · 右窗格 —— 选中那个习惯的 `@heyta/ui#HabitBoard`：打卡按钮、冻结说明、
 *     补打卡 / 重新开始、近 90 天热力图。负责**看细节**。
 *
 * 为什么要拆成两列而不是把板子从头列到尾：一条习惯的板子很高（热力图 90 格），
 * N 条纵向排下来，"我今天到底有没有断"要滚三屏才看得完 —— 而那正是这个视图
 * 唯一要回答的问题。滴答清单 / Streaks 都是同一取向：清单行给状态，展开给历史。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 M3 第七刀之后，打卡与热力图**仍然只有 `packages/ui` 那一份实现**
 *
 * 拆两列改的是**布局**，不是渲染：右窗格传给 `HabitBoard` 的是
 * `habits={[选中那一条]}`，共享层对此一无所知（它只看到一个习惯的数组）。
 * 所以 `apps/web/tests/habits-board.spec.tsx` 的 E 组判据依然成立。
 *
 * ⚠️ 全页**只有一块** `HabitBoard`。`e2e/tests/motivation.spec.ts` 的白屏检测
 * 断言 `[data-testid="habit-board"]` 的数量恰好为 1（`toHaveCount(1)`），
 * 在左列再渲染一块会当场红 —— 那是对的：两块板会让"哪一块是选中项"变成
 * 一个由 DOM 顺序而不是由状态决定的问题。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这个文件里不许出现"什么算打过 / 连续几天"的判断
 *
 * 数字全部来自 `selectHabitProgress` / `selectHeatmap`（薄转发到
 * `@heyta/ui#toHabitProgressRows` 与 `#habitHeatmap`）。连续 / 韧性的**配对**
 * 也不在这里算：`HabitBoard` 的 `growth` prop 收函数，这里传
 * `@heyta/app-host#habitGrowth` —— 那是配对的唯一实现。
 *
 * 🔴 热力图不再用 `react-activity-calendar`：它是 **DOM 库**，而共享层必须只用
 * RN 原语。自绘之后失去的是库内置的悬停提示，补回来的方式是 `cellTooltip` 写
 * `data-cell-title` + `apps/web/src/styles/app.css` 的 `[data-cell-title]::after`。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 `HeytaUiProvider` 必须包在**这一处**
 *
 * `App.tsx` 的 Provider 只包了 `tasks` 那棵树，而习惯是它的**兄弟节点**
 * （`{view === 'habits' && <HabitsView />}`）。M3 第二刀（focus）就是这样
 * 在运行时抛出「useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用」的。
 *
 * ✅ `HabitBoard` 已登记进 `scripts/check-ui-provider.mjs` 的
 * `PROVIDER_DEPENDENT`（父 agent 收尾时补的），门禁能看见这里 ——
 * 别把下面那层 Provider 删掉（已实测：拆掉会在 `/tmp` 副本上变红）。
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { habitGrowth } from '@heyta/app-host';
import { cssVar } from '@heyta/design-system';
import { parseCategorySlot, type Habit, type LocalDate } from '@heyta/domain';
import { useI18n, type I18nValue } from '@heyta/i18n';
import { HEATMAP_MONTH_KEYS, HabitBoard, HeytaUiProvider, type HabitBoardLabels } from '@heyta/ui';
import { Plus } from 'lucide-react';

import { ColorSlotPicker } from '../categories/ColorSlotPicker.js';
import { HabitIconPicker } from './HabitIconPicker.js';
import { HabitsList, HABIT_ROW_WEEK_DAYS, type HabitsListRow } from './HabitsList.js';
import { checkInLabel, currentStreakText, longestStreakText, totalCheckInText } from './copy.js';
import { HabitGoalEditor } from './HabitGoalEditor.js';
import {
  selectHabitProgress,
  selectHeatmap,
  useHabitStore,
} from './store.js';

const NOW_STATE_KEY = 'now';

/**
 * 构造共享 `HabitBoard` 需要的全部文案。
 *
 * 共享层**不 import i18n**（见它的文件头），所以模板留在这里；
 * 字段名必须与 `HabitBoardLabels` 逐项对上 —— 漏了编译不过。
 *
 * ⚠️ 月份 key 的表在共享层（`HEATMAP_MONTH_KEYS`）—— 两端各写一份 12 项的
 * 列表就是漂移的起点（改一处不会红，只会让一个端少一个月）。
 *
 * ✅ 三个连续数字的措辞在 `./copy.js`：左列的 chip `title` 要的是同一句话，
 * 写两份就会漂移（一边"连续 N 天"、一边"连 N 天"没人会红）。
 */
export function habitBoardLabels(t: I18nValue['t']): HabitBoardLabels {
  return {
    checkIn: t('web.habits.checkIn'),
    checkedIn: t('web.habits.checkedIn'),
    checkInA11y: ({ name, doneToday }) => checkInLabel(name, doneToday, t),
    streakCurrent: (count) => currentStreakText(count, t),
    streakLongest: (count) => longestStreakText(count, t),
    streakTotal: (count) => totalCheckInText(count, t),
    freeze: (count) => t('web.habits.freeze', { count }),
    repair: ({ date, count }) => t('web.habits.repair', { date, count }),
    repairAction: t('web.habits.repairAction'),
    repairA11y: ({ date, name }) => t('web.habits.a11y.repair', { date, name }),
    freshStart: ({ days, longest, total }) =>
      t('web.habits.freshStart', { days, longest, total }),
    freshStartAction: t('web.habits.freshStartAction'),
    freshStartA11y: (name) => t('web.habits.a11y.freshStart', { name }),
    empty: t('web.habits.empty'),
    heatmap: {
      // ⚠️ `month` 由 `monthOfDate` 从日期串切出来，理论上恒为 1–12；
      // 兜底写**字面量**而不是 `HEATMAP_MONTH_KEYS[0]`（后者在
      // `noUncheckedIndexedAccess` 下仍是 `… | undefined`，编译不过）。
      month: (month) => t(HEATMAP_MONTH_KEYS[month - 1] ?? 'web.heatmap.month.1'),
      grid: ({ name, total, days }) =>
        t('web.habits.heatmap.a11y', { name, count: total, days }),
      // 有鼠标才有悬停 —— web 传它，mobile 不传（共享层据此不产出属性）。
      cellTooltip: ({ date, count }) => t('web.habits.heatmap.cell', { date, count }),
      less: t('web.heatmap.less'),
      more: t('web.heatmap.more'),
    },
  };
}

export function HabitsView() {
  const { t } = useI18n();
  const store = useHabitStore();
  const [draft, setDraft] = useState('');
  /** 正在落盘的习惯 —— 置灰它那一行的按钮，防连点发出两条 op。 */
  const [busyId, setBusyId] = useState<string | null>(null);
  /**
   * 右窗格展开的那一条。
   *
   * 🔴 **存 id，不存对象**：`store.habits` 每次 op 后都是新数组，握住对象会让
   * 窗格显示一份过期的名字 / 目标。id 只是索引，渲染时从 `rows` 现取。
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 固定"现在"，避免同一次渲染里跨午夜导致不一致
  const now = Number(sessionStorage.getItem(NOW_STATE_KEY) ?? Date.now());

  const labels = useMemo(() => habitBoardLabels(t), [t]);

  /**
   * 左列的数据：进度行 + 它自己的 7 天窗口。
   *
   * ⚠️ `week` 与右窗格的 90 天热力图**同一次 `now`、同一份 `habitHeatmap`**，
   * 只是窗口长度不同 —— 所以列表里那个点说"打过"，窗格里那天必然是深色格。
   * 另起一条"今天打没打"的判断就会出现两列不同步的第三条路。
   */
  const rows = useMemo<HabitsListRow[]>(
    () =>
      selectHabitProgress(store, now).map((row) => ({
        progress: row,
        week: selectHeatmap(store, row.habit.id, now, HABIT_ROW_WEEK_DAYS),
      })),
    [store, now],
  );

  /**
   * 选中项。`selectedId` 指向的习惯被删掉时退回第一条 ——
   * 用**派生**而不是 `useEffect` 补一次 setState：效果会在提交后再渲染一轮，
   * 那一轮窗格是空的（症状：删掉当前习惯时右半边闪一下）。
   */
  const selected = rows.find((r) => r.progress.habit.id === selectedId) ?? rows[0];

  async function add(): Promise<void> {
    await store.addHabit(draft);
    setDraft('');
  }

  /** 一次变更：先置灰，落盘后恢复。**不在这里判断业务**（那是 action 层的事）。 */
  const run = useCallback((habitId: string, pending: Promise<unknown>): void => {
    setBusyId(habitId);
    void pending.finally(() => {
      setBusyId(null);
    });
  }, []);

  const renderColorSlot = useCallback(
    (habit: Habit): ReactNode => (
      <ColorSlotPicker
        value={parseCategorySlot(habit.color)}
        onChange={(slot) => {
          void store.setHabitColor(habit.id, slot);
        }}
        targetName={habit.name}
      />
    ),
    [store],
  );

  /**
   * 目标编辑入口。
   *
   * 🔴 与 `renderColorSlot` 同一个形状：**编辑控件留在各端**，共享的 `HabitBoard`
   * 只负责把位置让出来（`renderGoalSlot`）。这里**不判断业务**（合法与否在 action 层）。
   *
   * ⚠️ 刻意**不包 `run()`**：`run()` 只 `.finally()`，没有 `.catch` ——
   * 而 `setHabitGoal` 会 reject（非法数值 / 找不到习惯）。
   * 交给编辑器自己接住，它才显示得出那行错误（直接交给 `run` 会变成
   * 一条 unhandled rejection，用户看到的是"点了没反应"）。
   */
  const renderGoalSlot = useCallback(
    (habit: Habit): ReactNode => (
      <HabitGoalEditor
        habit={habit}
        onSetGoal={(goal) => store.setHabitGoal(habit.id, goal)}
      />
    ),
    [store],
  );

  return (
    <div className="ht-habit" data-testid="habits-view">
      <div className="ht-habit__side">
        <form
          className="ht-habit__add"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('web.habits.addPlaceholder')}
            aria-label={t('web.habits.addLabel')}
            style={{
              flex: 1,
              minHeight: cssVar('touch-target.min'),
              fontSize: cssVar('font-size.base'),
            }}
          />
          <button
            type="submit"
            aria-label={t('web.habits.add')}
            style={{
              minWidth: cssVar('touch-target.min'),
              minHeight: cssVar('touch-target.min'),
            }}
          >
            <Plus size={18} aria-hidden="true" />
          </button>
        </form>

        <HabitsList
          rows={rows}
          selectedId={selected?.progress.habit.id}
          onSelect={(habitId) => {
            setSelectedId(habitId);
          }}
        />
      </div>

      <div
        className="ht-habit__pane"
        aria-label={
          selected === undefined
            ? undefined
            : t('web.habits.pane.aria', { name: selected.progress.habit.name })
        }
      >
        {selected === undefined ? null : (
          <div className="ht-habit__pane-head">
            <HabitIconPicker
              habit={selected.progress.habit}
              onChange={(icon) => {
                void store.setHabitIcon(selected.progress.habit.id, icon);
              }}
            />
          </div>
        )}

        <HeytaUiProvider>
          <HabitBoard
            // 🔴 只给选中的那一条（见文件头：全页一块板）。空列表时传 []，
            //    由共享层渲染它自己的 `labels.empty` —— 不在这里另写一句空态。
            habits={selected === undefined ? [] : [selected.progress.habit]}
            logs={store.logs}
            now={now}
            // 🔴 配对函数来自 app-host —— 共享层不认识它（见那边的文件头）。
            growth={habitGrowth}
            labels={labels}
            onCheckIn={(habitId, date?: LocalDate) => {
              run(habitId, store.checkIn(habitId, date));
            }}
            onUndoCheckIn={(habitId, date?: LocalDate) => {
              run(habitId, store.undoCheckIn(habitId, date));
            }}
            busyHabitId={busyId}
            renderColorSlot={renderColorSlot}
            renderGoalSlot={renderGoalSlot}
            testID="habit-board"
          />
        </HeytaUiProvider>
      </div>
    </div>
  );
}
