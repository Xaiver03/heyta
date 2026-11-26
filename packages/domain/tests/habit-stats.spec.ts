/**
 * 习惯统计读侧（覆盖图谱 #46 / #48）：`habitCheckInRecords` /
 * `habitWeeklyRateSeries` / `habitStreakSeries` / `countCheckInsOn` 的口径判据。
 *
 * 🔴 期望值来自手算夹具（AGENTS §8 第 3 条"测试要能失败"），每个数旁边写清算法。
 * 这些函数是「统计怎么算」的唯一实现，所以这里的断言必须能红：删墓碑过滤、
 * 把 value 缺省从 `target` 改成 0、把分母从计划日改成自然日、把连续采样改成
 * 按天……都会让下面的用例红。
 */

import { describe, expect, it } from 'vitest';

import type { Habit, HabitLog } from '../src/entities.js';
import {
  countCheckInsOn,
  habitCheckInRecords,
  habitStreakSeries,
  habitWeeklyRateSeries,
} from '../src/habit-stats.js';

/** 本地零点的 epoch ms。 */
function at(y: number, m: number, d: number): number {
  return new Date(y, m - 1, d).getTime();
}

function habit(over: Partial<Habit> = {}): Habit {
  // 创建在 2024-01-01：早于下面所有夹具窗口，故"创建日下界"默认不参与比较。
  return { id: 'h1', name: '阅读', createdAt: at(2024, 1, 1), updatedAt: 0, ...over };
}

function log(date: string, over: Partial<HabitLog> = {}): HabitLog {
  return { id: `h1:${date}`, habitId: 'h1', date, createdAt: 0, updatedAt: 0, ...over };
}

describe('habitCheckInRecords（#46 打卡记录清单）', () => {
  it('只留本习惯、未删除的记录，按日期倒序；量缺省按 target', () => {
    const h = habit({ target: 2 });
    const records = habitCheckInRecords(h, [
      log('2024-06-01'), // 无 value ⇒ 缺省 = target = 2
      log('2024-06-03', { value: 5 }),
      log('2024-06-02', { deletedAt: 1 }), // 墓碑：撤销了，不算发生过
      { id: 'other', habitId: 'h2', date: '2024-06-09', createdAt: 0, updatedAt: 0 }, // 别的习惯
    ]);
    expect(records.map((r) => r.date)).toEqual(['2024-06-03', '2024-06-01']);
    expect(records[0]?.value).toBe(5);
    // 🔴 这条钉住 `habitLogValue` 的缺省：写成 `log.value ?? 0` 时这里会变成 0。
    expect(records[1]?.value).toBe(2);
    // 达成判据：2 >= 2 ⇒ 达成；5 >= 2 ⇒ 达成。
    expect(records.every((r) => r.achieved)).toBe(true);
  });

  it('at（时间戳）取记录的 createdAt；同一天多条按 createdAt 倒序', () => {
    const h = habit();
    const records = habitCheckInRecords(h, [
      log('2024-06-01', { createdAt: at(2024, 6, 1) }),
      log('2024-06-01', { createdAt: at(2024, 6, 2) }), // 后打的，应排在前
    ]);
    expect(records[0]?.at).toBe(at(2024, 6, 2));
    expect(records[1]?.at).toBe(at(2024, 6, 1));
  });

  it('atMost 目标：值高于 target 不算达成（isAchieved 同口径）', () => {
    const h = habit({ target: 1, goalType: 'atMost' });
    const [rec] = habitCheckInRecords(h, [log('2024-06-01', { value: 3 })]);
    expect(rec?.achieved).toBe(false);
  });
});

describe('countCheckInsOn（#16 今日打卡）', () => {
  it('只数同一天、未删除的；同日多条算多条', () => {
    const logs = [
      log('2024-06-10'),
      log('2024-06-10'),
      log('2024-06-10', { deletedAt: 1 }),
      log('2024-06-09'),
    ];
    expect(countCheckInsOn(logs, '2024-06-10')).toBe(2);
    expect(countCheckInsOn(logs, '2024-06-11')).toBe(0);
  });
});

describe('habitWeeklyRateSeries（#48 完成率柱状图）', () => {
  it('每天习惯、最后一个 7 天窗口达成 3 天 ⇒ rate = 3/7', () => {
    const h = habit({ frequency: { type: 'daily' } });
    const today = '2024-06-14';
    // 最后一格 = [2024-06-08, 2024-06-14]，共 7 个计划日；
    // 达成 06-10 / 06-12 / 06-14 三天 ⇒ 3/7。
    const logs = [log('2024-06-10'), log('2024-06-12'), log('2024-06-14')];
    const series = habitWeeklyRateSeries(h, logs, today, 1);
    expect(series).toHaveLength(1);
    expect(series[0]?.scheduledDays).toBe(7);
    expect(series[0]?.achievedDays).toBe(3);
    expect(series[0]?.rate).toBeCloseTo(3 / 7, 10);
  });

  it('分母只数已到期的计划日：一周 3 次（周三/五/日），窗口内首个计划日之前不算', () => {
    // 频率 = 周三(3)/周五(5)/周日(7)。today = 2024-06-14(周五)。
    // 最后一格 [2024-06-08(周六) .. 2024-06-14(周五)]：
    //   计划日 = 06-09(周日)、06-12(周三)、06-14(周五) —— 恰好 3 天。
    // 若分母被写成"7 个自然日"，这里会是 7 —— 用例就红。
    const h = habit({ frequency: { type: 'weekly', daysOfWeek: [3, 5, 7] } });
    const series = habitWeeklyRateSeries(h, [log('2024-06-12')], '2024-06-14', 1);
    expect(series[0]?.scheduledDays).toBe(3);
    expect(series[0]?.achievedDays).toBe(1);
    expect(series[0]?.rate).toBeCloseTo(1 / 3, 10);
  });

  it('窗口里一个计划日都还没到期（habit 创建在未来）⇒ scheduledDays=0、rate=0，绝不 NaN', () => {
    const h = habit({ createdAt: at(2030, 1, 1) });
    const series = habitWeeklyRateSeries(h, [], '2024-06-14', 2);
    expect(series.every((b) => b.scheduledDays === 0 && b.rate === 0)).toBe(true);
  });

  it('序列旧 → 新：最后一格的 end 就是 today', () => {
    const h = habit({ frequency: { type: 'daily' } });
    const series = habitWeeklyRateSeries(h, [], '2024-06-14', 3);
    expect(series).toHaveLength(3);
    expect(series[2]?.end).toBe('2024-06-14');
    expect((series[0]?.start ?? '') < (series[1]?.start ?? '')).toBe(true);
  });
});

describe('habitStreakSeries（#48 连续天数折线图）', () => {
  it('按周采样：连续 5 天每天打卡，在最后一个采样日 current=5', () => {
    const h = habit({ frequency: { type: 'daily' } });
    const logs = ['10', '11', '12', '13', '14'].map((d) => log(`2024-06-${d}`));
    const series = habitStreakSeries(h, logs, '2024-06-14', 1);
    expect(series).toHaveLength(1);
    expect(series[0]?.date).toBe('2024-06-14');
    expect(series[0]?.streak).toBe(5);
  });

  it('中间断一天 ⇒ 采样日只数断点之后的连续天数', () => {
    const h = habit({ frequency: { type: 'daily' } });
    // 06-10 打、06-11 没打、06-12/13/14 打 ⇒ 到 06-14 连续 3 天。
    const logs = ['10', '12', '13', '14'].map((d) => log(`2024-06-${d}`));
    const series = habitStreakSeries(h, logs, '2024-06-14', 1);
    expect(series[0]?.streak).toBe(3);
  });
});
