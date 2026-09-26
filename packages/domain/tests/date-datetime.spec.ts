import { describe, expect, it } from 'vitest';

import { localDateTimeToEpoch, toLocalDate } from '../src/date.js';

/**
 * `localDateTimeToEpoch` 是 AI 一句话捕获（`ai-capture`）落地时的必经一步：
 * 模型给的是**本地日期时间串**，而 `Task.dueDate` 存的是 epoch 毫秒。
 *
 * 这里的每条用例都对应一种"会静默给错值"的形态 —— 静默错值比崩掉危险，
 * 因为它会一路存进 op-log 并同步到别的设备。
 */
describe('本地日期时间串 → epoch', () => {
  describe('只给日期', () => {
    it('算的是**本地**当天 00:00', () => {
      const ms = localDateTimeToEpoch('2026-09-27');
      expect(ms).toBeDefined();
      const d = new Date(ms!);
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(8); // 9 月
      expect(d.getDate()).toBe(27);
      // 🔴 关键：是"本地"00:00，不可以用 UTC 去比。
      expect(d.getHours()).toBe(0);
      expect(d.getMinutes()).toBe(0);
    });

    it('与 `toLocalDate` 往返一致（本地时区不丢一天）', () => {
      for (const day of ['2026-01-01', '2026-06-15', '2026-12-31']) {
        const ms = localDateTimeToEpoch(day);
        expect(ms).toBeDefined();
        // 这条最能抓住"用 UTC 解析导致跨日"的实现。
        expect(toLocalDate(ms!)).toBe(day);
      }
    });
  });

  describe('带时间', () => {
    it('`HH:mm` 与 `HH:mm:ss` 都认', () => {
      const a = localDateTimeToEpoch('2026-09-27T15:30');
      const b = localDateTimeToEpoch('2026-09-27T15:30:00');
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      expect(a).toBe(b);
      const d = new Date(a!);
      expect(d.getHours()).toBe(15);
      expect(d.getMinutes()).toBe(30);
    });

    it('秒也生效', () => {
      const a = localDateTimeToEpoch('2026-09-27T15:30:00');
      const b = localDateTimeToEpoch('2026-09-27T15:30:45');
      expect(b! - a!).toBe(45_000);
    });

    it('🔴 带时间时**不是**当天 00:00（抓"只取了日期部分"的实现）', () => {
      const midnight = localDateTimeToEpoch('2026-09-27')!;
      const at3pm = localDateTimeToEpoch('2026-09-27T15:00')!;
      expect(at3pm).toBeGreaterThan(midnight);
    });

    it('🔴 用本地构造而不是"午夜 + 毫秒数"（夏令时那天不是 24 小时）', () => {
      // 不假设用户所在时区有夏令时：只断言"时刻"落地正确，
      // 这恰好是"午夜 + ms"写法会算错的地方。
      const ms = localDateTimeToEpoch('2026-03-08T03:30')!;
      const d = new Date(ms);
      expect(d.getHours()).toBe(3);
      expect(d.getMinutes()).toBe(30);
      expect(d.getDate()).toBe(8);
    });
  });

  describe('🔴 拒绝而不是猜', () => {
    it('不存在的日期 → `undefined`（`new Date` 会把它静默进位）', () => {
      // `new Date(2026, 1, 30)` 会变成 3 月 2 日，且**不报错**。
      expect(localDateTimeToEpoch('2026-02-30')).toBeUndefined();
      expect(localDateTimeToEpoch('2026-13-01')).toBeUndefined();
      expect(localDateTimeToEpoch('2026-04-31')).toBeUndefined();
    });

    it('越过平年的 2 月 29 日 → `undefined`，闰年则成立', () => {
      expect(localDateTimeToEpoch('2026-02-29')).toBeUndefined();
      expect(localDateTimeToEpoch('2028-02-29')).toBeDefined();
    });

    it('时刻越界 → `undefined`', () => {
      expect(localDateTimeToEpoch('2026-09-27T24:00')).toBeUndefined();
      expect(localDateTimeToEpoch('2026-09-27T10:60')).toBeUndefined();
      expect(localDateTimeToEpoch('2026-09-27T10:00:60')).toBeUndefined();
    });

    it('格式不对 → `undefined`（不抛错）', () => {
      for (const bad of [
        '',
        '明天',
        '2026/09/27',
        '2026-9-27', // 不补零：与 `parseLocalDate` 的口径一致
        '2026-09-27 15:30', // 用空格而不是 T
        '2026-09-27T15', // 只有小时
        '20260927',
      ]) {
        expect(localDateTimeToEpoch(bad), `应拒绝：${bad}`).toBeUndefined();
      }
    });

    it('永不抛错 —— 调用方是界面，它要的是"不可用"而不是异常', () => {
      for (const bad of ['', 'x', '2026-02-30T99:99:99', '----', 'null']) {
        expect(() => localDateTimeToEpoch(bad)).not.toThrow();
      }
    });
  });

  it('同一个输入永远得到同一个值（确定性）', () => {
    const first = localDateTimeToEpoch('2026-09-27T15:30:00');
    for (let i = 0; i < 5; i += 1) {
      expect(localDateTimeToEpoch('2026-09-27T15:30:00')).toBe(first);
    }
  });
});
