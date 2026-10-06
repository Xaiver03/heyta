/**
 * 「零出站」的两支探针（真浏览器 · 单一所有者）
 * =============================================
 *
 * 现在有两处在数"零出站"：
 *
 * | 用例 | 数的是哪一段 |
 * |---|---|
 * | `privacy-consent-zero-egress.spec.ts` | 同意之前整趟启动 |
 * | `countdown-export.spec.ts` | 点「导出成品图」到文件落地那一段 |
 *
 * 🔴 分类规则**必须只有一份**：抄两份的话一侧加了新类别（比如又冒出一条要走 `/api/`
 * 的路径），另一侧继续按旧规则数"零"，两边都报绿 —— 而那正是"承诺悄悄变宽"的形状。
 * 抽出来的收尾动作是**删掉旧的那份**（AGENTS §3.5 那条教训：抽取的收尾不是写一份更好的）。
 *
 * ## 为什么"零"要配一支**页内**计数器
 *
 * `page.on('request')` 数的是**浏览器真发出去的**（CDP Network 域）。只看它就宣布"零"
 * 有一个洞：`page.route` / Service Worker 命中缓存都会**吃掉**请求，那时分类器收到 0 条,
 * 而页面确实调了 `fetch` —— 那不是"零出网"，那是"探针看不见"。
 * 于是再挂一支**页内**计数器（`addInitScript` 包 `fetch` / `XHR` / `WebSocket` /
 * `sendBeacon`），两支同时要求为零：
 *
 * - 页内不为零而分类器为零 ⇒ 有东西把请求吞了 ⇒ **红**（不许静默通过）。
 * - 分类器不为零而页内为零 ⇒ 请求来自页面之外（SW 自己的脚本取回、浏览器预取）⇒
 *   不计入"这一趟发的"，但**必须打印出来让人看**（`outside` 那一条）。
 *
 * ⚠️ 页内计数器**读不到就抛**，不返回一个 0：返回 0 会让"没装上探针"变成最漂亮的读数。
 */
import type { Page } from '@playwright/test';

export interface Egress {
  readonly url: string;
  readonly method: string;
}

export interface PageNetCounts {
  readonly fetch: number;
  readonly xhr: number;
  readonly ws: number;
  readonly beacon: number;
  readonly total: number;
  readonly urls: readonly string[];
}

/**
 * 开始记录出站请求。**必须在 `goto` 之前**挂上 —— 挂晚了收不到启动序列里那几条，
 * 而那正是这些套件要数的东西（Electron 那条同一个教训：监听挂晚了会得到"日志干净"）。
 *
 * 🔴 `origin` 由调用方从 `baseURL` fixture 传进来，不在这里现算：
 * `page.url()` 在第一条请求（document 本身）那一刻还是 `about:blank`，
 * 拿它当本源会把首页那一次算成"出站"，症状是**每条用例都红在第一条断言**。
 *
 * ## 什么算"出站"（分类必须显式，不然模块加载也算进去）
 *
 * 应用自己要加载 `index.html` / `/assets/*` / `/icons/*` / `manifest.webmanifest`，
 * 那些是**页面渲染**，不是"这台应用会不会跟服务端说话"。判据只数三类：
 * ① 任何**非本源**的请求；② `/api/*`；③ `/sw.js`（注册那一下的 fetch）。
 * 外加 `page.on('websocket')` —— 实时通道根本不走 `fetch`，漏了它等于没测第二条出口。
 */
export function trackEgress(
  page: Page,
  origin: string,
): { egress: Egress[]; sockets: string[] } {
  const egress: Egress[] = [];
  const sockets: string[] = [];
  const appOrigin = new URL(origin).origin;

  // 🔴 §6.2 规定一第 3 条：白屏/没反应的根因**几乎只在这里现形**。SW 注册失败就是
  // `register.ts` 里一句 `console.warn`，不收控制台只会得到"它没注册"这四个字。
  page.on('console', (message) => {
    if (message.type() !== 'warning' && message.type() !== 'error') return;
    console.log(`[browser ${message.type()}] ${message.text()}`);
  });
  page.on('pageerror', (error) => console.log(`[pageerror] ${error.message}`));

  page.on('request', (request) => {
    let url: URL;
    try {
      url = new URL(request.url());
    } catch {
      egress.push({ url: request.url(), method: request.method() });
      return;
    }
    if (url.origin !== appOrigin) {
      egress.push({ url: url.toString(), method: request.method() });
      return;
    }
    if (url.pathname === '/sw.js' || url.pathname.startsWith('/api/')) {
      egress.push({ url: url.pathname, method: request.method() });
    }
  });
  page.on('websocket', (socket) => sockets.push(socket.url()));

  return { egress, sockets };
}

/**
 * 装页内网络计数器。**同样必须在 `goto` 之前**调用（`addInitScript` 只对之后的导航生效）。
 *
 * 四支都被包一层：`fetch`、`XMLHttpRequest.open`、`WebSocket` 构造、`navigator.sendBeacon`。
 * 包法有两处是刻意的：
 *
 * - `WebSocket` 用 `Proxy` 的 `construct` 而不是自己写一个构造函数：后者要手工搬
 *   `CONNECTING/OPEN/CLOSING/CLOSED` 那几个静态量，漏一个就把 vite 的 HMR 客户端弄成
 *   "永远不等于 OPEN" —— 探针把自己测的对象弄坏，是最难查的一种假红。
 * - `sendBeacon` 只在**存在时**才包：不同浏览器/上下文里它可缺，无条件赋值会抛。
 */
export async function installInPageNetCounter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const counts = { fetch: 0, xhr: 0, ws: 0, beacon: 0, urls: [] as string[] };
    (window as unknown as { __htNet?: typeof counts }).__htNet = counts;
    const record = (kind: 'fetch' | 'xhr' | 'ws' | 'beacon', url: string): void => {
      counts[kind] += 1;
      // 只留前 100 条：溢出时 `readInPageNetCounts` 会把它当**前提不成立**报出来，
      // 而不是悄悄给一个"看起来对"的切片。
      if (counts.urls.length < 100) counts.urls.push(`${kind} ${url}`);
    };

    const originalFetch = window.fetch;
    window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const target =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      record('fetch', String(target));
      return originalFetch.call(window, input, init);
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (...args: unknown[]): void {
      record('xhr', `${String(args[0] ?? 'GET')} ${String(args[1] ?? '')}`);
      (originalOpen as (...rest: unknown[]) => void).apply(this, args);
    };

    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = new Proxy(OriginalWebSocket, {
      construct(target, args): WebSocket {
        record('ws', String(args[0] ?? ''));
        return new target(args[0] as string, args[1] as string | string[] | undefined);
      },
    }) as unknown as typeof WebSocket;

    if (typeof navigator.sendBeacon === 'function') {
      const originalBeacon = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = ((url: string | URL, data?: BodyInit | null): boolean => {
        record('beacon', String(url));
        return originalBeacon(url as string, data as BodyInit);
      }) as typeof navigator.sendBeacon;
    }
  });
}

/** 读页内计数器。**读不到就抛**（见文件头那条：返回 0 会把"探针没装上"读成最干净的结果）。 */
export async function readInPageNetCounts(page: Page): Promise<PageNetCounts> {
  return page.evaluate(() => {
    const store = window as unknown as
      | { __htNet?: { fetch: number; xhr: number; ws: number; beacon: number; urls: string[] } }
      | undefined;
    const counts = store?.__htNet;
    if (counts === undefined) {
      throw new Error('页内网络计数器没有装上（`installInPageNetCounter` 在 goto 之后才调用？）');
    }
    return {
      fetch: counts.fetch,
      xhr: counts.xhr,
      ws: counts.ws,
      beacon: counts.beacon,
      total: counts.fetch + counts.xhr + counts.ws + counts.beacon,
      urls: counts.urls.slice(),
    };
  });
}

/**
 * SW 的注册状态。返回值一律**要求匹配** `/installing|waiting|active/` 才算"注册上了"，
 * 而不是判它非 null —— 因为 `'NO_SW_SUPPORT'` 也非 null，
 * 用它做正向对照会让那条"零"重新变成恒真（浏览器不支持 SW 时整套照样绿）。
 */
export async function swState(page: Page): Promise<string> {
  return page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'NO_SW_SUPPORT';
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return 'NONE';
    return [
      registration.installing ? 'installing' : '',
      registration.waiting ? 'waiting' : '',
      registration.active ? 'active' : '',
    ]
      .filter(Boolean)
      .join('+');
  });
}
