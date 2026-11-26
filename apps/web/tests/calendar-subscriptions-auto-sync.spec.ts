/**
 * 订阅自动同步的选择判据（纯函数）
 * ==============================
 * 停用不同步；从未同步过要同步；刚同步过（< 最小间隔）不同步；超过间隔才同步。
 */

import { describe, expect, it } from 'vitest';

import { dueSubscriptions } from '../src/features/calendar/useCalendarSubscriptionsAutoSync.js';

const NOW = Date.UTC(2026, 10, 24, 8, 0, 0);
const sub = (id: string, enabled = true) => ({ id, name: id, url: `https://example.com/${id}.ics`, enabled });

describe('dueSubscriptions', () => {
  it('停用 / 刚同步过 的跳过；从未同步 / 超过最小间隔 的入选', () => {
    const due = dueSubscriptions({
      subscriptions: [sub('never'), sub('disabled', false), sub('recent')],
      lastSyncById: { recent: NOW - 60_000 },
      nowMs: NOW,
    });
    expect(due.map((s) => s.id)).toEqual(['never']);
  });

  it('超过默认 5 分钟间隔才自动同步', () => {
    const due = dueSubscriptions({
      subscriptions: [sub('old'), sub('fresh')],
      lastSyncById: { old: NOW - 6 * 60_000, fresh: NOW - 60_000 },
      nowMs: NOW,
    });
    expect(due.map((s) => s.id)).toEqual(['old']);
  });

  it('可覆盖最小间隔', () => {
    const due = dueSubscriptions({
      subscriptions: [sub('recent')],
      lastSyncById: { recent: NOW - 60_000 },
      nowMs: NOW,
      minIntervalMs: 30_000,
    });
    expect(due.map((s) => s.id)).toEqual(['recent']);
  });
});
