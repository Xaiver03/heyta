/**
 * 确定性意图分类（域级）
 * ======================
 *
 * 用户这句话**大致落在哪个实体域**（task / note / habit …）—— 只用来**收敛候选工具集**，
 * 不决定"调哪个工具、传什么参数"。最终的工具与参数仍由模型在候选域内 function-calling 选择。
 *
 * 边界（与单步规则 `ai-tool-selection.ts` 不重叠）：
 * - 这里输出的是**实体域集合 + 置信度**，不是某个具体工具；
 * - 低置信、或命中域过多时**不收敛**（交给模型看全量目录）—— 宁可不收，不可收错：
 *   收错域会把对的工具挡掉，比不收更糟；
 * - 纯函数、零网络、零依赖，可单测。
 *
 * 为什么按"实体域"而不是按"意图标签"：本仓库的本地工具就是**按实体 pack 划分**的
 * （`LOCAL_API_TOOLS` 由各 `tools/<entity>.ts` 聚合）。域 == pack 的 `entityType`，
 * 于是"收敛候选集"就是"只把命中域的工具交给模型"，天然与工具目录同构，不另造一套映射。
 */

import { packForTool } from './registry.js';

export interface IntentClassification {
  /** 命中的实体域（pack 的 `entityType`）。空数组表示没有可用信号。 */
  readonly entityTypes: readonly string[];
  /** 0–1；`>= INTENT_SCOPE_CONFIDENCE_THRESHOLD` 时调用方才应收敛候选集。 */
  readonly confidence: number;
  /** 命中的规则 id，便于调试与观测。 */
  readonly matchedRules: readonly string[];
}

/** 收敛候选集的置信度门槛：低于它就不收（原样把全量目录交给模型）。 */
export const INTENT_SCOPE_CONFIDENCE_THRESHOLD = 0.6;

interface LexiconRule {
  readonly id: string;
  readonly entityType: string;
  readonly pattern: RegExp;
}

// 词表只放**高精度**词：宁可漏（回退全量），不要错（收错域会挡掉对的工具）。
const LEXICON: readonly LexiconRule[] = [
  { id: 'task', entityType: 'TASK', pattern: /任务|待办|todo|to-do|截止|到期|deadline|优先级|估时|预计用时|子任务|分派|指派/ },
  { id: 'project', entityType: 'PROJECT', pattern: /清单|项目|文件夹|\bprojects?\b/ },
  { id: 'tag', entityType: 'TAG', pattern: /标签|\btags?\b/ },
  { id: 'note', entityType: 'NOTE', pattern: /便签|笔记|备忘|\bnotes?\b|记一条/ },
  { id: 'reminder', entityType: 'REMINDER', pattern: /提醒|闹钟|\bremind/ },
  { id: 'event', entityType: 'EVENT', pattern: /倒数日|纪念日|生日|倒计时|周年|anniversary/ },
  { id: 'habit', entityType: 'HABIT', pattern: /习惯|连续天数|\bstreak\b/ },
  { id: 'habit-log', entityType: 'HABIT_LOG', pattern: /打卡/ },
  { id: 'focus', entityType: 'FOCUS_SESSION', pattern: /专注|番茄|计时/ },
  { id: 'attachment', entityType: 'ATTACHMENT', pattern: /附件|图片|截图|attachment/ },
  { id: 'comment', entityType: 'COMMENT', pattern: /评论|留言|\bcomments?\b/ },
  { id: 'filter', entityType: 'FILTER', pattern: /筛选|过滤|\bfilters?\b/ },
  { id: 'section', entityType: 'SECTION', pattern: /分组|\bsections?\b/ },
  { id: 'memory', entityType: 'USER_MEMORY', pattern: /记住|记牢|以后都|我的偏好|我叫|\bremember\b/ },
];

// 域之间的"协同"扩展：命中一个域时把常一起用的域也纳入候选，避免过度收窄。
// 例：任务常挂在清单下、习惯打卡记录与习惯定义成对出现。
const CO_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  TASK: ['PROJECT'],
  PROJECT: ['TASK'],
  HABIT: ['HABIT_LOG'],
  HABIT_LOG: ['HABIT'],
};

/**
 * 一句话 → 实体域集合 + 置信度。
 *
 * 置信度口径：命中域越集中越高；命中域多且分散（>=3 且无明显主导）时压到门槛以下，
 * 让调用方回退全量、把判断交还模型。
 */
export function classifyIntentDomains(text: string): IntentClassification {
  const normalized = text.normalize('NFKC').toLowerCase();
  const scores = new Map<string, number>();
  const matchedRules: string[] = [];
  for (const rule of LEXICON) {
    if (rule.pattern.test(normalized)) {
      scores.set(rule.entityType, (scores.get(rule.entityType) ?? 0) + 1);
      matchedRules.push(rule.id);
    }
  }
  if (scores.size === 0) return { entityTypes: [], confidence: 0, matchedRules };

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0]?.[1] ?? 0;
  if (top === 0) return { entityTypes: [], confidence: 0, matchedRules };
  const total = ranked.reduce((sum, [, score]) => sum + score, 0);
  // 只保留接近最高分的域（多域并列仍收敛成并集）。
  const primary = ranked.filter(([, score]) => score >= top * 0.5).map(([entity]) => entity);

  const expanded = new Set<string>(primary);
  for (const domain of primary) {
    for (const extra of CO_DOMAINS[domain] ?? []) expanded.add(extra);
  }

  const dominance = top / total;
  const confidence = dominance >= 0.5 ? Math.min(0.95, 0.6 + 0.1 * top) : 0.55;
  return { entityTypes: [...expanded], confidence, matchedRules };
}

/** 把工具数组按实体域过滤。空域集合 = 不过滤（原样返回）。 */
export function filterToolsByEntity<T extends { readonly name: string }>(
  tools: readonly T[],
  entityTypes: readonly string[],
): readonly T[] {
  if (entityTypes.length === 0) return tools;
  const allowed = new Set(entityTypes);
  return tools.filter((tool) => {
    const pack = packForTool(tool.name);
    return pack !== undefined && allowed.has(pack.entityType);
  });
}

export interface IntentToolScope<T> {
  readonly tools: readonly T[];
  readonly classification: IntentClassification;
  /** 是否真的收敛了（false = 原样全量交给模型）。 */
  readonly scoped: boolean;
}

/**
 * 一句话 → 收敛后的候选工具集。
 *
 * 只有"高置信、且确实筛出非空且更小的集合"时才收敛；否则**原样返回全量**。
 * 用户要的是"精准调工具"，不是"尽量少给"—— 所以漏收永远倒向全量兜底。
 */
export function scopeToolsByIntent<T extends { readonly name: string }>(
  tools: readonly T[],
  text: string,
): IntentToolScope<T> {
  const classification = classifyIntentDomains(text);
  if (
    classification.confidence < INTENT_SCOPE_CONFIDENCE_THRESHOLD ||
    classification.entityTypes.length === 0
  ) {
    return { tools, classification, scoped: false };
  }
  const filtered = filterToolsByEntity(tools, classification.entityTypes);
  if (filtered.length === 0 || filtered.length >= tools.length) {
    return { tools, classification, scoped: false };
  }
  return { tools: filtered, classification, scoped: true };
}
