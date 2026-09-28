"use strict";
(() => {
  // ../../packages/widget-core/dist/index.js
  var ADAPTIVE_CARD_KINDS = ["today", "quadrant", "habits", "focus"];
  var ADAPTIVE_CARD_SCHEMA = "http://adaptivecards.io/schemas/adaptive-card.json";
  var ADAPTIVE_CARD_VERSION = "1.5";
  function buildFocusCardFallback(state) {
    return {
      kind: "focus",
      state,
      dayStr: null,
      sessionTitle: "",
      targetLabel: "",
      // `stale` 有自己的文案（"数据已过期，打开 Heyta 刷新"），不是占位
      showPlaceholder: state === "placeholder"
    };
  }
  function buildAdaptiveCardPlaceholder(kind) {
    switch (kind) {
      case "today":
        return { kind: "today", dayStr: "", count: 0, isEmpty: true, rows: [], showPlaceholder: true };
      case "quadrant":
        return { kind: "quadrant", dayStr: "", slots: [], showPlaceholder: true };
      case "habits":
        return { kind: "habits", dayStr: "", isEmpty: true, rows: [], showPlaceholder: true };
      case "focus":
        return buildFocusCardFallback("placeholder");
    }
  }
  function taskRowTemplate() {
    return {
      type: "ColumnSet",
      spacing: "Small",
      selectAction: {
        type: "Action.Execute",
        // 🔴 `taskId` 与 `targetIsDone` **必须**在 `data` 里：
        //    Windows 的 `widgetclick` 事件把这里的东西原样交给 service worker，
        //    而 service worker 要凭它写一条意图。少一个字段 = 点击被丢掉，
        //    且**没有任何错误**（事件照常触发，只是什么都做不了）。
        verb: "toggle",
        data: { taskId: "${id}", targetIsDone: "${targetIsDone}" }
      },
      columns: [
        { type: "Column", width: "auto", items: [{ type: "TextBlock", text: "\xB7", size: "Medium" }] },
        {
          type: "Column",
          width: "stretch",
          items: [
            {
              type: "TextBlock",
              text: "${title}",
              wrap: true,
              color: "${style}",
              strikethrough: "${strikethrough}"
            }
          ]
        }
      ]
    };
  }
  function textBlock(text, extra = {}) {
    return { type: "TextBlock", text, wrap: true, ...extra };
  }
  var PLACEHOLDER_TEXT = "\u6253\u5F00 Heyta \u4EE5\u663E\u793A\u5C0F\u7EC4\u4EF6";
  function withPlaceholderGate(realContent) {
    return [
      textBlock(PLACEHOLDER_TEXT, { isSubtle: true, isVisible: "${showPlaceholder}" }),
      { type: "Container", isVisible: "${!showPlaceholder}", items: realContent }
    ];
  }
  var ADAPTIVE_CARD_TEMPLATES = {
    today: {
      $schema: ADAPTIVE_CARD_SCHEMA,
      type: "AdaptiveCard",
      version: ADAPTIVE_CARD_VERSION,
      body: withPlaceholderGate([
        textBlock("\u4ECA\u65E5\u4EFB\u52A1", { weight: "Bolder", size: "Medium" }),
        textBlock("${count} \u9879", { isSubtle: true, spacing: "None" }),
        textBlock("\u4ECA\u5929\u6CA1\u6709\u4EFB\u52A1", { isSubtle: true, isVisible: "${isEmpty}" }),
        { type: "Container", $data: "${rows}", items: [taskRowTemplate()] }
      ])
    },
    quadrant: {
      $schema: ADAPTIVE_CARD_SCHEMA,
      type: "AdaptiveCard",
      version: ADAPTIVE_CARD_VERSION,
      body: withPlaceholderGate([
        textBlock("\u56DB\u8C61\u9650", { weight: "Bolder", size: "Medium" }),
        {
          type: "Container",
          $data: "${slots}",
          items: [
            textBlock("${label}\uFF08${count}\uFF09", { weight: "Bolder", spacing: "Medium" }),
            textBlock("${hint}", { isSubtle: true, spacing: "None" }),
            { type: "Container", $data: "${rows}", items: [taskRowTemplate()] }
          ]
        }
      ])
    },
    habits: {
      $schema: ADAPTIVE_CARD_SCHEMA,
      type: "AdaptiveCard",
      version: ADAPTIVE_CARD_VERSION,
      body: withPlaceholderGate([
        textBlock("\u4E60\u60EF", { weight: "Bolder", size: "Medium" }),
        textBlock("\u8FD8\u6CA1\u6709\u4E60\u60EF", { isSubtle: true, isVisible: "${isEmpty}" }),
        {
          type: "Container",
          $data: "${rows}",
          items: [
            {
              type: "ColumnSet",
              spacing: "Small",
              columns: [
                {
                  type: "Column",
                  width: "stretch",
                  items: [textBlock("${title}")]
                },
                {
                  type: "Column",
                  width: "auto",
                  items: [textBlock("${doneLabel}", { color: "good" })]
                }
              ]
            },
            textBlock("${streakLabel}", { isSubtle: true, size: "Small", spacing: "None" })
          ]
        }
      ])
    },
    focus: {
      $schema: ADAPTIVE_CARD_SCHEMA,
      type: "AdaptiveCard",
      version: ADAPTIVE_CARD_VERSION,
      body: withPlaceholderGate([
        // ⚠️ 这四句是**互斥**的四种状态，不是四条并列的提示。
        //    用一个 `state` 字段而不是四个布尔量，是为了让"同时显示两句"
        //    在数据层面就**不可能**构造出来。
        textBlock("\u6570\u636E\u5DF2\u8FC7\u671F\uFF0C\u6253\u5F00 Heyta \u5237\u65B0", {
          isSubtle: true,
          isVisible: "${state == 'stale'}"
        }),
        textBlock("\u6CA1\u6709\u8FDB\u884C\u4E2D\u7684\u4E13\u6CE8", { isSubtle: true, isVisible: "${state == 'idle'}" }),
        textBlock("${sessionTitle}", {
          weight: "Bolder",
          isVisible: "${state == 'active'}"
        }),
        textBlock("${targetLabel}", {
          isSubtle: true,
          isVisible: "${state == 'active'}"
        })
        // 🔴 这里**没有** `remainingSeconds` 的绑定 —— 见 `buildFocusCardData`。
        //    模板里留一个没被绑定的字段不会报错，只会让组件显示字面量 `${x}`；
        //    而漏掉"不许有倒计时"这条规则**不会有任何症状**，所以它写在测试里。
      ])
    }
  };

  // src/pwa/sw-core.ts
  var WIDGET_TAG_PREFIX = "heyta-";
  function widgetTag(kind) {
    return `${WIDGET_TAG_PREFIX}${kind}`;
  }
  function kindFromTag(tag) {
    if (!tag.startsWith(WIDGET_TAG_PREFIX)) return null;
    const kind = tag.slice(WIDGET_TAG_PREFIX.length);
    return ADAPTIVE_CARD_KINDS.includes(kind) ? kind : null;
  }
  var SW_CLICK_LOG_MAX = 500;
  function parseWidgetClick(data, now) {
    if (!data || typeof data !== "object") return null;
    const raw = data;
    const taskId = raw.taskId;
    if (typeof taskId !== "string" || taskId.length === 0) return null;
    const targetIsDone = raw.targetIsDone;
    if (typeof targetIsDone !== "boolean") return null;
    return { taskId, targetIsDone, at: now };
  }
  function appendClick(log, click) {
    const next = [...log, click];
    if (next.length <= SW_CLICK_LOG_MAX) return { log: next, dropped: 0 };
    const dropped = next.length - SW_CLICK_LOG_MAX;
    return { log: next.slice(dropped), dropped };
  }
  function isRecordStale(record, now) {
    if (!Number.isFinite(record.validUntil)) return true;
    return now >= record.validUntil;
  }
  function parsePageMessage(raw) {
    if (!raw || typeof raw !== "object") return null;
    const msg = raw;
    if (msg.type === "heyta:widget-drain") return { type: "heyta:widget-drain" };
    if (msg.type === "heyta:widget-requeue") {
      if (!Array.isArray(msg.intents)) return null;
      const intents = msg.intents.map((entry) => parseWidgetClick(entry, entry?.at ?? 0)).filter((entry) => entry !== null);
      return { type: "heyta:widget-requeue", intents };
    }
    if (msg.type === "heyta:widget-data" || msg.type === "heyta:widget-refresh") {
      const kind = msg.kind;
      if (typeof kind !== "string") return null;
      if (!ADAPTIVE_CARD_KINDS.includes(kind)) return null;
      if (msg.type === "heyta:widget-data") {
        if (typeof msg.data !== "object" || msg.data === null) return null;
        if (typeof msg.dayStr !== "string") return null;
        if (typeof msg.validUntil !== "number" || !Number.isFinite(msg.validUntil)) return null;
        return {
          type: "heyta:widget-data",
          kind,
          data: msg.data,
          dayStr: msg.dayStr,
          validUntil: msg.validUntil
        };
      }
      return { type: "heyta:widget-refresh", kind };
    }
    return null;
  }

  // src/pwa/sw.ts
  var WIDGET_DATA_PREFIX = "/widgets/";
  var WIDGET_DATA_SUFFIX = ".data.json";
  function kindFromDataPath(pathname) {
    if (!pathname.startsWith(WIDGET_DATA_PREFIX)) return null;
    const rest = pathname.slice(WIDGET_DATA_PREFIX.length);
    if (!rest.endsWith(WIDGET_DATA_SUFFIX)) return null;
    return kindFromTag(`heyta-${rest.slice(0, -WIDGET_DATA_SUFFIX.length)}`);
  }
  var sw = self;
  var DB_NAME = "heyta-widget";
  var DB_VERSION = 1;
  var STORE_CLICKS = "clicks";
  var STORE_DATA = "data";
  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_CLICKS)) {
          db.createObjectStore(STORE_CLICKS, { autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(STORE_DATA)) {
          db.createObjectStore(STORE_DATA);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("indexedDB.open \u5931\u8D25"));
    });
  }
  function tx(store, mode, body) {
    return openDb().then(
      (db) => new Promise((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = body(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB \u8BF7\u6C42\u5931\u8D25"));
        transaction.oncomplete = () => db.close();
      })
    );
  }
  async function readClicks() {
    const all = await tx(STORE_CLICKS, "readonly", (store) => store.getAll());
    return all ?? [];
  }
  async function recordClick(click) {
    const current = await readClicks();
    const { log, dropped } = appendClick(current, click);
    if (dropped > 0) {
      console.warn(`[heyta-sw] \u70B9\u51FB\u65E5\u5FD7\u8D85\u8FC7\u4E0A\u9650\uFF0C\u4E22\u5F03\u4E86 ${dropped} \u6761\u6700\u65E9\u7684\u70B9\u51FB`);
    }
    await writeClicks(log);
  }
  async function writeClicks(next) {
    await tx(STORE_CLICKS, "readwrite", (store) => store.clear());
    for (const entry of next) {
      await tx(STORE_CLICKS, "readwrite", (store) => store.add(entry));
    }
  }
  async function drainClicks() {
    const all = await readClicks();
    await tx(STORE_CLICKS, "readwrite", (store) => store.clear());
    return all;
  }
  async function putWidgetData(record) {
    await tx(STORE_DATA, "readwrite", (store) => store.put(record, record.kind));
  }
  async function getWidgetRecord(kind) {
    return tx(STORE_DATA, "readonly", (store) => store.get(kind));
  }
  async function pushWidgetData(kind, data) {
    const api = sw.widgets;
    if (!api) {
      console.info("[heyta-sw] \u8FD9\u4E2A\u6D4F\u89C8\u5668\u4E0D\u652F\u6301 PWA \u7EC4\u4EF6\uFF08Edge \u4E13\u6709\uFF09\uFF0C\u8DF3\u8FC7\u5237\u65B0");
      return false;
    }
    try {
      await api.updateByTag(widgetTag(kind), { data });
      return true;
    } catch (error) {
      console.info(`[heyta-sw] updateByTag(${widgetTag(kind)}) \u672A\u751F\u6548\uFF1A${String(error)}`);
      return false;
    }
  }
  async function refreshFromCache(kind) {
    const record = await getWidgetRecord(kind);
    if (record === void 0) {
      return;
    }
    if (isRecordStale(record, Date.now())) {
      console.info(`[heyta-sw] ${kind} \u7684\u7F13\u5B58\u5DF2\u8FC7\u671F\uFF08dayStr=${record.dayStr}\uFF09\uFF0C\u4E0D\u63A8\u65E7\u6570\u636E`);
      return;
    }
    await pushWidgetData(kind, record.data);
  }
  function jsonResponse(value) {
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
  sw.addEventListener("install", (event) => {
    event.waitUntil(sw.skipWaiting());
  });
  sw.addEventListener("activate", (event) => {
    event.waitUntil(sw.clients.claim());
  });
  sw.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;
    const url = new URL(event.request.url);
    const kind = url.origin === self.location.origin ? kindFromDataPath(url.pathname) : null;
    if (kind !== null) {
      event.respondWith(
        (async () => {
          const record = await getWidgetRecord(kind);
          if (record === void 0 || isRecordStale(record, Date.now())) {
            return jsonResponse(buildAdaptiveCardPlaceholder(kind));
          }
          return jsonResponse(record.data);
        })().catch(() => jsonResponse(buildAdaptiveCardPlaceholder(kind)))
      );
      return;
    }
    event.respondWith(
      fetch(event.request).catch(
        () => new Response("\u79BB\u7EBF", {
          status: 503,
          headers: { "content-type": "text/plain; charset=utf-8" }
        })
      )
    );
  });
  sw.addEventListener("widgetinstall", (event) => {
    const kind = event.tag ? kindFromTag(event.tag) : null;
    if (!kind) return;
    event.waitUntil(refreshFromCache(kind));
  });
  sw.addEventListener("widgetuninstall", (event) => {
    const kind = event.tag ? kindFromTag(event.tag) : null;
    if (!kind) return;
    event.waitUntil(tx(STORE_DATA, "readwrite", (store) => store.delete(kind)).then(() => void 0));
  });
  sw.addEventListener("widgetclick", (event) => {
    const click = parseWidgetClick(event.data, Date.now());
    if (!click) {
      console.warn("[heyta-sw] widgetclick \u7684 data \u4E0D\u5408\u6CD5\uFF0C\u5DF2\u5FFD\u7565", event.data);
      return;
    }
    event.waitUntil(
      recordClick(click).then(async () => {
        const clients = await sw.clients.matchAll({ includeUncontrolled: true, type: "window" });
        for (const client of clients) {
          client.postMessage({ type: "heyta:widget-click", click });
        }
      })
    );
  });
  sw.addEventListener("widgetresume", (event) => {
    const kind = event.tag ? kindFromTag(event.tag) : null;
    if (!kind) return;
    event.waitUntil(refreshFromCache(kind));
  });
  sw.addEventListener("push", (event) => {
    event.waitUntil(
      (async () => {
        const clients = await sw.clients.matchAll({ includeUncontrolled: true, type: "window" });
        const payload = (() => {
          try {
            return event.data?.text() ?? "";
          } catch {
            return "";
          }
        })();
        for (const client of clients) {
          client.postMessage({ type: "heyta:push", payload });
        }
        if (clients.length === 0) {
          console.info("[heyta-sw] \u6536\u5230\u63A8\u9001\u4F46\u6CA1\u6709\u6D3B\u7740\u7684\u9875\u9762\uFF0C\u7EC4\u4EF6\u4FDD\u6301\u65E7\u6570\u636E\uFF08\u4E0D\u4F2A\u9020\uFF09");
        }
      })()
    );
  });
  sw.addEventListener("message", (event) => {
    const message = parsePageMessage(event.data);
    if (!message) return;
    if (message.type === "heyta:widget-data") {
      const record = {
        kind: message.kind,
        data: message.data,
        dayStr: message.dayStr,
        validUntil: message.validUntil,
        pushedAt: Date.now()
      };
      event.waitUntil(putWidgetData(record).then(() => pushWidgetData(message.kind, message.data)));
      return;
    }
    if (message.type === "heyta:widget-refresh") {
      event.waitUntil(refreshFromCache(message.kind));
      return;
    }
    if (message.type === "heyta:widget-requeue") {
      event.waitUntil(
        (async () => {
          const current = await readClicks();
          let next = [...message.intents, ...current];
          if (next.length > SW_CLICK_LOG_MAX) {
            const dropped = next.length - SW_CLICK_LOG_MAX;
            console.warn(`[heyta-sw] \u5199\u56DE\u5931\u8D25\u610F\u56FE\u540E\u8D85\u9650\uFF0C\u4E22\u5F03\u4E86 ${dropped} \u6761`);
            next = next.slice(dropped);
          }
          await writeClicks(next);
        })()
      );
      return;
    }
    const port = event.ports?.[0];
    event.waitUntil(
      drainClicks().then((clicks) => {
        port?.postMessage({ type: "heyta:clicks", clicks });
      })
    );
  });
})();
