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
  reduceAssistantLive,
  type LiveTurn,
  saveAssistantHistory,
  scopeAssistantHistoryStorage,
} from '@heyta/app-host';
import {
  fromHealthSnapshot,
  type AiRoutingConfig,
  type HealthMap,
  type SecretStore,
} from '@heyta/ai';
import type { LocalApiHost } from '@heyta/local-api';
import { deleteDevicePref, readDevicePref, writeDevicePref } from '../prefs/device-prefs';

export type ChatPhase = 'idle' | 'disclose' | 'running';

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
  private sendInFlight = false;
  private confirmInFlight = false;
  private accountEpoch = 0;
  private disclosureFingerprint: string | undefined;
  private state: ChatSnapshot;

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
    this.disclosureFingerprint = undefined;
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
    if (text === '') return;
    const history = this.assistantHistory();
    this.append({ role: 'user', text });
    this.update({ draft: '' });
    if (!assistantNeedsEgressDisclosure(text, { now: routeTime })) {
      void this.runTurn(text, history, routeTime);
      return;
    }
    if (!this.state.disclosed) {
      this.pendingText = text;
      this.pendingHistory = history;
      this.update({ phase: 'disclose' });
      return;
    }
    void this.runTurn(text, history, this.state.routeTime);
  }

  cancelDisclosure(): void {
    if (this.state.phase !== 'disclose') return;
    const text = this.pendingText;
    this.pendingText = undefined;
    this.pendingHistory = [];
    if (text !== undefined) {
      const last = this.state.items.at(-1);
      if (last?.role === 'user' && last.text === text) {
        this.update({ items: this.state.items.slice(0, -1), draft: text, phase: 'idle' });
        return;
      }
      this.update({ draft: text, phase: 'idle' });
      return;
    }
    this.update({ phase: 'idle' });
  }

  confirmDisclosure(): void {
    if (this.state.phase !== 'disclose') return;
    const text = this.pendingText;
    const history = this.pendingHistory;
    this.pendingText = undefined;
    this.pendingHistory = [];
    this.update({ disclosed: true });
    if (text !== undefined) void this.runTurn(text, history, this.state.routeTime);
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
    this.update({ items: [], draft: '', disclosed: false, historyOpen: false, proposalErrors: {} });
  }

  toggleHistory(): void {
    this.update({ historyOpen: !this.state.historyOpen });
  }

  toggleExpandedEntry(id: number): void {
    this.update({ expandedEntry: this.state.expandedEntry === id ? undefined : id });
  }

  private async runTurn(text: string, history: readonly AssistantMessage[], routeTime: number): Promise<void> {
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
    try {
      const outcome = await requestAssistantTurn(
        { text },
        {
          routing: runtime.resolveRouting(),
          consents: runtime.settings.consents,
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
          onEvent: (event) => {
            if (epoch !== this.accountEpoch) return;
            this.update({ live: reduceAssistantLive(this.state.live, event) });
          },
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
    this.append({
      role: 'assistant',
      text: outcome.text,
      steps: outcome.steps,
      stoppedAt: outcome.kind === 'stopped' ? outcome.limit : undefined,
    });
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

  private replace(id: number, patch: Partial<ChatItem>): void {
    this.update({
      items: this.state.items.map((item) => (item.id === id ? ({ ...item, ...patch } as ChatItem) : item)),
    });
  }

  private loadAccount(account: string | null): ChatSnapshot {
    const restored = loadAssistantHistory(account, scopeAssistantHistoryStorage(this.storage, account));
    return {
      account,
      routeTime: Date.now(),
      draft: '',
      phase: 'idle',
      disclosed: restored?.disclosed ?? false,
      historyOpen: false,
      expandedEntry: undefined,
      items: restored?.items ?? [],
      proposalErrors: {},
      // ⚠️ 恢复时**永远**是 undefined：见 ChatSnapshot.live 的注释。
      // 别在这里写 `restored?.live` —— 那字段根本没落盘，读出来是 undefined，
      // 但写成那样会让后来者以为它落过盘。
      live: undefined,
    };
  }

  private update(patch: Partial<ChatSnapshot>): void {
    this.state = { ...this.state, ...patch };
    this.persist();
    this.emit();
  }

  private persist(): void {
    const storage = scopeAssistantHistoryStorage(this.storage, this.state.account);
    if (this.state.items.length === 0) {
      clearAssistantHistory(storage);
      return;
    }
    saveAssistantHistory(
      { items: this.state.items, disclosed: this.state.disclosed, account: this.state.account },
      storage,
    );
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
