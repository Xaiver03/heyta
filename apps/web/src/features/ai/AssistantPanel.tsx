import { AssistantIcon } from './AssistantIcon.js';
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
 * ## 🔴 2. 写：低风险自动执行，高风险提案卡确认
 *
 * `requestAssistantTurn` 对写工具只产出一个意图并**当场停**（`stopsHere`），
 * 模型看不到"它被批准了"。执行档的低风险意图已经由 app-host 提交；高风险动作
 * 才显示「确认」按钮，并走 `confirmAiToolProposal()` → `host.submit()` → `dispatch()`。
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
import { AlertTriangle, Maximize2, Minimize2, Send, X } from 'lucide-react';

import { useI18n, type I18nValue, type MessageKey } from '@heyta/i18n';
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
  ASSISTANT_TIER_READ_ONLY,
  ASSISTANT_TIER_EXECUTE,
  assistantEgressFields,
  assistantNeedsEgressDisclosure,
  assistantGrants,
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
import {
  clearAssistantHistory,
  type HistoryStorage,
  loadAssistantHistory,
  saveAssistantHistory,
} from './assistant-history.js';
import type { ChatItem, WithoutId } from './assistant-transcript.js';
import { currentAccount, usePanelEphemeral } from './panel-ephemeral.js';

export interface AssistantPanelProps {
  routing: AiRoutingConfig;
  consents: readonly EgressConsent[];
  /**
   * 能力档位 —— **第二个授权前端**的结果（设置页 `assistantTier`）。
   *
   * ⚠️ 它**不是** `localApi.grants`：那张表管外部程序能不能调工具，
   * 这一档管内置助手看得见哪些工具，以及低风险写意图是否可自动提交。
   */
  tier: AssistantTier;
  /** Chat 内临时切换能力档位；持久化仍由设置页这一事实源负责。 */
  onTierChange?: (tier: AssistantTier) => void;
  /** 覆盖面打开时由父级提供；桌面常驻右栏不传，因此不显示关闭动作。 */
  onClose?: () => void;
  /** 将当前 Chatbot 切换到宿主提供的专注工作区；状态仍由父级持有。 */
  expanded?: boolean;
  /** 专注工作区切换回调；未提供时不渲染展开入口。 */
  onToggleExpanded?: () => void;
  secrets: SecretStore;
  healthSnapshot?: AiHealthSnapshot;
  onHealth?: (health: HealthMap) => void;
  /** 工具宿主。默认 `createAiToolHost()`；可注入**只为测试**。 */
  host?: LocalApiHost;
  /** 本机记忆总开关；关闭时工具宿主不得读取偏好来源。 */
  memoryEnabled?: boolean;
  /** 估时工具需要的最小偏好提示，由外壳按当前语言与授权派生。 */
  getDurationPreferenceHints?: () => readonly { id: string; text: string }[];
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
 * 未决状态的形状与**初始值**（初始值必须是模块级常量：`usePanelEphemeral` 的
 * `write` 把它列进依赖，render 里现造字面量会让每次渲染都换一个新回调）。
 *
 * ⚠️ 这三样原来住在组件里（`type Phase` + 三个 `useState`）—— 那正是缺陷本身：
 * 住在组件里就要跟着组件一起被重挂载。
 */
type AssistantPhase = 'idle' | 'disclose' | 'running';

interface AssistantEphemeralShape {
  draft: string;
  pending: string | undefined;
  phase: AssistantPhase;
  confirmationErrors: Readonly<Record<number, string>>;
}

const ASSISTANT_EPHEMERAL: AssistantEphemeralShape = {
  draft: '',
  pending: undefined,
  phase: 'idle',
  confirmationErrors: {},
};

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
   * 理由在 `panel-ephemeral.tsx` 文件头：AI 面在右栏与中间列之间换挂载点
   * = 换子树 = 重挂载，而重挂载会把**已经摆在用户眼前的出境披露**连同他打了一半
   * 的那句一起收回初始态（等于替他取消一次同意请求）。那三样提到挂载点之上的
   * Provider 里，重挂载就不再是用户的一次损失。
   * 账号绑定（读写两侧都查）也在那一层，两个面板共用同一份实现。
   */
  const ephemeral = usePanelEphemeral('assistant', session.account, ASSISTANT_EPHEMERAL);
  const { draft, phase, confirmationErrors = {} } = ephemeral.value;
  /**
   * 事件处理器可能在同一轮 React flush 内被连续触发（快速双击、回车），
   * 不能只读 render 时捕获的 `phase`。这个 ref 让发送入口在状态提交前也有
   * 同步的阶段闸门；同一枚闸门也挡住披露确认的重复点击。
   */
  const phaseRef = useRef<AssistantPhase>(phase);
  phaseRef.current = phase;
  /** 新会话递增；旧请求仍可自然完成，但结果不再有资格写入新会话。 */
  const requestEpochRef = useRef(0);
  /** Chat 内的选择只影响当前会话；父级可选地把它写回自己的设置事实源。 */
  const [selectedTier, setSelectedTier] = useState<AssistantTier>(props.tier);
  const selectedTierRef = useRef(selectedTier);
  selectedTierRef.current = selectedTier;
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyToggleRef = useRef<HTMLButtonElement>(null);
  const historyCloseRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const conversation = conversationRef.current;
    if (conversation === null) return;
    const disclosure = phase === 'disclose'
      ? conversation.querySelector<HTMLElement>('[data-testid="ai-assistant-disclosure"]')
      : null;
    // Begin a consent request at its heading, rather than clipping the heading
    // and close control by jumping to the bottom of a tall disclosure.
    const revealLatest = (): void => {
      if (conversation.clientHeight === 0) return;
      conversation.scrollTop = disclosure === null
        ? conversation.scrollHeight
        : conversation.scrollTop + disclosure.getBoundingClientRect().top - conversation.getBoundingClientRect().top;
    };
    revealLatest();
    disclosure?.querySelector<HTMLButtonElement>('[data-testid="ai-assistant-disclosure-close"]')?.focus({ preventScroll: true });
    // Settings temporarily hide this surface. Re-establish the disclosure's
    // position when it becomes measurable again, including after a resize.
    if (disclosure === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(revealLatest);
    observer.observe(conversation);
    return () => observer.disconnect();
  }, [items.length, phase]);
  useEffect(() => {
    if (historyOpen) historyCloseRef.current?.focus();
  }, [historyOpen]);
  function closeHistory(): void {
    setHistoryOpen(false);
    historyToggleRef.current?.focus();
  }
  useEffect(() => {
    setSelectedTier(props.tier);
  }, [props.tier]);
  /**
   * 等披露确认后才要发出去的那句。
   *
   * ⚠️ 不复用 `draft`：用户在披露块上按"发送"之前可能又编辑了输入框，
   * 那一句与"他看到披露时的那一句"就不是同一句了。
   */
  const { pending } = ephemeral.value;
  /**
   * 三个 setter 全部写进 Provider（函数名沿用改造前的 `setXxx`，让 diff 只落在"住哪儿"）。
   *
   * ⚠️ `send()` 一次连写三个（清草稿、记 pending、置阶段），靠的是 `write()` 里的
   * **函数式** updater：同一拍里三次调用逐次基于前一次的结果，不会互相覆盖。
   * 把 `write` 改成读闭包里的当前值就会只留最后一条 —— 这条不是假想，
   * `send()` 的"草稿清空但披露没弹出来"就是它的症状。
   */
  const setDraft = (value: string): void => ephemeral.write(session.account, { draft: value });
  const setPhase = (value: AssistantPhase): void => {
    phaseRef.current = value;
    ephemeral.write(session.account, { phase: value });
  };
  const setPending = (value: string | undefined): void =>
    ephemeral.write(session.account, { pending: value });
  const setConfirmationErrors = (value: Readonly<Record<number, string>>): void =>
    ephemeral.write(session.account, { confirmationErrors: value });
  // 恢复出来的条目占用了 1..n（见 `assistant-history.ts` 的重新编号），
  // 计数器必须从 n 之后接着走，否则第一条新消息会和恢复出来的一条撞 key。
  const idRef = useRef(restored?.items.length ?? 0);
  const confirmInFlight = useRef(false);

  const host = useMemo(
    () => props.host ?? createAiToolHost({
      memoryEnabled: props.memoryEnabled,
      getDurationPreferenceHints: props.getDurationPreferenceHints,
    }),
    [props.getDurationPreferenceHints, props.host, props.memoryEnabled],
  );
  const settingsNavigation = useAiSettingsNavigation();
  const onOpenSettings = props.onOpenSettings ?? settingsNavigation;

  const plan = planAssistantEgress(selectedTier);
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
          fields: assistantEgressFields(selectedTier),
        });

  const history: readonly AssistantMessage[] = items
    .filter((x) => x.role === 'user' || x.role === 'assistant')
    .map((x) => ({ role: x.role as 'user' | 'assistant', text: x.text }));
  const firstUserMessage = items.find((item) => item.role === 'user');
  const sessionLabel = firstUserMessage?.text.trim() || t('web.ai.chat.history.current');
  // The phase lives above this panel's mount point. During a responsive move
  // the panel can remount before its optimistic message is restored; keep the
  // conversation surface mounted so disclosure/waiting remains visible.
  const hasConversation = items.length > 0 || phase !== 'idle';

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

  async function turn(text: string, epoch = requestEpochRef.current): Promise<void> {
    if (epoch !== requestEpochRef.current) return;
    setPhase('running');
    const outcome = await requestAssistantTurn(
      { text },
      {
        routing: props.routing,
        consents: props.consents,
        tier: selectedTier,
        host,
        getGrants: () =>
          epoch === requestEpochRef.current && currentAccount() === session.account
            ? assistantGrants(selectedTierRef.current)
            : {},
        localize: (key, vars) => t(key as MessageKey, vars),
        executionId: `web:${session.account}:${String(idRef.current)}`,
        history,
        routed: {
          secretStore: props.secrets,
          ...(props.fetchImpl === undefined ? {} : { fetchImpl: props.fetchImpl }),
        },
      },
    );
    // 请求可能跨过了「新会话」才回包；它不能结束新会话的运行态，
    // 也不能把旧回答追加到新会话。
    if (epoch !== requestEpochRef.current) return;
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
    // 发送按钮的 disabled 只覆盖真实点击；Enter 和同一轮的重复事件也必须
    // 经过同一阶段闸门。披露阶段同样不能再追加第二条待发送消息。
    if (phaseRef.current !== 'idle') return;
    const text = draft.trim();
    if (text === '') return;
    append({ role: 'user', text });
    setDraft('');
    // 🔴 先按规则试一次（本机、纯函数、零出境）：命中就说明这一句根本不会出境，
    // 那就**不该弹出境披露** —— 单步面板 `AiToolRun` 一直是这个顺序。
    // 判定住在 `@heyta/app-host`（和循环里那一次是同一个函数），壳不另写规则。
    if (!assistantNeedsEgressDisclosure(text, { tier: selectedTier })) {
      void turn(text);
      return;
    }
    // 🔴 第一次发送必须先见过一次性披露 —— 这一条不能由"用户大概知道"代替。
    if (!disclosed) {
      setPending(text);
      setPhase('disclose');
      return;
    }
    void turn(text);
  }

  /** Closing disclosure means the message was not sent. Restore the frozen
   * text and remove its optimistic row so it cannot be persisted as sent. */
  function cancelDisclosure(): void {
    const text = pending ?? '';
    if (text !== '') {
      setDraft(text);
      setItems((previous) => {
        const last = previous[previous.length - 1];
        return last?.role === 'user' && last.text === text
          ? previous.slice(0, -1)
          : previous;
      });
    }
    setPending(undefined);
    setPhase('idle');
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  /** 用户在披露块上按「发送」。写"已披露"这件事只在这里发生。 */
  function confirmDisclosure(): void {
    if (phaseRef.current !== 'disclose') return;
    const text = pending ?? '';
    setDisclosed(true);
    setPending(undefined);
    if (text !== '') {
      void turn(text, requestEpochRef.current);
    } else {
      setPhase('idle');
    }
  }

  async function confirm(item: ChatItem & { role: 'proposal' }): Promise<void> {
    if (confirmInFlight.current) return;
    confirmInFlight.current = true;
    try {
      const result = await confirmAiToolProposal(host, item.proposal, {
        getGrants: () =>
          currentAccount() === session.account ? assistantGrants(selectedTierRef.current) : {},
      });
      if (result.ok) {
        setItems((previous) => previous.map((x) => (x === item ? { ...x, confirmed: result } : x)));
        const next = { ...confirmationErrors };
        delete next[item.id];
        setConfirmationErrors(next);
      } else {
        setConfirmationErrors({ ...confirmationErrors, [item.id]: result.message });
      }
    } finally {
      confirmInFlight.current = false;
    }
  }

  function newSession(): void {
    // `requestAssistantTurn` 没有贯穿整个 app-host 管道的取消协议；运行中切走
    // 只会隐藏旧结果，不能阻止低风险写入落库。因此必须等这一轮结束后再开新会话。
    if (phaseRef.current === 'running') return;
    requestEpochRef.current += 1;
    setHistoryOpen(false);
    requestAnimationFrame(() => composerRef.current?.focus());
    setItems([]);
    setConfirmationErrors({});
    setDisclosed(false);
    setPending(undefined);
    setPhase('idle');
    // ⚠️ 这里**不**再单独调 `clearAssistantHistory`：`setItems([])` 之后
    // 那个落盘 effect 就会删（判据是 `items.length === 0`）。
    // 原来这里多写了一次，变异验证把它照出来了：摘掉那次调用 ⇒ 0 红。
    // 留着它的代价不是行为差异，是"下一个读代码的人以为删盘有两条路，
    // 于是要改语义时只改一处"。
  }

  const HeadingTag = props.expanded === true ? 'h1' : 'h2';
  const composer = (
    <div className="ht-ai__composer">
      <textarea
        ref={composerRef}
        className="ht-input ht-ai__input"
        aria-label={t('web.ai.chat.inputAria')}
        placeholder={t('web.ai.chat.placeholder')}
        value={draft}
        rows={2}
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
        className="ht-btn ht-ai__send-button"
        aria-label={t('web.ai.chat.send')}
        data-testid="ai-assistant-send-button"
        onClick={send}
        disabled={draft.trim() === '' || phase === 'running'}
      >
        <Send size={ICON_SIZE.xs} aria-hidden="true" />
        <span className="sr-only">{t('web.ai.chat.send')}</span>
      </button>
    </div>
  );

  return (
    // 🔴 块级面板用 `.ht-ai-panel`（`.ht-ai` 是行内小件的 `inline-flex`，
    //    误用过一次：标题/说明/输入行被摆成一行）。
    <section className="ht-ai-panel" data-testid="ai-assistant" data-history-open={historyOpen ? 'true' : undefined}>
      <div className="ht-ai__workspace" onKeyDown={(event) => {
        if (event.key === 'Escape' && historyOpen) {
          event.stopPropagation();
          closeHistory();
        }
      }}>
        <aside id="ai-assistant-history" className="ht-ai__history" data-testid="ai-assistant-history" aria-label={t('web.ai.chat.history.title')}>
          <div className="ht-ai__history-head">
            <span className="ht-ai__history-title ht-type-caption">{t('web.ai.chat.history.title')}</span>
            <button
              type="button"
              className="ht-btn ht-btn--ghost ht-ai__history-new"
              data-testid="ai-assistant-new-session"
              onClick={newSession}
              disabled={phase === 'running'}
            >
              {t('web.ai.chat.newSession')}
            </button>
            <button
              ref={historyCloseRef}
              type="button"
              className="ht-btn ht-btn--ghost ht-ai__history-close"
              aria-label={t('web.ai.chat.history.close')}
              data-testid="ai-assistant-history-close"
              onClick={closeHistory}
            >
              <X size={ICON_SIZE.xs} aria-hidden="true" />
            </button>
          </div>
          <div className="ht-ai__history-group">
            <span className="ht-ai__history-group-label ht-type-caption">{t('web.ai.chat.history.today')}</span>
            {items.length > 0 ? (
              <button type="button" className="ht-ai__history-item ht-ai__history-item--active" aria-current="page" onClick={closeHistory}>
                <span>{sessionLabel}</span>
              </button>
            ) : (
              <p className="ht-ai__history-empty">{t('web.ai.chat.history.empty')}</p>
            )}
          </div>
        </aside>

        <div className="ht-ai__main">
          <header className="ht-ai__header">
            <div className="ht-ai__heading">
              <AssistantIcon size={ICON_SIZE.xs} aria-hidden="true" />
              <HeadingTag className="ht-ai__title ht-type-section-title">{t('web.ai.chat.title')}</HeadingTag>
            </div>
            <div className="ht-ai__header-actions">
              <button
                type="button"
                className="ht-btn ht-btn--ghost ht-ai__history-toggle"
                aria-expanded={historyOpen}
                aria-controls="ai-assistant-history"
                data-testid="ai-assistant-history-toggle"
                ref={historyToggleRef}
                onClick={() => setHistoryOpen((open) => !open)}
              >
                {historyOpen ? t('web.ai.chat.history.close') : t('web.ai.chat.history.open')}
              </button>
              <label className="ht-ai__tier" data-testid="ai-assistant-tier">
                <span className="ht-ai__tier-label">{t('web.ai.chat.tierLabel')}</span>
                <select
                  className="ht-input ht-ai__tier-select"
                  aria-label={t('web.ai.chat.tierLabel')}
                  value={selectedTier}
                  onChange={(event) => {
                    const next = event.target.value as AssistantTier;
                    setSelectedTier(next);
                    props.onTierChange?.(next);
                  }}
                  data-testid="ai-assistant-tier-select"
                >
                  <option value={ASSISTANT_TIER_READ_ONLY}>{t('web.ai.chat.tier.readOnly')}</option>
                  <option value={ASSISTANT_TIER_EXECUTE}>{t('web.ai.chat.tier.readAndPropose')}</option>
                </select>
              </label>
              {props.onToggleExpanded !== undefined && (
                <button
                  type="button"
                  className="ht-btn ht-btn--ghost ht-ai__expand"
                  aria-label={props.expanded === true ? t('web.ai.chat.collapse') : t('web.ai.chat.expand')}
                  aria-expanded={props.expanded === true}
                  data-testid="ai-assistant-expand"
                  onClick={props.onToggleExpanded}
                >
                  {props.expanded === true ? (
                    <Minimize2 size={ICON_SIZE.xs} aria-hidden="true" />
                  ) : (
                    <Maximize2 size={ICON_SIZE.xs} aria-hidden="true" />
                  )}
                </button>
              )}
              {props.onClose !== undefined && (
                <button
                  type="button"
                  className="ht-btn ht-btn--ghost"
                  aria-label={t('web.ai.action.close')}
                  data-testid="ai-assistant-close"
                  onClick={props.onClose}
                >
                  <X size={ICON_SIZE.xs} aria-hidden="true" />
                </button>
              )}
            </div>
          </header>
      <div className={`ht-ai__chat-body ${!hasConversation ? 'ht-ai__chat-body--empty' : ''}`}>
      {/*
       * 空会话不应该让用户面对一块“什么都没有”的技术面板。
       * 快捷建议只是把自然语言填入同一个输入框，不创建第二套执行入口；
       * 用户仍然可以编辑后再发送，隐私披露与确认流程也完全不变。
       */}
      {!hasConversation && <div className="ht-ai__empty" data-testid="ai-assistant-empty">
        <div className="ht-ai__greeting" data-testid="ai-assistant-greeting">
          <h3 className="ht-ai__greeting-title">{t('web.ai.chat.greeting')}</h3>
          <p className="ht-ai__note">{t('web.ai.chat.greetingHint')}</p>
        </div>
        {composer}
        <div className="ht-ai__suggestions" data-testid="ai-assistant-suggestions">
        {(
          [
            ['today', 'web.ai.chat.suggestion.today.label', 'web.ai.chat.suggestion.today'],
            ['capture', 'web.ai.chat.suggestion.capture.label', 'web.ai.chat.suggestion.capture'],
            ['summary', 'web.ai.chat.suggestion.summary.label', 'web.ai.chat.suggestion.summary'],
          ] as const
        ).map(([key, labelKey, promptKey]) => (
          <button
            key={key}
            type="button"
            className="ht-ai__suggestion"
            data-testid={`ai-assistant-suggestion-${key}`}
            onClick={() => ephemeral.write(session.account, { draft: t(promptKey), pending: undefined, phase: 'idle' })}
          >
            {t(labelKey)}
          </button>
        ))}
        </div>
      </div>}

      {hasConversation && <div ref={conversationRef} className="ht-ai__conversation" data-testid="ai-assistant-conversation">
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
                  confirmationError={confirmationErrors[item.id]}
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

      {phase === 'disclose' && (
        <AiPanelHost label={t('web.ai.chat.disclosureHeading')} testID="ai-assistant-disclosure" role="dialog">
          <AiPanelHeadHost
            title={t('web.ai.chat.disclosureHeading')}
            closeLabel={t('web.ai.action.cancel')}
            closeTestID="ai-assistant-disclosure-close"
            onClose={cancelDisclosure}
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
                <details className="ht-ai__technical" data-testid="ai-assistant-technical-details">
                <summary>{t('web.ai.disclosure.technicalDetails')}</summary>
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
                </details>
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

      </div>}

      {hasConversation && phase !== 'disclose' && composer}
      </div>

      <div className="ht-ai__footer">
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
      </div>
        </div>
      </div>
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
  confirmationError?: string;
}): React.JSX.Element {
  const { t, locale } = useI18n();
  const { item } = props;
  return (
    <>
      {item.text !== '' && <p className="ht-ai__note">{item.text}</p>}
      <p className="ht-ai__row" data-testid="ai-chat-proposal">
        {t('web.ai.tools.proposalLead')}
        <strong>{intentText(item.proposal.intent, t, locale)}</strong>
      </p>
      {item.expired === true ? (
        // 🔴 恢复出来的未确认提案：卡片留着（对话断在这儿要看得懂为什么），
        // 但**没有确认按钮** —— 一次隔着页面重载的确认，用户已经看不见它的依据了。
        <p className="ht-ai__done" data-testid="ai-chat-expired">
          {t('web.ai.chat.expiredProposal')}
        </p>
      ) : item.confirmed === undefined ? (
        <>
        {props.confirmationError !== undefined && (
          <p className="ht-ai__done" data-testid="ai-chat-confirmation-error">
            {props.confirmationError}
          </p>
        )}
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
        </>
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
