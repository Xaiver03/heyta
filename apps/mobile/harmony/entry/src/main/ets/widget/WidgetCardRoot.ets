/**
 * 四张卡片**共用**的渲染。
 *
 * ## 🔴 为什么不是四个 `struct`
 *
 * 平台要求每张卡片有**独立的一页**（`form_config_*.json` 里的 `src`），
 * 所以四个入口文件确实必须存在。但**渲染逻辑**只有这一份 ——
 * 抄四遍的漂移表现是"四款里只有一款在过期之后还显示昨天的数据"，
 * 用户看到"习惯卡片是对的、今日任务卡片是昨天的"，**不报错**。
 *
 * 于是：`TodayCard.ets` 等四个文件各自**只有 10 行**（声明 `kind` 并转交这里），
 * 与 Android 侧四个 provider 类只是四个 `ComponentName` 是同一个形状。
 */
import { WidgetStrings } from './WidgetStrings';
import { WidgetHeader, WidgetTaskRow, WidgetMessage, messageFor } from './WidgetCardParts';
import type { QuadrantModel, HabitsModel, FocusModel } from './WidgetModels';

/**
 * JSON 字符串 → 数组。**解析不了就是空数组，不抛。**
 *
 * ⚠️ 这个函数被我误删过一次（用"从注释到第一个 `}`"的方式删隔壁的死函数时删多了）。
 * 教训：**按文本范围删代码是不可靠的**，编译一次才知道删掉了什么。
 */
function parseJsonArray<T>(text: string): T[] {
  try {
    const parsed: Object = JSON.parse(text) as Object;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (err) {
    return [];
  }
}

@Component
export struct WidgetCardRoot {
  /** `today` / `quadrant` / `habits` / `focus`。 */
  kind: string = 'today';
  @LocalStorageProp('state') state: string = 'placeholder';
  @LocalStorageProp('todayRows') todayRows: string = '[]';
  @LocalStorageProp('quadrantSlots') quadrantSlots: string = '[]';
  @LocalStorageProp('habitRows') habitRows: string = '[]';
  @LocalStorageProp('focusModel') focusModel: string = '{}';
  @LocalStorageProp('isZh') isZh: boolean = true;

  /**
   * 今天的行。
   *
   * 🔴 **这里曾经有一个"同一字段两种读法"的 bug**，症状是卡片显示「今天没有任务」
   * 而数据其实好好地在那儿：
   *
   * ```
   * parseToday(this.todayRows)   // 期望：JSON.parse 出**整个 TodayModel**（要 .count）
   * parseJsonArray<TodayRowView>(this.todayRows)   // 期望：**数组**（ForEach 用）
   * ```
   *
   * 而写入方（`WidgetForms.buildData`）发的是 `JSON.stringify(model.rows)` —— **数组**。
   * 数组被 `as TodayModel` 强转后 `.count` 是 `undefined`，`?? 0` 就把它变成 0，
   * 于是渲染成空状态。**两种读法不可能同时对**，而它们之间没有任何一处会报错 ——
   * `JSON.parse` 对数组是成功的，`as` 只是把类型系统骗过去了。
   *
   * 现在统一成**数组**，与 `buildData` 以及另外三张卡片（`habitList` 等）一致。
   * `count` 由数组长度现算，不再依赖一个不存在的字段。
   */
  private todayRowsList(): TodayRowView[] {
    return parseJsonArray<TodayRowView>(this.todayRows);
  }

  /**
   * ⚠️ 习惯行必须走这个方法，**不能**在 `@Builder` 里写 `const rows = …`：
   * `@Builder` 的函数体只接受"UI 组件语法"，一条 `const` 声明会报
   * `Only UI component syntax can be written here`。
   */
  private habitList(): HabitRowView[] {
    return parseJsonArray<HabitRowView>(this.habitRows);
  }

  private focus(): FocusModel | null {
    try {
      return JSON.parse(this.focusModel) as FocusModel;
    } catch (err) {
      return null;
    }
  }

  build() {
    Column() {
      // 🔴 这一分支必须在最前面：「不知道」和「知道且为空」是**两个状态**。
      //    顺序反了的话，快照读不到时用户会看到「今天没有任务」——
      //    那不是空状态，那是撒谎。
      if (this.state !== 'ready') {
        WidgetMessage({ text: messageFor(this.state, this.isZh) })
      } else if (this.kind === 'today') {
        this.todayBody()
      } else if (this.kind === 'quadrant') {
        this.quadrantBody()
      } else if (this.kind === 'habits') {
        this.habitsBody()
      } else {
        this.focusBody()
      }
    }
    .width('100%')
    .height('100%')
    .padding(12)
    .backgroundColor('#ffffff')
  }

  @Builder
  todayBody() {
    WidgetHeader({
      title: WidgetStrings.title('today', this.isZh),
      badge: this.todayRowsList().length > 0 ? `${this.todayRowsList().length}` : '',
    })
    if (this.todayRowsList().length === 0) {
      WidgetMessage({ text: WidgetStrings.emptyToday(this.isZh) })
    } else {
      List({ space: 0 }) {
        ForEach(this.todayRowsList(), (row: TodayRowView) => {
          ListItem() {
            WidgetTaskRow({ title: row.title, isDone: row.isDone, accent: row.color ?? '', taskId: row.id })
          }
        }, (row: TodayRowView) => row.id)
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)
    }
  }

  @Builder
  quadrantBody() {
    WidgetHeader({ title: WidgetStrings.title('quadrant', this.isZh), badge: '' })
    Column({ space: 4 }) {
      ForEach(parseJsonArray<QuadrantSlotView>(this.quadrantSlots), (slot: QuadrantSlotView) => {
        Row({ space: 6 }) {
          Text(slot.label).fontSize(12).fontColor('#64748b').width(80).maxLines(1)
          Text(slot.firstTitle.length > 0 ? slot.firstTitle : '—')
            .fontSize(13)
            .fontColor(slot.firstTitle.length > 0 ? '#0f172a' : '#cbd5e1')
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
          Text(`${slot.count}`).fontSize(12).fontColor('#94a3b8')
        }
        .width('100%')
        .padding({ top: 3, bottom: 3 })
      }, (slot: QuadrantSlotView) => slot.slot)
    }
    .layoutWeight(1)
  }

  @Builder
  habitsBody() {
    WidgetHeader({
      title: WidgetStrings.title('habits', this.isZh),
      badge: this.habitList().length > 0 ? `${this.habitList().length}` : '',
    })
    if (this.habitList().length === 0) {
      WidgetMessage({ text: WidgetStrings.emptyHabits(this.isZh) })
    } else {
      Column({ space: 2 }) {
        ForEach(this.habitList(), (habit: HabitRowView) => {
          Row({ space: 6 }) {
            Text(habit.doneToday ? '✓' : '○')
              .fontSize(13)
              .fontColor(habit.doneToday ? '#16a34a' : '#94a3b8')
            Text(habit.title).fontSize(14).fontColor('#0f172a').maxLines(1).layoutWeight(1)
            // `streak` 为 0 时模型层**省略**了它 —— 这里不显示"连续 0 天"。
            if ((habit.streak ?? 0) > 0) {
              Text(WidgetStrings.streak(habit.streak ?? 0, this.isZh))
                .fontSize(12)
                .fontColor('#94a3b8')
            }
          }
          .width('100%')
          .padding({ top: 4, bottom: 4 })
        }, (habit: HabitRowView) => habit.id)
      }
      .layoutWeight(1)
    }
  }

  @Builder
  focusBody() {
    WidgetHeader({ title: WidgetStrings.title('focus', this.isZh), badge: '' })
    if (this.focus()?.active !== true) {
      WidgetMessage({ text: WidgetStrings.focusOff(this.isZh) })
    } else {
      Column({ space: 6 }) {
        Text((this.focus()?.sessionTitle ?? '').length > 0
          ? (this.focus()?.sessionTitle ?? '')
          : WidgetStrings.title('focus', this.isZh))
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor('#0f172a')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        // 🔴 **这里没有倒计时，是刻意的。**
        //    契约里的 `remainingSeconds` 是发布那一刻的快照值、没有绝对锚点，
        //    画出来必然错（09:00 发布"剩余 25:00"，09:10 还是 25:00），
        //    而且错得**没有症状** —— 它看起来是对的。
        //    「宁可少显示一个数字，也不显示一个错的数字。」（U8）
        Text(WidgetStrings.target(this.focus()?.targetMinutes ?? 0, this.isZh))
          .fontSize(13)
          .fontColor('#64748b')
      }
      .alignItems(HorizontalAlign.Start)
      .width('100%')
    }
  }
}

interface TodayRowView {
  id: string;
  title: string;
  isDone: boolean;
  color?: string;
}

interface QuadrantSlotView {
  slot: string;
  label: string;
  count: number;
  firstTitle: string;
}

interface HabitRowView {
  id: string;
  title: string;
  doneToday: boolean;
  streak?: number;
}
