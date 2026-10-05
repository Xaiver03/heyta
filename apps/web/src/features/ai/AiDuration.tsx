import { ICON_SIZE } from '@heyta/design-system';
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
 *   - 有偏好 → 用**结构化事实** `PreferenceHint.facts` 取**当前语言**的词条
 *     （🔴 **不是** `hint.summary` —— 那是领域层拼好的**中文投影**，
 *     整句渲染它会让英文界面露中文；映射函数只有一份，在
 *     `features/settings/preference-copy.ts`）
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
import { AlertTriangle, Clock, X } from 'lucide-react';

import { useI18n, type I18nValue } from '@heyta/i18n';

import { AiDisclosureHost } from './AiDisclosureHost.js';
import { AiPanelHost } from './AiPanelHost.js';
import { AiPanelHeadHost } from './AiPanelHeadHost.js';
import { FailureSettingsAction, RouteUnavailable } from './RouteUnavailable.js';
import { useAiSettingsNavigation } from './ai-settings-navigation.js';
import {
  resolveFeatureRoute,
  type SettingsTarget,
} from './route-explanation.js';
import { preferenceEvidenceCopy } from '../settings/preference-copy.js';

import {
  renderPreferenceHints,
  type PreferenceSet,
} from '@heyta/domain';
import {
  buildDisclosure,
  fromHealthSnapshot,
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
import { durationFailureCopy, type AiFailureCopy } from './ai-failure-copy.js';
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
 * 🔴 实现已收进 `resolveFeatureRoute()`（`route-explanation.ts`）——
 * 仓里原本有四份同样的"取首选候选并描述它"。本函数保留为薄包装：
 * 界面测试直接调它，组件内部用 `resolveFeatureRoute()`。
 */
export function resolveDurationTarget(
  routing: AiRoutingConfig,
  options: { now?: number } = {},
): ResolvedTarget | undefined {
  return resolveFeatureRoute(routing, 'duration-estimate', options).target;
}

/** 分钟数 → 人话（90 → 「1 小时 30 分钟」）。 */
function humanizeMinutes(minutes: number, t: I18nValue['t']): string {
  if (minutes < 60) return t('web.ai.duration.minutes', { minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? t('web.ai.duration.hours', { hours })
    : t('web.ai.duration.hoursMinutes', { hours, minutes: rest });
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
  /**
   * "去设置"—— 面板**只做导航**（`AiSettings` 才是授权与配置的唯一写入口）。
   * 未传时不渲染按钮。
   */
  onOpenSettings?: ((target: SettingsTarget) => void) | undefined;
}

export function AiDuration(props: AiDurationProps): React.JSX.Element {
  const {
    task,
    history,
    routing,
    consents,
    secrets,
    onApply,
    onHealth,
    preferenceSet,
    onOpenSettings: onOpenSettingsProp,
  } = props;
  const { t, locale } = useI18n();
  /** prop 是单测注入缝；生产路径由 `App.tsx` 的 Provider 提供。 */
  const onOpenSettings = onOpenSettingsProp ?? useAiSettingsNavigation();

  const [phase, setPhase] = useState<Phase>('idle');
  const [proposal, setProposal] = useState<DurationProposal | undefined>(undefined);
  const [failure, setFailure] = useState<AiFailureCopy | null>(null);
  const [applied, setApplied] = useState(false);
  /** 手动兜底输入（AI 不可用时的退路，见失败态）。 */
  const [manualText, setManualText] = useState('');

  /** 路由全貌：有路给 `target`，没路给 `explanation`（恰好一个非空）。 */
  /**
   * 🔴 熔断冷却到点后的"再试一次"。
   *
   * 解析**每次渲染都重跑**（`resolveFeatureRoute` 在渲染体里，`now` 取当前时刻），
   * 所以重试只需要强制一次重渲染 —— 不必把 tick 传进任何地方。
   * 这样"重试"与"重新打开面板"走的是**同一条路径**，不会出现第二种解析口径。
   */
  const [, retryResolution] = useState(0);
  const retry = (): void => retryResolution((n) => n + 1);

  const health = fromHealthSnapshot(props.healthSnapshot ?? {}, Date.now());
  const { target, explanation } = resolveFeatureRoute(routing, 'duration-estimate', { health });

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
    // 🔴 界面语言：它进的是提示词的「输出语言」指令，不是用户数据字段（不进 `fields`）。
    locale,
    // 🔴 时间锚点的时间源：**这一次渲染取一次**，写进 `source`。同一个 `source` 既进
    // `buildDurationInvocation`（决定界面披露里的 `today`），也进 `requestDuration`
    // （决定真正发出去的那行「今天是」）—— 跨过午夜时两边不可能给出两个不同的"今天"。
    now: Date.now(),
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
    setFailure(
      durationFailureCopy(outcome.reason, outcome.message, {
        cause: outcome.cause,
        endpointUrl: outcome.endpointUrl,
      }),
    );
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
    setFailure(null);
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
          {t('web.ai.duration.basis.none')}
        </p>
      );
    }
    return (
      <div className="ht-ai__note" data-testid="duration-basis">
        {hasHistory && (
          <p className="ht-ai__row" data-testid="duration-basis-history">
            {t('web.ai.duration.basis.historyLead')} <strong>{usableHistory.length}</strong>{' '}
            {t('web.ai.duration.basis.historyMid')}
            {totalHistory > usableHistory.length && (
              <>
                {t('web.ai.duration.basis.historyOverflow', {
                  total: totalHistory,
                  max: MAX_HISTORY_ROWS,
                })}
              </>
            )}
          </p>
        )}
        {hasHints && (
          <ul className="ht-ai__items" data-testid="duration-basis-preferences">
            {hints.map((hint) => {
              /**
               * 🔴🔴 **不渲染 `hint.summary`。**
               *
               * 那是 `@heyta/domain` 拼好的**中文投影**（`PreferenceHint.summary`
               * 的注释写着"中文投影"）。壳整句渲染它，英文界面就会在
               * 「估时依据」这一块露出中文 —— 而门禁扫不到（它查字面量，
               * 这里渲染的是变量）。
               *
               * 正确做法与 `MemoryPanel.tsx` 完全一样：拿结构化事实
               * `hint.facts` 去取**当前语言**的词条（映射函数在
               * `features/settings/preference-copy.ts`，全仓只有一份）。
               */
              const copy = preferenceEvidenceCopy(hint.facts, t);
              return (
                <li key={hint.id} data-testid={`duration-basis-${hint.id}`}>
                  {t(copy.key, copy.params)}
                </li>
              );
            })}
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
          aria-label={t('web.ai.duration.runAria', { title: task.title })}
          onClick={() => {
            setApplied(false);
            setPhase('disclosing');
          }}
        >
          <Clock size={ICON_SIZE.xs} aria-hidden="true" />
          {t('web.ai.duration.button')}
        </button>
        {applied && (
          <span className="ht-ai__done" data-testid={`duration-applied-${task.id}`}>
            {t('web.ai.duration.applied')}
          </span>
        )}
      </span>
    );
  }

  // ── 🔴 披露：只算，不发 ───────────────────────────────────────────────
  if (phase === 'disclosing') {
    return (
            <AiPanelHost
              label={t('web.ai.duration.disclosureAria')}
              testID="duration-disclosure"
              role="dialog"
            >
        <AiPanelHeadHost
          title={t('web.ai.disclosure.heading')}
          closeLabel={t('web.ai.action.cancel')}
          onClose={reset}
        />

        {target === undefined ? (
          <RouteUnavailable
            explanation={explanation}
            onOpenSettings={onOpenSettings}
            testId="duration-no-target"
            onRetry={retry}
          />
        ) : (
          <>
            {/* 🔴 披露的五个维度由 `@heyta/ui` 的 `AiDisclosure` 渲染。
                估时依据必须**发送前**就能看到，所以它走 children 插槽，
                摆在 `fields` 与 E2EE 警告之间（与改造前顺序逐字相同）。 */}
            <AiDisclosureHost
              testIdPrefix="duration-"
              target={target}
              fields={invocation.fields}
              retentionDisclosure={disclosure?.retentionDisclosure}
            >
              {renderBasis()}
            </AiDisclosureHost>

            <div className="ht-ai__actions">
              <button
                type="button"
                className="ht-btn"
                data-testid="duration-send"
                onClick={() => void send()}
              >
                {t('web.ai.action.send')}
              </button>
              <button type="button" className="ht-btn ht-btn--ghost" onClick={reset}>
                {t('web.ai.action.cancel')}
              </button>
            </div>
          </>
        )}
            </AiPanelHost>
    );
  }

  if (phase === 'loading') {
    return (
            <AiPanelHost
              label={t('web.ai.loading.waiting')}
              testID="duration-loading"
              role="status"
            >
        <span>{t('web.ai.loading.waiting')}</span>
            </AiPanelHost>
    );
  }

  // ── 🔴 提议：AI 的输出不会自己写进去 ──────────────────────────────────
  if (phase === 'proposal' && proposal !== undefined) {
    return (
            <AiPanelHost
              label={t('web.ai.duration.proposalAria')}
              testID="duration-proposal"
              role="dialog"
            >
        <AiPanelHeadHost
          title={<>{t('web.ai.duration.proposalLead')} <strong data-testid="duration-proposal-minutes">{proposal.minutes}</strong>{' '}
            {t('web.ai.duration.proposalRest', { humanized: humanizeMinutes(proposal.minutes, t) })}</>}
          tag={{
          text: proposal.destination === 'none' ? t('web.ai.source.local') : t('web.ai.source.remote'),
          testID: 'duration-proposal-source',
          }}
        />

        {/* 🔴 夹过就必须说 —— 静默夹取等于让用户以为模型说的就是这个数。 */}
        {proposal.clamped && (
          <p className="ht-ai__warn" data-testid="duration-clamped">
            <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" />
            {t('web.ai.duration.clamped', {
              min: MIN_DURATION_MINUTES,
              max: MAX_DURATION_MINUTES,
              minutes: proposal.minutes,
            })}
          </p>
        )}

        <div data-testid="duration-proposal-basis">{renderBasis()}</div>

        <p className="ht-ai__note">
          {t('web.ai.duration.note')}
        </p>

        <div className="ht-ai__actions">
          <button
            type="button"
            className="ht-btn"
            data-testid="duration-apply"
            onClick={() => void apply()}
          >
            {t('web.ai.duration.apply')}
          </button>
          <button
            type="button"
            className="ht-btn ht-btn--ghost"
            data-testid="duration-reject"
            onClick={reset}
          >
            {t('web.ai.action.discard')}
          </button>
        </div>
            </AiPanelHost>
    );
  }

  // ── 失败：给出**具体原因**，并提供不依赖 AI 的退路 ─────────────────────
  return (
        <AiPanelHost
          label={t('web.ai.duration.failedAria')}
          testID="duration-failed"
          role="dialog"
        >
      <AiPanelHeadHost
        title={t('web.ai.duration.failedHead')}
        closeLabel={t('web.ai.action.close')}
        onClose={reset}
      />
      <p data-testid="duration-failure-message">
        {failure === null ? '' : t(failure.key)}
      </p>
      {/* 技术详情：包 / 端点返回的原文。分类与 ErrorScreen 的 <details> 相同 ——
          那是诊断**数据**，不是文案（见 ai-failure-copy.ts 的 `showDetail`）。 */}
      {failure !== null && failure.showDetail && failure.detail !== '' && (
        <details data-testid="duration-failure-message-detail">
          <summary>{t('web.ai.failure.details')}</summary>
          <p>{failure.detail}</p>
        </details>
      )}

      {/* 🔴 失败原因能在设置里修 → 给一条真的能点的路（只导航，不代授权）。 */}
      <FailureSettingsAction
        settingsTarget={failure?.settingsTarget}
        originHint={failure?.originHint}
        onOpenSettings={onOpenSettings}
        testId="duration-failure-settings"
      />

      {/* 🔴 手动兜底 —— **不是 AI 生成物**，用户自己填、自己按。 */}
      <p className="ht-ai__row" data-testid="duration-manual">
        {t('web.ai.duration.manualLead')}
        <input
          type="number"
          min={MIN_DURATION_MINUTES}
          max={MAX_DURATION_MINUTES}
          value={manualText}
          onChange={(e) => {
            setManualText(e.target.value);
          }}
          aria-label={t('web.ai.duration.manualAria')}
          data-testid="duration-manual-input"
        />
        {t('web.ai.duration.manualUnit')}
        <button
          type="button"
          className="ht-btn"
          data-testid="duration-manual-apply"
          disabled={!manualOk}
          onClick={() => void applyManual()}
        >
          {t('web.ai.duration.apply')}
        </button>
      </p>

      <div className="ht-ai__actions">
        <button
          type="button"
          className="ht-btn ht-btn--ghost"
          data-testid="duration-retry"
          onClick={() => setPhase('disclosing')}
        >
          {t('web.ai.duration.retry')}
        </button>
        <button
          type="button"
          className="ht-btn ht-btn--ghost"
          data-testid="duration-close"
          onClick={reset}
        >
          {t('web.ai.action.close')}
        </button>
      </div>
        </AiPanelHost>
  );
}
