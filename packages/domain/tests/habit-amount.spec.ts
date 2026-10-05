/**
 * 「这一天记了几格」的唯一算法（工单 W6 的地基）
 * =================================================
 *
 * `HabitLog.value` 是**可选**字段（`entities.ts:309`），所以"缺省算几格"必须
 * 有唯一一个回答处。W6 之前它有三份，而且互相矛盾：
 *
 * | 位置 | 缺省写法 | 后果 |
 * |---|---|---|
 * | `isAchieved` | `log.value ?? target` | 没写量 ⇒ **算达成**，连续天数 +1 |
 * | `completionRatio` | `log?.value ?? 0` | 没写量 ⇒ 完成度 **0%** |
 * | 移动端详情 | 自己 `?? target ?? 1` | 第三份，漂了不会红 |
 *
 * 三条腿说的是同一格，所以症状是"连续说今天达成、进度条说没做"，
 * 而**任何一层都不报错**。这一份文件钉的就是"只剩一个算法"这件事。
 *
 * ⚠️ 这里不测打卡/撤销的写入（那是 `packages/app-host/tests/habit-actions.spec.ts`），
 * 也不测界面上的数量行（`apps/web/tests/habits-board.spec.tsx` 的 F 组）。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { Habit, HabitLog } from '../src/entities.js';
import { completionRatio, habitLogValue, isAchieved } from '../src/habit-streak.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const STREAK_SRC = resolve(HERE, '../src/habit-streak.ts');

function habit(over: Partial<Habit> = {}): Habit {
  return { id: 'h1', name: '喝水', target: 1, createdAt: 0, updatedAt: 0, ...over };
}

/**
 * `value` **刻意可以不传** —— 那正是这一组用例要量的形状。
 * 用 `Partial<HabitLog>` 再 cast 会悄悄允许别的缺失字段，所以这里把
 * "有量的那条"与"没量的那条"写成两个显式形状。
 */
function log(over: { readonly value?: number } = {}): HabitLog {
  return { id: 'h1:2026-09-28', habitId: 'h1', date: '2026-09-28', createdAt: 0, updatedAt: 0, ...over };
}

describe('habitLogValue：缺省只有一处', () => {
  it('根本没有记录 ⇒ 0 格（"今天没做"，不是 target）', () => {
    expect(habitLogValue(habit({ target: 8 }), undefined)).toBe(0);
  });

  it('有记录但没写量 ⇒ 落 target（与写路径同一个缺省）', () => {
    expect(habitLogValue(habit({ target: 8 }), log())).toBe(8);
  });

  it('target 也没设 ⇒ 落 1（纯打卡型习惯的一格）', () => {
    // `Habit.target` 是可选的：`createHabit` 会写 1，但**磁盘上更早的数据不一定有**。
    const noTarget = habit({ target: undefined });
    expect(habitLogValue(noTarget, log())).toBe(1);
  });

  it('显式记了多少就是多少，包括 0 与小数（读侧**不**做合法性审判）', () => {
    expect(habitLogValue(habit({ target: 8 }), log({ value: 5 }))).toBe(5);
    expect(habitLogValue(habit({ target: 8 }), log({ value: 0.5 }))).toBe(0.5);
    // ⚠️ `value: 0` 是**写入侧**非法（app-host 会抛），但已经落盘的历史数据读出来
    //    还是 0 —— 读侧把它审判成 target 会凭空变出 8 格，那是更坏的假象。
    expect(habitLogValue(habit({ target: 8 }), log({ value: 0 }))).toBe(0);
  });

  it('🔴 target 为 0 时缺省是 0，不是 1（`??` 只认 null/undefined，这条要写明）', () => {
    // `atMost` + `target: 0` 是"一次都不碰"（`setHabitGoal` 明确允许）。
    // 这里读成 0 是**旧记录**的读法；**新写**一条落 1 —— 那个分叉在 app-host
    // 的 `checkIn` 里，判据也在那边。
    expect(habitLogValue(habit({ target: 0, goalType: 'atMost' }), log())).toBe(0);
  });
});

describe('🔴 同一条记录在"达成"和"进度"里必须读成同一个数', () => {
  for (const target of [1, 8]) {
    for (const goalType of ['atLeast', 'atMost', 'exactly'] as const) {
      it(`target=${String(target)} / ${goalType}：没写量的那条记录，比例与达成说的是同一个格数`, () => {
        const h = habit({ target, goalType });
        const valueless = log();
        const value = habitLogValue(h, valueless);
        // `isAchieved` 与 `completionRatio` 都只能通过 `habitLogValue` 拿分子 ——
        // 这里比对的是**它们各自算出来的结果**与那个缺省的一致性，
        // 而不是去断言实现细节（实现改了、口径没改，这条不该红）。
        expect(value).toBe(target);
        expect(completionRatio(h, valueless)).toBeCloseTo(Math.min(1, value / target), 5);
        expect(isAchieved(h, valueless)).toBe(
          goalType === 'atLeast' ? value >= target : goalType === 'atMost' ? value <= target : value === target,
        );
      });
    }
  }

  it('🔴 记了一半（value=5 / target=8）：比例 0.625，而 `atLeast` 判未达成 —— 两边都不许把"打过卡"读成"做完了"', () => {
    const h = habit({ target: 8 });
    const partial = log({ value: 5 });
    expect(habitLogValue(h, partial)).toBe(5);
    expect(completionRatio(h, partial)).toBeCloseTo(0.625, 5);
    expect(isAchieved(h, partial)).toBe(false);
    // ⚠️ 但它**仍然是一条打卡记录**（`doneToday` 为真、热力图那一格有色）。
    // 三个数各说各的：`doneToday` ≠ `isAchieved` ≠ `completionRatio === 1`。
  });
});

describe('源级判据：不许出现第二个缺省', () => {
  /**
   * 只留**代码**，把注释剥掉。
   *
   * 🔴 这条不是便利，是必须的：本文件的"反面教材"（`log?.value ?? 0` 那句旧写法）
   * 就写在 `completionRatio` 的注释里，不剥的话判据**一上线就红**，
   * 而红的原因是我在解释为什么不能有它。同一个坑在
   * `apps/web/tests/habits-board.spec.tsx` 的 E 组也踩过一次（那里盯的是 import 语句）。
   *
   * ⚠️ 代价要写清：剥注释之后，藏在**字符串字面量**里的违规形状也会被剥掉。
   * 这里接受这个代价 —— 这条判据防的是"有人重新写了一遍本地缺省"，
   * 而那只会以代码形状出现。
   */
  const codeOnly = (src: string): string =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gmu, '');

  it('🔴 `completionRatio` 里不许再写 `log?.value ?? 0` 这类本地缺省', () => {
    const src = codeOnly(readFileSync(STREAK_SRC, 'utf8'));
    // 抓的是**形状**（带接收者的属性读法 + `??`），不是文件里出现过 `?? 0` 这个词：
    // `target <= 0 return 0` 那类完全合法。
    expect(src).not.toMatch(/log\?\.value\s*\?\?/u);
    expect(src).not.toMatch(/log\.value\s*\?\?\s*(?:0|1|target)\b/u);
    // 而唯一的缺省处必须在 `habitLogValue` 的函数体里。
    expect(src).toMatch(/function habitLogValue[\s\S]{0,200}log\.value \?\? habit\.target \?\? 1/u);
  });
});
