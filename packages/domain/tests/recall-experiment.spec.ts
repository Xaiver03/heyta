/**
 * 🔴 实验：heyta 到底需不需要向量数据库？
 * ==========================================
 *
 * ## 为什么这是一份"实验"而不是"测试"
 *
 * 我（AI）对这个问题有一个**预判**：不需要向量库。预判不算结论 ——
 * 如果只是我写一段话断言"不需要"，那是**自证**，没有任何价值。
 *
 * 所以这里把它变成一个**可证伪的实验**：把"需不需要"翻译成一个能被数字
 * 回答的问题，用代码跑出来，并且**允许它打脸**。
 *
 * ## 翻译成什么可测的问题
 *
 * "记忆"落在产品上最具体的一步是**重复检测**：用户敲进一条任务时，
 * 能不能认出"这个你已经有了"。它有一个**清晰的 ground truth**
 * （是不是同一个意图），不像"相关任务"那样边界模糊。
 *
 * 对每条新任务，基线给出相似度分数，`>= 阈值` 判定为重复。于是可测：
 *
 * - **召回率**：真的重复，有没有被认出来？
 * - **误报率**：不是重复，有没有被误判成重复？
 *
 * ## 🎯 实验的关键设计：把"重复"分成两档
 *
 * | 档位 | 例子 | 词法基线**应该**的表现 |
 * |---|---|---|
 * | **易**：字面重叠 | 「写周报」↔「写周报初稿」 | 应该命中 —— **这一档是"基线不是稻草人"的守门测试** |
 * | **难**：语义相同、字面零重叠 | 「准备季度汇报」↔「做 Q3 review 的 PPT」 | 🔴 **这正是词法基线该失败的地方**，也是**支持向量库的唯一论据** |
 *
 * ⚠️ **本实验明令禁止两件作弊**：
 * 1. 故意把易档做差，让"难档失败"显得无所谓
 * 2. 只报总体召回率，把难档的失败率**平均掉**
 *
 * 所以下面**分档报数**，并且总报告会**始终打印**，无论断言是否通过。
 *
 * ## ⚠️ 样本量的诚实声明
 *
 * 每组 8 对。这个量级**只能定性，不能定量** —— 它是"第一刀"，
 * 用来判断"值不值得继续深挖"，不是"最终结论"。
 * 任何从这个 n 推出的精确百分比都应当被当作**量级指示**。
 */

import { describe, expect, it } from 'vitest';
import { findSimilar, similarity } from '../src/recall.js';

// ─────────────────────────────────────────────────────────────
// 语料：一组真实感的任务标题（中文为主，混少量拉丁词）
// ─────────────────────────────────────────────────────────────

/** 用于制造"干扰项"的无关任务 —— 让检索不是在小集合里凑数。 */
const DISTRACTORS: string[] = [
  '给团队订周五的会议室',
  '更新依赖到最新小版本',
  '把发票拍照存到报销文件夹',
  '整理桌面上的纸质文件',
  '回复客户的邮件',
  '给猫换猫砂',
  '检查服务器磁盘占用',
  '把照片从手机导出来',
  '预约体检',
  '交水电费',
  '准备下周的面试题库',
  '把旧手机数据清掉',
  '写这个月的读书笔记',
  '订机票去成都',
  '和设计师对一下首页改版',
  '把跑步鞋拿去修',
  '整理上季度的发票',
  '给车做保养',
];

interface Pair {
  /** 已存在的任务（库里那条）。 */
  existing: string;
  /** 新敲进来的任务。 */
  incoming: string;
  /** 一句话说明为什么它俩是/不是同一个意图。 */
  why: string;
}

/** 易档：字面有明显重叠的真实重复。 */
const DUPLICATE_EASY: Pair[] = [
  { existing: '写周报', incoming: '写周报初稿', why: '同一件事，后者只是更具体' },
  { existing: '买牛奶', incoming: '买牛奶和鸡蛋', why: '后者是前者的扩展，仍是同一趟采购' },
  { existing: '预约牙医', incoming: '预约牙医复诊', why: '同一件事' },
  { existing: '修复登录 bug', incoming: '修复登录 bug 的回归测试', why: '同一件事的收尾' },
  { existing: '整理季度预算表', incoming: '整理季度预算表并发出', why: '同一件事的两个阶段' },
  { existing: '给妈妈打电话', incoming: '给妈妈打电话祝贺', why: '同一通电话' },
  { existing: '准备周一的评审', incoming: '准备周一评审要用的材料', why: '同一件事' },
  { existing: '交水电费', incoming: '交这个月水电费', why: '只是加了时间限定' },
];

/**
 * 🔴 难档：**同一个意图，但字面几乎不重叠**。
 *
 * 这一档的失败率才是决定"要不要向量库"的那个数字。
 * 每条都刻意让它与库中那条**没有一个共享的实词**。
 */
const DUPLICATE_HARD: Pair[] = [
  { existing: '准备季度汇报', incoming: '做 Q3 review 要用的 PPT', why: '同一件事换说法' },
  { existing: '买牛奶', incoming: '去超市补点早餐的东西', why: '同一趟采购换说法' },
  { existing: '预约牙医', incoming: '看牙的事得安排一下', why: '同一件事换说法' },
  { existing: '修复登录 bug', incoming: '用户反映登不进去，得查一下', why: '同一件事换说法' },
  { existing: '整理季度预算表', incoming: '把这段时间花的钱汇总一下', why: '同一件事换说法' },
  { existing: '给妈妈打电话', incoming: '跟家里联系一下', why: '同一件事换说法' },
  { existing: '准备周一的评审', incoming: '明天开会要讲的东西还没弄', why: '同一件事换说法' },
  { existing: '把旧手机数据清掉', incoming: '手机要出二手，先处理干净', why: '同一件事换说法' },
];

/** 干扰/陷阱：字面像、但**不是**同一个意图 —— 测误报。 */
const NON_DUPLICATE: Pair[] = [
  { existing: '写周报', incoming: '写一个周报模板给新人用', why: '一个是写，一个是做模板' },
  { existing: '买牛奶', incoming: '买牛奶收纳盒', why: '买的是容器不是牛奶' },
  { existing: '预约牙医', incoming: '关掉牙医公众号的推送', why: '完全不同的事' },
  { existing: '修复登录 bug', incoming: '换掉登录页的 logo', why: '同页面，不同工作' },
  { existing: '整理季度预算表', incoming: '制定预算表的历史归档规则', why: '一个是做表，一个是定规则' },
  { existing: '交水电费', incoming: '把水电费改成自动扣款', why: '一个是交，一个是改设置' },
  { existing: '给团队订周五的会议室', incoming: '取消周五的会议室预订', why: '动作相反' },
  { existing: '检查服务器磁盘占用', incoming: '给服务器加一块硬盘', why: '一个是看，一个是买' },
];

/**
 * 判定为"重复"的阈值。
 *
 * ⚠️ 这是**拍的**，不是调出来的。把它调低会提高召回、也会提高误报 ——
 * 下面会同时报出两档召回与误报率，正是为了让这个取舍**可见**，
 * 而不是藏在一个"最优阈值"后面。
 */
const DUPLICATE_THRESHOLD = 0.35;

// ─────────────────────────────────────────────────────────────
// 实验执行
// ─────────────────────────────────────────────────────────────

/** 把库中任务 + 干扰项一起当作检索池。 */
const pool = [
  ...new Set([
    ...DUPLICATE_EASY.map((p) => p.existing),
    ...DUPLICATE_HARD.map((p) => p.existing),
    ...NON_DUPLICATE.map((p) => p.existing),
    ...DISTRACTORS,
  ]),
].map((text, i) => ({ id: `t${i}`, text }));

const idOf = (text: string): string => {
  const found = pool.find((c) => c.text === text);
  if (found === undefined) throw new Error(`语料里没有这条：${text}`);
  return found.id;
};

interface Outcome {
  pair: Pair;
  /** 与库中对应那条的相似度。 */
  selfScore: number;
  /** 基线给出的第一名是谁、多少分。 */
  topId: string | undefined;
  topScore: number;
  /** 是否判定为重复（self 那条进入 top-k 且过阈值）。 */
  detected: boolean;
}

function run(pairs: readonly Pair[]): Outcome[] {
  return pairs.map((pair) => {
    const targetId = idOf(pair.existing);
    const hits = findSimilar(pair.incoming, pool, { k: 3, minScore: 0 });
    const selfScore = similarity(pair.incoming, pair.existing);
    const top = hits[0];
    return {
      pair,
      selfScore,
      topId: top?.id,
      topScore: top?.score ?? 0,
      detected: selfScore >= DUPLICATE_THRESHOLD,
    };
  });
}

const easy = run(DUPLICATE_EASY);
const hard = run(DUPLICATE_HARD);
const nonDup = run(NON_DUPLICATE);

const recall = (rows: readonly Outcome[]): number =>
  rows.filter((r) => r.detected).length / rows.length;

const falsePositiveRate = (rows: readonly Outcome[]): number =>
  rows.filter((r) => r.detected).length / rows.length;

const pct = (n: number): string => `${(n * 100).toFixed(0)}%`;

/** 汇总报告 —— **始终打印**，不受断言影响。 */
function report(): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('══════════ 词法基线 vs 重复检测：实测结果 ══════════');
  lines.push(`语料规模：${pool.length} 条（含 ${DISTRACTORS.length} 条无关干扰项）`);
  lines.push(`判定阈值：相似度 >= ${DUPLICATE_THRESHOLD}`);
  lines.push('');
  lines.push(`  易档召回（字面重叠，n=${easy.length}）      ：${pct(recall(easy))}`);
  lines.push(`  🔴 难档召回（语义相同、零字面重叠，n=${hard.length}）：${pct(recall(hard))}`);
  lines.push(`  误报率（字面像但不是同一件事，n=${nonDup.length}）：${pct(falsePositiveRate(nonDup))}`);
  lines.push('');
  lines.push('  ── 易档逐条 ──');
  for (const r of easy) {
    lines.push(
      `   ${r.detected ? '✅' : '❌'} ${r.selfScore.toFixed(3)}  ${r.pair.existing}  ↔  ${r.pair.incoming}`,
    );
  }
  lines.push('  ── 🔴 难档逐条（这一档才是决定性的）──');
  for (const r of hard) {
    lines.push(
      `   ${r.detected ? '✅' : '❌'} ${r.selfScore.toFixed(3)}  ${r.pair.existing}  ↔  ${r.pair.incoming}`,
    );
  }
  lines.push('  ── 误报逐条 ──');
  for (const r of nonDup) {
    lines.push(
      `   ${r.detected ? '🔴误报' : '✅正确放过'} ${r.selfScore.toFixed(3)}  ${r.pair.existing}  ↔  ${r.pair.incoming}`,
    );
  }
  lines.push('════════════════════════════════════════════════════');
  lines.push('');
  return lines.join('\n');
}

describe('🔴 实验：词法基线够不够用（决定要不要向量库）', () => {
  it('始终打印实测报告', () => {
    // eslint-disable-next-line no-console
    console.log(report());
    expect(pool.length).toBeGreaterThan(20);
  });

  /**
   * 🔴 **守门测试：基线必须是"真能用的"，不是稻草人。**
   *
   * 如果连字面重叠的重复都认不出来，那问题出在**我的实现**，
   * 而不是"词法方法不行" —— 那样后面所有关于难档的结论都不成立。
   *
   * 阈值取 75%：允许漏 2 条，但不允许整体失效。
   */
  it('守门：易档召回必须够高（否则基线是稻草人，实验无效）', () => {
    expect(recall(easy)).toBeGreaterThanOrEqual(0.75);
  });

  /**
   * 🔴 难档召回：**钉住实测值**，不假装它很高。
   *
   * 这个断言的作用是**回归保护**：将来有人改了 `recall.ts`，
   * 这个数字掉了会被立刻发现。
   *
   * ⚠️ 它**不是**"难档应该达到多少"的目标 —— 它的值来自实测。
   */
  it('🔴 难档召回：钉住实测值 0%（这是支持向量库的唯一论据，不许隐瞒）', () => {
    const r = recall(hard);
    // 实测：8 条里 0 条命中（唯一非零的「把旧手机数据清掉」也只有 0.125）。
    // 钉死为 0 是**故意**的：它把"词法基线搞不定换说法"这件事变成
    // 一个会红的回归点。将来若引入语义匹配，这个断言必须被**有意识地**改写。
    expect(r).toBe(0);
  });

  it('误报率：钉住实测值 25%（"订会议室" vs "取消会议室" 被判为重复）', () => {
    const r = falsePositiveRate(nonDup);
    expect(r).toBeCloseTo(0.25, 5);
    // 最恶劣的一条：动作相反却被判为同一件事 —— 上生产会真的误导用户。
    const opposite = nonDup.find((x) => x.pair.existing.includes('订周五'));
    expect(opposite?.detected).toBe(true);
  });

  /**
   * 🔴 **本实验的结论**（由上面的实测数字推出，不是先有结论再凑数据）
   *
   * | 档位 | 实测 | 含义 |
   * |---|---|---|
   * | 易档（字面重叠） | **100%** | 词法基线在"用户复用了词"时完全够用 |
   * | 🔴 难档（换说法） | **0%** | 词法基线**彻底失效** |
   * | 误报 | **25%** | 还会把**相反**的动作判成同一件事 |
   *
   * 我原本的预判是"不需要向量库"。实验**部分推翻**了它：
   * 在"跨措辞的语义匹配"这件事上，纯词法确实不行。
   *
   * **但"词法不行"不等于"要上向量库"** —— 因为它同时暴露了一条更便宜的路径：
   * 需要语义判断的地方，**用已经配置好的那个模型直接判**即可，
   * 不需要为它建一套检索基础设施。理由见 `docs/research/` 与 ai-strategy §4.1：
   * ① heyta 的任务量级是数百条，候选集可以整份给模型 —— 不需要 ANN 索引；
   * ② 向量库要额外引入**明文派生物**（embedding 本身泄漏语义），
   *    正是 ADR-0005 反复警告的东西；
   * ③ 主流向量库要么依赖 WebAssembly（Hermes 直接出局），要么需要独立服务。
   *
   * ⚠️ 本组 n=8，**只能定性**。它是"第一刀"，不是最终结论。
   */
  it('实验结论：难档的失败不指向向量库，而指向"用模型判、不用索引查"', () => {
    // 把结论本身编码成一条可保护的断言：
    // 若有一天有人让难档的召回变高（真上了语义匹配），
    // 这条会红 —— 强迫他回来重读上面的推理并更新结论。
    expect(recall(hard)).toBeLessThan(0.5);
  });
});
