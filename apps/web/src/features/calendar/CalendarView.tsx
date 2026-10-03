/**
 * 日历（Web）
 * ============
 *
 * 月历 + 选中某天看当天任务 —— **渲染全部来自 `@heyta/ui` 的共享 `CalendarBoard`**，
 * 与 mobile 是同一份实现（`packages/ui/src/calendar/`）。
 *
 * ## 🔴 这一刀补的是"一端有、另一端没有"
 *
 * `apps/mobile` 从 2026-09 起就有月历，而 Web **一个都没有** ——
 * 产品负责人 2026-09-29 给的参考 IA 里，日历是 5 个主菜单之一
 *（任务 / 日历 / 四象限 / 习惯 / 搜索）。所以它不是"少一行入口"，
 * 是这一端缺了一整块功能。13 项幻觉复核里的第 5 项就是它。
 *
 * ⚠️ **但数学一行都不在这里**：`monthGrid` / `startOfMonth` / `addMonths` /
 * `isoWeekday` 全在 `@heyta/domain`，共享板上也没有第二份。
 * 日历里会**静默算错**的东西（补白格归哪个月、周一还是周日开头、
 * 1 月 31 日加一个月落到哪天）全集中在那几行 —— 两端各写一份的必然结果
 * 不是"某天崩了"，而是"网页上 3 号是周三、手机上是周四"。
 *
 * ## 这个文件只做四件事
 *
 * 1. **取数据并过一层范围**：`useTaskStore().entities.tasks` → `scopeTasks(…, view.scope)`；
 * 2. **把 i18n 翻成共享板要的 `labels`**（共享层不许 `import '@heyta/i18n'`）；
 * 3. **把动作转交 store**（勾选完成走 `toggleComplete`，不自己构造 op）；
 * 4. **把滚轮翻月接到同一个 cursor 上**（`useWheelMonthNav`；判据在 `wheel-month.ts`，
 *    这里只有绑定 —— 手势怎么折算成"一格"不是产品语义，是 DOM 的事）。
 *
 * ⚠️ 当前月 / 选中日**不在本文件里**（`useState` 时期已过期）：它们在
 * `features/calendar/store.ts`。原因是这一屏现在是**两列**——左边的迷你月历与右边的
 * 月历必须指着同一个地方，而 `useState` 只能被一个组件看见。
 * 共享板仍然只管画：翻月、选日都是宿主的事（手机上也许是手势翻月）。
 */

import { useCallback, useMemo, useState } from 'react';

import { adjustmentOn, scopeTasks, toLocalDate, type LocalDate } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import {
  CalendarBoard as SharedCalendarBoard,
  HeytaUiProvider,
  stepCalendarCursor,
} from '@heyta/ui';

import { CaptureComposer } from '../capture/CaptureComposer.js';
import { useTaskStore } from '../tasks/store.js';
import { useCalendarLabels } from './useCalendarLabels.js';
import { useWheelMonthNav } from './useWheelMonthNav.js';
import { useCalendarViewStore } from './store.js';

/**
 * 共享板的 testID 前缀。**提成常量**是因为滚轮的命中判据要写
 * `[data-testid="…-month-card"]` —— 两处各写一遍，改一处就会静默失效
 * （症状是"滚轮翻月忽然不灵了"，而选择器拼错不会有任何报错）。
 */
const BOARD_TEST_ID = 'calendar-board';

export function CalendarView(): React.JSX.Element {
  const store = useTaskStore();
  /**
   * 🔴 月/日与侧栏**共用这一份**，不是本地 `useState`。
   *
   * 原来它俩住在这里，于是加侧栏时只有两条路：把状态提到 `App.tsx`（外壳长出一份
   * 只服务一个视图的状态），或者各存一份（侧栏翻到 11 月、主区还停在 10 月，
   * 两边的圆点各指各的）。现在它在一个只装日历界面状态的 store 里。
   */
  const view = useCalendarViewStore();

  const today = toLocalDate(store.now);
  /** 正在写入的任务 id —— 防止连点产生两次 toggle。 */
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * 主区画的是**范围内**的任务。
   *
   * ⚠️ 判据在 `@heyta/domain` 的 `scopeTasks`，这里只负责把它接上：
   * 「勾了清单 A 就只看 A 的任务」是产品语义，不属于外壳（AGENTS §3.5）。
   */
  const tasks = useMemo(
    () => scopeTasks(Object.values(store.entities.tasks), view.scope),
    [store.entities.tasks, view.scope],
  );

  /** 🔴 文案抽进 `useCalendarLabels()`：页头那个工具栏（批二）要的是**同一份**，
   *  两处各构造一遍就是"同一句文案的两份事实源"（AGENTS §3.5）。 */
  const labels = useCalendarLabels();

  /**
   * 「休 / 班」标记（W4b 公共事实，ADR-0052 §2.6）。
   *
   * 🔴 这里**只有一条读**：`adjustmentOn(date)` —— 判断（有覆盖用覆盖、没覆盖退回随包表、
   * 覆盖里日期非法整年拒绝）全在 `@heyta/domain`，而"什么时候去拉、拉回来存哪"
   * 全在 `@heyta/app-host`。宿主这一层要是能自己决定"这天算不算休"，
   * 那就是 AGENTS §3.5 那条分界线上的一次后退。
   *
   * ⚠️ 函数身份挂在 `publicFactsEpoch` 上：覆盖表是领域层的模块级状态，React 看不见它，
   * 换一次函数身份才保证那 42 个格子**无论有没有被 memo 包住**都会重读。
   */
  const markerEpoch = view.publicFactsEpoch;
  const dayMarker = useCallback(
    (date: LocalDate): 'off' | 'work' | undefined => adjustmentOn(date),
    [markerEpoch],
  );

  const { t } = useI18n();
  /** 词表没给时共享层会退化成一颗点 —— 而"用颜色说话"违反 AGENTS §5，所以必须给。 */
  const dayMarkerLabels = useMemo(
    () => ({
      off: t('common.calendar.dayMarker.off'),
      work: t('common.calendar.dayMarker.work'),
    }),
    [t],
  );

  /**
   * 滚轮翻月 / 翻周（产品负责人 2026-10-01：「上下滑动自由无限切换日历」）。
   *
   * 🔴 走的是**和页头那两个箭头同一个** `stepCalendarCursor` ——
   *   两边各算一遍"下一段"的结局是"点箭头翻一周、滚轮翻一月"。
   *   落到 store 上也只有 `setCursor` 这一个口子：只翻段、不动选中的那天，
   *   所以滚完之后侧栏与主区仍指着同一段（另写一份的结局见 `store.ts` 文件头）。
   *
   * `within` 只圈月历卡片：卡片下面那份当天清单需要正常滚页，
   * 把它一起吃掉的话指针停在那儿就再也滚不动了。
   */
  const wheelHost = useWheelMonthNav(
    (step) => {
      view.setCursor(stepCalendarCursor(view.view, view.cursor, step));
    },
    { within: `[data-testid="${BOARD_TEST_ID}-month-card"]` },
  );

  const onToggleTask = useCallback(
    (taskId: string) => {
      // 与象限板同一条规矩：忙碌时**直接丢掉**这一次点击，而不是排队 ——
      // 排队会让连点攒成一串变更，而用户以为自己只点了一下。
      if (busyId !== null) return;
      setBusyId(taskId);
      void store
        .toggleComplete(taskId)
        .catch(() => {
          // store 自己会把失败写进 status（见它的文件头）；这里只负责把忙碌标记放开，
          // 否则那一条会永远置灰。
        })
        .finally(() => {
          setBusyId(null);
        });
    },
    [busyId, store],
  );

  return (
    <HeytaUiProvider>
      {/*
        🔴 这一层**必须把 `.ht-content` 的确定高度传下去**（R11 批一"日历只占一半"的宿主那一刀）。
        共享板的根有 `flexGrow: 1`，但 `flexGrow` 只在**弹性容器**里生效 ——
        这一层原来是裸 `<div>`（块容器），于是板子只按内容长高，整月画在半屏里。
        样式挂在 `.ht-content__calendar-host`（见 `styles/app/main-area.css`），
        **不写内联 style**（`check:l4` 的内联样式棘轮只许降不许升）。
      */}
      <div ref={wheelHost} className="ht-content__calendar-host">
        {/*
          「说一句话落进选中那一格」（R11 批五，§9.3 差异化第 2 条）。
          滴答的 `+` 只能新建、落不进你正指着的那一格 —— 这里能，
          因为**本地优先**：选中哪天是这一屏的状态，捕获框就在同一屏拿得到它。

          🔴 落点由 `anchorDate` 交给共享层，**不在这里换算日期**
             （`toCaptureSubmitPlan` 那条优先级：输入里写了「明天」以输入为准）。
             也不叫 AI：这条是纯规则解析，零模型、不出境（ADR-0013 的
             `retention-undecided` 仍然挡着 `managed`，而这条根本不需要它）。
        */}
        {view.captureOpen ? (
          <CaptureComposer anchorDate={view.selected} />
        ) : null}
        <SharedCalendarBoard
          tasks={tasks}
          today={today}
          cursor={view.cursor}
          selected={view.selected}
          onCursorChange={view.setCursor}
          onSelect={view.selectDay}
          /* 🔴 批二：工具栏搬到**页头**（`CalendarHeaderToolbar`），板子里那份撤掉。
             与下面的 `onToday` 是**一对**：宿主接了跳回，工具栏才有那颗「今天」；
             两处不同时改，结局是"整屏没有回到今天的入口"或"同一屏两个入口"。 */
          toolbar="external"
          /* 档位由页头那个下拉决定（store 里唯一一份），板子只照它画。 */
          view={view.view}
          onToday={() => {
            // 「今天」跳回：选中今天 + 月份跟过去（与迷你月历的 ○ 同一条路径）。
            view.goToToday(today);
          }}
          onToggleTask={onToggleTask}
          busyTaskId={busyId}
          labels={labels}
          dayMarker={dayMarker}
          dayMarkerLabels={dayMarkerLabels}
          testID={BOARD_TEST_ID}
        />
      </div>
    </HeytaUiProvider>
  );
}
