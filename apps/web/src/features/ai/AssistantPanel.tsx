import { AssistantIcon } from './AssistantIcon.js';
import { MarkdownMessage } from './MarkdownMessage.js';
import { Button } from '../../components/hta/index.js';
import { useImageAttach } from './ImageAttach.js';
import type { EncodedImage } from './image-encode.js';
import { MentionChips, MentionPicker } from './MentionPicker.js';
import './mention.css';
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
 * 字段与上界**都从 `planAssistantEgress()` 取**，本文件不列任何名单 ——
 * 手抄一份会漂，漂了界面就在替隐私承诺撒一个过期的谎。
 *
 * ## 🔴 2. 写：低风险自动执行，高风险提案卡确认
 *
 * `requestAssistantTurn` 对写工具只产出一个意图并**当场停**（`stopsHere`），
 * 模型看不到"它被批准了"。低风险意图已经由 app-host 提交；高风险动作
 * 才显示「确认」按钮，并走 `confirmAiToolProposal()` → `host.submit()` → `dispatch()`。
 *
 * ⚠️ 这里**没有**"只读 / 执行"档（ADR-0082）：安全性由风险闸门与上面的
 * 一次性披露提供，不由一个用户要先拨对的开关提供。
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Braces,
  ChevronDown,
  Clock,
  Maximize2,
  Minimize2,
  Send,
  X,
} from 'lucide-react';

import { useI18n, type I18nValue, type MessageKey } from '@heyta/i18n';

import {
  activeMention,
  applyMention,
  findMentions,
  isLive,
  mentionCandidates,
  mentionLookupFor,
  mentionSegments,
  toLocalDate,
  type MentionTaskCandidate,
  type MentionTaskLike,
} from '@heyta/domain';
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
  EMPTY_LIVE,
  assistantEgressFields,
  assistantNeedsEgressDisclosure,
  assistantGrants,
  confirmAiToolProposal,
  planAssistantEgress,
  reduceAssistantLive,
  hasAppliedWrite,
  requestAssistantTurn,
  type AssistantFailureReason,
  type AssistantMessage,
  type AssistantStep,
  type AssistantTurnEvent,
  type LiveRow,
  type LiveTurn,
} from '@heyta/app-host';
import { webManagedTransport } from './managed-transport.js';
import type { LocalApiHost } from '@heyta/local-api';

import { AiDisclosureHost } from './AiDisclosureHost.js';
import { AiPanelHeadHost } from './AiPanelHeadHost.js';
import { AiPanelHost } from './AiPanelHost.js';
import {
  AiGeneratedLabel,
  applyScrollIntent,
  EmptyState,
  HeytaUiProvider,
  shouldFollowOnContentChange,
  StreamCaret,
  useHeytaUiTheme,
  useStreamReveal,
} from '@heyta/ui';
import { assistantFailureCopy } from './ai-failure-copy.js';
import { runWebCloudTurn } from './cloud-harness.js';
import { useAiSettingsNavigation } from './ai-settings-navigation.js';
import { FailureSettingsAction } from './RouteUnavailable.js';
import { LIST_SEPARATOR } from './locale-punctuation.js';
import { resolveFeatureRoute, type SettingsTarget } from './route-explanation.js';
import { intentText } from './AiToolRun.js';
import { createAiToolHost, useTaskStore } from '../tasks/store.js';
import {
  clearAssistantHistory,
  assistantSessionStorage,
  type HistoryStorage,
  loadAssistantHistory,
  saveAssistantHistory,
} from './assistant-history.js';
import type { ChatItem, WithoutId } from './assistant-transcript.js';
import { currentAccount, usePanelEphemeral, usePanelSession } from './panel-ephemeral.js';

export interface AssistantPanelProps {
  routing: AiRoutingConfig;
  consents: readonly EgressConsent[];
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
  /** 从用户自己的话里规则推断记忆（M9）。推断落 pending，默认关。 */
  autoExtractMemories?: boolean;
  /** 估时工具需要的最小偏好提示，由外壳按当前语言与授权派生。 */
  getDurationPreferenceHints?: () => readonly { id: string; text: string }[];
  /**
   * 云端 Agent Harness 模式（接线开关）。默认关：保留既有 `requestAssistantTurn`
   * （含写提案/流式/历史）。开启后本轮问答走 `runWebCloudTurn`（设备本地循环 + 云端模型 +
   * 本地数据工具 + 可撤销）。⚠️ 该模式**只做读/答**：写操作会以 write-needs-confirm 返回，
   * 不在此模式落库（写入仍走既有确认流程的默认模式）。默认关以保护写入 UX。
   */
  useCloudHarness?: boolean;
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
  /**
   * 是否给流式回答播**逐字揭示**动效。默认 `true`；注入**只为测试**。
   *
   * 🔴 为什么要做成 prop 而不是自动判环境：
   * 本文件的组件测试断言的是**数据契约** —— "流到某一刻屏上的文本等于已到达的
   * 文本"（见 `tests/ai-assistant-panel.spec.tsx` 的
   * 「工具行在跑的时候就出现；文本逐字进同一个气泡」）。若揭示引擎在那些用例里
   * 自动播放，断言就会去考"动画播到第几帧"，把数据契约测成时序契约 ——
   * 那是把测试变脆，不是把功能测严。
   *
   * 引擎本身的行为由 `packages/ui/tests/ai-reveal.spec.ts` 用**假时钟**单独测穿
   * （推进、追赶、代际重置、降级各一条），所以关掉这里的播放**不减少任何判据**。
   *
   * ⚠️ 真实用户路径上它恒为 `true`；e2e（`check:ai-e2e`）走的是真实浏览器，
   * 那里动效照常播放 —— 想验证动效本身，判据在 e2e 或 `ai-reveal.spec.ts`。
   */
  revealStream?: boolean;
}

/** 界面上的一条消息（类型定义在 `assistant-transcript.ts`，落盘层共用它）。 */

/** 活会话由 Provider 拥有；页面重挂载只能换视图，不能更换请求的结果接收者。 */
type AssistantPhase = 'idle' | 'disclose' | 'running';

/**
 * `LiveRow` / `LiveTurn` / `EMPTY_LIVE` / `reduceAssistantLive` 现在住在
 * `@heyta/app-host` 的 `assistant-live.ts` —— 移动端接流式时也要同一个函数，
 * 而业务语义只许有一份（`AGENTS.md` §3.5）。签名与行为逐字未变。
 */

interface AssistantEphemeralShape {
  draft: string;
  pending: string | undefined;
  phase: AssistantPhase;
  confirmationErrors: Readonly<Record<number, string>>;
  items: readonly ChatItem[];
  /** 这一轮进行中的过程（流式）。`undefined` = 没有在跑的一轮。 */
  live: LiveTurn | undefined;
  disclosed: boolean;
  /** 同步闸门跟会话一起保存，旧请求和新挂载的面板必须看到同一份。 */
  controls: {
    phase: AssistantPhase;
    epoch: number;
    nextId: number;
    confirming: boolean;
  };
}


/** 空态建议芯片的键（与移动端 `SUGGESTIONS` 同序）：点一下把整句**填进输入框**，不直接发送。 */
const SUGGESTION_KEYS = ['today', 'capture', 'summary', 'plan'] as const;

export function AssistantPanel(props: AssistantPanelProps): React.JSX.Element {
  const session = usePanelSession();
  return <AssistantSessionPanel key={session.generation} {...props} account={session.account} />;
}

function AssistantSessionPanel(props: AssistantPanelProps & { account: string | null }): React.JSX.Element {
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
    const account = props.account;
    const storage = assistantSessionStorage(account, props.historyStorage);
    return { account, storage, history: loadAssistantHistory(account, storage) };
  });
  const [initialSession] = useState<AssistantEphemeralShape>(() => ({
    draft: '',
    pending: undefined,
    phase: 'idle',
    confirmationErrors: {},
    items: session.history?.items ?? [],
    live: undefined,
    disclosed: session.history?.disclosed ?? false,
    controls: {
      phase: 'idle', epoch: 0, nextId: session.history?.items.length ?? 0,
      confirming: false,
    },
  }));
  const ephemeral = usePanelEphemeral('assistant', session.account, initialSession);
  const { draft, phase, confirmationErrors, items, live, disclosed, controls } = ephemeral.value;

  /**
   * 流式逐字揭示（见 `packages/ui/src/ai/reveal.ts` 的文件头）。
   *
   * 🔴 三条边界，每一条都有理由：
   *
   * 1. **数据层不动**：`live.text` 仍是"到达即完整"的那个值，历史、测试、
   *    可访问性都以它为准。这里只算**该显示什么**。
   * 2. **`reducedMotion` 时整体关闭**：减少动效的用户要的是"内容照常出现、
   *    只是别动"，不是"内容慢慢挤出来"。关掉后 hook 立即返回完整文本。
   *    ⚠️ 这个值来自 `useHeytaUiTheme()`，而 web 的根 Provider 原先**恒为 false**
   *    （理由写在 `App.tsx` 的 `resolveHeytaUiTheme` 那里）—— 2026-11-10 起
   *    根上按 `prefers-reduced-motion` 真实订阅，CSS 媒体查询管不到 JS 动画，
   *    所以这一条不是可选项。
   * 3. **`props.revealStream`**：测试关掉它，理由见 props 定义处的注释。
   *
   * ⚠️ hook 必须**无条件调用**（React 规则），所以 `enabled` 是算出来传进去的，
   * 不是 `if (…) useStreamReveal(…)`。
   */
  const { reducedMotion, tokens } = useHeytaUiTheme();
  const revealedText = useStreamReveal(live?.text ?? '', {
    enabled: (props.revealStream ?? true) && !reducedMotion,
  });

  const setItems = (next: readonly ChatItem[] | ((previous: readonly ChatItem[]) => readonly ChatItem[])): void => {
    ephemeral.write(session.account, (previous) => ({
      items: typeof next === 'function' ? next(previous.items) : next,
    }));
  };
  const setDisclosed = (value: boolean): void => ephemeral.write(session.account, { disclosed: value });
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyToggleRef = useRef<HTMLButtonElement>(null);
  const historyCloseRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  /** 本轮的中断句柄：「停止」按钮 abort 它，app-host 循环在步骤边界消费。 */
  const abortRef = useRef<AbortController | null>(null);
  /**
   * 是否跟随最新内容（流式期间自动滚到底）。
   *
   * 🔴 它**不是** `useState`：跟随状态每收到一个 scroll 事件就要读一次，
   * 而绝大多数事件不改变它（用户在同一位置反复滚）。用 `useState` 会让
   * 每次 scroll 都可能触发一次重渲染，而重渲染又会改变依赖数组、
   * 让下面的滚动 effect 重跑 —— 那正是"滚动时卡顿"的经典成因。
   *
   * 用 ref 存状态、只在**真的变化**时（`changed`）才同步到 state 触发滚动。
   */
  const followRef = useRef(true);
  useEffect(() => {
    const conversation = conversationRef.current;
    if (conversation === null) return;

    /**
     * 🔴 用户滚动 → 更新跟随状态。
     *
     * 判据在 `@heyta/ui` 的 `applyScrollIntent`（纯函数、两端共用、有独立测试）：
     * 用户滚到离底部 24px 以内 ⇒ 恢复跟随；明确滚上去 ⇒ 停止跟随。
     * 这条挡的是"用户往上翻历史时被流式内容拽回底部"。
     */
    const onScroll = (): void => {
      const decision = applyScrollIntent(followRef.current, {
        offset: conversation.scrollTop,
        contentHeight: conversation.scrollHeight,
        viewportHeight: conversation.clientHeight,
      });
      followRef.current = decision.follow;
    };
    conversation.addEventListener('scroll', onScroll, { passive: true });

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
    /**
     * 🔴 只在"该跟随"时滚。
     *
     * 披露块是**强制的**（必须让用户看到才知道要发什么），所以即使他刚滚上去
     * 也照样对齐 —— 那是流程要求，不是内容更新。
     * 其余情况一律看 `followRef.current`。
     */
    if (disclosure !== null || shouldFollowOnContentChange(followRef.current)) {
      revealLatest();
    }
    disclosure?.querySelector<HTMLButtonElement>('[data-testid="ai-assistant-disclosure-close"]')?.focus({ preventScroll: true });
    // Settings temporarily hide this surface. Re-establish the disclosure's
    // position when it becomes measurable again, including after a resize.
    //
    // ⚠️ 这里**不能**用 `if (disclosure === null) return;` 提前返回 ——
    // 上面挂了 scroll 监听，提前返回会让它永远摘不掉（每渲染一次多挂一个）。
    // 下面这段用 `observer` 可空 + 统一的清理函数收口。
    let observer: ResizeObserver | null = null;
    if (disclosure !== null && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(revealLatest);
      observer.observe(conversation);
    }
    return () => {
      conversation.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
    /**
     * 🔴 依赖数组里有 `live?.text` 与 `revealedText`，这是**流式跟随**的关键。
     *
     * 改之前这里是 `[items.length, phase]` —— 两者都只在"一轮开始/结束"时变，
     * 于是**流式期间新到的字一个都不会触发滚动**：回答长过一屏之后，
     * 用户只能眼看着文字在屏幕外继续生成（实测缺口，见
     * `docs/research/ai-chat-motion-source-study.md` §1.6）。
     *
     * 用 `revealedText` 而不是只用 `live?.text`：前者每个揭示帧都在变，
     * 于是滚动能跟着**显示出来的内容**走，而不是等整段到达才跳一次。
     * 两者都列是因为降级路径（揭示关闭）下只有 `live?.text` 会变。
     */
  }, [items.length, phase, live?.text, revealedText]);
  useEffect(() => {
    if (historyOpen) historyCloseRef.current?.focus();
  }, [historyOpen]);
  function closeHistory(): void {
    setHistoryOpen(false);
    historyToggleRef.current?.focus();
  }
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
    controls.phase = value;
    ephemeral.write(session.account, { phase: value });
  };
  const setPending = (value: string | undefined): void =>
    ephemeral.write(session.account, { pending: value });
  const setConfirmationErrors = (value: Readonly<Record<number, string>>): void =>
    ephemeral.write(session.account, { confirmationErrors: value });

  const host = useMemo(
    () => props.host ?? createAiToolHost({
      memoryEnabled: props.memoryEnabled,
      getDurationPreferenceHints: props.getDurationPreferenceHints,
    }),
    [props.getDurationPreferenceHints, props.host, props.memoryEnabled],
  );
  const settingsNavigation = useAiSettingsNavigation();
  const onOpenSettings = props.onOpenSettings ?? settingsNavigation;

  /**
   * 🔴 披露要跟着**这一轮有没有图**走：带图时不写 `images`，用户就会以为只发文字。
   * 它在这里算而不是发送时算，因为披露必须在任何一次请求之前成立。
   */
  /**
   * 附件图片。**只活在这个面板的内存里**：不进 op-log、不同步、不落会话历史。
   * 与捕获那条同一条纪律（ADR-0005「AI 是输入法」—— 输入法不存你打的字）。
   */
  const [images, setImages] = useState<readonly EncodedImage[]>([]);
  const [harnessUndo, setHarnessUndo] = useState<(() => Promise<unknown>) | null>(null);
  /** 流式阶段是否已开始准备工具调用（Harness 模式）——用于等待文案。 */
  const [harnessPreparing, setHarnessPreparing] = useState(false);

  /**
   * 附件：图标进输入框内部左下角，缩略图落在字段下方（与任务列同一套形状）。
   * `pasteScope` 用对话根，别抢任务列与搜索框的粘贴。
   */
  const attach = useImageAttach({
    images,
    onChange: setImages,
    disabled: phase === 'running',
    pasteScope: '[data-heyta-chat-root]',
    testIdPrefix: 'chat-attach',
  });
  const plan = planAssistantEgress({ hasImages: images.length > 0 });

  // ── `@` 提及 ────────────────────────────────────────────────────────────
  //
  // 三条纪律都在 `@heyta/domain` 的 `mentions.ts` 里：文本是事实源、芯片是投影、
  // 键盘与解析共用同一套语法。这里只负责"把光标位置和选中项接上"。
  const entities = useTaskStore((state) => state.entities);
  /**
   * 陈述记忆（`USER_MEMORY`）。注入与披露用同一份列表、同一个开关 ——
   * 「说了会发」与「真的发了」必须由同一个判断派生。
   */
  const memoryItems = Object.values(entities.userMemories);
  /**
   * 披露按**开关**算，不按「当前有没有条目」算。
   *
   * 反过来的话会有一个真实的窃听空子：用户看过一次不含记忆的披露并点了同意，
   * 之后又说了一句「记住…」——下一轮就带着记忆出境，而用户从没同意过这一项。
   */
  const memoryActive = props.memoryEnabled === true;
  const [caret, setCaret] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  /** 按过 Esc 之后，直到下一次输入才重新弹候选。 */
  const [mentionClosed, setMentionClosed] = useState(false);

  const mentionTasks = useMemo<readonly MentionTaskLike[]>(() => {
    const projects = entities.projects;
    return Object.values(entities.tasks)
      .filter((task) => isLive(task))
      .map((task) => ({
        id: task.id,
        title: task.title,
        // 🔴 `Task.dueDate` 是 epoch ms，而 `MentionTaskLike` 要的是 `YYYY-MM-DD`：
        // 消歧后缀要**给用户看**（"开会（08-15）"），不是给程序看的数字。
        ...(task.dueDate === undefined ? {} : { dueDate: toLocalDate(task.dueDate) }),
        ...(task.projectId === undefined
          ? {}
          : { projectTitle: projects[task.projectId]?.name ?? '' }),
      }));
  }, [entities]);

  const lookupMention = useMemo(() => mentionLookupFor(mentionTasks), [mentionTasks]);
  const mentionSegmentsOfDraft = useMemo(
    () => mentionSegments(draft, findMentions(draft)),
    [draft],
  );
  const active = mentionClosed ? undefined : activeMention(draft, caret);
  const mentionList =
    active === undefined ? [] : mentionCandidates(mentionTasks, active.query);

  function pickMention(candidate: MentionTaskCandidate): void {
    if (active === undefined) return;
    const next = applyMention(draft, active, candidate.label);
    if (next === undefined) return;
    setDraft(next.text);
    setCaret(next.caret);
    setMentionClosed(true);
    // 光标跟着插入位置走 —— 否则用户选中之后要继续打字，光标会跳回末尾。
    requestAnimationFrame(() => {
      const el = composerRef.current;
      if (el === null) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  }
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
          fields: assistantEgressFields({ memory: memoryActive }),
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
    if (!ephemeral.isCurrent() || currentAccount() !== session.account) return;
    if (items.length === 0) {
      clearAssistantHistory(session.storage);
      return;
    }
    saveAssistantHistory(
      { items, disclosed, account: session.account },
      session.storage,
    );
  }, [items, disclosed, session.storage, session.account]);

  /** 追加一条并返回它（`id` 由 ref 递增，不用数组长度 —— 长度会在同批两次追加时撞号）。 */
  function append(item: WithoutId<ChatItem>): void {
    const id = ++controls.nextId;
    setItems((previous) => [...previous, { ...item, id } as ChatItem]);
  }

  async function turn(text: string, epoch = controls.epoch): Promise<void> {
    if (!ephemeral.isCurrent() || epoch !== controls.epoch) return;
    /** 本轮真进了 prompt 的记忆；宿主在拼 system 时回调。 */
    const usedMemory: { id: string; kind: string; text: string }[] = [];
    setPhase('running');
    if (props.useCloudHarness === true) {
      setHarnessPreparing(false);
      ephemeral.write(session.account, { live: EMPTY_LIVE });
      try {
        const res = await runWebCloudTurn(text, {
          routing: props.routing,
          consents: props.consents,
          grants: assistantGrants(),
          onToolCall: () => { if (ephemeral.isCurrent() && epoch === controls.epoch) setHarnessPreparing(true); },
          onTextDelta: (delta) => {
            if (!ephemeral.isCurrent() || epoch !== controls.epoch) return;
            ephemeral.write(session.account, {
              live: reduceAssistantLive(ephemeral.value.live, { type: 'text', delta }),
            });
          },
          memory: { enabled: props.memoryEnabled === true, items: memoryItems },
          onMemoryUsed: (items) => {
            usedMemory.splice(
              0,
              usedMemory.length,
              ...items.map((m) => ({ id: m.id, kind: m.kind, text: m.text })),
            );
          },
        });
        if (!ephemeral.isCurrent() || epoch !== controls.epoch || currentAccount() !== session.account) return;
        setPhase('idle');
        setHarnessPreparing(false);
        ephemeral.write(session.account, { live: undefined });
        if (res.error !== undefined) {
          setHarnessUndo(res.undo ?? null);
          append({ role: 'assistant', text: `出错：${res.error}`, steps: [], stoppedAt: undefined });
          return;
        }
        const wrote = hasAppliedWrite(res.turn.steps);
        setHarnessUndo(wrote ? (res.undo ?? null) : null);
        if (usedMemory.length > 0) append({ role: 'memory', items: [...usedMemory] });
        append({ role: 'assistant', text: wrote ? `${res.turn.text}\n\n${t('web.ai.chat.harnessApplied')}` : res.turn.text, steps: [], stoppedAt: undefined });
      } catch (error: unknown) {
        if (!ephemeral.isCurrent() || epoch !== controls.epoch) return;
        setPhase('idle');
        setHarnessPreparing(false);
        ephemeral.write(session.account, { live: undefined });
        append({ role: 'assistant', text: `出错：${error instanceof Error ? error.message : '云端 Agent 失败。'}`, steps: [], stoppedAt: undefined });
      }
      return;
    }
    // 🔴 这一行是**流式的开关**：`onEvent` 给了，app-host 才会在请求里带 `stream`
    // 并逐片回调。省略它 = 回到"整段回来再显示"（移动端就是这样）。
    ephemeral.write(session.account, { live: EMPTY_LIVE });
    // 本轮的中断句柄：面板「停止」按钮 abort 它；循环在步骤边界消费（见 app-host 注释）。
    const controller = new AbortController();
    abortRef.current = controller;
    const outcome = await requestAssistantTurn(
      {
        text,
        // ⚠️ 图只在**第一步**发（循环里每步都会重建 messages，见 app-host 的注释）。
        ...(images.length === 0
          ? {}
          : { images: images.map((image) => ({ mediaType: image.mediaType, base64: image.base64 })) }),
      },
      {
        routing: props.routing,
        consents: props.consents,
        host,
        getGrants: () =>
          ephemeral.isCurrent() && epoch === controls.epoch && currentAccount() === session.account
            ? assistantGrants()
            : {},
        localize: (key, vars) => t(key as MessageKey, vars),
        executionId: `web:${session.account}:${String(controls.nextId)}`,
        history,
        // 记忆：开关与条目都由壳给，宿主只负责渲染成 prompt 与算披露。
        memory: { enabled: props.memoryEnabled === true, items: memoryItems },
        onMemoryUsed: (items) => {
          usedMemory.splice(
            0,
            usedMemory.length,
            ...items.map((m) => ({ id: m.id, kind: m.kind, text: m.text })),
          );
        },
        // ⚠️ 事件与结果走**同一道闸门**：跨过「新会话」或换了账号之后到的片段
        // 一个都不许画出来（它属于上一段对话，而界面上已经是另一段）。
        onEvent: (event) => {
          if (!ephemeral.isCurrent() || epoch !== controls.epoch || currentAccount() !== session.account) return;
          ephemeral.write(session.account, (previous) => ({
            live: reduceAssistantLive(previous.live, event),
          }));
        },
        signal: controller.signal,
        routed: {
          secretStore: props.secrets,
          managedTransport: webManagedTransport,
          ...(props.fetchImpl === undefined ? {} : { fetchImpl: props.fetchImpl }),
        },
      },
    );
    abortRef.current = null;
    // 请求可能跨过了「新会话」才回包；它不能结束新会话的运行态，
    // 也不能把旧回答追加到新会话。
    if (!ephemeral.isCurrent() || epoch !== controls.epoch || currentAccount() !== session.account) return;
    // 🔴 熔断状态回写：失败那一次通常正是计数器刚 +1 的时候。
    if (outcome.health !== undefined && props.onHealth !== undefined) props.onHealth(outcome.health);
    setPhase('idle');
    // 这一轮的过程行收进 `items` 里的最终形状（assistant 的 `steps`）之后，
    // 进行中那一份就必须消失 —— 两份同时留着会让同一行在屏幕上出现两次。
    ephemeral.write(session.account, { live: undefined });

    if (!outcome.ok) {
      append({
        role: 'error',
        reason: outcome.reason,
        message: outcome.message,
        cause: outcome.cause,
        endpointUrl: outcome.endpointUrl,
        serverCode: outcome.serverCode,
        outsideFields: outcome.outsideFields,
      });
      return;
    }
    if (outcome.kind === 'proposal') {
      append({ role: 'proposal', text: outcome.text, proposal: outcome.proposal, confirmed: undefined });
      return;
    }
    if (outcome.kind === 'cancelled') {
      // 用户按了「停止」：明确告诉他停在这里，已经发生的步骤照常保留（不谎报"没跑过"）。
      append({ role: 'assistant', text: t('web.ai.chat.stoppedByUser'), steps: outcome.steps, stoppedAt: undefined });
      return;
    }
    if (usedMemory.length > 0) {
      append({ role: 'memory', items: [...usedMemory] });
    }
    append({
      role: 'assistant',
      text: outcome.text,
      steps: outcome.steps,
      stoppedAt: outcome.kind === 'stopped' ? outcome.limit : undefined,
      ...('cards' in outcome && outcome.cards !== undefined ? { cards: outcome.cards } : {}),
    });
  }

  function send(): void {
    // 发送按钮的 disabled 只覆盖真实点击；Enter 和同一轮的重复事件也必须
    // 经过同一阶段闸门。披露阶段同样不能再追加第二条待发送消息。
    if (controls.phase !== 'idle') return;
    const text = draft.trim();
    // 🔴 只有图、没有字是**合法的一次提问**（"这张截图是什么"）。
    // 原来这里 `if (text === '') return;` 会把那条路整条掐掉。
    if (text === '' && images.length === 0) return;
    append({ role: 'user', text });
    // 明说捕获：解析与落库都在领域/宿主层，这里只触发一次。
    // 不阻塞本轮 —— 记忆写失败不该让一句正常的提问发不出去。
    void useTaskStore
      .getState()
      .captureMemories(text, props.autoExtractMemories === true)
      .catch(() => undefined);
    setDraft('');
    // 图只属于这一条消息：发出去之后输入框回到"没附件"的状态，
    // 否则下一句会**悄悄**再带一次同一张图。
    setImages([]);
    // 🔴 先按规则试一次（本机、纯函数、零出境）：命中就说明这一句根本不会出境，
    // 那就**不该弹出境披露** —— 单步面板 `AiToolRun` 一直是这个顺序。
    // 判定住在 `@heyta/app-host`（和循环里那一次是同一个函数），壳不另写规则。
    if (!assistantNeedsEgressDisclosure(text)) {
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
    if (controls.phase !== 'disclose') return;
    const text = pending ?? '';
    setDisclosed(true);
    setPending(undefined);
    if (text !== '') {
      void turn(text, controls.epoch);
    } else {
      setPhase('idle');
    }
  }

  async function confirm(item: ChatItem & { role: 'proposal' }): Promise<void> {
    if (controls.confirming) return;
    controls.confirming = true;
    const epoch = controls.epoch;
    try {
      const result = await confirmAiToolProposal(host, item.proposal, {
        getGrants: () =>
          ephemeral.isCurrent() && epoch === controls.epoch && currentAccount() === session.account
            ? assistantGrants() : {},
      });
      if (!ephemeral.isCurrent() || epoch !== controls.epoch || currentAccount() !== session.account) return;
      if (result.ok) {
        setItems((previous) => previous.map((x) => (x === item ? { ...x, confirmed: result } : x)));
        const next = { ...confirmationErrors };
        delete next[item.id];
        setConfirmationErrors(next);
      } else {
        setConfirmationErrors({ ...confirmationErrors, [item.id]: result.message });
      }
    } finally {
      controls.confirming = false;
    }
  }

  function newSession(): void {
    // `requestAssistantTurn` 没有贯穿整个 app-host 管道的取消协议；运行中切走
    // 只会隐藏旧结果，不能阻止低风险写入落库。因此必须等这一轮结束后再开新会话。
    if (controls.phase === 'running') return;
    controls.epoch += 1;
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
    /*
      🔴 `data-heyta-chat-root` 是**粘贴归属判据**（见 `ImageAttach` 的 `pasteScope`）：
      文档级 paste 监听靠它区分"在对话输入框里粘贴"与"在搜索框里粘贴"。
      没有它，贴图会在别处把用户的图片吃掉。
    */
    <div className="ht-ai__attach-stack" data-heyta-chat-root="">
      {attach.thumbs}
      <MentionChips segments={mentionSegmentsOfDraft} resolve={lookupMention} />
      <MentionPicker
        candidates={mentionList}
        activeIndex={mentionIndex}
        onPick={pickMention}
        onHover={setMentionIndex}
      />
      <div className="ht-ai__composer">
      {/* 附件图标住在输入框**内部左下角**（框是唯一的框，图标只是它里面的一枚）。 */}
      <span className="ht-ai__composer-action">{attach.picker}</span>
      <textarea
        ref={composerRef}
        className="ht-input ht-ai__input"
        aria-label={t('web.ai.chat.inputAria')}
        placeholder={t('web.ai.chat.placeholder')}
        value={draft}
        rows={1}
        data-testid="ai-assistant-input"
        onChange={(e) => {
          setDraft(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setMentionClosed(false);
          setMentionIndex(0);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={(e) => {
          /**
           * 🔴 候选打开时，方向键 / Enter / Esc 属于**候选**，不属于输入框。
           * 这一层不与 `MentionPicker` 分工：键盘判断只能有一处，
           * 拆到两个组件的直接后果是"按 Enter 既选中候选又发送了消息"。
           */
          if (mentionList.length > 0) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setMentionIndex((index) => (index + 1) % mentionList.length);
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setMentionIndex((index) => (index - 1 + mentionList.length) % mentionList.length);
              return;
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              const candidate = mentionList[mentionIndex];
              if (candidate !== undefined) pickMention(candidate);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setMentionClosed(true);
              return;
            }
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      {phase !== 'running' && (
        <Button
          tone="primary"
          className="ht-ai__send-button"
          aria-label={t('web.ai.chat.send')}
          data-testid="ai-assistant-send-button"
          onClick={send}
          disabled={draft.trim() === '' && images.length === 0}
        >
          <Send size={ICON_SIZE.xs} aria-hidden="true" />
          <span className="sr-only">{t('web.ai.chat.send')}</span>
        </Button>
      )}
      {phase === 'running' && (
        <Button
          tone="secondary"
          className="ht-ai__send-button"
          aria-label={t('web.ai.chat.stop')}
          data-testid="ai-assistant-stop"
          onClick={() => abortRef.current?.abort()}
        >
          {t('web.ai.chat.stop')}
        </Button>
      )}
      </div>
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
            <Button
              tone="ghost"
              className="ht-ai__history-new"
              data-testid="ai-assistant-new-session"
              onClick={newSession}
              disabled={phase === 'running'}
            >
              {t('web.ai.chat.newSession')}
            </Button>
            <Button
              ref={historyCloseRef}
              tone="ghost"
              className="ht-ai__history-close"
              aria-label={t('web.ai.chat.history.close')}
              data-testid="ai-assistant-history-close"
              onClick={closeHistory}
            >
              <X size={ICON_SIZE.xs} aria-hidden="true" />
            </Button>
          </div>
          <div className="ht-ai__history-group">
            <span className="ht-ai__history-group-label ht-type-caption">{t('web.ai.chat.history.today')}</span>
            {items.length > 0 ? (
              <button type="button" className="ht-ai__history-item ht-ai__history-item--active" aria-current="page" onClick={closeHistory}>
                <span>{sessionLabel}</span>
              </button>
            ) : (
              /*
                收编进**那一个**空态实现（`check-empty-state` 的断言 C / 判据 3）。
                🔴 用 `line` 档而不是 `section`：这一行住在 `caption` 的分组标签
                下面，而 `section` 的标题是 `row-title` + `foreground` —— 占位行
                比分组标签还重就是层级倒置。原来那行手写的 `<p>` 正是这种"每个
                视图各自回答一次 hint 要不要画"的形状（`EmptyState.tsx` 文件头
                记的就是这一类事故）。
              */
              <HeytaUiProvider>
                <EmptyState size="line" title={t('web.ai.chat.history.empty')} />
              </HeytaUiProvider>
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
              <Button
                tone="ghost"
                className="ht-ai__history-toggle"
                aria-expanded={historyOpen}
                aria-controls="ai-assistant-history"
                data-testid="ai-assistant-history-toggle"
                ref={historyToggleRef}
                onClick={() => setHistoryOpen((open) => !open)}
              >
                {historyOpen ? t('web.ai.chat.history.close') : t('web.ai.chat.history.open')}
              </Button>
              {props.onToggleExpanded !== undefined && (
                <Button
                  tone="ghost"
                  className="ht-ai__expand"
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
                </Button>
              )}
              {props.onClose !== undefined && (
                <Button
                  tone="ghost"
                  aria-label={t('web.ai.action.close')}
                  data-testid="ai-assistant-close"
                  onClick={props.onClose}
                >
                  <X size={ICON_SIZE.xs} aria-hidden="true" />
                </Button>
              )}
            </div>
          </header>
      <div className={`ht-ai__chat-body ${!hasConversation ? 'ht-ai__chat-body--welcome' : ''}`}>
      {!hasConversation && <div className="ht-ai__welcome" data-testid="ai-assistant-welcome">
        {/* 空态呼吁：一句行动号召 + 几枚建议芯片（点一下把整句填进输入框）。
            文案/样式都走既有 i18n 与 `.ht-ai__greeting`/`.ht-ai__suggestion`，不新增裸值。 */}
        <div className="ht-ai__greeting" data-testid="ai-assistant-greeting">
          <p className="ht-ai__greeting-title">{t('web.ai.chat.welcome.title')}</p>
        </div>
        <div className="ht-ai__suggestions" data-testid="ai-assistant-suggestions">
          {SUGGESTION_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className="ht-ai__suggestion"
              data-testid={`ai-assistant-suggestion-${key}`}
              onClick={() => {
                setDraft(t(`web.ai.chat.suggestion.${key}` as MessageKey));
                requestAnimationFrame(() => composerRef.current?.focus());
              }}
            >
              {t(`web.ai.chat.suggestion.${key}.label` as MessageKey)}
            </button>
          ))}
        </div>
        {composer}
      </div>}

      {hasConversation && <div ref={conversationRef} className="ht-ai__conversation" data-testid="ai-assistant-conversation">
        <ul
          className="ht-ai__items ht-ai__items--chat"
          data-testid="ai-assistant-transcript"
        >
          {items.map((item, index) => {
            // 同一轮对话里，助手正文紧跟着待确认提案卡时，只在末尾收口处挂一次法定标识，
            // 避免连续两块各自铺一条「AI 生成合成内容」把界面打碎。
            const suppressMiddleLabel = item.role === 'assistant' && items[index + 1]?.role === 'proposal';
            return (
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
                  {/*
                    🔴 过程在答案**上面**：先说"我做了什么"，再说"结论是什么"。
                    反过来（答案在上、过程在下）会让那几行读起来像脚注，
                    而它们恰恰是用户判断"这个结论可不可信"的依据。
                  */}
                  <ChatSteps steps={item.steps} t={t} locale={locale} />
                  <MarkdownMessage
                    text={item.text}
                    className="ht-ai__assistant-text"
                    testId="ai-chat-assistant-text"
                  />
                  {item.cards !== undefined && item.cards.length > 0 && (
                    <div className="ht-ai__cards" data-testid="ai-chat-cards">
                      {item.cards.map((card, cardIndex) => (
                        <div className="ht-ai__card" key={`${card.tool}-${String(cardIndex)}`}>
                          <p className="ht-ai__card-title">
                            {t('web.ai.card.resultCount', { n: card.count })}
                          </p>
                          <ul className="ht-ai__card-list">
                            {card.items.map((row, rowIndex) => (
                              <li
                                className="ht-ai__card-item"
                                key={`${card.tool}-${String(cardIndex)}-${String(rowIndex)}`}
                              >
                                <span className="ht-ai__card-primary">{row.primary}</span>
                                {row.meta !== undefined && (
                                  <span className="ht-ai__card-meta">{row.meta}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                  {!suppressMiddleLabel && (
                    <AiGeneratedLabel
                      label={t('common.ai.generatedLabel')}
                      testID={`ai-chat-generated-${String(item.id)}`}
                    />
                  )}
                  {item.stoppedAt !== undefined && (
                    <p className="ht-ai__note" data-testid="ai-chat-stopped">
                      {t('web.ai.chat.stoppedLead')}
                      {item.stoppedAt}
                    </p>
                  )}
                </>
              )}

              {item.role === 'memory' && (
                <details className="ht-ai__memory" data-testid="ai-chat-memory">
                  <summary>{t('web.ai.chat.memory', { n: item.items.length })}</summary>
                  <ul>
                    {item.items.map((m) => (
                      <li key={m.id}>{m.text}</li>
                    ))}
                  </ul>
                </details>
              )}

              {item.role === 'proposal' && (
                <>
                  <ProposalCard
                    item={item}
                    onConfirm={() => void confirm(item)}
                    confirmationError={confirmationErrors[item.id]}
                    tasksById={entities.tasks}
                  />
                  {/* 🔴 标识在提案卡**下方**：备案材料写的是"七类 AI 产出文本的下方"，
                      2026-10-21 自核时发现这一处原来在上面（材料没错，代码错了）。 */}
                  <AiGeneratedLabel
                    label={t('common.ai.generatedLabel')}
                    testID={`ai-chat-generated-${String(item.id)}`}
                  />
                </>
              )}

              {item.role === 'error' && (
                <ChatFailure
                  reason={item.reason}
                  message={item.message}
                  cause={item.cause}
                  endpointUrl={item.endpointUrl}
                  serverCode={item.serverCode}
                  outsideFields={item.outsideFields}
                  onOpenSettings={onOpenSettings}
                />
              )}
            </li>
            );
          })}
          {/*
            🔴 进行中的那一轮**是列表的最后一个 item**，不是"另一个区块"：
            它在屏幕上必须与最终那条回答占同一个位置，否则一轮结束时
            会先"跳走"再"出现"，而用户刚读完的正是被跳走的那段。
          */}
          {live !== undefined && (
            <li
              className="ht-ai__item ht-ai__item--assistant"
              data-testid="ai-chat-live"
              aria-live="polite"
            >
              {(live.reasoning !== '' || live.rows.length > 0) && (
                <LiveTraceGroup reasoning={live.reasoning} rows={live.rows} t={t} />
              )}
              {/*
                🔴 显示的是 `revealedText`（逐字揭示的进度），**判断**用的是
                `live.text`（已到达的内容）。两者分开是刻意的：

                  · 显示要慢 —— 那是动效；
                  · 判断要快 —— "该不该挂法定标识"不该等动画追上。

                ⚠️ 但标识本身必须等**至少有一个字画出来**才挂：一个只有
                "AI 生成合成内容"悬浮在空气泡里的瞬间，比晚 30ms 挂上更难看。
                所以条件是 `revealedText !== ''`，而不是 `live.text !== ''`。
                代价说清楚：从流开始到第一个字画出（最长 ~5ms，
                见 `REVEAL_DEFAULTS.maxCharIntervalMs`）这一瞬，屏上是空的 ——
                那与"还没开始回话"在视觉上无从区分，也正是 `ai-assistant-waiting`
                那一行还在的原因（它的条件用的是 `live.text`）。
              */}
              {revealedText !== '' && (
                <>
                  <MarkdownMessage text={revealedText} testId="ai-chat-live-text" />
                  {/*
                    🔴 光标只在**流还没结束**时出现。
                    结束了还留着会让用户以为还在生成 —— 那比没有光标更糟。

                    ⚠️ 判据用 `live.text`（已到达的内容与目标是否相等）而不是
                    `revealedText`：揭示才追平的那一瞬内容其实早到了，
                    此时该收的是"还在生成"这个**事实**，不是"动画演完了"。
                    两者在正常速度下只差几十毫秒，但语义必须选对。

                    字号传 `font-size.sm`（14）—— 与 `.ht-ai__panel` 的
                    `font-size: var(--ht-font-size-sm)` 同档，
                    两边必须一致，否则光标会比它旁边的字高或矮。
                  */}
                  {live !== undefined && revealedText !== live.text && (
                    <StreamCaret
                      testID="ai-chat-caret"
                      fontSize={tokens['font-size.sm']}
                    />
                  )}
                  {/*
                    🔴 法定标识在**流式的每一刻**都要在：这段字是模型生成的，
                    而"它生成完了没有"不是用户能判断的事。只在收尾才挂上，
                    等于在最先被看到的那几秒里让一段合成文本长得像用户自己写的。
                  */}
                  <AiGeneratedLabel
                    label={t('common.ai.generatedLabel')}
                    testID="ai-chat-generated-live"
                  />
                </>
              )}
            </li>
          )}
        </ul>


      {harnessUndo !== null && phase === 'idle' ? (
        <button
          type="button"
          className="ht-ai__note"
          data-testid="ai-assistant-undo-ai"
          onClick={() => {
            void (async () => {
              const undo = harnessUndo;
              try {
                const outcome = (await undo()) as { status?: string };
                // 只有真正 applied 才报“已撤销”；stale/partial/empty 如实说明，绝不谎报。
                const ok = outcome?.status === 'applied';
                setHarnessUndo(ok ? null : harnessUndo);
                append({ role: 'assistant', text: ok ? t('web.ai.chat.undoAiTurnDone') : t('web.ai.chat.undoAiTurn') + '：' + (outcome?.status ?? 'failed'), steps: [], stoppedAt: undefined });
              } catch (error: unknown) {
                append({ role: 'assistant', text: `出错：${error instanceof Error ? error.message : '撤销失败'}`, steps: [], stoppedAt: undefined });
              }
            })();
          }}
        >
          {t('web.ai.chat.undoAiTurn')}
        </button>
      ) : null}

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
                <Button
                  tone="secondary"
                  data-testid="ai-assistant-send"
                  onClick={confirmDisclosure}
                >
                  {t('web.ai.action.send')}
                </Button>
              </div>
            </>
          )}
        </AiPanelHost>
      )}

      {/* ⚠️ 这个 testid 是给判据用的，不是装饰：`ai-assistant-remount.spec.tsx`
          要靠它区分"请求还在飞"与"阶段被重挂载归零"—— 发送键在两种情况下都是禁用的
          （草稿已被清空），所以拿它当判据会一条都测不出来。 */}
      {phase === 'running' && (live === undefined || live.text === '') && (
        <p className="ht-ai__note" data-testid="ai-assistant-waiting">
          {harnessPreparing ? t('web.ai.chat.preparingTool') : t('web.ai.loading.waiting')}
          {/*
            🔴 三个点是**装饰**，所以整块标 `aria-hidden`。

            理由："有没有在动"对看得见的用户是"它还活着吗"的唯一线索
            （一行静止文字与一行卡死文字在屏上完全一样），但读屏用户拿不到
            这个线索、也不需要它 —— 对他们来说那几个点是三个没有名字的空元素，
            念出来只会是噪音。文案本身（"正在等待…"）才是给读屏的信息。

            ⚠️ 因此 `.ht-ai__typing` 的 `<i>` **不承载任何语义**：
            没有内容、没有 testid、不参与断言。判据挂在文案那一行
            （`ai-assistant-waiting`，已有测试在用）。
          */}
          {!harnessPreparing && (
            <span className="ht-ai__typing" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          )}
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

/** 一步（跑完的或正在跑的）在界面上那一行的形状。 */
function toTraceRow(step: AssistantStep): LiveRow {
  return {
    tool: step.tool,
    kind: step.kind,
    ok: step.ok,
    ...(step.note === undefined ? {} : { note: step.note }),
  };
}

/**
 * 一行过程。**动词由状态决定，而不是由工具名决定** ——
 * 这样界面永远说得出"这一步现在是什么状态"，而不是等它结束才知道。
 */
function traceVerb(row: LiveRow, t: I18nValue['t']): string {
  if (row.ok === undefined) {
    return t(row.kind === 'write' ? 'web.ai.chat.step.preparing' : 'web.ai.chat.step.reading');
  }
  if (!row.ok) {
    return t(row.kind === 'write' ? 'web.ai.chat.step.writeFailed' : 'web.ai.chat.step.readFailed');
  }
  return t(row.kind === 'write' ? 'web.ai.chat.step.written' : 'web.ai.chat.step.read');
}

/**
 * 「一行 + 一个可展开的正文」的**开合行为**（`ReasoningRow` 与 `TraceRows` 共用）。
 *
 * ── 为什么抽出来，而不是第二份手抄（2026-11-10）
 *
 * 本仓有**实测事故**记在案：`packages/ui/src/ai/model.ts` 的文件头写着
 * 「同一个组件被抄 5 份，其中第 5 份漂移了 —— 漏了回退链与 E2EE 警告，
 * **而没有任何测试会红**」。这里的开合行为恰好是那种"抄第二份时最容易漏一条"的东西：
 * 它由**四个**必须同时在位的细节组成（`open` 常驻、`preventDefault`、
 * `aria-expanded`、键盘的 Enter/Space），漏掉任何一个都不会有测试变红，
 * 而症状是"点了没反应"或"读屏读不出展开状态"。
 *
 * 🔴 但**只共享行为，不共享 class**：两处的语义与归属不同（思考行是**一个**展开器，
 * 步骤行是**列表里的一行**、且存在"没有 note 就完全不套 `<details>`"的第三态）。
 * 套同一套 class 会让改一处的视觉必然波及另一处 —— 所以 class 由调用方传进来。
 *
 * ── 键盘：`Enter` 与 `Space` **不一样**（逐帧实测，与 `d4160864` 的说法不同）
 *
 * Chromium 156 实测，`<summary>` 上的真实按键事件序列（已核对 `document.activeElement`
 * 与事件 `target`，排除"焦点没进去"的假阴性）：
 *
 * | 按键 | 实测事件序列 |
 * |---|---|
 * | `Enter` | `keydown:Enter@summary → keyup:Enter` —— 🔴 **没有 click** |
 * | `Space` | `keydown:Space@summary → keyup:Space → click@summary` |
 *
 * ⇒ `d4160864` 注释里"Enter 与 Space 都会合成一次 click"对 **Space 成立、对 Enter 不成立**。
 * 只挂 `onClick` 会让**键盘 Enter 完全失去开合能力**（鼠标、触摸、读屏、Space 都还在，
 * 所以这个缺口很不容易被手工发现）。因此这里**显式补 `Enter` 的 `keydown` 分支**。
 *
 * ⚠️ `Space` 只走 `click` 那一支（不额外处理 `keydown`）：否则一次 Space 会开合两次、
 * 视觉上等于没动 —— 这是"补键盘"时最容易引入的回归。
 */
function useRowCollapse(initialCollapsed = true): {
  /** true = 视觉收起。 */
  collapsed: boolean;
  /** 切换折叠状态。 */
  toggle: () => void;
  /** 挂到 `summary` 的 `onClick`。 */
  onSummaryClick: (event: React.MouseEvent<HTMLElement>) => void;
  /** 挂到 `summary` 的 `onKeyDown`（只补 Enter，见上面那张实测表）。 */
  onSummaryKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
} {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggle = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);
  return {
    collapsed,
    toggle,
    onSummaryClick: (event) => {
      // 拦掉原生开合（它会**同步**把子树移出渲染，收起就没有可插值的端点）。
      event.preventDefault();
      toggle();
    },
    onSummaryKeyDown: (event) => {
      // 🔴 只处理 Enter：Space 已经由浏览器合成 `click` 走上去了。
      if (event.key !== 'Enter') return;
      event.preventDefault();
      toggle();
    },
  };
}

/**
 * 过程开关里的一段：一行一步，**默认收起**。
 *
 * 🔴 收起的理由不是"省地方"，是**默认视图要说的是"我在做什么"，不是"我读了什么"**：
 * 展开的内容是工具层给的原文（可能很长、可能是英文），它属于"要看的时候再看"。
 *
 * ⚠️ 没有 `note` 的行**不套 `<details>`**：一个点了什么都看不到的展开器
 * 比没有更糟（用户会以为界面坏了）。
 *
 * ── 高度动画（2026-11-10，与 `ReasoningRow` 同一套做法）
 *
 * `grid-template-rows: 0fr → 1fr`，由布局引擎每帧算真实高度 ⇒
 * 不写死 `max-height`、不需要 JS 测高。逐帧实测见 `ai-panels.css`
 * `.ht-ai__trace-collapse` 上面那段。
 *
 * 🔴 这里额外多一个理由：**流式期间 `note` 是整行被替换的**。
 * `reduceAssistantLive` 的 `tool-finished` 换掉同名那一行的对象，而下标不变 ⇒
 * React 按 `key={tool#index}` 复用同一个 DOM 节点。若用 JS 测高（`scrollHeight`
 * 注入 `max-height`），一次替换就落进"量完到下一帧之间内容变了"的窗口。
 * 实测「已展开的行 + note 整段替换」：高度 `17px → 238px`、
 * `scrollHeight === clientHeight`（不裁字）、class 不变（不自己弹回）。
 *
 * ⚠️ 状态放在**每行自己的组件**里（不是 `TraceRows` 里的一份）：一份状态会让
 * 点任意一行时**所有行一起开合**。
 */
/** 过程时间线上的单个工具步骤节点。 */
function TraceRow(props: { row: LiveRow; t: I18nValue['t'] }): React.JSX.Element {
  const { row, t } = props;
  const label = `${traceVerb(row, t)} · ${row.tool}`;
  const { collapsed, toggle } = useRowCollapse();

  const icon =
    row.ok === false ? (
      <AlertTriangle size={ICON_SIZE.xs} className="ht-ai__node-icon ht-ai__node-icon--warn" />
    ) : (
      <Braces size={ICON_SIZE.xs} className="ht-ai__node-icon" />
    );

  return (
    <>
      <span className="ht-ai__node-rail" aria-hidden="true">
        {icon}
      </span>
      <div className="ht-ai__node-body">
        <p className="ht-ai__step-line" data-testid={`ai-chat-step-${row.tool}`}>
          {label}
        </p>
        {row.note !== undefined && (
          <>
            <div
              className={
                collapsed
                  ? 'ht-ai__trace-collapse'
                  : 'ht-ai__trace-collapse ht-ai__trace-collapse--open'
              }
            >
              <p className="ht-ai__note ht-ai__step-note">{row.note}</p>
            </div>
            <button
              type="button"
              className="ht-ai__more-pill"
              aria-expanded={!collapsed}
              onClick={toggle}
            >
              {t(collapsed ? 'web.ai.chat.viewMore' : 'web.ai.chat.collapseDetail')}
            </button>
          </>
        )}
      </div>
    </>
  );
}

function TraceRows(props: {
  rows: readonly LiveRow[];
  t: I18nValue['t'];
  live?: boolean;
}): React.JSX.Element | null {
  const { t } = props;
  if (props.rows.length === 0) return null;
  return (
    <ul
      className="ht-ai__steps"
      data-testid={props.live === true ? 'ai-chat-live-steps' : 'ai-chat-steps'}
    >
      {props.rows.map((row, index) => (
        <li key={`${row.tool}#${String(index)}`} className="ht-ai__step ht-ai__timeline-node">
          <TraceRow row={row} t={t} />
        </li>
      ))}
    </ul>
  );
}

/**
 * 思考那一行：**与答案分开**，而且默认只露第一行。
 *
 * 模型想什么不是答案：把它和正文混在一起，用户会把推测当成结论读。
 * 展开能看全，收起时那半句足够判断"它有没有在瞎想"。
 *
 * ── 展开/收起的高度动画（2026-11-10）
 *
 * 🔴 高度由**布局引擎实测**，不写死 `max-height`。
 * 判据：`docs/research/ai-chat-motion-source-study.md` §3.3 —— antd/x 的
 * `initCollapseMotion` 用 `node.scrollHeight` 注入真实高度，全仓零处写死
 * `max-height`。两条路拿到的是同一件事（真实高度、无魔数），这里选 CSS 的那条：
 *
 *   · `0fr → 1fr` 每帧由布局引擎算 ⇒ 不需要 JS 测高、不需要 resize/ResizeObserver
 *     重测，也没有"量完到下一帧之间内容变了导致高度算错"的那个窗口
 *     （思考文本是**流式追加**的，那个窗口在这里是常态而不是边界情况）；
 *   · `grid-template-rows` 是 2017 年起的广泛可用特性，而 Vite 默认
 *     `build.target` 是 `chrome107/safari16`，恰好**够不到**原生那条路
 *     （`::details-content` + `interpolate-size` + `allow-discrete`：
 *     Chrome 131 / Safari 18.4，Baseline 2025）。
 *
 * 🔴 为什么必须自己接管开合（不能只靠 CSS 的 `[open]`）—— 全部逐帧实测
 *
 *   最直觉的写法 `details[open] > .c { grid-template-rows: 1fr }` 实测
 *   **只有展开会动、收起是瞬跳**（Chromium 143，纯 DOM 两臂对照）：
 *
 *     · 靠 `[open]` 触发：收起帧 `72 72 72 72 … 72`，终值仍是 72 ❌
 *     · 靠元素自己的 class 触发：收起帧 `72 68 64 60 … 0` ✅
 *
 *   原因：`[open]` 一摘掉，UA 样式就**同步**把整棵子树移出渲染
 *   （这正是原生方案要 `content-visibility … allow-discrete` 的原因，
 *   而它够不到我们的 `chrome107/safari16` 目标）。
 *   子树不参与布局 ⇒ 没有可插值的端点 ⇒ 过渡被整个跳过。
 *   补充实测：即使在 `toggle` 回调里**同步**加 class（那一刻量到子树还在、
 *   高度仍是 72），后续帧也照样纹丝不动 —— 说明 UA 在派发 `toggle` 前
 *   就已经把子树判出渲染了，来不及救。
 *
 *   ⇒ 所以 `<details>` 常驻 `open`，由我们自己接管开合。
 *
 * 🔴 接管点选在 `summary` 的 `click`，**不是** `toggle`：实测（Chromium 143）
 *   一次点击会派发**两发** `toggle`（`open:true` 然后 `open:false`），
 *   而且"收起态"与"浏览器内部的 open"永远对不上，靠 `toggle` 推断用户意图
 *   会出现"点一次之后每次都当成展开"的死结（试过 4 种闸门写法，全部卡住）。
 *
 *   `preventDefault()` 掉 `summary` 的 click 就干净了，而且**键盘不丢**：
 *   实测 `Enter` 与 `Space` 在 `summary` 上都会合成一次 `click`
 *   （事件序列 `keydown:Enter → click`、`keydown:" " → click`）⇒
 *   一个 `onClick` 同时覆盖鼠标、触摸、键盘与读屏激活。
 *
 * 🔴 代价与补偿（说清楚，不藏）：
 *   · 因为不再真的切换 `open`，读屏靠 `open` 判断的展开状态会失真 ⇒
 *     显式挂 `aria-expanded={!collapsed}` 把它补回来。
 *   · `summary` 在无障碍树里本来就是 button 角色（不是靠 `open` 才有语义），
 *     所以"这是一个可展开的控件"这一点没有丢。
 *   · 缺 JS 时：`open` 常驻 ⇒ 正文直接可见（最差退回"不折叠"，
 *     而不是"点不开"），比改动前更不容易坏。
 *
 * 结构上只加了一层 `.ht-ai__step-collapse` 包住正文：
 *   · 那层 wrapper 是纯布局容器（`<div>`，无 tabindex、无 role、无事件），
 *     不进无障碍树、不参与 tab 顺序；
 *   · 🔴 原来那个 `<p class="ht-ai__note">` 仍在这层里、仍是唯一的文本节点，
 *     所以 `data-testid="ai-chat-reasoning"` 的文本内容断言一字不变。
 */
/** 思考过程节点：与工具步骤共用一条竖线时间线，长文本默认裁 3 行渐隐并附带「查看更多」。 */
function ReasoningRow(props: { text: string; t: I18nValue['t'] }): React.JSX.Element {
  const { collapsed, toggle } = useRowCollapse();
  const showToggle = props.text.includes('\n') || props.text.length > 96;
  return (
    <div
      className="ht-ai__timeline-node ht-ai__timeline-node--reasoning"
      data-testid="ai-chat-reasoning"
    >
      <span className="ht-ai__node-rail" aria-hidden="true">
        <Clock size={ICON_SIZE.xs} className="ht-ai__node-icon" />
      </span>
      <div className="ht-ai__node-body">
        <p
          className={
            showToggle && collapsed
              ? 'ht-ai__reasoning-text ht-ai__reasoning-text--clamped'
              : 'ht-ai__reasoning-text'
          }
        >
          {props.text}
        </p>
        {showToggle && (
          <button
            type="button"
            className="ht-ai__more-pill"
            aria-expanded={!collapsed}
            onClick={toggle}
          >
            {props.t(collapsed ? 'web.ai.chat.viewMore' : 'web.ai.chat.collapseDetail')}
          </button>
        )}
      </div>
    </div>
  );
}

/** 流式过程组：默认展开 `调用工具中 ⌄`，实时展示思考与工具调用竖线时间线。 */
function LiveTraceGroup(props: {
  reasoning: string;
  rows: readonly LiveRow[];
  t: I18nValue['t'];
}): React.JSX.Element {
  const { reasoning, rows, t } = props;
  const { collapsed, onSummaryClick, onSummaryKeyDown } = useRowCollapse(false);
  return (
    <details className="ht-ai__trace-group" open>
      <summary
        className="ht-ai__trace-trigger"
        data-testid="ai-chat-live-trace"
        aria-expanded={!collapsed}
        onClick={onSummaryClick}
        onKeyDown={onSummaryKeyDown}
      >
        <span>
          {rows.length > 0 ? t('web.ai.chat.callingTools') : t('web.ai.chat.thinking')}
        </span>
        <ChevronDown
          size={ICON_SIZE.xs}
          className={
            collapsed ? 'ht-ai__trace-chevron' : 'ht-ai__trace-chevron ht-ai__trace-chevron--open'
          }
          aria-hidden="true"
        />
      </summary>
      <div
        className={
          collapsed ? 'ht-ai__trace-collapse' : 'ht-ai__trace-collapse ht-ai__trace-collapse--open'
        }
      >
        <div className="ht-ai__trace-details">
          <div className="ht-ai__timeline">
            {reasoning !== '' && <ReasoningRow text={reasoning} t={t} />}
            <TraceRows rows={rows} t={t} live />
          </div>
        </div>
      </div>
    </details>
  );
}

/**
 * 完成后收敛的过程折叠区：无边框轻文字触发器（`用了 N 步工具 ⌄`），展开呈竖线时间线。
 */
function ChatSteps(props: {
  steps: readonly AssistantStep[];
  t: I18nValue['t'];
  locale: I18nValue['locale'];
}): React.JSX.Element | null {
  const { t, locale } = props;
  const { collapsed, onSummaryClick, onSummaryKeyDown } = useRowCollapse();

  // 🔴 没有步骤就**什么都不画**：一行「没有调用工具」既是假组件，
  // 又把"这轮没做事"伪装成一条过程信息。判据是 `steps.length === 0`。
  if (props.steps.length === 0) return null;

  const failed = props.steps.filter((s) => !s.ok).length;
  return (
    <details className="ht-ai__trace-group" open>
      <summary
        className={
          failed > 0
            ? 'ht-ai__trace-trigger ht-ai__trace-trigger--warn'
            : 'ht-ai__trace-trigger'
        }
        data-testid="ai-chat-trace"
        aria-expanded={!collapsed}
        onClick={onSummaryClick}
        onKeyDown={onSummaryKeyDown}
      >
        {failed > 0 && (
          <AlertTriangle
            size={ICON_SIZE.xs}
            className="ht-ai__trace-trigger-icon"
            aria-hidden="true"
          />
        )}
        <span>
          {t('web.ai.chat.trace', { n: props.steps.length })}
          {failed > 0 ? ` · ${props.steps.map((s) => s.tool).join(LIST_SEPARATOR[locale])}` : ''}
        </span>
        <ChevronDown
          size={ICON_SIZE.xs}
          className={
            collapsed ? 'ht-ai__trace-chevron' : 'ht-ai__trace-chevron ht-ai__trace-chevron--open'
          }
          aria-hidden="true"
        />
      </summary>
      <div
        className={
          collapsed ? 'ht-ai__trace-collapse' : 'ht-ai__trace-collapse ht-ai__trace-collapse--open'
        }
      >
        <div className="ht-ai__trace-details">
          <div className="ht-ai__timeline">
            <TraceRows rows={props.steps.map(toTraceRow)} t={t} />
          </div>
        </div>
      </div>
    </details>
  );
}

type ProposalTaskTone = 'high' | 'medium' | 'low' | 'complete' | 'neutral';

interface ProposalAffectedTask {
  readonly title: string;
  readonly badge?: string;
  readonly tone: ProposalTaskTone;
}

/** 提案卡：人说"要改什么"，结构化展示受影响任务，然后**只有**确认按钮能落库。 */
function ProposalCard(props: {
  item: ChatItem & { role: 'proposal' };
  onConfirm: () => void;
  confirmationError?: string;
  /** 任务 id → 标题。用于把提案里引用的 taskId 还原成用户看得懂的任务名。 */
  tasksById: Readonly<Record<string, { readonly title: string }>>;
}): React.JSX.Element {
  const { t, locale } = useI18n();
  const { item } = props;

  const affectedTasks = useMemo<readonly ProposalAffectedTask[]>(() => {
    const intent = item.proposal.intent;
    const titleOf = (id: string): string => props.tasksById[id]?.title ?? id;
    const priorityKeys: Readonly<Record<string, MessageKey | undefined>> = {
      none: 'web.ai.prioritize.priority.none',
      low: 'web.ai.prioritize.priority.low',
      medium: 'web.ai.prioritize.priority.medium',
      high: 'web.ai.prioritize.priority.high',
    };
    const priorityTone = (raw: string): ProposalTaskTone => {
      const k = raw.trim().toLowerCase();
      if (k === 'high' || k === 'medium' || k === 'low') return k;
      return 'neutral';
    };

    switch (intent.action) {
      case 'create-task':
        return [{ title: intent.title, badge: t('web.ai.chat.proposal.badge.create'), tone: 'neutral' }];
      case 'set-task-estimate':
        return [{ title: titleOf(intent.taskId), badge: t('web.ai.duration.minutes', { minutes: intent.minutes }), tone: 'neutral' }];
      case 'complete-task':
        return [{ title: titleOf(intent.taskId), badge: t('web.ai.chat.proposal.badge.complete'), tone: 'complete' }];
      case 'complete-tasks':
        return intent.taskIds.map((id) => ({
          title: titleOf(id),
          badge: t('web.ai.chat.proposal.badge.complete'),
          tone: 'complete',
        }));
      case 'set-task-priorities':
        return intent.entries.map((entry) => {
          const key = priorityKeys[entry.priority.trim().toLowerCase()];
          return {
            title: titleOf(entry.taskId),
            badge: key === undefined ? entry.priority : t(key),
            tone: priorityTone(entry.priority),
          };
        });
      default:
        return [];
    }
  }, [item.proposal.intent, props.tasksById, t]);

  const proposalTitle = useMemo<string>(() => {
    const intent = item.proposal.intent;
    const titleOf = (id: string): string => props.tasksById[id]?.title ?? id;
    switch (intent.action) {
      case 'set-task-priorities':
        return t('web.ai.chat.proposal.setPriorities', { count: intent.entries.length });
      case 'complete-task':
        return t('web.ai.chat.proposal.completeTasks', { count: 1 });
      case 'complete-tasks':
        return t('web.ai.chat.proposal.completeTasks', { count: intent.taskIds.length });
      case 'create-task':
        return t('web.ai.chat.proposal.createTask');
      case 'update-task':
      case 'set-task-tags':
      case 'set-task-estimate':
      case 'append-task-checklist':
        return intentText({ ...intent, taskId: titleOf(intent.taskId) }, t, locale);
      default:
        return intentText(intent, t, locale);
    }
  }, [item.proposal.intent, locale, props.tasksById, t]);

  const cardClass =
    item.expired === true
      ? 'ht-ai__proposal ht-ai__proposal--expired'
      : item.confirmed !== undefined
        ? 'ht-ai__proposal ht-ai__proposal--settled'
        : 'ht-ai__proposal';

  return (
    <div className={cardClass} data-testid="ai-chat-proposal">
      {item.expired !== true && item.confirmed === undefined && item.text !== '' && <p className="ht-ai__note">{item.text}</p>}
      <p className="ht-ai__row ht-ai__proposal-lead">
        <strong className="ht-ai__proposal-title">{proposalTitle}</strong>
      </p>
      {affectedTasks.length > 0 && (
        <ul className="ht-ai__proposal-tasks" data-testid="ai-chat-proposal-tasks">
          {affectedTasks.map((task, index) => (
            <li
              key={`${task.title}-${String(index)}`}
              className={`ht-ai__proposal-task ht-ai__proposal-task--${task.tone}`}
            >
              <span className="ht-ai__proposal-task-title">{task.title}</span>
              {task.badge !== undefined && (
                <span className={`ht-type-caption ht-ai__proposal-badge ht-ai__proposal-badge--${task.tone}`}>
                  {task.badge}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {item.expired === true ? (
        // 🔴 恢复出来的未确认提案：卡片留着（对话断在这儿要看得懂为什么），
        // 但**没有确认按钮** —— 一次隔着页面重载的确认，用户已经看不见它的依据了。
        <p className="ht-ai__proposal-expired" data-testid="ai-chat-expired">
          {t('web.ai.chat.expiredProposal')}
        </p>
      ) : item.confirmed === undefined ? (
        <>
        {props.confirmationError !== undefined && (
          <p className="ht-ai__done" data-testid="ai-chat-confirmation-error">
            {props.confirmationError}
          </p>
        )}
        <div className="ht-ai__actions ht-ai__proposal-actions">
          <Button
            tone="primary"
            aria-label={t('web.ai.tools.confirmAria')}
            data-testid="ai-chat-confirm"
            onClick={props.onConfirm}
          >
            {t('web.ai.tools.confirm')}
          </Button>
        </div>
        </>
      ) : (
        <p className="ht-ai__done" data-testid="ai-chat-confirmed">
          {item.confirmed.ok
            ? t('web.ai.tools.confirmedOk')
            : t('web.ai.tools.confirmedFail', { message: item.confirmed.message })}
        </p>
      )}
    </div>
  );
}

function ChatFailure(props: {
  reason: AssistantFailureReason;
  message: string;
  cause: AiFailureReason | undefined;
  endpointUrl: string | undefined;
  /** 服务端稳定码（见 `AiFailureContext.serverCode`）—— 402 与 409 靠它分开说话。 */
  serverCode: string | undefined;
  outsideFields: readonly string[] | undefined;
  onOpenSettings?: ((target: SettingsTarget) => void) | undefined;
}): React.JSX.Element {
  const { t, locale } = useI18n();
  const failure = assistantFailureCopy(props.reason, props.message, {
    cause: props.cause,
    endpointUrl: props.endpointUrl,
    serverCode: props.serverCode,
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
