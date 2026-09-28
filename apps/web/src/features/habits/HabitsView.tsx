/**
 * 习惯视图（Web 壳）
 * ==================
 *
 * 🔴 M3 第七刀之后，这个文件**只剩接线**。
 *
 * 打卡按钮、三个连续数字、冻结说明、补打卡 / 重新开始、近 90 天热力图，
 * 全部由 `@heyta/ui` 的 `HabitBoard` 渲染 —— 与 mobile 是**同一份实现**。
 * 这里只回答 web 自己的三个问题：
 *
 *   1. 习惯与打卡记录从哪来 → `useHabitStore`；
 *   2. 「现在」从哪来 → `sessionStorage` 的固定值（见下面 `NOW_STATE_KEY`）；
 *   3. web 特有的交互 → 「新建习惯」的输入框（DOM `<input>`）与取色入口
 *      （`ColorSlotPicker`，DOM 的展开式按钮 + `Esc`）。
 *
 * 连续 / 韧性的**配对**不在这里算：`HabitBoard` 的 `growth` prop 收的是
 * 函数，这里传 `@heyta/app-host#habitGrowth` —— 那是配对的唯一实现。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 热力图不再用 `react-activity-calendar`
 *
 * 它是 **DOM 库**，而共享层必须只用 RN 原语。自绘之后**失去**的是那个库
 * 内置的悬停提示；补回来的方式是 `cellTooltip` 写 `data-cell-title` +
 * `apps/web/src/styles/app.css` 的 `[data-cell-title]::after`
 * （与 `CategoryReportView` 同一条路，那段 CSS 已经在了）。
 *
 * ⚠️ 顺带一条**必须记住的**：`web.habits.heatmap` 那条词条用的是
 * `{{count}}`（**库自己的**占位符），我们的插值器只认单层 `{count}` ——
 * 复用它渲染自定义热力图会得到字面的 `{5}`。所以自绘热力图的整块无障碍名
 * 用的是新加的 `web.habits.heatmap.a11y`，每一格的悬停文案是
 * `web.habits.heatmap.cell`。
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
import { useHabitStore } from './store.js';

const NOW_STATE_KEY = 'now';

/**
 * 三个指标各自的一句话。
 *
 * 🔴 词条表没有 ICU：连续 1 天时英文必须走单数兄弟词条
 * （"Streak 1 days" 是一眼可见的坏句子）。三个数字各自分支，
 * 因为它们完全可能一个是 1、另一个不是。
 *
 * 放在组件外、显式收 `t`：这样它既在 JSX 之外拼好句子
 * （门禁只认"字面量紧跟 `t(`"的形状），又不依赖 hook。
 */
function currentStreakText(count: number, t: I18nValue['t']): string {
  return count === 1
    ? t('web.habits.streak.currentOne', { count })
    : t('web.habits.streak.current', { count });
}

function longestStreakText(count: number, t: I18nValue['t']): string {
  return count === 1
    ? t('web.habits.streak.longestOne', { count })
    : t('web.habits.streak.longest', { count });
}

function totalCheckInText(count: number, t: I18nValue['t']): string {
  return count === 1
    ? t('web.habits.streak.totalOne', { count })
    : t('web.habits.streak.total', { count });
}

/** 打卡按钮的无障碍名："撤销今日打卡" / "为它打卡" 是两句话，各自成词条。 */
function checkInLabel(name: string, doneToday: boolean, t: I18nValue['t']): string {
  return doneToday
    ? t('web.habits.a11y.undo', { name })
    : t('web.habits.a11y.checkIn', { name });
}

/**
 * 构造共享 `HabitBoard` 需要的全部文案。
 *
 * 共享层**不 import i18n**（见它的文件头），所以模板留在这里；
 * 字段名必须与 `HabitBoardLabels` 逐项对上 —— 漏了编译不过。
 *
 * ⚠️ 月份 key 的表在共享层（`HEATMAP_MONTH_KEYS`）—— 两端各写一份 12 项的
 * 列表就是漂移的起点（改一处不会红，只会让一个端少一个月）。
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
  // 固定"现在"，避免同一次渲染里跨午夜导致不一致
  const now = Number(sessionStorage.getItem(NOW_STATE_KEY) ?? Date.now());

  const labels = useMemo(() => habitBoardLabels(t), [t]);

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

  return (
    <div style={{ padding: cssVar('space.4') }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
        style={{
          display: 'flex',
          gap: cssVar('space.2'),
          marginBottom: cssVar('space.4'),
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
            padding: `${cssVar('space.2')} ${cssVar('space.3')}`,
            borderRadius: cssVar('radius.md'),
            border: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
            background: cssVar('color.background'),
            color: cssVar('color.foreground'),
            // 输入框字号必须 ≥16px，否则 iOS Safari 聚焦时会自动放大页面
            fontSize: cssVar('font-size.base'),
            fontFamily: cssVar('font.sans'),
          }}
        />
        <button
          type="submit"
          aria-label={t('web.habits.add')}
          style={{
            minWidth: cssVar('touch-target.min'),
            minHeight: cssVar('touch-target.min'),
            display: 'grid',
            placeItems: 'center',
            cursor: 'pointer',
            borderRadius: cssVar('radius.md'),
            border: 'none',
            background: cssVar('color.primary'),
            color: cssVar('color.on-primary'),
          }}
        >
          <Plus size={18} aria-hidden="true" />
        </button>
      </form>

      <HeytaUiProvider>
        <HabitBoard
          habits={store.habits}
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
          testID="habit-board"
        />
      </HeytaUiProvider>
    </div>
  );
}
