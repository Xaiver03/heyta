import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MOBILE_DISPLAY_OPTIONS,
  setDisplayMode,
  toggleDisplayOption,
  type MobileCalendarDisplayFlag,
  type MobileCalendarDisplayOptions,
} from '../src/screens/calendar-display-model';

const FLAGS: readonly MobileCalendarDisplayFlag[] = [
  'showChecklist',
  'showAllRepeats',
  'showHabits',
  'showFocus',
  'showCourses',
  'showCompleted',
  'showCountdown',
  'secondaryTimezone',
];

const baseline: MobileCalendarDisplayOptions = {
  ...DEFAULT_MOBILE_DISPLAY_OPTIONS,
  colorMode: 'byProject',
  style: 'classic',
};

describe('calendar display model', () => {
  it('默认值覆盖颜色维度、样式与全部开关', () => {
    expect(DEFAULT_MOBILE_DISPLAY_OPTIONS.colorMode).toBe('byProject');
    expect(DEFAULT_MOBILE_DISPLAY_OPTIONS.style).toBe('classic');
    for (const flag of FLAGS) {
      expect(typeof DEFAULT_MOBILE_DISPLAY_OPTIONS[flag]).toBe('boolean');
    }
  });

  it('toggleDisplayOption 只翻转目标开关，其余字段保持不变', () => {
    for (const flag of FLAGS) {
      const next = toggleDisplayOption(baseline, flag);
      expect(next[flag]).toBe(!baseline[flag]);
      expect(next.colorMode).toBe(baseline.colorMode);
      expect(next.style).toBe(baseline.style);
      for (const other of FLAGS) {
        if (other === flag) continue;
        expect(next[other]).toBe(baseline[other]);
      }
    }
  });

  it('toggleDisplayOption 不修改入参，连续翻转两次回到原状', () => {
    const snapshot = { ...baseline };
    const once = toggleDisplayOption(baseline, 'showChecklist');
    const twice = toggleDisplayOption(once, 'showChecklist');
    expect(baseline).toEqual(snapshot);
    expect(once).not.toBe(baseline);
    expect(twice).toEqual(baseline);
  });

  it('setDisplayMode 切换颜色维度并保留其余设置', () => {
    const next = setDisplayMode(baseline, 'byQuadrant');
    expect(next.colorMode).toBe('byQuadrant');
    expect(next.style).toBe(baseline.style);
    for (const flag of FLAGS) {
      expect(next[flag]).toBe(baseline[flag]);
    }
    expect(baseline.colorMode).toBe('byProject');
    expect(next).not.toBe(baseline);
  });
});
