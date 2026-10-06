/**
 * 日历锚点测试（W4 / `docs/plans/ai-assistant-closure.md`）
 * ==========================================================
 *
 * ## 这条测试钉的是什么产品事实
 *
 * 助手要能把"今天有什么任务"翻译成 `list_tasks` 的日期参数，而它**只有**
 * 通过提示词里那一行「今天是 …」才知道今天是哪天。所以锚点错一天，
 * 症状不是报错，是**给用户看错一天的清单** —— 最难归因的那一类。
 *
 * ## 判据表从哪来
 *
 * 期望值不是手写的，是**同一份换算在 Node 里跑出来的**（UTC / 上海 / 安克雷奇 /
 * 基里巴斯 / 德黑兰五个区，两个瞬间），覆盖计划里点名的四组：
 *
 * | 组 | 用例 |
 *   --- | --- |
 * | 跨年 | `2026-12-31T23:30Z` 在上海是 **2027-01-01** |
 * | 非 UTC 时区 | 同一瞬间在 UTC 是 14 日、在上海是 15 日 |
 * | 夏令时 | 安克雷奇 3 月 `-08:00`、12 月 `-09:00`（同一个 IANA 区两个偏移）|
 * | 半小时偏移 | 德黑兰 `+03:30`（`pad2` 那条分支，整点区测不到它）|
 *
 * 🔴 **变异**：把 `utcOffsetLabel` 写死成 `'UTC+00:00'` ⇒ 下面至少三条红
 * （偏移本身、跨日的那两条、以及"锚点随行号变"那条）。
 * 计划里"把时区写死成 UTC ⇒ 至少一条红"这条要求在这里是**可失败**的。
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  CALENDAR_ANCHOR_RULES,
  assistantEgressFields,
  assistantSystemPrompt,
  buildBreakdownInvocation,
  buildCaptureInvocation,
  buildDurationInvocation,
  buildPrioritizeInvocation,
  calendarAnchor,
  calendarAnchorLine,
  utcOffsetLabel,
  type PrioritizeTaskInput,
} from '../src/index.js';

/** 两个被测瞬间（epoch ms）。 */
const A = Date.parse('2026-03-14T23:30:00Z');
const B = Date.parse('2026-12-31T23:30:00Z');

const ORIGINAL_TZ = process.env['TZ'];

afterEach(() => {
  // 🔴 必须还原：`TZ` 是**进程级**的，同一个 worker 里后面的用例会继承它。
  // 不还原的话，"锚点随注入的 now 变"那类用例会莫名其妙地在某个区里跑。
  if (ORIGINAL_TZ === undefined) delete process.env['TZ'];
  else process.env['TZ'] = ORIGINAL_TZ;
});

describe('utcOffsetLabel：本地时区的偏移', () => {
  it('整点区写成 UTC±HH:00，符号与 `getTimezoneOffset()` 相反', () => {
    process.env['TZ'] = 'Asia/Shanghai';
    expect(utcOffsetLabel(A)).toBe('UTC+08:00');
    process.env['TZ'] = 'America/Anchorage';
    expect(utcOffsetLabel(A)).toBe('UTC-08:00');
    process.env['TZ'] = 'UTC';
    expect(utcOffsetLabel(A)).toBe('UTC+00:00');
  });

  it('🔴 半小时偏移不许丢分钟（德黑兰 +03:30）', () => {
    process.env['TZ'] = 'Asia/Tehran';
    expect(utcOffsetLabel(A)).toBe('UTC+03:30');
  });

  it('🔴 同一个 IANA 区在夏令时两侧偏移不同（安克雷奇 3 月 -08、12 月 -09）', () => {
    process.env['TZ'] = 'America/Anchorage';
    expect(utcOffsetLabel(A)).toBe('UTC-08:00');
    expect(utcOffsetLabel(B)).toBe('UTC-09:00');
  });

  it('东十四区（基里巴斯）不溢出两位小时', () => {
    process.env['TZ'] = 'Pacific/Kiritimati';
    expect(utcOffsetLabel(A)).toBe('UTC+14:00');
  });
});

describe('calendarAnchor：本地日历日 + 星期 + 偏移', () => {
  it('🔴 用**本地**日，不是 UTC 日（同一瞬间两个区差一天）', () => {
    process.env['TZ'] = 'UTC';
    expect(calendarAnchor(A).day).toBe('2026-03-14');
    process.env['TZ'] = 'Asia/Shanghai';
    expect(calendarAnchor(A).day).toBe('2026-03-15');
  });

  it('跨年：2026-12-31T23:30Z 在上海已经是 2027-01-01', () => {
    process.env['TZ'] = 'Asia/Shanghai';
    const anchor = calendarAnchor(B);
    expect(anchor.day).toBe('2027-01-01');
    // 2027-01-01 是周五。星期与日期**必须同源**：分开算的话，
    // 界面上会出现"1 月 1 日（周六）"这种自相矛盾的锚点。
    expect(anchor.weekday).toBe('五');
  });

  it('月末溢出与"已过本月同日"不影响锚点本身（它只回答"今天是哪天"）', () => {
    process.env['TZ'] = 'Asia/Shanghai';
    // 3 月 31 日 / 2 月 29 日（2028 闰）/ 2 月 28 日（2026 平）三个边界日。
    expect(calendarAnchor(Date.parse('2026-03-31T04:00:00Z')).day).toBe('2026-03-31');
    expect(calendarAnchor(Date.parse('2028-02-29T04:00:00Z')).day).toBe('2028-02-29');
    expect(calendarAnchor(Date.parse('2026-02-28T04:00:00Z')).day).toBe('2026-02-28');
  });

  it('星期与 ISO 星期几同源（周日是"日"，不是空）', () => {
    process.env['TZ'] = 'UTC';
    expect(calendarAnchor(A).weekday).toBe('六'); // 2026-03-14
    expect(calendarAnchor(Date.parse('2026-03-15T04:00:00Z')).weekday).toBe('日');
  });
});

describe('calendarAnchorLine：进提示词的那一行', () => {
  it('形状是「今天是：YYYY-MM-DD（周X，UTC±HH:MM）」', () => {
    process.env['TZ'] = 'Asia/Shanghai';
    expect(calendarAnchorLine(calendarAnchor(A))).toBe('今天是：2026-03-15（周日，UTC+08:00）');
  });

  it('🔴 前缀必须是「今天是：」—— capture 的 `fields ↔ user` 对照表拿它当标记', () => {
    process.env['TZ'] = 'UTC';
    expect(calendarAnchorLine(calendarAnchor(A))).toMatch(
      /^今天是：\d{4}-\d{2}-\d{2}（周.，UTC[+-]\d{2}:\d{2}）$/u,
    );
  });
});

describe('助手的系统提示带着锚点，且锚点是**每次现算**的', () => {
  it('系统提示含锚点行 + 日期硬规则', () => {
    process.env['TZ'] = 'Asia/Shanghai';
    const prompt = assistantSystemPrompt(A);
    expect(prompt).toContain('今天是：2026-03-15（周日，UTC+08:00）');
    expect(prompt).toContain(CALENDAR_ANCHOR_RULES);
    // 固定那段还在（锚点是**追加**，不是替换掉角色说明）。
    expect(prompt).toContain('你是 heyta 任务管理器里的助手');
  });

  it('🔴 跨零点：同一份提示词函数换 `now` 就换日期（锚点不许冻在第一次）', () => {
    process.env['TZ'] = 'Asia/Shanghai';
    const before = assistantSystemPrompt(Date.parse('2026-12-31T15:30:00Z')); // 当地 12-31 23:30
    const after = assistantSystemPrompt(Date.parse('2026-12-31T16:30:00Z')); // 当地 01-01 00:30
    expect(before).toContain('今天是：2026-12-31');
    expect(after).toContain('今天是：2027-01-01');
    expect(before).not.toBe(after);
  });

  it('省略 `now` 时用真实时钟（壳不注入也不能崩）', () => {
    process.env['TZ'] = 'UTC';
    expect(assistantSystemPrompt()).toContain('今天是：');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴 W4：锚点必须住在**每一条**出境链路上，而且只有一个生产者
// ─────────────────────────────────────────────────────────────────────────
//
// 这三条判据各挡一种不同的坏：
//
//   1. **"某条链路没带锚点"** —— 那正是 W4 的原始缺陷（只有 capture 有）。
//      逐个点名，不数全仓命中数：全仓命中 3 次可能全在同一份文件里。
//   2. **"某条链路带了锚点但没披露 `today`"** —— 披露里没有、请求里有。
//      这是本仓库最不能接受的形状（AGENTS §7 那一整族"界面在说谎"）。
//   3. **"有人抄了第二份日期格式化逻辑"** —— 措辞与 `calendarAnchorLine`
//      逐字不同就红。抄件一定会漂，而"哪条链路里的今天是哪天"这种漂移
//      没有任何一层会失败。
describe('🔴🔴 四条出站链路都带锚点，且都披露 today', () => {
  /** 本地中午：任何时区下本地日历日都是 2026-09-25（周五）。 */
  const N = Date.parse('2026-09-25T12:00:00');
  const TASKS: readonly PrioritizeTaskInput[] = [{ id: 't1', title: '做发布' }];
  const canonical = calendarAnchorLine(calendarAnchor(N));

  const chains = [
    {
      name: 'capture',
      prompt: () => buildCaptureInvocation({ locale: 'zh-CN', text: '买牛奶', now: N }).user,
      fields: () => buildCaptureInvocation({ locale: 'zh-CN', text: '买牛奶', now: N }).fields,
    },
    {
      name: 'breakdown',
      prompt: () => buildBreakdownInvocation({ locale: 'zh-CN', title: '做发布', now: N }).user,
      fields: () => buildBreakdownInvocation({ locale: 'zh-CN', title: '做发布', now: N }).fields,
    },
    {
      name: 'prioritize',
      prompt: () => buildPrioritizeInvocation({ locale: 'zh-CN', tasks: TASKS, now: N }).user,
      fields: () => buildPrioritizeInvocation({ locale: 'zh-CN', tasks: TASKS, now: N }).fields,
    },
    {
      name: 'duration-estimate',
      prompt: () => buildDurationInvocation({ locale: 'zh-CN', title: '写周报', now: N }).user,
      fields: () => buildDurationInvocation({ locale: 'zh-CN', title: '写周报', now: N }).fields,
    },
  ];

  for (const chain of chains) {
    it(`🔴 ${chain.name}：user 第一行就是那**一个**生产者产出的锚点`, () => {
      expect(chain.prompt().startsWith(`${canonical}\n`), `${chain.name} 的锚点不是 canonical 那一行`).toBe(true);
    });

    it(`🔴 ${chain.name}：带了锚点就必须披露 today（披露里没有、请求里有 = 说谎）`, () => {
      expect(chain.fields(), `${chain.name} 没披露 today`).toContain('today');
    });
  }

  it('🔴 工具调用链路：系统提示带锚点 + 硬规则，且 today 在出境字段里', () => {
    expect(assistantSystemPrompt(N)).toContain(`${canonical}\n\n${CALENDAR_ANCHOR_RULES}`);
    expect(assistantEgressFields('read-only')).toContain('today');
  });

  it('🔴 阳性对照：上面那四条链路确实各有 4 条，分母不许悄悄缩水', () => {
    // 少一条链路 = 这条判据的作用面自己变小而没人红（§7 元规则二）。
    expect(chains.map((c) => c.name)).toEqual(['capture', 'breakdown', 'prioritize', 'duration-estimate']);
  });
});
