import { describe, expect, it } from 'vitest';
import {
  ALL_STORES,
  DEFAULT_ITERATE_LIMIT,
  META_KEYS,
  OP_INDEXES,
  STORES,
  assertIterateLimit,
} from '../src';

describe('存储 schema 自洽性', () => {
  it('store 名称无重复', () => {
    expect(new Set(ALL_STORES).size).toBe(ALL_STORES.length);
    expect(ALL_STORES).toHaveLength(Object.keys(STORES).length);
  });

  it('索引名称无重复', () => {
    const names = Object.values(OP_INDEXES);
    expect(new Set(names).size).toBe(names.length);
  });

  it('meta 键无重复', () => {
    const keys = Object.values(META_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('clientId 是同步协议的关键状态，必须登记为 meta 键', () => {
    // clientId 是 LWW 冲突的确定性决胜依据。少了它，两端同时改同一字段时
    // 无法得到一致的收敛结果 —— 不同端会各自判出不同的赢家。
    expect(META_KEYS.CLIENT_ID).toBeDefined();
    expect(META_KEYS.LAST_SERVER_SEQ).toBeDefined();
  });
});

describe('assertIterateLimit', () => {
  it('接受合法上限', () => {
    expect(() => assertIterateLimit(1)).not.toThrow();
    expect(() => assertIterateLimit(DEFAULT_ITERATE_LIMIT)).not.toThrow();
  });

  it('不传 limit 时不报错（由实现决定是否用默认值）', () => {
    expect(() => assertIterateLimit(undefined)).not.toThrow();
  });

  it('拒绝非正整数', () => {
    // 无上限的游标遍历是移动端卡死的常见原因，要在开发期就炸
    expect(() => assertIterateLimit(0)).toThrow();
    expect(() => assertIterateLimit(-1)).toThrow();
    expect(() => assertIterateLimit(1.5)).toThrow();
    expect(() => assertIterateLimit(Number.NaN)).toThrow();
    expect(() => assertIterateLimit(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('默认上限是有限值', () => {
    expect(Number.isFinite(DEFAULT_ITERATE_LIMIT)).toBe(true);
    expect(DEFAULT_ITERATE_LIMIT).toBeGreaterThan(0);
  });
});
