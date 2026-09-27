/**
 * 快速捕获输入框（含解析预览）
 * ==============================
 *
 * 这是 AI-1（捕获）的**确定性版本**。UI 层在这里只做三件事：
 * 收集输入、展示解析结果、调用写入动作。
 * **解析逻辑一行都不在这里** —— 它在 `@heyta/domain` 的 `capture.ts`。
 * 判据还是 AGENTS.md §3.5 那句：这里有没有任何一行在决定"业务上该怎么做"？
 * 没有。所以它留在 `apps/` 是合规的。
 *
 * 🔴 **为什么必须有预览，不能"直接落库"**
 *
 * 中文没有词边界，规则解析的误报是**结构性**的："明天启程"里的"明天"
 * 会被认成日期。如果输入框直接落 op，用户写的字就被悄悄删改，而且
 * **没有任何地方能告诉他发生了什么**。
 *
 * 所以本组件的契约是：
 *   1. **识别结果一律先显示。** 用户看得见"我读懂了什么"。
 *   2. **每一条都能单独取消**（点 ×），取消 = 把那几个字放回输入。
 *   3. **没被采纳的匹配会显式标成"未采用"** —— 否则用户会误以为它生效了。
 *
 * 这套"建议 → 用户确认 → 才落 op"的形状是**刻意先建出来的**：
 * 等 AI-1 真正接入模型时，要换的只是"谁来产生候选"，
 * 而不是重新设计一遍交互。ADR-0005 §3.1 的"A 建议、人确认"就是这个形状。
 */

import { useMemo, useState } from 'react';
import { Plus, RotateCcw, X } from 'lucide-react';

import { useI18n } from '@heyta/i18n';

import { dateWithRemaining } from '../ai/locale-punctuation.js';

import {
  Priority,
  diffDays,
  dueDateToEpoch,
  localDateTimeToEpoch,
  parseCapture,
  today,
  type AiFeedbackOutcome,
  type CaptureExclusion,
  type PreferenceSet,
} from '@heyta/domain';
import type {
  AiHealthSnapshot,
  AiRoutingConfig,
  EgressConsent,
  HealthMap,
  SecretStore,
} from '@heyta/ai';

import { AiCapture } from '../ai/AiCapture.js';
import { WEB_EMPTY_SECRET_STORE } from '../settings/aiStore.js';
import { useTaskStore } from '../tasks/store.js';
import { remainingText } from '../../lib/due-display.js';

/**
 * 接线所需的 AI 配置 —— 全部由 `App.tsx` 透传，本组件**不做任何判断**。
 *
 * 它们是可选的：不传就退化成纯确定性捕获（本组件的单测就是这么用的）。
 * 这样"AI 没配置"和"AI 关了"走的都是同一条路，不需要两套渲染。
 */
export interface CaptureComposerProps {
  routing?: AiRoutingConfig | undefined;
  consents?: readonly EgressConsent[] | undefined;
  secrets?: SecretStore | undefined;
  healthSnapshot?: AiHealthSnapshot | undefined;
  preferenceSet?: PreferenceSet | undefined;
  onHealth?: ((health: HealthMap) => void) | undefined;
  onFeedback?: ((feedback: {
    outcome: AiFeedbackOutcome;
    proposedCount: number;
    appliedCount: number;
  }) => void) | undefined;
}

/**
 * 优先级 → 可读文案。与 `capture.ts` 的 display 保持一致口径。
 *
 * ⚠️ 与 `AiPrioritize` 里的那份是**同一件事的第二个副本**（本轮不允许改
 * `packages/domain` 造成的）；只放显示文案，不参与任何判断。
 */
export function CaptureComposer(props: CaptureComposerProps): React.JSX.Element {
  const addTask = useTaskStore((s) => s.addTask);
  const { t, locale } = useI18n();
  /**
   * 一次渲染里的所有匹配行必须用**同一个"现在"**。
   *
   * 逐行各调一次 `Date.now()` 的话，跨零点时同一屏上的两行会算出不同的日期 ——
   * 与 `TasksScreen` 冻结 `now`、`DueBadge` 要求调用方传 `now` 是同一条纪律。
   */
  const previewNow = Date.now();
  const priorityLabel: Record<number, string> = {
    [Priority.High]: t('web.capture.priority.high'),
    [Priority.Medium]: t('web.capture.priority.medium'),
    [Priority.Low]: t('web.capture.priority.low'),
    [Priority.None]: t('web.capture.priority.none'),
  };
  const [draft, setDraft] = useState('');
  /**
   * 用户显式忽略的识别。
   *
   * ⚠️ 它在语义上是"**这段文字是标题的一部分**"，不是"删掉这几个字"。
   * 所以这里存的是"忽略清单"，而**不是**去改 `draft` ——
   * 改 `draft` 会把用户写的字真的删掉，那正是本组件最不能犯的错。
   */
  const [ignored, setIgnored] = useState<CaptureExclusion[]>([]);

  // 解析是纯函数且很便宜（十来条正则），但输入框每次按键都重算仍然浪费。
  // 依赖只有 draft + ignored —— 时间源用默认的 Date.now()，不放进依赖数组，
  // 因为"跨过午夜后预览里的'今天'会过期"的代价只是刷新一次输入。
  const parsed = useMemo(() => parseCapture(draft, { exclude: ignored }), [draft, ignored]);

  const canSubmit = parsed.title.trim() !== '';

  function submit(): void {
    if (!canSubmit) return;
    void addTask(parsed.title, {
      ...(parsed.dueDate !== undefined ? { dueDate: dueDateToEpoch(parsed.dueDate) } : {}),
      ...(parsed.priority !== undefined ? { priority: parsed.priority } : {}),
    });
    setDraft('');
    setIgnored([]);
  }

  /** 忽略 / 恢复一条识别。只动"忽略清单"，**绝不动输入框里的字**。 */
  function toggleIgnore(m: CaptureExclusion & { rejected: boolean }): void {
    setIgnored((list) =>
      m.rejected
        ? list.filter((e) => !(e.field === m.field && e.raw === m.raw))
        : [...list, { field: m.field, raw: m.raw }],
    );
  }

  /** 输入变了，旧的忽略清单可能已经指向不存在的文字 —— 清掉以免残留状态。 */
  function onDraftChange(value: string): void {
    setDraft(value);
    if (ignored.length > 0) setIgnored([]);
  }

  /**
   * AI 解析出的字段落库。
   *
   * 🔴 走的是**和回车完全相同的那条路**（`addTask` → op-log），
   * 所以它同样可同步、可撤销、可被别的设备看到 —— AI 没有旁路。
   *
   * ⚠️ `dueDate` 在这里从「本地日期时间串」换算成 epoch 毫秒。
   * 这一步**必须**在界面侧做，因为 `ai-capture` 只给本地串
   * （它不替 domain 决定时区语义，见那个文件头）。
   * 换算失败（模型给了不存在的日期）就**当作没给** —— 宁可少一个截止时间，
   * 也不要一个静默错位的日期。
   */
  async function applyCapture(fields: {
    title: string;
    dueDate?: string | undefined;
    priority?: Priority | undefined;
  }): Promise<void> {
    const due =
      fields.dueDate === undefined ? undefined : localDateTimeToEpoch(fields.dueDate);
    await addTask(fields.title, {
      ...(due !== undefined ? { dueDate: due } : {}),
      ...(fields.priority !== undefined ? { priority: fields.priority } : {}),
    });
    // 建完清空输入框：AI 应用与回车应当是**同一种结果**，
    // 否则用户会面对两套行为（一个清、一个不清），而且残留的文字
    // 会让下一次回车悄悄建出重复任务。
    setDraft('');
    setIgnored([]);
  }

  return (
    <div className="ht-compose-wrap">
      <div className="ht-compose">
        <input
          className="ht-input"
          value={draft}
          placeholder={t('web.capture.placeholder')}
          aria-label={t('web.capture.addLabel')}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <button
          type="button"
          className="ht-btn ht-btn--primary"
          onClick={submit}
          disabled={!canSubmit}
        >
          <Plus size={18} aria-hidden="true" />
          {t('web.capture.add')}
        </button>
      </div>

      {parsed.matches.length > 0 && (
        <ul className="ht-capture" aria-label={t('web.capture.matches.aria')}>
          {parsed.matches.map((m) => {
            // dueDate 的 display 是 YYYY-MM-DD。同时给出人话剩余时间，
            // 因为"2026-09-26"不直观而"明天"直观 —— 用户要确认的是后者。
            // ✅ 剩余天数由领域层算（`diffDays` / `today`），**说法**按当前语言
            // 从词条表取（`remainingText`）—— 以前这里直接嵌领域层的
            // `formatRemainingUntil()`，那是一句写死的中文，英文界面会露汉字。
            // 括号与空格是正字法（一个汉字都没有），所以仍走
            // `dateWithRemaining` 的代码常量而不是词条表 —— 与
            // `LIST_SEPARATOR` 同一个先例。
            const valueLabel =
              m.field === 'dueDate' && m.dueDate !== undefined
                ? dateWithRemaining(
                    m.dueDate,
                    remainingText(diffDays(today(previewNow), m.dueDate), t),
                    locale,
                  )
                : (priorityLabel[m.priority ?? Priority.None] ?? m.display);

            return (
              <li
                key={`${m.field}-${String(m.start)}-${m.raw}`}
                className={`ht-capture__chip${m.applied ? '' : ' ht-capture__chip--off'}`}
              >
                <span className="ht-capture__raw">{m.raw}</span>
                <span className="ht-capture__arrow" aria-hidden="true">
                  →
                </span>
                <span className="ht-capture__value">
                  {m.rejected ? t('web.capture.rejected') : valueLabel}
                </span>
                {m.rejected ? (
                  // 恢复：把它重新纳入解析
                  <button
                    type="button"
                    className="ht-capture__x"
                    aria-label={t('web.capture.restoreAria', { raw: m.raw })}
                    onClick={() => toggleIgnore(m)}
                  >
                    <RotateCcw size={12} aria-hidden="true" />
                  </button>
                ) : m.applied ? (
                  <button
                    type="button"
                    className="ht-capture__x"
                    aria-label={t('web.capture.ignoreAria', { raw: m.raw })}
                    onClick={() => toggleIgnore(m)}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                ) : (
                  // 未被采纳（同字段已有更早的匹配）= 它**还在标题里**。
                  // 必须说出来，否则用户会以为识别失败了，
                  // 而不知道那段字其实原样保留着。
                  <span className="ht-capture__hint">{t('web.capture.unused')}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {parsed.matches.length > 0 && (
        <p className="ht-capture__preview">
          {t('web.capture.previewLead')}{' '}
          <strong>{parsed.title === '' ? t('web.capture.previewEmpty') : parsed.title}</strong>
        </p>
      )}

      {/* AI 一句话捕获（功能 ①）。
          🔴 它与上面的规则解析**并存**，不是替换 —— 规则那条路对「明天」
          「下周三」「!1」是**算准的**，而 `packages/ai/src/index.ts` 记着一次实测：
          同一个句子里模型算出来的日期错了约 4.5 个月。所以凡规则能算准的，
          继续走规则；AI 补的是规则覆盖不到的（"下下个季度前"、含歧义的表达）。

          ⚠️ 只在**有内容**时出现：空输入框上挂一个"AI 解析"按钮，
          点下去必然失败，那是在制造一次注定报错的交互。

          ⚠️ 没配置 AI 时也**照样出现**（`routing` 缺省时组件自己会说该去开什么）——
          "找不到入口"和"入口说为什么不可用"是两件事。但这一条只在
          `App.tsx` 传了 AI 配置时才成立；纯确定性场景（单测）不渲染它。 */}
      {props.routing !== undefined && draft.trim() !== '' && (
        <AiCapture
          text={draft}
          routing={props.routing}
          consents={props.consents ?? []}
          secrets={props.secrets ?? WEB_EMPTY_SECRET_STORE}
          healthSnapshot={props.healthSnapshot}
          preferenceSet={props.preferenceSet}
          onApply={applyCapture}
          {...(props.onFeedback !== undefined ? { onFeedback: props.onFeedback } : {})}
          {...(props.onHealth !== undefined ? { onHealth: props.onHealth } : {})}
        />
      )}
    </div>
  );
}