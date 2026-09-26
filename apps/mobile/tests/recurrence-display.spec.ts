/**
 * 重复规则文案测试
 * ==================
 *
 * 🔴 这个文件的核心是**拿领域层的 `describeRecurrence` 当独立参照**。
 *
 * 「每周一、三」这句话原本由 `@heyta/domain` 的 `describeRecurrence` 直接返回，
 * 移动端把它渲染到屏幕上。迁移把措辞搬进词条表，于是同一句话现在有两个来源：
 * 域层的中文函数，和 `zh-CN.ts` 里那一段。两者只要差一个字，
 * **中文用户看到的话就变了** —— 而那是迁移最不该改变的东西。
 *
 * 所以这里不是"把实现抄一遍当期望"（那种测试永远绿）：
 * 期望值来自**另一个文件、另一份实现**。改坏词条表的任何一条，
 * 这条测试都会红，而红的原因正是"中文用户会看到不一样的话"。
 *
 * 另一半是英文：只测"英文里没有汉字"是不够的 —— 一段空字符串也没有汉字。
 * 所以常见规则的英文句子是**逐字写出来**的。
 *
 * ⚠️ 有两处**刻意不逐字对齐**（见文件末尾）：多月份的年度规则。
 * 它们只能来自外部（导入或别的客户端），本仓库的预设构造不出，
 * 而且新说法比旧的更清楚。刻意偏离必须被**钉住**，否则下一个人会
 * 以为是漏迁的 bug 又改回去。
 */

import { describe, expect, it } from 'vitest';
import { describeRecurrence } from '@heyta/domain';
import { translate } from '@heyta/i18n';

import { describeRecurrenceText } from '../src/lib/recurrence-display';

/** 每种语言各绑定一份取词函数，避免每条断言都重复写 locale。 */
const zh = translate.bind(null, 'zh-CN');
const en = translate.bind(null, 'en');

/**
 * 中文必须**逐字**与 `describeRecurrence` 一致的规则。
 *
 * 覆盖面刻意按"本仓库能造出来的规则"来选：`packages/app-host/src/repeat-presets.ts`
 * 只会产生 `Recurrence.daily()` / `weekly([...])` / `monthlyOnDay(1..31)`，
 * 再加上另一台设备同步过来的自定义规则。所以这 27 条覆盖了
 * 每天 / 每周（含工作日）/ 每月几号 / 每月第几个星期几 / 每年的全部形状。
 */
const PARITY_RULES: readonly string[] = [
  'FREQ=DAILY',
  'FREQ=DAILY;INTERVAL=3',
  // DAILY 不看 BYDAY（两者都是合法值，只是 DAILY 用不上）。
  'FREQ=DAILY;BYDAY=MO',
  'FREQ=WEEKLY',
  'FREQ=WEEKLY;INTERVAL=2',
  'FREQ=WEEKLY;BYDAY=MO',
  'FREQ=WEEKLY;BYDAY=MO,WE,FR',
  'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
  // RFC 5545 不允许 WEEKLY 带序数，但域层容忍它（剥掉序数）。容忍行为必须一致。
  'FREQ=WEEKLY;BYDAY=+1MO',
  'FREQ=MONTHLY',
  'FREQ=MONTHLY;INTERVAL=3',
  'FREQ=MONTHLY;BYMONTHDAY=1',
  'FREQ=MONTHLY;BYMONTHDAY=14',
  'FREQ=MONTHLY;BYMONTHDAY=-1',
  'FREQ=MONTHLY;BYMONTHDAY=-2',
  'FREQ=MONTHLY;BYMONTHDAY=14,-1',
  'FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=1',
  'FREQ=MONTHLY;BYDAY=WE',
  'FREQ=MONTHLY;BYDAY=+2WE',
  'FREQ=MONTHLY;BYDAY=-1FR',
  'FREQ=MONTHLY;BYDAY=-2MO',
  'FREQ=MONTHLY;BYDAY=+1TU,+3TH',
  'FREQ=YEARLY',
  'FREQ=YEARLY;INTERVAL=2',
  'FREQ=YEARLY;BYMONTH=1',
  'FREQ=YEARLY;BYMONTH=9',
  'FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=26',
  'FREQ=YEARLY;INTERVAL=2;BYMONTH=9;BYMONTHDAY=26',
];

describe('中文：逐字等于领域层的 describeRecurrence', () => {
  for (const rule of PARITY_RULES) {
    it(rule, () => {
      expect(describeRecurrenceText(rule, zh, 'zh-CN')).toBe(describeRecurrence(rule));
    });
  }

  it('参照本身是有内容的 —— 否则上面整组可能是"两边都是空串"', () => {
    for (const rule of PARITY_RULES) {
      expect(describeRecurrence(rule), rule).not.toBe('');
      expect(describeRecurrence(rule), rule).not.toBe(rule);
    }
  });
});

describe('英文：常见规则的句子', () => {
  const CASES: readonly (readonly [string, string])[] = [
    ['FREQ=DAILY', 'every day'],
    ['FREQ=DAILY;INTERVAL=3', 'every 3 days'],
    ['FREQ=WEEKLY', 'every week'],
    ['FREQ=WEEKLY;INTERVAL=2', 'every 2 weeks'],
    ['FREQ=WEEKLY;BYDAY=MO', 'every week on Monday'],
    ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'every week on Monday, Tuesday, Wednesday, Thursday, Friday'],
    ['FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', 'every 2 weeks on Monday, Wednesday'],
    ['FREQ=MONTHLY', 'every month'],
    ['FREQ=MONTHLY;INTERVAL=3', 'every 3 months'],
    ['FREQ=MONTHLY;BYMONTHDAY=14', 'every month on day 14'],
    ['FREQ=MONTHLY;BYMONTHDAY=-1', 'every month on the last day'],
    ['FREQ=MONTHLY;BYMONTHDAY=-2', 'every month on 2 days before the end'],
    ['FREQ=MONTHLY;BYMONTHDAY=14,-1', 'every month on day 14, the last day'],
    ['FREQ=MONTHLY;BYDAY=WE', 'every month on Wednesday'],
    ['FREQ=MONTHLY;BYDAY=+2WE', 'every month on the second Wednesday'],
    ['FREQ=MONTHLY;BYDAY=-1FR', 'every month on the last Friday'],
    ['FREQ=MONTHLY;BYDAY=-2MO', 'every month on the second-to-last Monday'],
    ['FREQ=MONTHLY;BYDAY=+1TU,+3TH', 'every month on the first Tuesday, the third Thursday'],
    ['FREQ=YEARLY', 'every year'],
    ['FREQ=YEARLY;INTERVAL=2', 'every 2 years'],
    ['FREQ=YEARLY;BYMONTH=9', 'every year in September'],
    ['FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=26', 'every year on September 26'],
    ['FREQ=YEARLY;INTERVAL=2;BYMONTH=9;BYMONTHDAY=26', 'every 2 years on September 26'],
  ];

  for (const [rule, expected] of CASES) {
    it(`${rule} → ${expected}`, () => {
      expect(describeRecurrenceText(rule, en, 'en')).toBe(expected);
    });
  }
});

describe('英文：不能漏出中文（迁移前就是这个问题）', () => {
  const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF300-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/;

  it('上面每一条规则的英文输出都不含汉字/中文标点', () => {
    for (const rule of PARITY_RULES) {
      const text = describeRecurrenceText(rule, en, 'en');
      expect(CJK.test(text), `${rule} → ${text}`).toBe(false);
    }
  });

  it('不是靠"输出空串"过关', () => {
    for (const rule of PARITY_RULES) {
      expect(describeRecurrenceText(rule, en, 'en').length, rule).toBeGreaterThan(3);
    }
  });

  it('中英两句必须不同 —— 否则等于英文词条照抄了中文', () => {
    for (const rule of PARITY_RULES) {
      expect(describeRecurrenceText(rule, en, 'en'), rule).not.toBe(describeRecurrenceText(rule, zh, 'zh-CN'));
    }
  });
});

describe('列举分隔符：它是正字法、不在词条表里，所以两种语言各钉一条', () => {
  /**
   * 🔴 这一段是 `describeRecurrenceText` 里唯一一处**不经词条表**的语言差异
   * （见那个函数的 `LIST_SEPARATOR` 与它上面的长注释：中文侧的值只有一个标点，
   * 进词条表会被"中文词条必须含汉字"判为违规，而那条规则是对的）。
   *
   * 既然离开了词条表，就失去了"两种语言都在同一张表里、可被 catalog.spec 统一检查"
   * 的保护 —— 所以用这两条把它钉回来，方向**两边都测**：
   * 中文必须是顿号、且不能出现英文逗号；英文反过来。
   */
  it('中文用顿号，且**不是**英文逗号', () => {
    const text = describeRecurrenceText('FREQ=WEEKLY;BYDAY=MO,WE', zh, 'zh-CN');
    expect(text).toBe('每周一、三');
    expect(text).not.toContain(',');
  });

  it('英文用「逗号 + 空格」，且**不是**顿号', () => {
    const text = describeRecurrenceText('FREQ=WEEKLY;BYDAY=MO,WE', en, 'en');
    expect(text).toBe('every week on Monday, Wednesday');
    expect(text).not.toContain('、');
  });

  it('月份、几号、第几个星期几走的都是同一个分隔符', () => {
    expect(describeRecurrenceText('FREQ=MONTHLY;BYMONTHDAY=14,-1', zh, 'zh-CN')).toBe(
      '每月 14 日、最后一天',
    );
    expect(describeRecurrenceText('FREQ=MONTHLY;BYMONTHDAY=14,-1', en, 'en')).toBe(
      'every month on day 14, the last day',
    );
    expect(describeRecurrenceText('FREQ=MONTHLY;BYDAY=+1TU,+3TH', en, 'en')).toBe(
      'every month on the first Tuesday, the third Thursday',
    );
  });
});

describe('描述不了的规则：原样显示，不编一句话', () => {
  // `FREQ=DAILY;BYDAY=XX` 也在这里：解析器会**校验** BYDAY 的取值，
  // `XX` 不是一个星期几，所以整串解析失败 —— 它不是"DAILY 忽略了 BYDAY"。
  const UNPARSEABLE = ['', '不是规则', 'FREQ=HOURLY', 'FREQ=DAILY;BYDAY=XX'];

  for (const rule of UNPARSEABLE) {
    it(JSON.stringify(rule), () => {
      expect(describeRecurrenceText(rule, zh, 'zh-CN')).toBe(rule);
      expect(describeRecurrenceText(rule, en, 'en')).toBe(rule);
    });
  }

  it('两种语言给出**同一个**原始串（不是各编一句）', () => {
    for (const rule of UNPARSEABLE) {
      expect(describeRecurrenceText(rule, zh, 'zh-CN'), rule).toBe(describeRecurrenceText(rule, en, 'en'));
    }
  });
});

describe('刻意偏离领域层的那两处（只能来自外部，且新说法更清楚）', () => {
  /**
   * 旧实现把多个月份直接 `join('、')` 再拼一个「月」：`每年 9、10 月`。
   * 词条表按"每个月自带单位"来组织（英文尤其需要：September / October），
   * 于是得到 `每年 9 月、10 月`。
   *
   * 两种都读得通，后者更明确，所以接受这次变化 —— 但要钉住，
   * 否则下一个人会把它当成漏迁的回归又改回去。
   */
  it('多月份：每年 9、10 月 → 每年 9 月、10 月', () => {
    expect(describeRecurrence('FREQ=YEARLY;BYMONTH=9,10')).toBe('每年 9、10 月');
    expect(describeRecurrenceText('FREQ=YEARLY;BYMONTH=9,10', zh, 'zh-CN')).toBe('每年 9 月、10 月');
    expect(describeRecurrenceText('FREQ=YEARLY;BYMONTH=9,10', en, 'en')).toBe(
      'every year in September, October',
    );
  });

  /**
   * 旧实现这里连 `describeMonthDay` 都没走，直接把数字 `join` 了：
   * `每年 9 月 14、-1 日` —— `-1` 是**内部编码**，对用户没有意义。
   * 新实现和其它地方一样把 `-1` 说成「最后一天」。
   */
  it('年度里的负数日：… 14、-1 日 → … 14 日、最后一天', () => {
    expect(describeRecurrence('FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=14,-1')).toBe(
      '每年 9 月 14、-1 日',
    );
    expect(describeRecurrenceText('FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=14,-1', zh, 'zh-CN')).toBe(
      '每年 9 月 14 日、最后一天',
    );
    expect(describeRecurrenceText('FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=14,-1', en, 'en')).toBe(
      'every year on September 14, the last day',
    );
  });

  it('单个正整数日的年度规则**逐字一致** —— 偏离只发生在上面的形状里', () => {
    for (const rule of ['FREQ=YEARLY;BYMONTH=9', 'FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1']) {
      expect(describeRecurrenceText(rule, zh, 'zh-CN'), rule).toBe(describeRecurrence(rule));
    }
  });
});