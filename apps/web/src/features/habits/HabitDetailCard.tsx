/**
 * 习惯面单 —— **同一块板子，两个落点**（工单 §8.133）
 * =================================================
 *
 * 落点由宿主决定（拍板 #1："选中某条 = 同一格换成该实体面单，不另开第三处"）：
 *   · 详情列放得下且没被收起 ⇒ 渲染在 `.ht-app__detail` 里（`App.tsx` 那一支）；
 *   · 否则 ⇒ 渲染在习惯列表**右边**那格（`HabitsView` 那一支，也就是本文件落地前的唯一形状）。
 * 两支永不同时存在（`HabitsView` 拿的是同一个布尔的反向），所以 DOM 里始终只有一块
 * `[data-testid="habit-board"]` —— 这条既是 `e2e/tests/motivation.spec.ts` 的白屏检测，
 * 也是 `habits-list-pane.spec.tsx` C 组那条"全页只有一块板"的判据。
 *
 * 🔴 为什么单独一个文件而不是在 `HabitsView` 里渲染两遍：板子的接线
 * （打卡/撤销的置灰、图标与目标那两个插槽、改名表单的状态、空态措辞）抄两遍
 * 迟早会漂 —— AGENTS §3.5 那两条"抽出实现却没删旧的"事故就是这个形状。
 *
 * 🔴 为什么这里**没有**"猜第一条"的回落：那一档在 §8.131 被撤掉，撤的理由是它让
 * `aria-current` 说"第一条选中"而共享选中态说"没选中"。面单搬进那一栏之后，
 * 这个矛盾会从"两列之间"变成"栏目与那一栏之间"，所以未选中时这里老老实实说
 * "选一条习惯"（`paneEmptyText`），不画任何一条的数据。
 *
 * ⚠️ 自带一层 `HeytaUiProvider`：共享 `HabitBoard` 会 `useHeytaUiTheme()`，
 * 落在 Provider 外会在运行时抛（`check:ui-provider` 拦的就是这个，
 * 而 `App.tsx` 里那层 Provider 覆盖不到详情列）。
 */
import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { habitGrowth } from '@heyta/app-host';
import { cssVar, ICON_SIZE } from '@heyta/design-system';
import { parseCategorySlot, toLocalDate, type Habit, type LocalDate } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import {
  HabitBoard,
  HabitTrendBoard,
  HeytaUiProvider,
  type HabitBoardLabels,
  type HabitTrendLabels,
} from '@heyta/ui';
import { Check, Pencil, Trash2, X } from 'lucide-react';

import { selection, useSelected } from '../../lib/selection.js';
import { ColorSlotPicker } from '../categories/ColorSlotPicker.js';
import { HabitFrequencyEditor } from './HabitFrequencyEditor.js';
import { HabitGoalEditor } from './HabitGoalEditor.js';
import { HabitIconPicker } from './HabitIconPicker.js';
import { habitBoardLabels, habitMonthLabels, habitTrendTabs, habitYearLabels, paneEmptyText } from './board-labels.js';
import { readNow, useHabitStore } from './store.js';

/*
  这三个是**模块级常量**而不是 `style={{…}}` 字面量：后者会被
  `scripts/check-l4-no-style.mjs` 按出现次数计进棘轮（web 上限 104）。
  值与搬过来之前逐字相同（字段高 = `touch-target.min`、字号 ≥16px 防 iOS Safari
  聚焦缩放），只是换了宿主文件 —— 本单不该顺手把内联样式换成类。

  ⚠️ 标题那一行**不在这里**：`.ht-habit__pane-head` / `-title` / `-tools` 是类而不是
  内联样式（§8.134）。理由不是整洁 —— 是这一行**要靠几何判据守**（工具必须与标题同行、
  且在页头之下），而 `style={{…}}` 里的 `alignItems: 'baseline'` 在 jsdom 里读不出来。
*/
const renameFormStyle: CSSProperties = {
  display: 'flex',
  gap: cssVar('space.1'),
  marginTop: cssVar('space.2'),
};

const renameInputStyle: CSSProperties = {
  flex: 1,
  minHeight: cssVar('touch-target.min'),
  fontSize: cssVar('font-size.base'),
};

const iconButtonStyle: CSSProperties = {
  minWidth: cssVar('touch-target.min'),
  minHeight: cssVar('touch-target.min'),
};

/**
 * @param inset 是否带**详情列那一栏的内边距**。
 * 🔴 必填，且刻意不是"默认值等于原行为"：`check:detail-pane-slot` 那条门禁不许装配处
 * 手写 DOM 标记（`<div className=…>` 写在 `App.tsx` 的槽里就是它抓的形状），
 * 所以这一层壳只能住在**生产者**里 —— 而住进来之后，"哪一支带 inset"必须显式说清，
 * 不能让列表那一支悄悄继承一个默认值。
 */
export function HabitDetailCard({ inset }: { inset: boolean }): React.JSX.Element {
  const { t } = useI18n();
  const store = useHabitStore();
  /** 正在落盘的习惯 —— 置灰它那一行的按钮，防连点发出两条 op。 */
  const [busyId, setBusyId] = useState<string | null>(null);
  /**
   * 面板**正在改名**的那一条的 id（不是布尔）。
   *
   * 🔴 存 id 的理由与移动端同一句话：换一条习惯时编辑器不能跟着留在屏幕上 ——
   * 布尔做不到这件事，而它做到的那一次就是"把 A 的名字存到了 B 上"。
   */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const now = readNow();

  /**
   * 这一栏展开的那一条 = **共享选中态**，不是又一个本地状态，也没有本地回落。
   *
   * 🔴 存 id 不存对象：`store.habits` 每次 op 后都是新数组，握住对象会让面单显示一份
   * 过期的名字 / 目标。渲染时从 `store.habits` 现取。
   */
  const selectedId = useSelected('habit');
  const selected = store.habits.find((habit) => habit.id === selectedId);

  /**
   * 空态那句**取决于为什么空**（§8.131）：列表是空的 ⇒ "还没有习惯"；
   * 有习惯但没选中 ⇒ "选一条习惯…"。两条不许互相冒充。
   */
  const labels = useMemo<HabitBoardLabels>(
    () => ({
      ...habitBoardLabels(t),
      empty: paneEmptyText(t, store.habits.length > 0),
    }),
    [t, store.habits.length],
  );

  /** 月历的文案（工单 H4）。六档句子与列头表都在共享层，这里只注入措辞。 */
  const monthLabels = useMemo(() => habitMonthLabels(t), [t]);
  // 「月 ⇄ 年」切换器的文案 + 年那一档的文案（工单 H7）。游标住在共享容器里，
  // 宿主不另存一份 —— 两档共用同一枚游标，各存各的会不需要错误就漂。
  const trendLabels = useMemo<HabitTrendLabels>(
    () => ({ tabs: habitTrendTabs(t), month: monthLabels, year: habitYearLabels(t) }),
    [t, monthLabels],
  );

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
   * 目标与**频次**这两个编辑入口。
   *
   * 🔴 与 `renderColorSlot` 同一个形状：**编辑控件留在各端**，共享的 `HabitBoard`
   * 只负责把位置让出来（`renderGoalSlot`）。这里**不判断业务**（合法与否在 action 层）。
   *
   * 🔴 频次为什么**跟着这一条插槽**而不是新加一条 `renderFrequencySlot`：
   *    共享层那条新插槽只能是**可选**的（否则移动端不传就编译不过），而可选插槽
   *    正是 §7 第 195 条点名的形状 —— "默认值等于原值的可选 prop 会把'宿主没接'
   *    伪装成'做完了'"，typecheck 与既有门禁全绿。这一行让出来的是
   *    **"这条习惯的规则"**那一格，目标与频次说的都是它，放一起是同一件事的两个字段。
   *
   * ⚠️ 刻意**不包 `run()`**：`run()` 只 `.finally()`，没有 `.catch` ——
   * 而 `setHabitGoal` / `setHabitFrequency` 都会 reject（非法数值 / 非法频次 / 找不到习惯）。
   * 交给编辑器自己接住，它才显示得出那行错误（直接交给 `run` 会变成
   * 一条 unhandled rejection，用户看到的是"点了没反应"）。
   */
  const renderGoalSlot = useCallback(
    (habit: Habit): ReactNode => (
      <>
        <HabitGoalEditor habit={habit} onSetGoal={(goal) => store.setHabitGoal(habit.id, goal)} />
        <HabitFrequencyEditor
          habit={habit}
          today={toLocalDate(now)}
          onSet={(frequency) => store.setHabitFrequency(habit.id, frequency)}
        />
      </>
    ),
    [store, now],
  );

  // 空数据时空态属于列表侧；不挂载一个只剩空白的详情面板。
  if (store.habits.length === 0) return <></>;

  return (
    <div
      className={inset ? 'ht-habit__pane ht-app__detail-habit' : 'ht-habit__pane'}
      data-testid="habit-pane"
      // 🔴 `tabIndex={-1}` 是给**键盘光标**用的落点（工单 W1b 第 3 条腿）：在选中那一行上按
      // Enter，焦点交给这一格（`keyboard-cursor.ts#openPane` 按 `[data-testid="habit-pane"]` 找）。
      // 不是"-1 就能进 Tab 序列"（恰恰相反，-1 只许程序聚焦），也不指望它自己可见 ——
      // 可见性由设计系统的**全局** `:focus-visible`（`packages/design-system/src/reset.css:119`）
      // 负责。这里**刻意不另写一条**：§8.137 那一臂（撤掉本组件自己那条环规则）实测照出
      // 两条给的是同一套 token，写在这里就是第二份所有者（AGENTS §5：焦点样式不许组件自己发明）。
      tabIndex={-1}
      aria-label={selected === undefined ? undefined : t('web.habits.pane.aria', { name: selected.name })}
    >
      {selected === undefined ? null : (
        <>
          <div className="ht-habit__pane-head">
            {/*
              🔴 标题行是 §8.133 **看图照出来的那一处**，修在 §8.134：三颗工具原来单独
              浮在栏顶，与页头那排图标同高、离它们真正说话的卡片隔着一整段空白 —— 读起来像
              **页头的工具条**而不是"这条习惯的工具"。搬进那一栏之前不会这样（窗格在内容列里，
              上面就是本页的页标题）。修法是把工具挂到**这一栏自己的第一行**上，与所选那条的名字同行。
              ⚠️ 看图读数：这一行的**纵向带没变**（详情列的顶就是页头的顶），归属是靠
              "左边写着这条习惯的名字"建立的 —— 那一半要动列结构，登记成边界，不在这里顺手做。
            */}
            <h2 className="ht-habit__pane-title">{selected.name}</h2>
            <div className="ht-habit__pane-tools">
              <HabitIconPicker
                habit={selected}
                onChange={(icon) => {
                  void store.setHabitIcon(selected.id, icon);
                }}
              />
              {/*
                🔴 改名与删除此前**只有动作层有、界面没有**：`store.deleteHabit`
                早就存在却零调用点，`renameHabit` 是后来才补的。于是 web 上
                "建错了改不了、不想要了删不掉"，而界面上看不出这是缺功能 ——
                它长得和"做完了"一模一样。
              */}
              <button
                type="button"
                aria-label={t('common.habits.rename.button', { name: selected.name })}
                onClick={() => {
                  setRenamingId(selected.id);
                  setRenameDraft(selected.name);
                }}
                style={iconButtonStyle}
              >
                <Pencil size={ICON_SIZE.sm} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={t('common.habits.delete.button', { name: selected.name })}
                onClick={() => {
                  // 先收编辑器再发 op：名字改到一半把习惯删掉，编辑器会指着一条
                  // 已经不存在的习惯（保存按钮还在，而动作层会抛"找不到习惯"）。
                  setRenamingId(null);
                  void store.deleteHabit(selected.id);
                }}
                style={iconButtonStyle}
              >
                <Trash2 size={ICON_SIZE.sm} aria-hidden="true" />
              </button>
            </div>
          </div>

          {renamingId === selected.id ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const id = selected.id;
                const next = renameDraft.trim();
                setRenamingId(null);
                // 空名字与"一个字没改"都不发 op（一次点击 = 一个意图）。
                if (next === '' || next === selected.name) return;
                void store.renameHabit(id, next);
              }}
              style={renameFormStyle}
            >
              <input
                autoFocus
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                aria-label={t('common.habits.rename.label')}
                style={renameInputStyle}
              />
              <button type="submit" aria-label={t('common.organizer.rename.save')} style={iconButtonStyle}>
                <Check size={ICON_SIZE.sm} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={t('common.organizer.rename.cancel')}
                onClick={() => {
                  setRenamingId(null);
                }}
                style={iconButtonStyle}
              >
                <X size={ICON_SIZE.sm} aria-hidden="true" />
              </button>
            </form>
          ) : null}
        </>
      )}

      <HeytaUiProvider>
        <HabitBoard
          // 🔴 只给选中的那一条（见上面那块注释：全页一块板）。没选中时传 []，
          //    由共享层渲染 `labels.empty` —— 不在这里另写一句空态。
          habits={selected === undefined ? [] : [selected]}
          logs={store.logs}
          now={now}
          // 🔴 配对函数来自 app-host —— 共享层不认识它（见那边的文件头）。
          growth={habitGrowth}
          labels={labels}
          onCheckIn={(habitId, date?: LocalDate, value?: number) => {
            run(habitId, store.checkIn(habitId, date, value));
          }}
          onUndoCheckIn={(habitId, date?: LocalDate) => {
            run(habitId, store.undoCheckIn(habitId, date));
          }}
          busyHabitId={busyId}
          renderColorSlot={renderColorSlot}
          renderGoalSlot={renderGoalSlot}
          testID="habit-board"
        />
        {/*
          工单 H4（月历）+ H7（年那一档）：**这格是宿主直接挂的兄弟节点**，不是给 `HabitBoard`
          新加一条 `renderMonthBoard?` 插槽。理由是 §7 第 195 条：那条插槽只能是可选的（移动端
          没接就编译不过），而"默认值等于原值的可选 prop"会把"宿主没接"伪装成"做完了"，
          typecheck 与既有门禁全绿。挂在这里就没有这个形状 —— 不接就是没有。

          ⚠️ 只有选中那一条才渲染（与板子同一个分母）：没选中时这里没有"哪条习惯的月历"
          这件事，画一张空历比不画更容易被读成"这习惯没记录"。
        */}
        {selected === undefined ? null : (
          <HabitTrendBoard
            habit={selected}
            logs={store.logs}
            today={toLocalDate(now)}
            labels={trendLabels}
            onCheckIn={(habitId, date) => {
              run(habitId, store.checkIn(habitId, date));
            }}
            onUndoCheckIn={(habitId, date) => {
              run(habitId, store.undoCheckIn(habitId, date));
            }}
            busy={busyId === selected.id}
            testID="habit-trend"
          />
        )}
      </HeytaUiProvider>
    </div>
  );
}
