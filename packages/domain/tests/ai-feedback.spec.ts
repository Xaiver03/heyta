/**
 * AI 反馈层（P6 / P7）—— 单元 + 留出法验证
 * ==========================================
 *
 * ## 这个文件要回答的问题
 *
 * 第一批五条偏好全部来自「用户自己的数据」。但有一类偏好从那里推不出来：
 * **AI 该怎么为用户工作**。你习惯写 6 项清单，不等于 AI 给你 6 项时你会满意。
 *
 * 这个差距只能从「你怎么处置 AI 的建议」里看出来。而在此之前，
 * `AiBreakdown` **不记录任何反馈** —— 建议被采用还是被丢掉，代码里没有痕迹。
 *
 * ## 为什么带一个实验段
 *
 * 「AI 从反馈里学会你的粒度」听起来同样天生正确，所以同样容易自证。
 * 这里沿用 `preferences-experiment.spec.ts` 的纪律：
 * **留出法 + 与"不认识你"的基线比 + 纯噪声上必须不产出偏好**。
 * 不优于基线的偏好要删掉，而不是留着好看。
 */

import { describe, expect, it } from 'vitest';
import {
  emptyFeedbackPreferenceSet,
  inferFeedbackPreferences,
  inferGranularityFromFeedback,
  inferKeepRatio,
  type AiFeedbackRow,
} from '../src/ai-feedback.js';

const ON = { memoryEnabled: true } as const;

/** 造一行反馈。 */
function row(over: Partial<AiFeedbackRow> = {}): AiFeedbackRow {
  return {
    feature: 'breakdown',
    outcome: 'accepted',
    proposedCount: 6,
    appliedCount: 6,
    ...over,
  };
}

const repeat = <T>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));

// ─────────────────────────────────────────────────────────────
// 主开关
// ─────────────────────────────────────────────────────────────

describe('反馈层：主开关是唯一入口', () => {
  it('🔴 关闭时返回空集 —— 连 withheld 都是空的', () => {
    const set = inferFeedbackPreferences({
      memoryEnabled: false,
      feedback: repeat(50, () => row()),
    });
    expect(set).toEqual(emptyFeedbackPreferenceSet(false));
    expect(set.feedbackGranularity).toBeNull();
    expect(set.keepRatio).toBeNull();
    expect(set.withheld).toEqual([]);
  });

  it('关闭时即使反馈数据全是信号也不推断', () => {
    // 30 次「提议 10 项、只留 3 项」是极强的信号
    const strong = repeat(30, () => row({ proposedCount: 10, appliedCount: 3, outcome: 'modified' }));
    expect(inferFeedbackPreferences({ memoryEnabled: false, feedback: strong }).keepRatio).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// P6 拆解粒度（来自反馈）
// ─────────────────────────────────────────────────────────────

describe('反馈层 P6：你采纳的拆解通常几项', () => {
  it('稳定 4 项 → 推断出 4', () => {
    const { preference } = inferGranularityFromFeedback({
      ...ON,
      feedback: repeat(20, () => row({ proposedCount: 10, appliedCount: 4, outcome: 'modified' })),
    });
    expect(preference?.value).toBe(4);
    expect(preference?.evidence).toContain('4 项');
  });

  it('🔴 被拒绝的建议不表达「你要几项」（不参与）', () => {
    const rows = [
      ...repeat(20, () => row({ appliedCount: 4, outcome: 'modified' })),
      // 20 条拒绝，appliedCount 是 0 —— 若算进去会把中位数拉低
      ...repeat(20, () => row({ outcome: 'rejected', appliedCount: 0 })),
    ];
    expect(inferGranularityFromFeedback({ ...ON, feedback: rows }).preference?.value).toBe(4);
  });

  it('已删除的反馈不参与', () => {
    const rows = repeat(20, () => row({ deletedAt: 1 }));
    expect(inferGranularityFromFeedback({ ...ON, feedback: rows }).withheld?.reason).toBe('no-data');
  });

  it('别的功能的反馈不参与（按 feature 过滤）', () => {
    const rows = repeat(20, () => row({ feature: 'prioritize' }));
    expect(inferGranularityFromFeedback({ ...ON, feedback: rows }).withheld?.reason).toBe('no-data');
  });

  it('完全没有反馈 → no-data，且文案说明还缺什么', () => {
    const { withheld } = inferGranularityFromFeedback({ ...ON, feedback: [] });
    expect(withheld?.reason).toBe('no-data');
    expect(withheld?.detail).toContain('采纳');
  });

  it('样本不够 → not-enough-samples，并如实说明还差几次', () => {
    const rows = repeat(3, () => row({ appliedCount: 4, outcome: 'modified' }));
    const { withheld } = inferGranularityFromFeedback({ ...ON, feedback: rows });
    expect(withheld?.reason).toBe('not-enough-samples');
    expect(withheld?.detail).toContain('5');
  });

  it('项数忽多忽少 → not-stable-enough（不硬给一个中位数）', () => {
    const rows = repeat(24, (i) => row({ appliedCount: 1 + (i % 12), outcome: 'modified' }));
    expect(inferGranularityFromFeedback({ ...ON, feedback: rows }).withheld?.reason).toBe(
      'not-stable-enough',
    );
  });
});

// ─────────────────────────────────────────────────────────────
// P7 保留率
// ─────────────────────────────────────────────────────────────

describe('反馈层 P7：你留下 AI 提议的几成', () => {
  it('全部保留（6/6）→ 保留率 1，文案说「几乎总是全部保留」', () => {
    const { preference } = inferKeepRatio({ ...ON, feedback: repeat(20, () => row()) });
    expect(preference?.value).toBe(1);
    expect(preference?.evidence).toContain('全部保留');
  });

  it('只留三成 → 文案点明「AI 给得太多了」', () => {
    const rows = repeat(20, () => row({ proposedCount: 10, appliedCount: 3, outcome: 'modified' }));
    const { preference } = inferKeepRatio({ ...ON, feedback: rows });
    expect(preference?.value).toBeCloseTo(0.3, 2);
    expect(preference?.evidence).toContain('太多了');
  });

  it('🔴 拒绝**不参与**保留率（含义是歧义的，见文件头）', () => {
    const rows = [
      ...repeat(20, () => row({ proposedCount: 10, appliedCount: 9, outcome: 'modified' })),
      ...repeat(20, () => row({ outcome: 'rejected', appliedCount: 0 })),
    ];
    // 拒绝若算成 0，保留率会被拉到 0.45；正确的答案是 0.9
    expect(inferKeepRatio({ ...ON, feedback: rows }).preference?.value).toBeCloseTo(0.9, 2);
  });

  it('proposedCount 为 0 的行不参与（避免除零）', () => {
    const rows = repeat(20, () => row({ proposedCount: 0, appliedCount: 0 }));
    expect(inferKeepRatio({ ...ON, feedback: rows }).withheld?.reason).toBe('no-data');
  });

  it('保留率波动太大 → not-stable-enough', () => {
    const rows = repeat(24, (i) => row({ proposedCount: 10, appliedCount: i % 2 === 0 ? 1 : 10 }));
    expect(inferKeepRatio({ ...ON, feedback: rows }).withheld?.reason).toBe('not-stable-enough');
  });
});

// ─────────────────────────────────────────────────────────────
// 汇总与纯度
// ─────────────────────────────────────────────────────────────

describe('反馈层：汇总', () => {
  it('九条都不满足时 withheld 会收齐原因（不是只报第一条）', () => {
    const set = inferFeedbackPreferences({ ...ON, feedback: [] });
    expect(set.withheld).toHaveLength(2);
    expect(set.withheld.map((w) => w.id).sort()).toEqual(['feedback-granularity', 'feedback-keep-ratio']);
  });

  it('🔴 纯函数：同样的输入产生完全相同的输出', () => {
    const rows = repeat(20, () => row({ proposedCount: 8, appliedCount: 4, outcome: 'modified' }));
    const a = inferFeedbackPreferences({ ...ON, feedback: rows });
    const b = inferFeedbackPreferences({ ...ON, feedback: rows });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('不修改入参数组', () => {
    const rows = [row({ appliedCount: 3, outcome: 'modified' })];
    const snapshot = JSON.stringify(rows);
    inferFeedbackPreferences({ ...ON, feedback: rows });
    expect(JSON.stringify(rows)).toBe(snapshot);
  });

  it('超长输入被截断成最近 500 条（防止 O(n) 变慢）', () => {
    // 前 600 条是 10 项，后 500 条是 2 项 —— 截断后应当只看后者
    const rows = [
      ...repeat(600, () => row({ appliedCount: 10, outcome: 'modified' })),
      ...repeat(500, () => row({ appliedCount: 2, outcome: 'modified' })),
    ];
    expect(inferGranularityFromFeedback({ ...ON, feedback: rows }).preference?.value).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────
// 🔴 留出法验证：它真的能预测，还是我在编？
// ─────────────────────────────────────────────────────────────

/** 确定性 PRNG（不用 Math.random，否则失败不可复现）。 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('🔴 留出法：反馈层的偏好能预测未来，还是只是拟合过去', () => {
  it('有信号：训练集推断 → 在测试集上预测，必须优于基线', () => {
    const rnd = mulberry32(20260926);
    // 真实偏好：用户想要 4 项
    const TRUE_COUNT = 4;
    const rows = repeat(60, () => {
      const proposed = 3 + Math.floor(rnd() * 8); // AI 提议 3–10 项
      // 用户留下 4 项（或更少，如果 AI 给的不够）
      const applied = Math.min(proposed, Math.max(1, TRUE_COUNT + (rnd() < 0.15 ? 1 : 0)));
      return row({
        proposedCount: proposed,
        appliedCount: applied,
        outcome: applied === proposed ? 'accepted' : 'modified',
      });
    });

    const train = rows.slice(0, 48);
    const test = rows.slice(48);
    const { preference } = inferGranularityFromFeedback({ ...ON, feedback: train });
    expect(preference, '有信号时必须推断出来（否则这条偏好没有价值）').not.toBeNull();

    const predicted = preference?.value ?? 5;

    const mae = (predict: (r: AiFeedbackRow) => number): number =>
      test.reduce((sum, r) => sum + Math.abs(predict(r) - r.appliedCount), 0) / test.length;

    // 基线 = "不认识你"：猜中间值 5 项
    const BASELINE = 5;
    const prefMae = mae(() => predicted);
    const baseMae = mae(() => BASELINE);

    // eslint-disable-next-line no-console -- 实验必须打印真实数字，不能只断言
    console.log(
      `\n[反馈层留出法] 训练 ${train.length} / 测试 ${test.length}\n` +
        `  P6 推断出 ${predicted}（真实 ${TRUE_COUNT}）\n` +
        `  偏好 MAE ${prefMae.toFixed(3)} vs 基线 MAE ${baseMae.toFixed(3)}\n`,
    );

    expect(prefMae).toBeLessThan(baseMae);
  });

  it('🔴 纯噪声：完全随机的处置**不许**产出偏好', () => {
    const rnd = mulberry32(7);
    const rows = repeat(60, () => {
      const proposed = 2 + Math.floor(rnd() * 10);
      const applied = 1 + Math.floor(rnd() * proposed);
      return row({
        proposedCount: proposed,
        appliedCount: applied,
        outcome: rnd() < 0.3 ? 'rejected' : applied === proposed ? 'accepted' : 'modified',
      });
    });
    const { feedbackGranularity, keepRatio } = inferFeedbackPreferences({ ...ON, feedback: rows });

    // eslint-disable-next-line no-console -- 实验必须打印真实数字
    console.log(
      `\n[反馈层噪声] P6=${feedbackGranularity === null ? '正确扣下' : `误报 ${feedbackGranularity.value}`}` +
        `  P7=${keepRatio === null ? '正确扣下' : `误报 ${keepRatio.value.toFixed(2)}`}\n`,
    );

    // 两条都必须扣下。这条**必须**和上面的"有信号"成对阅读：
    // 单看这条，一个永远返回 null 的实现也能通过。
    expect(feedbackGranularity).toBeNull();
    expect(keepRatio).toBeNull();
  });
});
