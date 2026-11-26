/**
 * 日历订阅列表存储判据
 * ====================
 * 坏 JSON / 坏形状不炸；往返保真；增删改；URL 默认名。
 */

import { META_KEYS } from '@heyta/storage';
import { describe, expect, it } from 'vitest';

import {
  addCalendarSubscription,
  hostOf,
  loadCalendarSubscriptions,
  removeCalendarSubscription,
  saveCalendarSubscriptions,
  updateCalendarSubscription,
} from '../src/connectors/subscription-store.js';

function memoryPort() {
  const meta = new Map<string, string | number>();
  return {
    meta,
    getMetaValue: async (key: string) => meta.get(key),
    setMetaValue: async (key: string, value: string | number) => {
      meta.set(key, value);
    },
  };
}

describe('calendar subscription store', () => {
  it('空 / 坏 JSON / 坏形状 → 空数组（不抛）', async () => {
    const port = memoryPort();
    expect(await loadCalendarSubscriptions(port)).toEqual([]);
    port.meta.set(META_KEYS.CALENDAR_SUBSCRIPTION_LIST, '{not json');
    expect(await loadCalendarSubscriptions(port)).toEqual([]);
    port.meta.set(META_KEYS.CALENDAR_SUBSCRIPTION_LIST, JSON.stringify({ nope: 1 }));
    expect(await loadCalendarSubscriptions(port)).toEqual([]);
    port.meta.set(
      META_KEYS.CALENDAR_SUBSCRIPTION_LIST,
      JSON.stringify([{ id: '', url: 'x' }, { id: 'a', url: '' }, { id: 'ok', url: 'https://a.com/f.ics' }]),
    );
    expect(await loadCalendarSubscriptions(port)).toEqual([
      { id: 'ok', url: 'https://a.com/f.ics', name: 'a.com', enabled: true },
    ]);
  });

  it('保存后读回保真；同 id 只留最后一条', async () => {
    const port = memoryPort();
    await saveCalendarSubscriptions(port, [
      { id: 'a', url: 'https://a/f.ics', name: 'A', enabled: true },
      { id: 'a', url: 'https://a/f2.ics', name: 'A2', enabled: false },
    ]);
    expect(await loadCalendarSubscriptions(port)).toEqual([
      { id: 'a', url: 'https://a/f2.ics', name: 'A2', enabled: false },
    ]);
  });

  it('新增（自动 id + URL 默认名）、删除、更新', () => {
    const { list, record } = addCalendarSubscription([], { url: 'https://www.example.com/cal.ics' });
    expect(record.id).not.toBe('');
    expect(record.name).toBe('example.com');
    expect(record.enabled).toBe(true);
    expect(list).toHaveLength(1);

    const added = addCalendarSubscription(list, { id: 'b', name: '团队', url: 'https://b/cal.ics' });
    expect(added.list).toHaveLength(2);

    const updated = updateCalendarSubscription(added.list, 'b', { enabled: false, name: '团队2' });
    expect(updated.find((e) => e.id === 'b')).toMatchObject({ enabled: false, name: '团队2' });

    expect(removeCalendarSubscription(updated, 'b').map((e) => e.id)).toEqual([record.id]);
  });

  it('hostOf 容错：坏 URL 原样返回', () => {
    expect(hostOf('not a url')).toBe('not a url');
    expect(hostOf('https://www.dida365.com/x.ics')).toBe('dida365.com');
  });
});
