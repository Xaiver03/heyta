import { AssistantIcon } from './AssistantIcon.js';
import { ICON_SIZE } from '@heyta/design-system';
/**
 * AI 优先级排序 —— 面向用户的入口
 * ====================================
 *
 * 这是把 `requestPrioritize()` 接到用户手指上的那一层。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 🔴 与 `AiBreakdown` 同一条纪律：发送前的披露
 *
 * heyta 是端到端加密的，而 AI 是唯一的**明文出境口**。用户必须在自己
 * 按下发送之前，看到**到底什么会离开这台设备**。所以流程被拆成两步，
 * 且中间那一步不能省：
 *
 *   1. 点击 → 计算并显示披露（**只算，不发**）
 *   2. 用户看到之后按"发送" → 才真的发
 *
 * ## 🔴 排序的输出**不会自己写进数据**
 *
 * 模型回来的是一份**提议**（`PrioritizeProposal`）。它要经过用户再确认一次，
 * 才经 `onApply` 走 op-log 写进 `Task.priority`。
 *
 * ## 🔴 逐条取舍是承重的，不是礼貌
 *
 * 一批任务里总有一两条模型判断错了。如果只能"全用 / 全弃"，
 * 用户要么放弃整份建议，要么接受一条错的优先级 —— 两条路都会让
 * "AI 排序"这件事变得不可用。所以**每条一个勾选框，默认全选**。
 *
 * ⚠️ 本组件**自己不发请求**：它只构造调用、显示披露、把结果交回。
 * 网络动作全在 `requestPrioritize()` 里 —— 那样出境闸门才只有一条路径。
 */

import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

import { useI18n } from '@heyta/i18n';

import { AiDisclosureHost } from './AiDisclosureHost.js';
import { AiPanelHost } from './AiPanelHost.js';
import { AiPanelHeadHost } from './AiPanelHeadHost.js';

import {
  Priority,
  renderPreferenceHints,
  type PreferenceSet,
  type Task,
} from '@heyta/domain';
import {
  buildDisclosure,
  fromHealthSnapshot,
} from '@heyta/ai';
import type {
  AiHealthSnapshot,
  AiRoutingConfig,
  EgressConsent,
  HealthMap,
  SecretStore,
} from '@heyta/ai';
import {
  MAX_PRIORITIZE_TASKS,
  buildPrioritizeInvocation,
  requestPrioritize,
  type PrioritizeDecision,
  type PrioritizeProposal,
  type PrioritizeTaskInput,
} from '@heyta/app-host';
import { prioritizeFailureCopy, type AiFailureCopy } from './ai-failure-copy.js';
import { FailureSettingsAction, RouteUnavailable } from './RouteUnavailable.js';
import { useAiSettingsNavigation } from './ai-settings-navigation.js';
import {
  resolveFeatureRoute,
  type ResolvedRouteTarget,
  type SettingsTarget,
} from './route-explanation.js';

/** 路由解析结果里"这个功能会走到哪个端点"。形状定义在 `route-explanation.ts`。 */
export type PrioritizeTarget = ResolvedRouteTarget;

/**
 * 算出「优先级排序」当前的**首选目标**。
 *
 * 🔴 实现已收进 `resolveFeatureRoute()`（`route-explanation.ts`）——
 * 过滤规则（能力、熔断、远端开关、URL 合法性）**只有一份**，
 * 就是 `packages/ai` 的 `resolveRoute`。
 */
export function resolvePrioritizeTarget(
  routing: AiRoutingConfig,
  options: { now?: number } = {},
): PrioritizeTarget | undefined {
  return resolveFeatureRoute(routing, 'prioritize', options).target;
}

type Phase = 'idle' | 'disclosing' | 'loading' | 'proposal' | 'failed';

export interface AiPrioritizeProps {
  /** 要排序的一批任务。**只有 id/title/dueDate/priority 会被发出去**（见 app-host）。 */
  tasks: readonly Task[];
  routing: AiRoutingConfig;
  consents: readonly EgressConsent[];
  secrets: SecretStore;
  /**
   * 🔴 上次会话落盘的**熔断状态**。不传它，落盘就是白做的 ——
   * 跳闸的端点活不过一次刷新，用户每次打开都要再撞一次。
   *
   * ⚠️ 传**原始快照**而不是 `HealthMap`：解析要在**发送那一刻**做，
   * 这样冷却期是对着"现在"算的。
   */
  healthSnapshot?: AiHealthSnapshot | undefined;
  /**
   * 用户确认后写入。**必须经 store 的 `setPriority`**（那条路走 op-log）。
   *
   * 🔴 传的是**逐条取舍后**的决定，不是全部建议。
   */
  onApply: (decisions: readonly PrioritizeDecision[]) => Promise<void>;
  /**
   * 每次调用后把**熔断状态**交回给调用方落盘。
   *
   * ⚠️ 不管成功还是失败都要交 —— 失败正是要记的东西。
   */
  onHealth?: (health: HealthMap) => void;
  /** 仅在测试里注入。生产用 `globalThis.fetch`。 */
  fetchImpl?: typeof fetch;
  /**
   * 记忆层推断出的偏好集（见 `@heyta/domain` 的 `inferPreferences`）。
   *
   * ⚠️ 可选，默认「没有记忆」—— fail closed：忘了传的后果是"这次排序不带偏好"，
   * 而不是"偷偷多发数据"。主开关关闭时 `renderPreferenceHints` 返回空数组。
   */
  preferenceSet?: PreferenceSet | undefined;
  /**
   * "去设置"—— 面板**只做导航**（授权与配置的唯一写入口是 `AiSettings`）。
   * 未传时不渲染按钮。
   */
  onOpenSettings?: ((target: SettingsTarget) => void) | undefined;
}

export function AiPrioritize(props: AiPrioritizeProps): React.JSX.Element {
  const {
    tasks,
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

  /**
   * 优先级 → 展示文案。
   *
   * ⚠️ 与 `CaptureComposer` 里的那份是**同一件事的第二个副本** ——
   * 这是本轮不允许改 `packages/domain` / 那个组件造成的。
   * 只放显示文案，不参与任何判断，所以它漂移的后果仅限"文字不一致"。
   */
  const priorityLabel: Record<Priority, string> = {
    [Priority.High]: t('web.ai.prioritize.priority.high'),
    [Priority.Medium]: t('web.ai.prioritize.priority.medium'),
    [Priority.Low]: t('web.ai.prioritize.priority.low'),
    [Priority.None]: t('web.ai.prioritize.priority.none'),
  };

  const [phase, setPhase] = useState<Phase>('idle');
  const [proposal, setProposal] = useState<PrioritizeProposal | undefined>(undefined);
  /** 哪些建议要写入。**默认全选**。 */
  const [selected, setSelected] = useState<readonly boolean[]>([]);
  const [failure, setFailure] = useState<AiFailureCopy | null>(null);
  const [applied, setApplied] = useState(false);

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
  const { target, explanation } = resolveFeatureRoute(routing, 'prioritize', { health });

  /**
   * 🔴 出境面在这里收窄：只取排序需要的四个字段，**绝不带 `note`**。
   *
   * 类型上 `PrioritizeTaskInput` 就没有 `note`，所以这不是"记得别写"，
   * 而是写不进去 —— 与 `ai-breakdown.ts` 的纪律一致。
   */
  const source = {
    // 🔴 界面语言：理由（reason）是给人看的字，必须跟着界面走。
    locale,
    // 🔴 时间锚点的时间源：**这一次渲染取一次**，写进 `source`。
    // 同一个 `source` 既进 `buildPrioritizeInvocation`（决定界面披露里的 `today`），
    // 也进 `requestPrioritize`（决定真正发出去的那行「今天是」）—— 于是跨过午夜时
    // 两边不可能给出两个不同的"今天"。与 `AiCapture` 的 `frozenAt` 同一条纪律。
    now: Date.now(),
    tasks: tasks.map((task): PrioritizeTaskInput => ({
      id: task.id,
      title: task.title,
      ...(task.dueDate === undefined ? {} : { dueDate: task.dueDate }),
      ...(task.priority === undefined ? {} : { priority: task.priority }),
    })),
  };

  /**
   * 🔴 偏好 → 提示。`renderPreferenceHints` 按用途过滤（排序只要
   * 提前量 / 高效时段），且主开关关闭时返回空数组 —— 两条路径都不会漏。
   */
  const hints = preferenceSet === undefined ? [] : renderPreferenceHints(preferenceSet, 'prioritize');

  const invocation = buildPrioritizeInvocation(source, hints);

  /**
   * 🔴 披露内容由 `packages/ai` 的 `buildDisclosure()` 组装 ——
   * 测试与 UI 共用同一条路径，界面不自己写一份（那会漂移）。
   */
  const disclosure =
    target === undefined
      ? undefined
      : buildDisclosure({
          feature: 'prioritize',
          destination: target.destination,
          fields: invocation.fields,
        });

  async function send(): Promise<void> {
    setPhase('loading');
    const outcome = await requestPrioritize(source, {
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
      setSelected(outcome.proposal.suggestions.map(() => true));
      setPhase('proposal');
      return;
    }
    setFailure(
      prioritizeFailureCopy(outcome.reason, outcome.message, {
        cause: outcome.cause,
        endpointUrl: outcome.endpointUrl,
      }),
    );
    setPhase('failed');
  }

  /** 被勾选的建议。 */
  function keptSuggestions(): readonly { id: string; priority: Priority }[] {
    if (proposal === undefined) return [];
    return proposal.suggestions.filter((_, i) => selected[i] === true);
  }

  /** 按 id 找标题，让用户知道这条建议说的是哪件事。 */
  function titleOf(id: string): string {
    return tasks.find((t) => t.id === id)?.title ?? id;
  }

  async function apply(): Promise<void> {
    const kept = keptSuggestions();
    if (kept.length === 0) return;

    // 🔴 只把 id 与新优先级交回去 —— 理由不是数据，不进 op-log。
    await onApply(kept.map((s) => ({ id: s.id, priority: s.priority })));
    setApplied(true);
    setPhase('idle');
  }

  function reset(): void {
    setPhase('idle');
    setProposal(undefined);
    setSelected([]);
    setFailure(null);
    setApplied(false);
  }

  // ── 空闲：只是一个按钮 ────────────────────────────────────────────────
  if (phase === 'idle') {
    return (
      <span className="ht-ai">
        <button
          type="button"
          className="ht-btn ht-btn--ghost"
          data-testid="prioritize-open"
          aria-label={t('web.ai.prioritize.runAria')}
          disabled={tasks.length === 0}
          onClick={() => {
            setApplied(false);
            setPhase('disclosing');
          }}
        >
          <AssistantIcon size={ICON_SIZE.xs} aria-hidden="true" />
          {t('web.ai.prioritize.button')}
        </button>
        {applied && (
          <span className="ht-ai__done" data-testid="prioritize-applied">
            {t('web.ai.prioritize.applied')}
          </span>
        )}
      </span>
    );
  }

  // ── 🔴 披露：只算，不发 ───────────────────────────────────────────────
  if (phase === 'disclosing') {
    return (
            <AiPanelHost
              label={t('web.ai.prioritize.disclosureAria')}
              testID="prioritize-disclosure"
              role="dialog"
            >
        <AiPanelHeadHost
          title={t('web.ai.disclosure.heading')}
          closeLabel={t('web.ai.action.cancel')}
          closeTestID="prioritize-disclosure-close"
          onClose={reset}
        />

        {target === undefined ? (
          <RouteUnavailable
            explanation={explanation}
            onOpenSettings={onOpenSettings}
            testId="prioritize-no-target"
            onRetry={retry}
          />
        ) : (
          <>
            {/* 🔴 披露的五个维度由 `@heyta/ui` 的 `AiDisclosure` 渲染 ——
                五个 AI 入口共用同一份实现。面板专有的 count 行走 children 插槽，
                摆在 `fields` 与 E2EE 警告之间（与改造前顺序逐字相同）。 */}
            <AiDisclosureHost
              testIdPrefix="prioritize-"
              target={target}
              fields={invocation.fields}
              retentionDisclosure={disclosure?.retentionDisclosure}
            >
              <p className="ht-ai__note" data-testid="prioritize-count">
                {t('web.ai.prioritize.countLead')} <strong>{source.tasks.length}</strong> {t('web.ai.prioritize.countTail')}
              </p>
            </AiDisclosureHost>

            <div className="ht-ai__actions">
              <button
                type="button"
                className="ht-btn"
                data-testid="prioritize-send"
                onClick={() => void send()}
              >
                {t('web.ai.action.send')}
              </button>
              <button
                type="button"
                className="ht-btn ht-btn--ghost"
                data-testid="prioritize-cancel"
                onClick={reset}
              >
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
              testID="prioritize-loading"
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
              label={t('web.ai.prioritize.proposalAria')}
              testID="prioritize-proposal"
              role="dialog"
            >
        <AiPanelHeadHost
          title={t('web.ai.prioritize.proposalHead', { count: proposal.suggestions.length })}
          tag={{
          text: proposal.destination === 'none' ? t('web.ai.source.local') : t('web.ai.source.remote'),
          testID: 'prioritize-proposal-source',
          }}
        />

        {proposal.truncated && (
          <p className="ht-ai__warn" data-testid="prioritize-truncated">
            <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" />
            {t('web.ai.prioritize.truncated', { max: MAX_PRIORITIZE_TASKS })}
          </p>
        )}

        <ul className="ht-ai__items" data-testid="prioritize-items">
          {proposal.suggestions.map((suggestion, index) => (
            <li key={`${String(index)}-${suggestion.id}`}>
              {/* 🔴 逐条可取消。默认全选，所以"直接用"仍然是零操作。 */}
              <label className="ht-ai__item">
                <input
                  type="checkbox"
                  checked={selected[index] === true}
                  onChange={(e) => {
                    const next = proposal.suggestions.map((_, i) =>
                      i === index ? e.target.checked : selected[i] === true,
                    );
                    setSelected(next);
                  }}
                  data-testid={`prioritize-item-${String(index)}`}
                />
                <span data-testid={`prioritize-title-${String(index)}`}>
                  {titleOf(suggestion.id)}
                </span>
                <span className="ht-ai__tag" data-testid={`prioritize-priority-${String(index)}`}>
                  {priorityLabel[suggestion.priority]}
                </span>
                {/* 🔴 理由必须显示 —— 没有理由的优先级建议等于让用户盲签。 */}
                <span className="ht-ai__note" data-testid={`prioritize-reason-${String(index)}`}>
                  {suggestion.reason}
                </span>
              </label>
            </li>
          ))}
        </ul>

        <p className="ht-ai__note">
          {t('web.ai.prioritize.noteLead')}<strong>{t('web.ai.prioritize.noteStrong')}</strong>{t('web.ai.prioritize.noteMid')}{' '}
          <strong data-testid="prioritize-kept-count">{keptSuggestions().length}</strong>{' '}
          {t('web.ai.prioritize.noteCount', { count: proposal.suggestions.length })}
        </p>

        <div className="ht-ai__actions">
          <button
            type="button"
            className="ht-btn"
            data-testid="prioritize-apply"
            disabled={keptSuggestions().length === 0}
            onClick={() => void apply()}
          >
            {t('web.ai.prioritize.apply')}
          </button>
          <button type="button" className="ht-btn ht-btn--ghost" data-testid="prioritize-reject" onClick={reset}>
            {t('web.ai.action.discard')}
          </button>
        </div>
            </AiPanelHost>
    );
  }

  // ── 失败：给出**具体原因** ────────────────────────────────────────────
  return (
        <AiPanelHost
          label={t('web.ai.prioritize.failedAria')}
          
          testID="prioritize-failed"
          
          role="dialog"
          
        >

        <AiPanelHeadHost

          title={t('web.ai.prioritize.failedHead')}

          closeLabel={t('web.ai.action.close')}

          closeTestID="prioritize-failed-close"

          onClose={reset}

        />

        <p data-testid="prioritize-failure-message">

          {failure === null ? '' : t(failure.key)}

        </p>

        {/* 技术详情：包 / 端点返回的原文。分类与 ErrorScreen 的 <details> 相同 ——

            那是诊断**数据**，不是文案（见 ai-failure-copy.ts 的 `showDetail`）。 */}

        {failure !== null && failure.showDetail && failure.detail !== '' && (

          <details data-testid="prioritize-failure-message-detail">

            <summary>{t('web.ai.failure.details')}</summary>

            <p>{failure.detail}</p>

          </details>

        )}

        {/* 🔴 失败原因能在设置里修 → 给一条真的能点的路（只导航，不代授权）。 */}

        <FailureSettingsAction

          settingsTarget={failure?.settingsTarget}

          originHint={failure?.originHint}

          onOpenSettings={onOpenSettings}

          testId="prioritize-failure-settings"

        />

        <div className="ht-ai__actions">

          <button

            type="button"

            className="ht-btn ht-btn--ghost"

            data-testid="prioritize-close"

            onClick={reset}

        >
          {t('web.ai.action.close')}
        </button>
      </div>
        </AiPanelHost>
  );
}
