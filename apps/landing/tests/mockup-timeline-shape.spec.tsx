/**
 * 时间线展厅件 = 登记处 × CSS（形状契约）
 * ==========================================
 *
 * 🔴 这一组测试钉的是**"登记处说的宽度，CSS 里必须真的有"**。
 *
 * 反例很具体：`timeline-shape.ts` 里写 `w-60`，而 `mockup.css` 里没有
 * `.mk-timeline__bar--w-60` —— 那个 `inline-size` 就没人设，条的宽度回到
 * `auto`（约等于 0）。页面上**少了一条任务**，而 React 不报错、构建不报错、
 * 渲染也"成功"。这类"静默缩成 0"的复刻件缺陷，肉眼很容易当成"这条任务本来就没排"。
 *
 * 与 `mockup-task-row.spec.tsx`（任务行的 token 契约）、
 * `mockup-habit-shape.spec.tsx`（热力图的档位契约）同一形状。
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { zhCN } from '@heyta/i18n';

import {
  MOCK_TIMELINE_AXIS_KEYS,
  MOCK_TIMELINE_BAR_WIDTHS,
  MOCK_TIMELINE_DAY_COUNT,
  MOCK_TIMELINE_ROWS,
  mockTimelineBarClass,
} from '../src/mockup/timeline-shape.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(resolve(HERE, '../src/mockup/mockup.css'), 'utf8');

describe('登记处说的每一档宽度，CSS 里都有对应的修饰类', () => {
  it('四档宽度一个都不能少', () => {
    for (const width of MOCK_TIMELINE_BAR_WIDTHS) {
      expect(
        CSS.includes(`.mk-timeline__bar--${width} {`),
        `mockup.css 里没有 .mk-timeline__bar--${width} —— 那一档的条会缩成 0 宽（静默消失）`,
      ).toBe(true);
    }
  });

  it('`inline-size` 是百分比 —— 与"四天轨道"同一个基准', () => {
    // 写死像素的话，轨道宽度一变（换屏宽、换语言），条与日界就对不上：
    // 条会溢出轨道或者只占一小截，而图仍然"看起来像时间线"。
    for (const width of MOCK_TIMELINE_BAR_WIDTHS) {
      const at = CSS.indexOf(`.mk-timeline__bar--${width} {`);
      const body = CSS.slice(at, CSS.indexOf('}', at));
      expect(body, `${width} 应当按百分比给宽度`).toMatch(/inline-size:\s*\d+(\.\d+)?%;/u);
    }
  });

  it('三条样例的宽度**不全相同** —— 等宽就看不出"按估时排布"', () => {
    const widths = new Set(MOCK_TIMELINE_ROWS.map((row) => row.width));
    expect(widths.size).toBeGreaterThan(1);
  });
});

describe('日刻度与轨道列数同一个数', () => {
  it('刻度 key 的条数 = `MOCK_TIMELINE_DAY_COUNT`', () => {
    expect(MOCK_TIMELINE_AXIS_KEYS).toHaveLength(MOCK_TIMELINE_DAY_COUNT);
  });

  it('CSS 里的轨道列数也是这个数', () => {
    const at = CSS.indexOf('.mk-timeline__axis-days {');
    const body = CSS.slice(at, CSS.indexOf('}', at));
    expect(body).toContain(`repeat(${String(MOCK_TIMELINE_DAY_COUNT)}`);
  });

  it('每一条刻度都有真词条（不是留给运行时的空串）', () => {
    for (const key of MOCK_TIMELINE_AXIS_KEYS) {
      expect(zhCN[key], `${key} 没有中文词条`).toBeTruthy();
    }
  });
});

describe('类名拼接只有一处', () => {
  it('AI 估时那条多一个 `--ai` 修饰类，其余不多', () => {
    expect(mockTimelineBarClass('w-30', true)).toBe(
      'mk-timeline__bar mk-timeline__bar--w-30 mk-timeline__bar--ai',
    );
    expect(mockTimelineBarClass('w-30', false)).toBe('mk-timeline__bar mk-timeline__bar--w-30');
  });

  it('`--ai` 那一条在 CSS 里也有（虚线边）', () => {
    expect(CSS).toContain('.mk-timeline__bar--ai {');
  });
});
