/**
 * 智能清单显示配置的语义钉子（#18）
 * ================================
 *
 * 这些用例钉的是 `normalizeSmartListConfig` 的**归并规则**与两个编辑函数的边界 ——
 * 只要有一处写错，下面就会红（不是"跑过一遍"就算）。
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SMART_LIST_CONFIG,
  moveSmartList,
  normalizeSmartListConfig,
  setSmartListVisible,
  visibleSmartListKeys,
} from '../src/smart-list.js';

describe('normalizeSmartListConfig：全集、有顺序、无重复', () => {
  it('空 / 坏值都回落默认（三条全显示、默认顺序）', () => {
    expect(normalizeSmartListConfig(undefined)).toEqual(DEFAULT_SMART_LIST_CONFIG);
    expect(normalizeSmartListConfig(null)).toEqual(DEFAULT_SMART_LIST_CONFIG);
    expect(normalizeSmartListConfig('nonsense')).toEqual(DEFAULT_SMART_LIST_CONFIG);
    expect(normalizeSmartListConfig(42)).toEqual(DEFAULT_SMART_LIST_CONFIG);
  });

  it('认不出的 key 丢掉、重复只留第一次、可见性原样保留', () => {
    const config = normalizeSmartListConfig({
      entries: [
        { key: 'completed', visible: false },
        { key: 'bogus', visible: true },
        { key: 'completed', visible: true },
        { key: 'today', visible: 'yes' },
      ],
    });
    // 顺序：存量顺序在前（completed, today），缺的 next7Days 补在末尾。
    expect(config.entries.map((e) => e.key)).toEqual(['completed', 'today', 'next7Days']);
    expect(config.entries.find((e) => e.key === 'completed')?.visible).toBe(false);
    // 'yes' 不是布尔 ⇒ 回落 true
    expect(config.entries.find((e) => e.key === 'today')?.visible).toBe(true);
    // 补上的那条默认显示
    expect(config.entries.find((e) => e.key === 'next7Days')?.visible).toBe(true);
  });

  it('缺的 key 补在末尾（新清单不会被老配置永久隐藏）', () => {
    const config = normalizeSmartListConfig({ entries: [{ key: 'today', visible: true }] });
    expect(config.entries.map((e) => e.key)).toEqual(['today', 'next7Days', 'completed']);
  });

  it('接受裸数组形状', () => {
    expect(normalizeSmartListConfig([{ key: 'next7Days', visible: false }]).entries.map((e) => e.key)).toEqual([
      'next7Days',
      'today',
      'completed',
    ]);
  });
});

describe('visibleSmartListKeys / setSmartListVisible', () => {
  it('只返回可见项、按配置顺序', () => {
    const config = setSmartListVisible(DEFAULT_SMART_LIST_CONFIG, 'today', false);
    expect(visibleSmartListKeys(config)).toEqual(['next7Days', 'completed']);
  });

  it('切换不改入参', () => {
    const base = DEFAULT_SMART_LIST_CONFIG;
    const next = setSmartListVisible(base, 'completed', false);
    expect(visibleSmartListKeys(base)).toEqual(['today', 'next7Days', 'completed']);
    expect(next).not.toBe(base);
  });
});

describe('moveSmartList：上移 / 下移 / 两端不越界', () => {
  it('上移把中间那条换到前面', () => {
    const moved = moveSmartList(DEFAULT_SMART_LIST_CONFIG, 'next7Days', 'up');
    expect(moved.entries.map((e) => e.key)).toEqual(['next7Days', 'today', 'completed']);
  });

  it('下移把中间那条换到后面', () => {
    const moved = moveSmartList(DEFAULT_SMART_LIST_CONFIG, 'next7Days', 'down');
    expect(moved.entries.map((e) => e.key)).toEqual(['today', 'completed', 'next7Days']);
  });

  it('🔴 第一条上移 / 最后一条下移都不动（不绕排）', () => {
    expect(moveSmartList(DEFAULT_SMART_LIST_CONFIG, 'today', 'up')).toBe(DEFAULT_SMART_LIST_CONFIG);
    expect(moveSmartList(DEFAULT_SMART_LIST_CONFIG, 'completed', 'down')).toBe(DEFAULT_SMART_LIST_CONFIG);
  });
});
