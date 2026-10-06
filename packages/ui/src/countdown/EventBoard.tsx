/**
 * 倒数日/纪念日板（共享视图，W5）
 * ================================
 *
 * 与 `NotesBoard` / `HabitBoard` 同一个立场：**"一条倒数日长什么样、按什么顺序、
 * 有哪几个二级操作"只有这一个实现**。web / mobile / 原生壳只决定它放在页面的哪里、
 * 文案键怎么填、以及把回调接到各自的 action 层。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这一层没有任何判断
 *
 * 顺序、两副面孔的算术、闰月怎么算、什么算归档、清除字段写 `null` 还是省略 ——
 * 全在 `@heyta/domain/events.ts` 与 `@heyta/app-host/event-actions.ts`。
 * 本文件只调 `./model.ts` 的转换，并且**一次都不 `sort()`**：各端各排一次的结局是
 * 同一批卡在不同设备上顺序不同，而没有任何测试会红（`NotesBoard` 文件头写的正是
 * 那个已经发生过的事故）。
 *
 * ## 🔴 失败要看得见，而且**不清草稿**
 *
 * `onAdd` 的契约是 `Promise<boolean>`：`true` 才清空输入行。
 * 便签那边登记在案的那条高危（"失败静默吞掉还清空草稿"）在这里**不复制** ——
 * 用户按了添加、字没了、列表里什么都没多出来，他会以为按钮坏了。
 * `error` 由宿主填（校验的权威在动作层），这一层只负责把它**画出来**。
 *
 * ## 🔴 二级操作用**卡内展开**，不用浮层
 *
 * `packages/ui` 进不来 DOM 标签，而浮层要定位、层级、点外部关闭、焦点陷阱 ——
 * 四端各写一套的代价在 `AccountMenu` 那条线上已经付过一次（W0 的
 * `placeAnchoredPanel` 服务的是**宿主自己的**浮层，不是这里）。
 * 所以 `⋯` 展开的是卡内一行动作，与 `HabitIconPicker` / `ColorSlotPicker`
 * 的"展开式按钮，不是浮层"是同一个裁决。
 *
 * ## 🔴 一次保存 = 一个 op（AGENTS §3.4）
 *
 * 编辑器提交的是 `onPatch(id, patch)` **一次**：改了哪几项就带哪几项。
 * 全部没改时**连这一次调用都不发**（空 op 会让另一端的时钟白进一格）。
 *
 * ## 🔴 逾期不飘红（§2.7）
 *
 * `face === 'since'` 只换措辞，**不换颜色**：那个数永远用正文前景色，
 * 强调条也不会因为它变红。`color.danger` 在这个文件里只出现在
 * "上一次写入失败"那一个框的边框上，与天数无关。
 *
 * ## 预置模板 = 分类色板那 8 格（§2.3）
 *
 * 第一版**没有**自定义颜色、没有背景图（背景图是素材图，要走客户端加密通道，§2.8）。
 * 取色直接复用 `categorySlotToken`（同一张被 WCAG 实测过的色板），
 * 而且只画在**左侧强调条**上：分类色当文字色没有被对比度测试覆盖，
 * 而 `check:text-color` 拦的正是那件事。
 *
 * ⚠️ **图标这一版不画**：`CountdownEvent.icon` 字段已在（可写、可同步），
 * 但界面上没有选择器 —— 词表与字形映射现在住在 habits 那侧
 * （`@heyta/domain#HABIT_ICONS` + `apps/web/src/features/habits/habit-glyphs.ts`），
 * 要复用就得把那张表的**命名**从"习惯"泛化出来，而那是习惯线的文件。
 * 复制一份 = 一定漂（本文 §7 的立场），所以登记成缺口而不是抄一份。
 */

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { HeytaNativeTokens } from '@heyta/design-system';
import type { CategorySlot, CountdownEvent, CountdownEventKind, LocalDate } from '@heyta/domain';
import { CATEGORY_SLOTS } from '@heyta/domain';
import {
  Archive,
  CalendarDays,
  Check,
  Download,
  Ellipsis,
  Hourglass,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide';

import { categorySlotToken } from '../categories/model.js';
import { DatePicker, type DatePickerLabels } from '../date-picker/DatePicker.js';
import { EmptyState } from '../empty-state/EmptyState.js';
import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import {
  COUNTDOWN_FILTERS,
  cardTextsFor,
  filterEventCards,
  toEventCards,
  toEventRows,
  type CountdownFace,
  type CountdownFilter,
  type CountdownView,
  type EventCard,
  type EventCardTexts,
} from './model.js';

/** 面板全部文案，**每一项都由宿主注入**（`@heyta/ui` 不 import `@heyta/i18n`）。 */
export interface EventBoardLabels {
  readonly empty: string;
  readonly emptyHint: string;
  readonly archivedEmpty: string;
  readonly archivedEmptyHint: string;
  readonly composerPlaceholder: string;
  readonly add: string;
  /** 还没选日期时日期按钮上的字。 */
  readonly pickDate: string;
  /** 本地化地把 `2026-12-31` 说成"12月31日"（格式化归宿主 —— locale 在那一侧）。 */
  readonly formatDate: (date: LocalDate) => string;
  readonly filterName: (filter: CountdownFilter) => string;
  readonly viewActive: string;
  readonly viewArchived: string;
  /** 三副面孔的措辞。🔴 `since` 那一句不许写成"你错过了"。 */
  readonly faceText: (face: CountdownFace, days: number) => string;
  /** 「已经 N 天」那一句（只与自己的过去比）。 */
  readonly ageText: (days: number) => string;
  readonly badgePinned: string;
  readonly pin: string;
  readonly unpin: string;
  readonly edit: string;
  readonly save: string;
  readonly cancel: string;
  readonly archive: string;
  readonly unarchive: string;
  readonly remove: string;
  readonly fieldTitle: string;
  readonly fieldDate: string;
  readonly fieldKind: string;
  readonly kindName: (kind: CountdownEventKind) => string;
  /** 「不选类型」那一个（回到按日期方向派生）。 */
  readonly kindUnset: string;
  readonly yearly: string;
  readonly lunar: string;
  readonly fieldTemplate: string;
  readonly templateDefault: string;
  /** 色槽的无障碍名：说的是"这个色看起来像什么"，不给颜色起含义名。 */
  readonly templateName: (slot: CategorySlot) => string;
  readonly a11yMenu: (title: string) => string;
  readonly a11yCloseMenu: (title: string) => string;
  readonly errorPrefix: string;
  /**
   * 「导出成品图」那一格的文字。**与 `onExportCard` 成对**：
   * 只给回调不给文字时这一格**不渲染**（而不是画一个没有名字的按钮 ——
   * 无障碍名缺失比少一个动作更糟）。
   */
  readonly exportCard?: string;
}

/** 编辑器一次提交能带的字段（`undefined` = 不改，`null` = 明确清除）。 */
export interface EventEditPatch {
  title?: string;
  date?: LocalDate;
  isLunar?: boolean;
  kind?: CountdownEventKind | null;
  /** 「每年」的勾选。RRULE 的构造留在宿主：预设词表是业务语义，展示层给不出、也不该给出一条规则串。 */
  yearly?: boolean;
  color?: CategorySlot | null;
}

export interface EventBoardProps {
  /** 全部倒数日（含已归档）—— 视图归属由 `view` 决定，这一层再筛。 */
  readonly events: readonly CountdownEvent[];
  /** 冻结的"今天"（宿主决定时钟，不在这里 `Date.now()`）。 */
  readonly today: LocalDate;
  readonly view: CountdownView;
  readonly filter: CountdownFilter;
  /**
   * 🔴 一行几格由**宿主**给（视口是 web/壳才有的概念）。省略 = 1（手机）。
   * 这里刻意不做"按容器宽自动分列"：那需要测量，而测量是 DOM 的事
   * （与 `QuadrantBoard.twoColumns` 同一个裁决）。
   */
  readonly columns?: number;
  /** 新建；返回 `true` = 已接受（才清草稿）。 */
  readonly onAdd: (title: string, date: LocalDate) => Promise<boolean>;
  /** 一次保存的全部改动（见文件头：一个 op）。 */
  readonly onPatch: (entityId: string, patch: EventEditPatch) => void;
  readonly onTogglePinned: (entityId: string, pinned: boolean) => void;
  readonly onArchive: (entityId: string) => void;
  readonly onUnarchive: (entityId: string) => void;
  readonly onRemove: (entityId: string) => void;
  readonly onViewChange: (view: CountdownView) => void;
  readonly onFilterChange: (filter: CountdownFilter) => void;
  /** 上一次写入失败的原因（校验的权威在动作层；这一层只把它画出来）。 */
  readonly error?: string;
  /**
   * 「导出成品图」（W7）。**省略 = 这一格根本不渲染**，与 `CalendarBoard` 的
   * `dayMarker?` 是同一条做法（默认值等于原值的可选 prop ⇒ 既有端与既有断言不受影响）。
   *
   * 🔴 为什么这个开关**必须由宿主给**而不是共享层自己判断：成品图是**设备能力**
   * （浏览器有 `<canvas>`；RN 侧见 `docs/plans/countdown-w7-device-export.md` §2 的取证
   * —— 可栅格化但落不了盘）。共享层写一个 `Platform.OS === 'web'` 就是替宿主做平台判断，
   * 而 AGENTS §3.5 的分界线正是"业务/平台语义不许出现在这一层"。
   * 宿主不给 ⇒ 界面上就没有这个动作，而不是"给了但点了没反应"。
   */
  /** 「导出成品图」失败的那一句（整句，宿主给）。与 `error` 分开，理由见渲染处。 */
  readonly exportError?: string;
  readonly onExportCard?: (
    entityId: string,
    card: EventCard,
    texts: EventCardTexts,
  ) => void;
  readonly datePickerLabels: DatePickerLabels;
  readonly labels: EventBoardLabels;
  readonly testID?: string;
}

const KIND_OPTIONS: readonly CountdownEventKind[] = [
  'countdown',
  'anniversary',
  'birthday',
  'festival',
];

function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    board: { gap: tokens['space.3'] },
    stack: { gap: tokens['space.2'] },
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: tokens['space.2'],
    },
    chip: {
      minHeight: tokens['size.chip-height'],
      paddingHorizontal: tokens['size.chip-padding-x'],
      borderRadius: tokens['radius.full'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipOn: { backgroundColor: tokens['color.primary'], borderColor: tokens['color.primary'] },
    chipTextOn: { color: tokens['color.on-primary'] },
    chipText: { color: tokens['color.foreground'] },
    input: {
      flex: 1,
      minHeight: tokens['size.field-height'],
      paddingHorizontal: tokens['size.field-padding-x'],
      borderRadius: tokens['radius.md'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
      backgroundColor: tokens['color.surface'],
      color: tokens['color.foreground'],
    },
    ghost: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.1'],
      minHeight: tokens['size.field-height'],
      paddingHorizontal: tokens['space.3'],
      borderRadius: tokens['radius.md'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
    },
    solid: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: tokens['space.1'],
      minHeight: tokens['size.field-height'],
      paddingHorizontal: tokens['space.3'],
      borderRadius: tokens['radius.md'],
      backgroundColor: tokens['color.primary'],
    },
    disabled: { opacity: tokens['state.disabled-opacity'] },
    /** 网格：**按行切**，每格 `flex:1`（见 `./model.ts` 文件头那条实测）。 */
    grid: { gap: tokens['space.3'] },
    gridRow: { flexDirection: 'row', gap: tokens['space.3'] },
    cell: { flex: 1 },
    card: {
      flex: 1,
      flexDirection: 'row',
      gap: tokens['space.2'],
      padding: tokens['space.3'],
      borderRadius: tokens['radius.lg'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
      backgroundColor: tokens['color.surface'],
    },
    /** 模板只画在这条强调条上（不当文字色用，见文件头）。 */
    accent: { width: tokens['size.progress-height'], borderRadius: tokens['radius.full'] },
    body: { flex: 1, gap: tokens['space.1'] },
    /** 🔴 数字用等宽数位：倒数日的天数是会变的数字，宽度跳动像界面在抖。 */
    days: { fontVariant: ['tabular-nums'] },
    meta: { color: tokens['color.foreground-muted'] },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: tokens['space.1'],
      paddingTop: tokens['space.1'],
    },
    action: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.1'],
      minHeight: tokens['touch-target.min'],
      paddingHorizontal: tokens['space.2'],
      borderRadius: tokens['radius.md'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
    },
    iconButton: {
      width: tokens['touch-target.min'],
      height: tokens['touch-target.min'],
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: tokens['radius.md'],
    },
    swatch: {
      width: tokens['size.checkbox'],
      height: tokens['size.checkbox'],
      borderRadius: tokens['radius.full'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
    },
    swatchOn: { borderWidth: tokens['border-width.thick'], borderColor: tokens['color.foreground'] },
    swatchDefault: { backgroundColor: tokens['color.surface-sunken'] },
    error: {
      padding: tokens['space.2'],
      borderRadius: tokens['radius.md'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.danger'],
    },
  });
}

export function EventBoard({
  events,
  today,
  view,
  filter,
  columns = 1,
  onAdd,
  onPatch,
  onTogglePinned,
  onArchive,
  onUnarchive,
  onRemove,
  onViewChange,
  onFilterChange,
  error,
  exportError,
  onExportCard,
  datePickerLabels,
  labels,
  testID,
}: EventBoardProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const cards = useMemo(
    () => filterEventCards(toEventCards(events, today, view), filter),
    [events, today, view, filter],
  );
  const rows = useMemo(() => toEventRows(cards, columns), [cards, columns]);

  const [draftTitle, setDraftTitle] = useState('');
  const [draftDate, setDraftDate] = useState<LocalDate | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const [menuFor, setMenuFor] = useState<string | undefined>(undefined);
  const [editingFor, setEditingFor] = useState<string | undefined>(undefined);

  /**
   * 挡板只有两个，都是**交互规则**不是内容规则：标题看着是空的 / 还没选日期。
   * "多长算长""日期合不合法"的权威在动作层（共享层不替四端决定这些）。
   */
  const canSubmit = draftTitle.trim() !== '' && draftDate !== undefined;

  /** 🔴 只有宿主说"已接受"才清草稿（见文件头：失败的便签会把用户的字吃掉）。 */
  function submit(): void {
    const date = draftDate;
    if (!canSubmit || date === undefined) return;
    const title = draftTitle;
    void onAdd(title, date).then((accepted) => {
      if (!accepted) return;
      setDraftTitle('');
      setDraftDate(undefined);
      setPicking(false);
    });
  }

  return (
    <View style={styles.board} testID={testID ?? 'event-board'}>
      <View style={styles.row} testID="event-toolbar">
        {COUNTDOWN_FILTERS.map((option) => {
          const on = option === filter;
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityLabel={labels.filterName(option)}
              aria-pressed={on}
              onPress={() => {
                onFilterChange(option);
              }}
              style={[styles.chip, on ? styles.chipOn : null]}
              testID={`event-filter-${option}`}
            >
              <Text style={[text['tab-label'], on ? styles.chipTextOn : styles.chipText]}>
                {labels.filterName(option)}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={view === 'active' ? labels.viewArchived : labels.viewActive}
          onPress={() => {
            onViewChange(view === 'active' ? 'archived' : 'active');
            setMenuFor(undefined);
            setEditingFor(undefined);
          }}
          style={styles.ghost}
          testID="event-toggle-view"
        >
          <HeytaIcon
            data={view === 'active' ? Archive : RotateCcw}
            size={tokens['icon.xs']}
            color={tokens['color.foreground']}
          />
          <Text style={[text['tab-label'], styles.chipText]}>
            {view === 'active' ? labels.viewArchived : labels.viewActive}
          </Text>
        </Pressable>
      </View>

      {view === 'active' ? (
        <View style={styles.stack} testID="event-composer">
          <View style={styles.row}>
            <TextInput
              style={[text['row-meta'], styles.input]}
              value={draftTitle}
              placeholder={labels.composerPlaceholder}
              placeholderTextColor={tokens['color.foreground-subtle']}
              accessibilityLabel={labels.composerPlaceholder}
              onChangeText={setDraftTitle}
              onSubmitEditing={submit}
              returnKeyType="done"
              testID="event-title-input"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={labels.fieldDate}
              onPress={() => {
                setPicking((open) => !open);
              }}
              style={styles.ghost}
              testID="event-pick-date"
            >
              <HeytaIcon
                data={CalendarDays}
                size={tokens['icon.xs']}
                color={tokens['color.foreground']}
              />
              <Text style={[text['row-meta'], styles.chipText]}>
                {draftDate === undefined ? labels.pickDate : labels.formatDate(draftDate)}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={labels.add}
              aria-disabled={!canSubmit}
              disabled={!canSubmit}
              onPress={submit}
              style={[styles.solid, canSubmit ? null : styles.disabled]}
              testID="event-add"
            >
              <HeytaIcon data={Plus} size={tokens['icon.xs']} color={tokens['color.on-primary']} />
              <Text style={[text.caption, styles.chipTextOn]}>{labels.add}</Text>
            </Pressable>
          </View>
          {picking ? (
            <DatePicker
              value={draftDate}
              today={today}
              quickPicks={[]}
              labels={datePickerLabels}
              onChange={(date) => {
                setDraftDate(date);
                if (date !== undefined) setPicking(false);
              }}
              testID="event-date-picker"
            />
          ) : null}
        </View>
      ) : null}

      {error !== undefined && error !== '' ? (
        <View style={styles.error} testID="event-error">
          <Text style={[text['row-meta'], { color: tokens['color.foreground'] }]}>
            {`${labels.errorPrefix}${error}`}
          </Text>
        </View>
      ) : null}

      {exportError !== undefined && exportError !== '' ? (
        // 🔴 与上面那条**分开**：「没能保存」与「导不出来」是两件事，合成一条
        // 就等于告诉用户"你的数据可能没存上"，而那恰恰没发生。
        // 整句由宿主给（导出失败的措辞自带"数据未改动"，不需要前缀）。
        <View style={styles.error} testID="event-export-error">
          <Text style={[text['row-meta'], { color: tokens['color.foreground'] }]}>
            {exportError}
          </Text>
        </View>
      ) : null}

      {cards.length === 0 ? (
        // 🔴 空态**不在这里手写**：形状、居中、图标边长、排版整条，全部由共享
        //    `EmptyState` 决定（`packages/ui/src/empty-state/EmptyState.tsx`）。
        //    便签与提醒那两处是**区块级**空态（塞在 `<details>` / 「我的」页的一段里），
        //    换成页面级组件是视觉回归；这一处是**整屏内容区**空着，正是页面级那一档。
        //    词条仍由宿主构造（共享层不许 import `@heyta/i18n`）。
        <EmptyState
          icon={Hourglass}
          title={view === 'active' ? labels.empty : labels.archivedEmpty}
          hint={view === 'active' ? labels.emptyHint : labels.archivedEmptyHint}
          testID="event-empty"
        />
      ) : (
        <View style={styles.grid} accessibilityRole="list" testID="event-list">
          {rows.map((row, rowIndex) => (
            <View
              key={`row-${String(rowIndex)}`}
              style={styles.gridRow}
              testID={`event-row-${String(rowIndex)}`}
            >
              {row.map((card, cellIndex) =>
                card === null ? (
                  // 末行不满时的等宽占位：没有它，一张孤卡会横铺整行宽度。
                  <View key={`pad-${String(rowIndex)}-${String(cellIndex)}`} style={styles.cell} />
                ) : (
                  <View key={card.id} style={styles.cell} testID={`event-cell-${card.id}`}>
                    <EventCardView
                      card={card}
                      view={view}
                      menuOpen={menuFor === card.id}
                      editing={editingFor === card.id}
                      styles={styles}
                      labels={labels}
                      datePickerLabels={datePickerLabels}
                      onOpenMenu={(open) => {
                        setMenuFor(open ? card.id : undefined);
                        if (!open) setEditingFor(undefined);
                      }}
                      onEdit={(open) => {
                        setEditingFor(open ? card.id : undefined);
                        setMenuFor(open ? card.id : undefined);
                      }}
                      onPatch={(patch) => {
                        onPatch(card.id, patch);
                        setEditingFor(undefined);
                        setMenuFor(undefined);
                      }}
                      onTogglePinned={(pinned) => {
                        onTogglePinned(card.id, pinned);
                      }}
                      onArchive={() => {
                        onArchive(card.id);
                        setMenuFor(undefined);
                      }}
                      onUnarchive={() => {
                        onUnarchive(card.id);
                        setMenuFor(undefined);
                      }}
                      onRemove={() => {
                        onRemove(card.id);
                        setMenuFor(undefined);
                      }}
                      onExportCard={
                        onExportCard === undefined
                          ? undefined
                          : (texts) => {
                              // 🔴 **不收菜单**：导出是异步的（画布 → blob → 下载），
                              // 收起菜单会让用户以为没点到。失败那一句还在板子上方。
                              onExportCard(card.id, card, texts);
                            }
                      }
                    />
                  </View>
                ),
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

/** 一张卡片：默认只画内容，`⋯` 展开二级操作，"编辑"就地展开编辑器。 */
function EventCardView({
  card,
  view,
  menuOpen,
  editing,
  styles,
  labels,
  datePickerLabels,
  onOpenMenu,
  onEdit,
  onPatch,
  onTogglePinned,
  onArchive,
  onUnarchive,
  onRemove,
  onExportCard,
}: {
  card: EventCard;
  view: CountdownView;
  menuOpen: boolean;
  editing: boolean;
  styles: Styles;
  labels: EventBoardLabels;
  datePickerLabels: DatePickerLabels;
  onOpenMenu: (open: boolean) => void;
  onEdit: (open: boolean) => void;
  onPatch: (patch: EventEditPatch) => void;
  onTogglePinned: (pinned: boolean) => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onRemove: () => void;
  /** 见 `EventBoardProps.onExportCard`：`undefined` = 这一格不渲染。 */
  onExportCard?: ((texts: EventCardTexts) => void) | undefined;
}): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  // 🔴 屏幕上这张卡的措辞与**导出的成品图**用的是同一次 `cardTextsFor` 调用
  // （理由见 `./model.ts` 那个函数的注释：抄第二遍就会改一处漏一处，
  // 症状是"图上是错的、屏幕上是对的"，而没有任何一层会报）。
  const texts = cardTextsFor(card, labels);

  return (
    <View style={styles.card} testID={`event-card-${card.id}`}>
      <View
        style={[
          styles.accent,
          {
            // 「没选过模板」用沉底底色，不是"灰色代表不重要"。
            backgroundColor:
              card.template === undefined
                ? tokens['color.surface-sunken']
                : tokens[categorySlotToken(card.template)],
          },
        ]}
        testID={`event-accent-${card.id}`}
      />
      <View style={styles.body}>
        <Text
          style={[text['row-title'], { color: tokens['color.foreground'] }]}
          numberOfLines={2}
          testID={`event-title-${card.id}`}
        >
          {texts.title}
        </Text>
        {/* 🔴 这行**只有措辞会变**：`face === 'since'` 不换颜色（§2.7）。 */}
        <Text
          style={[text['numeric-display'], styles.days, { color: tokens['color.foreground'] }]}
          testID={`event-days-${card.id}`}
        >
          {texts.face}
        </Text>
        <View style={styles.row}>
          {/* 🔴 一次性且已过去的倒数日**没有"下一次"**（`nextDate` 是 undefined），
              但那一天是这张卡唯一的事实 —— 只留"已经 31 天"而不说是哪一天，
              用户就没法核对它到底记的是哪天。落回锚点日期，不是"没日期就不画"。
              这条判断**住在 `cardTextsFor` 里**（W5 在真浏览器里红过一次的那条），
              所以导出的成品图与屏幕上的卡现在**同一次调用**，不可能一边修了一边没修。 */}
          <Text
            style={[text['row-meta'], styles.meta]}
            testID={`event-date-${card.id}`}
          >
            {texts.date}
          </Text>
          {texts.age !== undefined ? (
            <Text
              style={[text['row-meta'], styles.meta]}
              testID={`event-age-${card.id}`}
            >
              {texts.age}
            </Text>
          ) : null}
          {card.isPinned ? (
            <Text
              style={[text.badge, { color: tokens['color.primary'] }]}
              testID={`event-pinned-${card.id}`}
            >
              {labels.badgePinned}
            </Text>
          ) : null}
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              menuOpen ? labels.a11yCloseMenu(card.title) : labels.a11yMenu(card.title)
            }
            aria-expanded={menuOpen}
            onPress={() => {
              onOpenMenu(!menuOpen);
            }}
            style={styles.iconButton}
            testID={`event-menu-${card.id}`}
          >
            <HeytaIcon
              data={menuOpen ? X : Ellipsis}
              size={tokens['icon.sm']}
              color={tokens['color.foreground']}
            />
          </Pressable>

          {menuOpen ? (
            <>
              {view === 'active' ? (
                <>
                  <BoardAction
                    styles={styles}
                    text={text}
                    label={labels.edit}
                    icon={editing ? X : Check}
                    testID={`event-edit-open-${card.id}`}
                    onPress={() => {
                      onEdit(!editing);
                    }}
                  />
                  <BoardAction
                    styles={styles}
                    text={text}
                    label={card.isPinned ? labels.unpin : labels.pin}
                    icon={card.isPinned ? PinOff : Pin}
                    testID={`event-pin-${card.id}`}
                    onPress={() => {
                      onTogglePinned(!card.isPinned);
                    }}
                  />
                  <BoardAction
                    styles={styles}
                    text={text}
                    label={labels.archive}
                    icon={Archive}
                    testID={`event-archive-${card.id}`}
                    onPress={onArchive}
                  />
                </>
              ) : (
                <BoardAction
                  styles={styles}
                  text={text}
                  label={labels.unarchive}
                  icon={RotateCcw}
                  testID={`event-unarchive-${card.id}`}
                  onPress={onUnarchive}
                />
              )}
              {onExportCard !== undefined && labels.exportCard !== undefined ? (
                <BoardAction
                  styles={styles}
                  text={text}
                  label={labels.exportCard}
                  icon={Download}
                  testID={`event-export-${card.id}`}
                  onPress={() => {
                    onExportCard(texts);
                  }}
                />
              ) : null}
              <BoardAction
                styles={styles}
                text={text}
                label={labels.remove}
                icon={Trash2}
                testID={`event-remove-${card.id}`}
                onPress={onRemove}
              />
            </>
          ) : null}
        </View>

        {/* 🔴 编辑器**关闭即卸载**：草稿是本地 state，留着不卸载会显示上一条的值。 */}
        {editing ? (
          <CardEditor
            card={card}
            styles={styles}
            labels={labels}
            datePickerLabels={datePickerLabels}
            onSubmit={onPatch}
            onCancel={() => {
              onEdit(false);
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

/** 菜单里的一行动作（图标 + 文字，**不只靠颜色**表达）。 */
function BoardAction({
  styles,
  text,
  label,
  icon,
  testID,
  onPress,
}: {
  styles: Styles;
  text: ReturnType<typeof useHeytaText>;
  label: string;
  icon: React.ComponentProps<typeof HeytaIcon>['data'];
  testID: string;
  onPress: () => void;
}): React.JSX.Element {
  const tokens = useHeytaTokens();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.action}
      testID={testID}
    >
      <HeytaIcon data={icon} size={tokens['icon.xs']} color={tokens['color.foreground']} />
      <Text style={[text.caption, { color: tokens['color.foreground'] }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * 就地编辑器。
 *
 * 草稿是**本地 state**，初值取自卡片；提交时只带真正改过的键，
 * 一个都没改就**不发**（`onSubmit` 不会被调用）。
 */
function CardEditor({
  card,
  styles,
  labels,
  datePickerLabels,
  onSubmit,
  onCancel,
}: {
  card: EventCard;
  styles: Styles;
  labels: EventBoardLabels;
  datePickerLabels: DatePickerLabels;
  onSubmit: (patch: EventEditPatch) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();

  const [title, setTitle] = useState(card.title);
  const [date, setDate] = useState<LocalDate>(card.anchorDate);
  const [isLunar, setLunar] = useState(card.isLunar);
  const [kind, setKind] = useState<CountdownEventKind | null>(card.declaredKind);
  const [yearly, setYearly] = useState(card.isRepeating);
  const [template, setTemplate] = useState<CategorySlot | null>(card.template ?? null);
  const [picking, setPicking] = useState(false);

  function save(): void {
    const patch: EventEditPatch = {};
    const trimmed = title.trim();
    if (trimmed !== '' && trimmed !== card.title) patch.title = trimmed;
    if (date !== card.anchorDate) patch.date = date;
    // 🔴 历法与日期同一条 op：只翻历法标记也要把当前日期带上，
    //    否则"改成农历但日期没动"在别的端上会读成"只改了历法"，
    //    而锚点是否要按农历重算必须由同一条 op 表达。
    if (isLunar !== card.isLunar) {
      patch.isLunar = isLunar;
      patch.date = date;
    }
    if (kind !== card.declaredKind) patch.kind = kind;
    if (yearly !== card.isRepeating) patch.yearly = yearly;
    if (template !== (card.template ?? null)) patch.color = template;
    if (Object.keys(patch).length === 0) {
      onCancel();
      return;
    }
    onSubmit(patch);
  }

  return (
    <View style={styles.stack} testID={`event-editor-${card.id}`}>
      <Text style={[text['panel-title'], { color: tokens['color.foreground-muted'] }]}>
        {labels.fieldTitle}
      </Text>
      <TextInput
        style={[text['row-meta'], styles.input]}
        value={title}
        accessibilityLabel={labels.fieldTitle}
        onChangeText={setTitle}
        testID={`event-editor-title-${card.id}`}
      />

      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.fieldDate}
          onPress={() => {
            setPicking((open) => !open);
          }}
          style={styles.ghost}
          testID={`event-editor-date-${card.id}`}
        >
          <HeytaIcon data={CalendarDays} size={tokens['icon.xs']} color={tokens['color.foreground']} />
          <Text style={[text['row-meta'], { color: tokens['color.foreground'] }]}>
            {labels.formatDate(date)}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.lunar}
          aria-pressed={isLunar}
          onPress={() => {
            setLunar((on) => !on);
          }}
          style={[styles.ghost, isLunar ? styles.chipOn : null]}
          testID={`event-editor-lunar-${card.id}`}
        >
          <Text style={[text['row-meta'], isLunar ? styles.chipTextOn : styles.chipText]}>
            {labels.lunar}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.yearly}
          aria-pressed={yearly}
          onPress={() => {
            setYearly((on) => !on);
          }}
          style={[styles.ghost, yearly ? styles.chipOn : null]}
          testID={`event-editor-yearly-${card.id}`}
        >
          <Text style={[text['row-meta'], yearly ? styles.chipTextOn : styles.chipText]}>
            {labels.yearly}
          </Text>
        </Pressable>
      </View>
      {picking ? (
        <DatePicker
          value={date}
          today={date}
          quickPicks={[]}
          labels={datePickerLabels}
          onChange={(next) => {
            if (next !== undefined) setDate(next);
            setPicking(false);
          }}
          testID={`event-editor-picker-${card.id}`}
        />
      ) : null}

      <Text style={[text['panel-title'], { color: tokens['color.foreground-muted'] }]}>
        {labels.fieldKind}
      </Text>
      <View style={styles.row}>
        {KIND_OPTIONS.map((option) => (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityLabel={labels.kindName(option)}
            aria-pressed={kind === option}
            onPress={() => {
              setKind((current) => (current === option ? null : option));
            }}
            style={[styles.chip, kind === option ? styles.chipOn : null]}
            testID={`event-editor-kind-${option}-${card.id}`}
          >
            <Text style={[text['tab-label'], kind === option ? styles.chipTextOn : styles.chipText]}>
              {labels.kindName(option)}
            </Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.kindUnset}
          aria-pressed={kind === null}
          onPress={() => {
            setKind(null);
          }}
          style={[styles.chip, kind === null ? styles.chipOn : null]}
          testID={`event-editor-kind-unset-${card.id}`}
        >
          <Text style={[text['tab-label'], kind === null ? styles.chipTextOn : styles.chipText]}>
            {labels.kindUnset}
          </Text>
        </Pressable>
      </View>

      <Text style={[text['panel-title'], { color: tokens['color.foreground-muted'] }]}>
        {labels.fieldTemplate}
      </Text>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.templateDefault}
          aria-pressed={template === null}
          onPress={() => {
            setTemplate(null);
          }}
          style={[styles.swatch, styles.swatchDefault, template === null ? styles.swatchOn : null]}
          testID={`event-editor-template-default-${card.id}`}
        />
        {CATEGORY_SLOTS.map((slot) => (
          <Pressable
            key={slot}
            accessibilityRole="button"
            accessibilityLabel={labels.templateName(slot)}
            aria-pressed={template === slot}
            onPress={() => {
              setTemplate((current) => (current === slot ? null : slot));
            }}
            style={[
              styles.swatch,
              { backgroundColor: tokens[categorySlotToken(slot)] },
              template === slot ? styles.swatchOn : null,
            ]}
            testID={`event-editor-template-${String(slot)}-${card.id}`}
          />
        ))}
      </View>

      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.save}
          onPress={save}
          style={styles.solid}
          testID={`event-editor-save-${card.id}`}
        >
          <Text style={[text.caption, styles.chipTextOn]}>{labels.save}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.cancel}
          onPress={onCancel}
          style={styles.ghost}
          testID={`event-editor-cancel-${card.id}`}
        >
          <Text style={[text.caption, styles.chipText]}>{labels.cancel}</Text>
        </Pressable>
      </View>
    </View>
  );
}
