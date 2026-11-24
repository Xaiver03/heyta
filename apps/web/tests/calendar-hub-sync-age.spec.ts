/**
 * web 侧「最近同步」的纯逻辑（META 归一 + 相对时间分档）
 * ====================================================
 *
 * 这些是面板最近同步时间的两个纯函数，React 渲染不用跑：
 *
 *   · `parseLastSyncMs`：META 里可能是数字/字符串/空/坏值，只有**正有限数**才算有效；
 *     其它一律当「从未同步」——否则一个 `0` / `NaN` 会让面板显示「已同步 · 刚刚」的假象。
 *   · `syncAge`：把毫秒差分成「刚刚 / N 分钟 / N 小时 / N 天」，时钟回拨夹到 0。
 *
 * 「该不该自动同步」不在这里测 —— 它是 `@heyta/app-host` 的 `shouldAutoSync`。
 */

import { describe, expect, it } from 'vitest';

import { parseLastSyncMs, syncAge } from '../src/features/calendar/hub-connection.js';

describe('parseLastSyncMs', () => {
  it('数字型：正有限数原样返回', () => {
    expect(parseLastSyncMs(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it('字符串型：可解析成正数就转成 number（数字型 META 被当字符串存）', () => {
    expect(parseLastSyncMs('1700000000000')).toBe(1_700_000_000_000);
    expect(parseLastSyncMs('  1700000000000  ')).toBe(1_700_000_000_000);
  });

  it('非法/非正一律当没有记录（undefined）', () => {
    for (const bad of [
      undefined,
      '',
      '   ',
      'abc',
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(parseLastSyncMs(bad as string | number | undefined), `value=${String(bad)}`).toBeUndefined();
    }
  });
});

describe('syncAge', () => {
  const NOW = 1_700_000_000_000;

  it('没有记录 ⇒ never', () => {
    expect(syncAge(undefined, NOW)).toEqual({ kind: 'never' });
    expect(syncAge(0, NOW)).toEqual({ kind: 'never' });
    expect(syncAge(Number.NaN, NOW)).toEqual({ kind: 'never' });
  });

  it('不到 1 分钟 ⇒ justNow', () => {
    expect(syncAge(NOW - 1, NOW)).toEqual({ kind: 'justNow' });
    expect(syncAge(NOW - 59_999, NOW)).toEqual({ kind: 'justNow' });
    expect(syncAge(NOW, NOW)).toEqual({ kind: 'justNow' });
  });

  it('分钟 / 小时 / 天分档', () => {
    expect(syncAge(NOW - 60_000, NOW)).toEqual({ kind: 'minutes', minutes: 1 });
    expect(syncAge(NOW - 3 * 60_000, NOW)).toEqual({ kind: 'minutes', minutes: 3 });
    expect(syncAge(NOW - 60 * 60_000, NOW)).toEqual({ kind: 'hours', hours: 1 });
    expect(syncAge(NOW - 25 * 60 * 60_000, NOW)).toEqual({ kind: 'days', days: 1 });
  });

  it('时钟回拨（lastSync 在将来）⇒ 夹到 justNow，不出现负分钟', () => {
    expect(syncAge(NOW + 60_000, NOW)).toEqual({ kind: 'justNow' });
  });
});
