/**
 * 自动同步的调度判断（纯函数）
 * ==========================
 *
 * 这条挡的是"配置了却一直不更新"和"每开一次标签页就狂拉 Hub"两端：
 *
 *   · 从未同步 / 记录非法 ⇒ 该同步（配完就该看见日程）；
 *   · 刚好到阈值 ⇒ 同步；差 1ms ⇒ 不同步（边界是 ≥，不是 >）；
 *   · 记录在将来（时钟回拨）⇒ **不同步**（保守，避免被回拨的钟放大成请求风暴）。
 *
 * 全部是纯函数断言：不碰网络、不碰 DOM、不建定时器。
 */

import { describe, expect, it } from 'vitest';

import {
  CALENDAR_AUTO_SYNC_MIN_INTERVAL_MS,
  shouldAutoSync,
} from '../src/calendar-sync-scheduler.js';

const MIN = CALENDAR_AUTO_SYNC_MIN_INTERVAL_MS;
const NOW = 1_700_000_000_000;

describe('shouldAutoSync', () => {
  it('阈值就是 5 分钟', () => {
    expect(MIN).toBe(5 * 60_000);
  });

  it('从未同步过 ⇒ true', () => {
    expect(shouldAutoSync({ lastSyncMs: undefined, nowMs: NOW })).toBe(true);
  });

  it('刚好等于阈值 ⇒ true（边界含等于）', () => {
    expect(shouldAutoSync({ lastSyncMs: NOW - MIN, nowMs: NOW })).toBe(true);
  });

  it('差 1ms 不到阈值 ⇒ false', () => {
    expect(shouldAutoSync({ lastSyncMs: NOW - MIN + 1, nowMs: NOW })).toBe(false);
  });

  it('lastSync 在将来（时钟回拨）⇒ false', () => {
    expect(shouldAutoSync({ lastSyncMs: NOW + 1, nowMs: NOW })).toBe(false);
    expect(shouldAutoSync({ lastSyncMs: NOW + MIN, nowMs: NOW })).toBe(false);
  });

  it('非法 / 非正 lastSync 视为从未同步 ⇒ true', () => {
    for (const bad of [0, -1, -MIN, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(shouldAutoSync({ lastSyncMs: bad, nowMs: NOW }), `lastSync=${String(bad)}`).toBe(true);
    }
  });

  it('可以覆盖最小间隔（测试/未来可调）', () => {
    expect(shouldAutoSync({ lastSyncMs: NOW - 1_000, nowMs: NOW, minIntervalMs: 1_000 })).toBe(true);
    expect(shouldAutoSync({ lastSyncMs: NOW - 999, nowMs: NOW, minIntervalMs: 1_000 })).toBe(false);
  });
});
