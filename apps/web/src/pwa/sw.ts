/**
 * heyta 的 service worker（Windows PWA widget 的宿主侧一半）。
 * ============================================================
 *
 * 这个文件由 `scripts/gen-pwa.mjs` 用 esbuild **打包**成 `public/sw.js`
 * （它 import `./sw-core.js` 与 `@heyta/widget-core`）。原因：
 * service worker 装在 `public/` 里就要用 URL 直接取，而它又需要共享包的代码 ——
 * 打包是唯一不重复实现的办法。**`public/sw.js` 是生成物，不要直接改。**
 *
 * ## 🔴 Windows 组件的刷新**不能**靠 Periodic Background Sync
 *
 * 已实测（见计划 §3.1）：Chromium 里 `kMinPeriodicSyncEventsInterval = base::Hours(12)`，
 * 实际间隔还要乘互动度系数（12/24/36 小时，或者**永不**），
 * 而且桌面端**没有 OS 级唤醒**（那段是 `#if IS_ANDROID`）→ **Edge 进程必须活着**。
 *
 * 于是"当日任务列表"只有一条路：**Web Push 把 SW 唤醒 → SW 调 `widgets.updateByTag`**。
 * 这不是优化，是这个平台上唯一可行的刷新路径 —— 用 PBS 的话，用户的组件
 * 会显示**半天前的任务列表**，而它看起来完全正常。这是本项目最反对的那类缺陷。
 *
 * ## 职责划分
 *
 * | 谁 | 干什么 |
 * |---|---|
 * | 页面 | 从物化状态算载荷 → 加密 → 算 **Adaptive Card 数据** → `postMessage` 给 SW |
 * | SW | 缓存数据、调 `updateByTag`、收点击写日志、把日志交给页面 drain |
 * | 组件宿主 | 拿模板 + 数据渲染，点击时发 `widgetclick` |
 *
 * 页面算数据而不是 SW 算，是因为**密钥在页面里**（不可导出的 `CryptoKey`），
 * 而且 Adaptive Card 宿主只吃明文 —— 详见 `sw-core.ts` 的 `WidgetDataMessage`。
 */

import type { AdaptiveCardKind } from '@heyta/widget-core';

import {
  SW_CLICK_LOG_MAX,
  appendClick,
  isRecordStale,
  kindFromTag,
  parsePageMessage,
  parseWidgetClick,
  widgetTag,
} from './sw-core.js';
import type { RawWidgetClick, WidgetDataRecord } from './sw-core.js';

/**
 * 组件数据文件的 URL 前缀（`/widgets/<kind>.data.json`）。
 * 与 `gen-pwa.mjs` 里 manifest 的 `data` 字段共用同一套拼法。
 */
const WIDGET_DATA_PREFIX = '/widgets/';
const WIDGET_DATA_SUFFIX = '.data.json';

/** 从 `data` 请求的路径里解出是哪一款组件的数据。不是数据请求则返回 null。 */
function kindFromDataPath(pathname: string): AdaptiveCardKind | null {
  if (!pathname.startsWith(WIDGET_DATA_PREFIX)) return null;
  const rest = pathname.slice(WIDGET_DATA_PREFIX.length);
  if (!rest.endsWith(WIDGET_DATA_SUFFIX)) return null;
  return kindFromTag(`heyta-${rest.slice(0, -WIDGET_DATA_SUFFIX.length)}`);
}

// ─────────────────────────────────────────────────────────────────────
// 最小的 self 类型（避免为一个文件把整个项目的 lib 改成 WebWorker）
// ─────────────────────────────────────────────────────────────────────

interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}
interface ClickEventLike extends ExtendableEventLike {
  action?: string;
  tag?: string;
  /** `Action.Execute` 的 `data`（Adaptive Card 模板里声明的东西）。 */
  data?: unknown;
}
interface PushEventLike extends ExtendableEventLike {
  data?: { json(): unknown; text(): string } | null;
}
interface MessageEventLike extends ExtendableEventLike {
  data?: unknown;
  ports?: readonly { postMessage(value: unknown): void }[];
}
interface FetchEventLike extends ExtendableEventLike {
  /**
   * ⚠️ 必须是真正的 `Request`，不能是 `{ method, url }` 这种最小形状 ——
   * `fetch(event.request)` 要的是 `RequestInfo`，一个手写的字面量类型
   * 缺 20 多个属性。**这里刻意不图省事**：`fetch` 处理器是"可安装性"的硬要求，
   * 而它编译不过时我第一反应会是去放宽类型而不是修对。
   */
  request: Request;
  respondWith(response: Promise<Response> | Response): void;
}
interface ClientLike {
  postMessage(value: unknown): void;
}
interface SwSelf {
  addEventListener(type: string, listener: (event: never) => void): void;
  skipWaiting(): Promise<void>;
  clients: {
    claim(): Promise<void>;
    matchAll(options?: unknown): Promise<ClientLike[]>;
  };
  registration: { scope: string };
  /** Edge 专有：更新组件。**Chrome 上不存在** —— 所以每次调用都要先判存在。 */
  widgets?: {
    updateByTag(tag: string, payload: { data: unknown }): Promise<void>;
  };
}

const sw = self as unknown as SwSelf;

// ─────────────────────────────────────────────────────────────────────
// IndexedDB（点击日志 + 每个 kind 的组件数据）
//
// ⚠️ 用 IndexedDB 而不是 `caches`：这两样都是**结构化数据**，
//    而 Cache API 存的是 Response，读回来要再解一次 JSON —— 多一层没有收益的编解码。
//    这里也**不用 localStorage**：service worker 里**没有** localStorage。
// ─────────────────────────────────────────────────────────────────────

const DB_NAME = 'heyta-widget';
const DB_VERSION = 1;
const STORE_CLICKS = 'clicks';
const STORE_DATA = 'data';
/**
 * 「最近一次收到推送的时刻」的存储键。**与四款组件的数据共用一个 object store**，
 * 但键名不是 `kind`（`today`/`quadrant`/…），所以不会被 `getWidgetRecord` 误读。
 */
const PUSH_MARKER_KEY = '__last_push_received_at';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_CLICKS)) {
        // `autoIncrement` 保证点击的**先后顺序**：合并是 last-wins，
        // 顺序错了结果就错了（同 Android 的 `at` 字段起同样作用，
        // 但这里顺序来自主键，不依赖时钟 —— 时钟会回拨）。
        db.createObjectStore(STORE_CLICKS, { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORE_DATA)) {
        db.createObjectStore(STORE_DATA);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB.open 失败'));
  });
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  body: (objectStore: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = body(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'));
        transaction.oncomplete = () => db.close();
      }),
  );
}

async function readClicks(): Promise<RawWidgetClick[]> {
  const all = await tx<RawWidgetClick[]>(STORE_CLICKS, 'readonly', (store) => store.getAll());
  return all ?? [];
}

/** 读-追加-写-裁剪。整体在一个读事务里，但 SW 是单线程的，不存在并发写。 */
async function recordClick(click: RawWidgetClick): Promise<void> {
  const current = await readClicks();
  const { log, dropped } = appendClick(current, click);

  if (dropped > 0) {
    // ⚠️ 丢弃是**有损**的，不能静默 —— 静默丢弃会让"我的点击偶尔不见了"
    //    变成一个无法归因的 bug（见 `sw-core.ts` 的 `appendClick`）。
    console.warn(`[heyta-sw] 点击日志超过上限，丢弃了 ${dropped} 条最早的点击`);
  }

  await writeClicks(log);
}

/** 整体覆写点击日志。**必须清空再加** —— 只 `add` 会让日志无限增长。 */
async function writeClicks(next: readonly RawWidgetClick[]): Promise<void> {
  await tx(STORE_CLICKS, 'readwrite', (store) => store.clear());
  for (const entry of next) {
    await tx(STORE_CLICKS, 'readwrite', (store) => store.add(entry));
  }
}

async function drainClicks(): Promise<RawWidgetClick[]> {
  const all = await readClicks();
  await tx(STORE_CLICKS, 'readwrite', (store) => store.clear());
  return all;
}

async function putWidgetData(record: WidgetDataRecord): Promise<void> {
  await tx(STORE_DATA, 'readwrite', (store) => store.put(record, record.kind));
}

async function getWidgetRecord(kind: AdaptiveCardKind): Promise<WidgetDataRecord | undefined> {
  return tx<WidgetDataRecord | undefined>(STORE_DATA, 'readonly', (store) => store.get(kind));
}

// ─────────────────────────────────────────────────────────────────────
// 更新组件
// ─────────────────────────────────────────────────────────────────────

/**
 * 把数据推给某一款组件。
 *
 * 🔴 两个必须处理的边界：
 *
 * 1. **`self.widgets` 在 Chrome 上不存在** —— `widgets` manifest 成员不在 W3C 规范、
 *    也不在 Chromium 源码里（实测 grep 0 命中），它是 Edge 专有。所以判存在是必需的，
 *    不能假设有。**Chrome 用户拿不到组件**，这是能力边界不是 bug。
 * 2. **`updateByTag` 会 reject** —— tag 没注册、或者没有那个组件实例。
 *    不 catch 的话会变成一个未处理的 promise rejection，症状是**什么都没发生**。
 */
async function pushWidgetData(kind: AdaptiveCardKind, data: unknown): Promise<boolean> {
  const api = sw.widgets;
  if (!api) {
    console.info('[heyta-sw] 这个浏览器不支持 PWA 组件（Edge 专有），跳过刷新');
    return false;
  }
  try {
    await api.updateByTag(widgetTag(kind), { data });
    return true;
  } catch (error) {
    // 最可能的原因：用户还没把这款组件加到桌面上。**正常情况**，不是错误。
    console.info(`[heyta-sw] updateByTag(${widgetTag(kind)}) 未生效：${String(error)}`);
    return false;
  }
}

async function refreshFromCache(kind: AdaptiveCardKind): Promise<void> {
  const record = await getWidgetRecord(kind);
  if (record === undefined) {
    // 还没有数据 → 不推。推了的话组件会被清成空白，
    // 而**初始数据**由 manifest 的 `data` 字段提供（"打开 Heyta 以显示小组件"），
    // 那个状态比空白好得多。
    return;
  }
  if (isRecordStale(record, Date.now())) {
    // 🔴 过期就**绝不**把旧任务推上去。以前这里只能"什么都不做"，理由是
    //    `updateByTag` 只能推数据、不能清空 —— 那确实做不到"抹掉"，
    //    但现在不用抹：页面把**占位态**一起存下来了，推它就是把它换成
    //    "打开 Heyta 刷新"，组件从此不会再装作今天。
    console.info(`[heyta-sw] ${kind} 的缓存已过期（dayStr=${record.dayStr}），改推占位态`);
    if (record.placeholder != null) await pushWidgetData(kind, record.placeholder);
    return;
  }
  await pushWidgetData(kind, record.data);
}

/** 给组件宿主 / `data` 请求用的小工具。**必须带 `content-type`** —— 缺它时宿主会拒绝解析。 */
function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

// ─────────────────────────────────────────────────────────────────────
// 事件
// ─────────────────────────────────────────────────────────────────────

sw.addEventListener('install', (event: ExtendableEventLike) => {
  // 立刻接管，不等待旧 SW 释放页面 —— 组件的事件不该被一个挂着的旧版本吃掉。
  event.waitUntil(sw.skipWaiting());
});

sw.addEventListener('activate', (event: ExtendableEventLike) => {
  event.waitUntil(sw.clients.claim());
});

/**
 * `fetch` 处理器的存在是**可安装性要求**之一（Edge/Chrome 都要求有，
 * 否则不弹安装提示）。这里只做网络优先 + 离线兜底，不做资源预缓存：
 * 应用本体是 Vite 产物，文件名带 hash，预缓存清单要靠构建期生成
 * （本项目没引入 `vite-plugin-pwa`，见计划 §3.1 的实测结论）。
 *
 * ⚠️ **不对非 GET 放行之外的请求做任何事** —— 拦 POST 会破坏同步请求。
 */
sw.addEventListener('fetch', (event: FetchEventLike) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const kind = url.origin === self.location.origin ? kindFromDataPath(url.pathname) : null;

  if (kind !== null) {
    // 🔴 **Windows 上唯一一个"应用不在也能跑"的过期判定点。**
    //
    // 组件宿主会按 manifest 的 `update` 间隔重新取 `data` URL。拦下它，
    // 我们就能在**应用完全没打开**的情况下决定组件该显示什么 ——
    // 而 iOS / Android 上这件事由原生渲染路径的 `now >= validUntil` 做。
    //
    // 过期时返回**占位态**（"打开 Heyta 以显示小组件"），不是旧任务：
    // 显示昨天的任务列表看起来完全正常，用户不会怀疑它，于是照着它安排今天。
    event.respondWith(
      (async () => {
        const record = await getWidgetRecord(kind);
        if (record !== undefined && !isRecordStale(record, Date.now())) {
          return jsonResponse(record.data);
        }
        // 🔴 过期 / 没有数据 → 用**页面推过来一起存的占位态**，而不是旧任务列表。
        //    为什么不在这里现场拼那句话：词条表在 `@heyta/i18n`，把它 import 进
        //    service worker 会把**全部语言的全部界面文案**打进 `public/sw.js`
        //    （每次 SW 启动都要加载一次）。而"过期时该说什么"的**语言**又必须
        //    和数据同源 —— 所以由页面算好、SW 只缓存成品。
        if (record?.placeholder != null) return jsonResponse(record.placeholder);
        // 一个占位态也没有 = 这台设备**从没打开过应用**（或 IndexedDB 被清过）。
        // 回落到构建期生成的静态初值，与"没有 SW 拦截"时的行为逐字相同。
        return fetch(event.request);
      })().catch(
        // 网络也不可用 ⇒ 给一个明确失败的响应。
        // ⚠️ 这里**不**回一段中文兜底：SW 里没有词条表，任何现场编出来的句子
        //    都只有一种语言，而"组件说的话跟着界面语言走"正是这一轮要守住的契约。
        () => new Response(null, { status: 504 }),
      ),
    );
    return;
  }

  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response('离线', {
          status: 503,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        }),
    ),
  );
});

/** 组件被加入桌面。此时推一次缓存里的数据（如果有）。 */
sw.addEventListener('widgetinstall', (event: ClickEventLike) => {
  const kind = event.tag ? kindFromTag(event.tag) : null;
  if (!kind) return;
  event.waitUntil(refreshFromCache(kind));
});

/** 组件被移除。清掉它缓存的数据 —— 留着只会让下次安装先闪一下旧数据。 */
sw.addEventListener('widgetuninstall', (event: ClickEventLike) => {
  const kind = event.tag ? kindFromTag(event.tag) : null;
  if (!kind) return;
  event.waitUntil(tx(STORE_DATA, 'readwrite', (store) => store.delete(kind)).then(() => undefined));
});

/**
 * 用户点了组件里的一行。
 *
 * 🔴 这里**只写日志，不做任何业务判断**：
 * - 不判断"这个任务现在是不是已经完成了"（那要读应用状态，而应用可能没开）；
 * - 不构造 op（`AGENTS.md` §3.5：op 只能在 `packages/app-host` 里构造）；
 * - 不合并（合并语义只有一份，在 `@heyta/widget-core`，由页面 drain 时做）。
 *
 * SW 的职责到此为止：**把"用户想要什么"如实记下来**，别的一概不管。
 */
sw.addEventListener('widgetclick', (event: ClickEventLike) => {
  const click = parseWidgetClick(event.data, Date.now());
  if (!click) {
    // 模板与这里对不上（缺字段 / 类型不对）。**必须打日志** ——
    // 否则症状是"点组件没反应"，而组件本身渲染得好好的。
    console.warn('[heyta-sw] widgetclick 的 data 不合法，已忽略', event.data);
    return;
  }

  event.waitUntil(
    recordClick(click).then(async () => {
      // 如果应用正开着，直接告诉它去 drain，用户立刻看到变化。
      // 没开的话什么都不做 —— 点击留在日志里，等应用下次启动。
      const clients = await sw.clients.matchAll({ includeUncontrolled: true, type: 'window' });
      for (const client of clients) {
        client.postMessage({ type: 'heyta:widget-click', click });
      }
    }),
  );
});

/** 组件从"未激活"变回可见。重新推一次缓存数据（应用可能在这期间改过）。 */
sw.addEventListener('widgetresume', (event: ClickEventLike) => {
  const kind = event.tag ? kindFromTag(event.tag) : null;
  if (!kind) return;
  event.waitUntil(refreshFromCache(kind));
});

/**
 * 🔴 **Web Push —— Windows 上唯一能刷新"当日任务"的机制。**
 *
 * PBS 的下限是 12 小时（见文件头），所以推送必须由服务端发起。
 * 载荷是**加密快照**（与其它三端同一个信封格式），但 SW **解不开**（没有密钥）——
 * 所以这里的做法是：**唤醒页面**，让页面解密并算出 Adaptive Card 数据再推回来。
 *
 * ⚠️ 如果没有任何页面活着，就**什么都不做**。这是刻意的：
 * 在没有密钥的一侧硬造数据只能造出**错的**数据，而组件显示一个错的
 * 任务列表比显示"打开 Heyta"坏得多。
 */
sw.addEventListener('push', (event: PushEventLike) => {
  event.waitUntil(
    (async () => {
      const clients = await sw.clients.matchAll({ includeUncontrolled: true, type: 'window' });
      const payload = (() => {
        try {
          return event.data?.text() ?? '';
        } catch {
          return '';
        }
      })();

      // 🔴 **先把"收到过推送"这件事持久化，再管有没有页面。**
      //
      // 这一段是补一个**观测缺口**，而它刚刚真的让我瞎走过一轮：
      // 原来的处理器除了 `postMessage` **没有任何持久副作用**，于是当页面活着、
      // 监听器也装好了、却什么都没收到时，**从外面无法区分**下面两件事：
      //   （a）SW 根本没收到推送；
      //   （b）SW 收到了，但没能送到页面。
      // 而这两件的修法完全不同 —— (a) 是投递/安装的问题，(b) 是消息转发的问题。
      //
      // ⚠️ 写在客户端循环**之前**是刻意的：即使一个页面都没有，这个标记也要留下。
      //    "没有页面"是一个正常状态（用户关了标签页），但"没有页面所以什么都没留下"
      //    会让下一次排查从零开始。
      await tx(STORE_DATA, 'readwrite', (store) => store.put(Date.now(), PUSH_MARKER_KEY));

      for (const client of clients) {
        client.postMessage({ type: 'heyta:push', payload });
      }

      if (clients.length === 0) {
        console.info('[heyta-sw] 收到推送但没有活着的页面，组件保持旧数据（不伪造）');
      }
    })(),
  );
});

/** 页面 → SW。协议见 `sw-core.ts`。 */
sw.addEventListener('message', (event: MessageEventLike) => {
  const message = parsePageMessage(event.data);
  if (!message) return;

  if (message.type === 'heyta:widget-data') {
    const record: WidgetDataRecord = {
      kind: message.kind,
      data: message.data,
      // 与数据**同一语言**的占位态：SW 没有词条表，只能存页面算好的成品。
      placeholder: message.placeholder,
      dayStr: message.dayStr,
      validUntil: message.validUntil,
      pushedAt: Date.now(),
    };
    event.waitUntil(putWidgetData(record).then(() => pushWidgetData(message.kind, message.data)));
    return;
  }

  if (message.type === 'heyta:widget-refresh') {
    event.waitUntil(refreshFromCache(message.kind));
    return;
  }

  if (message.type === 'heyta:widget-requeue') {
    // 🔴 **插到最前面**，不是追加到末尾。这几条是**失败重试**的旧意图；
    //    追加到末尾会让它们的"最后写入"时间凭空变新，从而**覆盖掉**
    //    用户之后新点的那些（合并是 last-wins，顺序即优先级）。
    event.waitUntil(
      (async () => {
        const current = await readClicks();
        let next = [...message.intents, ...current];
        if (next.length > SW_CLICK_LOG_MAX) {
          // 同样从**头部**丢 —— 头部是更旧的失败意图。
          // ⚠️ 这里丢的可能是刚写回的失败意图，所以打日志。
          const dropped = next.length - SW_CLICK_LOG_MAX;
          console.warn(`[heyta-sw] 写回失败意图后超限，丢弃了 ${dropped} 条`);
          next = next.slice(dropped);
        }
        await writeClicks(next);
      })(),
    );
    return;
  }

  // drain：结果通过 MessageChannel 回给页面（`postMessage` 的返回值拿不到异步结果）。
  const port = event.ports?.[0];
  event.waitUntil(
    drainClicks().then((clicks) => {
      port?.postMessage({ type: 'heyta:clicks', clicks });
    }),
  );
});
