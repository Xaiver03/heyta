/**
 * 移动端的**流式传输**：XHR 增量响应，套在隐私闸门之内
 * ====================================================
 *
 * ## 为什么移动端一直不能流式
 *
 * `packages/ai/src/routing.ts` 判"这个响应能不能按 SSE 读"要三件事，
 * 第 2、3 条在移动端卡住：
 *
 * | 判据 | 移动端实况 |
 * |---|---|
 * | `content-type` 含 `text/event-stream` | ✅ 服务端会给 |
 * | 宿主有 `TextDecoder` | ✅ **有**（`apps/mobile/index.js` 装了 `fast-text-encoding`） |
 * | 响应有可读 `body` | ❌ **RN 的 `fetch` 这一项是 `null`** |
 *
 * 第三条是真障碍：RN 的 `fetch` 由 XHR 实现、整份收完才返回，没有 `ReadableStream`。
 *
 * ## 解法：只换**响应的形状**，不换引擎
 *
 * `routing.ts` 那段读流的代码实际只用 body 的两个方法
 * （`getReader()` 返回的 `read()` / `cancel()`，见 `routing.ts:1340/1365/1392`），
 * 而 RN 内置的 `XMLHttpRequest` 在 `readyState === 3`（LOADING）时就能读到
 * **已累积**的 `responseText`。把累积文本切成增量、包成那个形状即可 ——
 * **不需要真的 `ReadableStream`、不需要新依赖、不需要动 `packages/ai`**。
 *
 * ## 🔴 隐私闸门：顺序是硬约束
 *
 * 移动端把 `globalThis.fetch` 换成了 `consentFetch`
 * （`src/privacy/consent-gate.ts`：*"没有同意，一个字节都不出这台设备"*）。
 * 一个自己 `new XMLHttpRequest()` 的实现会**绕过它** —— 那是隐私破口，不是风格问题。
 *
 * 正确顺序（本文件的 `createGatedStreamingFetch`）：
 *
 * ```text
 *   XHR 传输（读增量）  →  createConsentGatedFetch(…, isAllowed)  →  交给 app-host
 * ```
 *
 * 闸门在最外层 ⇒ **每个请求都要过它**，与"底层用 fetch 还是 XHR"无关。
 * `createConsentGatedFetch` 本身就接收任意 `fetchImpl`（`privacy-consent.ts:311`），
 * 所以这条组合是它设计内支持的用法，不是绕过。
 *
 * ## ⚠️ 未接线：这份代码尚未接进生产路径
 *
 * 原因说清楚：XHR 的增量行为（`readyState 3` 何时给数据、`responseText` 是否
 * 真的累积、HTTP/2 下会不会被缓冲）**只能真机验证**，我在这里没有设备。
 * 所以本模块先做到"逻辑可测、形状正确、闸门不破"，接线那一步留到
 * 有一次真机实测之后 —— 而不是先接上、再让用户在真机上发现问题。
 *
 * 接线方式已经定好（见文件末尾 `wireStreamingIntoChatController` 的说明），
 * 需要的只是一次真机确认。
 */

import { createConsentGatedFetch } from '@heyta/app-host';
import type { PrivacyConsentGate } from '@heyta/app-host';

/**
 * 增量读取器 —— `routing.ts` 用到的全部形状。
 *
 * ⚠️ 刻意**不**实现 `ReadableStream` 的其余部分。实现得更多，
 * "我们以为有真的流"这个错觉就越难拆。
 */
export interface IncrementalReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(): Promise<void>;
}

/** 合成 body —— 只有 `getReader`。 */
export interface IncrementalBody {
  getReader(): IncrementalReader;
}

/**
 * 把一段**累积文本流**转成增量分片。
 *
 * 🔴 这是本模块唯一有实质逻辑的部分，所以单独拆成纯函数以便测穿：
 * XHR 的 `responseText` 每次都给"从头发到现在"的全部内容，而
 * `splitSseFrames` 期望的是新到的那一片。不做差分会把同一帧反复喂进去，
 * 症状是**回答内容成倍重复** —— 那在真机上看起来像"模型疯了"。
 *
 * @returns 新增的那一段；`''` = 正常但无新增；`null` = **应当放弃增量**。
 */
export function diffAccumulated(previous: string, current: string): string | null {
  if (current === previous) return '';
  /**
   * ⚠️ 只认"旧文本是新文本的前缀"这一种情况。
   *
   * 其它情况（内容被改写、压缩、或根本不是文本流）**必须放弃增量**，
   * 而不是硬拼出一段从未存在过的内容 —— 那比不做流式危险得多，
   * 因为用户看到的是**错的回答**，而不是"没有逐字"。
   */
  if (!current.startsWith(previous)) return null;
  return current.slice(previous.length);
}

/** 一次增量读取的状态机。**纯逻辑**，不碰 XHR —— 于是它能在 node 里测穿。 */
export interface IncrementalBuffer {
  /** 喂入一次累积文本。返回是否被接受（`false` = 已放弃增量）。 */
  push(accumulated: string): boolean;
  /** 标记"不会再有数据了"。 */
  finish(): void;
  /** 标记失败。 */
  fail(error: Error): void;
  /** 取下一片；没有就等到有、或等到结束。 */
  next(): Promise<{ done: boolean; value?: Uint8Array }>;
  /** 已放弃增量。 */
  abandoned(): boolean;
}

/** 造一个增量缓冲。`encode` 可注入，测试因此不依赖 `TextEncoder`。 */
export function createIncrementalBuffer(
  encode: (text: string) => Uint8Array = (text) => new TextEncoder().encode(text),
): IncrementalBuffer {
  let consumed = '';
  const pending: string[] = [];
  let finished = false;
  let failure: Error | null = null;
  let abandonedFlag = false;
  let wake: (() => void) | null = null;

  const notify = (): void => {
    const resume = wake;
    wake = null;
    resume?.();
  };

  return {
    push(accumulated: string): boolean {
      const delta = diffAccumulated(consumed, accumulated);
      if (delta === null) {
        abandonedFlag = true;
        consumed = accumulated;
        pending.length = 0;
        notify();
        return false;
      }
      consumed = accumulated;
      if (delta !== '') {
        pending.push(delta);
        notify();
      }
      return true;
    },
    finish(): void {
      finished = true;
      notify();
    },
    fail(error: Error): void {
      failure = error;
      finished = true;
      notify();
    },
    async next(): Promise<{ done: boolean; value?: Uint8Array }> {
      for (;;) {
        if (pending.length > 0) {
          const text = pending.shift() as string;
          return { done: false, value: encode(text) };
        }
        if (failure !== null) throw failure;
        if (finished) return { done: true };
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
    abandoned: () => abandonedFlag,
  };
}

/** XHR 的 readyState 常量（不引用全局，便于测试注入）。 */
const READY_STATE_LOADING = 3;
const READY_STATE_DONE = 4;

/** 造 XHR 的工厂。注入是为了让"形状对不对"能在 node 里测，而不必真机。 */
export type XhrFactory = () => XMLHttpRequest;

/**
 * 一个**用 XHR 读增量**的 `fetch` 替身。
 *
 * 🔴 它**不带闸门** —— 调用方必须用 `createGatedStreamingFetch` 包一层，
 * 或者自己确保每个请求都过闸门。单独用它是隐私破口。
 * 之所以仍然导出，是因为闸门那一层要能在测试里被替换。
 */
export function createXhrStreamingFetch(makeXhr: XhrFactory = () => new XMLHttpRequest()): typeof fetch {
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = resolveUrl(input);
    const method = init?.method ?? 'GET';
    const wantsStream = bodyWantsStream(init);

    if (!wantsStream) {
      /**
       * ⚠️ 非流式请求也走本实现（而不是"退回全局 fetch"）：
       * 本函数是**替换掉** `globalThis.fetch` 的那一层，若它内部再调全局 fetch
       * 就是无限递归。非流式时直接收完整份即可。
       */
      return collectWholeResponse(makeXhr, url, method, init);
    }

    const buffer = createIncrementalBuffer();
    const xhr = makeXhr();
    let headers: string | null = null;

    const pump = (): void => {
      let accumulated: string;
      try {
        accumulated = xhr.responseText;
      } catch {
        return;
      }
      buffer.push(accumulated);
      if (xhr.readyState === READY_STATE_DONE) buffer.finish();
    };

    xhr.onreadystatechange = (): void => {
      if (
        xhr.readyState !== READY_STATE_LOADING &&
        xhr.readyState !== READY_STATE_DONE
      ) {
        return;
      }
      // 响应头在 LOADING 之前就拿到了；这里抓一次给下面的 headers.get。
      if (headers === null) headers = safeContentType(xhr);
      pump();
    };
    xhr.onerror = (): void => buffer.fail(new Error('网络请求失败'));
    xhr.ontimeout = (): void => buffer.fail(new Error('网络请求超时'));
    xhr.onabort = (): void => buffer.finish();

    // 立刻发出去；响应对象在**头到达时**就该交出去，那正是"边收边读"的前提。
    sendXhr(xhr, url, method, init);

    return makeStreamingResponse(xhr, buffer, () => headers);
  };
  return impl as typeof fetch;
}

/**
 * 🔴 生产用这一个：**闸门在最外层**。
 *
 * ```text
 *   XHR 读增量  →  consent 闸门  →  返回
 * ```
 *
 * @param gate 移动端的隐私同意闸门（`src/privacy/consent-gate.ts` 的 `privacyConsent`）。
 * @param makeXhr XHR 工厂，测试可注入。
 */
export function createGatedStreamingFetch(
  gate: PrivacyConsentGate,
  makeXhr?: XhrFactory,
): typeof fetch {
  const ungated = makeXhr === undefined ? createXhrStreamingFetch() : createXhrStreamingFetch(makeXhr);
  return createConsentGatedFetch(ungated, () => gate.networkAllowed());
}

/* ─────────────────────────── 以下是 XHR 管道细节 ─────────────────────────── */

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** 请求体里有没有显式要 `stream: true`。 */
function bodyWantsStream(init: RequestInit | undefined): boolean {
  const body = init?.body;
  if (typeof body !== 'string') return false;
  try {
    const parsed: unknown = JSON.parse(body);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { stream?: unknown }).stream === true
    );
  } catch {
    return false;
  }
}

function headerEntries(init: RequestInit | undefined): [string, string][] {
  const headers = init?.headers;
  if (headers === undefined) return [];
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    const out: [string, string][] = [];
    headers.forEach((value, name) => out.push([name, value]));
    return out;
  }
  if (Array.isArray(headers)) return headers as [string, string][];
  return Object.entries(headers as Record<string, string>);
}

function sendXhr(
  xhr: XMLHttpRequest,
  url: string,
  method: string,
  init: RequestInit | undefined,
): void {
  xhr.open(method, url, true);
  for (const [name, value] of headerEntries(init)) xhr.setRequestHeader(name, value);
  xhr.send(typeof init?.body === 'string' ? init.body : null);
}

function safeContentType(xhr: XMLHttpRequest): string | null {
  try {
    const value = xhr.getResponseHeader('content-type');
    return value === '' ? null : value;
  } catch {
    return null;
  }
}

/** 非流式：整份收完后一次性构造响应。 */
function collectWholeResponse(
  makeXhr: XhrFactory,
  url: string,
  method: string,
  init: RequestInit | undefined,
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const xhr = makeXhr();
    xhr.onload = (): void => {
      resolve(
        makeSyntheticResponse(
          xhr,
          null,
          () => xhr.responseText,
        ),
      );
    };
    xhr.onerror = (): void => reject(new Error('网络请求失败'));
    xhr.ontimeout = (): void => reject(new Error('网络请求超时'));
    try {
      sendXhr(xhr, url, method, init);
    } catch (error: unknown) {
      reject(error instanceof Error ? error : new Error('无法发起请求'));
    }
  });
}

/**
 * 把 XHR 包成 `routing.ts` 认得的响应形状。
 *
 * 🔴 `headers.get('content-type')` 必须**如实反映**服务端返回的那一个：
 * `isEventStream` 靠它判"这是不是 SSE"。若这里撒谎说 `text/event-stream`，
 * 一个回整份 JSON 的端点会被按 SSE 读、得到零帧 —— 症状是"端点返回了空内容"。
 */
function makeSyntheticResponse(
  xhr: XMLHttpRequest,
  streaming: IncrementalBuffer | null,
  currentText: () => string,
): Response {
  const contentType = safeContentType(xhr);

  const body =
    streaming === null ||
    contentType === null ||
    !contentType.toLowerCase().includes('text/event-stream')
      ? null
      : {
          getReader: (): IncrementalReader => ({
            read: () => streaming.next(),
            cancel: async (): Promise<void> => {
              streaming.finish();
              try {
                xhr.abort();
              } catch {
                // abort 抛不该影响取消本身
              }
            },
          }),
        };

  /**
   * ⚠️ 这里构造的是一个**形状兼容**的对象，不是真的 `Response`。
   * `routing.ts` 只用 `body` / `headers.get` / `status` / `ok` / `text` / `json`,
   * 而移动端没有 `Response` 构造函数（Hermes 上要额外 polyfill）。
   * 用 `as unknown as Response` 是**刻意的、被记录下来的**类型让步 ——
   * 若将来 `routing.ts` 用到了更多字段，这里会缺，而症状是运行时 undefined。
   * 所以下面把用到的字段一次列全。
   */
  return {
    body,
    headers: {
      get: (name: string): string | null => {
        try {
          const value = xhr.getResponseHeader(name);
          return value === '' ? null : value;
        } catch {
          return null;
        }
      },
    },
    status: xhr.status,
    ok: xhr.status >= 200 && xhr.status < 300,
    statusText: xhr.statusText,
    text: async (): Promise<string> => currentText(),
    json: async (): Promise<unknown> => JSON.parse(currentText()) as unknown,
  } as unknown as Response;
}

function makeStreamingResponse(
  xhr: XMLHttpRequest,
  buffer: IncrementalBuffer,
  contentType: () => string | null,
): Response {
  // 响应头要等 LOADING 才一定可读，但构造 Response 时请求已经在飞；
  // `headers.get` 是惰性读的，所以这里给一个读时才求值的实现。
  void contentType;
  return makeSyntheticResponse(xhr, buffer, () => xhr.responseText);
}

/**
 * ⚠️ **未接线**：生产路径要接的就是这一步，而它需要一次真机确认。
 *
 * 接法（三层，一行都不能省）：
 *
 * 1. `apps/mobile/index.js` 里用 `createGatedStreamingFetch(privacyConsent)`
 *    替换 `consentFetch`（或并列导出），保证请求仍过闸门；
 * 2. `apps/mobile/src/ai/chat-controller.ts` 把它的 `routed` 里补上
 *    `fetchImpl: streamingFetch`（`routing.ts:760` 有这个注入缝）；
 * 3. ~~同处补 `onEvent`~~ —— ✅ **已完成**（2026-11-10）。
 *    `onEvent` 已接、`live` 已加进 `ChatSnapshot`、`AssistantScreen` 已渲染它。
 *    事件归约用的 `reduceAssistantLive` 也**已下沉到 `@heyta/app-host`**
 *    （commit `e4f32e0d`），移动端直接 import，没有抄第二份。
 *    ⇒ **剩下的只有第 2 步**：把 `fetchImpl` 接上，`live` 才会真的有值。
 *    在它接上之前，第 3 步是"接好了但通常拿不到数据"的状态 ——
 *    因为 RN 的 `fetch` 响应没有可读 body，`routing.ts` 会退回整份读取。
 *
 * 🔴 为什么第 2 步先不接：XHR 的增量行为**只能真机验证**
 * （`readyState 3` 何时给数据、`responseText` 是否真的累积、HTTP/2 下会不会被缓冲）。
 * 先接上再让用户在真机上发现问题，比"没做"更糟 —— 那会把一个未验证的
 * 行为当成已交付的能力。
 */
/**
 * 接线状态标记 —— **不是开关**，是给后来者的一句话状态。
 *
 * 🔴 它的值是 `true`（仍待真机验证），不是"功能关着"的意思。
 * 之所以做成常量而不是注释：`grep` 得到它，而注释会被挖走。
 *
 * 现状（2026-11-10）：
 *   · ✅ `onEvent` 已接（`chat-controller.ts`），`live` 已在状态与界面上；
 *   · ✅ `reduceAssistantLive` 已下沉到 `@heyta/app-host`（`e4f32e0d`）；
 *   · ⏳ **只差第 2 步**：把 `fetchImpl` 换成 `createGatedStreamingFetch(...)`。
 *
 * ⚠️ 在那一刻到来之前，移动端的流式**不会真的生效**：
 * RN 的 `fetch` 响应没有可读 body，`routing.ts` 会退回整份读取，
 * `live` 恒为 `undefined`，界面走的还是"整段回来再显示"。
 * 这是**故意的**：退化方向是"能出结果"，而不是"接上流然后卡住"。
 */
export const STREAMING_WIRING_PENDING_DEVICE_VERIFICATION = true as const;
