import { createNativeWidgetSession, planWidgetPublish, type NativeWidgetBridge } from '@heyta/app-host';
import { currentState, onEngineChange } from './oplog.js';
import { useFocusStore } from '../features/focus/store.js';
import { widgetDrainTasks } from '../features/tasks/store.js';
import { currentLocale, subscribeLocale } from './locale.js';

type WidgetWindow = Window & { __heytaNativeWidgetBridge?: NativeWidgetBridge };
let running: ReturnType<typeof createNativeWidgetSession> | undefined;
let unsubscribe: (() => void) | undefined;
// Serialize preference IO across session restarts too: an older in-flight native
// call must finish before the new session writes the current device language.
let localeFlight = Promise.resolve();

export function nativeWidgetBridge(): NativeWidgetBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  const bridge = (window as WidgetWindow).__heytaNativeWidgetBridge;
  return bridge && ['sealWidgetSnapshot', 'setWidgetSnapshot', 'drainIntentQueue', 'ackIntentQueue', 'mergeIntentQueue', 'clearWidgetState']
    .every((key) => typeof (bridge as unknown as Record<string, unknown>)[key] === 'function') ? bridge : undefined;
}

/** Called only after op-log hydration. Normal browsers continue to use the PWA path. */
export function startNativeWidgetLifecycle(): boolean {
  const bridge = nativeWidgetBridge();
  if (!bridge) return false;
  if (running) return true;
  const read = () => ({ state: currentState(), focus: useFocusStore.getState().state });
  const session = createNativeWidgetSession({ bridge, read, tasks: widgetDrainTasks,
    onError: (error) => console.warn('[widget] Native desktop widget refresh failed', error) });
  running = session;
  // Keep rapid language selections in order across asynchronous native IO. The
  // independent device preference lets extensions wake without launching the app.
  const syncLocale = (locale: ReturnType<typeof currentLocale>) => {
    localeFlight = localeFlight.then(async () => {
      if (running !== session || !bridge.setWidgetLocale) return;
      if (!await bridge.setWidgetLocale(locale)) throw new Error('Native widget locale rejected');
    }).catch((error: unknown) => console.warn('[widget] Native widget locale update failed', error));
  };
  const stopLocale = subscribeLocale(syncLocale);
  syncLocale(currentLocale());
  const publish = () => { void session.refresh(false); };
  const wake = () => { if (document.visibilityState !== 'hidden') void session.refresh(); };
  const intent = () => { void session.refresh(); };
  const stopEngine = onEngineChange(publish);
  const stopFocus = useFocusStore.subscribe((state, previous) => {
    if (state.state !== previous.state) publish();
  });
  let midnight: ReturnType<typeof setTimeout>;
  const scheduleMidnight = () => {
    const now = Date.now();
    midnight = setTimeout(() => { publish(); scheduleMidnight(); },
      Math.max(1, planWidgetPublish({ ...read(), now }).validUntil - now));
  };
  scheduleMidnight();
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('focus', wake);
  window.addEventListener('heyta:widget-intents', intent);
  unsubscribe = () => {
    stopEngine(); stopFocus(); stopLocale(); clearTimeout(midnight);
    document.removeEventListener('visibilitychange', wake);
    window.removeEventListener('focus', wake);
    window.removeEventListener('heyta:widget-intents', intent);
    session.stop();
  };
  void session.refresh();
  return true;
}

/** Removal must finish before deleting the app database, so queued clicks cannot recreate data. */
export async function clearNativeWidgets(): Promise<void> {
  unsubscribe?.(); unsubscribe = undefined;
  const session = running; running = undefined;
  if (session) await session.clear();
  else {
    const bridge = nativeWidgetBridge();
    if (bridge && !await bridge.clearWidgetState()) throw new Error('Native widget state could not be cleared');
  }
}
