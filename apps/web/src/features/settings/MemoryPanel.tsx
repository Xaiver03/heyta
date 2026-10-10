import { AssistantIcon } from '../ai/AssistantIcon.js';
import { ICON_SIZE } from '@heyta/design-system';
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

import { EyeOff, RotateCcw, X } from 'lucide-react';

import { useI18n } from '@heyta/i18n';

import { preferenceEvidenceCopy, preferenceLabelText, withheldCopy } from './preference-copy.js';

import {
  describeSuppressed,
  suppressedPreferenceIds,
  type FeedbackPreferenceSet,
  type FocusGap,
  type Preference,
  type PreferenceSet,
} from '@heyta/domain';

/**
 * 一条纠正记录（界面需要 id 才能撤销）。
 *
 * ⚠️ `deletedAt` 必须带上 —— 见下面 `suppressedPreferenceIds` 的用法。
 */
export interface CorrectionEntry {
  readonly id: string;
  readonly preferenceId: string;
  readonly kind: 'suppress';
  /** 墓碑：撤销过的纠正。**存在即表示这条纠正已经不算数了。** */
  readonly deletedAt?: number;
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
  /**
   * 「说的 vs 做的」落差（领域层 `computeFocusGaps()` 的**结构化**结果）。
   *
   * 三态是刻意的，不能用"空数组"兼任：
   *   - `undefined` → 调用方没接这条线，**整个区块不渲染**（老调用方/单测不受影响）；
   *   - `null` → 事件流读不到，**如实说"暂时算不出推迟次数"**，
   *     而不是把"算不出"渲染成"推迟 0 次"（那是编造）；
   *   - 数组 → 正常展示；空数组走**诚实的空状态**，不留一个空白区块
   *     （空白会被读成"坏了"）。
   *
   * 🔴 只接受结构化落差。领域层的 `describeFocusGaps()` 返回中文句子，
   * **不许渲染**（英文界面会露中文）—— 同 `evidenceFacts` 那一套。
   */
  focusGaps?: readonly FocusGap[] | null;
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
  const { t } = useI18n();
  // 🔴 依据**从结构化事实现拼**，不渲染 `preference.evidence` ——
  // 那是领域层拼好的中文，英文界面会露中文（第 14 轮修的就是这条）。
  const evidence = preferenceEvidenceCopy(preference.evidenceFacts, t);
  return (
    <li className="ht-settings__item" data-testid={`memory-pref-${id}`}>
      <span className="ht-settings__toggle-body">
        <span className="ht-settings__toggle-label">{preferenceLabelText(id, t)}</span>
        {/* 🔴 显示**依据原文**（含样本量），不是只给结论。
            用户要能判断"这说得对不对"，才谈得上纠正。 */}
        <span className="ht-settings__hint" data-testid={`memory-evidence-${id}`}>
          {t(evidence.key, evidence.params)}
        </span>
      </span>
      <button
        type="button"
        className="ht-btn ht-btn--ghost"
        data-testid={`memory-forget-${id}`}
        aria-label={t('web.memory.forgetAria', { name: preferenceLabelText(id, t) })}
        onClick={() => onSuppress(id)}
      >
        <EyeOff size={ICON_SIZE.xs} aria-hidden="true" />
        {t('web.memory.forget')}
      </button>
    </li>
  );
}

export function MemoryPanel(props: MemoryPanelProps): React.JSX.Element {
  const {
    memoryEnabled,
    preferenceSet,
    feedbackSet,
    rawPresentIds,
    corrections,
    focusGaps,
    onSuppress,
    onRestore,
  } = props;
  const { t } = useI18n();

  if (!memoryEnabled) {
    return (
      <p className="ht-settings__hint" data-testid="memory-off-note">
        {t('web.memory.off')}
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

  /**
   * 🔴 抑制集合**必须用领域层那个函数算**，不要在这里自己 `map`。
   *
   * 我第一版就是自己写的 `new Set(corrections.map(c => c.preferenceId))` ——
   * 那会把**墓碑记录**也算成"正在抑制"。而 `applyPreferenceCorrections`
   * （App 里真正把偏好置空的那一步）用的是 `suppressedPreferenceIds()`，
   * 它会跳过墓碑。
   *
   * 两套规则 ⇒ 两套结论，后果很具体：**点了「恢复」之后，偏好回到了
   * 「我了解到的你」，却同时还挂在「你已忘记」里** —— 界面上自相矛盾，
   * 而且用户再也删不掉它（他以为已经恢复，实际两边都在）。
   *
   * 真实用户旅程测试抓到了它。单测抓不到，因为单测喂进来的 `corrections`
   * 本来就是干净的、不含墓碑。
   */
  const suppressedSet = suppressedPreferenceIds(corrections);
  const forgotten = describeSuppressed(rawPresentIds, suppressedSet);
  /** 只在**未墓碑**的纠正里找 —— 撤销过的不能再被撤销第二次。 */
  const correctionIdOf = (preferenceId: string): string | undefined =>
    corrections.find((c) => c.preferenceId === preferenceId && c.deletedAt === undefined)?.id;

  return (
    <div className="ht-settings__section" data-testid="memory-panel">
      {/* ── 我了解到的你 ─────────────────────────────────────── */}
      <h3 className="ht-settings__subtitle">
        <AssistantIcon size={ICON_SIZE.xs} aria-hidden="true" /> {t('web.memory.known.title')}
      </h3>

      {known.length === 0 ? (
        <p className="ht-settings__hint" data-testid="memory-nothing-known">
          {t('web.memory.known.empty')}
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
          <h3 className="ht-settings__subtitle">{t('web.memory.withheld.title')}</h3>
          <ul className="ht-settings__list" data-testid="memory-withheld">
            {withheld.map((w) => {
              // 🔴 原因**从结构化字段现拼**（`reason` + `id` + `remaining`）——
              // 领域层那句中文在第 15 轮搬进了词条表。
              const copy = withheldCopy(w);
              return (
                <li className="ht-settings__item" key={w.id}>
                  <span className="ht-settings__toggle-body">
                    <span className="ht-settings__toggle-label">
                      {preferenceLabelText(w.id, t)}
                    </span>
                    {/* 如实说明还缺什么，而不是编一个"平均用户"顶上 */}
                    <span className="ht-settings__hint">{t(copy.key, copy.params)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* ── 说的 vs 做的（记忆护城河的事实层）────────────────── */}
      {/*
        🔴 这一区就是"把护城河接到用户眼前"的落点：`computeFocusGaps` 此前
        **零生产调用点**，算得再准用户也看不到。渲染的是**结构化字段**，
        不是领域层 `describeFocusGaps()` 拼好的中文。
      */}
      {focusGaps !== undefined && (
        <>
          <h3 className="ht-settings__subtitle">{t('web.memory.gap.title')}</h3>
          <p className="ht-settings__hint">{t('web.memory.gap.note')}</p>

          {focusGaps === null ? (
            /* 读不到事件流时的**诚实降级**：推迟次数算不出来，说"0 次"就是编造。 */
            <p className="ht-settings__hint" data-testid="memory-gap-unavailable">
              {t('web.memory.gap.unavailable')}
            </p>
          ) : focusGaps.length === 0 ? (
            /* 空状态必须诚实：没有落差就明说，**不要**留一个空白区块。 */
            <p className="ht-settings__hint" data-testid="memory-gap-empty">
              {t('web.memory.gap.empty')}
            </p>
          ) : (
            <ul className="ht-settings__list" data-testid="memory-gap-list">
              {focusGaps.map((gap) => (
                <li
                  className="ht-settings__item"
                  key={gap.taskId}
                  data-testid={`memory-gap-${gap.taskId}`}
                >
                  <span className="ht-settings__toggle-body">
                    {/* 标题是用户自己的文字（任务标题），不是领域层的投影。 */}
                    <span className="ht-settings__toggle-label">{gap.title}</span>
                    {/*
                      🔴 每条至少给三件事：声明了什么、实际投入多少、以及"为什么"
                      （推迟次数 / 逾期天数）。全部由结构化字段 + 词条现拼。
                    */}
                    <span className="ht-settings__hint tabular-nums">
                      {t('web.memory.gap.declared', { declared: gap.declared })}
                    </span>
                    <span className="ht-settings__hint tabular-nums">
                      {t('web.memory.gap.focusMinutes', {
                        minutes: Math.round(gap.focusMinutes),
                      })}
                    </span>
                    {gap.postponements > 0 && (
                      <span
                        className="ht-settings__hint tabular-nums"
                        data-testid={`memory-gap-postponed-${gap.taskId}`}
                      >
                        {/* 英文按数量分支到单数兄弟（词条表刻意不支持 ICU）。 */}
                        {t(
                          gap.postponements === 1
                            ? 'web.memory.gap.postponedOne'
                            : 'web.memory.gap.postponed',
                          { count: gap.postponements },
                        )}
                      </span>
                    )}
                    {gap.overdueDays !== null && (
                      <span
                        className="ht-settings__hint tabular-nums"
                        data-testid={`memory-gap-overdue-${gap.taskId}`}
                      >
                        {t(
                          gap.overdueDays === 1
                            ? 'web.memory.gap.overdueOne'
                            : 'web.memory.gap.overdue',
                          { days: gap.overdueDays },
                        )}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* ── 你已忘记（必须能恢复）───────────────────────────── */}
      {forgotten.length > 0 && (
        <>
          <h3 className="ht-settings__subtitle">{t('web.memory.forgotten.title')}</h3>
          <ul className="ht-settings__list" data-testid="memory-forgotten">
            {forgotten.map((f) => (
              <li className="ht-settings__item" key={f.id}>
                <span className="ht-settings__toggle-body">
                  {/* `f.label` 是领域层拼好的中文；按 id 取词条。 */}
                  <span className="ht-settings__toggle-label">
                    {preferenceLabelText(f.id, t)}
                  </span>
                  <span className="ht-settings__hint">{t('web.memory.forgotten.note')}</span>
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
                  <RotateCcw size={ICON_SIZE.xs} aria-hidden="true" />
                  {t('web.memory.restore')}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="ht-settings__hint">
        <X size={ICON_SIZE.xs} aria-hidden="true" /> {t('web.memory.footer')}
      </p>
    </div>
  );
}
