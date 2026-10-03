import { ICON_SIZE } from '@heyta/design-system';
/**
 * AI 工具调用 —— 面向用户的入口
 * ==================================
 *
 * 把 `requestToolCall()` 接到用户手指上的那一层。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 🔴 两条路，隐私后果完全不同 —— 所以界面必须说清是哪一条
 *
 * | 路径 | 出不出境 | 界面标记 |
 * |---|---|---|
 * | **规则命中**（`resolveToolSelection`） | **一个字节都不发** | 「本机规则命中 —— 没有联网」 |
 * | **模型选择** | 会把这句话 + 工具目录发到端点 | 「由模型选择」+ 发送前披露 |
 *
 * 组件在点击时**先用规则试一次**（同一个 `resolveToolSelection()`，不是复制一份逻辑）：
 * 命中就直接跑，**不显示披露、不弹确认** —— 因为没有数据出去，弹了反而在撒谎。
 * 只有需要模型时，才走"先披露、再发送"那一步。
 *
 * ## 🔴 写工具是"提案"，不是"执行"
 *
 * 写工具（`create_task` / `update_task` / `complete_task`）只会产出提案，
 * 用户点「确认执行」之后才走 `confirmAiToolProposal()` → `dispatch()`。
 * 这与四个既有 AI 面板是同一条纪律（ADR-0005 §3.1）。
 *
 * ⚠️ 本组件**自己不发请求**：网络动作全在 `requestToolCall()` 里 ——
 * 那样出境闸门才只有一条路径。
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, Sparkles, X } from 'lucide-react';

import { useI18n, type I18nValue } from '@heyta/i18n';
import {
  buildDisclosure,
  fromHealthSnapshot,
  type AiHealthSnapshot,
  type AiRoutingConfig,
  type EgressConsent,
  type HealthMap,
  type SecretStore,
} from '@heyta/ai';
import {
  TOOL_CALL_EGRESS_FIELDS,
  confirmAiToolProposal,
  requestToolCall,
  resolveToolSelection,
  type AiToolRunOutcome,
  type ToolCallOutcome,
} from '@heyta/app-host';
import type {
  LocalApiConfig,
  LocalApiHost,
  LocalApiWriteIntent,
  LocalApiWriteResult,
} from '@heyta/local-api';

import { AiDisclosureHost } from './AiDisclosureHost.js';
import { AiPanelHost } from './AiPanelHost.js';
import { AiPanelHeadHost } from './AiPanelHeadHost.js';
import { toolRunFailureCopy } from './ai-failure-copy.js';
import { useAiSettingsNavigation } from './ai-settings-navigation.js';
import { FailureSettingsAction } from './RouteUnavailable.js';
import { resolveFeatureRoute, type SettingsTarget } from './route-explanation.js';
import { createAiToolHost } from '../tasks/store.js';

export interface AiToolRunProps {
  routing: AiRoutingConfig;
  consents: readonly EgressConsent[];
  /** 已授权工具范围（AI 设置里那份 `localApi.grants`）。 */
  grants: LocalApiConfig['grants'];
  secrets: SecretStore;
  healthSnapshot?: AiHealthSnapshot;
  onHealth?: (health: HealthMap) => void;
  /**
   * 工具宿主。默认由 `createAiToolHost()` 从真实 store 建。
   * 可注入**只为测试**：真实产品路径只有一份宿主，不存在"壳自己造一个"。
   */
  host?: LocalApiHost;
  /** 网络实现。可注入**只为测试**（与四个既有 AI 面板同一约定）。 */
  fetchImpl?: typeof fetch;
  /**
   * 「去设置」的导航。**注入缝，只为测试**（与四个面板的 `onOpenSettings` 同名同义）：
   * 生产路径上不传，走 `useAiSettingsNavigation()` 那个 context。
   */
  onOpenSettings?: ((target: SettingsTarget) => void) | undefined;
}

type Phase = 'idle' | 'disclose' | 'running' | 'done';

/**
 * 写入意图的人话。**只是贴标签**，判断仍在 app-host。
 *
 * 🔴 导出是因为**对话助手面板也要渲染同一种提案卡**。这里留两份 = 两种说法，
 * 而"同一个提案在两个入口长得不一样"正是本仓库反复付学费的那一类。
 * 判据：`apps/web/tests/ai-assistant-panel.spec.tsx` 里那条与 `AiToolRun`
 * 逐字对照的断言。
 */
export function intentText(intent: LocalApiWriteIntent, t: I18nValue['t']): string {
  switch (intent.action) {
    case 'create-task':
      return t('web.ai.tools.intentCreate', { title: intent.title });
    case 'update-task':
      return t('web.ai.tools.intentUpdate', { id: intent.taskId });
    case 'complete-task':
      return t('web.ai.tools.intentComplete', { id: intent.taskId });
    // 🔴 W10：目录长了两个写工具 ⇒ 这里的**每个封闭变体都必须有一句人话**。
    // 少一个 case 不是"少一句文案"那么轻：TypeScript 会因为这个 switch 不再穷尽
    // 而直接报 `TS2366`（函数缺返回值）—— 这是**好事**，它把"提案卡对着用户
    // 显示 undefined"这种界面说谎挡在编译期。词条在中英两份里同步（i18n 门禁）。
    case 'create-event':
      return t('web.ai.tools.intentCreateEvent', { title: intent.title, date: intent.date });
    case 'update-event':
      return t('web.ai.tools.intentUpdateEvent', { id: intent.eventId });
  }
}

export function AiToolRun(props: AiToolRunProps): React.JSX.Element {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [outcome, setOutcome] = useState<ToolCallOutcome | undefined>(undefined);
  const [confirmed, setConfirmed] = useState<LocalApiWriteResult | undefined>(undefined);

  // 宿主只建一次：它内部只持有几个函数引用，重建没有意义。
  const host = useMemo(() => props.host ?? createAiToolHost(), [props.host]);
  /**
   * 「去设置」的导航通道 —— 与另外四个面板同一个 context
   * （`props.onOpenSettings` 仍然是单测的注入缝，优先于它）。
   */
  const settingsNavigation = useAiSettingsNavigation();
  const onOpenSettings = props.onOpenSettings ?? settingsNavigation;

  const health = fromHealthSnapshot(props.healthSnapshot ?? {}, Date.now());
  const { target, explanation } = resolveFeatureRoute(props.routing, 'tool-calling', { health });
  const disclosure =
    target === undefined
      ? undefined
      : buildDisclosure({
          feature: 'tool-calling',
          destination: target.destination,
          fields: [...TOOL_CALL_EGRESS_FIELDS],
        });

  async function execute(): Promise<void> {
    setPhase('running');
    const result = await requestToolCall(
      { text },
      {
        routing: props.routing,
        consents: props.consents,
        grants: props.grants,
        host,
        routed: {
          secretStore: props.secrets,
          ...(props.fetchImpl === undefined ? {} : { fetchImpl: props.fetchImpl }),
        },
      },
    );
    setOutcome(result);
    // 🔴 熔断状态回写 —— 失败那一次通常正是计数器刚 +1 的时候。
    if (result.health !== undefined && props.onHealth !== undefined) {
      props.onHealth(result.health);
    }
    setPhase('done');
  }

  function run(): void {
    const trimmed = text.trim();
    if (trimmed === '') return;
    setConfirmed(undefined);
    setOutcome(undefined);

    // 🔴 先按规则试一次（本机、纯函数、零出境）。
    // 命中就直接跑：没有数据出去，就不该弹披露。
    const local = resolveToolSelection(trimmed, { grants: props.grants });
    if (local.kind === 'tool') {
      void execute();
      return;
    }
    setPhase('disclose');
  }

  async function confirm(): Promise<void> {
    if (outcome === undefined || !outcome.ok || outcome.result.kind !== 'proposal') return;
    setConfirmed(await confirmAiToolProposal(host, outcome.result.proposal));
  }

  return (
    // 🔴 **块级面板**用 `.ht-ai-panel`，不是 `.ht-ai` —— 那个类是给行内小件
    // （四个 AI 按钮的 `span`）的 `inline-flex`。误用它曾把标题/说明/输入行
    // 整体摆成**一行**（截图实测：输入框悬到说明文字右侧、运行折行居中）。
    <section className="ht-ai-panel" data-testid="ai-tool-run">
      {/* 工具调用面板的头部带一个装饰图标（`lead`）—— 与四个 AI 面板共用同一个共享头。 */}
      <AiPanelHeadHost
        title={t('web.ai.tools.title')}
        lead={<Sparkles size={ICON_SIZE.xs} aria-hidden="true" />}
      />
      <p className="ht-ai__note">{t('web.ai.tools.hint')}</p>

      <div className="ht-ai__actions">
        <input
          className="ht-input"
          aria-label={t('web.ai.tools.inputAria')}
          placeholder={t('web.ai.tools.placeholder')}
          value={text}
          data-testid="ai-tool-input"
          onChange={(e) => {
            setText(e.target.value);
            setPhase('idle');
            setOutcome(undefined);
            setConfirmed(undefined);
          }}
        />
        <button
          type="button"
          className="ht-btn"
          data-testid="ai-tool-run-button"
          onClick={run}
          disabled={text.trim() === '' || phase === 'running'}
        >
          {t('web.ai.tools.run')}
        </button>
      </div>

      {phase === 'disclose' && (
                <AiPanelHost
                  label={t('web.ai.tools.disclosureAria')}
                  testID="ai-tool-disclosure"
                  role="dialog"
                >
          <AiPanelHeadHost
            title={t('web.ai.disclosure.heading')}
            closeLabel={t('web.ai.action.cancel')}
            closeTestID="ai-tool-disclosure-close"
            onClose={() => {
              setPhase('idle');
            }}
          />

          {target === undefined ? (
            <p className="ht-ai__warn" data-testid="ai-tool-no-target">
              {t(explanation.key, explanation.params)}
            </p>
          ) : (
            <>
              {/* 🔴 这里**曾经漂移**：第 5 份手抄的披露缺「回退链」与「E2EE 警告」，
                  而 `resolveFeatureRoute(routing, 'tool-calling', …)` 拿到的 target
                  确实带 `fallbacks`、`invokeRouted()` 确实会多端点回退 ——
                  也就是说工具调用可能把数据发给另一家公司，而界面没有说。
                  换成共享组件后这两维自动出现，而且跨面板一致性有 spec 钉住
                  （`apps/web/tests/ai-disclosure-parity.spec.tsx`）。 */}
              <AiDisclosureHost
                testIdPrefix="ai-tool-"
                target={target}
                fields={disclosure?.fields ?? []}
                retentionDisclosure={disclosure?.retentionDisclosure}
              />
              <div className="ht-ai__actions">
                <button
                  type="button"
                  className="ht-btn"
                  data-testid="ai-tool-send"
                  onClick={() => void execute()}
                >
                  {t('web.ai.action.send')}
                </button>
              </div>
            </>
          )}
                </AiPanelHost>
      )}

      {phase === 'running' && <p className="ht-ai__note">{t('web.ai.loading.waiting')}</p>}

      {phase === 'done' && outcome !== undefined && (
        <ToolResult
          outcome={outcome}
          confirmed={confirmed}
          onConfirm={() => void confirm()}
          onOpenSettings={onOpenSettings}
        />
      )}
    </section>
  );
}

/** 结果渲染。拆出来只是为了让上面的组件短一点。 */
function ToolResult(props: {
  outcome: ToolCallOutcome;
  confirmed: LocalApiWriteResult | undefined;
  onConfirm: () => void;
  onOpenSettings?: ((target: SettingsTarget) => void) | undefined;
}): React.JSX.Element {
  const { t } = useI18n();
  const { outcome, onOpenSettings } = props;

  if (!outcome.ok) {
    /*
      🔴 **主句取词条，原文降级成折叠的技术详情。**

      在这一刀之前这里渲染的是 `outcome.message` —— 那是 `packages/app-host`
      拼好的**中文**，于是英文界面上"工具调用失败"这一屏**整句是中文**。
      另外四个面板早就改成"按 `reason` 取词条 + 原文进 `<details>`"了，
      唯独这第 5 个入口漏了（与披露块那次漂移同一个形状：第 5 份副本没跟上）。

      `outcome.message` 里确实带着词条给不了的信息（端点原文、字数上限……），
      所以它**不是丢掉**，而是降到诊断详情里 —— 与 `ErrorScreen` 的
      `error-details` 同一处置：原始错误文本是**数据**，不翻译。

      判据：`ai-tool-run.spec.tsx` 那条"英文界面失败时不许露中文"，
      以及 `ai-failure-parity.spec.tsx` 的跨面板一致性。
    */
    const failure = toolRunFailureCopy(outcome.reason, outcome.message, {
      cause: outcome.cause,
      endpointUrl: outcome.endpointUrl,
    });
    return (
            <AiPanelHost
              label={t('web.ai.tools.failureAria')}
              testID="ai-tool-failure"
              role="dialog"
            >
        <div className="ht-ai__row ht-ai__row--warn">
          <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" />
          <span>{t('web.ai.tools.failedLead')}</span>
          <strong data-testid="ai-tool-failure-message">{t(failure.key)}</strong>
        </div>
        {failure.showDetail && failure.detail !== '' && (
          <details data-testid="ai-tool-failure-message-detail">
            <summary>{t('web.ai.failure.details')}</summary>
            <p>{failure.detail}</p>
          </details>
        )}
        {/* 这次失败能在设置里修才渲染（`settingsTarget === undefined` 时组件自己返回 null）。 */}
        <FailureSettingsAction
          settingsTarget={failure.settingsTarget}
          originHint={failure.originHint}
          onOpenSettings={onOpenSettings}
          testId="ai-tool-failure-settings"
        />
        {outcome.text !== undefined && (
          <p className="ht-ai__note">
            {t('web.ai.tools.modelTextLead')}
            {outcome.text}
          </p>
        )}
            </AiPanelHost>
    );
  }

  return (
        <AiPanelHost
          label={t('web.ai.tools.resultAria')}
          testID="ai-tool-result"
          role="dialog"
        >
      <p className="ht-ai__note" data-testid="ai-tool-via">
        {outcome.via === 'rule' ? t('web.ai.tools.viaRule') : t('web.ai.tools.viaModel')}
      </p>
      <RunResult run={outcome.result} confirmed={props.confirmed} onConfirm={props.onConfirm} />
        </AiPanelHost>
  );
}

function RunResult(props: {
  run: AiToolRunOutcome;
  confirmed: LocalApiWriteResult | undefined;
  onConfirm: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const run = props.run;

  switch (run.kind) {
    case 'observation':
      return (
        <>
          <p className="ht-ai__row">
            {t('web.ai.tools.observationLead')}
            <strong>{run.tool}</strong>
          </p>
          <pre className="ht-ai__note" data-testid="ai-tool-observation">
            {JSON.stringify(run.data, null, 2)}
          </pre>
        </>
      );

    case 'proposal':
      return (
        <>
          <p className="ht-ai__row">{t('web.ai.tools.proposalLead')}</p>
          <p className="ht-ai__item" data-testid="ai-tool-proposal">
            {intentText(run.proposal.intent, t)}
          </p>
          {props.confirmed === undefined ? (
            <div className="ht-ai__actions">
              <button
                type="button"
                className="ht-btn"
                aria-label={t('web.ai.tools.confirmAria')}
                data-testid="ai-tool-confirm"
                onClick={props.onConfirm}
              >
                {t('web.ai.tools.confirm')}
              </button>
            </div>
          ) : (
            <p className="ht-ai__done" data-testid="ai-tool-confirmed">
              {props.confirmed.ok
                ? t('web.ai.tools.confirmedOk')
                : t('web.ai.tools.confirmedFail', { message: props.confirmed.message })}
            </p>
          )}
        </>
      );

    case 'ambiguous':
      return (
        <>
          <p className="ht-ai__row">{t('web.ai.tools.ambiguousLead')}</p>
          <ul className="ht-ai__items">
            {run.candidates.map((candidate) => (
              <li key={candidate.tool} className="ht-ai__item">
                {candidate.tool}
              </li>
            ))}
          </ul>
        </>
      );

    case 'denied':
      return (
        <p className="ht-ai__row ht-ai__row--warn" data-testid="ai-tool-denied">
          <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" />
          {t('web.ai.tools.deniedLead')}
        </p>
      );

    case 'failed':
      return (
        <p className="ht-ai__row ht-ai__row--warn" data-testid="ai-tool-exec-failed">
          {t('web.ai.tools.failedLead')}
          {run.message}
        </p>
      );

    case 'none':
      return <p className="ht-ai__note">{t('web.ai.tools.empty')}</p>;
  }
}
