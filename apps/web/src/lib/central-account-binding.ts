/**
 * Local data ownership for the official browser Cookie session. This record
 * is not a credential; it prevents a new Cookie subject from silently syncing
 * an existing local op-log after a reload or another tab's account switch.
 */
export const CENTRAL_ACCOUNT_BINDING_KEY = 'heyta.central.account-binding';

export type CentralBindingResult = 'bound' | 'mismatch' | 'unavailable';

/** Serialize the read/write pair across same-origin tabs. No Web Locks means no safe automatic login. */
export async function withCentralAccountBindingLock<T>(work: () => Promise<T> | T): Promise<T | undefined> {
  try {
    const locks = globalThis.navigator?.locks;
    if (!locks?.request) return undefined;
    return await locks.request('heyta-central-account-binding', { mode: 'exclusive' }, work);
  } catch {
    return undefined;
  }
}

export function centralAccountBindingSnapshot(): string | null | 'unavailable' {
  try { return globalThis.localStorage.getItem(CENTRAL_ACCOUNT_BINDING_KEY); }
  catch { return 'unavailable'; }
}

/** Call only from withCentralAccountBindingLock. */
export function bindCentralAccount(baseUrl: string, subject: string): CentralBindingResult {
  if (!/^[1-9][0-9]*$/.test(subject)) return 'unavailable';
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'unavailable';
    const binding = JSON.stringify({ origin: url.origin, subject });
    const storage = globalThis.localStorage;
    const current = storage.getItem(CENTRAL_ACCOUNT_BINDING_KEY);
    if (current !== null) return current === binding ? 'bound' : 'mismatch';
    storage.setItem(CENTRAL_ACCOUNT_BINDING_KEY, binding);
    return storage.getItem(CENTRAL_ACCOUNT_BINDING_KEY) === binding ? 'bound' : 'unavailable';
  } catch {
    // An unpersistable binding cannot protect the next browser restart.
    return 'unavailable';
  }
}

export function centralAccountBindingExists(): boolean {
  try { return globalThis.localStorage.getItem(CENTRAL_ACCOUNT_BINDING_KEY) !== null; }
  catch { return true; } // Unknown storage state must not release ownership.
}
