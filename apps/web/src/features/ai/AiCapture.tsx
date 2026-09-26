/**
 * AI 一句话捕获 —— 面向用户的入口
 * ==================================
 *
 * 把 `requestCapture()` 接到用户手指上的那一层。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 🔴 本文件存在的核心理由：**发送前的披露**
 *
 * heyta 是端到端加密的，而 AI 是唯一的**明文出境口**。用户必须在自己按下发送
 * 之前，看到**到底什么会离开这台设备**。所以流程被刻意拆成两步，
 * 而且中间那一步不能省：
 *
 *   1. 点「AI 捕获」→ 计算并显示披露（**只算，不发**）
 *   2. 用户看到之后按「发送」→ 才真的发
 *
 * ⚠️ 把披露做成"发送中的提示"或"发送后的日志"等于没有披露 ——
 * 用户已经没有机会反悔了。
 *
 * ## 🔴🔴 日期是**候选**，而且是模型**推算**出来的
 *
 * `packages/ai` 的文件头记着一次真实实测：同一天、同一句「明天下午三点开周会」，
 * 规则内核算出 `2026-09-27`，真实模型给出 `2026-05-08` —— **错了约 4 个半月**。
 *
 * 本组件的应对是三件事，缺一不可：
 *
 *   1. **披露里写明会送 `today`**（当前日期）—— 让模型是**推算**而不是**回忆**；
 *   2. **结果里把日期渲染成可编辑的控件**，用户看得见、改得动；
 *   3. **确认后才写** —— 组件自己不碰 store，只走 `onApply` 回调。
 *
 * 换句话说：**模型算错日期这件事由"人确认"吸收，不由代码假装它不会发生。**
 *
 * ## 🔴 组件自己不发请求、也不写库
 *
 * 它只做三件事：算披露、把 props 原样转交给 `requestCapture`、把用户确认过的
 * 字段交给 `onApply`。真正写库必须由调用方经 op-log 完成（AGENTS.md §3.4）。
 */

import { useState } from 'react';
import { AlertTriangle, Cloud, HardDrive, Sparkles, X } from 'lucide-react';

import {
  Priority,
  renderPreferenceHints,
  type AiFeedbackOutcome,
  type PreferenceSet,
} from '@heyta/domain';
import {
  buildDisclosure,
  fromHealthSnapshot,
  isLoopbackEndpoint,
  resolveRoute,
} from '@heyta/ai';
import type {
  AiHealthSnapshot,
  AiRoutingConfig,
  EgressConsent,
  EgressDestination,
  HealthMap,
  SecretStore,
} from '@heyta/ai';
import {
  MAX_CAPTURE_TITLE_LENGTH,
  buildCaptureInvocation,
  requestCapture,
  type CaptureProposal,
} from '@heyta/app-host';

/** 路由解析结果里"这个功能会走到哪个端点"。 */
export interface ResolvedCaptureTarget {
  endpointId: string;
  label: string;
  endpoint: string;
  model: string;
  isLocal: boolean;
  /** `resolveRoute` 算出的目的地类别 —— 传给 `buildDisclosure`，不在这里重新判。 */
  destination: EgressDestination;
  /**
   * 🔴 回退链上**其余**的端点标签（不含首选）。
   *
   * 回退是真实行为 —— 首选失败会自动试下一个。所以披露只说首选是不够的：
   * 用户同意了 A，数据却可能发到 B（**另一家公司**），
   * 而这一类切换**不会报错**，因为最终成功了。
   */
  fallbacks: readonly string[];
}

/**
 * 算出这个功能当前的**首选目标**（只看第一个候选，与 `invokeRouted` 一致）。
 *
 * 🔴 用 `packages/ai` 的 `resolveRoute`，**不要在这里做一份平行的过滤**。
 * 披露用的是"配置意图"（不含熔断状态），而发送时 `invokeRouted` 还会按
 * 能力、熔断、远端开关、URL 合法性过滤 —— 两套规则必然得出两套结论，
 * 而结论不一致时**因为成功所以没有任何提示**（见 `AiBreakdown.tsx` 的实测记录）。
 *
 * ⚠️ 这个函数与 `AiBreakdown.tsx` 的 `resolvePreferredTarget` 是**同一段逻辑**，
 * 唯一区别是 `feature`。之所以没抽成共用函数：`packages/app-host` 的导出面
 * 由接线方统一维护，而界面层各自持有自己功能的目标解析是现有形状。
 * 若将来出现第三个 AI 功能，**应当**把它提到共享位置，而不是再抄一份。
 */
export function resolveCaptureTarget(
  routing: AiRoutingConfig,
  options: { now?: number } = {},
): ResolvedCaptureTarget | undefined {
  const resolution = resolveRoute(routing, 'capture', { now: options.now ?? Date.now() });
  const first = resolution.candidates[0];
  if (first === undefined) return undefined;

  return {
    endpointId: first.endpointConfig.id,
    label: first.endpointConfig.label,
    endpoint: first.endpointConfig.endpoint,
    model: first.model,
    // 回环判据同样只有一份 —— `packages/ai` 的 `isLoopbackEndpoint`。
    isLocal: isLoopbackEndpoint(first.endpointConfig.endpoint),
    destination: first.destination,
    fallbacks: resolution.candidates.slice(1).map((c) => c.endpointConfig.label),
  };
}

/** 用户确认后交给调用方的字段。**不是 op，也不是 `Task`。** */
export interface CaptureApplyFields {
  title: string;
  /** 本地日期时间串（`YYYY-MM-DD` 或 `YYYY-MM-DDTHH:mm:ss`）。**未做时区转换。** */
  dueDate?: string;
  priority?: Priority;
}

type Phase = 'idle' | 'disclosing' | 'loading' | 'proposal' | 'failed';

/** 优先级下拉的取值。空串 = 不设置（与 `Priority.None` 语义相同）。 */
type PriorityChoice = '' | 'low' | 'medium' | 'high';

/** `Priority` → 下拉取值。`None` 与 `undefined` 在界面上是同一件事。 */
function priorityToChoice(value: Priority | undefined): PriorityChoice {
  if (value === undefined || value === Priority.None) return '';
  if (value === Priority.High) return 'high';
  if (value === Priority.Medium) return 'medium';
  return 'low';
}

/** 下拉取值 → `Priority`。空串 → `undefined`（**不写**一个"无优先级"的字段）。 */
function choiceToPriority(choice: PriorityChoice): Priority | undefined {
  if (choice === 'high') return Priority.High;
  if (choice === 'medium') return Priority.Medium;
  if (choice === 'low') return Priority.Low;
  return undefined;
}

/**
 * 比较/计数时用的"有效优先级"。
 *
 * 🔴 `Priority.None` 与 `undefined` 在语义上是同一件事（都没有优先级）。
 * 不归一化的话，"模型给了 none、界面显示'不设置'、用户没动"会被记成
 * **modified** —— 一个假的"用户改过"，会污染偏好学习。
 */
function effectivePriority(value: Priority | undefined): Priority | undefined {
  return value === undefined || value === Priority.None ? undefined : value;
}

/** 模型给了但没法用的字段 → 中文名。 */
function droppedLabel(fields: readonly ('title' | 'dueDate' | 'priority')[]): string {
  return fields
    .map((field) => {
      if (field === 'dueDate') return '截止时间';
      if (field === 'priority') return '优先级';
      return '标题';
    })
    .join('、');
}

/** 提议里有几个字段。用于反馈层的 `proposedCount`。 */
function proposedFieldCount(proposal: CaptureProposal): number {
  let count = 1;
  if (proposal.dueDate !== undefined) count += 1;
  if (effectivePriority(proposal.priority) !== undefined) count += 1;
  return count;
}

/** 实际写入了几个字段。 */
function appliedFieldCount(fields: CaptureApplyFields): number {
  let count = 1;
  if (fields.dueDate !== undefined) count += 1;
  if (effectivePriority(fields.priority) !== undefined) count += 1;
  return count;
}

/** 用户有没有动过模型给的东西。 */
function isUnchanged(proposal: CaptureProposal, fields: CaptureApplyFields): boolean {
  return (
    proposal.title === fields.title &&
    proposal.dueDate === fields.dueDate &&
    effectivePriority(proposal.priority) === effectivePriority(fields.priority)
  );
}

export interface AiCaptureProps {
  /**
   * 要解析的那一句话。**由调用方持有** —— 本组件不接管输入框，
   * 因为输入框的位置与提交行为是产品决策（对照 `CaptureComposer`）。
   */
  text: string;
  routing: AiRoutingConfig;
  consents: readonly EgressConsent[];
  secrets: SecretStore;
  /**
   * 🔴 上次会话落盘的**熔断状态**。不传它，落盘就是白做的：
   * 端点连着失败三次、已跳闸这件事活不过一次刷新。
   */
  healthSnapshot?: AiHealthSnapshot | undefined;
  /**
   * 用户确认后的写入入口。
   *
   * 🔴 **必须走调用方的 store / op-log。** 组件不直接改数据 ——
   * 模型回来的是候选，只有用户按了确认才变成意图。
   */
  onApply: (fields: CaptureApplyFields) => Promise<void>;
  /**
   * 每次调用后把**熔断状态**交回给调用方落盘。
   *
   * ⚠️ 成功与失败都要交 —— 失败正是要记的东西。
   */
  onHealth?: (health: HealthMap) => void;
  /** 仅在测试里注入。生产用 `globalThis.fetch`。 */
  fetchImpl?: typeof fetch;
  /**
   * 记忆层推断出的偏好集（见 `@heyta/domain` 的 `inferPreferences`）。
   *
   * ⚠️ **可选，默认「没有记忆」** —— fail closed：忘了传的后果是
   * "这次捕获不带偏好"，而不是"偷偷多发数据"。主开关关闭时
   * `renderPreferenceHints` 返回的本身就是空数组，两条路径都不会漏出去。
   */
  preferenceSet?: PreferenceSet | undefined;
  /**
   * 记录用户对这次候选的处置（采用 / 改后采用 / 拒绝）。
   *
   * ⚠️ 可选，默认**不记录**（fail closed）：忘了传的后果是少一条反馈。
   * 这里**刻意不传原文** —— 只传计数与枚举，内容已经在任务里了。
   */
  onFeedback?: (feedback: {
    outcome: AiFeedbackOutcome;
    proposedCount: number;
    appliedCount: number;
  }) => void;
}

export function AiCapture(props: AiCaptureProps): React.JSX.Element {
  const { text, routing, consents, secrets, onApply, onHealth, preferenceSet, onFeedback } = props;

  const [phase, setPhase] = useState<Phase>('idle');
  /**
   * 🔴 **点击那一刻的文本与时钟快照。**
   *
   * 披露与请求必须基于**同一份输入**。如果两者各自去读 `text` / `Date.now()`，
   * 用户在这两步之间改了输入、或者时钟跨过午夜，就会出现
   * "披露的是 A、发出去的是 B" —— 那正是披露制度要防的事。
   *
   * 快照还有一个附带好处：面板打开后用户继续打字，面板里显示的仍是
   * 它将要发送的那一句（见 `capture-text-preview`）。
   */
  const [frozenText, setFrozenText] = useState('');
  const [frozenAt, setFrozenAt] = useState(() => Date.now());
  const [proposal, setProposal] = useState<CaptureProposal | undefined>(undefined);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDate, setDraftDate] = useState('');
  const [draftTime, setDraftTime] = useState('');
  const [draftPriority, setDraftPriority] = useState<PriorityChoice>('');
  const [failure, setFailure] = useState('');
  const [applied, setApplied] = useState(false);

  const target = resolveCaptureTarget(routing);

  /**
   * 🔴 偏好 → 提示。**这里也是出境面的一个决定点**：
   * `renderPreferenceHints` 按用途过滤（捕获只要标题风格），
   * 并且主开关关闭时返回空数组 —— 所以它不可能漏。
   */
  const hints = preferenceSet === undefined ? [] : renderPreferenceHints(preferenceSet, 'capture');

  const invocation = buildCaptureInvocation({ text: frozenText, now: frozenAt }, hints);

  /**
   * 🔴 披露内容由 `packages/ai` 的 `buildDisclosure()` 组装 ——
   * 它的文档写着"测试与 UI 共用同一条路径"，界面自己写一份就会漂移。
   */
  const disclosure =
    target === undefined
      ? undefined
      : buildDisclosure({
          feature: 'capture',
          destination: target.destination,
          fields: invocation.fields,
        });

  /** 点「AI 捕获」：只冻结输入并切到披露态，**不发任何请求**。 */
  function start(): void {
    setApplied(false);
    setFrozenText(text);
    setFrozenAt(Date.now());
    setPhase('disclosing');
  }

  async function send(): Promise<void> {
    setPhase('loading');
    const outcome = await requestCapture(
      { text: frozenText, now: frozenAt },
      {
        routing,
        consents,
        // 🔴 同一个 `hints` 既进 invocation（决定披露与请求体），
        // 也进这里（决定真正发出去的内容）—— **只算一次**。
        preferences: hints,
        routed: {
          secretStore: secrets,
          // 🔴 **发送那一刻**才解析快照 —— 冷却期是对着"现在"算的。
          healthSeed: fromHealthSnapshot(props.healthSnapshot ?? {}, Date.now()),
          ...(props.fetchImpl === undefined ? {} : { fetchImpl: props.fetchImpl }),
        },
      },
    );

    // 🔴 成功与失败都要交回 —— 失败正是熔断的依据。
    onHealth?.(outcome.health);

    if (outcome.ok) {
      const next = outcome.proposal;
      setProposal(next);
      // 把候选填进**可编辑**的控件。日期与时间分开两个控件，
      // 是因为模型可能只给了日期 —— 那就不要替它补一个时间。
      setDraftTitle(next.title);
      const parts = (next.dueDate ?? '').split('T');
      setDraftDate(parts[0] ?? '');
      setDraftTime(parts[1] === undefined ? '' : parts[1].slice(0, 5));
      setDraftPriority(priorityToChoice(next.priority));
      setPhase('proposal');
      return;
    }
    setFailure(outcome.message);
    setPhase('failed');
  }

  /** 两个控件拼回一个本地日期时间串。**日期为空 = 不设截止时间。** */
  function composedDueDate(): string | undefined {
    if (draftDate === '') return undefined;
    if (draftTime === '') return draftDate;
    const time = draftTime.length === 5 ? `${draftTime}:00` : draftTime;
    return `${draftDate}T${time}`;
  }

  async function apply(): Promise<void> {
    if (proposal === undefined) return;
    const title = draftTitle.trim();
    if (title === '') return;

    const dueDate = composedDueDate();
    const priority = choiceToPriority(draftPriority);
    const fields: CaptureApplyFields = {
      title,
      ...(dueDate === undefined ? {} : { dueDate }),
      ...(priority === undefined ? {} : { priority }),
    };

    await onApply(fields);
    // 🔴 三态由**事实**决定，不由调用点各自宣称：
    // 原样采用 = accepted，动过任何一个字段 = modified，一条不要 = rejected。
    report(isUnchanged(proposal, fields) ? 'accepted' : 'modified', appliedFieldCount(fields));
    setApplied(true);
    setPhase('idle');
  }

  /** 明确放弃这次候选。 */
  function discard(): void {
    report('rejected', 0);
    reset();
  }

  function report(outcome: AiFeedbackOutcome, appliedCount: number): void {
    if (proposal === undefined) return;
    onFeedback?.({
      outcome,
      proposedCount: proposedFieldCount(proposal),
      appliedCount,
    });
  }

  function reset(): void {
    setPhase('idle');
    setProposal(undefined);
    setDraftTitle('');
    setDraftDate('');
    setDraftTime('');
    setDraftPriority('');
    setFailure('');
    setApplied(false);
  }

  // ── 空闲：只是一个按钮 ────────────────────────────────────────────────
  if (phase === 'idle') {
    return (
      <span className="ht-ai">
        <button
          type="button"
          className="ht-btn ht-btn--ghost"
          data-testid="capture-ai"
          aria-label="用 AI 解析这句话"
          disabled={text.trim() === ''}
          onClick={start}
        >
          <Sparkles size={12} aria-hidden="true" />
          AI 捕获
        </button>
        {applied && (
          <span className="ht-ai__done" data-testid="capture-applied">
            已填入候选字段
          </span>
        )}
      </span>
    );
  }

  // ── 🔴 披露：只算，不发 ───────────────────────────────────────────────
  if (phase === 'disclosing') {
    return (
      <div
        className="ht-ai__panel"
        role="dialog"
        aria-label="AI 捕获 —— 发送前确认"
        data-testid="capture-disclosure"
      >
        <div className="ht-ai__head">
          <span>发送前确认</span>
          <button
            type="button"
            className="ht-btn ht-btn--ghost"
            aria-label="取消"
            data-testid="capture-dismiss"
            onClick={reset}
          >
            <X size={12} aria-hidden="true" />
          </button>
        </div>

        {/* 🔴 把"将要发送的那一句"原样显示出来 —— 用户改过输入之后
            仍能确认自己批的是哪一句。 */}
        <p className="ht-ai__row" data-testid="capture-text-preview">
          将解析：<strong>{frozenText}</strong>
        </p>

        {target === undefined ? (
          <p className="ht-ai__warn" data-testid="capture-no-target">
            <AlertTriangle size={12} aria-hidden="true" />
            还没有给「一句话捕获」配置端点。去「设置」里添加端点并指定路由。
          </p>
        ) : (
          <>
            <p className="ht-ai__row" data-testid="capture-destination">
              {target.isLocal ? (
                <HardDrive size={12} aria-hidden="true" />
              ) : (
                <Cloud size={12} aria-hidden="true" />
              )}
              将发往：<strong>{target.label}</strong>
              <code>{target.endpoint}</code>
              <span>模型 {target.model}</span>
              <span className="ht-ai__tag" data-testid="capture-destination-kind">
                {target.isLocal ? '数据不出设备' : '数据会离开设备'}
              </span>
            </p>

            {/* 🔴 回退链必须披露 —— 首选失败时会自动换一个端点，
                而那是**另一家公司**。成功了就没有任何提示。 */}
            {target.fallbacks.length > 0 && (
              <p className="ht-ai__row ht-ai__row--warn" data-testid="capture-fallbacks">
                <AlertTriangle size={12} aria-hidden="true" />
                如果它失败，会接着依次尝试：
                <strong data-testid="capture-fallback-list">{target.fallbacks.join('、')}</strong>
              </p>
            )}

            {/* 🔴 「留多久」是披露的三维之一（发给谁 / 发什么 / 留多久）。 */}
            {disclosure !== undefined && (
              <p className="ht-ai__row" data-testid="capture-retention">
                保留：
                <strong data-testid="capture-retention-text">
                  {disclosure.retentionText ??
                    '未定案 —— 在 heyta 说明清楚之前，这个端点不允许启用。'}
                </strong>
              </p>
            )}

            <p className="ht-ai__row" data-testid="capture-fields">
              将发送这些字段：
              <strong data-testid="capture-field-list">{invocation.fields.join('、')}</strong>
            </p>

            {!target.isLocal && (
              <p className="ht-ai__warn" data-testid="capture-e2ee-warning">
                <AlertTriangle size={12} aria-hidden="true" />
                这台设备上的任务内容是端到端加密的，而发出去的这一份
                <strong>不受端到端加密保护</strong>。
              </p>
            )}

            <div className="ht-ai__actions">
              <button
                type="button"
                className="ht-btn"
                data-testid="capture-send"
                onClick={() => void send()}
              >
                发送
              </button>
              <button
                type="button"
                className="ht-btn ht-btn--ghost"
                data-testid="capture-cancel"
                onClick={reset}
              >
                取消
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  if (phase === 'loading') {
    return (
      <div className="ht-ai__panel" data-testid="capture-loading">
        <span>正在等待端点返回…</span>
      </div>
    );
  }

  // ── 🔴 候选：模型给的东西**必须经用户确认**才可能被写入 ──────────────
  if (phase === 'proposal' && proposal !== undefined) {
    return (
      <div
        className="ht-ai__panel"
        role="dialog"
        aria-label="AI 捕获结果"
        data-testid="capture-proposal"
      >
        <div className="ht-ai__head">
          <span>捕获结果（可以改）</span>
          <span className="ht-ai__tag" data-testid="capture-proposal-source">
            {proposal.destination === 'none' ? '来自本机' : '来自云端'}
          </span>
        </div>

        {proposal.dropped.length > 0 && (
          <p className="ht-ai__warn" data-testid="capture-dropped">
            <AlertTriangle size={12} aria-hidden="true" />
            模型给的{droppedLabel(proposal.dropped)}没法用，已经留空 —— 需要的话自己填。
          </p>
        )}

        <label className="ht-ai__row">
          <span>标题</span>
          <input
            className="ht-input"
            type="text"
            data-testid="capture-title"
            aria-label="任务标题"
            maxLength={MAX_CAPTURE_TITLE_LENGTH}
            value={draftTitle}
            onChange={(e) => {
              setDraftTitle(e.target.value);
            }}
          />
        </label>

        {/* 🔴 日期与时间**分开两个控件**，而不是一个"日期时间"输入框。
            理由是"不许猜"：模型只给了日期时，替它补一个 00:00 是把
            "那一天" 悄悄变成 "那一天零点"。分开之后，没给时间就是没给。 */}
        <label className="ht-ai__row">
          <span>截止日期</span>
          <input
            className="ht-input"
            type="date"
            data-testid="capture-due-date"
            aria-label="截止日期"
            value={draftDate}
            onChange={(e) => {
              setDraftDate(e.target.value);
            }}
          />
          <input
            className="ht-input"
            type="time"
            data-testid="capture-due-time"
            aria-label="截止时间"
            value={draftTime}
            onChange={(e) => {
              setDraftTime(e.target.value);
            }}
          />
        </label>

        <label className="ht-ai__row">
          <span>优先级</span>
          <select
            className="ht-input"
            data-testid="capture-priority"
            aria-label="优先级"
            value={draftPriority}
            onChange={(e) => {
              const value = e.target.value;
              setDraftPriority(
                value === 'low' || value === 'medium' || value === 'high' ? value : '',
              );
            }}
          >
            <option value="">不设置</option>
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
          </select>
        </label>

        <p className="ht-ai__note">
          确认后会按上面的字段写入。截止时间是<strong>模型的推算</strong>，请核对后再填。
        </p>

        <div className="ht-ai__actions">
          <button
            type="button"
            className="ht-btn"
            data-testid="capture-apply"
            disabled={draftTitle.trim() === ''}
            onClick={() => void apply()}
          >
            填入任务
          </button>
          <button
            type="button"
            className="ht-btn ht-btn--ghost"
            data-testid="capture-discard"
            onClick={discard}
          >
            不要了
          </button>
        </div>
      </div>
    );
  }

  // ── 失败：给出**具体原因**，并允许重试 ───────────────────────────────
  return (
    <div
      className="ht-ai__panel"
      role="dialog"
      aria-label="AI 捕获失败"
      data-testid="capture-failed"
    >
      <div className="ht-ai__head">
        <span>没能捕获</span>
        <button
          type="button"
          className="ht-btn ht-btn--ghost"
          aria-label="关闭"
          data-testid="capture-close"
          onClick={reset}
        >
          <X size={12} aria-hidden="true" />
        </button>
      </div>
      <p data-testid="capture-failure-message">{failure}</p>
      <div className="ht-ai__actions">
        <button
          type="button"
          className="ht-btn"
          data-testid="capture-retry"
          onClick={() => void send()}
        >
          重试
        </button>
        <button
          type="button"
          className="ht-btn ht-btn--ghost"
          data-testid="capture-cancel-failed"
          onClick={reset}
        >
          关闭
        </button>
      </div>
    </div>
  );
}
