/** Recheck a browser Cookie session when a background tab becomes active. */
export function installCentralSessionRecheck(ports: {
  networkAllowed(): boolean;
  hasCookieSession(): boolean;
  recheck(): Promise<void>;
}): () => void {
  let inFlight = false;
  let disposed = false;
  const onActive = (): void => {
    if (disposed || document.visibilityState !== 'visible' || !ports.networkAllowed() ||
        !ports.hasCookieSession() || inFlight) return;
    inFlight = true;
    void Promise.resolve().then(() => ports.recheck()).catch(() => {
      // Unknown network errors are not proof of logout. The next focus retries.
    }).finally(() => { inFlight = false; });
  };
  document.addEventListener('visibilitychange', onActive);
  window.addEventListener('focus', onActive);
  return () => {
    disposed = true;
    document.removeEventListener('visibilitychange', onActive);
    window.removeEventListener('focus', onActive);
  };
}
