/**
 * 移动端日期**展示**测试
 * =========================
 *
 * 🔴 这个文件现在测的是**壳里的措辞**（`apps/mobile/src/lib/date.ts` 与
 * `due-display.ts` 的 `remainingText`），因为经过 i18n 迁移后：
 *
 *   - "剩余几天怎么说"从领域层搬到了壳里（`remainingText`），
 *     阈值语义照抄 `@heyta/domain` 的 `formatRemaining`；
 *   - 月标题 / 日标题 / 周几列头也搬到了壳里（`formatMonthTitleText` /
 *     `formatDayTitleText` / `WEEKDAY_MESSAGE_KEYS`），领域层只保留日期**数学**。
 *
 * ⚠️ `startOfDay` / `daysBetween` / `DAY_MS` 的用例此前已搬到
 * `packages/domain`（实现上移，用例跟着上移，见 AGENTS.md §3.5）。
 *
 * 🔴 每条断言都**同时钉住中文与英文**：只测中文的话，把英文词条写成
 * 中文、或者 en 表漏掉一个 key，测试全绿而英文界面是坏的。
 * 两种语言走的是同一份 key，所以"同一 key 两种输出"才能证明它真的是词条，
 * 而不是把中文硬编码在壳里。
 *
 * 测试全部用 `new Date(y, m, d, h, mi)`（**本地**构造）而不是
 * `Date.parse('2026-09-25T00:30:00Z')`：
 * 后者在 UTC+8 与 UTC-5 下是**不同的本地日期**，会让用例在 CI 与
 * 开发机上给出不同结果 —— 那种 flaky 比没有测试更糟。
 */

import { describe, expect, it } from 'vitest';
import { translate } from '@heyta/i18n';
import {
  WEEKDAY_MESSAGE_KEYS,
  formatDayTitleText,
  formatMonthTitleText,
  formatStamp,
  msUntilNextMidnight,
} from '../src/lib/date';
import { remainingText } from '../src/lib/due-display';

/** 本地时间构造，避免时区相关的 flaky。 */
function local(y: number, m: number, d: number, h = 0, mi = 0): number {
  return new Date(y, m - 1, d, h, mi, 0, 0).getTime();
}

describe('remainingText', () => {
  it('🔴 同一个 key 在两种语言里给出各自的句子', () => {
    // 今天：`mobile.common.today`
    expect(remainingText(0, translate.bind(null, 'zh-CN'))).toBe('今天');
    expect(remainingText(0, translate.bind(null, 'en'))).toBe('Today');
  });

  it('明天 / 后天各一条词条（不是"还剩 1 天"）', () => {
    expect(remainingText(1, translate.bind(null, 'zh-CN'))).toBe('明天');
    expect(remainingText(2, translate.bind(null, 'zh-CN'))).toBe('后天');
    expect(remainingText(1, translate.bind(null, 'en'))).toBe('Tomorrow');
    expect(remainingText(2, translate.bind(null, 'en'))).toBe('Day after tomorrow');
  });

  it('🔴 逾期用"拖了多久"表述，不用日期', () => {
    // 逾期任务最关键的信息是"拖了几天"，不是"哪天到期"。
    expect(remainingText(-3, translate.bind(null, 'zh-CN'))).toBe('已逾期 3 天');
    expect(remainingText(-3, translate.bind(null, 'en'))).toBe('3 days overdue');
  });

  it('🔴 英文单复数：逾期 1 天用 `1 day`，不是 `1 days`', () => {
    // `remainingDays === -1`（昨天到期）是**可达**的，词条表又刻意没有 ICU，
    // 所以调用方必须分支到 `mobile.due.overdueOne`。
    const zh = remainingText(-1, translate.bind(null, 'zh-CN'));
    const en = remainingText(-1, translate.bind(null, 'en'));
    expect(zh).toBe('已逾期 1 天');
    expect(en).toBe('1 day overdue');
    // 反向断言：句子看起来仍然通顺的错误最难发现，所以直接钉住坏的形状。
    expect(en).not.toContain('1 days');
    // 中文不分单复数：单数兄弟词条与复数版**刻意逐字相同**（不是漏翻）。
    expect(translate('zh-CN', 'mobile.due.overdueOne', { days: 1 })).toBe(
      translate('zh-CN', 'mobile.due.overdue', { days: 1 }),
    );
  });

  it('其余天数用"还剩 N 天"', () => {
    expect(remainingText(5, translate.bind(null, 'zh-CN'))).toBe('还剩 5 天');
    expect(remainingText(5, translate.bind(null, 'en'))).toBe('5 days left');
  });

  it('边界：-1 / 3 / 7 都走"还剩 N 天"这一支，不落下任何一天', () => {
    // 阈值是 0/1/2 三个特例，其余一律走 `remaining`；把 3 与 7 列出来
    // 是因为"恰好 7 天"最容易被人顺手加进特例（那会让领域层与壳里对不上）。
    expect(remainingText(3, translate.bind(null, 'zh-CN'))).toBe('还剩 3 天');
    expect(remainingText(7, translate.bind(null, 'zh-CN'))).toBe('还剩 7 天');
    expect(remainingText(-1, translate.bind(null, 'zh-CN'))).toBe('已逾期 1 天');
  });

  it('`null`（没有截止时间）返回空串，而不是"今天"或占位符', () => {
    // 这里是唯一允许"空"的分支：调用方据此不渲染徽标，
    // 返回任何一句话都会让"没设截止时间"看起来像"今天到期"。
    expect(remainingText(null, translate.bind(null, 'zh-CN'))).toBe('');
    expect(remainingText(null, translate.bind(null, 'en'))).toBe('');
  });
});

describe('formatMonthTitleText', () => {
  it('中文「2026年9月」/ 英文「9/2026」', () => {
    expect(formatMonthTitleText('2026-09-01', translate.bind(null, 'zh-CN'))).toBe('2026年9月');
    expect(formatMonthTitleText('2026-09-01', translate.bind(null, 'en'))).toBe('9/2026');
  });

  it('12 月不受"月份 +1"影响（1..12，不是 0..11）', () => {
    expect(formatMonthTitleText('2026-12-01', translate.bind(null, 'zh-CN'))).toBe('2026年12月');
    expect(formatMonthTitleText('2026-01-01', translate.bind(null, 'zh-CN'))).toBe('2026年1月');
  });
});

describe('formatDayTitleText', () => {
  it('中文「9月25日 星期五」/ 英文「Fri, 9/25」', () => {
    // 2026-09-25 是周五。
    expect(formatDayTitleText('2026-09-25', translate.bind(null, 'zh-CN'))).toBe('9月25日 星期五');
    expect(formatDayTitleText('2026-09-25', translate.bind(null, 'en'))).toBe('Fri, 9/25');
  });

  it('周日排在一周最后（`isoWeekday` 里 7 才是周日）', () => {
    // 2026-09-27 是周日；如果误把 0 当周日，这里会错念成周一。
    expect(formatDayTitleText('2026-09-27', translate.bind(null, 'zh-CN'))).toBe('9月27日 星期日');
    expect(formatDayTitleText('2026-09-27', translate.bind(null, 'en'))).toBe('Sun, 9/27');
  });
});

describe('WEEKDAY_MESSAGE_KEYS', () => {
  it('列头是**周一到周日**，与领域层 `monthGrid` 的开头一致', () => {
    // 手写数组写成周日开头的话，整个日历会整体错位一格，
    // 而错位后的界面看上去仍然像个正常日历 —— 所以顺序必须被钉住。
    expect(WEEKDAY_MESSAGE_KEYS.map((key) => translate('zh-CN', key))).toEqual([
      '一',
      '二',
      '三',
      '四',
      '五',
      '六',
      '日',
    ]);
    expect(WEEKDAY_MESSAGE_KEYS.map((key) => translate('en', key))).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
  });
});

describe('formatStamp', () => {
  it('纯数字（语言无关），9-26 00:31 这种形状', () => {
    // 这是"某某事发生在什么时候"的精确时刻，刻意不走词条表。
    expect(formatStamp(local(2026, 9, 26, 0, 31))).toBe('9-26 00:31');
  });

  it('月/日/时/分都补零，位数不会忽长忽短', () => {
    // 日期也补零（`1-02`），这样"9-9"与"9-26"不会一个宽一个窄；
    // 月份**不**补零，因为 `9-26` 已经单字符月份，`09-26` 反而更啰嗦。
    expect(formatStamp(local(2026, 1, 2, 3, 4))).toBe('1-02 03:04');
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
