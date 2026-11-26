/**
 * 日历「显示设置」的**设备本地偏好**（持久化）
 * ==============================================
 *
 * 覆盖图谱 #40「日历显示设置 / 配色」：给日历一份**能真正切换、且刷新后仍在**的显示偏好。
 *
 * ## 为什么存 `localStorage` 而不是进 op-log
 *
 * 判据与 `features/tasks/row-color-pref.ts` / `features/tasks/due-display-pref.ts` 逐条相同：
 *
 * 1. **设备本地**（`localStorage`，不进 op-log）——「我这台机器想怎么看日历」是界面选择，
 *    不是用户数据。判据：改它之后 op-log 条数不变。
 * 2. **永不抛**：隐私模式下 `localStorage` 读写都会抛，读失败退默认值、写失败静默。
 * 3. 非法值（手改存储 / 旧版本残留 / 将来删掉某一档）**逐字段**退默认值，
 *    不因为一个字段坏了就丢掉整份偏好。
 *
 * 键用 `heyta.` 前缀：`lib/local-data-destruction.ts` 按前缀清理本应用的所有本地键，
 * 换个前缀它就漏清（那份文件头写明"不许点名清单，只认前缀"）。
 *
 * ## 与 store 的关系
 *
 * `store.ts` 在模块初始化时**读一次**这份偏好当初始值；每个 setter 改完再**写回**。
 * 于是「切换」与「持久化」是同一条路径的两个半段，不会出现"界面变了但没存"。
 */

/** 日历着色模式：按清单（默认）/ 按优先级 / 不着色。 */
export type CalendarColorBy = 'list' | 'priority' | 'off';

/** 一份完整的显示偏好。所有字段都是**可选输入**读、读出来一定齐全。 */
export interface CalendarDisplayPref {
  readonly showCompleted: boolean;
  readonly showCountdown: boolean;
  readonly colorBy: CalendarColorBy;
}

/** 存储键。🔴 只导出给判据用（测试要断言"改它不产生 op"），产品代码走下面两个函数。 */
export const CALENDAR_DISPLAY_STORAGE_KEY = 'heyta.calendarDisplay';

const COLOR_MODES: readonly CalendarColorBy[] = ['list', 'priority', 'off'];

export const DEFAULT_CALENDAR_DISPLAY: CalendarDisplayPref = {
  showCompleted: true,
  showCountdown: true,
  colorBy: 'list',
};

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * 读偏好。任何异常 / 非对象 / 非法字段都退默认值（逐字段兜底，不整份丢弃）。
 *
 * 传 `undefined`（存储里没这个键）⇒ 全默认。
 */
export function parseCalendarDisplayPref(raw: unknown): CalendarDisplayPref {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return DEFAULT_CALENDAR_DISPLAY;
  }
  const record = raw as Record<string, unknown>;
  const colorBy = record['colorBy'];
  return {
    showCompleted: boolOr(record['showCompleted'], DEFAULT_CALENDAR_DISPLAY.showCompleted),
    showCountdown: boolOr(record['showCountdown'], DEFAULT_CALENDAR_DISPLAY.showCountdown),
    colorBy: COLOR_MODES.includes(colorBy as CalendarColorBy)
      ? (colorBy as CalendarColorBy)
      : DEFAULT_CALENDAR_DISPLAY.colorBy,
  };
}

/** 从 `localStorage` 读；读失败（隐私模式）或没存过 ⇒ 默认值。 */
export function loadCalendarDisplayPref(): CalendarDisplayPref {
  try {
    const raw = localStorage.getItem(CALENDAR_DISPLAY_STORAGE_KEY);
    if (raw === null) return DEFAULT_CALENDAR_DISPLAY;
    return parseCalendarDisplayPref(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_CALENDAR_DISPLAY;
  }
}

/** 写偏好；写失败静默（不影响本次生效，与 `theme.ts` 同）。 */
export function saveCalendarDisplayPref(pref: CalendarDisplayPref): void {
  try {
    localStorage.setItem(CALENDAR_DISPLAY_STORAGE_KEY, JSON.stringify(pref));
  } catch {
    // 隐私模式下写入抛错 —— 本次界面仍生效，只是刷新后回到默认。
  }
}
