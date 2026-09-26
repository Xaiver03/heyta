/**
 * 确定性检索基线：字面重叠
 * ==========================
 *
 * ## 这个文件是"要不要向量数据库"这场实验的**对照组**
 *
 * 它必须是**真能用的实现**，不能是为了证明"不需要向量"而故意搭的稻草人。
 * 否则实验就是在自证，毫无价值。所以：
 *
 * - 中文按**字符二元组（bigram）**切 —— 这是中文模糊匹配/去重的标准做法，
 *   不是权宜之计（中文没有词间空格，bigram 在工程上是常用且有效的）
 * - 拉丁文按小写词元切，长度 ≥2 的词保留
 * - 相似度用 **Dice 系数**（多重集合），对长度差异比 Jaccard 更稳健
 * - 混合权重：拉丁词元权重高于中文 bigram（词元携带的信息更具体）
 *
 * ## 它对应到生产环境是什么
 *
 * 这套逻辑在真实存储里可以由 **SQLite FTS5 + trigram** 承担（heyta 已经有 SQLite），
 * 本文件是它的**纯函数等价物**，因此可以脱离数据库被测、被实验。
 *
 * ## 零依赖
 *
 * 不引 tokenizer、不引向量库、不下载模型。因此三端（浏览器 / Hermes / Node）
 * 都能跑，且行为完全可复现。
 */

/** 一个检索候选。 */
export interface RecallCandidate {
  id: string;
  /** 参与匹配的文本（标题为主，可拼上备注）。 */
  text: string;
}

/** 一条命中。 */
export interface RecallHit {
  id: string;
  /** 0–1 的相似度。 */
  score: number;
}

/**
 * 拉丁词元的权重。
 *
 * 为什么 > 1：`weekly`、`q3`、`ppt` 这种词一旦命中，信息量远大于
 * 一个中文 bigram（中文里"的""上一"这类组合很常见，单看区分度低）。
 * 这个数字是**拍出来的**，并且它是显式常量 —— 要调就改这里，
 * 不要散落在评分逻辑里。
 */
const LATIN_TOKEN_WEIGHT = 2.5;

/** 连续的中日韩字符（含扩展区与兼容区）。 */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/;

/** 拉丁字母或数字。 */
const LATIN = /[a-z0-9]/i;

/**
 * 把文本切成带权重的词元多重集。
 *
 * - 拉丁连续串 → `w:<小写>`，权重 `LATIN_TOKEN_WEIGHT`
 * - 中文连续串 → 每个相邻字符对 `b:<两字>`，权重 1
 * - 中文**单字串**（长度为 1 的连续段） → `c:<字>`，权重 1
 *
 * 导出是为了**可测**：分词是这一层的核心行为，必须能被直接断言，
 * 而不是只能通过相似度间接观察。
 */
export function tokenize(text: string): Map<string, number> {
  const tokens = new Map<string, number>();
  const add = (key: string, weight: number): void => {
    tokens.set(key, (tokens.get(key) ?? 0) + weight);
  };

  const normalized = text.normalize('NFKC').toLowerCase();

  let i = 0;
  while (i < normalized.length) {
    const ch = normalized[i] as string;

    if (LATIN.test(ch)) {
      let j = i;
      while (j < normalized.length && LATIN.test(normalized[j] as string)) j += 1;
      const word = normalized.slice(i, j);
      // 单字符拉丁（如 "a"）区分度太低，丢掉。
      if (word.length >= 2) add(`w:${word}`, LATIN_TOKEN_WEIGHT);
      i = j;
      continue;
    }

    if (CJK.test(ch)) {
      let j = i;
      while (j < normalized.length && CJK.test(normalized[j] as string)) j += 1;
      const run = normalized.slice(i, j);
      if (run.length === 1) {
        add(`c:${run}`, 1);
      } else {
        for (let k = 0; k + 1 < run.length; k += 1) {
          add(`b:${run.slice(k, k + 2)}`, 1);
        }
      }
      i = j;
      continue;
    }

    // 标点、空白、emoji：不作为词元。
    i += 1;
  }

  return tokens;
}

/** 多重集交集大小（按最小计数求和）。 */
function intersectionSize(a: Map<string, number>, b: Map<string, number>): number {
  // 遍历较小的那个，省一点。
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let total = 0;
  for (const [key, weight] of small) {
    const other = large.get(key);
    if (other !== undefined) total += Math.min(weight, other);
  }
  return total;
}

function totalWeight(m: Map<string, number>): number {
  let sum = 0;
  for (const w of m.values()) sum += w;
  return sum;
}

/**
 * Dice 系数：`2·|A∩B| / (|A|+|B|)`，落在 0–1。
 *
 * 为什么用 Dice 而不是 Jaccard：Dice 对"一个短查询 vs 一个长文档"更宽容，
 * 而这个场景里查询通常比候选短。取 `2·交/(|A|+|B|)` 而不是
 * `交/并`，正是为了不让长文本因为"词多"被系统性压低。
 */
export function similarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const denom = totalWeight(ta) + totalWeight(tb);
  if (denom === 0) return 0;
  return (2 * intersectionSize(ta, tb)) / denom;
}

/**
 * 找最相似的 `k` 个候选。
 *
 * - 分数必须 **> 0** 才返回（零重叠没有信息，返回它只会制造噪音）
 * - 按分数降序；**平局用 id 升序**，保证跨端/跨次运行结果一致
 *   （`Array.prototype.sort` 在旧引擎上不保证稳定，不能依赖）
 * - 默认 `exclude` 掉查询自身，用于"这条任务和谁相关"
 */
export function findSimilar(
  query: string,
  candidates: readonly RecallCandidate[],
  options: { k?: number; excludeId?: string; minScore?: number } = {},
): RecallHit[] {
  const k = options.k ?? 5;
  const minScore = options.minScore ?? 0;

  const hits: RecallHit[] = [];
  for (const candidate of candidates) {
    if (candidate.id === options.excludeId) continue;
    const score = similarity(query, candidate.text);
    if (score <= minScore) continue;
    hits.push({ id: candidate.id, score });
  }

  return hits
    .sort((x, y) => (y.score !== x.score ? y.score - x.score : x.id < y.id ? -1 : 1))
    .slice(0, k);
}
