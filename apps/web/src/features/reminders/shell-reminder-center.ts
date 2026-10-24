/**
 * 原生壳的**通知中心腿** —— 把页侧的投递请求交给壳去弹系统通知
 * =============================================================
 *
 * ## 为什么需要这一层（不是"顺手支持一下"）
 *
 * macOS 的 WKWebView、Linux 的 WebKitGTK 与 Windows 的 WebView2 **都没有能用的
 * Web Notifications API**（前两家根本不实现它；WebView2 即便实现，弹出来的也不是
 * 装在系统里的这一枚应用的通知）。
 * 而在那三枚壳里跑的是真应用、真有到期提醒、真解密好的任务标题，
 * `apps/web/src/features/reminders/notify.ts` 的探测当场返回
 * `reason:'unsupported'` ⇒ **提醒永远不响**，界面上还一片正常。
 * 壳自己能弹的是**操作系统通知中心**（`UNUserNotificationCenter` /
 * freedesktop Notifications / WinUI `AppNotificationManager`），
 * 那些 API 只在原生侧存在。⇒ 投递这一米必须由页侧**问壳要一次**。
 *
 * 🔴 判据不分家：`哪几条到点`、`弹过没有`、`回执写不写`全在页侧那一份
 * （`notify.ts` + `packages/app-host` 的动作层）。本文件**一行都不判业务**，
 * 只做"把一条已经决定要弹的东西交给壳，并把壳的成败原样交回来"。
 *
 * ## 三壳共用的一条契约（两种回法）
 *
 * 页侧发 `{requestId, method, args}` 给壳注册的消息通道，接受**两种回法**：
 *
 * 1. **返回值就是 Promise** —— macOS 那枚处理器实现了
 *    `WKScriptMessageHandlerWithReply`，`postMessage` 直接回一个 Promise，本文件 await 它。
 * 2. **回调式 ack** —— Linux 的 WebKitGTK 消息处理器是单向的，Windows 的
 *    `chrome.webview.postMessage` 也是单向的（整页共用一根管道，没有 per-name 处理器）。
 *    壳弹完之后执行 `window.__heytaReminderAck(requestId, ok)`。
 *    本文件在 `postMessage` 返回值不是 Promise 时挂一个等 ack 的 Promise。
 *
 * 🔴 **两种回法都没等到 ⇒ 按"没投出去"算**（超时 ⇒ `false`），绝不按成功返回：
 * 返回 `true` 页侧就会写 `firedAt` 回执，而那条提醒**其实没响过** ——
 * 那是"假装交付"，比不响更糟。超时也不抛错：通知是增强，`notify.ts` 的契约是永不抛。
 */

import {
  browserNotificationCenter,
  type NotificationCapability,
  type NotificationRequestResult,
  type ReminderNotificationCenter,
} from './notify.js';

/** 壳注册的消息通道（`webkit.messageHandlers.<name>.postMessage` 那一形状）。 */
export interface ShellReminderChannel {
  postMessage(message: ShellReminderRequest): unknown;
}

export interface ShellReminderRequest {
  readonly requestId: string;
  readonly method: 'permission' | 'request' | 'openSettings' | 'show';
  readonly args: readonly unknown[];
  /**
   * 只在**共用管道**（WebView2：整页一根 `chrome.webview` 管道，没有 per-name 处理器）上带上：
   * 壳靠它把这一问分流到提醒腿，而不是当成 op-log 消息转发走。
   * WebKit 那两家的处理器本来就叫这个名字，多出这个字段无害。
   */
  readonly handler?: string;
}

/** 壳回不来时最多等多久。跨引擎一问一答，正常是毫秒级；到不了的就是"没回来"。 */
export const SHELL_REMINDER_REPLY_TIMEOUT_MS = 5_000;

/** 消息处理器名（三壳共用；新增一个要在 `widget-install.ts` 那份宿主信号登记表里同步）。 */
export const SHELL_REMINDER_HANDLER_NAME = 'heytaReminder';

/** 回调式回法的全局函数名（Linux 那条腿由壳执行）。 */
export const SHELL_REMINDER_ACK_GLOBAL = '__heytaReminderAck';

type Ack = (requestId: string, ok: unknown) => void;

/**
 * 这一腿**能不能用**由壳实际注入了什么说话：桥不在（浏览器 / PWA / Electron 过渡壳）
 * 就返回 `null`，调用方继续用浏览器那条腿。不做 UA 猜测 —— 与 `isNativeShellHost()` 同一口径。
 *
 * 两族壳各有各的消息管道，形状不同但**都只有 `postMessage(一条消息)` 这一个动作**：
 *
 * · WebKit 家（macOS `WKWebView` / Linux `WebKitGTK`）：
 *   `window.webkit.messageHandlers.<name>.postMessage`。macOS 那枚处理器实现了
 *   `WKScriptMessageHandlerWithReply` ⇒ `postMessage` 直接回 Promise（回法①）；
 *   WebKitGTK 的处理器是单向的 ⇒ 走 ack（回法②）。
 * · WebView2（Windows）：`window.chrome.webview.postMessage` 只有单向，
 *   且**没有 per-name 的处理器**（整页共用一根管道，壳按消息形状分流）
 *   ⇒ 一律走 ack（回法②）。`chrome.webview` 这个对象**只在 WebView2 里存在**，
 *   普通 Chrome 浏览器里没有，所以这条探测不会把浏览器误认成壳。
 */
export function detectShellReminderChannel(
  global: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
  handlerName: string = SHELL_REMINDER_HANDLER_NAME,
): ShellReminderChannel | null {
  const handlers = (global as { webkit?: { messageHandlers?: Record<string, unknown> } }).webkit?.messageHandlers;
  const found = handlers?.[handlerName] as ShellReminderChannel | undefined;
  if (typeof found?.postMessage === 'function') return found;

  const webview2 = (global as { chrome?: { webview?: { postMessage?: unknown } } }).chrome?.webview;
  if (typeof webview2?.postMessage === 'function') {
    const send = webview2.postMessage as (message: unknown) => void;
    // 包一层做两件事：① 返回值原样交出（undefined ⇒ askShell 退到 ack 那一支，
    // 不在这伪造 Promise）；② 补上 `handler` 那枚分流依据 —— 这根管道是整页共用的，
    // 壳那边要认得出"这一条归提醒腿，不是 op-log 消息"。
    return {
      postMessage: (message) => send({ ...message, handler: handlerName }),
    };
  }
  return null;
}

/**
 * 把一条消息交出去并拿回结果：先试 Promise 回法，再退到 ack 回法。
 *
 * ⚠️ 抽成单独一个函数是因为**两支都得能红**：注入一个假的通道就能分别测
 * "回一个 `false`"、"永远不 ack"、"ack 一个非布尔值"、"ack 的是别人的 requestId"
 * 四种形状，而不必真起一枚壳。
 */
export function askShell(
  channel: ShellReminderChannel,
  request: ShellReminderRequest,
  options: {
    readonly global?: Record<string, unknown>;
    readonly timeoutMs?: number;
  } = {},
): Promise<unknown> {
  const global = options.global ?? (globalThis as unknown as Record<string, unknown>);
  const timeoutMs = options.timeoutMs ?? SHELL_REMINDER_REPLY_TIMEOUT_MS;

  const replied = channel.postMessage(request);
  if (isPromiseLike(replied)) return replied;

  return new Promise<unknown>((resolve) => {
    const previous = global[SHELL_REMINDER_ACK_GLOBAL] as Ack | undefined;
    let installed = true;
    const settle = (value: unknown): void => {
      if (!installed) return;
      installed = false;
      if (global[SHELL_REMINDER_ACK_GLOBAL] === handler) global[SHELL_REMINDER_ACK_GLOBAL] = previous;
      resolve(value);
    };
    const handler: Ack = (requestId, ok) => {
      // 之前挂着的 ack（别的请求的、或壳自己的别的用途）先转一手，不把它顶掉。
      previous?.(requestId, ok);
      if (requestId === request.requestId) settle(ok);
    };
    global[SHELL_REMINDER_ACK_GLOBAL] = handler;
    // 超时那一支不抛：通知是增强，"问不出结果"如实算成"没投出去"。
    if (typeof global['setTimeout'] === 'function') {
      (global['setTimeout'] as (fn: () => void, ms: number) => unknown)(() => settle(false), timeoutMs);
    }
  });
}

const isPromiseLike = (value: unknown): value is Promise<unknown> =>
  typeof (value as Promise<unknown> | undefined)?.then === 'function';

/** 壳的词表与页侧同源；认不出的值算 `unsupported`（"读不到"不等于"被拒"）。 */
const asCapability = (value: unknown): NotificationCapability =>
  value === 'granted' || value === 'denied' || value === 'default' ? value : 'unsupported';

/** `true` 只认字面 `true`：壳返回 `undefined`/`null`/字符串时按没投出去算。 */
const asBoolean = (value: unknown): boolean => value === true;

let counter = 0;
const nextRequestId = (): string => {
  counter += 1;
  return `${Date.now()}-${counter}`;
};

/**
 * 壳那条腿。`channel` 为 `null` 时**不要**用它 —— 用 `resolveReminderCenter()`。
 *
 * `options.global` 是给 ack 那一支用的**定时器与回调所在处**（测试注入假计时器用），
 * 真壳里就是页面全局 —— ack 是壳执行 `evaluateJavaScript` 落进来的，落在哪个全局上
 * 就必须从哪个全局上取，写死 `globalThis` 会在别的装配形状下静默等不到。
 */
export function shellNotificationCenter(
  channel: ShellReminderChannel,
  options: { readonly global?: Record<string, unknown>; readonly timeoutMs?: number } = {},
): ReminderNotificationCenter {
  const ask = (method: ShellReminderRequest['method'], args: readonly unknown[] = []): Promise<unknown> =>
    askShell(channel, { requestId: nextRequestId(), method, args }, options);

  return {
    kind: 'shell',
    permission: () => ask('permission').then(asCapability),
    request: async () => {
      const value = await ask('request');
      return value === 'granted' || value === 'denied' || value === 'default' || value === 'unsupported'
        ? value
        : 'error';
    },
    openSettings: () => ask('openSettings').then(asBoolean),
    show: ({ id, title, body }) => ask('show', [id, title, body]).then(asBoolean),
  };
}

/**
 * 该用哪条腿：壳在就用壳的，否则用浏览器的 `Notification`。
 *
 * 🔴 顺序是有意的：**壳优先**。WebView2 里 Web Notifications 也可能同时可用，
 * 而那时 `new Notification()` 弹的是 WebView 自己的通知（受 WebView 权限与宿主
 * 窗口生命周期摆布），不是应用装在系统里的那一枚 —— 用户在一枚桌面应用里
 * 收到的应该是**系统通知中心**里那条。
 */
export function resolveReminderCenter(
  global: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): ReminderNotificationCenter {
  const channel = detectShellReminderChannel(global);
  if (channel !== null) return shellNotificationCenter(channel, { global });
  return browserNotificationCenter(global['Notification'] as never);
}
