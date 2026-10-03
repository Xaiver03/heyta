/**
 * 倒数日/纪念日的**展示模型**（共享层唯一一份）
 * =================================================
 *
 * W5 的模型层：把 `CountdownEvent` 变成"卡片上要画的那几样东西"。
 * 算术与顺序**都不在这里** —— 它们只在 `@heyta/domain/events.ts`，
 * 这里只做"给界面用的形状"与"网格怎么分行"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 两副面孔是**一个符号**，不是两套状态
 *
 * `days` 直接取自 `eventDaysFromToday`：正数 = 还有 N 天、0 = 就是今天、
 * 负数 = 已经 N 天。界面拿 `countdownFace(days)` 决定说哪一句，
 * **不许自己再判一次 `date < today`** —— 那种写法会把"就是今天"说成"已经 1 天"
 * （领域层文件头把这条钉过一次，抄到界面上就又漂一次）。
 *
 * ## 🔴 逾期不飘红（§2.7）
 *
 * `face === 'since'` 只换**措辞**，不换颜色：卡片上的数字永远用正文前景色。
 * 这不是"配色细节"：倒数日的"已经 N 天"对"戒烟第 N 天"和"离职第 N 天"
 * 都成立，把后者画成红色就等于 App 在替用户判断这件事是好是坏。
 *
 * ## 年龄那一句为什么单独放
 *
 * `ageDays` 的分母是**锚点**（结婚日 / 生日那年），不是上一次发生日 ——
 * 每年重复的东西用后者的话永远 ≤ 365，等于没有。它只在锚点已过时出现，
 * 一次性且已过去的倒数日由 `face: 'since'` 那一句承担同一个数，不重复画。
 *
 * ## 🔴 分行而不是 `flexWrap` + 百分比（`QuadrantBoard` 用一天实测换来的）
 *
 * `flexWrap:'wrap'` + `minWidth:'50%'` + `gap` 在 web 上**必然塌成一列通栏卡**
 * （50% + 50% + gap > 100%，每格都被挤下去）。所以这里按行切：
 * 每行恰好 `columns` 格、每格 `flex:1`，结构上不可能换行；
 * 末行不满补 `null`（渲染成等宽占位），否则一张孤卡会横铺整行宽度。
 * 列数由**宿主**决定（视口是 web/壳才有的概念，见 props 注释）。
 */

import {
  archivedEvents,
  eventAgeInDays,
  eventDaysFromToday,
  eventKindOf,
  isEventPinned,
  isEventRepeating,
  nextEventOccurrence,
  sortEventsForDisplay,
  aliveEvents,
  type CategorySlot,
  type CountdownEvent,
  type CountdownEventKind,
  type LocalDate,
} from '@heyta/domain';

/** 卡片的视图：**在用的**还是**已归档的**（§2.5 —— 归档是一态，不是删除）。 */
export type CountdownView = 'active' | 'archived';

/** 类型筛选档位。`'all'` 之外就是实体的四个 `kind`。 */
export type CountdownFilter = 'all' | CountdownEventKind;

/**
 * 筛选档位。**🔴 没有"节假日"这一档** —— 节假日是公共事实、不是用户实体
 * （本文 §2.2：不进 op-log、不进用户库），把它做成一张筛选卡会让用户以为
 * 自己能"新建一条节假日"，而那条写入没有地方去。
 */
export const COUNTDOWN_FILTERS: readonly CountdownFilter[] = [
  'all',
  'countdown',
  'anniversary',
  'birthday',
  'festival',
];

/** 卡片那一句用的是哪副面孔。 */
export type CountdownFace = 'until' | 'today' | 'since';

/** 数字的符号 → 面孔。**只有这三种**，没有第四种"逾期"（§2.7）。 */
export function countdownFace(days: number): CountdownFace {
  if (days > 0) return 'until';
  if (days === 0) return 'today';
  return 'since';
}

/** 界面用的一张卡片。 */
export interface EventCard {
  readonly id: string;
  readonly title: string;
  /** 用户声明的类型；没声明时是领域层按形态**派生**的那一个（同一个函数）。 */
  readonly kind: CountdownEventKind;
  /**
   * 用户**自己声明过**的类型（`undefined` 存成 `null`）。
   *
   * 🔴 它和 `kind` 不是一回事：`kind` 是"界面上按哪一档画"（没声明时按日期方向派生），
   * 编辑器要显示与比较的是**声明值**。用 `kind` 去 diff 会把每条没选过类型的卡片
   * 都在一次无关保存里补上一个 `kind` —— 写了用户从没表达过的意图。
   */
  readonly declaredKind: CountdownEventKind | null;
  readonly face: CountdownFace;
  /** 卡片上那个数：**永远是绝对值**，方向由 `face` 说（不让界面拼负号）。 */
  readonly days: number;
  /** 下一次发生日；`undefined` = 一次性且已过（"没有下一次"，不是 0 天）。 */
  readonly nextDate: LocalDate | undefined;
  /**
   * 存的那个日期（**锚点**）。🔴 它不是 `nextDate`：每年重复的生日`nextDate`
   * 是今年/明年的那一次，而编辑器要显示与改写的是用户当初填的那一天。
   * 少这一项，编辑器就只能"从下一次发生日反推锚点"，那是第二套事实源。
   */
  readonly anchorDate: LocalDate;
  /** 重复的倒数日才有：从锚点算起的第 N 天（`0` = 锚点还没到）。 */
  readonly ageDays: number | undefined;
  readonly isPinned: boolean;
  readonly isLunar: boolean;
  readonly isRepeating: boolean;
  /** 预置模板 = 分类色板的一格（`undefined` = 默认模板）。🔴 不是自定义颜色。 */
  readonly template: CategorySlot | undefined;
}

function toEventCard(event: CountdownEvent, today: LocalDate): EventCard {
  const signed = eventDaysFromToday(event, today);
  const repeating = isEventRepeating(event);
  const age = eventAgeInDays(event, today);
  return {
    id: event.id,
    title: event.title,
    kind: eventKindOf(event, today),
    declaredKind: event.kind ?? null,
    face: countdownFace(signed),
    days: Math.abs(signed),
    nextDate: nextEventOccurrence(event, today),
    anchorDate: event.date,
    ageDays: repeating && age > 0 ? age : undefined,
    isPinned: isEventPinned(event),
    isLunar: event.isLunar === true,
    isRepeating: repeating,
    template: event.color,
  };
}

/**
 * 这个视图下的卡片，**已经是规范顺序**（置顶 → 距今天数 → id 兜底）。
 *
 * 🔴 顺序只由 `sortEventsForDisplay` 决定：这一层不再 `sort()` 一次。
 * 各端各排一次的结局是同一批卡片在两台设备上顺序不同，而**没有任何测试会红**。
 */
export function toEventCards(
  events: readonly CountdownEvent[],
  today: LocalDate,
  view: CountdownView,
): EventCard[] {
  const inView = view === 'archived' ? archivedEvents(events) : aliveEvents(events);
  return sortEventsForDisplay(inView, today).map((event) => toEventCard(event, today));
}

/** 按类型档筛。`'all'` 原样返回（不复制一份判断给各端）。 */
export function filterEventCards(
  cards: readonly EventCard[],
  filter: CountdownFilter,
): EventCard[] {
  if (filter === 'all') return [...cards];
  return cards.filter((card) => card.kind === filter);
}

/**
 * 把卡片切成网格的行；末行用 `null` 补满。
 *
 * `columns <= 1` ⇒ 一列一个（手机）。🔴 **`0` 与负数按 1 处理**：
 * 列数来自宿主的除法/取整，拿到 0 时如果照原值切就会**一行都不画**，
 * 症状是"界面空白"而不是"报错" —— 那种空白在本仓库的历史里出现过太多次。
 */
export function toEventRows(
  cards: readonly EventCard[],
  columns: number,
): (EventCard | null)[][] {
  const per = columns >= 1 ? Math.floor(columns) : 1;
  const rows: (EventCard | null)[][] = [];
  for (let start = 0; start < cards.length; start += per) {
    const row: (EventCard | null)[] = [...cards.slice(start, start + per)];
    while (row.length < per) row.push(null);
    rows.push(row);
  }
  return rows;
}
