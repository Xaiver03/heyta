import { ICON_SIZE } from '@heyta/design-system';
/**
 * 对话式助手 —— 面向用户的入口（W12 / ADR-0045）
 * =================================================
 *
 * 把 `requestAssistantTurn()` 接到用户手指上的那一层。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 🔴 1. 披露是**一次性的、在循环之前**，不是逐步的
 *
 * 多步循环中途每来一步就问"可以发吗"，得到的不是一个知情同意，而是
 * 一个被点烦了的用户 —— 那比不问更糟，因为它留下了"问过"的记录。
 * 所以这里在**第一次发送之前**把这一次**最多**会送出的东西说完：
 * 字段并集（来自目录 `egressFields`）+ 工具名 + 三个硬上界。
 * 之后同一段会话不再拦；「新会话」重新问一次。
 *
 * 字段与上界**都从 `planAssistantEgress(tier)` 取**，本文件不列任何名单 ——
 * 手抄一份会漂，漂了界面就在替隐私承诺撒一个过期的谎。
 *
 * ## 🔴 2. 写：提案卡 + 用户确认，没有第二条路
 *
 * `requestAssistantTurn` 对写工具只产出提案并**当场停**（`stopsHere`），
 * 模型看不到"它被批准了"。落库的唯一路径是这里的「确认」按钮 →
 * `confirmAiToolProposal()` → `host.submit()` → `dispatch()`。
 * 本文件**没有任何**自动确认、超时确认、或"上次同意过这类改动"的捷径。
 *
 * ## 🔴 3. 会话历史只在内存里
 *
 * 聊天文本**没有**对应的领域实体，写进 `localStorage` 等于把用户内容
 * 明文放在任何同源脚本都读得到的地方（`aiStore.ts` 的文件头就是为这件事写的）。
 * 真要持久化，得先决定它是不是 op-log 实体（那要同步、要加密、要有墓碑）——
 * 那是一个产品决策，不是这一层的顺手事，已按缺口登记。
 * 刷新即清空，界面明说（「新会话」按钮就在旁边）。
 *
 * ## 🔴 4. 本组件不发任何请求
 *
 * 网络动作全在 `requestAssistantTurn()` 里，那样出境闸门只有一条路径
 * （`check:layering` 的 `no-model-endpoint-in-apps` 会拦下试图在这里 fetch 的代码）。
 */

import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Sparkles } from 'lucide-react';

import { useI18n, type I18nValue } from '@heyta/i18n';
import {
  buildDisclosure,
  fromHealthSnapshot,
  type AiFailureReason,
  type AiHealthSnapshot,
  type AiRoutingConfig,
  type EgressConsent,
  type HealthMap,
  type SecretStore,
} from '@heyta/ai';
import {
  assistantEgressFields,
  confirmAiToolProposal,
  planAssistantEgress,
  requestAssistantTurn,
  type AiToolProposal,
  type AssistantFailureReason,
  type AssistantMessage,
  type AssistantStep,
  type AssistantTier,
} from '@heyta/app-host';
import type { LocalApiHost, LocalApiWriteResult } from '@heyta/local-api';

import { AiDisclosureHost } from './AiDisclosureHost.js';
import { AiPanelHeadHost } from './AiPanelHeadHost.js';
import { AiPanelHost } from './AiPanelHost.js';
import { assistantFailureCopy } from './ai-failure-copy.js';
import { useAiSettingsNavigation } from './ai-settings-navigation.js';
import { FailureSettingsAction } from './RouteUnavailable.js';
import { LIST_SEPARATOR } from './locale-punctuation.js';
import { resolveFeatureRoute, type SettingsTarget } from './route-explanation.js';
import { intentText } from './AiToolRun.js';
import { createAiToolHost } from '../tasks/store.js';

export interface AssistantPanelProps {
  routing: AiRoutingConfig;
  consents: readonly EgressConsent[];
  /**
   * 能力档位 —— **第二个授权前端**的结果（设置页 `assistantTier`）。
   *
   * ⚠️ 它**不是** `localApi.grants`：那张表管外部程序能不能调工具，
   * 这一档管内置助手看得见哪些工具、要不要产出写提案。
   */
  tier: AssistantTier;
  secrets: SecretStore;
  healthSnapshot?: AiHealthSnapshot;
  onHealth?: (health: HealthMap) => void;
  /** 工具宿主。默认 `createAiToolHost()`；可注入**只为测试**。 */
  host?: LocalApiHost;
  /** 网络实现。可注入**只为测试**（与五个既有面板同一约定）。 */
  fetchImpl?: typeof fetch;
  /** 「去设置」的导航。注入缝，只为测试。 */
  onOpenSettings?: ((target: SettingsTarget) => void) | undefined;
}

/** 界面上的一条消息。`history` 由 `user`/`assistant` 两类拼出来。 */
type ChatItem =
  | { readonly id: number; readonly role: 'user'; readonly text: string }
  | {
      readonly id: number;
      readonly role: 'assistant';
      readonly text: string;
      readonly steps: readonly AssistantStep[];
      /** 触顶时的那一句（`stopped` 也是回答，只是带"我停在哪儿"）。 */
      readonly stoppedAt: string | undefined;
    }
  | {
      readonly id: number;
      readonly role: 'proposal';
      readonly text: string;
      readonly proposal: AiToolProposal;
      readonly confirmed: LocalApiWriteResult | undefined;
    }
  | {
      readonly id: number;
      readonly role: 'error';
      readonly reason: AssistantFailureReason;
      readonly message: string;
      readonly cause: AiFailureReason | undefined;
      readonly endpointUrl: string | undefined;
      readonly outsideFields: readonly string[] | undefined;
    };

type Phase = 'idle' | 'disclose' | 'running';

/**
 * 追加一条消息时的输入形状（`id` 由组件里的递增计数给）。
 *
 * ⚠️ 用**条件类型**而不是 `Omit<ChatItem, 'id'>`：后者会把判别联合塌成
 * 一个"所有分支的公共属性"对象，于是 `reason` / `text` 这些分支独有的字段
 * 全部报"未知属性" —— 这是 TS 的经典坑，症状看着像类型定义写错了。
 */
type WithoutId<T> = T extends { readonly id: number } ? Omit<T, 'id'> : never;

export function AssistantPanel(props: AssistantPanelProps): React.JSX.Element {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<readonly ChatItem[]>([]);
  const [draft, setDraft] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  /** 🔴 本段会话是否已经看过一次性披露。`新会话` 把它清掉。 */
  const [disclosed, setDisclosed] = useState(false);
  /**
   * 等披露确认后才要发出去的那句。
   *
   * ⚠️ 不复用 `draft`：用户在披露块上按"发送"之前可能又编辑了输入框，
   * 那一句与"他看到披露时的那一句"就不是同一句了。
   */
  const [pending, setPending] = useState<string | undefined>(undefined);
  const idRef = useRef(0);

  const host = useMemo(() => props.host ?? createAiToolHost(), [props.host]);
  const settingsNavigation = useAiSettingsNavigation();
  const onOpenSettings = props.onOpenSettings ?? settingsNavigation;

  const plan = planAssistantEgress(props.tier);
  const health = fromHealthSnapshot(props.healthSnapshot ?? {}, Date.now());
  // 🔴 助手**不是**第 6 个 `AiFeature`：它就是 `tool-calling` 的多步形态
  //（见 ADR-0045 §2.1）。所以目的地、能力缺口、熔断都按 `tool-calling` 算。
  const { target, explanation } = resolveFeatureRoute(props.routing, 'tool-calling', { health });
  const disclosure =
    target === undefined
      ? undefined
      : buildDisclosure({
          feature: 'tool-calling',
          destination: target.destination,
          // 🔴 用**并集**，不是 `TOOL_CALL_EGRESS_FIELDS` 那两项 ——
          // 单步只送"这句话 + 工具名"，一轮循环还会把**每个工具结果**回送。
          // 少说一项就是用户在不知情下多送一份数据。
          fields: assistantEgressFields(props.tier),
        });

  const history: readonly AssistantMessage[] = items
    .filter((x) => x.role === 'user' || x.role === 'assistant')
    .map((x) => ({ role: x.role as 'user' | 'assistant', text: x.text }));

  /** 追加一条并返回它（`id` 由 ref 递增，不用数组长度 —— 长度会在同批两次追加时撞号）。 */
  function append(item: WithoutId<ChatItem>): void {
    idRef.current += 1;
    setItems((previous) => [...previous, { ...item, id: idRef.current } as ChatItem]);
  }

  async function turn(text: string): Promise<void> {
    setPhase('running');
    const outcome = await requestAssistantTurn(
      { text },
      {
        routing: props.routing,
        consents: props.consents,
        tier: props.tier,
        host,
        history,
        routed: {
          secretStore: props.secrets,
          ...(props.fetchImpl === undefined ? {} : { fetchImpl: props.fetchImpl }),
        },
      },
    );
    // 🔴 熔断状态回写：失败那一次通常正是计数器刚 +1 的时候。
    if (outcome.health !== undefined && props.onHealth !== undefined) props.onHealth(outcome.health);
    setPhase('idle');

    if (!outcome.ok) {
      append({
        role: 'error',
        reason: outcome.reason,
        message: outcome.message,
        cause: outcome.cause,
        endpointUrl: outcome.endpointUrl,
        outsideFields: outcome.outsideFields,
      });
      return;
    }
    if (outcome.kind === 'proposal') {
      append({ role: 'proposal', text: outcome.text, proposal: outcome.proposal, confirmed: undefined });
      return;
    }
    append({
      role: 'assistant',
      text: outcome.text,
      steps: outcome.steps,
      stoppedAt: outcome.kind === 'stopped' ? outcome.limit : undefined,
    });
  }

  function send(): void {
    const text = draft.trim();
    if (text === '') return;
    append({ role: 'user', text });
    setDraft('');
    // 🔴 第一次发送必须先见过一次性披露 —— 这一条不能由"用户大概知道"代替。
    if (!disclosed) {
      setPending(text);
      setPhase('disclose');
      return;
    }
    void turn(text);
  }

  /** 用户在披露块上按「发送」。写"已披露"这件事只在这里发生。 */
  function confirmDisclosure(): void {
    const text = pending ?? '';
    setDisclosed(true);
    setPending(undefined);
    setPhase('idle');
    if (text !== '') void turn(text);
  }

  async function confirm(item: ChatItem & { role: 'proposal' }): Promise<void> {
    const result = await confirmAiToolProposal(host, item.proposal);
    setItems((previous) => previous.map((x) => (x === item ? { ...x, confirmed: result } : x)));
  }

  function newSession(): void {
    setItems([]);
    setDisclosed(false);
    setPending(undefined);
    setPhase('idle');
  }

  return (
    // 🔴 块级面板用 `.ht-ai-panel`（`.ht-ai` 是行内小件的 `inline-flex`，
    //    误用过一次：标题/说明/输入行被摆成一行）。
    <section className="ht-ai-panel" data-testid="ai-assistant">
      <AiPanelHeadHost
        title={t('web.ai.chat.title')}
        lead={<Sparkles size={ICON_SIZE.xs} aria-hidden="true" />}
      />
      <p className="ht-ai__note" data-testid="ai-assistant-tier">
        {props.tier === 'read-only'
          ? t('web.ai.chat.tier.readOnly')
          : t('web.ai.chat.tier.readAndPropose')}
      </p>
      <p className="ht-ai__note">{t('web.ai.chat.hint')}</p>

      {items.length > 0 && (
        <ul
          className="ht-ai__items ht-ai__items--chat"
          data-testid="ai-assistant-transcript"
        >
          {items.map((item) => (
            <li
              key={item.id}
              // 🔴 `--user` / `--assistant` 是"谁说的"的唯一视觉承载（见
              //    `ai-panels.css` 里那一段）。漏掉修饰类 = 界面回到
              //    "一列输出"，而断言不会红 —— 所以它钉在面板 spec 里。
              className={`ht-ai__item ht-ai__item--${item.role}`}
              data-testid={`ai-chat-${item.role}`}
            >
              {item.role === 'user' && <span>{item.text}</span>}

              {item.role === 'assistant' && (
                <>
                  <span>{item.text}</span>
                  <ChatTrace steps={item.steps} stoppedAt={item.stoppedAt} t={t} locale={locale} />
                </>
              )}

              {item.role === 'proposal' && (
                <ProposalCard
                  item={item}
                  onConfirm={() => void confirm(item)}
                />
              )}

              {item.role === 'error' && (
                <ChatFailure
                  reason={item.reason}
                  message={item.message}
                  cause={item.cause}
                  endpointUrl={item.endpointUrl}
                  outsideFields={item.outsideFields}
                  onOpenSettings={onOpenSettings}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {phase === 'disclose' && (
        <AiPanelHost label={t('web.ai.chat.disclosureHeading')} testID="ai-assistant-disclosure" role="dialog">
          <AiPanelHeadHost
            title={t('web.ai.chat.disclosureHeading')}
            closeLabel={t('web.ai.action.cancel')}
            closeTestID="ai-assistant-disclosure-close"
            onClose={() => setPhase('idle')}
          />
          <p className="ht-ai__note">{t('web.ai.chat.disclosureLead')}</p>

          {target === undefined ? (
            <p className="ht-ai__warn" data-testid="ai-assistant-no-target">
              {t(explanation.key, explanation.params)}
            </p>
          ) : (
            <>
              <AiDisclosureHost
                testIdPrefix="ai-assistant-"
                target={target}
                fields={disclosure?.fields ?? []}
                retentionDisclosure={disclosure?.retentionDisclosure}
              >
                {/* 工具名与三个上界：这一段是助手**特有**的，共享披露组件不知道它。 */}
                <p className="ht-ai__note" data-testid="ai-assistant-disclosure-tools">
                  {t('web.ai.assistant.toolsTitle')} {plan.tools.join(LIST_SEPARATOR[locale])}
                </p>
                <p className="ht-ai__note" data-testid="ai-assistant-disclosure-limits">
                  {t('web.ai.chat.limits', {
                    requests: plan.maxRequests,
                    messages: plan.maxMessages,
                    bytes: plan.maxBytesPerRequest,
                  })}
                </p>
              </AiDisclosureHost>
              <div className="ht-ai__actions">
                <button
                  type="button"
                  className="ht-btn"
                  data-testid="ai-assistant-send"
                  onClick={confirmDisclosure}
                >
                  {t('web.ai.action.send')}
                </button>
              </div>
            </>
          )}
        </AiPanelHost>
      )}

      {phase === 'running' && <p className="ht-ai__note">{t('web.ai.loading.waiting')}</p>}

      <div className="ht-ai__actions">
        <input
          className="ht-input"
          aria-label={t('web.ai.chat.inputAria')}
          placeholder={t('web.ai.chat.placeholder')}
          value={draft}
          data-testid="ai-assistant-input"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          type="button"
          className="ht-btn"
          data-testid="ai-assistant-send-button"
          onClick={send}
          disabled={draft.trim() === '' || phase === 'running'}
        >
          {t('web.ai.chat.send')}
        </button>
        <button
          type="button"
          className="ht-btn ht-btn--ghost"
          data-testid="ai-assistant-new-session"
          onClick={newSession}
          disabled={items.length === 0}
        >
          {t('web.ai.chat.newSession')}
        </button>
      </div>

      {/* 🔴 免责声明常驻，不是只在出错时才出现的一条脚注。 */}
      <p className="ht-ai__note" data-testid="ai-assistant-disclaimer">
        {t('web.ai.chat.disclaimer')}
      </p>
    </section>
  );
}

/** 「已调用 N 个工具」那一行（ADR-0045 的过程可见）。 */
function ChatTrace(props: {
  steps: readonly AssistantStep[];
  stoppedAt: string | undefined;
  t: I18nValue['t'];
  locale: I18nValue['locale'];
}): React.JSX.Element {
  const { t, locale } = props;
  const failed = props.steps.filter((s) => !s.ok).length;
  return (
    <>
      <p className="ht-ai__note" data-testid="ai-chat-trace">
        {props.steps.length === 0
          ? t('web.ai.chat.noTrace')
          : t('web.ai.chat.trace', { n: props.steps.length })}
        {failed > 0 ? ` · ${props.steps.map((s) => s.tool).join(LIST_SEPARATOR[locale])}` : ''}
      </p>
      {props.stoppedAt !== undefined && (
        <p className="ht-ai__note" data-testid="ai-chat-stopped">
          {t('web.ai.chat.stoppedLead')}
          {props.stoppedAt}
        </p>
      )}
    </>
  );
}

/** 提案卡：人说"要改什么"，然后**只有**这一颗按钮能落库。 */
function ProposalCard(props: {
  item: ChatItem & { role: 'proposal' };
  onConfirm: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const { item } = props;
  return (
    <>
      {item.text !== '' && <p className="ht-ai__note">{item.text}</p>}
      <p className="ht-ai__row" data-testid="ai-chat-proposal">
        {t('web.ai.tools.proposalLead')}
        <strong>{intentText(item.proposal.intent, t)}</strong>
      </p>
      {item.confirmed === undefined ? (
        <div className="ht-ai__actions">
          <button
            type="button"
            className="ht-btn ht-btn--primary"
            aria-label={t('web.ai.tools.confirmAria')}
            data-testid="ai-chat-confirm"
            onClick={props.onConfirm}
          >
            {t('web.ai.tools.confirm')}
          </button>
        </div>
      ) : (
        <p className="ht-ai__done" data-testid="ai-chat-confirmed">
          {item.confirmed.ok
            ? t('web.ai.tools.confirmedOk')
            : t('web.ai.tools.confirmedFail', { message: item.confirmed.message })}
        </p>
      )}
    </>
  );
}

function ChatFailure(props: {
  reason: AssistantFailureReason;
  message: string;
  cause: AiFailureReason | undefined;
  endpointUrl: string | undefined;
  outsideFields: readonly string[] | undefined;
  onOpenSettings?: ((target: SettingsTarget) => void) | undefined;
}): React.JSX.Element {
  const { t, locale } = useI18n();
  const failure = assistantFailureCopy(props.reason, props.message, {
    cause: props.cause,
    endpointUrl: props.endpointUrl,
  });
  return (
    <>
      <p className="ht-ai__row ht-ai__row--warn">
        <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" />
        <span data-testid="ai-chat-failure-message">{t(failure.key)}</span>
      </p>
      {/* 🔴 越界字段名**只有**在这里出现 —— 它是"哪一项数据没被批准过"的唯一证据，
          而那句话在包里是动态拼的，进不了词条。 */}
      {props.outsideFields !== undefined && props.outsideFields.length > 0 && (
        <p className="ht-ai__note" data-testid="ai-chat-outside-fields">
          {props.outsideFields.join(LIST_SEPARATOR[locale])}
        </p>
      )}
      {failure.showDetail && failure.detail !== '' && (
        <details data-testid="ai-chat-failure-message-detail">
          <summary>{t('web.ai.failure.details')}</summary>
          <p>{failure.detail}</p>
        </details>
      )}
      <FailureSettingsAction
        settingsTarget={failure.settingsTarget}
        originHint={failure.originHint}
        onOpenSettings={props.onOpenSettings}
        testId="ai-chat-failure-settings"
      />
    </>
  );
}
