/**
 * 时刻步进 / 草稿提交（`src/date-picker/steps.ts`）单测
 * =====================================================
 *
 * 这个文件能跑，本身就是那条边界的证据：`steps.ts` **不 import `react-native`**，
 * 所以"什么时候算一个合法时刻"这条规则在 node 环境里就测得穿 ——
 * 而它原来写在 `DatePicker.tsx` 里，那个文件 import RN，node 解析不了，
 * 于是**没有任何一条判据盯过它**（AGENTS.md §6 第 2 条：不能失败的检查没有价值）。
 */

import { describe, expect, it } from 'vitest';

import { timeDraftToValue, timeStepSlots } from '../src/date-picker/steps.js';

describe('A. timeStepSlots：一天里的步进槽', () => {
  it('30 分钟 ⇒ 48 格，从 00:00 起、到 23:30 止，首尾都画', () => {
    const slots = timeStepSlots(30);
    expect(slots).toHaveLength(48);
    expect(slots[0]).toBe('00:00');
    expect(slots.at(-1)).toBe('23:30');
  });

  it('每格都是 `HH:MM` 且严格递增 30 分钟', () => {
    const slots = timeStepSlots(30);
    for (const slot of slots) expect(slot).toMatch(/^\d{2}:\d{2}$/u);
    const minutes = slots.map((slot) => Number(slot.slice(0, 2)) * 60 + Number(slot.slice(3, 5)));
    expect(minutes.slice(1).map((m, i) => m - minutes[i]!)).toEqual(Array.from({ length: 47 }, () => 30));
  });

  it('🔴 不整除一天的步数**一格都不画**，而不是画出半截尾巴', () => {
    // 7 分钟一步会画到 23:58 然后停 —— 用户会以为列表到"夜里"就结束了。
    // 宁可不画这一档，也不要一个看起来完整其实缺尾的列表。
    expect(timeStepSlots(7)).toEqual([]);
    expect(timeStepSlots(0)).toEqual([]);
    expect(timeStepSlots(-30)).toEqual([]);
  });

  it('整除的其它步数照常画（60 ⇒ 24 格，含 23:00 不含 24:00）', () => {
    const slots = timeStepSlots(60);
    expect(slots).toHaveLength(24);
    expect(slots.at(-1)).toBe('23:00');
  });
});

describe('B. timeDraftToValue：草稿什么时候算提交', () => {
  it('合法 `HH:MM` ⇒ 提交归一化后的值', () => {
    expect(timeDraftToValue('20:30', '16:00')).toBe('20:30');
  });

  it('🔴 空串 ⇒ `undefined`（= 回到"全天"），不是退回上一个值', () => {
    expect(timeDraftToValue('', '16:00')).toBeUndefined();
    expect(timeDraftToValue('   ', '16:00')).toBeUndefined();
  });

  it('🔴 没到 `HH:MM` 的形状 ⇒ 保持已提交的值不动（半截时刻不许进 op）', () => {
    expect(timeDraftToValue('16:', '16:00')).toBe('16:00');
    expect(timeDraftToValue('2', '16:00')).toBe('16:00');
    expect(timeDraftToValue('25:00', '16:00')).toBe('16:00');
    expect(timeDraftToValue('abc', undefined)).toBeUndefined();
  });

  it('本来就还没有值时，非法草稿仍然算"没有时刻"（不许凭空造一个 00:00）', () => {
    expect(timeDraftToValue('9', undefined)).toBeUndefined();
  });
});
