import { describe, it, expect, vi } from 'vitest';
import { createNativeWidgetSession, type NativeWidgetBridge } from '../src/native-widget-session.js';
import type { WidgetDrainTasks } from '../src/widget-actions.js';
import type { WidgetPublishStateSlice } from '../src/widget-publish.js';

function setup(tasks: WidgetDrainTasks = { findTask: () => undefined, setCompleted: vi.fn() }) {
  const state: WidgetPublishStateSlice = { tasks: {}, projects: {}, habits: {}, habitLogs: {} };
  const bridge: NativeWidgetBridge = {
    drainIntentQueue: vi.fn().mockResolvedValue(null),
    ackIntentQueue: vi.fn().mockResolvedValue(0),
    mergeIntentQueue: vi.fn().mockResolvedValue(0),
    sealWidgetSnapshot: vi.fn(async (payload) => payload),
    setWidgetSnapshot: vi.fn().mockResolvedValue(true),
    clearWidgetState: vi.fn().mockResolvedValue(true),
  };
  const onError = vi.fn();
  const session = createNativeWidgetSession({ bridge, read: () => ({ state }),
    tasks, onError });
  return { state, bridge, onError, session };
}

describe('native widget lifecycle serialization', () => {
  it('coalesces writes during sealing and re-reads the final current state', async () => {
    const { state, bridge, session } = setup();
    let release!: (value: string) => void;
    vi.mocked(bridge.sealWidgetSnapshot).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const first = session.refresh(false);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    state.tasks['latest'] = { id: 'latest', title: 'Latest task', createdAt: 1, updatedAt: 1 };
    const second = session.refresh(false);
    release('{}');
    await Promise.all([first, second]);
    expect(bridge.sealWidgetSnapshot).toHaveBeenCalledTimes(2);
    expect(vi.mocked(bridge.sealWidgetSnapshot).mock.calls[1]?.[0]).toContain('Latest task');
    expect(bridge.drainIntentQueue).not.toHaveBeenCalled();
  });

  it('waits for in-flight sealing before clearing and never republishes afterward', async () => {
    const { bridge, session } = setup();
    let release!: (value: string) => void;
    vi.mocked(bridge.sealWidgetSnapshot).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    void session.refresh(false);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const clearing = session.clear();
    expect(bridge.clearWidgetState).not.toHaveBeenCalled();
    release('{}');
    await clearing;
    await session.refresh();
    expect(bridge.setWidgetSnapshot).not.toHaveBeenCalled();
    expect(bridge.clearWidgetState).toHaveBeenCalledTimes(1);
  });

  it('reports a native write failure and allows the next refresh to recover', async () => {
    const { bridge, session, onError } = setup();
    vi.mocked(bridge.setWidgetSnapshot).mockResolvedValueOnce(false);
    await session.refresh();
    expect(onError).toHaveBeenCalledOnce();
    await session.refresh();
    expect(bridge.setWidgetSnapshot).toHaveBeenCalledTimes(2);
  });
});


describe('native widget durable acknowledgements', () => {
  const raw = JSON.stringify({ v: 1, intents: [{ taskId: 'pending', targetIsDone: true, at: 1 }] });

  it('does not acknowledge persisted clicks when task lookup fails', async () => {
    const { bridge, session } = setup({ findTask: () => { throw new Error('unavailable state'); }, setCompleted: vi.fn() });
    vi.mocked(bridge.drainIntentQueue).mockResolvedValue(raw);
    await session.refresh();
    expect(bridge.ackIntentQueue).not.toHaveBeenCalled();
    expect(bridge.mergeIntentQueue).not.toHaveBeenCalled();
    expect(bridge.setWidgetSnapshot).not.toHaveBeenCalled();
  });

  it('retries failed acknowledgement on the next wake without deleting the persisted queue', async () => {
    const { bridge, session, onError } = setup();
    vi.mocked(bridge.drainIntentQueue).mockResolvedValue(raw);
    vi.mocked(bridge.ackIntentQueue).mockRejectedValueOnce(new Error('container locked'));
    await session.refresh();
    expect(onError).toHaveBeenCalledOnce();
    await session.refresh();
    expect(bridge.ackIntentQueue).toHaveBeenCalledTimes(2);
    expect(bridge.ackIntentQueue).toHaveBeenLastCalledWith(raw);
    expect(bridge.setWidgetSnapshot).toHaveBeenCalledOnce();
  });

  it('does not reject background refresh when error reporting also throws', async () => {
    const { bridge, session, onError } = setup();
    vi.mocked(bridge.setWidgetSnapshot).mockResolvedValueOnce(false);
    onError.mockImplementation(() => { throw new Error('reporting unavailable'); });
    await expect(session.refresh()).resolves.toBeUndefined();
    await session.refresh();
    expect(bridge.setWidgetSnapshot).toHaveBeenCalledTimes(2);
  });
});
