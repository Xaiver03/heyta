/**
 * 习惯板的**文案构造器**（web 壳）
 * ==============================
 *
 * 从 `HabitsView.tsx` 搬出来（工单 §8.133）。搬的理由不是整洁，是**循环依赖**：
 * 板子的接线从这一单起住在 `HabitDetailCard.tsx`（它有两个落点），而
 * `HabitsView.tsx` 要渲染那张卡片的回落分支 ⇒ 如果构造器还留在视图里，
 * 两个文件就会互相 import。文案住在谁被用的那一侧，才不绕。
 *
 * 共享层**不 import i18n**（见 `packages/ui/src/habits/HabitBoard.tsx` 文件头），
 * 所以模板留在宿主侧；字段名必须与 `HabitBoardLabels` 逐项对上 —— 漏了编译不过。
 *
 * ⚠️ 月份 key 的表在共享层（`HEATMAP_MONTH_KEYS`）—— 两端各写一份 12 项的
 * 列表就是漂移的起点（改一处不会红，只会让一个端少一个月）。
 *
 * ✅ 三个连续数字的措辞在 `./copy.ts`：左列的 chip `title` 要的是同一句话，
 * 写两份就会漂移（一边"连续 N 天"、一边"连 N 天"没人会红）。
 */
import type { I18nValue } from '@heyta/i18n';
import { HEATMAP_MONTH_KEYS, type HabitBoardLabels } from '@heyta/ui';

import { checkInLabel, currentStreakText, longestStreakText, totalCheckInText } from './copy.js';

/** 构造共享 `HabitBoard` 需要的全部文案。 */
export function habitBoardLabels(t: I18nValue['t']): HabitBoardLabels {
  return {
    checkIn: t('web.habits.checkIn'),
    checkedIn: t('web.habits.checkedIn'),
    checkInA11y: ({ name, doneToday }) => checkInLabel(name, doneToday, t),
    streakCurrent: (count) => currentStreakText(count, t),
    streakLongest: (count) => longestStreakText(count, t),
    streakTotal: (count) => totalCheckInText(count, t),
    /*
      数量行（工单 W6）。三个都是**共享层点名要求**的字段，不是可选装饰：
      `HabitBoardLabels` 把它们写成必填，所以少接一个编译就红 ——
      可选 prop 会把"宿主没接"伪装成"做完了"，这条在工单 §8 的 W3 那轮记过。
      单位为空时补 `web.habits.goal.defaultUnit`（与目标摘要同一个 fallback，
      共享层不猜：猜出来的"次"对"每天 30 分钟"是错的）。
    */
    amount: ({ value, target, unit }) =>
      t('common.habits.amount.today', {
        value,
        target,
        unit: unit === '' ? t('web.habits.goal.defaultUnit') : unit,
      }),
    amountPlusA11y: ({ name }) => t('common.habits.amount.plus', { name }),
    amountMinusA11y: ({ name }) => t('common.habits.amount.minus', { name }),
    /*
      工单 W8 的四格（本月打卡 / 本月完成率 / 本月完成量 / 总完成量）。
      五个字段在 `HabitBoardLabels` 里都是**必填**：少接一个编译就红 ——
      与上面三个同一个纪律。
      句子只是 `month` 统计的投影，口径（天/自然月/到期分母）全在 domain 层；
      完成率的分母为 0 时共享层改点 `monthRatePending`，这里不判断。
      单位为空时退化成**不带单位**的那条句子（裁决 D：不替用户猜量纲）。
    */
    monthDays: (count) => t('web.habits.stats.monthDays', { count }),
    monthRate: (percent) => t('web.habits.stats.monthRate', { percent }),
    monthRatePending: t('web.habits.stats.monthRatePending'),
    monthValue: ({ value, unit }) =>
      unit === ''
        ? t('web.habits.stats.monthValue', { value })
        : t('web.habits.stats.monthValueUnit', { value, unit }),
    totalValue: ({ value, unit }) =>
      unit === ''
        ? t('web.habits.stats.totalValue', { value })
        : t('web.habits.stats.totalValueUnit', { value, unit }),
    freeze: (count) => t('web.habits.freeze', { count }),
    repair: ({ date, count }) => t('web.habits.repair', { date, count }),
    repairAction: t('web.habits.repairAction'),
    repairA11y: ({ date, name }) => t('web.habits.a11y.repair', { date, name }),
    freshStart: ({ days, longest, total }) =>
      t('web.habits.freshStart', { days, longest, total }),
    freshStartAction: t('web.habits.freshStartAction'),
    freshStartA11y: (name) => t('web.habits.a11y.freshStart', { name }),
    // 兜底那句是"列表本来就是空的"，见下面 `paneEmptyText`：调用处会按为什么空换掉它。
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

/**
 * 面单那句空态**取决于"为什么空"**（工单 §8.131）。
 *
 * 🔴 两条不许互相冒充：
 *   · 列表本来就是空的 ⇒ `web.habits.empty`（"还没有习惯"）；
 *   · 有习惯但没选中 ⇒ `web.habits.pane.pickOne`（"选一条习惯…"）。
 *
 * 原先只有一条，靠 `?? rows[0]` 让第二格永远不出现；那枚回落撤掉之后如果继续用
 * `web.habits.empty`，界面对着一堆习惯说"还没有习惯" —— 那是**文字上的同一种错**，
 * 而 `check:empty-state` 拦不住（它管的是空态不许缺席，不管说错了话）。
 *
 * 这里收的是**布尔**而不是行数组：判据只问"有没有习惯"，把分母传进来会让读的人
 * 以为它还在算列表。
 */
export function paneEmptyText(t: I18nValue['t'], hasHabits: boolean): string {
  return hasHabits ? t('web.habits.pane.pickOne') : t('web.habits.empty');
}
