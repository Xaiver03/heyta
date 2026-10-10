import { describe, expect, it, vi } from 'vitest';
import type { AppHost, WidgetDrainResult } from '@heyta/app-host';
import { type WidgetIntentQueue } from '@heyta/widget-core';
import { drainWidgetIntentsNow, runWidgetDrain, type WidgetDrainPorts } from '../src/widgets/drain';

const empty: WidgetIntentQueue = { v: 1, intents: [] };
const queue: WidgetIntentQueue = { v: 1, intents: [{ taskId: 't1', targetIsDone: true, at: 1 }] };
function ports(over: Partial<WidgetDrainPorts> = {}): WidgetDrainPorts {
  return { drain: async () => JSON.stringify(queue), acknowledge: async () => 0, ...over };
}
function result(remaining = empty, acknowledged = queue): WidgetDrainResult {
  return { applied: acknowledged.intents.length, skippedAlreadyInTarget: 0, skippedMissing: 0,
    failed: remaining.intents, remaining, acknowledged };
}

describe('widget read/apply/acknowledge', () => {
  it('ignores unavailable, empty and malformed queues without acknowledgements', async () => {
    for (const raw of [null, JSON.stringify(empty), '{invalid']) {
      const apply = vi.fn(async () => result());
      const acknowledge = vi.fn(async () => 0);
      expect(await runWidgetDrain(ports({ drain: async () => raw, acknowledge }), apply)).toBeNull();
      expect(apply).not.toHaveBeenCalled();
      expect(acknowledge).not.toHaveBeenCalled();
    }
  });
  it('acknowledges successful clicks after applying the parsed queue', async () => {
    const order: string[] = [];
    const acknowledge = vi.fn(async (raw: string) => {
      order.push('ack'); expect(JSON.parse(raw)).toEqual(queue); return 0;
    });
    const summary = await runWidgetDrain(ports({ acknowledge }), async (input) => {
      order.push('apply'); expect(input).toEqual(queue); return result();
    });
    expect(order).toEqual(['apply', 'ack']);
    expect(summary).toEqual({ applied: 1, skippedAlreadyInTarget: 0, skippedMissing: 0,
      pending: 0, acknowledgementFailed: false });
  });
  it('leaves failed clicks durable and does not acknowledge them', async () => {
    const acknowledge = vi.fn(async () => 0);
    const summary = await runWidgetDrain(ports({ acknowledge }), async () => result(queue, empty));
    expect(acknowledge).not.toHaveBeenCalled();
    expect(summary?.pending).toBe(1);
  });
  it('reports acknowledgement failure as still pending, never as lost clicks', async () => {
    const summary = await runWidgetDrain(ports({ acknowledge: async () => null }), async () => result());
    expect(summary?.pending).toBe(1);
    expect(summary?.acknowledgementFailed).toBe(true);
  });
  it('does not acknowledge after a state/action failure', async () => {
    const acknowledge = vi.fn(async () => 0);
    await expect(runWidgetDrain(ports({ acknowledge }), async () => { throw new Error('locked'); })).rejects.toThrow('locked');
    expect(acknowledge).not.toHaveBeenCalled();
  });
  it('does not crash application startup when the native module is absent', async () => {
    await expect(drainWidgetIntentsNow({} as AppHost)).resolves.toBeNull();
  });
});
