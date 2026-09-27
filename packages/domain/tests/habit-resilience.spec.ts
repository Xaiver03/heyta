/**
 * 习惯韧性（三指标 / 冻结 / 续接 / 重新开始）测试
 * ==================================================
 *
 * 这个模块的每一个分支都是"错了也不报错、只在用户断签那天暴露"的那种：
 * 断链算错会让人以为记录丢了，冻结算错会让人以为保险没用，
 * 而这两种症状**都不会抛异常**。所以这里按场景逐一钉住。
 *
 * 🔴 全部用**本地**日期字符串（`YYYY-MM-DD`），不造 `Date` 对象 ——
 * 测试跑在哪个时区是不确定的，用本地时刻构造才能与运行机器无关。
 * 日期选定后已核对过星期（2026-09-07 是周一）。
 */

import { describe, expect, it } from 'vitest';

import type { Habit, HabitLog } from '../src/entities.js';
import {
  FREEZE_MAX_HELD,
  computeHabitResilience,
  describeHabitResilience,
  findFreshStartOffer,
  findRepairOpportunity,
} from '../src/habit-resilience.js';

function makeHabit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    name: '喝水',
    target: 1,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function makeLog(date: string): HabitLog {
  return {
    id: `h1:${date}`,
    habitId: 'h1',
    date,
    createdAt: 0,
    updatedAt: 0,
  };
}

/** 从 `from` 开始的连续 `count` 天（含 from）。 */
function consecutive(from: string, count: number): string[] {
  const out: string[] = [];
  const base = new Date(`${from}T12:00:00`);
  for (let i = 0; i < count; i += 1) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    out.push(`${String(d.getFullYear())}-${m}-${day}`);
  }
  return out;
}

describe('computeHabitResilience', () => {
  it('从未打卡时全为 0，且不产生任何"曾经"的错觉', () => {
    const r = computeHabitResilience(makeHabit(), [], '2026-09-24');
    expect(r).toEqual({
      current: 0,
      longest: 0,
      total: 0,
      freezesHeld: 0,
      frozenDays: 0,
      frozenInCurrentRun: 0,
    });
  });

  it('连续打卡：current / longest / total 三者同步增长', () => {
    const dates = consecutive('2026-09-01', 3);
    const r = computeHabitResilience(makeHabit(), dates.map(makeLog), '2026-09-03');
    expect(r.current).toBe(3);
    expect(r.longest).toBe(3);
    expect(r.total).toBe(3);
    expect(r.lastDate).toBe('2026-09-03');
  });

  it('今天还没打卡时**不能**归零（上午打开界面不该看到 0 天）', () => {
    const dates = consecutive('2026-09-01', 3);
    const r = computeHabitResilience(makeHabit(), dates.map(makeLog), '2026-09-04');
    expect(r.current).toBe(3);
  });

  it('每连续 7 个计划日自动获得 1 个冻结', () => {
    const dates = consecutive('2026-09-01', 7);
    const r = computeHabitResilience(makeHabit(), dates.map(makeLog), '2026-09-07');
    expect(r.freezesHeld).toBe(1);
  });

  it('冻结有上限，攒不成免打卡通行证', () => {
    const dates = consecutive('2026-09-01', 28);
    const r = computeHabitResilience(makeHabit(), dates.map(makeLog), '2026-09-28');
    expect(r.freezesHeld).toBe(FREEZE_MAX_HELD);
  });

  it('断一天被冻结吸收：连续不断，冻结减少（但总量与最长不动）', () => {
    const dates = consecutive('2026-09-01', 7);
    const r = computeHabitResilience(makeHabit(), dates.map(makeLog), '2026-09-09');
    // 2026-09-08 缺卡，被 09-07 拿到的冻结吸收
    expect(r.current).toBe(7);
    expect(r.frozenDays).toBe(1);
    // 这段连续里恰好只有 1 天靠冻结 —— 它是**数出来**的，
    // 而不是拿 `current - streak.current` 减出来的（那个减法会得到 7）。
    expect(r.frozenInCurrentRun).toBe(1);
    expect(r.lastFrozenDate).toBe('2026-09-08');
    expect(r.freezesHeld).toBe(0);
    expect(r.longest).toBe(7);
    expect(r.total).toBe(7);
  });

  it('冻结耗尽后再连续断三天：current 归零，但 longest / total 只增不减', () => {
    const dates = consecutive('2026-09-01', 20);
    const r = computeHabitResilience(makeHabit(), dates.map(makeLog), '2026-09-24');
    expect(r.current).toBe(0);
    expect(r.frozenDays).toBe(2);
    // 这段连续已经断了，那两天冻结不属于"眼下这段" ——
    // 累计口径是 2，当前口径必须回到 0（两个口径不能混）。
    expect(r.frozenInCurrentRun).toBe(0);
    expect(r.freezesHeld).toBe(0);
    // 🔴 这两条是"中断不等于失去"的核心断言
    expect(r.longest).toBe(20);
    expect(r.total).toBe(20);
    expect(r.lastDate).toBe('2026-09-20');
  });

  it('每周一三五的习惯：非计划日的空缺不打断', () => {
    const habit = makeHabit({ frequency: { type: 'weekly', daysOfWeek: [1, 3, 5] } });
    const logs = ['2026-09-07', '2026-09-09', '2026-09-11', '2026-09-14', '2026-09-16', '2026-09-18'].map(
      makeLog,
    );
    const r = computeHabitResilience(habit, logs, '2026-09-20');
    expect(r.current).toBe(6);
    expect(r.longest).toBe(6);
  });

  it('每周一三五的习惯：真的漏掉一个计划日才断', () => {
    const habit = makeHabit({ frequency: { type: 'weekly', daysOfWeek: [1, 3, 5] } });
    // 漏掉 09-16（周三）
    const logs = ['2026-09-07', '2026-09-09', '2026-09-11', '2026-09-14', '2026-09-18'].map(makeLog);
    const r = computeHabitResilience(habit, logs, '2026-09-20');
    expect(r.longest).toBe(4);
    expect(r.current).toBe(1);
  });

  it('软删除的打卡记录不计入（撤销就是"没发生"）', () => {
    const dates = consecutive('2026-09-01', 3);
    const logs = dates.map(makeLog);
    logs[2]!.deletedAt = 1;
    const r = computeHabitResilience(makeHabit(), logs, '2026-09-03');
    expect(r.total).toBe(2);
    expect(r.current).toBe(2);
  });

  it('未达成目标值的打卡不算达成（8 杯水只喝了 3 杯）', () => {
    const habit = makeHabit({ target: 8, unit: '杯' });
    const logs = consecutive('2026-09-01', 2).map((d) => ({ ...makeLog(d), value: 8 }));
    // 09-03 只喝了 3 杯
    logs.push({ ...makeLog('2026-09-03'), value: 3 });
    const r = computeHabitResilience(habit, logs, '2026-09-03');
    expect(r.total).toBe(2);
    expect(r.current).toBe(2);
  });
});

describe('findRepairOpportunity', () => {
  it('冻结耗尽、昨天断链时给出续接，并预告补回来之后的连续天数', () => {
    const dates = consecutive('2026-09-01', 20);
    const r = computeHabitResilience(makeHabit(), dates.map(makeLog), '2026-09-24');
    const repair = findRepairOpportunity(makeHabit(), dates.map(makeLog), '2026-09-24', r);
    expect(repair).toEqual({ date: '2026-09-23', streakIfRepaired: 21 });
  });

  it('冻结已经替用户兜住昨天时**不**提示续接（不制造不存在的焦虑）', () => {
    const dates = consecutive('2026-09-01', 7);
    const r = computeHabitResilience(makeHabit(), dates.map(makeLog), '2026-09-09');
    expect(r.current).toBe(7);
    expect(findRepairOpportunity(makeHabit(), dates.map(makeLog), '2026-09-09', r)).toBeUndefined();
  });

  it('断链发生在很久以前时不提供续接（那种情况属于"重新开始"）', () => {
    const dates = consecutive('2026-09-01', 3);
    // 09-20 之后一直没打卡，今天 09-24：补昨天只能得到"连续 1 天"
    expect(
      findRepairOpportunity(makeHabit(), dates.map(makeLog), '2026-09-24'),
    ).toBeUndefined();
  });

  it('从未打卡过就谈不上"补回来"', () => {
    expect(findRepairOpportunity(makeHabit(), [], '2026-09-24')).toBeUndefined();
  });

  it('昨天本来就不该打卡时不提示', () => {
    const habit = makeHabit({ frequency: { type: 'weekly', daysOfWeek: [1] } });
    const logs = ['2026-09-07', '2026-09-14'].map(makeLog);
    // 今天 2026-09-23（周三）：昨天是周二，本来就不该打卡 —— 没有缺口
    expect(findRepairOpportunity(habit, logs, '2026-09-23')).toBeUndefined();
  });

  it('该打卡的那一天刚好漏了，就会提示（上一条的对照，证明判据是"计划日"）', () => {
    const habit = makeHabit({ frequency: { type: 'weekly', daysOfWeek: [1] } });
    const logs = ['2026-09-07', '2026-09-14'].map(makeLog);
    // 今天 2026-09-22（周二）：昨天是周一，本该打卡却没打
    expect(findRepairOpportunity(habit, logs, '2026-09-22')).toEqual({
      date: '2026-09-21',
      streakIfRepaired: 3,
    });
  });
});

describe('findFreshStartOffer', () => {
  it('中断超过 7 天时提供重新开始，并明确保留 longest / total', () => {
    const dates = consecutive('2026-09-01', 20);
    const r = computeHabitResilience(makeHabit(), dates.map(makeLog), '2026-10-01');
    expect(findFreshStartOffer(r, '2026-10-01')).toEqual({
      daysSinceLast: 11,
      longest: 20,
      total: 20,
    });
  });

  it('中断时间还不够长时不打扰用户', () => {
    const dates = consecutive('2026-09-01', 20);
    const r = computeHabitResilience(makeHabit(), dates.map(makeLog), '2026-09-24');
    expect(findFreshStartOffer(r, '2026-09-24')).toBeUndefined();
  });

  it('从未打卡过不算"重新开始"（那是"开始"）', () => {
    const r = computeHabitResilience(makeHabit(), [], '2026-10-01');
    expect(findFreshStartOffer(r, '2026-10-01')).toBeUndefined();
  });
});

describe('describeHabitResilience', () => {
  it('一次算齐韧性 / 续接 / 重新开始，三者互斥不重复提示', () => {
    const dates = consecutive('2026-09-01', 20);
    const view = describeHabitResilience(makeHabit(), dates.map(makeLog), '2026-09-24');
    expect(view.resilience.current).toBe(0);
    expect(view.repair).toBeDefined();
    // 断签 4 天：还不到"重新开始"的门槛，所以两者不会同时出现
    expect(view.freshStart).toBeUndefined();
  });

  it('从未打卡时不产生任何可操作提示', () => {
    const view = describeHabitResilience(makeHabit(), [], '2026-09-24');
    expect(view.repair).toBeUndefined();
    expect(view.freshStart).toBeUndefined();
  });
});