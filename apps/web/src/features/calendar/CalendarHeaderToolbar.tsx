/**
 * 页头那个日历工具栏（Web 宿主）
 * ================================
 *
 * R11 批二：产品负责人对标滴答时说的"顶部工具栏那个 UX 值得抄"，
 * 抄的是**分工** —— 标题说"我在看哪一段"，`‹ ›` 说"在这段里移动"。
 * 所以这一格住在 `header.ht-header` 的 `.ht-header__actions` 里，
 * 和任务页那个排序下拉同一个位置、同一个锚点（`task-sort.spec.tsx` 钉的就是那里）。
 *
 * 🔴 渲染的是**共享层那个 `CalendarToolbar`**，不是这里重写一遍：
 * 板子在移动端仍然把同一个组件画在卡片里（那边没有页头插槽）。
 * 两端 testID 因此逐字相同（`calendar-toolbar-*`）——
 * 摆位一变就换一套 ID 的话，判据就得跟着摆位分叉。
 *
 * ⚠️ 视图档位用**原生 `<select>`**，与页头那个任务排序下拉同一模式
 * （理由抄在 `App.tsx` 那段与 `task-sort.spec.tsx`：暗色下不必自绘弹层，
 * 而 RN-web 的浮层还要处理焦点与 Esc —— §7 第 80 条那一串）。
 * 🔴 下拉里**只列真的能用的档位**（§9.3 明确不做的事：一排点了没反应的菜单项）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 R11 批五：那一档「时间线」**不是** `CalendarViewKind`
 *
 * §9.3 差异化第 3 条的原话是"把『按时间看』的两个入口合成一族"。所以它进的是
 * **同一个下拉**，而不是另造一个按钮 —— 但它的落点是外壳的另一个视图
 * （`App.tsx` 传下来的 `onOpenTimeline`，走的是与 rail 同一个 `goToView`），
 * 不是日历 store 里的一个字段。
 *
 * 于是这里必须**分叉**：把 `'timeline'` 塞进 `setView` 会得到一个
 * "下拉显示时间线、日历还是月历"的第三态，而**两头都不报错** ——
 * 那正是本仓库反复登记的那类"接上了线，没接通语义"。
 *
 * ⚠️ 它**只在这条路真能走通时出现**：`timelineEnabled=false`（功能模块关掉）时
 * 这一项不存在。判据不是"好看"，是 `contentView` **只看 `view`、不看开关** ——
 * 少这一道判断，这个下拉就成了绕过功能模块开关的第二条入口。
 *
 * ⚠️ **反方向刻意没做**：时间线那一屏的页头**没有**这个下拉（回日历走 rail）。
 * 要做就是把同一张控件挂在两处，而"当前档位"就有了第二个来源 ——
 * 那笔账记在 `docs/plans/ui-review-fill-zh-timeline.md` §9.10。
 */

import { toLocalDate } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import {
  CALENDAR_VIEW_LABEL_KEYS,
  CALENDAR_VIEW_ORDER,
  CalendarToolbar,
  type CalendarViewKind,
} from '@heyta/ui';

import { useTaskStore } from '../tasks/store.js';
import { useCalendarLabels } from './useCalendarLabels.js';
import { useCalendarViewStore } from './store.js';

/*
 * 档位与它们的键名**不在这里**（R17）：这里曾经写着一张 `{kind, key}[]`，
 * 而移动端写着同一件事的另外两份 —— 加一档要人记着改三处。
 * 唯一事实源在 `@heyta/ui` 的 `CALENDAR_VIEW_ORDER` / `CALENDAR_VIEW_LABEL_KEYS`，
 * 反抄件判据在 `apps/web/tests/calendar-view-tabs.spec.tsx`（本文件里出现档位键字面量就红）。
 */

/**
 * 「时间线」那个 `<option value>`。
 *
 * 🔴 它**刻意不是** `CalendarViewKind` 的成员，也因此绝不能被交给
 * `store.setView` —— `onChange` 里那一次分叉就是与这条边界的接缝。
 */
const TIMELINE_VALUE = 'timeline';

export interface CalendarHeaderToolbarProps {
  /** 功能模块「时间线」是否开着 —— 关掉时下拉里**不出现**这一档。 */
  timelineEnabled: boolean;
  /** 切到时间线视图（与 rail 上那个 tab **同一条路**：`App` 的 `goToView('timeline')`）。 */
  onOpenTimeline: () => void;
}

export function CalendarHeaderToolbar({
  timelineEnabled,
  onOpenTimeline,
}: CalendarHeaderToolbarProps): React.JSX.Element {
  const view = useCalendarViewStore();
  const labels = useCalendarLabels();
  const { t } = useI18n();
  /**
   * "今天"仍然**只有一个来源**：任务 store 的 `now`（与主区那块板同一个）。
   * 界面 store 不存时钟 —— 存了就会漂（翻到 12 月再放着不动，"今天"就变了）。
   */
  const now = useTaskStore((s) => s.now);

  return (
    <CalendarToolbar
      cursor={view.cursor}
      onCursorChange={view.setCursor}
      onToday={() => {
        // 与板子里那条**完全同一条路径**（`goToToday`）：选中今天 + 月份跟过去。
        view.goToToday(toLocalDate(now));
      }}
      labels={labels}
      view={view.view}
      trailing={
        <>
          {/*
            🔴 「+」住在页头、输入框住在主区（`CalendarView`）—— 两半隔着一个组件，
            所以开关状态在 store 里（`captureOpen`），不是这里的 `useState`。
            它说的是"往**选中那天**加一条"，与选中格是同一件事：
            界面上那一格已经圈着了，输入框的 placeholder 再重复一遍落点日期。
          */}
          <button
            type="button"
            className="ht-header__capture"
            data-testid="calendar-capture-toggle"
            aria-label={t('web.calendar.capture.add')}
            aria-expanded={view.captureOpen}
            onClick={() => {
              view.toggleCapture();
            }}
          >
            +
          </button>
          <label className="ht-header__view" data-testid="calendar-view-switch">
            {t('common.calendar.view.aria')}
            <select
              aria-label={t('common.calendar.view.aria')}
              data-testid="calendar-view-select"
              value={view.view}
              onChange={(e) => {
                const next = e.target.value;
                // 🔴 唯一的分叉点（见文件头）：`'timeline'` 走外壳，
                //    其余值直接交给 store —— **这里不做二次校验也不做映射表**，
                //    下拉里的 option 值就是 `CalendarViewKind` 的全部剩余取值。
                if (next === TIMELINE_VALUE) {
                  onOpenTimeline();
                  return;
                }
                view.setView(next as CalendarViewKind);
              }}
            >
              {CALENDAR_VIEW_ORDER.map((kind) => (
                <option key={kind} value={kind}>
                  {t(CALENDAR_VIEW_LABEL_KEYS[kind])}
                </option>
              ))}
              {timelineEnabled ? (
                <option value={TIMELINE_VALUE}>{t('web.shell.views.timeline')}</option>
              ) : null}
            </select>
          </label>
        </>
      }
    />
  );
}
