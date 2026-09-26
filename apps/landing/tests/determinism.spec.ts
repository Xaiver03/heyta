/**
 * 确定性的"假数据"
 * ==================
 *
 * 热力图与逐字加密都用 sin 散列生成图案，**刻意不用 `Math.random()`**。
 *
 * 为什么这条值得测试：`Math.random()` 的坏处不是"不够随机"，而是
 * **同一个界面每次渲染都不一样**。React 严格模式会渲染两遍，
 * 于是图案会在用户眼前闪一下；而且每次刷新都不一样，看起来像数据在乱跳。
 * 这种 bug 很难在 code review 里看出来（代码"能跑"），却非常显眼。
 *
 * 所以这里测两层：
 *   1. 行为层：重复调用结果相同、值域正确；
 *   2. 源码层：这两个文件里**不存在** `Math.random` ——
 *      直接把"别换成随机数"这条约束钉在测试里。
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { levelFor, type Habit } from '../src/mockup/HabitHeatmap.js';
import { cipherCharAt } from '../src/components/Privacy.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../src');

describe('cipherCharAt：逐字加密的密文', () => {
  it('同一个位置永远得到同一个字符（严格模式下不会闪）', () => {
    for (const index of [0, 1, 5, 8, 40, 999]) {
      expect(cipherCharAt(index)).toBe(cipherCharAt(index));
    }
  });

  it('返回值始终是十六进制字符 —— 否则密文看起来会像乱码而不是密文', () => {
    for (let index = 0; index < 200; index += 1) {
      expect(cipherCharAt(index)).toMatch(/^[0-9A-F]$/);
    }
  });

  it('不是常量函数（否则所有字都变成同一个字符）', () => {
    const produced = new Set(Array.from({ length: 64 }, (_, index) => cipherCharAt(index)));
    expect(produced.size).toBeGreaterThan(4);
  });
});

describe('levelFor：习惯热力图', () => {
  const habit: Habit = { name: '测试', streak: '', seed: 2, density: 0.61 };

  it('同一格永远得到同一档', () => {
    for (const week of [0, 7, 25]) {
      for (const day of [0, 3, 6]) {
        expect(levelFor(habit, week, day)).toBe(levelFor(habit, week, day));
      }
    }
  });

  it('档位始终落在 0..4（热力图只有 5 级色阶）', () => {
    for (let week = 0; week < 26; week += 1) {
      for (let day = 0; day < 7; day += 1) {
        const level = levelFor(habit, week, day);
        expect(level).toBeGreaterThanOrEqual(0);
        expect(level).toBeLessThanOrEqual(4);
      }
    }
  });

  it('不同习惯得到不同图案（seed 真的起作用）', () => {
    const a: Habit = { name: 'a', streak: '', seed: 1, density: 0.82 };
    const b: Habit = { name: 'b', streak: '', seed: 3, density: 0.38 };
    const patternA = Array.from({ length: 26 }, (_, w) => levelFor(a, w, 1)).join('');
    const patternB = Array.from({ length: 26 }, (_, w) => levelFor(b, w, 1)).join('');
    expect(patternA).not.toBe(patternB);
  });

  it('密度高的习惯整体档位更高（density 真的起作用）', () => {
    const sparse: Habit = { name: 's', streak: '', seed: 5, density: 0.1 };
    const dense: Habit = { name: 'd', streak: '', seed: 5, density: 0.95 };
    const sum = (h: Habit): number => {
      let total = 0;
      for (let week = 0; week < 26; week += 1) {
        for (let day = 0; day < 7; day += 1) total += levelFor(h, week, day);
      }
      return total;
    };
    expect(sum(dense)).toBeGreaterThan(sum(sparse));
  });
});

describe('源码层：这两个文件里不得出现 Math.random', () => {
  const FILES = ['mockup/HabitHeatmap.tsx', 'components/Privacy.tsx'];

  for (const relative of FILES) {
    it(`${relative} 不用 Math.random`, () => {
      const source = readFileSync(join(SRC, relative), 'utf8');
      // 注释里提到它（解释为什么不用）是允许的，所以逐行排除纯注释行。
      const offenders = source
        .split('\n')
        .map((line, index) => ({ line, number: index + 1 }))
        .filter(({ line }) => /Math\.random/.test(line))
        .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line));

      expect(offenders).toEqual([]);
    });
  }
});
