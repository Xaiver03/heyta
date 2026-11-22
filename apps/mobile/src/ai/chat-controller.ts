import {
  assistantNeedsEgressDisclosure,
  assistantEgressFields,
  assistantGrants,
  confirmAiToolProposal,
  requestAssistantTurn,
  resolveAiRoute,
  type AiSettingsState,
  type AssistantMessage,
  type AssistantOutcome,
  type ChatItem,
  type HistoryStorage,
  type LocalObservationTranslate,
  type ManagedTransport,
  type WithoutId,
  clearAssistantHistory,
  EMPTY_LIVE,
  loadAssistantHistory,
  type LiveTurn,
  saveAssistantHistory,
  scopeAssistantHistoryStorage,
  saveAssistantSessions,
  loadAssistantSessions,
  clearAssistantSessions,
  newAssistantSessionId,
  type AssistantSessionInput,
  type LoadedAssistantSession,
} from '@heyta/app-host';
import {
  fromHealthSnapshot,
  IMAGE_BUDGET,
  type AiImagePart,
  type AiRoutingConfig,
  type HealthMap,
  type SecretStore,
} from '@heyta/ai';
import type { LocalApiHost } from '@heyta/local-api';
import { deleteDevicePref, readDevicePref, writeDevicePref } from '../prefs/device-prefs';
import { getAiSettings } from './settings-store';

export type ChatPhase = 'idle' | 'disclose' | 'running';

/** 会话列表里的一条（不含正文；正文只属于"当前会话"那一条）。 */
export interface ChatSessionMeta {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: number;
}

export interface ChatRuntime {
  readonly settings: AiSettingsState;
  readonly host: LocalApiHost | null;
  readonly localize: LocalObservationTranslate;
  readonly secretStore: SecretStore;
  /**
   * 托管档的宿主通道（服务器基址 + 活令牌）。
   *
   * 🔴 它**必须**由壳提供、且只有 `packages/app-host` 那一份组装
   * （`createManagedTransport`）—— web 那 6 处也是同一个函数。
   * 漏接一处的表现是：那个面板在托管档上不走代理，用户只看到"AI 不可用"。
   */
  readonly managedTransport: ManagedTransport;
  /**
   * 可选：云端 Agent Harness 的跑一轮回调（设备本地循环 + 云端模型 + 本地数据工具）。
   * 给了它，`runTurn` 改走 Harness（见 AssistantScreen 的 MOBILE_CLOUD_HARNESS 开关（默认关））；
   * 省略则保持既有 `requestAssistantTurn`。由壳注入，控制器不建造引擎（保持 UI 层哑）。
   */
  readonly cloudTurn?: (text: string) => Promise<{ readonly text: string }>;
  /**
   * **求助时现算**的那一份路由配置。
   *
   * 🔴 为什么不是直接读 `settings.routing`：托管档的端点来自**同步服务器**
   * （`withManagedEndpoint` 合成），而服务器地址是用户**应用起来之后**才填的。
   * 读 `settings.routing` 会拿到"落盘的那一份"——里面**没有托管端点**，
   * 于是选托管的人按下去只会得到 `no-route`，而界面刚告诉过他"走托管"。
   *
   * ⚠️ 每次调用都重新算：这是**发送那一刻的事实**，不是渲染那一刻的快照。
   */
  readonly resolveRouting: () => AiRoutingConfig;
  readonly onHealth: (health: HealthMap) => void;
  /** 真机逐字揭示（仅真机壳置 true；测试环境不设 ⇒ 整段，避免异步破坏单测）。 */
  readonly typewriter?: boolean;
  /**
   * 流式传输（XHR 读增量，且**套在隐私闸门之内**）。
   *
   * 🔴 为什么需要它：RN 的 `fetch` 由 XHR 实现、整份收完才返回，响应上
   * **没有可读 `body`** —— 而 `packages/ai` 判"能不能按 SSE 读"的第三条
   * 正是这个（`routing.ts:1290`）。所以移动端一直只能"整段回来再显示"。
   * 这个 fetch 把响应换成可增量读的形状，逐字揭示才有数据。
   *
   * 🔴 它**必须**是 `createGatedStreamingFetch(privacyConsent)` 的产物：
   * 一个自己 `new XMLHttpRequest()` 的实现会绕过
   * `src/privacy/consent-gate.ts` 那道"没有同意，一个字节都不出这台设备"。
   * 注入进来（而不是在这里 import）是为了：① 让测试能塞假实现；
   * ② 与 `managedTransport` 同一条路数 —— 壳负责组装，控制器只消费。
   *
   * ⚠️ **可选**：`undefined` 时 `routing.ts` 用全局 `fetch`，行为与接线前
   * 完全一致（没有逐字，但能出结果）。这条退化路径是刻意的 ——
   * 见下方 `routed` 里那处展开。
   */
  readonly streamingFetch?: typeof fetch;
}

export interface ChatSnapshot {
  readonly account: string | null;
  /** Clock used to resolve the route shown in the current disclosure. */
  readonly routeTime: number;
  readonly draft: string;
  readonly phase: ChatPhase;
  readonly disclosed: boolean;
  readonly historyOpen: boolean;
  readonly expandedEntry: number | undefined;
  readonly items: readonly ChatItem[];
  readonly proposalErrors: Readonly<Record<number, string>>;
  /**
   * 这一轮**进行中**的过程（流式）。`undefined` = 没有在跑的一轮。
   *
   * 🔴 **不落盘**（与 `items` 不同）：它描述的是"此刻正在显示什么"，
   * 而不是"发生过什么"。重挂载/重启后恢复一份半截的 live 会让界面
   * 显示一段永远不会再长大的文本 —— 那比不显示更糟。
   *
   * ⚠️ 加了流式之后才有值；移动端此前是"整段回来再显示"，
   * 所以这个字段在旧快照里恒为 `undefined`（`loadAccount` 里给的初值）。
   */
  readonly live: LiveTurn | undefined;
  /**
   * 本机保存的会话列表（含"当前会话"那一条），供会话面板展示与切换。
   * 与 `items` 不同：`items` 只是**当前**会话的正文，其余会话的正文留在控制器里。
   */
  readonly sessions: readonly ChatSessionMeta[];
  /** 当前会话 id（永远非 null：即便是一段还没发过消息的新会话，也给它一个稳定 id）。 */
  readonly activeSessionId: string | null;
  /**
   * 待随下一条消息发出的图片（**只活在内存里**：不进 op-log、不同步、不落会话历史）。
   * 与 web 端 `AssistantPanel` 的 `images` 同一条纪律（ADR-0005「AI 是输入法」）。
   */
  readonly images: readonly AiImagePart[];
}

export interface ChatController {
  configure(runtime: ChatRuntime): void;
  syncAccount(account: string | null): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ChatSnapshot;
  setDraft(value: string): void;
  send(): void;
  cancelDisclosure(): void;
  confirmDisclosure(): void;
  confirmProposal(id: number): void;
  retry(id: number): void;
  newSession(): void;
  /** 切换到另一段已保存的会话（先保证当前这轮已结束）。 */
  switchSession(id: string): void;
  /** 给某段会话改名（当前会话或历史会话都可以）。 */
  renameSession(id: string, title: string): void;
  /** 追加待发送的图片（已归一化、已过预算；超出张数上界会被截断）。 */
  addImages(parts: readonly AiImagePart[]): void;
  /** 移除第 index 张待发送图片。 */
  removeImage(index: number): void;
  toggleHistory(): void;
  toggleExpandedEntry(id: number): void;
}

export const MOBILE_CHAT_HISTORY_STORAGE: HistoryStorage = {
  getItem: (key) => readDevicePref(key) ?? null,
  setItem: (key, value) => {
    if (!writeDevicePref(key, value)) throw new Error('mobile chat history storage write failed');
  },
  removeItem: (key) => {
    if (!deleteDevicePref(key)) throw new Error('mobile chat history storage remove failed');
  },
};

export interface ChatControllerOptions {
  readonly account: string | null;
  readonly storage: HistoryStorage;
}

let controllerCounter = 0;

export function createChatController(options: ChatControllerOptions): ChatController {
  return new MobileChatController(options);
}

function newExecutionPrefix(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid !== undefined) return `mobile-chat:${uuid}`;
  controllerCounter += 1;
  return `mobile-chat:${String(Date.now())}:${String(controllerCounter)}`;
}

class MobileChatController implements ChatController {
  private readonly listeners = new Set<() => void>();
  private readonly storage: HistoryStorage;
  private readonly executionPrefix = newExecutionPrefix();
  private executionNumber = 0;
  private runtime: ChatRuntime | undefined;
  private pendingText: string | undefined;
  private pendingHistory: readonly AssistantMessage[] = [];
  /** 披露阶段暂存的图片（cancel 要还原、confirm 才真正发）。 */
  private pendingImages: readonly AiImagePart[] = [];
  private sendInFlight = false;
  private confirmInFlight = false;
  private accountEpoch = 0;
  private disclosureFingerprint: string | undefined;
  private state: ChatSnapshot;
  /**
   * 当前会话之外、**有正文**的其它会话。`state.items` 始终只放当前会话的正文。
   * 切换/newSession 时在两者之间搬运，`persist` 时合起来落盘。
   */
  private inactiveSessions: readonly LoadedAssistantSession[] = [];
  private activeSessionId: string | null = null;
  private activeTitle = '';
  private activeUpdatedAt = 0;

  constructor(options: ChatControllerOptions) {
    this.storage = options.storage;
    this.state = this.loadAccount(options.account);
  }

  configure(runtime: ChatRuntime): void {
    const routeTime = Date.now();
    const nextFingerprint = createDisclosureFingerprint(runtime, routeTime);
    const disclosureChanged = this.disclosureFingerprint !== nextFingerprint;
    this.runtime = runtime;
    this.disclosureFingerprint = nextFingerprint;
    // Persisted history only predates the runtime configuration. It cannot
    // prove that the current route, destination, and field set were
    // shown to the user, so the first configured runtime must disclose again.
    if (disclosureChanged) {
      this.update({ routeTime, disclosed: false });
    }
  }

  syncAccount(account: string | null): void {
    if (account === this.state.account) return;
    this.accountEpoch += 1;
    this.pendingText = undefined;
    this.pendingHistory = [];
    this.pendingImages = [];
    this.disclosureFingerprint = undefined;
    // 换账号 = 换整套会话（loadAccount 会重置下面这几个私有字段）。
    this.inactiveSessions = [];
    this.activeSessionId = null;
    this.activeTitle = '';
    this.activeUpdatedAt = 0;
    const restored = this.loadAccount(account);
    // A persisted boolean belongs to the account's previous runtime. Keep the
    // restored transcript, but require a fresh disclosure before this account
    // can send through the currently configured route.
    this.state = restored.disclosed ? { ...restored, disclosed: false } : restored;
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): ChatSnapshot {
    return this.state;
  }

  setDraft(value: string): void {
    if (this.state.draft === value) return;
    this.update({ draft: value });
  }

  send(): void {
    const runtime = this.runtime;
    if (this.state.phase !== 'idle' || this.sendInFlight || runtime === undefined || runtime.host === null) return;
    const routeTime = Date.now();
    this.refreshDisclosureAnchor(runtime, routeTime);
    const text = this.state.draft.trim();
    const images = this.state.images;
    // 🔴 只有图、没有字也是**合法的一次提问**（"这张截图是什么"）。
    if (text === '' && images.length === 0) return;
    const history = this.assistantHistory();
    this.append({ role: 'user', text });
    this.update({ draft: '', images: [] });
    // 带图出境必须披露（哪怕文字本身能本机答）：不写 images，用户会以为只发了字。
    const needsDisclosure = images.length > 0 || assistantNeedsEgressDisclosure(text, { now: routeTime });
    if (!needsDisclosure) {
      void this.runTurn(text, history, routeTime, images);
      return;
    }
    if (!this.state.disclosed) {
      this.pendingText = text;
      this.pendingHistory = history;
      this.pendingImages = images;
      this.update({ phase: 'disclose' });
      return;
    }
    void this.runTurn(text, history, this.state.routeTime, images);
  }

  cancelDisclosure(): void {
    if (this.state.phase !== 'disclose') return;
    const text = this.pendingText;
    const images = this.pendingImages;
    this.pendingText = undefined;
    this.pendingHistory = [];
    this.pendingImages = [];
    if (text !== undefined) {
      const last = this.state.items.at(-1);
      if (last?.role === 'user' && last.text === text) {
        this.update({ items: this.state.items.slice(0, -1), draft: text, images, phase: 'idle' });
        return;
      }
      this.update({ draft: text, images, phase: 'idle' });
      return;
    }
    this.update({ phase: 'idle' });
  }

  confirmDisclosure(): void {
    if (this.state.phase !== 'disclose') return;
    const text = this.pendingText;
    const history = this.pendingHistory;
    const images = this.pendingImages;
    this.pendingText = undefined;
    this.pendingHistory = [];
    this.pendingImages = [];
    this.update({ disclosed: true });
    if (text !== undefined) void this.runTurn(text, history, this.state.routeTime, images);
  }

  addImages(parts: readonly AiImagePart[]): void {
    if (this.state.phase === 'running' || parts.length === 0) return;
    const next = [...this.state.images, ...parts].slice(0, IMAGE_BUDGET.maxImagesPerRequest);
    this.update({ images: next });
  }

  removeImage(index: number): void {
    if (this.state.phase === 'running') return;
    this.update({ images: this.state.images.filter((_image, i) => i !== index) });
  }

  confirmProposal(id: number): void {
    if (this.state.phase !== 'idle' || this.confirmInFlight) return;
    const entry = this.state.items.find(
      (item): item is Extract<ChatItem, { role: 'proposal' }> =>
        item.id === id && item.role === 'proposal',
    );
    const runtime = this.runtime;
    const host = runtime?.host;
    if (
      entry === undefined ||
      host === null ||
      host === undefined ||
      entry.expired === true ||
      entry.confirmed !== undefined
    ) return;
    const resolvedHost = host;
    this.confirmInFlight = true;
    const epoch = this.accountEpoch;
    this.update({ phase: 'running' });
    void confirmAiToolProposal(resolvedHost, entry.proposal, {
      getGrants: () => (epoch === this.accountEpoch ? assistantGrants() : {}),
    })
      .then((result) => {
        if (epoch !== this.accountEpoch) return;
        if (result.ok) {
          this.replace(id, { confirmed: result });
          const { [id]: _cleared, ...proposalErrors } = this.state.proposalErrors;
          this.update({ proposalErrors });
        } else {
          this.update({
            proposalErrors: { ...this.state.proposalErrors, [id]: result.message },
          });
        }
      })
      .catch((error: unknown) => {
        if (epoch !== this.accountEpoch) return;
        this.update({
          proposalErrors: {
            ...this.state.proposalErrors,
            [id]: error instanceof Error ? error.message : 'confirmation failed',
          },
        });
      })
      .finally(() => {
        this.confirmInFlight = false;
        if (epoch === this.accountEpoch) this.update({ phase: 'idle' });
      });
  }

  retry(id: number): void {
    if (this.state.phase !== 'idle') return;
    const index = this.state.items.findIndex((item) => item.id === id);
    const entry = this.state.items[index];
    if (entry?.role !== 'error') return;
    const previous = this.state.items[index - 1];
    this.update({
      items: this.state.items.filter((item) => item.id !== id),
      draft: previous?.role === 'user' ? previous.text : '',
    });
  }

  newSession(): void {
    if (this.state.phase !== 'idle') return;
    this.pendingText = undefined;
    this.pendingHistory = [];
    // 旧会话里有内容 ⇒ 收进列表（多会话：新会话不清掉历史，只是开一段新的）。
    // 之后 active 为空 ⇒ persist 会清掉**旧单槽**镜像（历史测试里 `raw()` 为 null 的判据）。
    if (this.activeSessionId !== null && this.state.items.length > 0) {
      this.inactiveSessions = [
        this.toRecord(this.activeSessionId, this.state.items, this.state.disclosed),
        ...this.inactiveSessions,
      ];
    }
    this.activeSessionId = newAssistantSessionId();
    this.activeTitle = '';
    this.activeUpdatedAt = Date.now();
    this.pendingImages = [];
    this.update({ items: [], draft: '', images: [], disclosed: false, historyOpen: false, proposalErrors: {}, live: undefined });
  }

  switchSession(id: string): void {
    if (this.state.phase !== 'idle') return;
    if (id === this.activeSessionId) return;
    const target = this.inactiveSessions.find((session) => session.id === id);
    if (target === undefined) return;
    const nextInactive = this.inactiveSessions.filter((session) => session.id !== id);
    if (this.activeSessionId !== null && this.state.items.length > 0) {
      nextInactive.unshift(this.toRecord(this.activeSessionId, this.state.items, this.state.disclosed));
    }
    this.inactiveSessions = nextInactive;
    this.activeSessionId = target.id;
    this.activeTitle = target.title;
    this.activeUpdatedAt = target.updatedAt;
    this.update({
      items: target.items,
      disclosed: target.disclosed,
      draft: '',
      images: [],
      expandedEntry: undefined,
      proposalErrors: {},
      live: undefined,
    });
  }

  renameSession(id: string, title: string): void {
    if (this.state.phase === 'running') return;
    const clean = title.trim();
    if (id === this.activeSessionId) {
      this.activeTitle = clean;
    } else {
      this.inactiveSessions = this.inactiveSessions.map((session) =>
        session.id === id ? { ...session, title: clean } : session,
      );
    }
    // update({}) 会重算 sessions 元信息并落盘。
    this.update({});
  }

  toggleHistory(): void {
    this.update({ historyOpen: !this.state.historyOpen });
  }

  toggleExpandedEntry(id: number): void {
    this.update({ expandedEntry: this.state.expandedEntry === id ? undefined : id });
  }

  private async runTurn(text: string, history: readonly AssistantMessage[], routeTime: number, images: readonly AiImagePart[] = []): Promise<void> {
    const runtime = this.runtime;
    if (runtime === undefined || runtime.host === null || this.sendInFlight) return;
    const host = runtime.host;
    this.sendInFlight = true;
    const epoch = this.accountEpoch;
    /**
     * 🔴 开跑就先清空 live：上一轮的残留过程行留在屏上会让用户
     * 以为"这一轮已经在调工具了"，而其实一个字节都还没发。
     */
    this.update({ phase: 'running', live: EMPTY_LIVE });
    this.executionNumber += 1;
    if (runtime.cloudTurn !== undefined) {
      try {
        const res = await runtime.cloudTurn(text);
        if (epoch !== this.accountEpoch) return;
        this.append({ role: 'assistant', text: res.text, steps: [], stoppedAt: undefined });
      } catch (error: unknown) {
        if (epoch !== this.accountEpoch) return;
        this.append({ role: 'error', message: error instanceof Error ? error.message : 'request failed', reason: 'routing-failed', cause: undefined, endpointUrl: undefined, serverCode: undefined, outsideFields: undefined });
      } finally {
        this.sendInFlight = false;
        if (epoch === this.accountEpoch) this.update({ phase: 'idle', live: undefined });
      }
      return;
    }
    try {
      const outcome = await requestAssistantTurn(
        { text, ...(images.length === 0 ? {} : { images }) },
        {
          routing: runtime.resolveRouting(),
          consents: getAiSettings().consents,
          getGrants: () => (epoch === this.accountEpoch ? assistantGrants() : {}),
          host,
          localize: runtime.localize,
          executionId: `${this.executionPrefix}:${String(this.executionNumber)}`,
          history,
          now: routeTime,
          /**
           * 🔴 流式事件 → `live`。**给了这个才有流**（`routing.ts:770` 的
           * "显式要"契约：没给就一个字节的 `stream` 都不带）。
           *
           * ⚠️ 给了它也**不保证**真的有流：RN 的 `fetch` 响应没有可读 body，
           * `isEventStream` 会判 false 并**退回整份读取**（见 `routing.ts:1290`
           * 那段注释的三条判据）。所以：
           *   · 有流时 → 逐字，`live` 被填上；
           *   · 没流时 → 整段回来，`live` 一直是空的，界面走的还是老路。
           * 这条退化方向是**故意的**：能出结果，而不是"接上流然后卡住"。
           *
           * 与 web 版同一道闸门（`AssistantPanel.tsx` 的 onEvent）：
           * 过了 `epoch` 或换了账号之后到的片段**一个都不许画出来** ——
           * 它属于上一段对话，而界面上已经是另一段。
           */
          // 2026-11-21：真机 XHR 流式通道报错，暂不请求流式；服务端回整份 JSON，稳定可回话。
          routed: {
            secretStore: runtime.secretStore,
            managedTransport: runtime.managedTransport,
            now: () => routeTime,
            healthSeed: fromHealthSnapshot(runtime.settings.health, routeTime),
            /**
             * 🔴 流式传输 —— `routing.ts:837` 的 `deps.fetchImpl ?? globalThis.fetch`
             * 就是这道缝。有了它，`onEvent` 收到的片段才可能是**真·逐片**的。
             *
             * ⚠️ 条件展开（不是 `fetchImpl: runtime.streamingFetch`）：
             * 传 `undefined` 与不传在类型上都合法，但展开式让"没接线"这条路
             * 在 `routed` 对象里**根本不出现**，于是 `routing.ts` 走它原本的
             * `?? globalThis.fetch`。少一个 `undefined` 字段，就少一处
             * "这里为什么是 undefined"的追问。
             *
             * 🔴 它出问题时**不会**让人拿不到回答：`createGatedStreamingFetch`
             * 在任何一步不合预期（XHR 不可用、content-type 不是 SSE、闸门拒绝）
             * 时都退回整份读取或抛闸门错误 —— 与接线前的行为一致，
             * 只是没有逐字。见 `streaming-fetch.ts` 文件头。
             */
            ...(runtime.streamingFetch === undefined
              ? {}
              : { fetchImpl: runtime.streamingFetch }),
          },
        },
      );
      if (epoch !== this.accountEpoch) return;
      runtime.onHealth(outcome.health);
      this.appendOutcome(outcome);
    } catch (error: unknown) {
      if (epoch !== this.accountEpoch) return;
      this.append({
        role: 'error',
        message: error instanceof Error ? error.message : 'request failed',
        reason: 'routing-failed',
        cause: undefined,
        endpointUrl: undefined,
        // 这一支是"调用本身抛了"（不是一次 HTTP 失败），所以没有服务端码。
        serverCode: undefined,
        outsideFields: undefined,
      });
    } finally {
      this.sendInFlight = false;
      /**
       * 🔴 收尾必须清空 `live`，而且要清在 `finally` 里 ——
       * 失败分支（catch）同样会走到这里。留在屏上的后果是：
       * 一次失败的提问后面挂着"正在调用工具…"那几行，
       * 而那一轮永远不会再前进；`phase` 已经是 idle，用户只看到
       * 一堆不动的过程行，没有任何东西告诉他"这一轮结束了"。
       */
      if (epoch === this.accountEpoch) this.update({ phase: 'idle', live: undefined });
    }
  }

  private appendOutcome(outcome: AssistantOutcome): void {
    if (!outcome.ok) {
      this.append({
        role: 'error',
        message: outcome.message,
        reason: outcome.reason,
        cause: outcome.cause,
        endpointUrl: outcome.endpointUrl,
        serverCode: outcome.serverCode,
        outsideFields: outcome.outsideFields,
      });
      return;
    }
    if (outcome.kind === 'proposal') {
      this.append({ role: 'proposal', text: outcome.text, proposal: outcome.proposal, confirmed: undefined });
      return;
    }
    const stoppedAt = outcome.kind === 'stopped' ? outcome.limit : undefined;
    if (this.runtime?.typewriter === true && outcome.text.length > 0) {
      const id = this.append({ role: 'assistant', text: '', steps: outcome.steps, stoppedAt });
      this.reveal(id, outcome.text);
    } else {
      this.append({ role: 'assistant', text: outcome.text, steps: outcome.steps, stoppedAt });
    }
  }

  private assistantHistory(): readonly AssistantMessage[] {
    return this.state.items
      .filter((item) => item.role === 'user' || item.role === 'assistant' || item.role === 'proposal')
      .map((item) => ({ role: item.role === 'user' ? 'user' : 'assistant', text: item.text }));
  }

  private append(entry: WithoutId<ChatItem>): number {
    const id = this.state.items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
    this.update({ items: [...this.state.items, { ...entry, id } as ChatItem] });
    return id;
  }

  private revealTimer: ReturnType<typeof setTimeout> | undefined;
  /** 控制器层逐字：把整段文本按 ~3s 分片写入（仅 typewriter 开启时用）。 */
  private reveal(id: number, full: string): void {
    const step = Math.max(1, Math.ceil(full.length / 60));
    let i = 0;
    const tick = (): void => {
      i = Math.min(full.length, i + step);
      this.replace(id, { text: full.slice(0, i) } as Partial<ChatItem>);
      if (i < full.length) this.revealTimer = setTimeout(tick, 50);
    };
    tick();
  }

  private replace(id: number, patch: Partial<ChatItem>): void {
    this.update({
      items: this.state.items.map((item) => (item.id === id ? ({ ...item, ...patch } as ChatItem) : item)),
    });
  }

  private loadAccount(account: string | null): ChatSnapshot {
    // 先读多会话层；读不到再回退旧的单槽层（把一段旧对话迁成一段会话）。
    const loaded = loadAssistantSessions(account, this.storage);
    if (loaded !== null) {
      const active = loaded.sessions.find((session) => session.id === loaded.activeId) ?? loaded.sessions[0]!;
      this.inactiveSessions = loaded.sessions.filter((session) => session.id !== active.id);
      this.activeSessionId = active.id;
      this.activeTitle = active.title;
      this.activeUpdatedAt = active.updatedAt;
      return this.buildSnapshot(account, active.items, active.disclosed);
    }
    const legacy = loadAssistantHistory(account, scopeAssistantHistoryStorage(this.storage, account));
    this.inactiveSessions = [];
    this.activeSessionId = newAssistantSessionId();
    this.activeTitle = '';
    this.activeUpdatedAt = Date.now();
    if (legacy !== null && legacy.items.length > 0) {
      return this.buildSnapshot(account, legacy.items, legacy.disclosed);
    }
    return this.buildSnapshot(account, [], false);
  }

  private buildSnapshot(
    account: string | null,
    items: readonly ChatItem[],
    disclosed: boolean,
  ): ChatSnapshot {
    return {
      account,
      routeTime: Date.now(),
      draft: '',
      phase: 'idle',
      disclosed,
      historyOpen: false,
      expandedEntry: undefined,
      items,
      proposalErrors: {},
      // ⚠️ 恢复时**永远**是 undefined：见 ChatSnapshot.live 的注释。
      // 别在这里写 `restored?.live` —— 那字段根本没落盘，读出来是 undefined，
      // 但写成那样会让后来者以为它落过盘。
      live: undefined,
      images: [],
      sessions: this.sessionsMeta(),
      activeSessionId: this.activeSessionId,
    };
  }

  private update(patch: Partial<ChatSnapshot>): void {
    this.state = { ...this.state, ...patch };
    // 正文变了 ⇒ 当前会话的标题/更新时间跟着刷新，会话列表才不会停在旧值。
    this.refreshActiveMeta();
    this.state = { ...this.state, sessions: this.sessionsMeta(), activeSessionId: this.activeSessionId };
    this.persist();
    this.emit();
  }

  /** 当前会话有内容且还没有标题时，用第一句用户消息给它起个头。 */
  private refreshActiveMeta(): void {
    if (this.state.items.length === 0) return;
    if (this.activeTitle.trim() === '') {
      this.activeTitle = this.titleFor(this.state.items);
    }
    this.activeUpdatedAt = Date.now();
  }

  /** 会话列表（当前会话 + 其它有内容的会话，按更新时间倒序）。 */
  private sessionsMeta(): readonly ChatSessionMeta[] {
    const meta: ChatSessionMeta[] = [];
    if (this.activeSessionId !== null) {
      meta.push({
        id: this.activeSessionId,
        title: this.activeTitle,
        updatedAt: this.activeUpdatedAt,
      });
    }
    for (const session of this.inactiveSessions) {
      meta.push({ id: session.id, title: session.title, updatedAt: session.updatedAt });
    }
    // 稳定排序：当前会话永远在最前，其余按更新时间倒序（最近更新的靠上）。
    const [head, ...rest] = meta;
    rest.sort((a, b) => b.updatedAt - a.updatedAt);
    return head === undefined ? [] : [head, ...rest];
  }

  /** 把一段"当前/历史"正文包成可落盘的记录。 */
  private toRecord(id: string, items: readonly ChatItem[], disclosed: boolean): LoadedAssistantSession {
    return {
      id,
      title: this.activeSessionId === id ? this.titleFor(items, this.activeTitle) : this.titleFor(items),
      updatedAt: this.activeSessionId === id ? (this.activeUpdatedAt || Date.now()) : Date.now(),
      disclosed,
      items,
    };
  }

  /** 会话标题：显式名优先，否则取第一句用户消息前 24 个字。 */
  private titleFor(items: readonly ChatItem[], explicit?: string): string {
    if (explicit !== undefined && explicit.trim() !== '') return explicit.trim();
    const firstUser = items.find((item) => item.role === 'user');
    const text = firstUser?.role === 'user' ? firstUser.text.trim() : '';
    if (text === '') return '';
    return text.length > 24 ? `${text.slice(0, 24)}…` : text;
  }

  private persist(): void {
    const account = this.state.account;
    // 多会话层：当前会话（有内容才落）+ 其它有内容的历史会话。
    const records: AssistantSessionInput[] = [];
    for (const session of this.inactiveSessions) {
      if (session.items.length > 0) {
        records.push({
          id: session.id,
          title: session.title,
          updatedAt: session.updatedAt,
          disclosed: session.disclosed,
          items: session.items,
        });
      }
    }
    if (this.activeSessionId !== null && this.state.items.length > 0) {
      records.push({
        id: this.activeSessionId,
        title: this.titleFor(this.state.items, this.activeTitle),
        updatedAt: this.activeUpdatedAt || Date.now(),
        disclosed: this.state.disclosed,
        items: this.state.items,
      });
    }
    saveAssistantSessions({ activeId: this.activeSessionId, sessions: records }, account, this.storage);

    // 🔴 兼容镜像：把"当前这一段"仍写进旧单槽层。
    // 为什么不能省 —— 旧单槽的信封形状被 web 与 app-host 两套测试钉死（见
    // `assistant-sessions.ts` 文件头第 1 条），移动端与 web 共用同一份 `HistoryStorage` 语义；
    // 且 `chat-controller.spec.ts` 用 `raw()` 断言"新会话后旧单槽键为空"。
    const scoped = scopeAssistantHistoryStorage(this.storage, account);
    if (this.state.items.length === 0) {
      clearAssistantHistory(scoped);
    } else {
      saveAssistantHistory(
        { items: this.state.items, disclosed: this.state.disclosed, account },
        scoped,
      );
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private refreshDisclosureAnchor(runtime: ChatRuntime, routeTime: number): void {
    const nextFingerprint = createDisclosureFingerprint(runtime, routeTime);
    const disclosureChanged = this.disclosureFingerprint !== nextFingerprint;
    this.disclosureFingerprint = nextFingerprint;
    this.update({ routeTime, ...(disclosureChanged ? { disclosed: false } : {}) });
  }
}

function createDisclosureFingerprint(runtime: ChatRuntime, routeTime: number): string {
  const route = resolveAiRoute(
    runtime.resolveRouting(),
    'tool-calling',
    { health: fromHealthSnapshot(runtime.settings.health, routeTime) },
  );
  return JSON.stringify({
    fields: assistantEgressFields(),
    target: route.target,
    routing: runtime.resolveRouting(),
  });
}

export const mobileAssistantController = createChatController({
  account: null,
  storage: MOBILE_CHAT_HISTORY_STORAGE,
});
