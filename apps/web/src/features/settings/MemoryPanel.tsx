/**
 * 记忆面板：「我了解到的你」+ 还不了解 + 你已忘记
 * ==================================================
 *
 * ## 这个面板为什么是必需的，而不是"锦上添花"
 *
 * 偏好层与事实层（`memory.ts`）最关键的区别是：
 *
 * | | 事实层 | 偏好层 |
 * |---|---|---|
 * | 确定性 | 算得准 | **一定会错** |
 * | 错了的代价 | 小（本机数字） | **大**（污染每一次 AI 交互） |
 * | 因此必须 | 不必展示 | **可见、可纠正** |
 *
 * 所以"用户能看见并改"不是附加功能，而是**这一层能存在的前提**。
 * 一个用户看不见也改不了的推断系统，等于悄悄替他做了个错误决定。
 *
 * ## 三个区分的状态，不能合并
 *
 * 1. **我了解到的你** —— 算出来了，附**依据原文**（`evidence`）。
 *    给依据而不是只给结论，用户才能判断"这说得对不对"。
 * 2. **还不了解** —— 数据不够。如实说还缺多少，**不编**。
 * 3. **你已忘记** —— 用户亲手抑制的。必须能**恢复**，否则一次误点就是永久的。
 *
 * ⚠️ 第 2 与第 3 合并的话，用户会看到"我还需要 5 次专注"出现在一条
 * 他刚刚删掉的偏好上 —— 那看起来就像系统没听见他说话。
 *
 * ## 本面板不发任何数据出去
 *
 * 它读的全部是本机从 op-log 派生的结果。抑制/恢复写的是 op-log
 * （所以跨设备同步），但那是**同步**，不是**出境**。
 */

import { EyeOff, RotateCcw, Sparkles, X } from 'lucide-react';

import {
  describeSuppressed,
  preferenceLabel,
  type FeedbackPreferenceSet,
  type Preference,
  type PreferenceSet,
} from '@heyta/domain';

/** 一条纠正记录（界面需要 id 才能撤销）。 */
export interface CorrectionEntry {
  readonly id: string;
  readonly preferenceId: string;
}

export interface MemoryPanelProps {
  /** 主开关。关闭时整个面板只说明"已关闭"，不展示任何推断。 */
  memoryEnabled: boolean;
  /** **已应用纠正之后**的偏好集（界面展示的就是它）。 */
  preferenceSet: PreferenceSet;
  feedbackSet: FeedbackPreferenceSet;
  /**
   * 🔴 **纠正之前**的偏好 id 列表。
   *
   * 必须单独传：被抑制的偏好已经不在 `preferenceSet` 里了，
   * 拿它去算"你已忘记"会永远为空 —— 于是恢复入口根本不出现。
   */
  rawPresentIds: readonly string[];
  corrections: readonly CorrectionEntry[];
  onSuppress: (preferenceId: string) => void;
  onRestore: (correctionId: string) => void;
}

/** 展示一条偏好：中文名 + 依据 + 忘掉按钮。 */
function PreferenceRow({
  id,
  preference,
  onSuppress,
}: {
  id: string;
  preference: Preference<unknown>;
  onSuppress: (id: string) => void;
}): React.JSX.Element {
  return (
    <li className="ht-settings__item" data-testid={`memory-pref-${id}`}>
      <span className="ht-settings__toggle-body">
        <span className="ht-settings__toggle-label">{preferenceLabel(id)}</span>
        {/* 🔴 显示**依据原文**（含样本量），不是只给结论。
            用户要能判断"这说得对不对"，才谈得上纠正。 */}
        <span className="ht-settings__hint" data-testid={`memory-evidence-${id}`}>
          {preference.evidence}
        </span>
      </span>
      <button
        type="button"
        className="ht-btn ht-btn--ghost"
        data-testid={`memory-forget-${id}`}
        aria-label={`忘掉「${preferenceLabel(id)}」`}
        onClick={() => onSuppress(id)}
      >
        <EyeOff size={12} aria-hidden="true" />
        忘掉
      </button>
    </li>
  );
}

export function MemoryPanel(props: MemoryPanelProps): React.JSX.Element {
  const { memoryEnabled, preferenceSet, feedbackSet, rawPresentIds, corrections, onSuppress, onRestore } =
    props;

  if (!memoryEnabled) {
    return (
      <p className="ht-settings__hint" data-testid="memory-off-note">
        记忆已关闭 —— heyta 不会推断你的偏好，AI 也收不到任何与「你是谁」有关的信息。
        AI 功能本身照常可用。
      </p>
    );
  }

  const known: { id: string; preference: Preference<unknown> }[] = [];
  const push = (id: string, p: Preference<unknown> | null): void => {
    if (p !== null) known.push({ id, preference: p });
  };
  push('estimate-bias', preferenceSet.estimateBias);
  push('deep-work-window', preferenceSet.deepWorkWindow);
  push('lead-time', preferenceSet.leadTime);
  push('granularity', preferenceSet.granularity);
  push('title-style', preferenceSet.titleStyle);
  push('feedback-granularity', feedbackSet.feedbackGranularity);
  push('feedback-keep-ratio', feedbackSet.keepRatio);

  const withheld = [...preferenceSet.withheld, ...feedbackSet.withheld];
  const suppressedSet = new Set(corrections.map((c) => c.preferenceId));
  const forgotten = describeSuppressed(rawPresentIds, suppressedSet);
  const correctionIdOf = (preferenceId: string): string | undefined =>
    corrections.find((c) => c.preferenceId === preferenceId)?.id;

  return (
    <div className="ht-settings__section" data-testid="memory-panel">
      {/* ── 我了解到的你 ─────────────────────────────────────── */}
      <h3 className="ht-settings__subtitle">
        <Sparkles size={12} aria-hidden="true" /> 我了解到的你
      </h3>

      {known.length === 0 ? (
        <p className="ht-settings__hint" data-testid="memory-nothing-known">
          我还不太了解你。用一段时间之后，这里会出现我从你自己数据里总结出的习惯。
        </p>
      ) : (
        <ul className="ht-settings__list" data-testid="memory-known">
          {known.map(({ id, preference }) => (
            <PreferenceRow key={id} id={id} preference={preference} onSuppress={onSuppress} />
          ))}
        </ul>
      )}

      {/* ── 还不了解 ─────────────────────────────────────────── */}
      {withheld.length > 0 && (
        <>
          <h3 className="ht-settings__subtitle">还不了解</h3>
          <ul className="ht-settings__list" data-testid="memory-withheld">
            {withheld.map((w) => (
              <li className="ht-settings__item" key={w.id}>
                <span className="ht-settings__toggle-body">
                  <span className="ht-settings__toggle-label">{preferenceLabel(w.id)}</span>
                  {/* 如实说明还缺什么，而不是编一个"平均用户"顶上 */}
                  <span className="ht-settings__hint">{w.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* ── 你已忘记（必须能恢复）───────────────────────────── */}
      {forgotten.length > 0 && (
        <>
          <h3 className="ht-settings__subtitle">你已忘记</h3>
          <ul className="ht-settings__list" data-testid="memory-forgotten">
            {forgotten.map((f) => (
              <li className="ht-settings__item" key={f.id}>
                <span className="ht-settings__toggle-body">
                  <span className="ht-settings__toggle-label">{f.label}</span>
                  <span className="ht-settings__hint">我不会再用这一条。</span>
                </span>
                <button
                  type="button"
                  className="ht-btn ht-btn--ghost"
                  data-testid={`memory-restore-${f.id}`}
                  onClick={() => {
                    const cid = correctionIdOf(f.id);
                    if (cid !== undefined) onRestore(cid);
                  }}
                >
                  <RotateCcw size={12} aria-hidden="true" />
                  恢复
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="ht-settings__hint">
        <X size={12} aria-hidden="true" /> 这些推断只在本机进行，不上传。
        发给 AI 的只是当前那次决定需要的那一条摘要，并且会在发送前告诉你。
      </p>
    </div>
  );
}
