/**
 * 习惯统计的读侧（工单 W8）：`computeHabitPeriodStats` 的口径判据
 * ================================================================
 *
 * 🔴 **期望值全部来自手算夹具**（AGENTS §8 第 3 条的"测试要能失败"落到这里），
 * 每一个数旁边都写了手算过程。这些判据的**语义**不是本文件发明的：
 * 四条口径（A 完成率分母 / B 自然月 / C 天 vs 次 / D 量的显示）由工单 W8
 * 拍板，证据与一手对照在
 * [`docs/research/detail-pane-alignment-and-spaced-review.md`](../../docs/research/detail-pane-alignment-and-spaced-review.md)
 * 的 C1b-Q2 一节；"分母只数**已到期**计划日"那一条是**本线 2026-10-05 拍的裁决**（代价与推翻路径见工单 §8.119）
 * （外部没有一手对照），实现注释里写明了它承重的那三个理由。
 *
 * 判据与变异臂的对应（载体 `research/tools/mutation-rigs/mutate-habit-period-stats.mjs`）：
 *   · 臂 1（分母改成 `daysInMonth`）⇒ **6 条**红：T1、T2、T3、T6、T7、T8
 *     （凡断言"分母是安排量/到期量"的都躲不掉）；
 *   · 臂 2（摘掉"已到期"上界、按整月数计划日）⇒ **5 条**红：T1、T2、T3、T6、T7。
 *     ✅ **T8 特意把 `today` 放在月末**，到期量==整月量，这条臂下它保持绿 ——
 *     这正是"两臂各红各的判据"而不是"一锅全红"的证据；
 *   · 臂 3（求和从 `habitLogValue` 换成 `log.value ?? 0`）⇒ 恰好 **T5** 红（1 条）；
 *   · 臂 4（摘掉墓碑过滤）⇒ 恰好 **T4b** 红（1 条）。
 *
 * ⚠️ T4/T4b/T5/T9 **不断言 `scheduledDays`/`rate`** —— 这不是疏忽：
 * 让"量"的判据与"分母"的判据分居互不相扰的用例，臂 3/4 才会只红在
 * 它们各自钉的那一条上（红集一混，"这条判据钉的是哪件事"就答不出了）。
 */

import { describe, expect, it } from 'vitest';

import type { Habit, HabitLog } from '../src/entities.js';
import { computeHabitPeriodStats } from '../src/habit-streak.js';

/** 本地零点的 epoch ms（`createdAt` 用它换算，避免 UTC 偏移把下界挪一天）。 */
function at(y: number, m: number, d: number): number {
  return new Date(y, m - 1, d).getTime();
}

/**
 * 默认创建在 **2024-01-01**：早于下面所有夹具月，
 * 于是"创建日下界"不参与比较 —— 唯一例外是 T3（它就是测下界的）。
 */
function habit(over: Partial<Habit> = {}): Habit {
  return { id: 'h1', name: '阅读', createdAt: at(2024, 1, 1), updatedAt: 0, ...over };
}

function log(date: string, over: Partial<HabitLog> = {}): HabitLog {
  return { id: `h1:${date}`, habitId: 'h1', date, createdAt: 0, updatedAt: 0, ...over };
}

describe('裁决 A：完成率的分母是"已到期计划日"，不是自然日数', () => {
  it('T1 一周 3 次（周三/五/日）在 2024-06 跑到 6-21：9 个到期计划日全部达成 ⇒ 9/9、率 1', () => {
    // 手算：2024-06 的 ISO 周三是 6/2、周五是 6/5…逐日列出 6/1..6/21 里
    // 落在 {三,五,日} 的日子：2,5,7,9,12,14,16,19,21 —— **恰好 9 天**。
    // （若分母被写成"自然日"，这里是 21 天；被写成"整月"，是 30 天。）
    const days = ['02', '05', '07', '09', '12', '14', '16', '19', '21'];
    const h = habit({ frequency: { type: 'weekly', daysOfWeek: [3, 5, 7] } });
    const stats = computeHabitPeriodStats(
      h,
      days.map((d) => log(`2024-06-${d}`)),
      '2024-06-21',
    );
    expect(stats.monthKey).toBe('2024-06');
    expect(stats.scheduledDays).toBe(9);
    expect(stats.achievedDays).toBe(9);
    // 🔴 "跑满就是 100%"：这条钉死分母**不是** 21 或 30。
    expect(stats.rate).toBe(1);
  });

  it('T2 同一个习惯、同一个 2024-07，today 在月中 vs 月末：分母只数到期那几天', () => {
    // daily 习惯，7/1..7/5 各达成一次。
    const h = habit({ frequency: { type: 'daily' } });
    const logs = ['01', '02', '03', '04', '05'].map((d) => log(`2024-07-${d}`));

    const mid = computeHabitPeriodStats(h, logs, '2024-07-08');
    // 手算：到期计划日 = 7/1..7/8 共 **8** 天；达成 5 天 ⇒ 5/8。
    expect(mid.scheduledDays).toBe(8);
    expect(mid.achievedDays).toBe(5);
    expect(mid.rate).toBe(5 / 8);

    const end = computeHabitPeriodStats(h, logs, '2024-07-31');
    // 手算：全月计划日 = 31；达成仍是 5 ⇒ 5/31。
    expect(end.scheduledDays).toBe(31);
    expect(end.achievedDays).toBe(5);
    expect(end.rate).toBe(5 / 31);

    // 🔴 裁决的那句话："用全月当分母会得到一个只有到月末才等于真实值、
    // 每天自己往下掉的数"。这里把它钉成不等式：月中读到的率**不该**被
    // 未到期天数稀释。
    expect(mid.rate).toBeGreaterThan(end.rate);
  });

  it('T3 创建日在月中：该月创建日之前的计划日不进分母', () => {
    // 手算：习惯创建于 2024-07-10，today=7/15 ⇒ 下界 = max(7/1, 7/10) = 7/10，
    // 到期计划日 = 7/10..7/15 共 **6** 天（不是 15，也不是 31）。
    const h = habit({ createdAt: at(2024, 7, 10), frequency: { type: 'daily' } });
    const stats = computeHabitPeriodStats(h, [], '2024-07-15');
    expect(stats.scheduledDays).toBe(6);
  });

  it('T6 该月还没有任何计划日到期：分母 0、率 0、绝不 NaN', () => {
    // 手算：weekly 只在周日，today=2024-10-01 是**周二**（已用原生 Date 核对），
    // 10 月第一个周日是 10/6 > today ⇒ 到期计划日 = **0**。
    const h = habit({ frequency: { type: 'weekly', daysOfWeek: [7] } });
    const stats = computeHabitPeriodStats(h, [], '2024-10-01');
    expect(stats.scheduledDays).toBe(0);
    // 🔴 NaN 守卫：0 分母下 `0/0` 会一路传染到界面上的 "NaN%"。
    expect(stats.rate).toBe(0);
    expect(Number.isFinite(stats.rate)).toBe(true);
  });

  it('T7 二月/闰年：分母是该月的真实天数，不是"名字写月、算式用 30"', () => {
    // 手算：2024 是闰年 ⇒ 2 月 29 天；2025 平年 ⇒ 28 天。daily 习惯、
    // today 取该月末（`monthKey` 就落在二月），分母必须跟着日历走。
    const h = habit({ frequency: { type: 'daily' } });
    expect(computeHabitPeriodStats(h, [], '2024-02-29').scheduledDays).toBe(29);
    expect(computeHabitPeriodStats(h, [], '2025-02-28').scheduledDays).toBe(28);
    // 再加一刀月中：2/15 时到期 15 天 —— 挡"整月化"从侧面溜回来。
    expect(computeHabitPeriodStats(h, [], '2024-02-15').scheduledDays).toBe(15);
  });

  it('T8 interval{everyNDays}：2024-04 每 3 天的手算分母是 10，不是 30', () => {
    // 手算：`isScheduledOn` 对 interval 的判据是
    // `diffDays('1970-01-01', date) % 3 === 0`。逐日数 2024-04-01..04-30：
    // 4/1, 4/4, 4/7, 4/10, 4/13, 4/16, 4/19, 4/22, 4/25, 4/28 —— **10 天**
    // （已用独立脚本对过一次，见本单执行记录；这里 4/30 恰是月末，
    // 所以"摘掉到期上界"的臂 2 对本条**不红** —— 红集分臂以文件头为准。）
    const h = habit({ frequency: { type: 'interval', everyNDays: 3 } });
    const stats = computeHabitPeriodStats(h, [], '2024-04-30');
    expect(stats.monthKey).toBe('2024-04');
    expect(stats.scheduledDays).toBe(10);
  });
});

describe('裁决 C：天 = 连续性单位；次/量 = Σ habitLogValue，两条腿各归各', () => {
  it('T4 一天 value=3（目标 5）：天数 +0、量 +3；另一天 value=5：两格各 +1 与 +5', () => {
    // 手算：7/8 记 3（未达标）+ 7/9 记 5（达标），target=5。
    // ⇒ achievedDays = 1（那天不记分数天），monthValue = 3 + 5 = 8（量照记）。
    const h = habit({ target: 5, frequency: { type: 'daily' } });
    // 腿 0：**只有**那条未达标的一天 ⇒ 天数 +0、量 +3（不记分数天）。
    const onlyPartial = computeHabitPeriodStats(h, [log('2024-07-08', { value: 3 })], '2024-07-10');
    expect(onlyPartial.achievedDays).toBe(0);
    expect(onlyPartial.monthValue).toBe(3);
    // 腿 1：同一条改成 value=5 ⇒ 两格各 +1 与 +5。
    const full = computeHabitPeriodStats(h, [log('2024-07-08', { value: 5 })], '2024-07-10');
    expect(full.achievedDays).toBe(1);
    expect(full.monthValue).toBe(5);
    // 两天并存：天数只认达标的那天，量把两天都算上。
    const stats = computeHabitPeriodStats(
      h,
      [log('2024-07-08', { value: 3 }), log('2024-07-09', { value: 5 })],
      '2024-07-10',
    );
    expect(stats.achievedDays).toBe(1);
    expect(stats.monthValue).toBe(8);
    expect(stats.totalValue).toBe(8);
    expect(stats.totalAchievedDays).toBe(1);
  });

  it('T5 缺 value 的记录按 habitLogValue 的缺省（target）求和 —— 不许自己写 ?? 0', () => {
    // 手算：与 T4 同形，只把"达标那条"的 value 省略 ——
    // W6 的唯一算法规定：存在的 log 没写 value ⇒ 按 `habit.target ?? 1`。
    // 求和路径若自己写 `log.value ?? 0`，monthValue 会读成 3 + 0 = 3。
    const h = habit({ target: 5, frequency: { type: 'daily' } });
    const stats = computeHabitPeriodStats(
      h,
      [log('2024-07-08', { value: 3 }), log('2024-07-09' /* 不写 value */)],
      '2024-07-10',
    );
    expect(stats.monthValue).toBe(8);
    expect(stats.totalValue).toBe(8);
    // 达成判定本来就走 `isAchieved`（里面是同一个缺省），两条腿必须同涨同落。
    expect(stats.achievedDays).toBe(1);
    expect(stats.totalAchievedDays).toBe(1);
  });
});

describe('求和路径的收窄与滤墓碑（habitGrowth 那层不滤，这里必须自己滤）', () => {
  it('T4b 已删除的打卡：量与天数在四个出口一处都不许出现', () => {
    // 手算：7/3 活着（记满 5，达成）；7/4 是**达成后被删**的（记满 5），
    // 7/5 是**未达标后被删**的（记 4）。不滤的话：
    //   achievedDays 变 2、monthValue 变 5+5+4=14、totalValue 同、totalAchievedDays 变 2。
    const h = habit({ target: 5, frequency: { type: 'daily' } });
    const stats = computeHabitPeriodStats(
      h,
      [
        log('2024-07-03', { value: 5 }),
        log('2024-07-04', { value: 5, deletedAt: at(2024, 7, 6) }),
        log('2024-07-05', { value: 4, deletedAt: at(2024, 7, 6) }),
      ],
      '2024-07-10',
    );
    expect(stats.achievedDays).toBe(1);
    expect(stats.monthValue).toBe(5);
    expect(stats.totalValue).toBe(5);
    expect(stats.totalAchievedDays).toBe(1);
  });

  it('T9 传"未过滤的全集"也行：按 habitId 收窄 + 跨月只进总量', () => {
    // 手算：h1 的 6/30（记满 5）是**上个月**的达成日 —— 进 totalValue/totalAchievedDays，
    // 不进 monthValue/achievedDays；h1 的 7/1 记 3（未达标）、7/2 记满 5；
    // h2 的 7/3 记 9 —— 整条都不该看见（它是**另一习惯**的量）。
    // ⇒ monthValue = 3+5 = 8；totalValue = 5+3+5 = 13；
    //   achievedDays = 1；totalAchievedDays = 2。
    //   （本条不断言 scheduledDays/rate —— 见文件头"分臂红集"那条纪律。）
    const h = habit({ target: 5, frequency: { type: 'daily' } });
    const stats = computeHabitPeriodStats(
      h,
      [
        log('2024-06-30', { value: 5 }),
        log('2024-07-01', { value: 3 }),
        log('2024-07-02', { value: 5 }),
        log('2024-07-03', { habitId: 'h2', value: 9 }),
      ],
      '2024-07-05',
    );
    expect(stats.monthValue).toBe(8);
    expect(stats.totalValue).toBe(13);
    expect(stats.achievedDays).toBe(1);
    expect(stats.totalAchievedDays).toBe(2);
  });
});

describe('totalAchievedDays 与 resilience.total 的同一口径', () => {
  it('T10 无墓碑时 totalAchievedDays = 达成日志的去重日期数（跨月不跨 key 都算）', () => {
    // 手算：三条达成（7/1、7/2、8/1）。`monthKey` 是 2024-07 ⇒
    // achievedDays = 2（只数月内），totalAchievedDays = 3（8 月那条进总量）。
    const h = habit({ target: 5, frequency: { type: 'daily' } });
    const stats = computeHabitPeriodStats(
      h,
      [
        log('2024-07-01', { value: 5 }),
        log('2024-07-02', { value: 5 }),
        log('2024-08-01', { value: 5 }),
      ],
      '2024-07-05',
    );
    expect(stats.achievedDays).toBe(2);
    expect(stats.totalAchievedDays).toBe(3);
    // 与 `computeHabitResilience().total` 的等式在 app-host 侧钉
    // （`packages/app-host/tests/motivation.spec.ts` 的 W8 组）——
    // 那里拿到的是两个函数的产出，比这里自比自更接近真实消费形状。
  });
});
