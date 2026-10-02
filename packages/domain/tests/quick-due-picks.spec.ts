/**
 * `quickDuePickDates` 的语义钉子
 * ==============================
 *
 * 上提自 mobile 的 `lib/quick-dates.ts`（那边只测文案包装，纯数学现在
 * 在这里钉）。两条边界是当初实测定的，回归钉死：
 *   - 周日点「本周末」= **今天**，不是下周日（说"本周末"跳 7 天是骗人）；
 *   - 周日点「下周一」= 明天。
 */

import { describe, expect, it } from 'vitest';

import { isoWeekday } from '../src/date.js';
import { quickDuePickDates } from '../src/quick-due-picks.js';

describe('quickDuePickDates：今天 → 明天 → 本周末 → 下周一', () => {
  it('周五（2026-10-02）：周末=本周日 10-04，下周一=10-05', () => {
    expect(isoWeekday('2026-10-02')).toBe(5); // 前提先站住：这真是周五
    expect(quickDuePickDates('2026-10-02')).toEqual([
      { key: 'today', date: '2026-10-02' },
      { key: 'tomorrow', date: '2026-10-03' },
      { key: 'weekend', date: '2026-10-04' },
      { key: 'next-week', date: '2026-10-05' },
    ]);
  });

  it('🔴 周日边界：「本周末」就是今天，「下周一」是明天', () => {
    expect(isoWeekday('2026-10-04')).toBe(7); // 2026-10-04 是周日
    const picks = quickDuePickDates('2026-10-04');
    expect(picks.find((p) => p.key === 'weekend')!.date).toBe('2026-10-04');
    expect(picks.find((p) => p.key === 'next-week')!.date).toBe('2026-10-05');
  });

  it('周一：「下周一」是下周一（8-1=7 天后），不是明天', () => {
    expect(isoWeekday('2026-10-05')).toBe(1);
    expect(quickDuePickDates('2026-10-05').find((p) => p.key === 'next-week')!.date).toBe(
      '2026-10-12',
    );
  });
});
