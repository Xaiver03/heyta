/**
 * 移动端分类时长的文案与配色接线测试
 * =====================================
 *
 * 🔴 这里防的**不是"函数算错了"**，而是**两端漂移**：
 *
 *   1. 时长分档（多长算一小时）已经上移到 `@heyta/domain#durationParts`，
 *      但**措辞**仍分两端（`mobile.categories.duration.*` / `web.categories.duration.*`）。
 *      两张词条表如果对同一个数字说两种话（「1 小时 30 分」vs「90 分钟」），
 *      两端各自的测试都是绿的 —— 只有把"逐字相同"写成断言才会红。
 *   2. 色槽 → token 名的映射在**三处**必须一致：tokens.css（真源）、
 *      Web 的 CSS 变量名、移动端的原生 token 名。设计系统那侧已经钉住了
 *      registry 与常量；这里钉住**移动端这一侧**，中间任意一端改动都会红。
 *   3. 槽位号必须以**文字**出现在界面上（色觉障碍用户唯一的对齐依据），
 *      所以"没设色时说「无」、设了就说数字"是一条设计契约，不是格式化细节。
 */

import { CATEGORY_SLOT_TOKENS } from '@heyta/design-system';
import { CATEGORY_SLOTS, durationParts, type CategorySeries } from '@heyta/domain';
import { translate, zhCN, en } from '@heyta/i18n';
import { describe, expect, it } from 'vitest';

import {
  KIND_KEY,
  formatDuration,
  laneLabel,
  slotText,
} from '../src/lib/category-display';
import { HEAT_TOKENS, SLOT_TOKEN } from '../src/lib/category-colors';

/** 与界面同一条路：走真的词条表（缺 key 会**抛**，不是返回空串）。 */
const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>): string =>
  translate('zh-CN', key, vars);

function row(over: Partial<CategorySeries> = {}): CategorySeries {
  return {
    key: 'project:p1',
    kind: 'project',
    id: 'p1',
    name: '深度工作',
    totalMs: 5 * 3600_000 + 20 * 60_000,
    focusMs: 5 * 3600_000 + 20 * 60_000,
    habitMs: 0,
    weeklyMs: [],
    ...over,
  };
}

describe('formatDuration：档位映射到本端词条', () => {
  it('分钟档 / 小时档 / 小时+分 档', () => {
    expect(formatDuration(0, t)).toBe('0 分钟');
    expect(formatDuration(20 * 60_000, t)).toBe('20 分钟');
    expect(formatDuration(3600_000, t)).toBe('1 小时');
    expect(formatDuration(5 * 3600_000, t)).toBe('5 小时');
    expect(formatDuration(90 * 60_000, t)).toBe('1 小时 30 分');
  });

  it('🔴 与 `durationParts` 的分档逐字对齐（59 分 30 秒 说成 1 小时）', () => {
    // 断言的期望值**从共享实现推导**，不写字面量：改了阈值这一条会跟着变，
    // 而不是变成一条"永远通过"的装饰。
    const parts = durationParts(59 * 60_000 + 30_000);
    expect(parts).toEqual({ kind: 'hours', hours: 1 });
    expect(formatDuration(59 * 60_000 + 30_000, t)).toBe('1 小时');
  });

  it('英文表也能说（词条表漏 key 会在这里露馅）', () => {
    expect(translate('en', 'mobile.categories.duration.hoursMinutes', { hours: 1, minutes: 30 })).toBe(
      '1 h 30 min',
    );
  });
});

describe('🔴 两端文案逐字一致（防的是两端各说各话）', () => {
  it('时长与分类名的词条：移动端与 Web 端逐字相同', () => {
    // ⚠️ 这条**故意**把两个命名空间绑在一起。两端说同一件事就不该有两种说法；
    //    将来合并成一个平台中立的命名空间时，这是一次纯改名，测试不用改。
    for (const key of [
      'duration.minutes',
      'duration.hours',
      'duration.hoursMinutes',
      'kind.project',
      'kind.habit',
      'slot.none',
    ] as const) {
      expect(zhCN[`mobile.categories.${key}` as const]).toBe(zhCN[`web.categories.${key}` as const]);
      expect(en[`mobile.categories.${key}` as const]).toBe(en[`web.categories.${key}` as const]);
    }
  });

  it('中文字符串真的含汉字（迁移模式下的硬要求，抄错成英文会红）', () => {
    // 与 `packages/i18n/tests/catalog.spec.ts` 同形，但只查本组：
    // 那一条扫的是全表，这里是"新增的这一组"的第一道拦网。
    for (const [key, value] of Object.entries(zhCN)) {
      if (!key.startsWith('mobile.categories.')) continue;
      if (!/[\u4e00-\u9fff]/.test(value)) {
        throw new Error(`${key} 的中文里没有汉字：${value}`);
      }
    }
  });
});

describe('slotText：颜色之外必须还有文字', () => {
  it('没设色说「无」，设了色就说**数字**（不是色名）', () => {
    expect(slotText(undefined, t)).toBe('无');
    expect(slotText(3, t)).toBe('3');
    expect(slotText(8, t)).toBe('8');
  });
});

describe('laneLabel：屏幕阅读器读到的那句话', () => {
  it('含名字、来源与总时长 —— 一行不靠颜色也能读懂', () => {
    const label = laneLabel(row({ slot: 3 }), t);
    expect(label).toContain('深度工作');
    expect(label).toContain('清单');
    expect(label).toContain('5 小时 20 分');
  });

  it('习惯行说「习惯」', () => {
    const label = laneLabel(row({ kind: 'habit', name: '阅读' }), t);
    expect(label).toContain('习惯');
    expect(label).toContain('阅读');
  });

  it('来源词条与 Web 端同源（`KIND_KEY` 指的就是这两条）', () => {
    expect(KIND_KEY.project).toBe('mobile.categories.kind.project');
    expect(KIND_KEY.habit).toBe('mobile.categories.kind.habit');
  });
});

describe('色槽 → token：移动端这一侧不许漂移', () => {
  it('八个槽位齐全，且每个都指向**不同**的 token', () => {
    const names = CATEGORY_SLOTS.map((slot) => SLOT_TOKEN[slot]);
    expect(names).toHaveLength(8);
    expect(new Set(names).size).toBe(8);
  });

  it('🔴 与设计系统的真源逐项相同（`CATEGORY_SLOT_TOKENS`）', () => {
    // 真源在 tokens.css，设计系统导出 token 名；Web 用它拼 CSS 变量，
    // 移动端从主题里按 token 名取值。三处一致靠这条 + 设计系统那条共同保证。
    expect(CATEGORY_SLOTS.map((slot) => SLOT_TOKEN[slot])).toEqual([...CATEGORY_SLOT_TOKENS]);
  });

  it('强度档位 0–4 五个都在，且互不相同', () => {
    expect([...HEAT_TOKENS]).toEqual([
      'color.heat-0',
      'color.heat-1',
      'color.heat-2',
      'color.heat-3',
      'color.heat-4',
    ]);
  });
});