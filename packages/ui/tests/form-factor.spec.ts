import { describe, expect, it } from 'vitest';
import {
  canPairColumns,
  COLUMN_BASE_WIDTH,
  formFactorOf,
  maxColumnsOf,
  TWO_COLUMN_MIN_WIDTH,
} from '../src/layout/form-factor.js';

/**
 * 产品层级的形态档：一套判断，四端共用。
 *
 * 这些断言防的不是"函数写错"，是**判据被改坏时没人发现**：
 * 上一轮（2026-11-15）我把四象限的列数直接写死 `twoColumns`，
 * 那样任何端都无法知道自己该几列。这里把规则钉住，改坏就红。
 */
describe('形态档 = 按「能放下几列基准宽」判，不按像素断点', () => {
  it('一列基准宽取 360（手机竖屏视口）', () => {
    // 它不是随手挑的数：360dp 是一张卡片在任何端上可读的最小宽度，
    // 也是本仓手机上实际跑的尺寸。改了它，所有档位一起漂。
    expect(COLUMN_BASE_WIDTH).toBe(360);
  });

  it('比「能放下几列」，不是比「窗口多宽」', () => {
    // 手机竖屏 360 → 1 列 → compact
    expect(formFactorOf(360)).toBe('compact');
    // 手机横屏 720 → 2 列 → regular
    expect(formFactorOf(720)).toBe('regular');
    // iPad 横屏 / Mac 大窗口 1080 → 3 列 → expanded
    expect(formFactorOf(1080)).toBe('expanded');
  });

  it('档位边界是「整列数」，不是比例', () => {
    // 719 只放得下 1 列（719/360 = 1.997），仍是 compact ——
    // 差 1dp 就跳档是像素断点的行为，按列数判不会有这种抖动。
    expect(formFactorOf(719)).toBe('compact');
    expect(formFactorOf(720)).toBe('regular');
    expect(formFactorOf(1079)).toBe('regular');
    expect(formFactorOf(1080)).toBe('expanded');
  });

  it('宽度未知时按最保守的一档（宁可少排一列，不要挤出屏幕）', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formFactorOf(bad), `${String(bad)} 应落 compact`).toBe('compact');
    }
  });

  it('每档的列数上限', () => {
    expect(maxColumnsOf('compact')).toBe(1);
    expect(maxColumnsOf('regular')).toBe(2);
    expect(maxColumnsOf('expanded')).toBe(3);
  });
});

describe('canPairColumns = 「窄到读不出字才退回单列」', () => {
  it('下限是 300dp（两格各 150dp 是可读的最低线）', () => {
    expect(TWO_COLUMN_MIN_WIDTH).toBe(300);
    expect(canPairColumns(300)).toBe(true);
    expect(canPairColumns(299)).toBe(false);
  });

  it('手机竖屏 360 够并排 —— 这是四象限在手机上仍是 2×2 的依据', () => {
    // 🔴 关键断言：如果用 `formFactorOf(360) !== 'compact'` 判四象限，
    //    手机会退回单列 —— 那正是 2026-11-15 之前的状态（四段列表，不是坐标系）。
    expect(formFactorOf(360)).toBe('compact');
    expect(canPairColumns(360)).toBe(true);
  });

  it('还没量到宽度时按「够」处理，避免首帧闪一下单列', () => {
    expect(canPairColumns(0)).toBe(true);
    expect(canPairColumns(Number.NaN)).toBe(true);
  });
});
