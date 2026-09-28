/**
 * 鸿蒙小组件的文案（中英）。
 *
 * ⚠️ **这是手抄的第 4 份**（Android 的 `values-zh` / `values-en` 资源、
 * iOS 的 `WidgetStrings`、Windows 的 Adaptive Card 模板各有一份）。
 *
 * ⚠️ 上面那句原本写作 `values*` + `/strings.xml`，而那两个字符连起来就是
 * **块注释的结束标记** —— 注释会在那一行提前终止，剩下半个词变成代码，
 * 报错落在**好几行之后**，看起来完全不像注释的问题。
 * 同一个坑在 Swift 那边也踩过一次（见 AGENTS.md §7）。**注释里不要写出那两个字。**
 * `check:ui-language` 只扫 `apps/…/src` 下的 ts/tsx，**没有任何门禁**
 * 能发现四份不一致（进度账本 U11）。把第 4 处摆在明面上，不假装它更安全。
 */
export class WidgetStrings {
  static readonly PLACEHOLDER_ZH: string = '打开 Heyta 以显示小组件';
  static readonly PLACEHOLDER_EN: string = 'Open Heyta to show the widget';
  static readonly STALE_ZH: string = '数据已过期，打开 Heyta 刷新';
  static readonly STALE_EN: string = 'Data is out of date — open Heyta to refresh';
  static readonly EMPTY_TODAY_ZH: string = '今天没有任务';
  static readonly EMPTY_TODAY_EN: string = 'Nothing due today';
  static readonly EMPTY_HABITS_ZH: string = '还没有习惯';
  static readonly EMPTY_HABITS_EN: string = 'No habits yet';
  static readonly FOCUS_OFF_ZH: string = '没有在专注';
  static readonly FOCUS_OFF_EN: string = 'Not focusing';
  static readonly TITLE_TODAY_ZH: string = '今日任务';
  static readonly TITLE_TODAY_EN: string = 'Today';
  static readonly TITLE_QUADRANT_ZH: string = '四象限';
  static readonly TITLE_QUADRANT_EN: string = 'Quadrants';
  static readonly TITLE_HABITS_ZH: string = '今日习惯';
  static readonly TITLE_HABITS_EN: string = 'Habits';
  static readonly TITLE_FOCUS_ZH: string = '今日专注';
  static readonly TITLE_FOCUS_EN: string = 'Focus';
  static readonly STREAK_SUFFIX_ZH: string = '天';
  static readonly STREAK_SUFFIX_EN: string = 'd';
  static readonly MINUTES_ZH: string = '分钟';
  static readonly MINUTES_EN: string = 'min';
  static readonly TARGET_ZH: string = '目标';
  static readonly TARGET_EN: string = 'Target';

  /** 一律走这一个入口 —— 卡片里写死的字符串必然有一处漏翻译。 */
  static pick(zh: string, en: string, isZh: boolean): string {
    return isZh ? zh : en;
  }

  static placeholder(isZh: boolean): string {
    return WidgetStrings.pick(WidgetStrings.PLACEHOLDER_ZH, WidgetStrings.PLACEHOLDER_EN, isZh);
  }

  static stale(isZh: boolean): string {
    return WidgetStrings.pick(WidgetStrings.STALE_ZH, WidgetStrings.STALE_EN, isZh);
  }

  static emptyToday(isZh: boolean): string {
    return WidgetStrings.pick(WidgetStrings.EMPTY_TODAY_ZH, WidgetStrings.EMPTY_TODAY_EN, isZh);
  }

  static emptyHabits(isZh: boolean): string {
    return WidgetStrings.pick(WidgetStrings.EMPTY_HABITS_ZH, WidgetStrings.EMPTY_HABITS_EN, isZh);
  }

  static focusOff(isZh: boolean): string {
    return WidgetStrings.pick(WidgetStrings.FOCUS_OFF_ZH, WidgetStrings.FOCUS_OFF_EN, isZh);
  }

  static title(kind: string, isZh: boolean): string {
    if (kind === 'today') return WidgetStrings.pick(WidgetStrings.TITLE_TODAY_ZH, WidgetStrings.TITLE_TODAY_EN, isZh);
    if (kind === 'quadrant') return WidgetStrings.pick(WidgetStrings.TITLE_QUADRANT_ZH, WidgetStrings.TITLE_QUADRANT_EN, isZh);
    if (kind === 'habits') return WidgetStrings.pick(WidgetStrings.TITLE_HABITS_ZH, WidgetStrings.TITLE_HABITS_EN, isZh);
    return WidgetStrings.pick(WidgetStrings.TITLE_FOCUS_ZH, WidgetStrings.TITLE_FOCUS_EN, isZh);
  }

  static streak(streak: number, isZh: boolean): string {
    return `${streak}${WidgetStrings.pick(WidgetStrings.STREAK_SUFFIX_ZH, WidgetStrings.STREAK_SUFFIX_EN, isZh)}`;
  }

  static target(minutes: number, isZh: boolean): string {
    if (minutes <= 0) return '';
    const unit = WidgetStrings.pick(WidgetStrings.MINUTES_ZH, WidgetStrings.MINUTES_EN, isZh);
    const label = WidgetStrings.pick(WidgetStrings.TARGET_ZH, WidgetStrings.TARGET_EN, isZh);
    return isZh ? `${label} ${minutes}${unit}` : `${label} ${minutes} ${unit}`;
  }
}
