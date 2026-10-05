/**
 * 习惯视图（Web 壳）
 * ==================
 *
 * 产品负责人 2026-10-01 定的形态：**列表 + 面单**。
 *
 *   · 左列 `HabitsList` —— 一行一个习惯：行首图标、名字、最近 7 天打没打、
 *     三个具体数字（连续 / 最长 / 累计）。负责**扫一眼**。
 *   · 面单（`HabitDetailCard`）—— 选中那个习惯的 `@heyta/ui#HabitBoard`：打卡按钮、
 *     冻结说明、补打卡 / 重新开始、近 90 天热力图。负责**看细节**。
 *
 * 为什么要拆成两块而不是把板子从头列到尾：一条习惯的板子很高（热力图 90 格），
 * N 条纵向排下来，"我今天到底有没有断"要滚三屏才看得完 —— 而那正是这个视图
 * 唯一要回答的问题。滴答清单 / Streaks 都是同一取向：清单行给状态，展开给历史。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 面单**住在哪儿**不由本文件决定（工单 §8.133）
 *
 * `paneInColumn` 是**必填**布尔，值来自 `App.tsx` 的 `detailColumnShown`
 * （"那一栏放得下吗" = 几何 + 用户是否收起，算法只有一处，
 * 见 `../shell/detail-pane-visible.ts`）：
 *   · `true` ⇒ 面单在**详情列那一格**里（拍板 #1："选中某条 = 同一格换成该实体面单，
 *     不另开第三处"），本文件只剩列表，`.ht-habit` 收成单列；
 *   · `false` ⇒ 面单回到列表右边那一格（本文件落地前的唯一形状）。
 *
 * 🔴 刻意不是"默认值等于原行为"的可选 prop：那种写法会把"宿主没接"伪装成"做完了"
 * （§7 #195，而 §8.130 那一单为此把整档改成必填）。
 *
 * ⚠️ 不能只交给 CSS 藏：那一栏在窄档/收起态是 `display:none`，只靠它藏会得到一枚
 * **藏在看不见的地方**的板子 —— 选中态进了模型，界面上什么都没有。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 M3 第七刀之后，打卡与热力图**仍然只有 `packages/ui` 那一份实现**
 *
 * 拆两块改的是**布局**，不是渲染：面单传给 `HabitBoard` 的是
 * `habits={[选中那一条]}`，共享层对此一无所知（它只看到一个习惯的数组）。
 * 所以 `apps/web/tests/habits-board.spec.tsx` 的 E 组判据依然成立。
 *
 * ⚠️ 全页**只有一块** `HabitBoard`（`e2e/tests/motivation.spec.ts` 的白屏检测按
 * `[data-testid="habit-board"]` 数恰好 1）。`paneInColumn` 两支互斥，所以这一条
 * 在两种落点下都是 1 枚；两块板会让"哪一块是选中项"变成一个由 DOM 顺序而不是
 * 由状态决定的问题。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这个文件里不许出现"什么算打过 / 连续几天"的判断
 *
 * 数字全部来自 `selectHabitProgress` / `selectHeatmap`（薄转发到
 * `@heyta/ui#toHabitProgressRows` 与 `#habitHeatmap`）。连续 / 韧性的**配对**
 * 也不在这里：`HabitBoard` 的 `growth` prop 收函数，面单那边传
 * `@heyta/app-host#habitGrowth` —— 那是配对的唯一实现。
 *
 * 🔴 热力图不再用 `react-activity-calendar`：它是 **DOM 库**，而共享层必须只用
 * RN 原语。自绘之后失去的是库内置的悬停提示，补回来的方式是 `cellTooltip` 写
 * `data-cell-title` + `apps/web/src/styles/app.css` 的 `[data-cell-title]::after`。
 *
 * ⚠️ `HeytaUiProvider` 现在包在**面单**那一侧（`HabitDetailCard.tsx`）——
 * 本文件不再渲染任何共享板子，所以那一层 Provider 跟着搬走了。
 * `App.tsx` 的 Provider 只包 `tasks` 那棵树，习惯视图是它的**兄弟节点**，
 * M3 第二刀（focus）就是这样在运行时抛出「useHeytaUiTheme 必须在
 * <HeytaUiProvider> 内使用」的。`check:ui-provider` 认的是"哪个文件渲染 HabitBoard"，
 * 不是文件名 —— 搬家不会让它瞎，但它也不会替你补上漏掉的那层。
 */

import { useMemo, useState } from 'react';
import { ICON_SIZE } from '@heyta/design-system';
import { cssVar } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import { Plus } from 'lucide-react';

import { selection, useSelected } from '../../lib/selection.js';
import { HabitDetailCard } from './HabitDetailCard.js';
import { HabitsList, HABIT_ROW_WEEK_DAYS, type HabitsListRow } from './HabitsList.js';
import { readNow, selectHeatmap, selectHabitProgress, useHabitStore } from './store.js';

export function HabitsView({ paneInColumn }: { paneInColumn: boolean }): React.JSX.Element {
  const { t } = useI18n();
  const store = useHabitStore();
  const [draft, setDraft] = useState('');
  // 固定"现在"，避免同一次渲染里跨午夜导致不一致
  const now = readNow();

  /**
   * 左列的数据：进度行 + 它自己的 7 天窗口。
   *
   * ⚠️ `week` 与面单里那 90 天热力图**同一次 `now`、同一份 `habitHeatmap`**，
   * 只是窗口长度不同 —— 所以列表里那个点说"打过"，面单里那天必然是深色格。
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

  async function add(): Promise<void> {
    await store.addHabit(draft);
    setDraft('');
  }

  /**
   * 选中项的痕迹来源 = **共享选中态本身**。
   *
   * 🔴 本文件不再有 `selected`，也不再有任何回落（§8.131 撤掉了 `?? rows[0]`）：
   * 面单要画哪一条由 `HabitDetailCard` 自己按同一个 `useSelected('habit')` 决定，
   * 于是"痕迹指哪一行"和"面单画哪一条"读的是**同一个值**，不再有派生值中间掺一脚。
   */
  const selectedId = useSelected('habit');

  return (
    <div
      className="ht-habit"
      data-pane={paneInColumn ? 'column' : 'pane'}
      data-testid="habits-view"
    >
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
            <Plus size={ICON_SIZE.md} aria-hidden="true" />
          </button>
        </form>

        <HabitsList
          rows={rows}
          // 🔴 痕迹的输入**只能是共享选中态本身**，不是任何派生值（§8.131）。
          // 未选中时它是 null ⇒ 列表里零行带痕迹，与便签面（K8）同一口径。
          selectedId={selectedId}
          onSelect={(habitId) => {
            selection.select('habit', habitId);
          }}
        />
      </div>

      {paneInColumn ? null : <HabitDetailCard inset={false} />}
    </div>
  );
}
