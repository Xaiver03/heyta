/**
 * 把偏好变成**给模型看的提示**
 * ==============================
 *
 * ## 为什么不直接把 `PreferenceSet` 丢进 prompt
 *
 * 两条理由，都是硬约束：
 *
 * **① 最小化（出境面）。** `ai-strategy.md` §6 要求"一次只发当前这个决定
 * 需要的那一条偏好"。把五条全发出去，等于每次拆解都多送两条无关的
 * 个人信息 —— 出境面是**按字段披露**的，多发就是多泄露。
 * 所以按功能过滤：拆解只需要粒度/风格/估时，排序才需要提前量/时段。
 *
 * **② 可读性。** `Preference.value` 是给人做逻辑用的（数字、结构），
 * 模型需要的是**一句话**。这两件事混在一起会让两边都别扭。
 *
 * ## 纯函数
 *
 * 零依赖、不读时钟、不读环境。`PreferenceRelevance` 是**本模块自己定义的**
 * 联合类型，故意不 import `packages/ai` 的 `AiFeature` ——
 * 否则 domain 会多一条包依赖（domain 目前只依赖 `shared-schema`）。
 * 映射由调用方（app-host）负责。
 */

import {
  type PreferenceId,
  type PreferenceSet,
  type Preference,
} from './preferences.js';

/**
 * 偏好的**用途分类**（不是 AI 功能名）。
 *
 * 用「这个决定需要知道什么」命名，而不是用「哪个功能」命名 ——
 * 功能会改名、会合并，而"估时需要知道什么"是稳定的。
 */
export type PreferenceRelevance = 'breakdown' | 'capture' | 'prioritize' | 'duration-estimate';

/**
 * 每个用途**真正需要**的偏好。
 *
 * ⚠️ 这张表是**出境面**的一部分：往这里加一条，就等于允许该功能
 * 多发一条用户信息出去。新增时必须同时更新出境披露的测试。
 */
const RELEVANT_PREFERENCES: Record<PreferenceRelevance, readonly PreferenceId[]> = {
  // 拆解：要几项（粒度）、什么风格（表达）、每项估多久（估算偏差）
  breakdown: ['granularity', 'title-style', 'estimate-bias'],
  // 捕获：只是补全一个标题，只需要风格
  capture: ['title-style'],
  // 排序：什么时候做（时段）、什么时候必须完成（提前量）
  prioritize: ['lead-time', 'deep-work-window'],
  // 估时：偏差系数 + 时段（不同时段效率不同）
  'duration-estimate': ['estimate-bias', 'deep-work-window'],
};

/** 一条要注入 prompt 的偏好提示。 */
export interface PreferenceHint {
  readonly id: PreferenceId;
  /**
   * 注入 prompt 的话（**不含**"基于 N 次"这类元信息 ——
   * 模型不需要知道样本量，用户才需要）。
   */
  readonly text: string;
  /** 披露给用户的短摘要（= 该偏好的 `evidence`）。 */
  readonly summary: string;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 倍数 → 中文方向词。 */
function biasPhrase(v: number): string {
  if (v > 1.05) return `实际用时约为自己估计的 ${v.toFixed(2)} 倍（倾向低估），给子项估时请按此放大`;
  if (v < 0.95) return `实际用时约为自己估计的 ${v.toFixed(2)} 倍（倾向高估），给子项估时请按此收紧`;
  return '时间估计一向很准，可以直接采信其估时';
}

function leadPhrase(days: number): string {
  const abs = Math.abs(days);
  const rounded = abs < 1 ? abs.toFixed(1) : String(Math.round(abs));
  if (days > 0.5) return `习惯提前 ${rounded} 天完成有截止日期的事`;
  if (days < -0.5) return `习惯逾期约 ${rounded} 天才完成，安排时要留出缓冲`;
  return '通常踩在截止当天完成';
}

/** 取一条偏好，转成提示文本；`null` 则返回 `null`。 */
function toHint(id: PreferenceId, set: PreferenceSet): PreferenceHint | null {
  const pick = <T>(p: Preference<T> | null, render: (v: T) => string): PreferenceHint | null =>
    p === null ? null : { id, text: render(p.value), summary: p.evidence };

  switch (id) {
    case 'estimate-bias':
      return pick(set.estimateBias, biasPhrase);
    case 'deep-work-window':
      return pick(
        set.deepWorkWindow,
        (w) => `高效时段是 ${pad2(w.startHour)}:00–${pad2(w.endHour)}:00，重要或困难的事宜安排在此区间`,
      );
    case 'lead-time':
      return pick(set.leadTime, leadPhrase);
    case 'granularity':
      return pick(set.granularity, (n) => `习惯把任务拆成 ${n} 项左右，请对齐这个粒度`);
    case 'title-style':
      return pick(set.titleStyle, (s) => {
        const lang = s.cjkShare >= 0.8 ? '中文' : s.cjkShare <= 0.2 ? '英文' : '中英混用';
        const emoji = s.emojiShare >= 0.2 ? '，并会用 emoji' : '';
        return `任务标题以${lang}为主，平均 ${Math.round(s.medianTitleLength)} 个字${emoji}，请保持同样的风格`;
      });
    default:
      return null;
  }
}

/**
 * 生成某个用途需要注入的偏好提示。
 *
 * - **主开关关闭** → 空数组（`PreferenceSet` 本身已经是空的，这里再兜一次底）
 * - 该用途不需要的偏好 → 不出现（最小化出境面）
 * - 没推算出来的偏好 → 不出现（**不许拿"平均用户"凑数**）
 *
 * 顺序**固定**（按 `RELEVANT_PREFERENCES` 声明序），保证 prompt 可复现、
 * 可做字节级断言。
 */
export function renderPreferenceHints(
  set: PreferenceSet,
  relevance: PreferenceRelevance,
): PreferenceHint[] {
  if (!set.memoryEnabled) return [];

  const hints: PreferenceHint[] = [];
  for (const id of RELEVANT_PREFERENCES[relevance]) {
    const hint = toHint(id, set);
    if (hint !== null) hints.push(hint);
  }
  return hints;
}

/** 该用途下，**所有可能**出现的偏好（用于披露与测试，与实际有没有值无关）。 */
export function relevantPreferenceIds(relevance: PreferenceRelevance): readonly PreferenceId[] {
  return RELEVANT_PREFERENCES[relevance];
}

/** 把提示拼成注入 prompt 的段落。空数组 → 空串（调用方据此决定加不加）。 */
export function renderHintBlock(hints: readonly PreferenceHint[]): string {
  if (hints.length === 0) return '';
  return ['关于这位用户的历史习惯（仅作参考，不要复述）：', ...hints.map((h) => `- ${h.text}`)].join('\n');
}
