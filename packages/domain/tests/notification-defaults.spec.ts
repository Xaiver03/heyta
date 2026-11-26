/**
 * 通知行为默认值的语义钉子（#57）
 * ==============================
 * 钉的是"逐字段回落"这条承诺：坏值不能让界面拿到 NaN / 未知字符串。
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NOTIFICATION_DEFAULTS,
  normalizeNotificationDefaults,
} from '../src/notification-defaults.js';

describe('normalizeNotificationDefaults：逐字段回落', () => {
  it('非对象 / 空值都回落默认', () => {
    expect(normalizeNotificationDefaults(undefined)).toEqual(DEFAULT_NOTIFICATION_DEFAULTS);
    expect(normalizeNotificationDefaults(null)).toEqual(DEFAULT_NOTIFICATION_DEFAULTS);
    expect(normalizeNotificationDefaults('x')).toEqual(DEFAULT_NOTIFICATION_DEFAULTS);
  });

  it('合法值原样保留', () => {
    expect(
      normalizeNotificationDefaults({
        leadMinutes: 30,
        allDayReminder: 'dayBefore',
        completionSound: false,
        showDetail: false,
      }),
    ).toEqual({
      leadMinutes: 30,
      allDayReminder: 'dayBefore',
      completionSound: false,
      showDetail: false,
    });
  });

  it('🔴 越界 / 类型错的字段回落默认，其余字段保留', () => {
    const result = normalizeNotificationDefaults({
      leadMinutes: 7, // 不在选项里
      allDayReminder: 'nextWeek', // 未知枚举
      completionSound: 'yes', // 不是布尔
      showDetail: false, // 合法
    });
    expect(result.leadMinutes).toBe(DEFAULT_NOTIFICATION_DEFAULTS.leadMinutes);
    expect(result.allDayReminder).toBe(DEFAULT_NOTIFICATION_DEFAULTS.allDayReminder);
    expect(result.completionSound).toBe(DEFAULT_NOTIFICATION_DEFAULTS.completionSound);
    expect(result.showDetail).toBe(false);
  });

  it('0 是合法值（到点提醒），不能被真值判断当成缺省', () => {
    expect(normalizeNotificationDefaults({ leadMinutes: 0 }).leadMinutes).toBe(0);
  });
});
