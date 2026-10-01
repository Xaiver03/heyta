/**
 * 习惯图标（闭集词表 / 派生）测试
 * ================================
 *
 * 这个模块错了不报错，只在界面上"看起来有点怪"，所以逐条钉住。三组各自的失效形状：
 *
 * **词表**：`HABIT_ICONS` 的**顺序**决定 `deriveHabitIcon` 的取值 —— 换序等于给存量
 * 习惯换图标（磁盘里没存图标的那些没有任何东西能把它拉回来）。所以这里逐字钉住
 * 这一份列表，改它必须是一次显式的、带理由的编辑，而不是顺手重排。
 * 另外钉住「不许出现字形名」：把 `Droplets` 写进磁盘，等于让一次换库改掉用户数据。
 *
 * **解析**：不认识的值必须返回 `undefined`，**不许回退成第一项**。
 * 回退成第一项的症状是一堆不相干的习惯全变成水滴，而任何一层都不报错。
 *
 * **派生**：必须是确定的、且随 id 变。写成常量（或写成"永远 drop"）的话，
 * 每条习惯同一个图标，界面看着"正常"，只有用户想区分时才发现区分不了。
 * 也不能按下标 —— 删掉第一条会让后面每条往左挪一格。
 */

import { describe, expect, it } from 'vitest';

import {
  HABIT_ICONS,
  deriveHabitIcon,
  habitIconOf,
  parseHabitIcon,
  type HabitIcon,
} from '../src/habit-icons.js';

describe('图标词表（闭集）', () => {
  it('🔴 逐字钉住这份列表与顺序：改顺序 = 给存量习惯换图标', () => {
    expect(HABIT_ICONS).toEqual(['drop', 'activity', 'book', 'moon', 'leaf', 'pencil', 'sun', 'music']);
  });

  it('没有重复项（重复会让 `parseHabitIcon` 的取值变得看运气）', () => {
    expect(new Set(HABIT_ICONS).size).toBe(HABIT_ICONS.length);
  });

  it('存的是 key，不是字形名（字形名会把一次换库变成一次数据迁移）', () => {
    for (const icon of HABIT_ICONS) {
      expect(icon).toMatch(/^[a-z]+$/u);
    }
    expect(HABIT_ICONS).not.toContain('Droplets');
    expect(HABIT_ICONS).not.toContain('BookOpen');
  });
});

describe('parseHabitIcon', () => {
  it('词表里的每一个 key 都能原样读回来', () => {
    for (const icon of HABIT_ICONS) {
      expect(parseHabitIcon(icon)).toBe(icon);
    }
  });

  it('容忍首尾空白（别的写入方常这么留下值）', () => {
    expect(parseHabitIcon('  book  ')).toBe('book');
  });

  it('🔴 不认识的值 = 「没设过」，**不回退成第一项**', () => {
    const unknown = ['trophy', 'DROP', '', '   ', '烟', 'drop2'];
    for (const raw of unknown) {
      expect(parseHabitIcon(raw), `不该认识 ${JSON.stringify(raw)}`).toBeUndefined();
    }
    // 这一条是上面那个断言的"症状版"：回退成第一项时上面照样绿（因为返回的是合法值）。
    expect(parseHabitIcon('trophy')).not.toBe(HABIT_ICONS[0]);
  });

  it('非字符串一律当作没设过（磁盘上什么形状都可能有）', () => {
    for (const raw of [undefined, null, 0, 1, {}, [], true, Symbol('drop')]) {
      expect(parseHabitIcon(raw)).toBeUndefined();
    }
  });
});

describe('deriveHabitIcon', () => {
  it('同一条习惯任何时候算出同一个（确定性；随机会让界面每次渲染都在抖）', () => {
    for (const id of ['h1', 'habit-t-001', '喝水']) {
      expect(deriveHabitIcon(id)).toBe(deriveHabitIcon(id));
    }
  });

  it('取值恒在词表内（越界会让行首画成空白）', () => {
    for (let i = 0; i < 500; i += 1) {
      expect(HABIT_ICONS).toContain(deriveHabitIcon(`habit-${String(i)}`));
    }
  });

  it('🔴 随 id 变，不是一个常量（常量 = 每条习惯同一个图标，区分不了）', () => {
    const distinct = new Set<string>();
    for (let i = 0; i < 200; i += 1) distinct.add(deriveHabitIcon(`habit-${String(i)}`));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('只取决于自己的 id：新增/删除别的习惯不会让它换图标', () => {
    const before = deriveHabitIcon('keep-me');
    for (let i = 0; i < 50; i += 1) deriveHabitIcon(`other-${String(i)}`);
    expect(deriveHabitIcon('keep-me')).toBe(before);
  });
});

describe('habitIconOf（选过的优先，没选过用派生的）', () => {
  it('用户选过的优先', () => {
    const chosen: HabitIcon = 'book';
    expect(habitIconOf({ id: 'h1', icon: chosen })).toBe('book');
  });

  it('没选过时画派生的那个 —— 不是"没有图标"', () => {
    expect(habitIconOf({ id: 'h1' })).toBe(deriveHabitIcon('h1'));
  });

  it('🔴 磁盘上是听不懂的历史值时不炸，且画的仍是派生的那个（不是第一项）', () => {
    expect(habitIconOf({ id: 'h1', icon: 'trophy' })).toBe(deriveHabitIcon('h1'));
    expect(habitIconOf({ id: 'h1', icon: null as unknown as string })).toBe(deriveHabitIcon('h1'));
  });
});
