/**
 * AI 耗时估计 —— 面向用户的入口
 * ==================================
 *
 * 把 `requestDuration()` 接到用户手指上的那一层。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 🔴 本文件与 `AiBreakdown.tsx` 共用同一条纪律：**发送前的披露**
 *
 * 计划 §5 的验收判据 ④：发送前显示"发给哪个端点 + 发哪几个字段"。
 * 所以流程同样被拆成两步，**中间那一步不能省**：
 *
 *   1. 点击 → 计算并显示披露（**只算，不发**）
 *   2. 用户看到之后按"发送" → 才真的发
 *
 * ⚠️ 把披露做成"发送中的提示"或"发送后的日志"等于没有披露 ——
 * 用户已经没有机会反悔了。
 *
 * ## 🔴 这个功能额外多一条：**必须显示"我凭什么估这个数"**
 *
 * 估时与拆解不同：拆解错了用户一眼就能看出来（清单读不通），
 * 而**一个错误的分钟数看起来和正确的一模一样**。所以界面的责任更大：
 * 用户必须能看到这次估计参考了什么，才能判断该不该信。
 *
 * 依据有三档，且**必须如实区分**：
 *   - 有历史 → 「基于你过去 N 次的实际/计划比值」（N 是**真正发出去的**条数）
 *   - 有偏好 → 逐条列出 `PreferenceHint.summary`（来自 `@heyta/domain` 的原话）
 *   - 都没有 → 「只有模型自己的通用判断，它可能不准」（**不许假装懂**）
 *
 * ## 🔴 结果不会自己写进数据
 *
 * 模型回来的是一份**提议**（`DurationProposal`）。它要经过用户再按一次，
 * 才经 `onApply(minutes)` 写进数据 —— 而那条路走 op-log。
 *
 * ⚠️ 与 `AiSuggestion`「类型上不能变成 op」是同一条纪律的两端：
 * 类型上做不到，界面上也不做。
 */

import { useState } from 'react';
import { AlertTriangle, Clock, Cloud, HardDrive, X } from 'lucide-react';

import {
  renderPreferenceHints,
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
  MAX_DURATION_MINUTES,
  MAX_HISTORY_ROWS,
  MIN_DURATION_MINUTES,
  buildDurationInvocation,
  countUsableDurationHistory,
  parseDurationMinutes,
  requestDuration,
  selectDurationHistory,
  type DurationHistoryRow,
  type DurationProposal,
} from '@heyta/app-host';
import type { Task } from '@heyta/domain';

/**
 * 路由解析结果里"这个功能会走到哪个端点"。
 *
 * ⚠️ **类型复用 `AiBreakdown` 的那一份**，而不是在这里再写一遍 ——
 * 两个组件描述的是同一个东西，两份形状一定会漂移。
 */
import type { ResolvedTarget } from './AiBreakdown.js';

/**
 * 算出估时功能当前的**首选目标**（只看第一个候选，与 `invokeRouted` 一致）。
 *
 * 🔴 用 `packages/ai` 的 `resolveRoute`，**不要在这里做一份平行的过滤** ——
 * 披露说 A、实际发到 B（**另一家公司**）的 bug 就是这么来的
 * （见 `AiBreakdown.resolvePreferredTarget` 的实测记录）。
 *
 * ⚠️ **这份实现与 `resolvePreferredTarget` 是重复的**（只差一个功能名）。
 * 本轮不允许改 `AiBreakdown.tsx`，所以只能各留一份。诚实记下这个坑：
 * 真正的修法是抽一个 `resolvePreferredTargetFor(routing, feature)`，两处都改成调用它。
 * 目前能防住漂移的是界面测试 —— 它断言披露的端点就是请求实际打到的端点。
 */
export function resolveDurationTarget(
  routing: AiRoutingConfig,
  options: { now?: number } = {},
): ResolvedTarget | undefined {
  const resolution = resolveRoute(routing, 'duration-estimate', {
    now: options.now ?? Date.now(),
  });
  const first = resolution.candidates[0];
  if (first === undefined) return undefined;

  return {
    endpointId: first.endpointConfig.id,
    label: first.endpointConfig.label,
    endpoint: first.endpointConfig.endpoint,
    model: first.model,
    // 回环判据同样只有一份 —— `packages/ai` 的 `isLoopbackEndpoint`。
    isLocal: isLoopbackEndpoint(first.endpointConfig.endpoint),
    destination: first.destination as EgressDestination,
    fallbacks: resolution.candidates.slice(1).map((c) => c.endpointConfig.label),
  };
}

/** 分钟数 → 人话（90 → 「1 小时 30 分钟」）。 */
function humanizeMinutes(minutes: number): string {
  if (minutes < 60) return `${String(minutes)} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? `${String(hours)} 小时`
    : `${String(hours)} 小时 ${String(rest)} 分钟`;
}

type Phase = 'idle' | 'disclosing' | 'loading' | 'proposal' | 'failed';

export interface AiDurationProps {
  task: Task;
  /**
   * 历史专注记录（**时间正序**，旧 → 新）。
   *
   * 🔴 这是出境面的一部分：`selectDurationHistory` 会把它封顶后发出去。
   * 不传 = 没有历史可用，**不是**"偷偷不发"。
   */
  history?: readonly DurationHistoryRow[] | undefined;
  routing: AiRoutingConfig;
  consents: readonly EgressConsent[];
  secrets: SecretStore;
  /**
   * 🔴 上次会话落盘的**熔断状态**（同 `AiBreakdown`）。
   *
   * 不传它，落盘就是白做的：跳闸的端点活不过一次刷新，用户每次打开都要再撞一次。
   * ⚠️ 传**原始快照**而不是 `HealthMap` —— 解析要在**发送那一刻**做，
   * 这样冷却期是对着"现在"算的。
   */
  healthSnapshot?: AiHealthSnapshot | undefined;
  /**
   * 写入用户确认后的分钟数。
   *
   * 🔴 **必须经 store 的动作**（那条路走 op-log）。模型不能自己改数据，
   * 本组件也**不会**在拿到结果时自动调用它 —— 只有用户再按一次才调。
   */
  onApply: (minutes: number) => Promise<void>;
  /**
   * 每次调用后把**熔断状态**交回给调用方落盘。
   * ⚠️ 成功与失败都要交 —— 失败正是要记的东西。
   */
  onHealth?: (health: HealthMap) => void;
  /** 仅在测试里注入。生产用 `globalThis.fetch`。 */
  fetchImpl?: typeof fetch;
  /**
   * 记忆层推断出的偏好集（见 `@heyta/domain` 的 `inferPreferences`）。
   *
   * ⚠️ **可选，默认「没有记忆」** —— 即 fail closed：忘了传的后果是
   * "这次估时不带偏好"，而不是"偷偷多发数据"。
   */
  preferenceSet?: PreferenceSet | undefined;
}

export function AiDuration(props: AiDurationProps): React.JSX.Element {
  const { task, history, routing, consents, secrets, onApply, onHealth, preferenceSet } = props;

  const [phase, setPhase] = useState<Phase>('idle');
  const [proposal, setProposal] = useState<DurationProposal | undefined>(undefined);
  const [failure, setFailure] = useState<string>('');
  const [applied, setApplied] = useState(false);
  /** 手动兜底输入（AI 不可用时的退路，见失败态）。 */
  const [manualText, setManualText] = useState('');

  const target = resolveDurationTarget(routing);

  /**
   * 🔴 偏好 → 提示。`renderPreferenceHints` 按用途过滤（估时只要
   * 偏差系数与高效时段），并且主开关关闭时返回空数组。
   */
  const hints = preferenceSet === undefined ? [] : renderPreferenceHints(preferenceSet, 'duration-estimate');

  /** 真正会出境的历史（已封顶）。**依据展示与请求必须用同一个结果。** */
  const usableHistory = selectDurationHistory(history);
  const totalHistory = countUsableDurationHistory(history);

  const source = {
    title: task.title,
    ...(task.note === undefined ? {} : { note: task.note }),
    ...(history === undefined ? {} : { history }),
  };

  const invocation = buildDurationInvocation(source, hints);

  /**
   * 🔴 披露内容由 `packages/ai` 的 `buildDisclosure()` 组装 ——
   * 测试与 UI 共用同一条路径（界面自己写一份"留多久"就一定会漂移）。
   */
  const disclosure =
    target === undefined
      ? undefined
      : buildDisclosure({
          feature: 'duration-estimate',
          destination: target.destination,
          fields: invocation.fields,
        });

  async function send(): Promise<void> {
    setPhase('loading');
    const outcome = await requestDuration(source, {
      routing,
      consents,
      // 🔴 同一个 `hints` 既进 invocation（决定披露与请求体），也进这里
      // （决定真正发出去的内容）—— **只算一次**，否则两处可能算出不同的东西。
      preferences: hints,
      routed: {
        secretStore: secrets,
        // 🔴 **发送那一刻**才解析快照 —— 冷却期是对着"现在"算的。
        healthSeed: fromHealthSnapshot(props.healthSnapshot ?? {}, Date.now()),
        ...(props.fetchImpl === undefined ? {} : { fetchImpl: props.fetchImpl }),
      },
    });

    // 🔴 成功与失败都要交回 —— 失败正是熔断的依据。
    onHealth?.(outcome.health);

    if (outcome.ok) {
      setProposal(outcome.proposal);
      setPhase('proposal');
      return;
    }
    setFailure(outcome.message);
    setPhase('failed');
  }

  async function apply(): Promise<void> {
    if (proposal === undefined) return;
    await onApply(proposal.minutes);
    setApplied(true);
    setPhase('idle');
  }

  /** 手动兜底：用户自己填一个分钟数。它**不是** AI 生成物。 */
  const manualValue = parseDurationMinutes(manualText);
  const manualOk =
    manualValue !== undefined &&
    manualValue >= MIN_DURATION_MINUTES &&
    manualValue <= MAX_DURATION_MINUTES;

  async function applyManual(): Promise<void> {
    if (!manualOk || manualValue === undefined) return;
    await onApply(manualValue);
    setApplied(true);
    setManualText('');
    setPhase('idle');
  }

  function reset(): void {
    setPhase('idle');
    setProposal(undefined);
    setFailure('');
    setManualText('');
  }

  /**
   * 「我凭什么估这个数」—— 披露态与结果态都要显示，且**必须是同一段**。
   *
   * 🔴 三档如实区分，绝不用"AI 已了解你"这种含混话糊过去。
   */
  function renderBasis(): React.JSX.Element {
    const hasHistory = usableHistory.length > 0;
    const hasHints = hints.length > 0;
    if (!hasHistory && !hasHints) {
      return (
        <p className="ht-ai__note" data-testid="duration-basis-none">
          这次没有可用的历史数据，只有模型自己的通用判断 —— 它可能不准。
        </p>
      );
    }
    return (
      <div className="ht-ai__note" data-testid="duration-basis">
        {hasHistory && (
          <p className="ht-ai__row" data-testid="duration-basis-history">
            基于你过去 <strong>{usableHistory.length}</strong> 次的实际/计划比值
            {totalHistory > usableHistory.length && (
              <>
                （你共有 {totalHistory} 次记录，为控制出境只发送最近 {MAX_HISTORY_ROWS} 次）
              </>
            )}
          </p>
        )}
        {hasHints && (
          <ul className="ht-ai__items" data-testid="duration-basis-preferences">
            {hints.map((hint) => (
              <li key={hint.id} data-testid={`duration-basis-${hint.id}`}>
                {hint.summary}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ── 空闲：只是一个按钮 ────────────────────────────────────────────────
  if (phase === 'idle') {
    return (
      <span className="ht-ai">
        <button
          type="button"
          className="ht-btn ht-btn--ghost"
          data-testid={`duration-run-${task.id}`}
          aria-label={`用 AI 估计耗时：${task.title}`}
          onClick={() => {
            setApplied(false);
            setPhase('disclosing');
          }}
        >
          <Clock size={12} aria-hidden="true" />
          AI 估时
        </button>
        {applied && (
          <span className="ht-ai__done" data-testid={`duration-applied-${task.id}`}>
            已写入耗时
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
        aria-label="AI 估时 —— 发送前确认"
        data-testid="duration-disclosure"
      >
        <div className="ht-ai__head">
          <span>发送前确认</span>
          <button type="button" className="ht-btn ht-btn--ghost" aria-label="取消" onClick={reset}>
            <X size={12} aria-hidden="true" />
          </button>
        </div>

        {target === undefined ? (
          <p className="ht-ai__warn" data-testid="duration-no-target">
            <AlertTriangle size={12} aria-hidden="true" />
            还没有给「耗时估计」配置端点。去「设置」里添加端点并指定路由。
          </p>
        ) : (
          <>
            <p className="ht-ai__row" data-testid="duration-destination">
              {target.isLocal ? (
                <HardDrive size={12} aria-hidden="true" />
              ) : (
                <Cloud size={12} aria-hidden="true" />
              )}
              将发往：<strong>{target.label}</strong>
              <code>{target.endpoint}</code>
              <span>模型 {target.model}</span>
              <span className="ht-ai__tag" data-testid="duration-destination-kind">
                {target.isLocal ? '数据不出设备' : '数据会离开设备'}
              </span>
            </p>

            {/* 🔴 回退链必须披露 —— 首选失败时会自动换一个端点，而那是**另一家公司**。 */}
            {target.fallbacks.length > 0 && (
              <p className="ht-ai__row ht-ai__row--warn" data-testid="duration-fallbacks">
                <AlertTriangle size={12} aria-hidden="true" />
                如果它失败，会接着依次尝试：
                <strong data-testid="duration-fallback-list">{target.fallbacks.join('、')}</strong>
              </p>
            )}

            {/* 🔴 「留多久」是披露的三维之一（发给谁 / 发什么 / 留多久）。 */}
            {disclosure !== undefined && (
              <p className="ht-ai__row" data-testid="duration-retention">
                保留：<strong data-testid="duration-retention-text">
                  {disclosure.retentionText ?? '未定案 —— 在 heyta 说明清楚之前，这个端点不允许启用。'}
                </strong>
              </p>
            )}

            <p className="ht-ai__row" data-testid="duration-fields">
              将发送这些字段：
              <strong data-testid="duration-field-list">{invocation.fields.join('、')}</strong>
            </p>

            {/* 🔴 依据必须在**发送前**就能看到：用户据此决定要不要发。 */}
            {renderBasis()}

            {!target.isLocal && (
              <p className="ht-ai__warn" data-testid="duration-e2ee-warning">
                <AlertTriangle size={12} aria-hidden="true" />
                这台设备上的任务内容是端到端加密的，而发出去的这一份<strong>不受端到端加密保护</strong>。
              </p>
            )}

            <div className="ht-ai__actions">
              <button
                type="button"
                className="ht-btn"
                data-testid="duration-send"
                onClick={() => void send()}
              >
                发送
              </button>
              <button type="button" className="ht-btn ht-btn--ghost" onClick={reset}>
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
      <div className="ht-ai__panel" data-testid="duration-loading">
        <span>正在等待端点返回…</span>
      </div>
    );
  }

  // ── 🔴 提议：AI 的输出不会自己写进去 ──────────────────────────────────
  if (phase === 'proposal' && proposal !== undefined) {
    return (
      <div
        className="ht-ai__panel"
        role="dialog"
        aria-label="AI 估时结果"
        data-testid="duration-proposal"
      >
        <div className="ht-ai__head">
          <span>
            估计需要 <strong data-testid="duration-proposal-minutes">{proposal.minutes}</strong> 分钟
            （{humanizeMinutes(proposal.minutes)}）
          </span>
          <span className="ht-ai__tag" data-testid="duration-proposal-source">
            {proposal.destination === 'none' ? '来自本机' : '来自云端'}
          </span>
        </div>

        {/* 🔴 夹过就必须说 —— 静默夹取等于让用户以为模型说的就是这个数。 */}
        {proposal.clamped && (
          <p className="ht-ai__warn" data-testid="duration-clamped">
            <AlertTriangle size={12} aria-hidden="true" />
            模型给的数超出了 {MIN_DURATION_MINUTES}–{MAX_DURATION_MINUTES} 分钟的范围，已经夹到
            {proposal.minutes} 分钟。
          </p>
        )}

        <div data-testid="duration-proposal-basis">{renderBasis()}</div>

        <p className="ht-ai__note">
          确认后会把这个分钟数写进这条任务的耗时。已写入的耗时可以随时改。
        </p>

        <div className="ht-ai__actions">
          <button
            type="button"
            className="ht-btn"
            data-testid="duration-apply"
            onClick={() => void apply()}
          >
            用这个数
          </button>
          <button
            type="button"
            className="ht-btn ht-btn--ghost"
            data-testid="duration-reject"
            onClick={reset}
          >
            不要了
          </button>
        </div>
      </div>
    );
  }

  // ── 失败：给出**具体原因**，并提供不依赖 AI 的退路 ─────────────────────
  return (
    <div className="ht-ai__panel" role="dialog" aria-label="AI 估时失败" data-testid="duration-failed">
      <div className="ht-ai__head">
        <span>没能估时</span>
        <button type="button" className="ht-btn ht-btn--ghost" aria-label="关闭" onClick={reset}>
          <X size={12} aria-hidden="true" />
        </button>
      </div>
      <p data-testid="duration-failure-message">{failure}</p>

      {/* 🔴 手动兜底 —— **不是 AI 生成物**，用户自己填、自己按。 */}
      <p className="ht-ai__row" data-testid="duration-manual">
        自己填一个：
        <input
          type="number"
          min={MIN_DURATION_MINUTES}
          max={MAX_DURATION_MINUTES}
          value={manualText}
          onChange={(e) => {
            setManualText(e.target.value);
          }}
          aria-label="手动输入耗时（分钟）"
          data-testid="duration-manual-input"
        />
        分钟
        <button
          type="button"
          className="ht-btn"
          data-testid="duration-manual-apply"
          disabled={!manualOk}
          onClick={() => void applyManual()}
        >
          用这个数
        </button>
      </p>

      <div className="ht-ai__actions">
        <button
          type="button"
          className="ht-btn ht-btn--ghost"
          data-testid="duration-retry"
          onClick={() => setPhase('disclosing')}
        >
          再试一次
        </button>
        <button
          type="button"
          className="ht-btn ht-btn--ghost"
          data-testid="duration-close"
          onClick={reset}
        >
          关闭
        </button>
      </div>
    </div>
  );
}
