/**
 * op-log 桥的**线码**（wire codec）—— 让协议不再依赖「结构化克隆」
 * ==================================================================
 *
 * ## 为什么需要它（2026-09-30 实测，不是预防性设计）
 *
 * `oplog-worker-bridge.ts` 的协议假设**参数可结构化克隆**，并在注释里专门
 * 点名了唯一一个需要注意的类型：
 *
 * > `markUploaded(ReadonlyMap<string, number>)` —— `Map` **是**可结构化克隆的，
 * > 所以它原样能过，不需要转成 `[[k,v]]`。
 *
 * 这在 **Worker 传输**上成立。但桌面端的宿主边界**不是**结构化克隆：
 * WebView2 的 `PostWebMessageAsJson` 与 WKWebView 的 `evaluateJavaScript`
 * **只过 JSON**，而 `JSON.stringify(new Map())` 得到 `{}`。
 *
 * 实测（把 op-log 契约跑在一条显式 JSON 往返的端口上）：
 *
 * ```
 * TypeError: serverSeqsByOpId is not iterable
 *   at DbOpLogStore.markUploaded  src/db-op-log-store.ts:402
 * ```
 *
 * 13 条契约同时红。⇒ **桌面端那条传输不能是裸 JSON**，必须有一层线码。
 * 这个问题如果留到壳里去发现，代价是"C# + 两个壳都写完了才炸"。
 *
 * ## 设计取舍：**只支持需要的，遇到没覆盖的响亮失败**
 *
 * 刻意**不做**通用的结构化克隆模拟（那要处理 Date/RegExp/ArrayBuffer/循环引用……
 * 而 `OpLogStore` 的公开面一个都没用到）。也刻意**不静默降级** ——
 * 遇到没覆盖的宿主类型就抛，错误信息直接说明"要在这里补编码"。
 *
 * 理由：静默编坏的表现是**上层拿到错的数据**，而本仓最忌讳的正是这个
 * （"界面说谎"那一类）。宁可当场炸。
 *
 * ⚠️ 两个实现都必须用**同一份**码：编码在发送侧、解码在接收侧，**两侧对称**。
 * 只做一半的表现是"某些调用能用、某些不能"，比全坏更难查。
 */

/** 线码的标记键。用足够长的名字，避免与真实数据里的键撞上。 */
const TAG = '__heytaWire';

/** 判定"这是我们自己的编码盒"：必须**恰好**只有两个键，避免把用户的同名对象吃掉。 */
function isBox(value: unknown): value is { [TAG]: string; v: unknown } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 2 && keys.includes(TAG);
}

/**
 * 编码：把过不了 JSON 的值换成 JSON 能承载的形状。
 *
 * 覆盖 `OpLogStore` 公开面**实际用到**的非 JSON 类型：
 *   - `Map`（`markUploaded` 的 `ReadonlyMap`）→ `[[k, v], …]`
 *   - `Set` → `[…]`
 *   - `undefined` → 显式盒子（**这条最要紧**：JSON 会把对象属性与数组元素里的
 *     `undefined` 直接丢掉，于是**位置参数会移位**，而那是静默的数据错位）
 */
export function encodeOpLogWire(value: unknown): unknown {
  /**
   * 🔴 `undefined` 的盒子必须带 `v`（哪怕是 `null`）—— **不能只写一个键**。
   *
   * 实测踩过（2026-09-30，契约里 12 条同时红）：第一版写成
   * `{ __heytaWire: 'undefined' }`（**1 个键**），而解码侧的 `isBox` 要求
   * **恰好 2 个键** ⇒ 这个盒子不被认成盒子，被当成普通对象解出来。
   * 后果是 `getAllOps(range)` 的 `range` 从 `undefined` 变成了一个**真值对象**，
   * `getAll(OPS, 那个对象)` 一条都匹配不到 ⇒ 读回空数组，
   * 而写入、seq、队列全都正常 —— 症状是"写进去了但读不出来"。
   */
  if (value === undefined) return { [TAG]: 'undefined', v: null };
  if (value === null) return null;

  if (value instanceof Map) {
    return { [TAG]: 'Map', v: [...value.entries()].map(([k, v]) => [encodeOpLogWire(k), encodeOpLogWire(v)]) };
  }
  if (value instanceof Set) {
    return { [TAG]: 'Set', v: [...value.values()].map(encodeOpLogWire) };
  }
  if (Array.isArray(value)) return value.map(encodeOpLogWire);

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = encodeOpLogWire(v);
    return out;
  }

  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new Error(
      `op-log 线码：${typeof value} 过不了宿主边界（JSON 会丢/变形状）。` +
        '若确实需要，请在 encodeOpLogWire/decodeOpLogWire 里成对地加编码 —— ' +
        '不要在发送侧单方面"转成字符串"，那会让接收侧拿到错的数据。',
    );
  }

  // string / number / boolean 原样。
  // ⚠️ `NaN` / `Infinity` 会被 JSON 变成 `null` —— 这里不拦，因为存储层不用它们；
  //    真用到时应当在上面显式处理，而不是靠调用方小心。
  return value;
}

/** 解码：`encodeOpLogWire` 的逆。两侧必须成对。 */
export function decodeOpLogWire(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;

  if (isBox(value)) {
    const kind = (value as Record<string, unknown>)[TAG];
    const payload = (value as Record<string, unknown>)['v'];
    if (kind === 'undefined') return undefined;
    if (kind === 'Map') {
      const entries = payload as [unknown, unknown][];
      return new Map(entries.map(([k, v]) => [decodeOpLogWire(k), decodeOpLogWire(v)]));
    }
    if (kind === 'Set') {
      const values = payload as unknown[];
      return new Set(values.map(decodeOpLogWire));
    }
    throw new Error(`op-log 线码：不认识的标记 ${String(kind)} —— 两侧的码版本不一致？`);
  }

  if (Array.isArray(value)) return value.map(decodeOpLogWire);

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = decodeOpLogWire(v);
  return out;
}

/**
 * 一个 `postMessage` 端口的**最小形状**。
 *
 * 与 `oplog-worker-bridge.ts` 里桥期望的形状一致 —— 这里刻意**不改桥**：
 * 桌面端要换的只是"消息怎么过网络"，不是桥的协议。
 */
export interface OpLogWirePort {
  postMessage(message: unknown): void;
  onmessage?: ((event: { data: unknown }) => void) | null;
  addEventListener?(type: string, listener: (event: { data: unknown }) => void): void;
}

/**
 * 把一个端口包成**带线码**的端口：出站编码、入站解码。
 *
 * 🔴 **两侧必须各包一次**（页侧一次、壳侧一次）。只包一侧的表现是
 * "某些调用能用、某些不能"，比全坏更难查 —— 所以不要"顺手在某一侧解码"。
 *
 * 用法（页侧与壳侧逐字相同）：
 *
 * ```ts
 * const port = createOpLogWirePort(rawPort);   // rawPort 由宿主注入
 * ```
 *
 * ⚠️ 它**不碰**桥那边的任何代码：桥仍然只看见"一个会 postMessage 的端口"。
 * 这一点很重要 —— 桥的 Worker 通路今天在跑，不能为了桌面端去动它。
 */
export function createOpLogWirePort<P extends OpLogWirePort>(port: P): P {
  const decodeEvent = (event: { data: unknown }): { data: unknown } => ({
    data: decodeOpLogWire(event.data),
  });

  const wrapper: OpLogWirePort = {
    postMessage(message: unknown): void {
      port.postMessage(encodeOpLogWire(message));
    },
  };

  /**
   * 入站方向跟着**底层端口实际提供的机制**走，而不是我们挑一个：
   * `oplog-worker-bridge.ts` 优先用 `addEventListener`、否则用单槽 `onmessage`。
   * 包错机制的症状是"发得出去、收不回来"（请求永远悬着）。
   */
  if (typeof port.addEventListener === 'function') {
    wrapper.addEventListener = (type, listener) => {
      port.addEventListener?.(type, (event) => {
        listener(decodeEvent(event));
      });
    };
  } else {
    Object.defineProperty(wrapper, 'onmessage', {
      get: () => port.onmessage ?? null,
      set: (listener: ((event: { data: unknown }) => void) | null) => {
        port.onmessage =
          listener === null
            ? null
            : (event) => {
                listener(decodeEvent(event));
              };
      },
    });
  }

  return wrapper as P;
}
