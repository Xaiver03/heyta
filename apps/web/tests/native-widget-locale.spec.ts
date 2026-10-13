import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NativeWidgetBridge } from '@heyta/app-host';
import { activateLocale } from '../src/lib/locale.js';
import { clearNativeWidgets, startNativeWidgetLifecycle } from '../src/lib/native-widgets.js';

vi.mock('../src/lib/oplog.js', () => ({ currentState: () => ({}), onEngineChange: () => () => {} }));
vi.mock('../src/features/focus/store.js', () => ({ useFocusStore: { getState: () => ({}), subscribe: () => () => {} } }));
vi.mock('../src/features/tasks/store.js', () => ({ widgetDrainTasks: {} }));
vi.mock('@heyta/app-host', () => ({
  createNativeWidgetSession: ({ bridge }: { bridge: NativeWidgetBridge }) => ({
    refresh: () => Promise.resolve(), stop: () => {}, clear: () => bridge.clearWidgetState(),
  }),
  planWidgetPublish: () => ({ validUntil: Date.now() + 86_400_000 }),
}));

type WidgetWindow = Window & { __heytaNativeWidgetBridge?: NativeWidgetBridge };
const surface = window as WidgetWindow;
const settle = () => vi.waitFor(() => expect(pending()).toBe(false));
let outstanding = false;
const pending = () => outstanding;
const bridge = (setWidgetLocale?: NativeWidgetBridge['setWidgetLocale']): NativeWidgetBridge => ({
  sealWidgetSnapshot: vi.fn(), setWidgetSnapshot: vi.fn(), drainIntentQueue: vi.fn(),
  ackIntentQueue: vi.fn(), mergeIntentQueue: vi.fn(), clearWidgetState: vi.fn().mockResolvedValue(true), setWidgetLocale,
});

beforeEach(() => { activateLocale('zh-CN'); outstanding = false; });
afterEach(async () => { await clearNativeWidgets(); delete surface.__heytaNativeWidgetBridge; vi.restoreAllMocks(); });

it('initial and subsequent selections reach native extensions in order, even while the initial write is slow', async () => {
  let finish!: () => void;
  const first = new Promise<void>((resolve) => { finish = resolve; });
  const write = vi.fn().mockImplementationOnce(async () => { outstanding = true; await first; outstanding = false; return true; }).mockResolvedValue(true);
  surface.__heytaNativeWidgetBridge = bridge(write);
  expect(startNativeWidgetLifecycle()).toBe(true);
  await vi.waitFor(() => expect(write).toHaveBeenCalledWith('zh-CN'));
  activateLocale('en'); activateLocale('zh-CN');
  expect(write).toHaveBeenCalledTimes(1);
  finish(); await settle();
  await vi.waitFor(() => expect(write.mock.calls).toEqual([['zh-CN'], ['en'], ['zh-CN']]));
});

it('cleanup removes the language listener and discards queued writes from the old session', async () => {
  let finish!: () => void;
  const first = new Promise<void>((resolve) => { finish = resolve; });
  const write = vi.fn(async () => { await first; return true; });
  surface.__heytaNativeWidgetBridge = bridge(write);
  startNativeWidgetLifecycle();
  await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  activateLocale('en'); await clearNativeWidgets(); activateLocale('zh-CN'); finish();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(write).toHaveBeenCalledTimes(1);
});

it('a failed native preference write does not block the next explicit selection', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const write = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  surface.__heytaNativeWidgetBridge = bridge(write);
  startNativeWidgetLifecycle();
  await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
  activateLocale('en');
  await vi.waitFor(() => expect(write).toHaveBeenCalledWith('en'));
});

it('a new session waits for the previous native write before committing its current language', async () => {
  let finish!: () => void;
  const first = new Promise<void>((resolve) => { finish = resolve; });
  const write = vi.fn().mockImplementationOnce(async () => { await first; return true; }).mockResolvedValue(true);
  surface.__heytaNativeWidgetBridge = bridge(write);
  startNativeWidgetLifecycle();
  await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  await clearNativeWidgets(); activateLocale('en'); startNativeWidgetLifecycle();
  await Promise.resolve(); expect(write).toHaveBeenCalledTimes(1);
  finish();
  await vi.waitFor(() => expect(write.mock.calls).toEqual([['zh-CN'], ['en']]));
});

it('browsers and earlier native ports without a preference method remain supported', () => {
  expect(startNativeWidgetLifecycle()).toBe(false);
  surface.__heytaNativeWidgetBridge = bridge();
  expect(startNativeWidgetLifecycle()).toBe(true);
  activateLocale('en');
});
