/**
 * 测试用的"宿主注入端口"：一对**裸 JSON** 端口（刻意不带线码），
 * 形状与 WebView / WKWebView 那条边界一致 —— 每一次 `postMessage` 都过一遍
 * `JSON.parse(JSON.stringify(...))`，所以 `Map`/`Set`/函数都过不去。
 *
 * ⚠️ 线码那半边不在这里判：`createOpLogWirePort` / `serveOpLogWorker` 用的是生产同一份。
 */
export function rawJsonPortPair() {
  const pageListeners: Array<(e: { data: unknown }) => void> = [];
  let shellOnMessage: ((e: { data: unknown }) => void) | null = null;
  const roundTrip = (m: unknown): unknown => JSON.parse(JSON.stringify(m)) as unknown;

  const pageSide = {
    postMessage(message: unknown): void {
      const wire = roundTrip(message);
      queueMicrotask(() => shellOnMessage?.({ data: wire }));
    },
    addEventListener(_t: string, l: (e: { data: unknown }) => void): void {
      pageListeners.push(l);
    },
  };
  const shellSide = {
    postMessage(message: unknown): void {
      const wire = roundTrip(message);
      queueMicrotask(() => {
        for (const l of pageListeners) l({ data: wire });
      });
    },
    get onmessage(): ((e: { data: unknown }) => void) | null {
      return shellOnMessage;
    },
    set onmessage(v: ((e: { data: unknown }) => void) | null) {
      shellOnMessage = v;
    },
  };
  return { pageSide, shellSide };
}

export type HostWindow = Window & { __heytaHostStoragePort?: unknown; __heytaStorage?: unknown };
