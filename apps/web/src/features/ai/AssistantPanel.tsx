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
 * ## 🔴 3. 会话历史落在这台设备上（D-4 的 (i)，不是 (ii)）
 *
 * 这一段原来写的是"只在内存里，因为写进 `localStorage` 等于把用户内容明文
 * 放在任何同源脚本都读得到的地方"。**这句理由被实测否证了**：
 * 加密发生在**上传那一步**（`sync-client/src/client.ts:873`），
 * 本地 `state` store 里本来就躺着解开的实体，而同源脚本读得到 `localStorage`
 * 就读得到那份 IndexedDB —— 所以"明文落在本机"不是这一层新开的敞口，
 * 是现状。这个仓库真正守住的线是**口令与密钥不落盘**
 * （`credential-storage.ts` 那张表：JWT ✅、口令 ❌），它没有松，也不该被
 * 这段注释冒充成"更严"。细节写在 `assistant-history.ts` 文件头。
 *
 * 仍然**没有**做的是 D-4 的 (ii)：把对话做成 op-log 实体跨设备同步。
 * 那要新实体、墓碑，以及"另一台设备上能不能确认这条改动提案"的答案 ——
 * 产品没拍，这一层不预支。
 *
 * 界面因此必须说清历史存在哪儿（`web.ai.chat.historyLocalOnly` 那条），
 * 而未确认的改动提案**不跟着恢复**（见 `ProposalCard` 的 `expired` 分支）。
 *
 * ## 🔴 4. 本组件不发任何请求
 *
 * 网络动作全在 `requestAssistantTurn()` 里，那样出境闸门只有一条路径
 * （`check:layering` 的 `no-model-endpoint-in-apps` 会拦下试图在这里 fetch 的代码）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
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
  type AssistantFailureReason,
  type AssistantMessage,
  type AssistantStep,
  type AssistantTier,
} from '@heyta/app-host';
import type { LocalApiHost } from '@heyta/local-api';

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
import { loadCredentials } from '../sync/credential-storage.js';
import {
  clearAssistantHistory,
  type HistoryStorage,
  loadAssistantHistory,
  saveAssistantHistory,
} from './assistant-history.js';
import type { ChatItem, WithoutId } from './assistant-transcript.js';
import { useAssistantEphemeral, type AssistantPhase } from './assistant-ephemeral.js';

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
  /**
   * 会话历史的落盘位置。默认浏览器 `localStorage`。
   *
   * 注入它是为了能测两件只在失败时才看得出来的事：隐私模式下访问本身抛、
   * 配额满时写失败。两者都不许把面板带崩。
   */
  historyStorage?: HistoryStorage | null;
}

/** 界面上的一条消息（类型定义在 `assistant-transcript.ts`，落盘层共用它）。 */

/**
 * 会话阶段的类型在 `assistant-ephemeral.tsx`（那里是它的**住处**）。
 *
 * ⚠️ 它原来叫 `Phase` 并定义在本文件里 —— 那正是缺陷本身：住在组件里就要跟着
 * 组件一起被重挂载。改名 + 搬家，是为了让"它住在哪儿"这件事在代码里可读。
 */

/**
 * 这段会话属于哪个账号 —— 用的是凭据里那个邮箱**标签**（`credential-storage` 里
 * 明确写着它不是秘密）。落盘记录绑它，读的时候不相等就当没有。
 */
function currentAccount(): string | null {
  return loadCredentials()?.email ?? null;
}

export function AssistantPanel(props: AssistantPanelProps): React.JSX.Element {
  const { t, locale } = useI18n();
  /**
   * 挂载时从本机读一次。
   *
   * 🔴 读的是**磁盘**而不是状态，所以它只能在初始化时发生一次：
   * 放进 render 体里会让每次重渲染都多读一遍，而这条会话的"身份"
   * （属于哪个账号）必须在整段会话里固定 —— 中途换账号还继续显示，
   * 就绕过了 `assistant-history.ts` 文件头第 3 条那道绑定。
   */
  const [session] = useState(() => {
    const account = currentAccount();
    return { account, history: loadAssistantHistory(account, props.historyStorage ?? null) };
  });
  const restored = session.history;
  const [items, setItems] = useState<readonly ChatItem[]>(restored?.items ?? []);
  /** 本段会话是否已经看过一次性披露。`新会话` 把它清掉。 */
  const [disclosed, setDisclosed] = useState(restored?.disclosed ?? false);
  /**
   * 🔴 未决的三样（草稿 / 等披露确认的那一句 / 阶段指示）**不住在这里**。
   *
   * 理由在 `assistant-ephemeral.tsx` 文件头：AI 面在右栏与中间列之间换挂载点
   * = 换子树 = 重挂载，而重挂载会把**已经摆在用户眼前的出境披露**连同他打了一半
   * 的那句一起收回初始态（等于替他取消一次同意请求）。那三样提到挂载点之上的
   * Provider 里，重挂载就不再是用户的一次损失。
   *
   * `stale` 是账号绑定：Provider 里那份若属于别的账号，**渲染成空**（与
   * `assistant-history.ts` 第 3 条同一判据；登出/换号不重新加载页面，
   * 而这份状态里躺着用户还没发出去的原话）。
   */
  const ephemeral = useAssistantEphemeral();
  const stale = ephemeral.owner !== undefined && ephemeral.owner !== session.account;
  const draft = stale ? '' : ephemeral.draft;
  const phase: AssistantPhase = stale ? 'idle' : ephemeral.phase;
  /**
   * 等披露确认后才要发出去的那句。
   *
   * ⚠️ 不复用 `draft`：用户在披露块上按"发送"之前可能又编辑了输入框，
   * 那一句与"他看到披露时的那一句"就不是同一句了。
   */
  const pending = stale ? undefined : ephemeral.pending;
  /**
   * 三个 setter 全部写进 Provider（函数名沿用改造前的 `setXxx`，让 diff 只落在"住哪儿"）。
   *
   * ⚠️ `send()` 一次连写三个（清草稿、记 pending、置阶段），靠的是 `write()` 里的
   * **函数式** updater：同一拍里三次调用逐次基于前一次的结果，不会互相覆盖。
   * 把 `write` 改成读闭包里的 `state` 就会只留最后一条 —— 这条不是假想，
   * `send()` 的"草稿清空但披露没弹出来"就是它的症状。
   */
  const setDraft = (value: string): void => ephemeral.write(session.account, { draft: value });
  const setPhase = (value: AssistantPhase): void =>
    ephemeral.write(session.account, { phase: value });
  const setPending = (value: string | undefined): void =>
    ephemeral.write(session.account, { pending: value });
  // 恢复出来的条目占用了 1..n（见 `assistant-history.ts` 的重新编号），
  // 计数器必须从 n 之后接着走，否则第一条新消息会和恢复出来的一条撞 key。
  const idRef = useRef(restored?.items.length ?? 0);

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

  // 🔴 每一段可见的会话变化都要落一次本机盘；空会话则**删掉**那份记录。
  // 为什么在这儿写而不是在 `append` 里写：`append` 有两处会改状态却不改历史
  // （提案被确认、用户点忽略），漏一处就是"存的那份与看见的那份不一样"。
  useEffect(() => {
    if (items.length === 0) {
      clearAssistantHistory(props.historyStorage ?? null);
      return;
    }
    saveAssistantHistory(
      { items, disclosed, account: currentAccount() },
      props.historyStorage ?? null,
    );
  }, [items, disclosed, props.historyStorage]);

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
    // ⚠️ 这里**不**再单独调 `clearAssistantHistory`：`setItems([])` 之后
    // 那个落盘 effect 就会删（判据是 `items.length === 0`）。
    // 原来这里多写了一次，变异验证把它照出来了：摘掉那次调用 ⇒ 0 红。
    // 留着它的代价不是行为差异，是"下一个读代码的人以为删盘有两条路，
    // 于是要改语义时只改一处"。
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

      {/* ⚠️ 这个 testid 是给判据用的，不是装饰：`ai-assistant-remount.spec.tsx`
          要靠它区分"请求还在飞"与"阶段被重挂载归零"—— 发送键在两种情况下都是禁用的
          （草稿已被清空），所以拿它当判据会一条都测不出来。 */}
      {phase === 'running' && (
        <p className="ht-ai__note" data-testid="ai-assistant-waiting">
          {t('web.ai.loading.waiting')}
        </p>
      )}

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

      {/*
        🔴 会话历史现在会落在这台设备上，那句话就必须**由界面说出来**而不是写在
        代码注释里。"存在哪儿"是用户决定要不要在这台机器上聊天的依据；
        只有落盘没有声明，等于应用替他做了一个他没同意过的决定。
        只在真有对话时出现 —— 空面板上说这句是噪音。
      */}
      {items.length > 0 && (
        <p className="ht-ai__note" data-testid="ai-assistant-local-only">
          {t('web.ai.chat.historyLocalOnly')}
        </p>
      )}
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
      {item.expired === true ? (
        // 🔴 恢复出来的未确认提案：卡片留着（对话断在这儿要看得懂为什么），
        // 但**没有确认按钮** —— 一次隔着页面重载的确认，用户已经看不见它的依据了。
        <p className="ht-ai__done" data-testid="ai-chat-expired">
          {t('web.ai.chat.expiredProposal')}
        </p>
      ) : item.confirmed === undefined ? (
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
