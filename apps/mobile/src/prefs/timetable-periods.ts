/**
 * 课表「作息表节次」配置（设备本地，永不同步）
 * ============================================
 *
 * 课表视图按"第N节 起-止"渲染，节次时间因学校而异。这里给一套默认值，并允许用户
 * 在设备本地改（`readDevicePref` / `writeDevicePref`，走 op-sqlite 的 device-pref 库，
 * 不引新依赖、不进同步）。改动只影响这台设备上的课表外观，不碰任何课程/任务数据。
 */

import { readDevicePref, writeDevicePref } from './device-prefs';

export interface Period {
  readonly start: string; // 'HH:mm'
  readonly end: string; // 'HH:mm'
}

export const PREF_KEY_TIMETABLE_PERIODS = 'timetable.periods';

/** 默认一套常见大学作息（10 节）。用户可改。 */
export const DEFAULT_PERIODS: readonly Period[] = [
  { start: '08:00', end: '08:45' },
  { start: '08:55', end: '09:40' },
  { start: '10:00', end: '10:45' },
  { start: '10:55', end: '11:40' },
  { start: '14:00', end: '14:45' },
  { start: '14:55', end: '15:40' },
  { start: '16:00', end: '16:45' },
  { start: '16:55', end: '17:40' },
  { start: '19:00', end: '19:45' },
  { start: '19:55', end: '20:40' },
];

const HM = /^([01]?\d|2[0-3]):[0-5]\d$/;

function isValidPeriod(p: unknown): p is Period {
  if (typeof p !== 'object' || p === null) return false;
  const rec = p as { start?: unknown; end?: unknown };
  return typeof rec.start === 'string' && typeof rec.end === 'string' && HM.test(rec.start) && HM.test(rec.end);
}

/** 读设备上的作息表；没有 / 损坏 / 空 → 用默认（永不抛，与 device-prefs 同一条纪律）。 */
export function readPeriods(): readonly Period[] {
  const raw = readDevicePref(PREF_KEY_TIMETABLE_PERIODS);
  if (raw === undefined) return DEFAULT_PERIODS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isValidPeriod)) return parsed;
  } catch {
    /* 忽略损坏值，退回默认 */
  }
  return DEFAULT_PERIODS;
}

/** 存作息表。返回是否写成功（写不进的后果由调用方说出来，不静默假装成功）。 */
export function writePeriods(periods: readonly Period[]): boolean {
  const clean = periods.filter(isValidPeriod);
  if (clean.length === 0) return false;
  return writeDevicePref(PREF_KEY_TIMETABLE_PERIODS, JSON.stringify(clean));
}
