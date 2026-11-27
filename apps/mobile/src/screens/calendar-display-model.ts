/**
 * 日历「显示设置」的纯状态模型。
 * 弹窗只负责渲染与事件绑定，取值、切换与默认值都在这里，便于单独测试。
 */

/** 日历用的颜色维度：按项目着色，或按四象限着色。 */
export type MobileCalendarColorMode = 'byProject' | 'byQuadrant';

/** 日历的视觉样式。 */
export type MobileCalendarStyle = 'classic' | 'modern';

export interface MobileCalendarDisplayOptions {
  readonly colorMode: MobileCalendarColorMode;
  readonly style: MobileCalendarStyle;
  readonly showChecklist: boolean;
  readonly showAllRepeats: boolean;
  readonly showHabits: boolean;
  readonly showFocus: boolean;
  readonly showCourses: boolean;
  readonly showCompleted: boolean;
  readonly showCountdown: boolean;
  readonly secondaryTimezone: boolean;
}

/** 所有开关项的名字（排除 colorMode / style 两个选择项）。 */
export type MobileCalendarDisplayFlag = {
  readonly [K in keyof MobileCalendarDisplayOptions]: MobileCalendarDisplayOptions[K] extends boolean
    ? K
    : never;
}[keyof MobileCalendarDisplayOptions];

export const DEFAULT_MOBILE_DISPLAY_OPTIONS: MobileCalendarDisplayOptions = {
  colorMode: 'byProject',
  style: 'classic',
  showChecklist: true,
  showAllRepeats: false,
  showHabits: true,
  showFocus: true,
  showCourses: true,
  showCompleted: false,
  showCountdown: false,
  secondaryTimezone: false,
};

/** 翻转一个开关项，返回新对象，不改动入参。 */
export function toggleDisplayOption(
  options: MobileCalendarDisplayOptions,
  flag: MobileCalendarDisplayFlag,
): MobileCalendarDisplayOptions {
  return { ...options, [flag]: !options[flag] };
}

/** 切换颜色维度，返回新对象，不改动入参。 */
export function setDisplayMode(
  options: MobileCalendarDisplayOptions,
  mode: MobileCalendarColorMode,
): MobileCalendarDisplayOptions {
  return { ...options, colorMode: mode };
}
