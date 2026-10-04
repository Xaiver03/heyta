/**
 * 宿主注入的存储端口（`window.__heytaHostStoragePort`）里那份明文的销毁。
 * ==========================================================
 *
 * ## 为什么这一发要存在
 *
 * macOS / Windows 原生壳在页加载**之前**注入这个端口，页侧探测到它就不建
 * IndexedDB / OPFS 库，op-log 全部经线码端口落进**壳自己的** `heyta.sqlite`
 * （`apps/desktop-macos/Sources/HeytaMac/ShellStorageHost.swift` 的 `portShim`）。
 * 于是本机明文住在另一个 realm 的引擎里：
 *
 * · 页侧的销毁器（`eraseWebLocalData`）清的是 WebView 自己那几类，**碰不到**它；
 * · 壳侧那份 `registerLocalEraser` 即便注册了也**跨不过 realm**（注册表是模块级单例）；
 * · `ACCOUNT_CLOSED` 的触发点在页侧的 `SyncClient`。
 *
 * ⇒ 剩下的通道只有这个端口本身。这里就是那条通道上页侧的**发信方**。
 *
 * ## 为什么它不共用 `handleOpLogWorkerRequest`
 *
 * 那个函数的实参是 `OpLogStore`，而销毁是**适配器**上的动作（`OpLogStore` 接口上
 * 没有 `destroy` —— 与 `close` 同一个原因，见 `db.types.ts:257`）。所以这一发和
 * `oplog-hello` 一样是"壳自己认的一条"，收信方在 `native-bridge.ts`。
 *
 * ⚠️ 两端各一处认法 = 一处漂移点。所以判据里有一条**同时**读收发两侧的
 * `packages/app-host/tests/host-storage-erasure.spec.ts`（只改一边必红）。
 */

import { createOpLogWirePort, type DbDestroyReport, type OpLogWirePort } from '@heyta/storage';

/** 这一档凭据的 `target`：端口不认识库路径，页侧只能报"经哪个通道销毁的"。 */
export const HOST_STORAGE_PORT_TARGET = 'host-storage-port';

/**
 * 等回包的上限。壳侧的处理是**同步的 JSContext 调用**，正常情况一拍就回，
 * 所以这个值只在"端口对面根本不认识这一发"时生效（旧版壳 + 新版页）。
 *
 * 🔴 它**必须**有界：没有超时的话，销毁会永远挂在那里，而 `SyncClient` 是在
 * `await eraseLocalData()` 之后才写"已清除"状态的 —— 表现是注销界面卡在转圈，
 * 而不是"没清干净"。
 */
const DESTROY_WAIT_MS = 5_000;

function hostStoragePort(): OpLogWirePort | undefined {
  // React Native 也定义了 `global.window`，所以这里判的是"端口在不在"，不是"像不像浏览器"。
  const win = (globalThis as { window?: { __heytaHostStoragePort?: OpLogWirePort } }).window;
  return win?.__heytaHostStoragePort;
}

const unreadable = (reason: string): DbDestroyReport => ({
  target: HOST_STORAGE_PORT_TARGET,
  containerRemoved: false,
  reason,
  storesCleared: 0,
});

function isDestroyReport(value: unknown): value is DbDestroyReport {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.target === 'string' &&
    typeof record.containerRemoved === 'boolean' &&
    typeof record.storesCleared === 'number'
  );
}

/**
 * 向宿主端口要一次销毁，并**如实**交回一份凭据（拿不到就交回一条 `false` 带原因）。
 *
 * 没有这个端口时返回**空数组**，不是"报告一条失败" —— 这个不对称是有意的：
 * Web / node-host / 移动端没有这一档存储，凭空报一条 `containerRemoved:false`
 * 会让"这台设备清到了哪一层"的账多一行假的洞。
 */
export function eraseHostStoragePortData(): Promise<DbDestroyReport[]> {
  const raw = hostStoragePort();
  if (raw === undefined) return Promise.resolve([]);

  /**
   * 🔴 只走 `addEventListener`，**不许占用单槽 `onmessage`**。
   *
   * 这个端口是与正在跑的应用**共用**的：`createWorkerOpLogSession` 已经挂了接收方
   * （`oplog-worker-bridge.ts:289` 的注释就写着"`onmessage` 是单槽的，被覆盖就静默
   * 失去接收能力"）。用它意味着销毁那一下恰好把引擎的接收能力摘掉 ——
   * 症状是"注销之后写入静默丢失"，比不清还难查。
   */
  if (typeof raw.addEventListener !== 'function') {
    return Promise.resolve([unreadable('host-port-single-slot-receiver')]);
  }

  const port = createOpLogWirePort(raw);

  return new Promise<DbDestroyReport[]>((resolve) => {
    let settled = false;
    const finish = (report: DbDestroyReport): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve([report]);
    };
    const timer = setTimeout(() => finish(unreadable('host-port-silent')), DESTROY_WAIT_MS);

    port.addEventListener?.('message', (event) => {
      const data = event.data;
      if (
        data === null ||
        typeof data !== 'object' ||
        !('type' in data) ||
        (data as { type?: unknown }).type !== 'oplog-destroyed'
      ) {
        return; // 共用端口上的其它消息（ready、逐请求响应）与这一发无关
      }
      const report = (data as { report?: unknown }).report;
      finish(isDestroyReport(report) ? report : unreadable('host-port-report-unreadable'));
    });

    try {
      port.postMessage({ type: 'oplog-destroy' });
    } catch {
      // 端口已经断了（壳已退出 / WebView 正在卸载）—— 那也要留下一条凭据，不能不结。
      finish(unreadable('host-port-post-failed'));
    }
  });
}
