/**
 * 间距角色的三档必须真的拉开。
 *
 * 这条测试守的是 2026-11-14 那次实测的形状：「标签→控件」与「组间」同值时，
 * 人眼读不出"标签属于它下面那一块"，而这一点**没有任何类型或构建会告诉你**。
 */
import { describe, expect, it } from 'vitest';

import { SPACING_ROLE, SPACING_ROLE_ORDER } from '../src/spacing-roles.js';

/** `space.N` → N×4px（tokens.css 的阶梯：0/1/2/3/4/5/6/8/10/12/16）。 */
const SPACE_PX: Record<string, number> = {
  'space.0': 0,
  'space.1': 4,
  'space.2': 8,
  'space.3': 12,
  'space.4': 16,
  'space.5': 20,
  'space.6': 24,
  'space.8': 32,
  'space.10': 40,
  'space.12': 48,
  'space.16': 64,
};

describe('间距角色', () => {
  it('每个角色都指向一个已登记的间距档', () => {
    for (const role of SPACING_ROLE_ORDER) {
      expect(SPACE_PX[SPACING_ROLE[role]], `${role} → ${SPACING_ROLE[role]}`).toBeTypeOf('number');
    }
  });

  it('三个关键角色**互不相等**且按 1 : 3 : 6 拉开', () => {
    const label = SPACE_PX[SPACING_ROLE['label-to-control']]!;
    const row = SPACE_PX[SPACING_ROLE['row-gap']]!;
    const group = SPACE_PX[SPACING_ROLE['group-gap']]!;

    expect(label).toBeLessThan(row);
    expect(row).toBeLessThan(group);
    // 相邻比值 ≥ 2：差 4px 的两档人眼分不出（这正是那十种间距的成因）
    expect(row / label).toBeGreaterThanOrEqual(2);
    expect(group / row).toBeGreaterThanOrEqual(2);
  });

  it('组内行距是 0 —— 行与行靠分隔线分组，不靠空隙', () => {
    expect(SPACE_PX[SPACING_ROLE['group-inner']]).toBe(0);
  });

  it('角色的 px 值单调不减（从紧到松）', () => {
    const values = SPACING_ROLE_ORDER.map((r) => SPACE_PX[SPACING_ROLE[r]]!);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i], `${SPACING_ROLE_ORDER[i]} 应 ≥ ${SPACING_ROLE_ORDER[i - 1]}`).toBeGreaterThanOrEqual(
        values[i - 1]!,
      );
    }
  });
});
