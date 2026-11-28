/**
 * `tools/shared.ts` 的解析 / 校验器 —— 判据面
 * ============================================
 *
 * 为什么单测这一层：这些是**扇入全部 65 个工具**的边界函数。
 * `clampListLimit` 被 focus / habit-log / note 等所有列表工具调用；
 * `parseCalendarDay` / `readListTasksDueArgs` 是 `list_tasks` 的日期闸门；
 * `parseTimeOfDay` 是 `set_reminder` 与宿主换算的两端格式契约。
 * 它们此前**没有任何直接单测**（只被工具层间接带上 happy path），
 * 而它们的边界恰恰是"错一点点就在用户按下确认之后才炸"的那类：
 *
 *   · limit 上界失效 = 一次读走无上界条数（上下文/出境量爆炸）；
 *   · 日期"看起来像日期"就收下 = 静默筛错一天（2 月 30 日被自动进位）；
 *   · 单端日期范围被当成开区间 = 契约无法回答"最多读走多少"；
 *   · `9:5` 被当成 09:05 = 工具收下了宿主算不出的时刻。
 *
 * 每条断言都对着一个"删掉/改错即红"的实现点（见各 it 末尾注）。
 */
import { describe, expect, it } from 'vitest';

import {
  calendarDaysBetween,
  clampListLimit,
  DEFAULT_LIST_LIMIT,
  maxToolsPerEntity,
  MAX_TOOLS_PER_ENTITY,
  parseCalendarDay,
  parseTimeOfDay,
  readListTasksDueArgs,
} from '../src/tools/shared.js';

describe('clampListLimit —— 列表出境条数上界', () => {
  it('普通正整数量纲不变；0 是合法下界（含 0）', () => {
    expect(clampListLimit(10)).toBe(10);
    expect(clampListLimit(0)).toBe(0);
  });

  it('🔴 超过 500 一律收到 500（删掉 Math.min 即红）', () => {
    expect(clampListLimit(9999)).toBe(500);
    expect(clampListLimit(501)).toBe(500);
    // 500 本身不截断（上界含端点）。
    expect(clampListLimit(500)).toBe(500);
  });

  it('🔴 小数向下取整（删掉 Math.floor 即红）', () => {
    expect(clampListLimit(3.9)).toBe(3);
    expect(clampListLimit(3.0001)).toBe(3);
  });

  it('🔴 负数 / NaN / Infinity / 非数字 一律回退默认值（放宽 typeof 或 isFinite 即红）', () => {
    expect(clampListLimit(-1)).toBe(DEFAULT_LIST_LIMIT);
    expect(clampListLimit(Number.NaN)).toBe(DEFAULT_LIST_LIMIT);
    expect(clampListLimit(Number.POSITIVE_INFINITY)).toBe(DEFAULT_LIST_LIMIT);
    expect(clampListLimit('10')).toBe(DEFAULT_LIST_LIMIT);
    expect(clampListLimit(undefined)).toBe(DEFAULT_LIST_LIMIT);
    expect(clampListLimit(null)).toBe(DEFAULT_LIST_LIMIT);
  });

  it('回退值可用第二参覆盖（删掉 fallback 参数透传即红）', () => {
    expect(clampListLimit(undefined, 7)).toBe(7);
    expect(clampListLimit(-5, 3)).toBe(3);
  });
});

describe('parseCalendarDay / calendarDaysBetween —— 日期存在性', () => {
  it('规范形 YYYY-MM-DD 且真实存在 ⇒ 三个字段', () => {
    expect(parseCalendarDay('2026-11-20')).toEqual({ year: 2026, month: 11, day: 20 });
  });

  it('🔴 越界的月/日必须拒（Date.UTC 会自动进位，回读校验是唯一防线）', () => {
    expect(parseCalendarDay('2026-13-01')).toBeUndefined(); // 月份越界
    expect(parseCalendarDay('2026-04-31')).toBeUndefined(); // 4 月只有 30 天
    expect(parseCalendarDay('2026-02-30')).toBeUndefined(); // 2 月无 30 日
  });

  it('🔴 闰年边界：2026 无 2-29，2024 有（把回读校验删成"看格式"即红）', () => {
    expect(parseCalendarDay('2026-02-29')).toBeUndefined();
    expect(parseCalendarDay('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
  });

  it('🔴 必须补零的四位年/两位月日（放宽正则即红）', () => {
    expect(parseCalendarDay('2026-1-5')).toBeUndefined();
    expect(parseCalendarDay('26-01-05')).toBeUndefined();
    expect(parseCalendarDay('2026/01/05')).toBeUndefined();
    expect(parseCalendarDay('2026-01-05T00:00')).toBeUndefined();
  });

  it('非字符串 / 空串 ⇒ undefined（删掉 typeof 守卫即红）', () => {
    expect(parseCalendarDay(undefined)).toBeUndefined();
    expect(parseCalendarDay(123)).toBeUndefined();
    expect(parseCalendarDay('')).toBeUndefined();
  });

  it('calendarDaysBetween：正/负/零、跨月、闰年都按自然日算', () => {
    const d = (s: string) => parseCalendarDay(s)!;
    expect(calendarDaysBetween(d('2026-11-20'), d('2026-11-25'))).toBe(5);
    expect(calendarDaysBetween(d('2026-11-25'), d('2026-11-20'))).toBe(-5);
    expect(calendarDaysBetween(d('2026-11-20'), d('2026-11-20'))).toBe(0);
    expect(calendarDaysBetween(d('2026-01-31'), d('2026-02-01'))).toBe(1);
    // 2024 是闰年：2-28 到 3-1 隔 2 天（中间有 2-29）。
    expect(calendarDaysBetween(d('2024-02-28'), d('2024-03-01'))).toBe(2);
  });
});

describe('readListTasksDueArgs —— list_tasks 日期闸门（fail-closed）', () => {
  it('三个都不给 = 不按日期筛（ok，空参数）——这是最常见形态，不是错误', () => {
    expect(readListTasksDueArgs({})).toEqual({ ok: true, args: {} });
  });

  it('只给 dueOn ⇒ 按那一天筛', () => {
    expect(readListTasksDueArgs({ dueOn: '2026-11-20' })).toEqual({
      ok: true,
      args: { dueOn: '2026-11-20' },
    });
  });

  it('🔴 跨度含两端：14 天通过、15 天拒绝（span 上限是本判据的核心，删掉 forward+1 即红）', () => {
    // 2026-11-01 .. 2026-11-14 含两端 = 14 天 → 允许。
    expect(readListTasksDueArgs({ dueFrom: '2026-11-01', dueTo: '2026-11-14' })).toEqual({
      ok: true,
      args: { dueFrom: '2026-11-01', dueTo: '2026-11-14' },
    });
    // 2026-11-01 .. 2026-11-15 含两端 = 15 天 → 拒绝，且消息报出"15"。
    const over = readListTasksDueArgs({ dueFrom: '2026-11-01', dueTo: '2026-11-15' });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.message).toContain('15');
  });

  it('🔴 只给一端（dueFrom 或 dueTo）⇒ 拒绝（半开区间 = 无上界；删掉这条即开区间放行）', () => {
    const onlyFrom = readListTasksDueArgs({ dueFrom: '2026-11-01' });
    expect(onlyFrom.ok).toBe(false);
    if (!onlyFrom.ok) expect(onlyFrom.message).toContain('dueTo');
    const onlyTo = readListTasksDueArgs({ dueTo: '2026-11-20' });
    expect(onlyTo.ok).toBe(false);
    if (!onlyTo.ok) expect(onlyTo.message).toContain('dueFrom');
  });

  it('🔴 dueOn 与区间互斥（同时给 ⇒ 拒绝）', () => {
    const both = readListTasksDueArgs({
      dueOn: '2026-11-20',
      dueFrom: '2026-11-01',
      dueTo: '2026-11-10',
    });
    expect(both.ok).toBe(false);
    if (!both.ok) {
      expect(both.message).toContain('dueOn');
      expect(both.message).toContain('dueFrom');
    }
  });

  it('🔴 dueFrom 晚于 dueTo ⇒ 拒绝（日期解析失败必须先于组合判断，否则误导方向）', () => {
    const rev = readListTasksDueArgs({ dueFrom: '2026-11-20', dueTo: '2026-11-01' });
    expect(rev.ok).toBe(false);
    if (!rev.ok) expect(rev.message).toContain('不能晚于');
  });

  it('🔴 非法的一天 ⇒ 拒绝，且消息点名是哪个键 + 收到的原始串（不是静默忽略）', () => {
    const badDay = readListTasksDueArgs({ dueOn: '2026-02-30' });
    expect(badDay.ok).toBe(false);
    if (!badDay.ok) {
      expect(badDay.message).toContain('dueOn');
      expect(badDay.message).toContain('2026-02-30');
    }
  });

  it('🔴 非字符串输入：消息只报类型，不把对象内部结构带出去', () => {
    const badType = readListTasksDueArgs({ dueFrom: { evil: 1 } });
    expect(badType.ok).toBe(false);
    if (!badType.ok) {
      // formatRejected 对非字符串只回类型名；不得出现对象键 "evil"。
      expect(badType.message).toContain('object');
      expect(badType.message).not.toContain('evil');
    }
  });
});

describe('parseTimeOfDay —— HH:MM 两端格式契约', () => {
  it('规范 HH:MM ⇒ 时与分', () => {
    expect(parseTimeOfDay('09:05')).toEqual({ hour: 9, minute: 5 });
    expect(parseTimeOfDay('00:00')).toEqual({ hour: 0, minute: 0 });
    expect(parseTimeOfDay('23:59')).toEqual({ hour: 23, minute: 59 });
  });

  it('首尾空白会被 trim', () => {
    expect(parseTimeOfDay(' 08:30 ')).toEqual({ hour: 8, minute: 30 });
  });

  it('🔴 必须两位补零：9:5 / 9:05 / 09:5 一律拒（放宽正则即红）', () => {
    expect(parseTimeOfDay('9:5')).toBeUndefined();
    expect(parseTimeOfDay('9:05')).toBeUndefined();
    expect(parseTimeOfDay('09:5')).toBeUndefined();
  });

  it('🔴 越界时刻拒：24:00 / 23:60（删掉 >23 / >59 判断即红）', () => {
    expect(parseTimeOfDay('24:00')).toBeUndefined();
    expect(parseTimeOfDay('23:60')).toBeUndefined();
    expect(parseTimeOfDay('99:99')).toBeUndefined();
  });

  it('非字符串 / 含多余字符 ⇒ undefined', () => {
    expect(parseTimeOfDay(undefined)).toBeUndefined();
    expect(parseTimeOfDay(930)).toBeUndefined();
    expect(parseTimeOfDay('09:05pm')).toBeUndefined();
    expect(parseTimeOfDay('09:05:00')).toBeUndefined();
  });
});

describe('maxToolsPerEntity —— 目录容量的单一份预算表', () => {
  it('已登记实体取覆盖值（TASK/PROJECT/NOTE）', () => {
    expect(maxToolsPerEntity('TASK')).toBe(25);
    expect(maxToolsPerEntity('PROJECT')).toBe(10);
    expect(maxToolsPerEntity('NOTE')).toBe(10);
  });

  it('未登记实体回落默认预算（删掉 ?? 兜底会返回 undefined ⇒ 预算判断变成 NaN 比较）', () => {
    expect(maxToolsPerEntity('HABIT')).toBe(MAX_TOOLS_PER_ENTITY);
    expect(maxToolsPerEntity('TOTALLY_UNKNOWN')).toBe(MAX_TOOLS_PER_ENTITY);
  });
});
