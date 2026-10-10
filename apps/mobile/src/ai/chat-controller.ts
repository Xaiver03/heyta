import {
  assistantNeedsEgressDisclosure,
  assistantEgressFields,
  assistantGrants,
  ASSISTANT_TIER_READ_AND_PROPOSE,
  DEFAULT_ASSISTANT_TIER,
  confirmAiToolProposal,
  requestAssistantTurn,
  resolveAiRoute,
  type AiSettingsState,
  type AssistantMessage,
  type AssistantOutcome,
  type ChatItem,
  type HistoryStorage,
  type LocalObservationTranslate,
  type WithoutId,
  clearAssistantHistory,
  loadAssistantHistory,
  saveAssistantHistory,
  scopeAssistantHistoryStorage,
} from '@heyta/app-host';
import { fromHealthSnapshot, type HealthMap, type SecretStore } from '@heyta/ai';
import type { LocalApiHost } from '@heyta/local-api';
import { deleteDevicePref, readDevicePref, writeDevicePref } from '../prefs/device-prefs';

export type ChatPhase = 'idle' | 'disclose' | 'running';

export interface ChatRuntime {
  readonly settings: AiSettingsState;
  readonly host: LocalApiHost | null;
  readonly localize: LocalObservationTranslate;
  readonly secretStore: SecretStore;
  readonly onHealth: (health: HealthMap) => void;
  readonly onTierChange: (tier: AiSettingsState['assistantTier']) => void;
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
  setTier(tier: AiSettingsState['assistantTier']): void;
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
    // prove that the current route, destination, tier, and field set were
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
    const tier = runtime.settings.assistantTier;
    if (!assistantNeedsEgressDisclosure(text, { tier, now: routeTime })) {
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
      runtime?.settings.assistantTier !== ASSISTANT_TIER_READ_AND_PROPOSE ||
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
      getGrants: () =>
        epoch === this.accountEpoch
          ? assistantGrants(this.runtime?.settings.assistantTier ?? DEFAULT_ASSISTANT_TIER)
          : {},
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

  setTier(tier: AiSettingsState['assistantTier']): void {
    if (this.state.phase !== 'idle' || this.runtime === undefined) return;
    if (this.runtime.settings.assistantTier === tier) return;
    this.runtime.onTierChange(tier);
    this.update({ disclosed: false });
  }

  private async runTurn(text: string, history: readonly AssistantMessage[], routeTime: number): Promise<void> {
    const runtime = this.runtime;
    if (runtime === undefined || runtime.host === null || this.sendInFlight) return;
    const host = runtime.host;
    this.sendInFlight = true;
    const epoch = this.accountEpoch;
    this.update({ phase: 'running' });
    this.executionNumber += 1;
    try {
      const outcome = await requestAssistantTurn(
        { text },
        {
          routing: runtime.settings.routing,
          consents: runtime.settings.consents,
          tier: runtime.settings.assistantTier,
          getGrants: () =>
            epoch === this.accountEpoch
              ? assistantGrants(this.runtime?.settings.assistantTier ?? DEFAULT_ASSISTANT_TIER)
              : {},
          host,
          localize: runtime.localize,
          executionId: `${this.executionPrefix}:${String(this.executionNumber)}`,
          history,
          now: routeTime,
          routed: {
            secretStore: runtime.secretStore,
            now: () => routeTime,
            healthSeed: fromHealthSnapshot(runtime.settings.health, routeTime),
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
        outsideFields: undefined,
      });
    } finally {
      this.sendInFlight = false;
      if (epoch === this.accountEpoch) this.update({ phase: 'idle' });
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
    runtime.settings.routing,
    'tool-calling',
    { health: fromHealthSnapshot(runtime.settings.health, routeTime) },
  );
  return JSON.stringify({
    tier: runtime.settings.assistantTier,
    fields: assistantEgressFields(runtime.settings.assistantTier),
    target: route.target,
    routing: runtime.settings.routing,
  });
}

export const mobileAssistantController = createChatController({
  account: null,
  storage: MOBILE_CHAT_HISTORY_STORAGE,
});
