/**
 * 快速捕获与倒计时测试
 * ======================
 *
 * 重点不是"正常情况能跑"，而是**把设计里那些刻意的选择钉住** ——
 * 尤其是几条"如果不写测试，下一个人会顺手改掉"的不变量：
 *
 *   1. **不存在"没被采纳却被移除"的片段**（文件头声明的不变量）
 *   2. 同字段的**第二条匹配留在标题里**，不被删除
 *   3. "本周X" 已过时**不偷偷挪到下周**（那是篡改用户意图）
 *   4. `dueDate <= createdAt` 时 `progress` 是 `null` 而**不是 1**
 *   5. 已完成的任务 `urgency` 一律 `none`
 *
 * 🔴 全部用例都**注入 `now`**。用真实时钟会让这些断言过几天变红，
 * 而 AGENTS.md §7 #25 的结论是：会随机失败的测试比没有测试更糟。
 */

import { describe, expect, it } from 'vitest';

import { parseCapture, dueDateToEpoch } from '../src/capture.js';
import {
  SOON_THRESHOLD_DAYS,
  computeCountdown,
  computeProgress,
  formatRemaining,
  formatRemainingUntil,
  formatTaskRemaining,
} from '../src/countdown.js';
import { Priority, type Task } from '../src/entities.js';

/** 2026-09-25 是**周五**（这一点很重要：周几用例全部依赖它）。 */
const FRIDAY = Date.parse('2026-09-25T10:00:00');
const FRIDAY_DATE = '2026-09-25';

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'x',
    createdAt: FRIDAY,
    updatedAt: FRIDAY,
    ...over,
  };
}

describe('parseCapture —— 相对日', () => {
  it('今天/明天/后天/大后天', () => {
    expect(parseCapture('今天交', { now: FRIDAY }).dueDate).toBe('2026-09-25');
    expect(parseCapture('明天交', { now: FRIDAY }).dueDate).toBe('2026-09-26');
    expect(parseCapture('后天交', { now: FRIDAY }).dueDate).toBe('2026-09-27');
    expect(parseCapture('大后天交', { now: FRIDAY }).dueDate).toBe('2026-09-28');
  });

  it('长模式优先：`大后天` 不能被 `后天` 吃掉', () => {
    // 若规则顺序错，这里会得到 2026-09-27（后天）并留下一个多余的"大"
    const r = parseCapture('大后天交', { now: FRIDAY });
    expect(r.dueDate).toBe('2026-09-28');
    expect(r.title).toBe('交');
    expect(r.matches).toHaveLength(1);
  });

  it('昨天/前天给出的是**已逾期**的日期，不是被挪到今天', () => {
    expect(parseCapture('昨天的事', { now: FRIDAY }).dueDate).toBe('2026-09-24');
    expect(parseCapture('前天的事', { now: FRIDAY }).dueDate).toBe('2026-09-23');
  });

  it('N 天后', () => {
    expect(parseCapture('5天后交', { now: FRIDAY }).dueDate).toBe('2026-09-30');
    expect(parseCapture('5 天后交', { now: FRIDAY }).dueDate).toBe('2026-09-30');
    expect(parseCapture('0天后交', { now: FRIDAY }).dueDate).toBe('2026-09-25');
  });
});

describe('parseCapture —— 周几', () => {
  // 2026-09-25 是周五；本周一是 09-21
  it('下周X 落在下一周', () => {
    // 下周一 = 09-28，下周三 = 09-30，下周日 = 10-04
    expect(parseCapture('下周一交', { now: FRIDAY }).dueDate).toBe('2026-09-28');
    expect(parseCapture('下周三交', { now: FRIDAY }).dueDate).toBe('2026-09-30');
    expect(parseCapture('下周日交', { now: FRIDAY }).dueDate).toBe('2026-10-04');
    expect(parseCapture('下星期天交', { now: FRIDAY }).dueDate).toBe('2026-10-04');
  });

  it('下下周X 是再下一周', () => {
    expect(parseCapture('下下周一交', { now: FRIDAY }).dueDate).toBe('2026-10-05');
  });

  it('长模式优先：`下下周三` 不能被 `下周三` 吃掉', () => {
    const r = parseCapture('下下周三交', { now: FRIDAY });
    expect(r.dueDate).toBe('2026-10-07');
    expect(r.title).toBe('交');
  });

  it('🔴 本周X 已过时保持为过去 —— 不偷偷挪到下周', () => {
    // 今天周五，本周一是 09-21（已过）。用户说"本周一"就是在说一个逾期的事。
    const r = parseCapture('本周一交', { now: FRIDAY });
    expect(r.dueDate).toBe('2026-09-21');
    expect(r.dueDate! < FRIDAY_DATE).toBe(true);
  });

  it('裸周X = 最近的将来（含今天）', () => {
    // 今天周五 → "周五"就是今天（不含今天会跳到下周，最不合预期）
    expect(parseCapture('周五交', { now: FRIDAY }).dueDate).toBe('2026-09-25');
    expect(parseCapture('周六交', { now: FRIDAY }).dueDate).toBe('2026-09-26');
    expect(parseCapture('周一交', { now: FRIDAY }).dueDate).toBe('2026-09-28');
    expect(parseCapture('周四交', { now: FRIDAY }).dueDate).toBe('2026-10-01');
  });

  it('周几的两种写法都认（周/星期/礼拜、日/天）', () => {
    expect(parseCapture('星期三交', { now: FRIDAY }).dueDate).toBe('2026-09-30');
    expect(parseCapture('礼拜三交', { now: FRIDAY }).dueDate).toBe('2026-09-30');
    expect(parseCapture('周日交', { now: FRIDAY }).dueDate).toBe('2026-09-27');
    expect(parseCapture('周天交', { now: FRIDAY }).dueDate).toBe('2026-09-27');
  });
});

describe('parseCapture —— 绝对日期', () => {
  it('M月D日：今年的已过 → 顺延到明年', () => {
    // 9/25 是今天，不算已过 → 今年
    expect(parseCapture('9月25日交', { now: FRIDAY }).dueDate).toBe('2026-09-25');
    // 1/5 今年已过 → 明年
    expect(parseCapture('1月5日交', { now: FRIDAY }).dueDate).toBe('2027-01-05');
  });

  it('M月D号 也认', () => {
    expect(parseCapture('10月8号交', { now: FRIDAY }).dueDate).toBe('2026-10-08');
  });

  it('ISO 形式原样采用（不因已过而顺延）', () => {
    expect(parseCapture('2026-09-26 交', { now: FRIDAY }).dueDate).toBe('2026-09-26');
    expect(parseCapture('2027-01-05 交', { now: FRIDAY }).dueDate).toBe('2027-01-05');
  });

  it('非法日期被拒（判定在 parseLocalDate，这里只断言结果）', () => {
    // 2月30日 会被 new Date 静默滚到 3月2日 —— 必须被拦下。
    const r = parseCapture('2月30日交', { now: FRIDAY });
    expect(r.dueDate).toBeUndefined();
    // 关键：没解析出来就**不该动标题**
    expect(r.title).toBe('2月30日交');
    expect(r.matches).toHaveLength(0);
  });

  it('🔴 不存在的日期必须被**安静拒绝**，不能抛错', () => {
    // 回归用例。范围校验上移到 `parseLocalDate` 之后（它现在会抛），
    // `makeLocalDate` 一度让那个异常直接穿出解析器 —— 于是用户在标题里
    // 打了一个不存在的日期，整个输入框就炸了。
    // 用户输入里带错日期是很常见的，解析器该做的是"这个字段没解析出来"。
    expect(() => parseCapture('2月30日交', { now: FRIDAY })).not.toThrow();
    expect(() => parseCapture('2026-02-30 交', { now: FRIDAY })).not.toThrow();
    expect(() => parseCapture('2月29日交', { now: FRIDAY })).not.toThrow();
    // 2026 不是闰年，所以 2 月 29 日解析不出来
    expect(parseCapture('2月29日交', { now: FRIDAY }).dueDate).toBeUndefined();
  });

  it('13月40日 被拒', () => {
    expect(parseCapture('13月40日交', { now: FRIDAY }).dueDate).toBeUndefined();
  });

  it('M/D 认，且不误吃 ISO 日期里的片段', () => {
    expect(parseCapture('10/8 交', { now: FRIDAY }).dueDate).toBe('2026-10-08');
    // `2026-09-26` 里没有斜杠，但 `2026/09/26` 有 —— 不能被当成 09/26
    const r = parseCapture('2026/09/26 交', { now: FRIDAY });
    // 边界检查拦掉 `26/09`（前面是数字）与 `09/26`（后面跟着 /26）
    // → 不接受任何匹配，于是标题不动
    expect(r.title).toBe('2026/09/26 交');
  });
});

describe('parseCapture —— 优先级', () => {
  it('!1..!4 映射到 Priority', () => {
    expect(parseCapture('交周报 !1', { now: FRIDAY }).priority).toBe(Priority.High);
    expect(parseCapture('交周报 !2', { now: FRIDAY }).priority).toBe(Priority.Medium);
    expect(parseCapture('交周报 !3', { now: FRIDAY }).priority).toBe(Priority.Low);
    expect(parseCapture('交周报 !4', { now: FRIDAY }).priority).toBe(Priority.None);
  });

  it('p1..p4 也认（大小写不敏感）', () => {
    expect(parseCapture('交周报 p1', { now: FRIDAY }).priority).toBe(Priority.High);
    expect(parseCapture('交周报 P2', { now: FRIDAY }).priority).toBe(Priority.Medium);
    expect(parseCapture('交周报 p4', { now: FRIDAY }).priority).toBe(Priority.None);
  });

  it('p5 / !9 不认（词表之外一律不动）', () => {
    expect(parseCapture('交周报 p5', { now: FRIDAY }).priority).toBeUndefined();
    expect(parseCapture('交周报 !9', { now: FRIDAY }).priority).toBeUndefined();
    expect(parseCapture('交周报 p5', { now: FRIDAY }).title).toBe('交周报 p5');
  });

  it('中文旁边的 p1 也能识别（`\\b` 对中文有效）', () => {
    expect(parseCapture('交周报p1', { now: FRIDAY }).priority).toBe(Priority.High);
  });
});

describe('parseCapture —— 中文优先级词（被真实输入逼出来的）', () => {
  // 🔴 这一组的存在理由写在 `capture.ts` 的 PRIORITY_BY_WORD 注释里：
  // 一次真实端点实测发现「明天下午三点开周会 高优先级」里，
  // 规则内核**没认出「高优先级」**，把这三个字留在了标题里。
  // 原来的规则只认 `!1`/`p1` —— 那是极客写法，中文用户不这么打字。

  it('高优先级 / 紧急 / 加急 → High', () => {
    expect(parseCapture('交周报 高优先级', { now: FRIDAY }).priority).toBe(Priority.High);
    expect(parseCapture('交周报 最高优先级', { now: FRIDAY }).priority).toBe(Priority.High);
    expect(parseCapture('交周报 紧急', { now: FRIDAY }).priority).toBe(Priority.High);
    expect(parseCapture('交周报 加急', { now: FRIDAY }).priority).toBe(Priority.High);
  });

  it('中优先级 / 普通优先级 → Medium', () => {
    expect(parseCapture('交周报 中优先级', { now: FRIDAY }).priority).toBe(Priority.Medium);
    expect(parseCapture('交周报 普通优先级', { now: FRIDAY }).priority).toBe(Priority.Medium);
  });

  it('低优先级 / 不急 → Low', () => {
    expect(parseCapture('交周报 低优先级', { now: FRIDAY }).priority).toBe(Priority.Low);
    expect(parseCapture('买菜 不急', { now: FRIDAY }).priority).toBe(Priority.Low);
  });

  it('🔴 词被采纳后**必须从标题里移走**（不能只认不删）', () => {
    const r = parseCapture('明天下午三点开周会 高优先级', { now: FRIDAY });
    expect(r.priority).toBe(Priority.High);
    expect(r.title).not.toContain('高优先级');
    expect(r.title.trim()).toBe('下午三点开周会');
  });

  it('🔴 「最高优先级」不会被「高优先级」抢走（长的必须排前面）', () => {
    const r = parseCapture('交周报 最高优先级', { now: FRIDAY });
    expect(r.priority).toBe(Priority.High);
    // 若短模式先匹配，「最高优先级」会留下一个孤零零的「最」字
    expect(r.title).not.toContain('最');
    expect(r.title).toBe('交周报');
  });

  it('🔴 单字「高」/「急」绝不能被当成优先级（宁可少认，不可错认）', () => {
    // 这几个是最容易写错的反例：用单字做规则会把它们全吃掉。
    for (const text of ['坐高铁去北京', '高度近视复查', '提高效率', '急诊科值班']) {
      const r = parseCapture(text, { now: FRIDAY });
      expect(r.priority).toBeUndefined();
      expect(r.title).toBe(text);
    }
  });

  it('大小写/中英混排不互相干扰：p1 仍优先于中文词', () => {
    // `p1` 与「低优先级」同时出现 → 采纳**先出现**的那个（既有语义）
    expect(parseCapture('交周报 p1 低优先级', { now: FRIDAY }).priority).toBe(Priority.High);
    expect(parseCapture('交周报 低优先级 p1', { now: FRIDAY }).priority).toBe(Priority.Low);
  });
});

describe('parseCapture —— 用户显式忽略（exclude）', () => {
  it('🔴 忽略 = rejected:true + applied:false，且文字**留在标题里**', () => {
    const r = parseCapture('明天交周报', { now: FRIDAY, exclude: [{ field: 'dueDate', raw: '明天' }] });
    expect(r.dueDate).toBeUndefined();
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]!.rejected).toBe(true);
    expect(r.matches[0]!.applied).toBe(false);
    // 这是本文件的核心不变量：忽略不等于删除
    expect(r.title).toBe('明天交周报');
  });

  it('忽略后仍是合法输入（不像"没识别出来"那样消失）', () => {
    const r = parseCapture('明天交周报', { now: FRIDAY, exclude: [{ field: 'dueDate', raw: '明天' }] });
    // 匹配仍然被报出来 —— UI 才有机会提供"恢复"
    expect(r.matches[0]!.raw).toBe('明天');
  });

  it('忽略只影响该字段，不影响另一个字段', () => {
    const r = parseCapture('明天交周报 !1', {
      now: FRIDAY,
      exclude: [{ field: 'dueDate', raw: '明天' }],
    });
    expect(r.dueDate).toBeUndefined();
    expect(r.priority).toBe(Priority.High);
    expect(r.title).toBe('明天交周报');
  });

  it('忽略当天的日期后，`dueDate` 确实不再生效', () => {
    expect(parseCapture('今天开会', { now: FRIDAY, exclude: [{ field: 'dueDate', raw: '今天' }] }).dueDate).toBeUndefined();
    expect(parseCapture('今天开会', { now: FRIDAY }).dueDate).toBe('2026-09-25');
  });

  it('忽略一条后，同字段的第二条**会被采纳**（位置前移）', () => {
    const r = parseCapture('今天 明天 交周报', {
      now: FRIDAY,
      exclude: [{ field: 'dueDate', raw: '今天' }],
    });
    // 今天被忽略 → 明天成为第一条未被忽略的
    expect(r.dueDate).toBe('2026-09-26');
    const byRaw = Object.fromEntries(r.matches.map((m) => [m.raw, m]));
    expect(byRaw['今天']!.rejected).toBe(true);
    expect(byRaw['明天']!.applied).toBe(true);
    // 两条都不在标题里：今天被忽略但仍算标题文字，明天被采纳移除
    expect(r.title).toBe('今天 交周报');
  });

  it('不传 exclude 时 rejected 恒为 false', () => {
    const r = parseCapture('明天交周报 !1', { now: FRIDAY });
    expect(r.matches.every((m) => !m.rejected)).toBe(true);
  });

  it('exclude 里的条目若没有对应匹配，不抛错也不产生多余 match', () => {
    const r = parseCapture('交周报', { now: FRIDAY, exclude: [{ field: 'dueDate', raw: '明天' }] });
    expect(r.matches).toHaveLength(0);
    expect(r.title).toBe('交周报');
  });
});

describe('parseCapture —— 🔴 不丢字（本文件最重要的不变量）', () => {
  it('每一个被移除的片段都是 applied:true', () => {
    const inputs = [
      '明天交周报 !1',
      '下周三 开会 p2',
      '后天 见客户',
      '10月8号 交材料',
      '今天 明天 交周报', // 两个日期
      '交周报 !1 p2', // 两个优先级
      '没有任何标记的普通任务',
    ];
    for (const input of inputs) {
      const r = parseCapture(input, { now: FRIDAY });
      const removed = r.matches.filter((m) => m.applied);
      // 重建：把标题 + 所有被移除片段拼回去，排序后应与原输入的非空白字符一致
      const removedChars = removed.map((m) => m.raw).join('');
      const strippedTitle = r.title.replace(/\s+/g, '');
      const originalChars = input.replace(/\s+/g, '');
      expect(`${strippedTitle}${removedChars}`.length).toBeGreaterThanOrEqual(
        removedChars.length,
      );
      // 更强的检查：标题里不该残留任何被采纳的原始片段
      for (const m of removed) {
        expect(r.title.includes(m.raw)).toBe(false);
      }
      // 且所有被采纳片段合起来 + 标题 = 原输入（去空白后）
      const appliedRaw = removed
        .map((m) => m.raw)
        .join('')
        .replace(/\s+/g, '');
      expect(strippedTitle.length + appliedRaw.length).toBe(originalChars.length);
    }
  });

  it('同字段的**第二条匹配留在标题里**，不被删除', () => {
    // 两个日期：「明天」被采纳，「后天」留在标题中（用户可以看见并纠正）
    const r = parseCapture('今天 明天 交周报', { now: FRIDAY });
    expect(r.dueDate).toBe('2026-09-25'); // 位置最靠前的那条
    expect(r.matches).toHaveLength(2);
    expect(r.matches[0]!.applied).toBe(true);
    expect(r.matches[1]!.applied).toBe(false);
    expect(r.matches[1]!.raw).toBe('明天');
    // 🔴 未采纳 → 必须还在标题里
    expect(r.title).toBe('明天 交周报');
  });

  it('两个优先级同理', () => {
    const r = parseCapture('交周报 !1 p2', { now: FRIDAY });
    expect(r.priority).toBe(Priority.High);
    expect(r.title).toBe('交周报 p2');
  });

  it('没有任何标记时标题原样返回', () => {
    const r = parseCapture('写完那段不好解析的说明', { now: FRIDAY });
    expect(r.title).toBe('写完那段不好解析的说明');
    expect(r.matches).toHaveLength(0);
    expect(r.dueDate).toBeUndefined();
    expect(r.priority).toBeUndefined();
  });
});

describe('parseCapture —— 边界与卫生', () => {
  it('空输入不抛错，返回空标题', () => {
    const r = parseCapture('', { now: FRIDAY });
    expect(r.title).toBe('');
    expect(r.matches).toHaveLength(0);
  });

  it('只输入"明天" → 标题为空（是否允许提交是 UI 决策，不是数据决策）', () => {
    const r = parseCapture('明天', { now: FRIDAY });
    expect(r.title).toBe('');
    expect(r.dueDate).toBe('2026-09-26');
  });

  it('移除片段后合并多余空白并 trim', () => {
    expect(parseCapture('明天 开会', { now: FRIDAY }).title).toBe('开会');
    expect(parseCapture('开会 明天', { now: FRIDAY }).title).toBe('开会');
    expect(parseCapture('明天开会', { now: FRIDAY }).title).toBe('开会');
  });

  it('matches 按位置升序，且 start/end 与 raw 自洽', () => {
    const input = '明天交周报 !1';
    const r = parseCapture(input, { now: FRIDAY });
    expect(r.matches.map((m) => m.start)).toEqual([...r.matches.map((m) => m.start)].sort((a, b) => a - b));
    for (const m of r.matches) {
      expect(input.slice(m.start, m.end)).toBe(m.raw);
    }
  });

  it('🔴 纯函数：同一输入反复调用结果一致（正则 lastIndex 不泄漏）', () => {
    const a = parseCapture('明天 交周报 !1', { now: FRIDAY });
    const b = parseCapture('明天 交周报 !1', { now: FRIDAY });
    const c = parseCapture('明天 交周报 !1', { now: FRIDAY });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('dueDateToEpoch 给出本地零点（与"今天"视图的日历日比对一致）', () => {
    const epoch = dueDateToEpoch('2026-09-26');
    const d = new Date(epoch);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8); // 0-based
    expect(d.getDate()).toBe(26);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });
});

describe('computeCountdown', () => {
  it('无截止时间 → 全 null，不报警', () => {
    const c = computeCountdown(task(), { now: FRIDAY });
    expect(c.remainingDays).toBeNull();
    expect(c.urgency).toBe('none');
    expect(c.progress).toBeNull();
    expect(c.overdue).toBe(false);
  });

  it('档位：逾期 / 今天 / 3 天内 / 更远', () => {
    const at = (due: number) => computeCountdown(task({ dueDate: due }), { now: FRIDAY });
    expect(at(Date.parse('2026-09-24T00:00:00')).urgency).toBe('overdue');
    expect(at(Date.parse('2026-09-25T00:00:00')).urgency).toBe('today');
    expect(at(Date.parse('2026-09-28T00:00:00')).urgency).toBe('soon');
    expect(at(Date.parse('2026-09-29T00:00:00')).urgency).toBe('later');
  });

  it('阈值边界正好落在 SOON_THRESHOLD_DAYS 上', () => {
    // 默认 3 天 → 差 3 天算 soon，差 4 天算 later
    const soon = computeCountdown(task({ dueDate: Date.parse('2026-09-28T00:00:00') }), {
      now: FRIDAY,
    });
    const later = computeCountdown(task({ dueDate: Date.parse('2026-09-29T00:00:00') }), {
      now: FRIDAY,
    });
    expect(soon.remainingDays).toBe(SOON_THRESHOLD_DAYS);
    expect(soon.urgency).toBe('soon');
    expect(later.remainingDays).toBe(SOON_THRESHOLD_DAYS + 1);
    expect(later.urgency).toBe('later');
  });

  it('🔴 已完成的任务 urgency 一律 none（不在象限里不紧急、在倒计时里却报警）', () => {
    const c = computeCountdown(
      task({ dueDate: Date.parse('2026-09-20T00:00:00'), completedAt: FRIDAY }),
      { now: FRIDAY },
    );
    expect(c.urgency).toBe('none');
    expect(c.overdue).toBe(false);
    // 但剩余天数仍然如实给出（它是事实，不是警报）
    expect(c.remainingDays).toBe(-5);
  });

  it('overdue 标志与剩余天数一致', () => {
    const c = computeCountdown(task({ dueDate: Date.parse('2026-09-23T00:00:00') }), { now: FRIDAY });
    expect(c.overdue).toBe(true);
    expect(c.remainingDays! < 0).toBe(true);
  });
});

describe('computeProgress', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const start = FRIDAY;
  const end = FRIDAY + 10 * DAY;

  it('中点约为 0.5', () => {
    expect(computeProgress(start, end, start + 5 * DAY)).toBeCloseTo(0.5, 5);
  });

  it('区间外被夹紧：之前 0、之后 1', () => {
    expect(computeProgress(start, end, start - DAY)).toBe(0);
    expect(computeProgress(start, end, end + DAY)).toBe(1);
    expect(computeProgress(start, end, end)).toBe(1);
  });

  it('🔴 dueDate <= createdAt 返回 null，**不是 1**', () => {
    // 同一天创建、同一天到期 → 不能显示成"已经到头了"
    expect(computeProgress(start, start, start)).toBeNull();
    expect(computeProgress(start, start - DAY, start)).toBeNull();
  });

  it('时钟回拨不产生负数', () => {
    const p = computeProgress(start, end, start - 100 * DAY);
    expect(p).toBe(0);
    expect(p! >= 0).toBe(true);
  });
});

describe('formatRemaining —— 实际渲染的那一层', () => {
  it('按人话写，不按程序写', () => {
    expect(formatRemaining(0)).toBe('今天');
    expect(formatRemaining(1)).toBe('明天');
    expect(formatRemaining(2)).toBe('后天');
    expect(formatRemaining(5)).toBe('还剩 5 天');
    expect(formatRemaining(-3)).toBe('已逾期 3 天');
    expect(formatRemaining(-1)).toBe('已逾期 1 天');
    expect(formatRemaining(null)).toBeNull();
  });

  it('formatTaskRemaining / formatRemainingUntil 与 formatRemaining 一致', () => {
    const t = task({ dueDate: Date.parse('2026-09-28T00:00:00') });
    expect(formatTaskRemaining(t, { now: FRIDAY })).toBe('还剩 3 天');
    expect(formatRemainingUntil('2026-09-28', { now: FRIDAY })).toBe('还剩 3 天');
    expect(formatRemainingUntil('2026-09-26', { now: FRIDAY })).toBe('明天');
  });

  it('没有截止时间的任务没有文案', () => {
    expect(formatTaskRemaining(task(), { now: FRIDAY })).toBeNull();
  });
});
/*
 * 🔴 「的」是**被删掉那个短语**的语法连接词（2026-10-01 实测撞见）
 * ================================================================
 *
 * 症状不是"少认了一个日期"，是**把用户的句子剪断**：
 *
 * | 输入 | 修之前的标题 |
 * |---|---|
 * | 明天的会议 | `的会议` |
 * | 下周三的周报 | `的周报` |
 * | 另一件不急的事 | `另一件的事` |
 * | 写一份不急的周报 | `写一份的周报` |
 *
 * 这是一个任务应用**每天**都会被喂进去的形状。用户没有做错任何事，
 * 建出来的任务标题却是个残句，而且没有任何一处提示过他会这样。
 *
 * 成因：中文没有词间空格，"标记 + 的 + 名词"是**定语**写法 —— 那个「的」
 * 挂在被删掉的时间/优先级短语上，删完还留着它，等于把句子从中间剪断。
 * 英文的 `tomorrow meeting` 不会有这个问题，所以这套规则从英文形状
 * 直译过来时，只有中文这一侧会咬人。
 */
describe('parseCapture —— 认出来的短语后面紧跟的「的」一起带走', () => {
  it('日期 + 「的」：标题是「会议」，不是「的会议」', () => {
    const r = parseCapture('明天的会议', { now: FRIDAY });
    expect(r.dueDate).toBe('2026-09-26');
    expect(r.title).toBe('会议');
  });

  it('优先级词 + 「的」：标题读得通，优先级照样认', () => {
    const r = parseCapture('另一件不急的事', { now: FRIDAY });
    expect(r.priority).toBe(Priority.Low);
    expect(r.title).toBe('另一件事');
    const w = parseCapture('写一份不急的周报', { now: FRIDAY });
    expect(w.title).toBe('写一份周报');
  });

  it('🔴 只带走**被采纳**那个短语后面的「的」—— 不变量仍然成立', () => {
    // 「后天」是同字段的第二条，未被采纳 ⇒ 它和它自己的「的」都得留在标题里。
    // 把吞「的」写成"见一个吞一个"就会在这里变红：那是第二遍违反
    // "没被采纳的片段一定留在标题里"。
    const r = parseCapture('明天开会，后天的高铁', { now: FRIDAY });
    expect(r.dueDate).toBe('2026-09-26');
    expect(r.title).toBe('开会，后天的高铁');
  });

  it('🔴 不是「的」的字一个都不多吃', () => {
    // 「明天见」：吃掉「明天」是设计（时间短语），但「见」是标题本体。
    expect(parseCapture('明天见', { now: FRIDAY }).title).toBe('见');
    // 「这个不着急」：定语之外的谓语写法照旧只吃掉短语本身。
    const r = parseCapture('这个不着急', { now: FRIDAY });
    expect(r.priority).toBe(Priority.Low);
    expect(r.title).toBe('这个');
  });
});
