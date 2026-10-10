import { createTaskActions, drainWidgetIntents, type AppHost, type WidgetDrainResult } from '@heyta/app-host';
import { parseIntentQueueJson, type WidgetIntentQueue } from '@heyta/widget-core';
import { drainIntentQueue, ackIntentQueue } from './widget-bridge';

/** Native reads are non-destructive. Only successfully applied or explicitly skipped
 * clicks are acknowledged; a crash or failed acknowledgement leaves them on disk.
 * The shared actions provide durable idempotency when a committed op is delivered again. */
export interface WidgetDrainSummary {
  applied: number;
  skippedAlreadyInTarget: number;
  skippedMissing: number;
  pending: number;
  acknowledgementFailed: boolean;
}

export interface WidgetDrainPorts {
  drain(): Promise<string | null>;
  acknowledge(processedJson: string): Promise<number | null>;
}

const defaultPorts: WidgetDrainPorts = {
  drain: drainIntentQueue,
  acknowledge: ackIntentQueue,
};

export async function runWidgetDrain(
  ports: WidgetDrainPorts,
  apply: (queue: WidgetIntentQueue) => Promise<WidgetDrainResult>,
): Promise<WidgetDrainSummary | null> {
  const raw = await ports.drain();
  if (raw === null) return null;
  const queue = parseIntentQueueJson(raw);
  if (queue.intents.length === 0) return null;
  const result = await apply(queue);
  const acknowledged = result.acknowledged.intents.length === 0
    ? true : await ports.acknowledge(JSON.stringify(result.acknowledged)) !== null;
  return {
    applied: result.applied,
    skippedAlreadyInTarget: result.skippedAlreadyInTarget,
    skippedMissing: result.skippedMissing,
    pending: acknowledged ? result.remaining.intents.length : queue.intents.length,
    acknowledgementFailed: !acknowledged,
  };
}

/** Serialize foreground/startup drains so one native click cannot be applied twice concurrently. */
let draining: Promise<WidgetDrainSummary | null> | undefined;
export function drainWidgetIntentsNow(host: AppHost): Promise<WidgetDrainSummary | null> {
  if (draining) return draining;
  draining = (async () => {
    try {
      const summary = await runWidgetDrain(defaultPorts, (queue) =>
        drainWidgetIntents(queue, createTaskActions(host)));
      if (summary?.acknowledgementFailed) console.warn('[widget] 组件操作确认失败，保留原队列等待重试');
      return summary;
    } catch (error) {
      console.warn('[widget] 组件操作暂未处理，原队列保留：', error);
      return null;
    }
  })().finally(() => { draining = undefined; });
  return draining;
}
