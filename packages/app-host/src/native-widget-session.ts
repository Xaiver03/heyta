import type { FocusState } from '@heyta/domain';
import { parseIntentQueueJson } from '@heyta/widget-core';
import { drainWidgetIntents, type WidgetDrainTasks } from './widget-actions.js';
import { planWidgetPublish, type WidgetPublishStateSlice } from './widget-publish.js';

/** Platform IO only. Keys stay in the OS key store and never cross this port. */
export interface NativeWidgetBridge {
  sealWidgetSnapshot(payloadJson: string, dayStr: string, validUntil: number): Promise<string>;
  setWidgetSnapshot(envelopeJson: string): Promise<boolean>;
  /** Non-destructive read; unacknowledged clicks remain durable across process exits. */
  drainIntentQueue(): Promise<string | null>;
  ackIntentQueue(processedJson: string): Promise<number>;
  mergeIntentQueue(pendingJson: string): Promise<number>;
  clearWidgetState(): Promise<boolean>;
  /** Device presentation preference; never part of task data or account credentials. */
  setWidgetLocale?(locale: 'zh-CN' | 'en'): Promise<boolean>;
}

/** Shared desktop/mobile-capable orchestration; the shell only supplies IO and lifecycle. */
export function createNativeWidgetSession(options: {
  bridge: NativeWidgetBridge;
  read: () => { state: WidgetPublishStateSlice; focus?: FocusState };
  tasks: WidgetDrainTasks;
  onError: (error: unknown) => void;
  now?: () => number;
}) {
  let active = true;
  let requested = false;
  let drainRequested = false;
  let flight: Promise<void> | undefined;
  function reportError(error: unknown): void {
    // Reporting must never reject background work after a task was already saved.
    try { options.onError(error); } catch { /* Reporter errors are not task errors. */ }
  }
  const now = options.now ?? Date.now;

  async function run(): Promise<void> {
    while (active && requested) {
      requested = false;
      const shouldDrain = drainRequested;
      drainRequested = false;
      try {
        if (shouldDrain) {
          const raw = await options.bridge.drainIntentQueue();
          if (!active) break;
          if (raw !== null) {
            const queue = parseIntentQueueJson(raw);
            const result = await drainWidgetIntents(queue, options.tasks);
            // Successful/explicitly skipped clicks alone are acknowledged. A newer
            // native click on the same task must survive this exact-match removal.
            if (result.acknowledged.intents.length > 0) {
              await options.bridge.ackIntentQueue(JSON.stringify(result.acknowledged));
            }
          }
        }
        if (!active) break;
        const plan = planWidgetPublish({ ...options.read(), now: now() });
        const envelope = await options.bridge.sealWidgetSnapshot(plan.payloadJson, plan.dayStr, plan.validUntil);
        if (!active) break;
        if (!await options.bridge.setWidgetSnapshot(envelope)) throw new Error('Native widget snapshot rejected');
      } catch (error) {
        reportError(error);
      }
    }
  }

  function refresh(drain = true): Promise<void> {
    if (!active) return Promise.resolve();
    requested = true;
    drainRequested ||= drain;
    if (flight === undefined) {
      flight = Promise.resolve().then(run).finally(() => {
        flight = undefined;
        if (active && requested) void refresh(false);
      });
    }
    return flight;
  }

  return {
    refresh,
    /** Stops new work. Already submitted domain actions finish through their normal op queue. */
    stop(): void { active = false; requested = false; },
    /** Wait for in-flight platform IO, then remove snapshot, pending clicks and device key. */
    async clear(): Promise<void> {
      active = false;
      requested = false;
      await flight;
      if (!await options.bridge.clearWidgetState()) throw new Error('Native widget state could not be cleared');
    },
  };
}
