/**
 * 四款卡片的**视图模型**（鸿蒙侧）。
 *
 * 与 `WidgetParse.ts` 同一档纪律：纯逻辑、放 `.ts`、可被 vitest 与 `es2abc`
 * 双重验证。ArkUI 的 `struct` 只负责"把这些字段摆到屏幕上"，
 * **不在 UI 里做任何判断** —— 判断一旦进了 UI，就再也没法测了。
 *
 * ## 🔴 每张卡片都有"我不知道"这一档，且它和数据空是**两个状态**
 *
 * | 状态 | 含义 | 卡片说什么 |
 * |---|---|---|
 * | `placeholder` | 快照还没读到 / 解不开 / 版本不认识 | 「打开 Heyta 以显示小组件」 |
 * | `stale` | 快照读到了但已过期 | 「数据已过期，打开 Heyta 刷新」 |
 * | `ready` | 数据可信 | 真实内容（可能是空的） |
 *
 * 把 `placeholder` 与"空"混为一谈的后果是：用户**还没打开过应用**时
 * 看到「今天没有任务」—— 那不是空状态，那是**撒谎**，而且用户看到它
 * 就不会去做那件事。这条在 Windows 侧已经被测试抓出来过一次
 * （见进度账本 W3 证据块），这里从模型层就把两者分开。
 */

// ⚠️ **无后缀**，与 HarmonyOS 工程的 import 风格一致。
//    不能写 `'./WidgetParse.js'`：`es2abc` 不做 TypeScript 的 `.js` → `.ts`
//    解析（实测：带 `.js` 时它去找一个不存在的 `WidgetParse.js`）。
//    而鸿蒙工程里本来就该这么写，所以这不是"为了门禁而改源码"。
import type { WidgetFocus, WidgetHabit, WidgetPayload, WidgetTask } from './WidgetParse';

/** 卡片能处于的三种状态。**顺序有意义**：越靠前越"不知道"。 */
export type CardState = 'placeholder' | 'stale' | 'ready';

/**
 * 四象限的显示名。
 *
 * ⚠️ **这是手抄的第 4 份。** 真源是 `packages/domain/src/quadrant.ts` 的
 * `QUADRANT_META.label`，Android 的 `values/strings.xml` 与 iOS 的
 * `WidgetStrings` 各有一份。`check:ui-language` 只扫 `apps/…/src` 下的 ts/tsx，
 * **没有任何门禁能发现这四份不一致**（记在进度账本 U11）。
 * 这里不假装它更安全 —— 只是把第 4 处摆在明面上。
 *
 * 槽位号是 `1..4`（`Quadrant` 是**数字枚举**）。
 * 🔴 不要用 `Object.values(Quadrant)` 那种省略反而出错的方式枚举它。
 */
export const QUADRANT_LABELS: Record<string, string> = {
  '1': '重要且紧急',
  '2': '重要不紧急',
  '3': '紧急不重要',
  '4': '不重要不紧急',
};

// ─────────────────────────────────────────────────────────────
// 今日任务
// ─────────────────────────────────────────────────────────────

export interface TodayRow {
  id: string;
  title: string;
  isDone: boolean;
  /** 已解析的项目色槽位。缺失时**省略**，由卡片回退到默认色。 */
  color?: string;
}

export interface TodayModel {
  state: CardState;
  dayStr: string;
  count: number;
  isEmpty: boolean;
  rows: TodayRow[];
}

function rowOf(task: WidgetTask, payload: WidgetPayload, dark: boolean): TodayRow {
  const row: TodayRow = { id: task.id, title: task.title, isDone: task.isDone };
  const colors = payload.projectColors;
  if (task.projectId !== undefined && colors !== undefined) {
    const pair = colors[task.projectId];
    if (pair !== undefined) row.color = dark ? pair.dark : pair.light;
  }
  return row;
}

/**
 * 今日任务卡片。
 *
 * 上限 20（`WIDGET_MAX_TASKS`）**由应用侧截断**，这里不再截 ——
 * 两份截断逻辑必然漂移，而漂移的表现是"应用以为发了 20 条、卡片只画了 15 条"。
 */
export function buildTodayModel(payload: WidgetPayload, dark: boolean): TodayModel {
  const rows: TodayRow[] = [];
  for (const task of payload.today) rows.push(rowOf(task, payload, dark));
  return {
    state: 'ready',
    dayStr: '',
    count: rows.length,
    isEmpty: rows.length === 0,
    rows,
  };
}

// ─────────────────────────────────────────────────────────────
// 四象限
// ─────────────────────────────────────────────────────────────

export interface QuadrantSlot {
  slot: string;
  label: string;
  count: number;
  /** 该槽位的第一条未完成任务标题。空槽为 `''`。 */
  firstTitle: string;
}

export interface QuadrantModel {
  state: CardState;
  slots: QuadrantSlot[];
}

/**
 * 四象限卡片。
 *
 * 🔴 **四个槽位全部出现，即使是 0**。只画非空的槽位会让用户以为
 * 某个象限不存在 —— 而"我今天没有重要且紧急的事"是一个**有意义的信息**，
 * 比"这一格没了"有用得多。
 */
export function buildQuadrantModel(payload: WidgetPayload): QuadrantModel {
  const quadrant = payload.quadrant ?? {};
  const slots: QuadrantSlot[] = [];
  for (const slot of ['1', '2', '3', '4']) {
    const tasks = quadrant[slot] ?? [];
    let firstTitle = '';
    for (const task of tasks) {
      if (!task.isDone) {
        firstTitle = task.title;
        break;
      }
    }
    slots.push({
      slot,
      label: QUADRANT_LABELS[slot] ?? '',
      count: tasks.length,
      firstTitle,
    });
  }
  return { state: 'ready', slots };
}

// ─────────────────────────────────────────────────────────────
// 今日习惯
// ─────────────────────────────────────────────────────────────

export interface HabitRow {
  id: string;
  title: string;
  doneToday: boolean;
  /** 连续天数。0 时**省略**（不显示"连续 0 天"）。 */
  streak?: number;
}

export interface HabitsModel {
  state: CardState;
  isEmpty: boolean;
  rows: HabitRow[];
}

export function buildHabitsModel(payload: WidgetPayload): HabitsModel {
  const habits: WidgetHabit[] = payload.habits ?? [];
  const rows: HabitRow[] = [];
  for (const habit of habits) {
    const row: HabitRow = {
      id: habit.id,
      title: habit.title,
      doneToday: habit.doneToday,
    };
    // `streak` 在契约里是 Double，模型层收成整数。
    // 0 天不显示 —— 一个都没连上时说"连续 0 天"是噪音。
    const streak = Math.trunc(habit.streak);
    if (streak > 0) row.streak = streak;
    rows.push(row);
  }
  return { state: 'ready', isEmpty: rows.length === 0, rows };
}

// ─────────────────────────────────────────────────────────────
// 今日专注
// ─────────────────────────────────────────────────────────────

export interface FocusModel {
  state: CardState;
  active: boolean;
  sessionTitle: string;
  /**
   * 目标时长，**已四舍五入到分钟**。
   *
   * ⚠️ 这里**没有** `remaining` 字段，而且是刻意的 —— 见 `buildFocusModel`。
   */
  targetMinutes: number;
}

/** 秒 → 分钟。**四舍五入**：90 秒该显示"2 分钟"，截断会显示 1 分钟。 */
export function secondsToMinutes(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round(seconds / 60);
}

/**
 * 今日专注卡片。
 *
 * ## 🔴 这张卡片**不画倒计时**，与 Android `FocusWidgetModel` 逐条一致
 *
 * 契约里的 `WidgetFocus.remainingSeconds` 是**发布那一刻**的快照值，
 * **没有绝对时间锚点**：09:00 发布"剩余 25:00"，09:10 打开的卡片上
 * 还是 25:00。`active` 同样冻结 —— 一场 09:25 结束的专注，10:00 还说"专注中"。
 *
 * 画一个错的倒计时**没有任何症状**：它看起来是对的，所以没人会报 bug，
 * 而用户会照着它安排时间。
 *
 * **宁可少显示一个数字，也不显示一个错的数字。**
 * 正确修法是给契约加 `endsAt`（`FocusState` 里本来就有），原生便能算
 * `remaining = endsAt - now` —— 那是它**已经有权做的事**（它本来就在判
 * `now >= validUntil`）。这是契约变更，要四端 + 夹具一起动，记为 **U8**。
 *
 * 所以这里只画**不随时间变**的事实：会话标题 + 目标时长。
 */
export function buildFocusModel(payload: WidgetPayload): FocusModel {
  const focus: WidgetFocus | undefined = payload.focus;
  if (focus === undefined || focus.active !== true) {
    return { state: 'ready', active: false, sessionTitle: '', targetMinutes: 0 };
  }
  return {
    state: 'ready',
    active: true,
    sessionTitle: focus.sessionTitle ?? '',
    targetMinutes: secondsToMinutes(focus.targetSeconds ?? 0),
  };
}

/** 单条任务的行内时长文案。`''` 表示不显示。 */
export function formatTarget(minutes: number): string {
  if (minutes <= 0) return '';
  return `目标 ${minutes} 分钟`;
}
