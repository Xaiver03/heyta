/**
 * 移动端日期**展示**测试
 * =========================
 *
 * 🔴 这里只测 `lib/date.ts` 现在还剩的东西：**展示格式化**。
 *
 * `startOfDay` / `daysBetween` / `DAY_MS` 的用例**已经搬到**
 * `packages/domain/tests/focus-stats.spec.ts` —— 因为那些函数本身
 * 搬到了 `@heyta/domain`（它们原本在本文件旁边各有一份实现，
 * 是"同一份本地日期语义写两遍"，见 AGENTS.md §3.5）。
 *
 * ⚠️ 搬走时**逐条搬**，不是删掉了事：那 10 条覆盖的是
 * 本地时区切分、跨月跨年、负方向这些最容易错的地方。
 * 把实现上移却把用例留在原处（然后一起删掉）等于**降低了覆盖率**，
 * 而测试数量看起来只少了几条。
 *
 * 测试全部用 `new Date(y, m, d, h, mi)`（**本地**构造）而不是
 * `Date.parse('2026-09-25T00:30:00Z')`：
 * 后者在 UTC+8 与 UTC-5 下是**不同的本地日期**，会让用例在 CI 与
 * 开发机上给出不同结果 —— 那种 flaky 比没有测试更糟。
 */

import { describe, expect, it } from 'vitest';
import { formatDue, formatToday, isOverdue, msUntilNextMidnight } from '../src/lib/date';

/** 本地时间构造，避免时区相关的 flaky。 */
function local(y: number, m: number, d: number, h = 0, mi = 0): number {
  return new Date(y, m - 1, d, h, mi, 0, 0).getTime();
}

describe('formatDue', () => {
  const now = local(2026, 9, 25, 10, 0);

  it('今天', () => {
    expect(formatDue(local(2026, 9, 25, 23, 0), now)).toBe('今天');
  });

  it('明天', () => {
    expect(formatDue(local(2026, 9, 26), now)).toBe('明天');
  });

  it('昨天', () => {
    expect(formatDue(local(2026, 9, 24), now)).toBe('昨天');
  });

  it('🔴 过期用"拖了多久"表述，不用日期', () => {
    // 过期任务最关键的信息是"拖了几天"，不是"哪天到期"。
    expect(formatDue(local(2026, 9, 22), now)).toBe('已过期 3 天');
  });

  it('一周内用"N 天后"', () => {
    expect(formatDue(local(2026, 9, 30), now)).toBe('5 天后');
  });

  it('超过一周用具体日期', () => {
    expect(formatDue(local(2026, 10, 20), now)).toBe('10月20日');
  });

  it('恰好 7 天仍用"N 天后"（边界）', () => {
    expect(formatDue(local(2026, 10, 2), now)).toBe('7 天后');
  });

  it('恰好 8 天改用日期（边界）', () => {
    expect(formatDue(local(2026, 10, 3), now)).toBe('10月3日');
  });
});

// ⚠️ 这里原来有一个 `formatToday` 的用例块。
//
// 它已经**迁移**到 `packages/domain/tests/calendar.spec.ts` 的
// `formatDayTitle` 下 —— 因为 `formatToday` 被删掉了：
// 日历需要"某一天的标题"时，会在移动端写出第二个格式化函数
// （一个收时间戳、一个收 `LocalDate`；一个用"星期五"、一个用"周五"），
// 于是同一个日子在两个界面显示得不一样。
//
// 按 AGENTS.md §3.5 的收尾方式处理：**先把用例搬到新家，再删旧的实现**。
// 反过来做的话，"删掉的那份其实还有人依赖"要等某个界面上少一行字才会暴露。

describe('isOverdue', () => {
  const now = local(2026, 9, 25, 10, 0);

  it('今天到期不算过期', () => {
    expect(isOverdue(local(2026, 9, 25, 1, 0), now)).toBe(false);
  });

  it('昨天算过期', () => {
    expect(isOverdue(local(2026, 9, 24, 23, 59), now)).toBe(true);
  });

  it('明天不算', () => {
    expect(isOverdue(local(2026, 9, 26), now)).toBe(false);
  });
});

/**
 * 🔴 `useToday` 的**唯一可测部分**。
 *
 * `useToday` 本身要渲染 React + 引 `react-native` 的 `AppState`，本套件跑在 node 里
 * （全部测试都刻意不 import react-native）。所以决定"下一跳在什么时候"的那半段
 * 被拆成纯函数放在这里测 —— 而它恰好是**唯一会算错**的那半段；
 * 另外半段（什么时候调它）是两行 `addEventListener` / `setTimeout`。
 *
 * 对应的是这个真实缺陷：`now` 被 `useMemo(() => Date.now(), [])` 冻住，
 * 于是跨零点后界面上的"今天"还是昨天。**这条测试的意义是让"冻住"这件事无法悄悄回来。**
 */
describe('msUntilNextMidnight', () => {
  it('刚好在零点时，排到**下一个**零点（不是立刻再跳一次）', () => {
    expect(msUntilNextMidnight(local(2026, 9, 26))).toBe(24 * 3600_000);
  });

  it('一天里的任意时刻，跨过去都恰好落在本地零点', () => {
    // 采样点刻意包含 23:59（最接近边界）与 00:01（刚过边界）。
    for (const [h, mi] of [
      [0, 1],
      [9, 30],
      [12, 0],
      [18, 45],
      [23, 59],
      [13, 7],
    ]) {
      const now = local(2026, 9, 26, h, mi);
      const at = now + msUntilNextMidnight(now);
      const d = new Date(at);
      expect(
        [d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()],
        `从 ${String(h)}:${String(mi)} 起跳`,
      ).toEqual([0, 0, 0, 0]);
      expect(d.getDate()).toBe(27);
    }
  });

  it('23:59 到零点只差 1 分钟（不是 24 小时）', () => {
    expect(msUntilNextMidnight(local(2026, 9, 26, 23, 59))).toBe(60_000);
  });

  /**
   * ⚠️ 这两个日期是**美国**夏令时的切换日（2026-03-08 开始、2026-11-01 结束）。
   *
   * 在 Asia/Shanghai 下它们只是普通两天，断言照样通过 —— 所以本用例**单独跑**
   * 才有 DST 意义：`TZ=America/New_York pnpm --filter @heyta/mobile test date`。
   * 那两天一个本地日分别是 23 小时与 25 小时，用"当前时刻 + 24 小时"的实现
   * 会分别落在 01:00 与 23:00，**上面那条 property 断言就会红**。
   * 这就是这里不断言"等于 86400000"的原因。
   */
  it('夏令时切换日也落在本地零点（24 小时不是常数）', () => {
    for (const day of [8, 1]) {
      const month = day === 8 ? 3 : 11;
      const now = local(2026, month, day);
      const at = now + msUntilNextMidnight(now);
      const d = new Date(at);
      expect([d.getHours(), d.getMinutes()]).toEqual([0, 0]);
    }
  });

  it('下限保护：返回值永远不小于 1 秒（否则 setTimeout 会忙循环）', () => {
    for (const ms of [local(2026, 9, 26), local(2026, 1, 1), local(2026, 12, 31, 23, 59)]) {
      expect(msUntilNextMidnight(ms)).toBeGreaterThanOrEqual(1000);
    }
  });
});
