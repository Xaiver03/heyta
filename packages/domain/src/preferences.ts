/**
 * 偏好推断层：从历史里**推断用户是谁**
 * =====================================
 *
 * ## 这一层与 `memory.ts` 的区别（最重要的一刀）
 *
 * `memory.ts` 算的是**事实**：「这条任务被推过 6 次」。
 * 本模块算的是**偏好**：「你倾向把难任务推到下午」。
 *
 * | | `memory.ts` 事实 | 本模块 偏好 |
 * |---|---|---|
 * | 来源 | op-log 直接算出 | 从事实**统计归纳** |
 * | 确定性 | 确定 | **概率性 —— 会错** |
 * | 错了的后果 | 小（只是个数字） | **大：会污染每一次 AI 交互** |
 * | 要不要给用户看 | 不必 | 🔴 **必须**（错了要能改） |
 *
 * 所以这里每一条偏好都必须自带 `sampleSize` / `confidence` / `evidence`，
 * 且 **样本不足时宁可不产出**（见 `withheld`）。
 *
 * ## 🔴 三条硬约束
 *
 * **① 纯函数。** 同输入必须同输出。因此**不读时钟**（`now` 由调用方传入）、
 * **不读时区**（`utcOffsetMinutes` 由调用方传入）。后者容易被忽略：
 * `new Date(ts).getHours()` 依赖运行环境的 TZ，会让"偏好"在不同机器上不一样，
 * 也就无法从 op-log 确定性重建 —— 那就成了 ADR-0005 警告的**明文派生物**。
 *
 * **② 主开关 fail-closed。** `memoryEnabled` 是**必填**参数，不是可选。
 * 这照抄本项目踩过的坑：`isReadable` 曾经是可选的，于是默认 `() => true`，
 * 闸门形同虚设。**可选参数 = 会被忘记 = 最终 fail open。**
 * 关闭时返回**空偏好集**，一条都不推断。
 *
 * **③ 不许编。** 样本不够或数据太散时，产出 `withheld` 而不是一个猜测值。
 * 「我还不了解你」比「我猜你上午高效」诚实，也更安全。
 */

/** 一天毫秒数。 */
const MS_PER_DAY = 86_400_000;

/** 低于这个样本量，不产出任何偏好。 */
export const MIN_SAMPLE_SIZE = 8;

/** 低于这个置信度，不产出偏好（进 `withheld`）。 */
export const MIN_CONFIDENCE = 0.5;

/** 样本量达到这个值时，样本因子满格（1.0）。 */
export const FULL_SAMPLE_SIZE = 20;

/** 深度工作时段的窗口宽度（小时）。 */
export const DEEP_WORK_WINDOW_HOURS = 3;

// ─────────────────────────────────────────────────────────────
// 输入形状
// ─────────────────────────────────────────────────────────────

/** 任务的最小字段集（`Task` 的结构化子集）。 */
export interface PreferenceTask {
  id: string;
  title: string;
  note?: string;
  dueDate?: number;
  completedAt?: number;
  createdAt: number;
  deletedAt?: number;
}

/** 专注记录的最小字段集（`FocusSession` 的结构化子集）。 */
export interface PreferenceFocusSession {
  kind: string;
  plannedMs: number;
  actualMs?: number;
  startedAt?: number;
}

export interface PreferenceInput {
  /**
   * 🔴 **记忆主开关。必填 —— 不是可选。**
   *
   * 关闭时 `inferPreferences` 返回空集：**零推断、零偏好、无任何出境内容**。
   * 这是产品负责人明确要求的总开关（见 ADR-0014）。
   */
  readonly memoryEnabled: boolean;
  readonly tasks: readonly PreferenceTask[];
  readonly focusSessions: readonly PreferenceFocusSession[];
  /** 当前时间（epoch ms）。由调用方传入，保证可测。 */
  readonly now: number;
  /**
   * 用户所在时区相对 UTC 的偏移（分钟，东八区 = 480）。
   *
   * 🔴 **必须由调用方传入，不许在这里读 `Date#getHours()`** ——
   * 那会让偏好依赖运行环境，从而**无法从 op-log 确定性重建**。
   */
  readonly utcOffsetMinutes: number;
}

// ─────────────────────────────────────────────────────────────
// 输出形状
// ─────────────────────────────────────────────────────────────

export type PreferenceId =
  | 'estimate-bias'
  | 'deep-work-window'
  | 'lead-time'
  | 'granularity'
  | 'title-style'
  // ── 反馈层（M4，见 `ai-feedback.ts`）─────────────────────────
  // 它们**只能**从"用户怎么处置 AI 建议"推断，从用户自己的数据推不出来。
  | 'feedback-granularity'
  | 'feedback-keep-ratio';

/**
 * 一条**推断出来**的偏好。
 *
 * `evidence` 是**给用户看的原话** —— 不是日志，是界面文案。
 * 判据：用户看了这句话，能判断这条偏好对不对，并决定要不要删掉它。
 */
export interface Preference<T> {
  readonly id: PreferenceId;
  readonly value: T;
  /** 支撑这条偏好的样本条数。 */
  readonly sampleSize: number;
  /** 0–1。低于 `MIN_CONFIDENCE` 的偏好不会出现在结果里。 */
  readonly confidence: number;
  /** 给用户看的原话（含样本量与依据）。 */
  readonly evidence: string;
}

/** 被**扣下**的偏好 —— 以及为什么。UI 要能据此说「我还不了解你」。 */
export interface WithheldPreference {
  readonly id: PreferenceId;
  readonly reason: 'disabled' | 'not-enough-samples' | 'not-stable-enough' | 'no-data';
  /** 给用户看的原因（中文）。 */
  readonly detail: string;
}

export interface DeepWorkWindow {
  /** 起始小时（0–23，含）。 */
  readonly startHour: number;
  /** 结束小时（0–23，不含）。跨午夜时 `startHour > endHour`。 */
  readonly endHour: number;
  /** 落在窗口内的专注占全部的比例（0–1）。 */
  readonly concentration: number;
}

export interface TitleStyle {
  /** 标题里含中日韩字符的比例（0–1）。 */
  readonly cjkShare: number;
  /** 标题字符数中位数。 */
  readonly medianTitleLength: number;
  /** 标题含 emoji 的比例（0–1）。 */
  readonly emojiShare: number;
}

export interface PreferenceSet {
  /** 主开关的状态，原样带回 —— 调用方不必再传一遍上下文。 */
  readonly memoryEnabled: boolean;
  readonly estimateBias: Preference<number> | null;
  readonly deepWorkWindow: Preference<DeepWorkWindow> | null;
  readonly leadTime: Preference<number> | null;
  readonly granularity: Preference<number> | null;
  readonly titleStyle: Preference<TitleStyle> | null;
  /**
   * 被扣下的偏好及原因。**必须如实暴露** ——
   * 界面要说「我还不了解你（还需要 N 次专注）」，而不是假装懂。
   */
  readonly withheld: readonly WithheldPreference[];
}

// ─────────────────────────────────────────────────────────────
// 统计小工具（纯函数，导出以便单测）
// ─────────────────────────────────────────────────────────────

export function medianOf(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

/** 分位数（线性插值）。`sorted` 必须已升序。 */
function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0] as number;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo] as number;
  const frac = pos - lo;
  return (sorted[lo] as number) * (1 - frac) + (sorted[hi] as number) * frac;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** 样本量 → 0–1 的样本因子。 */
function sampleFactor(sampleSize: number): number {
  return clamp01(sampleSize / FULL_SAMPLE_SIZE);
}

/**
 * 离散度 → 稳定性。
 *
 * `scale` 是「多大的四分位距算完全不可用」。它是个**产品判断**
 * （一个"稳定"的偏好应该多集中），所以显式参数化 + 文档化，
 * 而不是散在公式里。
 */
function stabilityFromDispersion(values: readonly number[], scale: number): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
  return clamp01(1 - iqr / scale);
}

/** 中日韩字符。 */
const CJK_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/;

/**
 * 是否是 emoji。
 *
 * 🔴 **故意用码点区间判断，不用 `\p{Extended_Pictographic}`。**
 * 本项目要在 Hermes 上跑，而 Unicode 属性转义在旧引擎上不可靠；
 * 码点区间更啰嗦但**行为确定**。覆盖常见 emoji 区段即可 ——
 * 这一项只是"表达习惯"的一个信号，不是关键路径。
 */
function isEmoji(codePoint: number): boolean {
  return (
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) || // 各类符号与补充
    (codePoint >= 0x1f000 && codePoint <= 0x1f2ff) ||
    (codePoint >= 0x2600 && codePoint <= 0x27bf) || // 杂项符号 / dingbats
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) || // 变体选择符
    (codePoint >= 0x2190 && codePoint <= 0x21ff) // 箭头（常用作标记）
  );
}

function hasEmoji(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && isEmoji(cp)) return true;
  }
  return false;
}

/** 标题字符数：按**码点**数，不按 UTF-16 长度（否则 emoji 被算成 2）。 */
function codePointLength(text: string): number {
  let n = 0;
  for (const _ of text) n += 1;
  return n;
}

/** 备注里的 checklist 项数（格式 `- [ ] xxx`，见 `renderChecklist`）。 */
const CHECKLIST_LINE = /^\s*[-*]\s*\[[ xX]\]\s*\S/;

export function countChecklistItems(note: string | undefined): number {
  if (note === undefined || note === '') return 0;
  let count = 0;
  for (const line of note.split('\n')) {
    if (CHECKLIST_LINE.test(line)) count += 1;
  }
  return count;
}

/** 把 epoch ms 转成用户本地的小时（0–23）。 */
function localHour(timestamp: number, utcOffsetMinutes: number): number {
  const shifted = timestamp + utcOffsetMinutes * 60_000;
  const hour = Math.floor(shifted / 3_600_000) % 24;
  return hour < 0 ? hour + 24 : hour;
}

/** 从专注记录里取"本地开始时间"的分钟偏移（0–1439）。 */
function localMinuteOfDay(timestamp: number, utcOffsetMinutes: number): number {
  const shifted = timestamp + utcOffsetMinutes * 60_000;
  const minute = Math.floor(shifted / 60_000) % 1440;
  return minute < 0 ? minute + 1440 : minute;
}

// ─────────────────────────────────────────────────────────────
// P1 估算偏差系数
// ─────────────────────────────────────────────────────────────

/**
 * 你以为 1 小时能写完，实际用了 1.8 小时 —— 这个 1.8 就是偏差系数。
 *
 * 为什么这是第一批里最有价值的一条：它是**唯一一个用户自己也算不准、
 * 而 heyta 恰好有精确数据**的偏好（`plannedMs` 与 `actualMs` 成对存在）。
 */
export function inferEstimateBias(
  sessions: readonly PreferenceFocusSession[],
): { preference: Preference<number> | null; withheld: WithheldPreference | null } {
  const ratios: number[] = [];
  for (const s of sessions) {
    if (s.actualMs === undefined) continue;
    if (!Number.isFinite(s.plannedMs) || s.plannedMs <= 0) continue;
    if (!Number.isFinite(s.actualMs) || s.actualMs <= 0) continue;
    ratios.push(s.actualMs / s.plannedMs);
  }

  if (ratios.length === 0) {
    return {
      preference: null,
      withheld: { id: 'estimate-bias', reason: 'no-data', detail: '还没有完成过的专注记录' },
    };
  }
  if (ratios.length < MIN_SAMPLE_SIZE) {
    return {
      preference: null,
      withheld: {
        id: 'estimate-bias',
        reason: 'not-enough-samples',
        detail: `还需要 ${MIN_SAMPLE_SIZE - ratios.length} 次专注`,
      },
    };
  }

  const value = medianOf(ratios);
  // 偏差系数的"散"用比例尺度衡量：IQR 达 1.0（即 100%）算完全不可用。
  const confidence = sampleFactor(ratios.length) * stabilityFromDispersion(ratios, 1);
  if (confidence < MIN_CONFIDENCE) {
    return {
      preference: null,
      withheld: {
        id: 'estimate-bias',
        reason: 'not-stable-enough',
        detail: '你的用时波动太大，暂时算不出稳定的偏差系数',
      },
    };
  }

  const direction = value > 1.05 ? '低估' : value < 0.95 ? '高估' : '估得很准';
  const ratioText = value.toFixed(2);
  const evidence =
    direction === '估得很准'
      ? `基于 ${ratios.length} 次专注，你的时间估计很准（实际约为计划的 ${ratioText} 倍）`
      : `基于 ${ratios.length} 次专注，你倾向${direction}任务耗时 —— 实际用时约为计划的 ${ratioText} 倍`;

  return {
    preference: { id: 'estimate-bias', value, sampleSize: ratios.length, confidence, evidence },
    withheld: null,
  };
}

// ─────────────────────────────────────────────────────────────
// P2 深度工作时段
// ─────────────────────────────────────────────────────────────

/**
 * 找出专注最集中的连续 `DEEP_WORK_WINDOW_HOURS` 小时窗口。
 *
 * 用**分钟**而不是小时来定位窗口起点：只在整点切会让 8:50 开始的人
 * 被算进"8 点档"，而实际上他更接近 9 点档。窗口起点按整点对齐
 * （便于展示成 "8:00–11:00"），但归属判断按分钟。
 */
export function inferDeepWorkWindow(
  sessions: readonly PreferenceFocusSession[],
  utcOffsetMinutes: number,
): { preference: Preference<DeepWorkWindow> | null; withheld: WithheldPreference | null } {
  const minutes: number[] = [];
  for (const s of sessions) {
    // 只算真正的工作专注：休息不算"深度工作"。
    if (s.kind !== 'work') continue;
    if (s.startedAt === undefined || !Number.isFinite(s.startedAt)) continue;
    minutes.push(localMinuteOfDay(s.startedAt, utcOffsetMinutes));
  }

  if (minutes.length === 0) {
    return {
      preference: null,
      withheld: { id: 'deep-work-window', reason: 'no-data', detail: '还没有专注记录' },
    };
  }
  if (minutes.length < MIN_SAMPLE_SIZE) {
    return {
      preference: null,
      withheld: {
        id: 'deep-work-window',
        reason: 'not-enough-samples',
        detail: `还需要 ${MIN_SAMPLE_SIZE - minutes.length} 次专注`,
      },
    };
  }

  // 每个整点起点试一遍，取覆盖最多的一条窗口。
  let bestStart = 0;
  let bestCount = -1;
  for (let start = 0; start < 24; start += 1) {
    const lo = start * 60;
    const hi = lo + DEEP_WORK_WINDOW_HOURS * 60;
    let count = 0;
    for (const m of minutes) {
      // 跨午夜时窗口绕回：用取模判断区间归属。
      const inWindow =
        hi <= 1440 ? m >= lo && m < hi : m >= lo || m < hi - 1440;
      if (inWindow) count += 1;
    }
    if (count > bestCount) {
      bestCount = count;
      bestStart = start;
    }
  }

  const concentration = bestCount / minutes.length;
  const confidence = sampleFactor(minutes.length) * clamp01(concentration);
  if (confidence < MIN_CONFIDENCE) {
    return {
      preference: null,
      withheld: {
        id: 'deep-work-window',
        reason: 'not-stable-enough',
        detail: '你的专注时间比较分散，暂时看不出固定的高效时段',
      },
    };
  }

  const endHour = (bestStart + DEEP_WORK_WINDOW_HOURS) % 24;
  const value: DeepWorkWindow = {
    startHour: bestStart,
    endHour,
    concentration,
  };
  const pct = Math.round(concentration * 100);
  const pad = (h: number): string => `${String(h).padStart(2, '0')}:00`;
  const evidence = `基于 ${minutes.length} 次专注，${pct}% 集中在 ${pad(bestStart)}–${pad(endHour)}`;

  return {
    preference: { id: 'deep-work-window', value, sampleSize: minutes.length, confidence, evidence },
    withheld: null,
  };
}

// ─────────────────────────────────────────────────────────────
// P3 提前量
// ─────────────────────────────────────────────────────────────

/**
 * 你习惯提前多久完成有截止日期的事。
 *
 * 正数 = 提前，负数 = 逾期，0 = 踩点。中位数而不是均值 ——
 * 一次逾期两周就能把均值拉得毫无意义。
 */
export function inferLeadTime(
  tasks: readonly PreferenceTask[],
): { preference: Preference<number> | null; withheld: WithheldPreference | null } {
  const leads: number[] = [];
  for (const t of tasks) {
    if (t.deletedAt !== undefined) continue;
    if (t.completedAt === undefined || t.dueDate === undefined) continue;
    leads.push((t.dueDate - t.completedAt) / MS_PER_DAY);
  }

  if (leads.length === 0) {
    return {
      preference: null,
      withheld: {
        id: 'lead-time',
        reason: 'no-data',
        detail: '还没有「有截止日期且已完成」的任务',
      },
    };
  }
  if (leads.length < MIN_SAMPLE_SIZE) {
    return {
      preference: null,
      withheld: {
        id: 'lead-time',
        reason: 'not-enough-samples',
        detail: `还需要 ${MIN_SAMPLE_SIZE - leads.length} 个已完成的有截止日期任务`,
      },
    };
  }

  const value = medianOf(leads);
  // 提前量的散度用"天"衡量：四分位距达 14 天算完全不可用（跨两周就说不准了）。
  const confidence = sampleFactor(leads.length) * stabilityFromDispersion(leads, 14);
  if (confidence < MIN_CONFIDENCE) {
    return {
      preference: null,
      withheld: {
        id: 'lead-time',
        reason: 'not-stable-enough',
        detail: '你完成任务的提前量波动太大，暂时看不出固定习惯',
      },
    };
  }

  const abs = Math.abs(value);
  const rounded = abs < 1 ? abs.toFixed(1) : String(Math.round(abs));
  const evidence =
    value > 0.5
      ? `基于 ${leads.length} 个已完成任务，你平均提前 ${rounded} 天完成`
      : value < -0.5
        ? `基于 ${leads.length} 个已完成任务，你平均逾期 ${rounded} 天完成`
        : `基于 ${leads.length} 个已完成任务，你通常在截止当天完成`;

  return {
    preference: { id: 'lead-time', value, sampleSize: leads.length, confidence, evidence },
    withheld: null,
  };
}

// ─────────────────────────────────────────────────────────────
// P4 任务粒度
// ─────────────────────────────────────────────────────────────

/**
 * 你的任务备注里通常有几项清单 —— AI 拆解时就该给几项。
 *
 * ⚠️ 分母是**带清单的任务**，不是全部任务。理由是这条偏好的用途是
 * "拆解该给几项"，而只有带清单的任务才表达了用户对粒度的选择；
 * 把没清单的任务算成 0 会把中位数拉到毫无意义的低位。
 */
export function inferGranularity(
  tasks: readonly PreferenceTask[],
): { preference: Preference<number> | null; withheld: WithheldPreference | null } {
  const counts: number[] = [];
  for (const t of tasks) {
    if (t.deletedAt !== undefined) continue;
    const n = countChecklistItems(t.note);
    if (n > 0) counts.push(n);
  }

  if (counts.length === 0) {
    return {
      preference: null,
      withheld: {
        id: 'granularity',
        reason: 'no-data',
        detail: '还没有带清单的任务备注',
      },
    };
  }
  if (counts.length < MIN_SAMPLE_SIZE) {
    return {
      preference: null,
      withheld: {
        id: 'granularity',
        reason: 'not-enough-samples',
        detail: `还需要 ${MIN_SAMPLE_SIZE - counts.length} 条带清单的任务`,
      },
    };
  }

  const value = medianOf(counts);
  // 粒度用"项"衡量：四分位距达 6 项算完全不可用。
  const confidence = sampleFactor(counts.length) * stabilityFromDispersion(counts, 6);
  if (confidence < MIN_CONFIDENCE) {
    return {
      preference: null,
      withheld: {
        id: 'granularity',
        reason: 'not-stable-enough',
        detail: '你的清单长度差异很大，暂时算不出固定的粒度偏好',
      },
    };
  }

  const evidence = `你的 ${counts.length} 条带清单任务，中位数是 ${value} 项`;
  return {
    preference: { id: 'granularity', value, sampleSize: counts.length, confidence, evidence },
    withheld: null,
  };
}

// ─────────────────────────────────────────────────────────────
// P5 表达习惯
// ─────────────────────────────────────────────────────────────

/**
 * 你怎么写字（中英比例 / 长度 / emoji）。
 *
 * ⚠️ **这是第一批里最弱的一条偏好**，实现在这里但**要通过留出法验证**才算数
 * （见 `preferences-experiment.spec.ts`）。它预测的是"你会怎么写"，
 * 用途是让 AI 生成的标题贴合你的习惯。
 */
export function inferTitleStyle(
  tasks: readonly PreferenceTask[],
): { preference: Preference<TitleStyle> | null; withheld: WithheldPreference | null } {
  const titles: string[] = [];
  for (const t of tasks) {
    if (t.deletedAt !== undefined) continue;
    if (t.title.trim() === '') continue;
    titles.push(t.title);
  }

  if (titles.length === 0) {
    return {
      preference: null,
      withheld: { id: 'title-style', reason: 'no-data', detail: '还没有任务标题' },
    };
  }
  if (titles.length < MIN_SAMPLE_SIZE) {
    return {
      preference: null,
      withheld: {
        id: 'title-style',
        reason: 'not-enough-samples',
        detail: `还需要 ${MIN_SAMPLE_SIZE - titles.length} 条任务`,
      },
    };
  }

  let cjkCount = 0;
  let emojiCount = 0;
  const lengths: number[] = [];
  for (const title of titles) {
    if (CJK_CHAR.test(title)) cjkCount += 1;
    if (hasEmoji(title)) emojiCount += 1;
    lengths.push(codePointLength(title));
  }

  const value: TitleStyle = {
    cjkShare: cjkCount / titles.length,
    medianTitleLength: medianOf(lengths),
    emojiShare: emojiCount / titles.length,
  };
  const confidence = sampleFactor(titles.length) * stabilityFromDispersion(lengths, 20);
  if (confidence < MIN_CONFIDENCE) {
    return {
      preference: null,
      withheld: {
        id: 'title-style',
        reason: 'not-stable-enough',
        detail: '你的标题长度差异很大，暂时算不出固定的表达习惯',
      },
    };
  }

  const lang = value.cjkShare >= 0.8 ? '以中文为主' : value.cjkShare <= 0.2 ? '以英文为主' : '中英混用';
  const emoji = value.emojiShare >= 0.2 ? '，常用 emoji' : '';
  const evidence = `基于 ${titles.length} 条任务，你的标题${lang}，平均 ${Math.round(value.medianTitleLength)} 个字${emoji}`;

  return {
    preference: { id: 'title-style', value, sampleSize: titles.length, confidence, evidence },
    withheld: null,
  };
}

// ─────────────────────────────────────────────────────────────
// 汇总
// ─────────────────────────────────────────────────────────────

/** 主开关关闭时的返回值：**空偏好集**，一条都不推断。 */
export function emptyPreferenceSet(memoryEnabled = false): PreferenceSet {
  return {
    memoryEnabled,
    estimateBias: null,
    deepWorkWindow: null,
    leadTime: null,
    granularity: null,
    titleStyle: null,
    withheld: [],
  };
}

/**
 * 推断全部第一批偏好。
 *
 * 🔴 **`input.memoryEnabled === false` 时立即返回空集** ——
 * 不读 tasks、不读 focusSessions、不产出任何东西。
 * 这是总开关的落点，也是 ADR-0014 的核心承诺。
 */
export function inferPreferences(input: PreferenceInput): PreferenceSet {
  if (!input.memoryEnabled) return emptyPreferenceSet(false);

  const bias = inferEstimateBias(input.focusSessions);
  const window = inferDeepWorkWindow(input.focusSessions, input.utcOffsetMinutes);
  const lead = inferLeadTime(input.tasks);
  const granularity = inferGranularity(input.tasks);
  const style = inferTitleStyle(input.tasks);

  const withheld: WithheldPreference[] = [];
  for (const w of [bias.withheld, window.withheld, lead.withheld, granularity.withheld, style.withheld]) {
    if (w !== null) withheld.push(w);
  }

  return {
    memoryEnabled: true,
    estimateBias: bias.preference,
    deepWorkWindow: window.preference,
    leadTime: lead.preference,
    granularity: granularity.preference,
    titleStyle: style.preference,
    withheld,
  };
}
