/**
 * 🔴 实验：偏好层真的能预测吗？还是我在编？
 * ============================================
 *
 * ## 为什么必须有这个文件
 *
 * 「AI 记住用户偏好」听起来天生正确，所以**最容易被做成自证**：
 * 写个统计函数、拿同一批数据算出来、再拿同一批数据验证 —— 当然准。
 *
 * 这个文件用上一轮 `recall-experiment.spec.ts` 的同一套纪律来防这件事。
 *
 * ## 协议：留出法（train 80% / test 20%）
 *
 * 用**前 80%** 的历史推断偏好，拿它去预测**后 20%** 的真实行为，
 * 与**「不用偏好」的基线**比 MAE。基线就是 AI 在"不认识你"时会做的事：
 *
 * | 偏好 | 基线（不认识你） | 偏好预测 |
 * |---|---|---|
 * | P1 估算偏差 | 按你填的计划时长（×1.0） | 按你历史的中位倍数 |
 * | P2 深度工作时段 | 猜中午 12 点 | 猜你历史的高峰窗口中点 |
 * | P3 提前量 | 猜踩点（0 天） | 猜你历史的中位提前量 |
 * | P4 粒度 | 通用默认 3 项 | 猜你历史的中位数 |
 * | P5 表达习惯 | 通用默认 10 字 | 猜你历史的中位长度 |
 *
 * ## 🔴 两条数据条件 —— 第二条才是重点
 *
 * | 条件 | 数据 | 期望 |
 * |---|---|---|
 * | **有信号** | 植入了真实偏好 + 噪声 | 必须检出，且**预测优于基线** |
 * | 🔴 **纯噪声** | 完全随机，**没有任何偏好** | **必须不产出偏好**（`withheld`） |
 *
 * **纯噪声那一列才是防"编偏好"的守门测试。** 一个会把随机数据
 * 说成"你上午最高效"的系统，比没有偏好层更糟 —— 它会持续误导用户。
 *
 * ## ⚠️ 这份实验能证明什么、不能证明什么（必须说清）
 *
 * - ✅ **能证明**：估计器是有效的（有信号时抓得到、且真的预测更准），
 *   且在无信号时**不会编**。
 * - ❌ **不能证明**：真实 heyta 用户身上存在这些偏好。这里用的是
 *   **合成数据**，因为本仓库现在没有真实用户数据。
 *   所以本实验验证的是**方法**，不是**普遍性**。
 */

import { describe, expect, it } from 'vitest';
import {
  inferPreferences,
  MIN_CONFIDENCE,
  type PreferenceInput,
  type PreferenceTask,
  type PreferenceFocusSession,
} from '../src/preferences.js';

// ─────────────────────────────────────────────────────────────
// 确定性伪随机 —— 不许用 Math.random，否则实验不可复现
// ─────────────────────────────────────────────────────────────

/** mulberry32：小而确定的 PRNG。 */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 正态分布（Box–Muller），用给定 rng。 */
function gauss(rng: () => number, mean: number, sd: number): number {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;
const NOW = Date.UTC(2026, 8, 26);
const TZ = 480; // 东八区

/**
 * 🔴 **本地午夜的 UTC 时刻。**
 *
 * 第一次我直接用 `NOW`（UTC 午夜）当基准再 `+ hour*HOUR`，
 * 结果"植入 09:00"实际是**本地 17:00**，推断出 16:00–19:00 ——
 * 看着像实现错了，其实是我 fixture 把 UTC 小时当成了本地小时。
 * 实验能暴露这种错，正是它存在的意义。
 */
const LOCAL_MIDNIGHT = NOW - TZ * 60_000;

const SESSION_COUNT = 120;
const TASK_COUNT = 120;
const TRAIN_RATIO = 0.8;

// ─────────────────────────────────────────────────────────────
// 数据生成
// ─────────────────────────────────────────────────────────────

function makeSessions(rng: () => number, bias: number | null, workHour: number | null): PreferenceFocusSession[] {
  const out: PreferenceFocusSession[] = [];
  for (let i = 0; i < SESSION_COUNT; i += 1) {
    const planned = 30 * MINUTE;
    // bias === null → 纯噪声：比值在 [0.5, 2.5] 均匀乱走，没有任何固定倾向
    const ratio = bias === null ? 0.5 + rng() * 2 : Math.max(0.1, gauss(rng, bias, 0.15));
    const actual = Math.round(planned * ratio);

    // workHour === null → 纯噪声：一天 24 小时均匀分布
    const hour = workHour === null ? Math.floor(rng() * 24) : Math.min(23, Math.max(0, Math.round(gauss(rng, workHour, 0.8))));
    const startedAt = LOCAL_MIDNIGHT - (SESSION_COUNT - i) * DAY + hour * HOUR;

    out.push({ kind: 'work', plannedMs: planned, actualMs: actual, startedAt });
  }
  return out;
}

function makeTasks(rng: () => number, leadDays: number | null, items: number | null, titleLen: number | null): PreferenceTask[] {
  const out: PreferenceTask[] = [];
  for (let i = 0; i < TASK_COUNT; i += 1) {
    const created = NOW - (TASK_COUNT - i) * DAY;
    const dueDate = created + 10 * DAY;

    // leadDays === null → 纯噪声：提前量均匀落在 [-14, 14]
    const lead = leadDays === null ? -14 + rng() * 28 : gauss(rng, leadDays, 0.5);
    const completedAt = dueDate - lead * DAY;

    // items === null → 纯噪声：清单项数均匀 1–10
    const n = items === null ? 1 + Math.floor(rng() * 10) : Math.max(0, Math.round(gauss(rng, items, 0.7)));
    const note = n === 0 ? undefined : Array.from({ length: n }, (_, k) => `- [ ] 步骤 ${k + 1}`).join('\n');

    // titleLen === null → 纯噪声：长度均匀 2–40
    const len = titleLen === null ? 2 + Math.floor(rng() * 39) : Math.max(2, Math.round(gauss(rng, titleLen, 2)));
    const title = '任'.repeat(len);

    out.push({ id: `t${i}`, title, note, dueDate, completedAt, createdAt: created });
  }
  return out;
}

function input(over: Partial<PreferenceInput>): PreferenceInput {
  return {
    memoryEnabled: true,
    tasks: [],
    focusSessions: [],
    now: NOW,
    utcOffsetMinutes: TZ,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────
// 指标
// ─────────────────────────────────────────────────────────────

const mae = (errors: readonly number[]): number =>
  errors.length === 0 ? Number.NaN : errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length;

/** 环形小时距离（0–12）。 */
function hourDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 24;
  return Math.min(d, 24 - d);
}

interface Row {
  id: string;
  /** 有信号数据上是否检出。 */
  detected: boolean;
  confidence: number;
  planted: string;
  inferred: string;
  preferenceMae: number;
  baselineMae: number;
  /** 🔴 纯噪声数据上是否**误报**（检出了偏好）。 */
  falsePositive: boolean;
}

const rows: Row[] = [];

// ─────────────────────────────────────────────────────────────
// P1 估算偏差
// ─────────────────────────────────────────────────────────────

{
  const TRAIN = Math.floor(SESSION_COUNT * TRAIN_RATIO);

  // 有信号：真值 1.8
  const sSignal = makeSessions(makeRng(1), 1.8, 9);
  const trainSignal = sSignal.slice(0, TRAIN);
  const testSignal = sSignal.slice(TRAIN);
  const ps = inferPreferences(input({ focusSessions: trainSignal })).estimateBias;
  // ⚠️ 单位：整个式子除以 MINUTE，不能只除后半段（第一次就写错了，
  // 报出 326 万的 MAE —— 数量级离谱时先怀疑单位，别怀疑模型）。
  const prefMae = mae(
    testSignal.map((s) => ((s.actualMs as number) - s.plannedMs * (ps?.value ?? 1)) / MINUTE),
  );
  const baseMae = mae(testSignal.map((s) => ((s.actualMs as number) - s.plannedMs) / MINUTE));

  // 纯噪声
  const sNoise = makeSessions(makeRng(2), null, 9);
  const pn = inferPreferences(input({ focusSessions: sNoise.slice(0, TRAIN) })).estimateBias;

  rows.push({
    id: 'P1 估算偏差',
    detected: ps !== null && ps.confidence >= MIN_CONFIDENCE,
    confidence: ps?.confidence ?? 0,
    planted: '1.80×',
    inferred: ps === null ? '（未产出）' : `${ps.value.toFixed(2)}×`,
    preferenceMae: prefMae,
    baselineMae: baseMae,
    falsePositive: pn !== null && pn.confidence >= MIN_CONFIDENCE,
  });
}

// ─────────────────────────────────────────────────────────────
// P2 深度工作时段
// ─────────────────────────────────────────────────────────────

{
  const TRAIN = Math.floor(SESSION_COUNT * TRAIN_RATIO);

  const sSignal = makeSessions(makeRng(3), 1.0, 9);
  const train = sSignal.slice(0, TRAIN);
  const test = sSignal.slice(TRAIN);
  const pw = inferPreferences(input({ focusSessions: train })).deepWorkWindow;
  const predictedHour = pw === null ? 12 : (pw.value.startHour + pw.value.endHour) / 2;
  const prefMae = mae(
    test.map((s) => hourDistance(localHourOf(s.startedAt as number), predictedHour)),
  );
  const baseMae = mae(test.map((s) => hourDistance(localHourOf(s.startedAt as number), 12)));

  const sNoise = makeSessions(makeRng(4), 1.0, null);
  const pn = inferPreferences(input({ focusSessions: sNoise.slice(0, TRAIN) })).deepWorkWindow;

  rows.push({
    id: 'P2 深度工作时段',
    detected: pw !== null && pw.confidence >= MIN_CONFIDENCE,
    confidence: pw?.confidence ?? 0,
    planted: '09:00 左右',
    inferred: pw === null ? '（未产出）' : `${pw.value.startHour}:00–${pw.value.endHour}:00`,
    preferenceMae: prefMae,
    baselineMae: baseMae,
    falsePositive: pn !== null && pn.confidence >= MIN_CONFIDENCE,
  });
}

function localHourOf(ts: number): number {
  return Math.floor((ts + TZ * MINUTE) / HOUR) % 24;
}

// ─────────────────────────────────────────────────────────────
// P3 提前量
// ─────────────────────────────────────────────────────────────

{
  const TRAIN = Math.floor(TASK_COUNT * TRAIN_RATIO);

  const tSignal = makeTasks(makeRng(5), 3, 6, 12);
  const train = tSignal.slice(0, TRAIN);
  const test = tSignal.slice(TRAIN);
  const pl = inferPreferences(input({ tasks: train })).leadTime;
  const prefMae = mae(
    test.map((t) => ((t.dueDate as number) - (t.completedAt as number)) / DAY - (pl?.value ?? 0)),
  );
  const baseMae = mae(
    test.map((t) => ((t.dueDate as number) - (t.completedAt as number)) / DAY - 0),
  );

  const tNoise = makeTasks(makeRng(6), null, 6, 12);
  const pn = inferPreferences(input({ tasks: tNoise.slice(0, TRAIN) })).leadTime;

  rows.push({
    id: 'P3 提前量',
    detected: pl !== null && pl.confidence >= MIN_CONFIDENCE,
    confidence: pl?.confidence ?? 0,
    planted: '提前 3.0 天',
    inferred: pl === null ? '（未产出）' : `提前 ${pl.value.toFixed(1)} 天`,
    preferenceMae: prefMae,
    baselineMae: baseMae,
    falsePositive: pn !== null && pn.confidence >= MIN_CONFIDENCE,
  });
}

// ─────────────────────────────────────────────────────────────
// P4 粒度
// ─────────────────────────────────────────────────────────────

{
  const TRAIN = Math.floor(TASK_COUNT * TRAIN_RATIO);
  const DEFAULT_ITEMS = 3;

  const tSignal = makeTasks(makeRng(7), 3, 6, 12);
  const train = tSignal.slice(0, TRAIN);
  const test = tSignal.slice(TRAIN);
  const pg = inferPreferences(input({ tasks: train })).granularity;
  const countOf = (t: PreferenceTask): number =>
    (t.note ?? '').split('\n').filter((l) => /^\s*[-*]\s*\[[ xX]\]\s*\S/.test(l)).length;
  const prefMae = mae(test.map((t) => countOf(t) - (pg?.value ?? DEFAULT_ITEMS)));
  const baseMae = mae(test.map((t) => countOf(t) - DEFAULT_ITEMS));

  const tNoise = makeTasks(makeRng(8), 3, null, 12);
  const pn = inferPreferences(input({ tasks: tNoise.slice(0, TRAIN) })).granularity;

  rows.push({
    id: 'P4 粒度',
    detected: pg !== null && pg.confidence >= MIN_CONFIDENCE,
    confidence: pg?.confidence ?? 0,
    planted: '6 项',
    inferred: pg === null ? '（未产出）' : `${pg.value} 项`,
    preferenceMae: prefMae,
    baselineMae: baseMae,
    falsePositive: pn !== null && pn.confidence >= MIN_CONFIDENCE,
  });
}

// ─────────────────────────────────────────────────────────────
// P5 表达习惯
// ─────────────────────────────────────────────────────────────

{
  const TRAIN = Math.floor(TASK_COUNT * TRAIN_RATIO);
  const DEFAULT_LEN = 10;

  const tSignal = makeTasks(makeRng(9), 3, 6, 12);
  const train = tSignal.slice(0, TRAIN);
  const test = tSignal.slice(TRAIN);
  const pst = inferPreferences(input({ tasks: train })).titleStyle;
  const lenOf = (t: PreferenceTask): number => [...t.title].length;
  const prefMae = mae(test.map((t) => lenOf(t) - (pst?.value.medianTitleLength ?? DEFAULT_LEN)));
  const baseMae = mae(test.map((t) => lenOf(t) - DEFAULT_LEN));

  const tNoise = makeTasks(makeRng(10), 3, 6, null);
  const pn = inferPreferences(input({ tasks: tNoise.slice(0, TRAIN) })).titleStyle;

  rows.push({
    id: 'P5 表达习惯',
    detected: pst !== null && pst.confidence >= MIN_CONFIDENCE,
    confidence: pst?.confidence ?? 0,
    planted: '12 字',
    inferred: pst === null ? '（未产出）' : `${Math.round(pst.value.medianTitleLength)} 字`,
    preferenceMae: prefMae,
    baselineMae: baseMae,
    falsePositive: pn !== null && pn.confidence >= MIN_CONFIDENCE,
  });
}

// ─────────────────────────────────────────────────────────────
// 报告
// ─────────────────────────────────────────────────────────────

function report(): string {
  const l: string[] = [];
  l.push('');
  l.push('══════ 偏好层：留出法实测（train 80% / test 20%）══════');
  l.push('⚠️ 合成数据 —— 验证的是「方法」，不是「真实用户身上有没有这些偏好」');
  l.push('');
  l.push(' 偏好            | 植入    | 推断出    | 置信度 | 偏好MAE | 基线MAE | 优于基线 | 噪声误报');
  l.push('  ---------------|---------|-----------|--------|---------|---------|----------|--------');
  for (const r of rows) {
    const beats = r.preferenceMae < r.baselineMae ? '✅' : '❌';
    l.push(
      ` ${r.id.padEnd(14)} | ${r.planted.padEnd(7)} | ${r.inferred.padEnd(9)} | ${r.confidence
        .toFixed(2)
        .padEnd(6)} | ${r.preferenceMae.toFixed(3).padStart(7)} | ${r.baselineMae
        .toFixed(3)
        .padStart(7)} | ${beats.padEnd(8)} | ${r.falsePositive ? '🔴 误报' : '✅ 正确扣下'}`,
    );
  }
  l.push('═══════════════════════════════════════════════════════');
  l.push('');
  return l.join('\n');
}

// ─────────────────────────────────────────────────────────────
// 断言
// ─────────────────────────────────────────────────────────────

describe('🔴 实验：偏好层能不能预测，还是我在编', () => {
  it('始终打印实测报告', () => {
    // eslint-disable-next-line no-console
    console.log(report());
    expect(rows).toHaveLength(5);
  });

  /**
   * 🔴 **守门测试：纯噪声下必须不产出偏好。**
   *
   * 这是整个文件里最重要的一条。一个会把随机数据说成
   * 「你上午最高效」的系统，比没有偏好层更糟 —— 它会持续误导用户。
   */
  it('🔴 守门：五条偏好在纯噪声数据上全都不得误报', () => {
    const falsePositives = rows.filter((r) => r.falsePositive).map((r) => r.id);
    expect(falsePositives).toEqual([]);
  });

  /**
   * 🔴 **守门测试：有信号时必须检出。**
   *
   * 如果连植入的明显偏好都抓不到，说明估计器坏了 ——
   * 那么"噪声不误报"这个结论也就没有意义（一个永远返回
   * `withheld` 的实现能轻松通过上一条）。
   *
   * 这两条**必须成对**看：单看任何一条都能被平凡实现骗过。
   */
  it('🔴 守门：五条偏好在有信号数据上全都必须检出', () => {
    const missed = rows.filter((r) => !r.detected).map((r) => r.id);
    expect(missed).toEqual([]);
  });

  it('🔴 每条偏好都必须优于「不认识你」的基线', () => {
    const losers = rows.filter((r) => !(r.preferenceMae < r.baselineMae)).map((r) => r.id);
    // 不优于基线的偏好**必须从实现里删掉** —— 见结论文档。
    expect(losers).toEqual([]);
  });

  /**
   * 🔴 **主开关：关闭时零推断。**
   *
   * 传进去的是一份**明确有偏好**的数据；只要开关是关的，
   * 返回值必须是空集 —— 不是"低置信度"，是**什么都没有**。
   */
  it('🔴 总开关：memoryEnabled=false 时返回空集，哪怕数据里全是信号', () => {
    const s = makeSessions(makeRng(1), 1.8, 9);
    const t = makeTasks(makeRng(5), 3, 6, 12);
    const set = inferPreferences(input({ memoryEnabled: false, focusSessions: s, tasks: t }));

    expect(set.memoryEnabled).toBe(false);
    expect(set.estimateBias).toBeNull();
    expect(set.deepWorkWindow).toBeNull();
    expect(set.leadTime).toBeNull();
    expect(set.granularity).toBeNull();
    expect(set.titleStyle).toBeNull();
    // 关闭时连 withheld 都不该有 —— 它也不该解释自己
    expect(set.withheld).toEqual([]);
  });

  it('打开时同一份数据确实能产出偏好（证明上一条不是"永远返回空"）', () => {
    const s = makeSessions(makeRng(1), 1.8, 9);
    const t = makeTasks(makeRng(5), 3, 6, 12);
    const set = inferPreferences(input({ memoryEnabled: true, focusSessions: s, tasks: t }));
    expect(set.memoryEnabled).toBe(true);
    expect(set.estimateBias).not.toBeNull();
    expect(set.leadTime).not.toBeNull();
  });

  /**
   * 🔴 **纯度**：同输入必须同输出。
   *
   * 这条不是形式主义 —— 偏好必须能从 op-log **确定性重建**，
   * 否则它就是 ADR-0005 警告的「明文派生物」。
   */
  it('🔴 纯度：同输入两次调用结果完全相同', () => {
    const s = makeSessions(makeRng(1), 1.8, 9);
    const t = makeTasks(makeRng(5), 3, 6, 12);
    const a = inferPreferences(input({ focusSessions: s, tasks: t }));
    const b = inferPreferences(input({ focusSessions: s, tasks: t }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  /**
   * 🔴 **时区不能从环境读。**
   *
   * 同一个时间戳、不同 `utcOffsetMinutes`，必须给出**不同**的高峰时段 ——
   * 证明这个值真的来自参数，而不是来自 `new Date().getHours()`。
   * 若实现里偷读了环境时区，这条会红。
   */
  it('🔴 时段偏好来自传入的时区参数，不是运行环境', () => {
    const s = makeSessions(makeRng(3), 1.0, 9); // 本地 09:00 开始
    const east = inferPreferences(input({ focusSessions: s, utcOffsetMinutes: 480 }));
    const west = inferPreferences(input({ focusSessions: s, utcOffsetMinutes: 0 }));
    expect(east.deepWorkWindow).not.toBeNull();
    expect(west.deepWorkWindow).not.toBeNull();
    expect(east.deepWorkWindow?.value.startHour).not.toBe(west.deepWorkWindow?.value.startHour);
  });
});
