/**
 * 倒数日/纪念日视图（Web 壳）
 * ============================
 *
 * 🔴 与 `NotesView` 同一个形状：这个文件**只剩接线**。卡片网格、筛选、
 * 置顶/归档/删除的二级操作、就地编辑器，全部由 `@heyta/ui` 的 `EventBoard` 渲染 ——
 * 与 mobile 将是**同一份实现**。
 *
 * 这里只回答 web 自己的三件事：
 *   1. 数据从哪来 → `useCountdownStore`（列表与顺序都是动作层给的）；
 *   2. 文案键怎么填 → `eventBoardLabels(t)`（共享层不 import i18n）；
 *   3. **一行几格** → 听媒体查询（`--ht-layout-two-column-min`）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 列数的断点读 token，不抄数字
 *
 * 与 `QuadrantBoard` 同一条纪律：JS 里写 `768` 就是第二套事实源。
 * RNW 的 `useWindowDimensions` 用的是**物理屏宽**而不是视口宽（实测 660px 视口
 * 它报 1728），所以这个判定只能在 web 宿主做；移动端不传 ⇒ 共享层默认单列。
 * token 没加载时**保持单列**，不写裸值兜底（`check:design` 拦的就是那个）。
 *
 * ## 🔴 `HeytaUiProvider` 必须包在这一处
 *
 * `App.tsx` 里 tasks 那棵树的 Provider **不覆盖兄弟节点**，
 * `EventBoard` 会 `useHeytaUiTheme()`，落在外面是运行时抛错而类型与单测都不红
 * （M3 第二刀的 focus 就是这样崩的；`check:ui-provider` 现在能拦）。
 */

import { useEffect, useMemo, useState } from 'react';

import type { CountdownEventKind, LocalDate } from '@heyta/domain';
import { useI18n, type I18nValue, type MessageKey } from '@heyta/i18n';
import {
  EventBoard,
  HeytaUiProvider,
  WEEKDAY_MESSAGE_KEYS,
  categorySlotToken,
  formatDayTitleText,
  formatMonthTitleText,
  useHeytaUiTheme,
  type CountdownFilter,
  type CountdownView as CountdownBoardView,
  type EventBoardLabels,
  type EventCard,
  type EventCardTexts,
  type DatePickerLabels,
} from '@heyta/ui';

import { exportEventCard } from './card-export.js';
import { useCountdownStore } from './store.js';

type Translate = I18nValue['t'];

/** 构造共享 `EventBoard` 的全部文案。字段名逐项对应，漏了编译不过。 */
export function eventBoardLabels(t: Translate): EventBoardLabels {
  return {
    empty: t('web.countdown.empty'),
    emptyHint: t('web.countdown.empty.hint'),
    archivedEmpty: t('web.countdown.archived.empty'),
    archivedEmptyHint: t('web.countdown.archived.empty.hint'),
    composerPlaceholder: t('web.countdown.composer.placeholder'),
    add: t('web.countdown.add'),
    pickDate: t('web.countdown.pickDate'),
    formatDate: (date) => formatDayTitleText(date, t),
    filterName: (filter) => t(filterMessageKey(filter)),
    viewActive: t('web.countdown.view.active'),
    viewArchived: t('web.countdown.view.archived'),
    faceText: (face, days) =>
      face === 'until'
        ? t('web.countdown.face.until', { days })
        : face === 'today'
          ? t('web.countdown.face.today')
          : t('web.countdown.since', { days }),
    // 🔴 「已经 N 天」与逾期那一句**共用同一条词条**：两处各登记一遍，
    //    迟早有一边改了措辞另一边没跟上（而"审判感"正是措辞层面的红线）。
    ageText: (days) => t('web.countdown.since', { days }),
    badgePinned: t('web.countdown.badge.pinned'),
    pin: t('web.countdown.pin'),
    unpin: t('web.countdown.unpin'),
    edit: t('web.countdown.edit'),
    save: t('web.countdown.save'),
    cancel: t('web.countdown.cancel'),
    archive: t('web.countdown.archive'),
    unarchive: t('web.countdown.unarchive'),
    remove: t('web.countdown.remove'),
    fieldTitle: t('web.countdown.field.title'),
    fieldDate: t('web.countdown.field.date'),
    fieldKind: t('web.countdown.field.kind'),
    kindName: (kind) => t(kindMessageKey(kind)),
    kindUnset: t('web.countdown.kind.unset'),
    yearly: t('web.countdown.yearly'),
    lunar: t('web.countdown.lunar'),
    fieldTemplate: t('web.countdown.field.template'),
    templateDefault: t('web.countdown.template.none'),
    templateName: (slot) => t('web.countdown.template.slot', { slot }),
    // W7：给了这一格才会渲染（`onExportCard` 与它**成对**，见共享层注释）。
    exportCard: t('web.countdown.export'),
    a11yMenu: (title) => t('web.countdown.a11y.menu', { title }),
    a11yCloseMenu: (title) => t('web.countdown.a11y.menuClose', { title }),
    errorPrefix: t('web.countdown.error'),
  };
}

/**
 * 档位 → 词条键。
 *
 * 🔴 用 `switch` 而不是模板串：`` t(`web.countdown.kind.${kind}`) `` 在类型上是 `string`，
 * 少登记一个键不会红，症状是界面把**键名本身**渲染给用户看。
 */
function filterMessageKey(filter: CountdownFilter): MessageKey {
  switch (filter) {
    case 'all':
      return 'web.countdown.filter.all';
    case 'countdown':
      return 'web.countdown.kind.countdown';
    case 'anniversary':
      return 'web.countdown.kind.anniversary';
    case 'birthday':
      return 'web.countdown.kind.birthday';
    case 'festival':
      return 'web.countdown.kind.festival';
  }
}

function kindMessageKey(kind: CountdownEventKind): MessageKey {
  switch (kind) {
    case 'countdown':
      return 'web.countdown.kind.countdown';
    case 'anniversary':
      return 'web.countdown.kind.anniversary';
    case 'birthday':
      return 'web.countdown.kind.birthday';
    case 'festival':
      return 'web.countdown.kind.festival';
  }
}

/** 共享 `DatePicker` 的文案：月/日/周的头都用现成的那条链，清除与翻月**复用 due 那四个键**
 *  （它们的取值是通用的「清除 / 上个月 / 下个月 / {month}月{day}日」；
 *   为倒数日再登记一份同值词条 = 造一对一定会漂的抄件）。 */
function datePickerLabels(t: Translate) {
  return {
    weekdays: WEEKDAY_MESSAGE_KEYS.map((key) => t(key)),
    monthTitle: (month: LocalDate) => formatMonthTitleText(month, t),
    clear: t('web.due.clear'),
    prevMonth: t('web.due.prevMonth'),
    nextMonth: t('web.due.nextMonth'),
    dayLabel: (month: number, day: number) => t('web.due.dayLabel', { month, day }),
  };
}

/**
 * 板子本体：**必须活在 `<HeytaUiProvider>` 里面**。
 *
 * 成品图要读当前主题的 `tokens` 与 `text`（唯一事实源），而 `useHeytaUiTheme()`
 * 在 Provider 外面是**运行时抛错**、类型与单测都不红（文件头那条 M3 教训）。
 * 所以主题读取只能开在这一层 —— 这也是为什么 `exportEventCard` 的入参
 * 是"整套主题表"而不是几个颜色：颜色一旦被宿主挑着传，就会有人图省事写 `#fff`。/**
 * 板子本体：**必须活在 `<HeytaUiProvider>` 里面**。
 *
 * 成品图要读当前主题的 `tokens` 与 `text`（设计系统唯一事实源），而
 * `useHeytaUiTheme()` 在 Provider 外面是**运行时抛错**、类型与单测都不红
 * （文件头那条 M3 教训）。所以主题读取只能开在这一层。
 *
 * 🔴 `exportEventCard` 的入参是**整套主题表**而不是挑出来的几个颜色：
 * 颜色一旦被宿主挑着传，下一句就是"这里先写个白的"，而 `check:design`
 * 只拦字面量、拦不住挑错 token。
 */
function CountdownBoard({
  today,
  view,
  filter,
  columns,
  labels,
  pickerLabels,
  exportFailed,
  onViewChange,
  onFilterChange,
}: {
  today: LocalDate;
  view: CountdownBoardView;
  filter: CountdownFilter;
  columns: number;
  labels: EventBoardLabels;
  pickerLabels: DatePickerLabels;
  /** 「导不出来」那一句（**宿主词条**，不进共享的 `EventBoardLabels`：共享层只需要知道有没有这一格）。 */
  exportFailed: string;
  onViewChange: (view: CountdownBoardView) => void;
  onFilterChange: (filter: CountdownFilter) => void;
}): React.JSX.Element {
  const theme = useHeytaUiTheme();
  const events = useCountdownStore((s) => s.events);
  const archivedEvents = useCountdownStore((s) => s.archivedEvents);
  const storeError = useCountdownStore((s) => s.error);
  const addEvent = useCountdownStore((s) => s.addEvent);
  const patchEvent = useCountdownStore((s) => s.patchEvent);
  const togglePinned = useCountdownStore((s) => s.togglePinned);
  const archive = useCountdownStore((s) => s.archive);
  const unarchive = useCountdownStore((s) => s.unarchive);
  const remove = useCountdownStore((s) => s.remove);
  /**
   * 导出失败那一句。**成功不需要说话**（浏览器自己把文件放下了），
   * 失败必须上屏 —— 便签登记的那条"失败静默吞掉还清空草稿"的高危不复制到这儿。
   */
  const [exportError, setExportError] = useState<string | undefined>(undefined);

  const handleExport = (card: EventCard, texts: EventCardTexts): void => {
    void exportEventCard({
      texts,
      theme: { tokens: theme.tokens, text: theme.text },
      // 与卡片上**同一个表达式**：模板 = 分类色板的一格，没选过就是沉底底色。
      accentColor:
        card.template === undefined
          ? theme.tokens['color.surface-sunken']
          : theme.tokens[categorySlotToken(card.template)],
      // 文件名里的日期段用的就是屏上那一行（同一次 `cardTextsFor` 的产物），
      // 所以"图上写的日子"与"文件名字里的日子"不可能不一致。
      dateStem: texts.date,
    }).then((result) => {
      setExportError(result.ok ? undefined : exportFailed);
    });
  };

  return (
    <EventBoard
      events={view === 'archived' ? archivedEvents : events}
      today={today}
      view={view}
      filter={filter}
      columns={columns}
      onAdd={addEvent}
      onPatch={(entityId, patch) => {
        void patchEvent(entityId, patch);
      }}
      onTogglePinned={(entityId, pinned) => {
        void togglePinned(entityId, pinned);
      }}
      onArchive={(entityId) => {
        void archive(entityId);
      }}
      onUnarchive={(entityId) => {
        void unarchive(entityId);
      }}
      onRemove={(entityId) => {
        void remove(entityId);
      }}
      onViewChange={onViewChange}
      onFilterChange={onFilterChange}
      error={storeError}
      exportError={exportError}
      onExportCard={(_entityId, card, texts) => {
        handleExport(card, texts);
      }}
      datePickerLabels={pickerLabels}
      labels={labels}
      testID="countdown-view"
    />
  );
}

export function CountdownView({ today }: { today: LocalDate }): React.JSX.Element {
  const { t } = useI18n();
  const syncToday = useCountdownStore((s) => s.syncToday);
  // 视图与筛选是**这一屏的局部态**（不进 store：它不是事实，刷新回到默认是预期行为）。
  const [view, setView] = useState<CountdownBoardView>('active');
  const [filter, setFilter] = useState<CountdownFilter>('all');

  useEffect(() => {
    syncToday(today);
  }, [today, syncToday]);

  /** 一行两格还是单格 —— 断点读 token，判定听窗口（见文件头）。 */
  const [columns, setColumns] = useState(1);
  useEffect(() => {
    const min = getComputedStyle(document.documentElement)
      .getPropertyValue('--ht-layout-two-column-min')
      .trim();
    if (min === '') return;
    const query = window.matchMedia(`(min-width: ${min})`);
    const onChange = (): void => {
      setColumns(query.matches ? 2 : 1);
    };
    onChange();
    query.addEventListener('change', onChange);
    return () => {
      query.removeEventListener('change', onChange);
    };
  }, []);

  const labels = useMemo(() => eventBoardLabels(t), [t]);
  const pickerLabels = useMemo(() => datePickerLabels(t), [t]);

  return (
    <HeytaUiProvider>
      <CountdownBoard
        today={today}
        view={view}
        filter={filter}
        columns={columns}
        labels={labels}
        pickerLabels={pickerLabels}
        exportFailed={t('web.countdown.export.failed')}
        onViewChange={setView}
        onFilterChange={setFilter}
      />
    </HeytaUiProvider>
  );
}
