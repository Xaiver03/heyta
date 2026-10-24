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

import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ICON_SIZE } from '@heyta/design-system';
import {
  DEFAULT_REVIEW_OFFSETS,
  HABIT_ICONS,
  toLocalDate,
  isoWeekday,
  type HabitFrequency,
  type HabitGoalType,
  type HabitIcon,
} from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { ChevronDown, Download, MoreHorizontal, Pencil, Plus, Smile, X } from 'lucide-react';
import { buildHabitExportRows, renderHabitCsv } from '@heyta/app-host';
import {
  EmptyState,
  HabitArtwork,
  HABIT_ICON_LABEL_KEYS,
  HABIT_WEEKDAY_MESSAGE_KEYS,
  HeytaUiProvider,
} from '@heyta/ui';

import { FormField } from '../../lib/form/FormField.js';
import { selection, useSelected } from '../../lib/selection.js';
import { downloadTextFile } from '../settings/export-download.js';
import { HabitDetailCard } from './HabitDetailCard.js';
import { HabitsList, HABIT_ROW_WEEK_DAYS, type HabitsListRow } from './HabitsList.js';
import { readNow, selectHeatmap, selectHabitProgress, useHabitStore } from './store.js';

export function HabitsView({ paneInColumn }: { paneInColumn: boolean }): React.JSX.Element {
  const { t } = useI18n();
  const store = useHabitStore();
  // 固定"现在"，避免同一次渲染里跨午夜导致不一致
  const now = readNow();
  const [draft, setDraft] = useState('');
  const [draftIcon, setDraftIcon] = useState<HabitIcon | undefined>();
  const [draftTarget, setDraftTarget] = useState('1');
  const [draftUnit, setDraftUnit] = useState('');
  const [draftGoalType, setDraftGoalType] = useState<HabitGoalType>('atLeast');
  const [draftFrequency, setDraftFrequency] = useState<'daily' | 'weekly' | 'interval' | 'spaced'>('daily');
  const [draftInterval, setDraftInterval] = useState('2');
  const [draftWeeklyDays, setDraftWeeklyDays] = useState<number[]>([isoWeekday(toLocalDate(now))]);
  /**
   * 间隔复习的那几个"第几天"（可改的那一版）。
   *
   * 🔴 草稿状态默认取 `DEFAULT_REVIEW_OFFSETS`（第 1/2/4/7/15/30 天），
   * 而那个常量住在 `@heyta/domain`：**四端必须同一张默认表**，
   * 在各宿主里各写一份会让"新建出来的复习计划"按端不同。
   */
  const [draftReview, setDraftReview] = useState<number[]>([...DEFAULT_REVIEW_OFFSETS]);
  const [draftBackfillDays, setDraftBackfillDays] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  /**
   * 图标面板默认**收起**（滴答的形状：点头像才展开）。
   *
   * 🔴 这不只是省地方：40 枚图标常驻会把"名称 → 频率 → 目标"这条主线下推三屏，
   *    而挑图标是**少数时候才做的事**。收起之后，这一屏的第一眼只回答一个问题：
   *    "我在建一个什么习惯"。
   */
  const [draftIconOpen, setDraftIconOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [addError, setAddError] = useState<string | undefined>();
  const [adding, setAdding] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
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
    if (adding || draft.trim() === '') return;
    const target = Number(draftTarget);
    const interval = Number(draftInterval);
    const backfillDays = draftBackfillDays.trim() === '' ? undefined : Number(draftBackfillDays);
    if (draftTarget.trim() === '' || !Number.isFinite(target) || target < 0) {
      setAddError(t('web.habits.goal.invalid'));
      setCreateOpen(true);
      return;
    }
    if (draftFrequency === 'interval' && (!Number.isInteger(interval) || interval < 1)) {
      setAddError(t('web.habits.freq.invalid'));
      return;
    }
    if (backfillDays !== undefined && (!Number.isInteger(backfillDays) || backfillDays < 1)) {
      setAddError(t('web.habits.backfill.invalid'));
      return;
    }
    if (draftFrequency === 'weekly' && draftWeeklyDays.length === 0) {
      setAddError(t('web.habits.freq.weeklyRequired'));
      return;
    }
    if (draftFrequency === 'spaced' && draftReview.length === 0) {
      // 空表 = 没有一天该复习（判定侧连续天数恒 0）。动作层也会抛，
      // 但在这里就拦下才说得清"点了几格"。
      setAddError(t('web.habits.freq.spacedRequired'));
      return;
    }
    setAddError(undefined);
    const frequency: HabitFrequency | undefined =
      draftFrequency === 'daily'
        ? undefined
        : draftFrequency === 'weekly'
          ? { type: 'weekly', daysOfWeek: draftWeeklyDays }
          : draftFrequency === 'spaced'
            ? // 🔴 起点 = **创建这一刻的本地日期**，不是"下一次打开对话框时的今天"。
              //    锚点会随这条 op 一起落盘，之后再不漂移（理由见 `habit-review.ts`）。
              { type: 'spaced', offsets: draftReview, anchor: toLocalDate(readNow()) }
            : { type: 'interval', everyNDays: interval };
    setAdding(true);
    try {
      await store.addHabit(draft, {
        target,
        unit: draftUnit.trim() === '' ? undefined : draftUnit,
        goalType: draftGoalType,
        icon: draftIcon,
        frequency,
        backfillDays,
      });
    } catch {
      setAddError(t('web.habits.add.failed'));
      return;
    } finally {
      setAdding(false);
    }
    setDraft('');
    setDraftIcon(undefined);
    setDraftTarget('1');
    setDraftUnit('');
    setDraftGoalType('atLeast');
    setDraftFrequency('daily');
    setDraftInterval('2');
    setDraftWeeklyDays([isoWeekday(toLocalDate(readNow()))]);
    setDraftReview([...DEFAULT_REVIEW_OFFSETS]);
    setDraftIconOpen(false);
    setDraftBackfillDays('');
    setCreateOpen(false);
  }

  useEffect(() => {
    if (!createOpen) return;
    const frame = window.requestAnimationFrame(() => nameInputRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !adding) {
        event.preventDefault();
        setCreateOpen(false);
        setAddError(undefined);
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled])',
      );
      if (focusable === undefined || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [adding, createOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  /**
   * 选中项的痕迹来源 = **共享选中态本身**。
   *
   * 🔴 本文件不再有 `selected`，也不再有任何回落（§8.131 撤掉了 `?? rows[0]`）：
   * 面单要画哪一条由 `HabitDetailCard` 自己按同一个 `useSelected('habit')` 决定，
   * 于是"痕迹指哪一行"和"面单画哪一条"读的是**同一个值**，不再有派生值中间掺一脚。
   */
  const selectedId = useSelected('habit');
  const exportCheckins = (): void => {
    const rows = buildHabitExportRows(store.habits, store.logs);
    const csv = renderHabitCsv(rows, {
      date: t('web.habits.export.date'),
      habit: t('web.habits.export.habit'),
      value: t('web.habits.export.value'),
      unit: t('web.habits.export.unit'),
      completed: t('web.habits.export.completed'),
      completedValue: t('web.habits.export.completedValue'),
      incompleteValue: t('web.habits.export.incompleteValue'),
      note: t('web.habits.export.note'),
    });
    const stamp = new Date(readNow()).toISOString().slice(0, 10);
    downloadTextFile(`heyta-habits-${stamp}.csv`, csv, 'text/csv;charset=utf-8');
    setMenuOpen(false);
  };

  const headerSlot = typeof document === 'undefined'
    ? null
    : document.querySelector<HTMLElement>('[data-habits-header-slot]');

  const headerControls = headerSlot
    ? createPortal(
        <div className="ht-header__habits-controls">
          <button
            type="button"
            className="ht-btn ht-btn--ghost"
            aria-label={t('web.habits.add')}
            data-testid="habits-add-open"
            onClick={() => {
              setAddError(undefined);
              setCreateOpen(true);
            }}
          >
            <Plus size={ICON_SIZE.md} aria-hidden="true" />
          </button>
          <span className="ht-header__habits-menu-wrap">
            <button
              type="button"
              className="ht-btn ht-btn--ghost"
              aria-label={t('web.habits.menu.label')}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              data-testid="habits-more"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MoreHorizontal size={ICON_SIZE.md} aria-hidden="true" />
            </button>
            {menuOpen ? (
              <div className="ht-header__habits-menu" role="menu" data-testid="habits-menu">
                <button type="button" role="menuitem" onClick={exportCheckins}>
                  <Download size={ICON_SIZE.sm} aria-hidden="true" />
                  {t('web.habits.export.action')}
                </button>
              </div>
            ) : null}
          </span>
        </div>,
        headerSlot,
      )
    : null;

  const createDialog = createOpen
    ? createPortal(
        <div
          className="ht-habit-create-dialog"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !adding) setCreateOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            className="ht-habit-create-dialog__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ht-habit-create-title"
            data-testid="habit-create-dialog"
          >
            <header className="ht-habit-create-dialog__header">
              <h2 id="ht-habit-create-title" className="ht-type-section-title">{t('web.habits.create.title')}</h2>
              <button type="button" className="ht-habit-create-dialog__close" aria-label={t('web.habits.create.close')} onClick={() => setCreateOpen(false)} disabled={adding}>
                <X size={ICON_SIZE.sm} aria-hidden="true" />
              </button>
            </header>
            <form
              className="ht-habit-create-dialog__form"
              onSubmit={(event) => {
                event.preventDefault();
                void add();
              }}
            >
              <div className="ht-habit-create-dialog__body">
                {/* ── 名称 + 头像 ──────────────────────────────────────────
                    `FormField` 的 `inline` 解剖：标签列里放的是**头像**，
                    名字输入框在右列。没有"新习惯名称"这行字 —— 占位符 + `aria-label`。
                    点头像展开图标面板（收起态的理由见 `draftIconOpen` 的注释）。 */}
                <FormField
                  id="ht-habit-create-name"
                  label={t('web.habits.addLabel')}
                  layout="inline"
                  required
                  leading={
                    <button
                      type="button"
                      className="ht-habit-create-dialog__avatar"
                      aria-label={t('web.habits.icon.toggle')}
                      aria-expanded={draftIconOpen}
                      aria-controls="ht-habit-create-icons"
                      data-testid="habit-create-icon-toggle"
                      onClick={() => setDraftIconOpen((was) => !was)}
                      disabled={adding}
                    >
                      {draftIcon === undefined ? (
                        <Smile size={ICON_SIZE.lg} aria-hidden="true" />
                      ) : (
                        <HabitArtwork icon={draftIcon} size={ICON_SIZE.lg} />
                      )}
                      <span className="ht-habit-create-dialog__avatar-pencil" aria-hidden="true">
                        <Pencil size={ICON_SIZE.xs} />
                      </span>
                    </button>
                  }
                >
                  {(field) => (
                    <input
                      {...field}
                      aria-label={t('web.habits.addLabel')}
                      ref={nameInputRef}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder={t('web.habits.addPlaceholder')}
                      disabled={adding}
                    />
                  )}
                </FormField>

                {draftIconOpen ? (
                  <div
                    id="ht-habit-create-icons"
                    className="ht-habit-create-dialog__icons"
                    role="group"
                    aria-label={t('web.habits.icon.group')}
                  >
                    {HABIT_ICONS.map((icon) => (
                      <button
                        key={icon}
                        type="button"
                        className="ht-habit-create-dialog__icon"
                        aria-label={t(HABIT_ICON_LABEL_KEYS[icon])}
                        aria-pressed={draftIcon === icon}
                        onClick={() => setDraftIcon(icon)}
                        disabled={adding}
                      >
                        <HabitArtwork icon={icon} size={ICON_SIZE.lg} />
                      </button>
                    ))}
                    {/* "默认"在这里的意思是"不指定"——落盘后由 id 派生，
                        与详情面板 `HabitIconPicker` 里那格同一语义。 */}
                    <button
                      type="button"
                      className="ht-habit-create-dialog__icon ht-habit-create-dialog__icon--default"
                      aria-pressed={draftIcon === undefined}
                      onClick={() => setDraftIcon(undefined)}
                      disabled={adding}
                    >
                      {t('web.habits.icon.default')}
                    </button>
                  </div>
                ) : null}

                {/* ── 频次（含它自己的条件行）─────────────────────────── */}
                <FormField
                  id="ht-habit-create-freq"
                  label={t('web.habits.freq.toggle')}
                  layout="inline"
                >
                  {(field) => (
                    <>
                      <div className="ht-field__select">
                        <select
                          {...field}
                              value={draftFrequency}
                          onChange={(event) => {
                            const next = event.target.value as typeof draftFrequency;
                            setDraftFrequency(next);
                            if (next === 'weekly' && draftWeeklyDays.length === 0) {
                              setDraftWeeklyDays([isoWeekday(toLocalDate(now))]);
                            }
                          }}
                          disabled={adding}
                        >
                          <option value="daily">{t('web.habits.freq.daily')}</option>
                          <option value="weekly">{t('web.habits.freq.weekly')}</option>
                          <option value="interval">{t('web.habits.freq.interval')}</option>
                          <option value="spaced">{t('web.habits.freq.spaced')}</option>
                        </select>
                        <ChevronDown size={ICON_SIZE.sm} aria-hidden="true" />
                      </div>

                      {draftFrequency === 'weekly' ? (
                        <div
                          className="ht-habit-create-dialog__tiles"
                          role="group"
                          aria-label={t('web.habits.freq.weekly')}
                        >
                          {HABIT_WEEKDAY_MESSAGE_KEYS.map((key, index) => {
                            const day = index + 1;
                            const selected = draftWeeklyDays.includes(day);
                            return (
                              <button
                                key={key}
                                type="button"
                                className="ht-habit-create-dialog__tile"
                                aria-pressed={selected}
                                onClick={() =>
                                  setDraftWeeklyDays((days) =>
                                    selected ? days.filter((value) => value !== day) : [...days, day].sort(),
                                  )
                                }
                                disabled={adding}
                              >
                                {t(key as never)}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}

                      {draftFrequency === 'interval' ? (
                        <input
                              aria-label={t('web.habits.freq.nDays')}
                          type="number"
                          min={1}
                          step={1}
                          required
                          value={draftInterval}
                          onChange={(event) => setDraftInterval(event.target.value)}
                          disabled={adding}
                        />
                      ) : null}

                      {draftFrequency === 'spaced' ? (
                        /* 复习日**可以改**：默认那六档只是默认，不是唯一正确答案。
                           文案是事实口径（第几天），不做任何"科学有效"的背书 ——
                           红线写在 `packages/domain/src/habit-review.ts` 的文件头。 */
                        <div
                          className="ht-habit-create-dialog__tiles"
                          role="group"
                          aria-label={t('web.habits.freq.spaced')}
                        >
                          {DEFAULT_REVIEW_OFFSETS.map((offset) => {
                            const selected = draftReview.includes(offset);
                            return (
                              <button
                                key={offset}
                                type="button"
                                className="ht-habit-create-dialog__tile"
                                aria-pressed={selected}
                                aria-label={t('web.habits.freq.spacedDay', { n: String(offset) })}
                                onClick={() =>
                                  setDraftReview((days) =>
                                    selected
                                      ? days.filter((value) => value !== offset)
                                      : [...days, offset].sort((a, b) => a - b),
                                  )
                                }
                                disabled={adding}
                              >
                                {t('web.habits.freq.spacedDayShort', { n: String(offset) })}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </>
                  )}
                </FormField>

                {/* ── 目标：数值 + 单位在同一行 ─────────────────────────── */}
                <FormField
                  id="ht-habit-create-target"
                  label={t('web.habits.goal.target')}
                  layout="inline"
                >
                  {() => (
                    <div className="ht-field__pair">
                      <input
                          aria-label={t('web.habits.goal.target')}
                        type="number"
                        min={0}
                        step="any"
                        required
                        value={draftTarget}
                        onChange={(event) => setDraftTarget(event.target.value)}
                        disabled={adding}
                      />
                      <input
                          aria-label={t('web.habits.goal.unit')}
                        value={draftUnit}
                        placeholder={t('web.habits.goal.unitPlaceholder')}
                        onChange={(event) => setDraftUnit(event.target.value)}
                        disabled={adding}
                      />
                    </div>
                  )}
                </FormField>

                {/* ── 达成口径 ─────────────────────────────────────────── */}
                <FormField
                  id="ht-habit-create-goal"
                  label={t('web.habits.goal.mode')}
                  layout="inline"
                >
                  {(field) => (
                    <div className="ht-field__select">
                      <select
                        {...field}
                          value={draftGoalType}
                        onChange={(event) => setDraftGoalType(event.target.value as HabitGoalType)}
                        disabled={adding}
                      >
                        <option value="atLeast">{t('web.habits.goal.atLeast')}</option>
                        <option value="atMost">{t('web.habits.goal.atMost')}</option>
                        <option value="exactly">{t('web.habits.goal.exactly')}</option>
                      </select>
                      <ChevronDown size={ICON_SIZE.sm} aria-hidden="true" />
                    </div>
                  )}
                </FormField>

                {/* 唯一一条分隔线：上面是"这条习惯是什么"（必填），
                    下面是"漏了怎么补"（可选）。线 = 组数 − 1。 */}
                <div className="ht-habit-create-dialog__divider" role="presentation" />

                {/* ── 补打卡 ───────────────────────────────────────────── */}
                <FormField
                  id="ht-habit-create-backfill"
                  label={t('web.habits.backfill.label')}
                  layout="inline"
                  hint={t('web.habits.backfill.default')}
                >
                  {(field) => (
                    <input
                      {...field}
                      type="number"
                      min={1}
                      step={1}
                      value={draftBackfillDays}
                      placeholder={t('web.habits.backfill.placeholder')}
                      onChange={(event) => setDraftBackfillDays(event.target.value)}
                      disabled={adding}
                    />
                  )}
                </FormField>
              </div>

              {addError ? (
                <p className="ht-habit__add-error" role="alert">
                  {addError}
                </p>
              ) : null}

              <footer className="ht-habit-create-dialog__actions">
                <button
                  type="button"
                  className="ht-btn ht-btn--ghost"
                  onClick={() => setCreateOpen(false)}
                  disabled={adding}
                >
                  {t('web.habits.create.cancel')}
                </button>
                <button
                  type="submit"
                  className="ht-btn ht-btn--primary"
                  disabled={adding || draft.trim() === ''}
                >
                  {t('web.habits.create.submit')}
                </button>
              </footer>
            </form>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div
      className="ht-habit"
      data-pane={paneInColumn ? 'column' : 'pane'}
      data-empty={rows.length === 0 ? '' : undefined}
      data-testid="habits-view"
    >
      {headerControls}
      {createDialog}
      <div className="ht-habit__side">

        {rows.length === 0 ? (
          <HeytaUiProvider>
            <EmptyState
              illustration="habits"
              title={t('web.habits.empty.title')}
              hint={t('web.habits.empty.hint')}
              testID="habits-empty"
            />
          </HeytaUiProvider>
        ) : (
          <HabitsList
            rows={rows}
            // 🔴 痕迹的输入**只能是共享选中态本身**，不是任何派生值（§8.131）。
            // 未选中时它是 null ⇒ 列表里零行带痕迹，与便签面（K8）同一口径。
            selectedId={selectedId}
            onSelect={(habitId) => {
              selection.select('habit', habitId);
            }}
          />
        )}
      </div>

      {paneInColumn ? null : <HabitDetailCard inset={false} />}
    </div>
  );
}
