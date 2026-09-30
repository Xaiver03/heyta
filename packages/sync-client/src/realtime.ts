/**
 * 实时同步连接器（**宿主无关**）
 * ===============================
 *
 * 服务端早已把 WebSocket 通道做完（`server/src/sync/websocket.routes.ts` +
 * `services/websocket-connection.service.ts`），但客户端一行都没接 —— 这一刀补上"最后一米"。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 🔴 安全契约：**这条通道只传"有新 op 了"这个信号，不传任何内容。**
 *
 * 服务端推给客户端的只有 `{ type: 'new_ops', latestSeq }`，客户端收到后**触发一次普通的
 * HTTP 同步**（`SyncClient.sync()`），真正的 op 密文仍然走 `/api/sync/ops`。
 *
 * 这与 heyta 的定位一致：服务端**只转发密文**，看不到明文。把 op 内容搬进 WS 不会让
 * 产品变差，但会让"服务端只看密文"这条边界多出一个需要独立审计的入口。
 *
 * 所以：**将来任何人想"顺手把 op 塞进 WS 推过去"，必须先改这段契约、并同步改服务端**
 * （`websocket-connection.service.ts` 的文件头也写着 "Does NOT stream operation payloads
 * over WebSocket"）。这不是"还没做"，是**刻意不做**。
 * ═════════════════════════════════════════════════════════════════════════
 *
 * 为什么退避不是"可选项"
 * ----------------------
 * 服务端 `websocket.routes.ts:12-18` 的注释直接点名：**18.6.0 之前客户端的
 * `reconnect-on-close` 风暴**把限流配额打爆过。服务端现在的对策是重连冷却
 * （同 clientId 短时间内再连，用 4008 "Reconnecting too fast" 拒绝挑战者、
 * 保留既有连接，见 `websocket-connection.service.ts:189`）。
 *
 * 也就是说：**一个不节制的客户端会被服务端主动挡掉**，挡掉之后如果还是立刻重连，
 * 就变成自己跟自己的冷却期较劲。所以这里必须**指数退避 + 抖动 + 上限**，
 * 且 `dispose()` 之后**绝不再连**（否则页面卸载/应用退到后台后仍在后台重连，
 * 正是那个风暴的成因）。
 *
 * 刻意没做的（附影响 + 最小一步）
 * --------------------------------
 * 1. **没有可取消的退避定时器**。`dispose()` 只把状态置为 disposed 并唤醒在途的
 *    连接流程；如果此刻正卡在退避等待里，那个等待会自然走完才退出（默认最多
 *    `maxBackoffMs`）。影响：dispose 之后进程里可能残留一个最长 30s 的定时器，
 *    但它**不会再发起任何连接**。最小一步：把 `sleep` 换成一个持有 resolve 的
 *    可取消实现，在 `dispose()` 里 resolve 掉。
 *
 * 2. **没有把连接状态报给宿主**（连接中/已连接/重试中）。宿主目前只需要
 *    "有新 op" 这一个信号；加状态机就要加一条测试面。影响：界面暂时无法显示
 *    "实时已连接"。最小一步：加一个 `onStatusChange?: (s) => void` 回调，
 *    在 openOnce/settle 处各发一次。
 *
 * 3. **只处理 `new_ops`**。`connected` 只用来重置退避；`presence_state` /
 *    `presence_cmd` 直接忽略 —— 追踪 presence 是另一个功能（宿主还一行没接），
 *    在这里顺手解析只会制造一份没人消费的解析代码。未知类型**一律不崩**（前向兼容）。
 *
 * 4. **没有 import 任何东西**。零依赖、零 DOM/浏览器专有全局：`WebSocket` 由
 *    `WebSocketImpl` 注入，默认取 `globalThis.WebSocket`；定时器用 `setTimeout`。
 *    同一份代码要能跑在浏览器、Node、Electron 与 Hermes（移动端）上。
 */

/**
 * 服务端关闭码 —— 与 `websocket.routes.ts` / `websocket-connection.service.ts` 对齐。
 *
 * ⚠️ 任务书里写的是"token 或 clientId 非法 → 4001"，**实测不是这样**：
 * 缺 token / clientId 非法确实是 4001，但 **token 校验失败是 4003**
 * （`websocket.routes.ts` 里 `verifyToken` 失败走 4003）。这三个码都是
 * **终止码**：拿同样的凭据再连一次结果不会变，所以不重连，等宿主刷新令牌后
 * 再调用 `connect()`。
 */
export const WS_CLOSE_MISSING_OR_INVALID_CREDENTIALS = 4001;
export const WS_CLOSE_AUTH_FAILURE = 4003;
/** 同 clientId 的更新连接顶掉了本连接 —— 我们已经是"旧的那条"，重连只会互相顶。 */
export const WS_CLOSE_REPLACED = 4009;

/**
 * 协议层 close 事件的**结构**子集。
 *
 * 不直接引用 DOM 的 `CloseEvent`：Hermes / Electron 的类型环境各不相同，
 * 而这个包要宿主无关。我们的假实现只要能提供 `code` 就够了。
 */
export interface WebSocketCloseEventLike {
  readonly code?: number;
  readonly reason?: string;
}

/** 协议层 message 事件的结构子集。`data` 在浏览器里是 string，在 Node `ws` 里默认是 Buffer。 */
export interface WebSocketMessageEventLike {
  readonly data: unknown;
}

/**
 * 我们需要的 `WebSocket` **全部能力**，刻意只声明用得到的那几个成员。
 *
 * 这样测试可以塞一个几十行的假实现，而真实浏览器 `WebSocket` 与 Node `ws`
 * 都能结构化地满足它（无需依赖 `lib.dom`）。
 */
export interface WebSocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: WebSocketMessageEventLike) => void) | null;
  onclose: ((event: WebSocketCloseEventLike) => void) | null;
  onerror: ((event: unknown) => void) | null;
  close(code?: number, reason?: string): void;
}

/** `WebSocket` 构造器。`new (url) => WebSocketLike`。 */
export interface WebSocketFactory {
  new (url: string): WebSocketLike;
}

/**
 * 令牌**活取值器**。
 *
 * 🔴 不要在 `createRealtimeClient()` 时读一次就固定：用户是在应用起来**之后**
 * 才填服务器地址与令牌的。`packages/app-host/src/host.ts` 的文件头把这个坑写得很清楚 ——
 * 静态传 `token` 的结果是"同步永远以未登录失败，而界面上只是看不到任何同步"。
 */
export type TokenGetter = () => Promise<string | undefined> | string | undefined;

export interface RealtimeClientOptions {
  /** 服务端根地址，例如 `http://127.0.0.1:3000` 或 `https://sync.example.com`。 */
  baseUrl: string;
  /** 每次连接时重新取令牌。返回 undefined/空串表示"未登录"。 */
  getToken: TokenGetter;
  /** 本设备 clientId（与服务端 `isValidClientId` 的口径一致）。 */
  clientId: string;
  /** 收到"有新 op"信号时调用，参数是服务端当前的 `latestSeq`。宿主据此触发一次同步。 */
  onNewOps: (latestSeq: number) => void;

  /** WebSocket 实现。默认 `globalThis.WebSocket`。测试注入假实现。 */
  WebSocketImpl?: WebSocketFactory;

  /** 首次退避基准（毫秒）。默认 1000。 */
  initialBackoffMs?: number;
  /** 退避上限（毫秒）。默认 30000。 */
  maxBackoffMs?: number;
  /** 退避因子。默认 2。 */
  backoffFactor?: number;
  /** 抖动随机源，返回 `[0, 1)`。默认 `Math.random`；测试注入固定值以获得确定性。 */
  random?: () => number;
  /**
   * 退避等待实现，便于测试注入**不消耗真实时间**的定时器。
   * 默认 `setTimeout`。返回 Promise，resolve 后才会尝试下一次连接。
   */
  sleep?: (ms: number) => Promise<void>;
}

export interface RealtimeClient {
  /** 开始连接（幂等：已在运行/已 dispose 时是 no-op）。未登录时不连，等宿主再调。 */
  connect(): void;
  /** 永久停止：关闭当前连接，之后**不再重连**。可重复调用。 */
  dispose(): void;
}

/**
 * 由 `baseUrl` 推导 WS 端点。
 *
 * ⚠️ 任务书说"复用 `server-url.ts` 已有的规范化逻辑" —— **实测那里没有规范化逻辑**，
 * `server-url.ts` 只有 `classifyTransportSecurity()` / `isPrivateHost()`（传输安全等级判定），
 * 全仓也找不到 `normalizeBaseUrl` 之类的函数（已 grep 核实）。所以这里把"规范化"补在
 * 唯一需要它的地方，并在汇报里如实说明，而不是假装复用了。
 *
 * 规则：去掉尾部斜杠；`https` → `wss`、`http` → `ws`（保留原样大小写之外的主机）；
 * 无 scheme 时按明文 `ws://` 处理（与 `classifyTransportSecurity` 把无 scheme 视为
 * 明文的口径一致）。返回 `ws(s)://host/api/sync/ws?token=…&clientId=…`。
 *
 * ## 🔴 路径是 `/api/sync/ws`，不是 `/ws`（2026-09-29 实测修）
 *
 * 服务端把 `wsRoutes` 注册在 **`prefix: '/api/sync'`** 下
 *（`server/src/server.ts`：`fastifyServer.register(wsRoutes, { prefix: '/api/sync' })`）。
 * 本函数此前拼的是 `/ws` —— 于是真实服务端上**每一次连接都 404**，
 * 而客户端只会按退避重试，界面上看不出任何异常。
 *
 * 实测（对着本机真服务端，带 WebSocket 升级头）：
 *
 * ```
 *   GET /ws             → 404
 *   GET /api/sync/ws    → 101 Switching Protocols
 * ```
 *
 * ⚠️ **为什么它长期没被发现**：本包与两个宿主的测试都用**假 WebSocket**
 *（任何 URL 都接受），而 `tests/realtime.spec.ts` 把 `/ws` 这个**错路径**
 * 逐字断言了下来 —— 测试与实现一起错，所以一直是绿的。
 * 真正的判据只能是**对着真服务端连一次**：`scripts/verify-realtime-push.mjs`。
 *
 * 🔴 token **必须 URL 编码**：它是任意字符串，`+` `/` `=` `&` `?` `#` 都会改变 query 的含义。
 */
export function buildRealtimeUrl(baseUrl: string, token: string, clientId: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed === '') {
    // 空地址连不出有意义的东西；抛出让调用方当成"不可连接"，而不是拼出 `ws:///ws`。
    throw new Error('realtime: baseUrl 为空，无法推导 WebSocket 端点');
  }

  let origin: string;
  if (/^https:\/\//i.test(trimmed)) {
    origin = `wss://${trimmed.slice('https://'.length)}`;
  } else if (/^http:\/\//i.test(trimmed)) {
    origin = `ws://${trimmed.slice('http://'.length)}`;
  } else if (/^wss?:\/\//i.test(trimmed)) {
    origin = trimmed;
  } else {
    origin = `ws://${trimmed}`;
  }

  return `${origin}/api/sync/ws?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`;
}

/** 这些关闭码代表"同样的输入再来一次还是这个结果"，不重连。 */
function isTerminalCloseCode(code: number | undefined): boolean {
  if (code === undefined) return false;
  return (
    code === WS_CLOSE_MISSING_OR_INVALID_CREDENTIALS ||
    code === WS_CLOSE_AUTH_FAILURE ||
    code === WS_CLOSE_REPLACED
  );
}

/** 默认退避等待：真实 `setTimeout`（浏览器 / Node / Hermes 都有）。 */
function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

const DEFAULT_INITIAL_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;
const DEFAULT_BACKOFF_FACTOR = 2;

class RealtimeClientImpl implements RealtimeClient {
  private readonly baseUrl: string;
  private readonly getToken: TokenGetter;
  private readonly clientId: string;
  private readonly onNewOps: (latestSeq: number) => void;
  private readonly WebSocketImpl: WebSocketFactory | undefined;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly backoffFactor: number;
  private readonly random: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  /** 当前连接（若有）。 */
  private ws: WebSocketLike | null = null;
  /**
   * 唤醒在途 `openOnce()` 的 settle 函数。
   *
   * `dispose()` 用它**主动**结束等待，而不依赖 `ws.close()` 一定会触发 `onclose` ——
   * 假实现、某些原生 WebSocket 在特定状态下都可能不回调，那样 run 循环会永久挂起。
   */
  private currentSettle: ((shouldRetry: boolean) => void) | null = null;
  private disposed = false;
  /** run 循环是否在跑。防止宿主重复调用 `connect()` 起第二条循环。 */
  private running = false;
  /** 连续失败次数，决定退避档位；收到 `connected` 后归零。 */
  private attempt = 0;

  constructor(options: RealtimeClientOptions) {
    this.baseUrl = options.baseUrl;
    this.getToken = options.getToken;
    this.clientId = options.clientId;
    this.onNewOps = options.onNewOps;
    this.WebSocketImpl = options.WebSocketImpl;
    this.initialBackoffMs = options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.backoffFactor = options.backoffFactor ?? DEFAULT_BACKOFF_FACTOR;
    this.random = options.random ?? Math.random;
    this.sleep = options.sleep ?? defaultSleep;
  }

  connect(): void {
    if (this.disposed || this.running) return;
    this.running = true;
    void this.run();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    const settle = this.currentSettle;
    this.currentSettle = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close();
      } catch {
        // 关不掉无所谓：下面的 settle 会结束在途流程，disposed 保证不会再连。
      }
    }
    settle?.(false);
  }

  /**
   * 连接循环：连一次 → 若该重试则退避 → 再连。
   *
   * 写成单循环而不是"onclose 里递归调 connect"，是为了让"同一时刻只有一条连接尝试"
   * 成为结构上的事实，而不是靠一堆布尔标志互相兜底。
   */
  private async run(): Promise<void> {
    try {
      while (!this.disposed) {
        const shouldRetry = await this.openOnce();
        if (this.disposed || !shouldRetry) break;

        const delay = this.backoffDelay(this.attempt);
        this.attempt += 1;
        await this.sleep(delay);
      }
    } finally {
      // 即使出现意料外的抛错，也必须放开 running —— 否则宿主再也 connect() 不了
      // （running 卡在 true，唯一的补救是重建整个客户端）。
      this.running = false;
    }
  }

  /**
   * 建立一次连接，返回"断开后是否应该重试"。
   *
   * Promise 在**连接结束**（openOnce 返回）时才 resolve —— 这样 run 循环天然等待，
   * 断线由 `onclose` 唤醒。
   */
  private async openOnce(): Promise<boolean> {
    let token: string | undefined;
    try {
      token = await this.getToken();
    } catch {
      // 取令牌本身失败：当成"当前连接不了"。不重试，避免用一个永远抛错的取值器空转；
      // 宿主修好存储后再 connect() 即可。
      return false;
    }

    if (this.disposed) return false;
    // 未登录：不连、也不重连。重连会变成无凭据空转（且每次都要打一次升级请求）。
    if (token === undefined || token === '') return false;

    const Impl = this.WebSocketImpl ?? (globalThis as { WebSocket?: WebSocketFactory }).WebSocket;
    if (Impl === undefined) {
      // 宿主既没注入、环境也没有 WebSocket：重试多少次都一样。
      return false;
    }

    let url: string;
    try {
      url = buildRealtimeUrl(this.baseUrl, token, this.clientId);
    } catch {
      // baseUrl 不可用（例如空串）：等宿主改配置，重连没意义。
      return false;
    }

    let ws: WebSocketLike;
    try {
      ws = new Impl(url);
    } catch {
      // 🔴 这里**故意不把底层异常抛出去**：`new WebSocket(url)` 的报错里常常带着整条 URL，
      // 而 URL 的 query 上有 token —— 那是 E2EE 产品里最不能进日志的东西。
      // 构造失败按可重试处理（网络栈暂时不可用等），走退避。
      return true;
    }

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (shouldRetry: boolean): void => {
        if (settled) return;
        settled = true;
        if (this.currentSettle === settle) this.currentSettle = null;
        if (this.ws === ws) this.ws = null;
        resolve(shouldRetry);
      };

      this.ws = ws;
      this.currentSettle = settle;

      ws.onopen = () => {
        // 刻意**不在这里**重置退避：onopen 只说明 TCP/WS 握手成功，服务端可能马上就用
        // 4008/4009 把我们关掉。真正建立会话的信号是下面的 `connected` 消息 ——
        // 用它归零，才不会在"连上就被踢"时退化成固定间隔重连风暴。
      };
      ws.onmessage = (event) => {
        this.handleMessage(event, () => {
          this.attempt = 0;
        });
      };
      ws.onclose = (event) => {
        const code = typeof event?.code === 'number' ? event.code : undefined;
        settle(!isTerminalCloseCode(code));
      };
      ws.onerror = () => {
        // error 之后紧跟着就是 close（浏览器与 Node ws 都如此）。这里什么都不做，
        // 免得 error + close 双重 settle；真发生"只 error 不 close"，由 dispose 兜底。
      };
    });
  }

  /** 满抖动（equal jitter）：一半固定 + 一半随机，保证下限、又打散同时重连。 */
  private backoffDelay(attempt: number): number {
    const raw = this.initialBackoffMs * Math.pow(this.backoffFactor, attempt);
    const capped = Math.min(this.maxBackoffMs, raw);
    const half = capped / 2;
    return Math.round(half + this.random() * half);
  }

  /**
   * 处理服务端消息。**未知类型必须不崩**（前向兼容：服务端将来加消息不能打死老客户端）。
   *
   * `onConnected` 在收到 `connected` 时调用，用来归零退避。
   */
  private handleMessage(
    event: WebSocketMessageEventLike,
    onConnected: () => void,
  ): void {
    if (this.disposed) return;

    const raw: unknown = event?.data;
    let text: string;
    try {
      if (typeof raw === 'string') {
        text = raw;
      } else if (raw === null || raw === undefined) {
        return;
      } else {
        // Node 的 `ws` 默认给 Buffer；`String(buf)` 等于 `buf.toString()`（UTF-8）。
        // 刻意不引 TextDecoder：那是浏览器/Node 全局，Hermes 上不保证存在。
        text = String(raw);
      }
    } catch {
      // 极端情况下 `toString()` 自己抛错（宿主塞了怪对象）：同样不能掀连接。
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // 一条坏消息不能打断实时通道：忽略它，连接继续用。
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;

    const message = parsed as { type?: unknown; latestSeq?: unknown };

    if (message.type === 'connected') {
      onConnected();
      return;
    }
    // presence_state / presence_cmd 及任何未知类型：静默忽略。
    if (message.type !== 'new_ops') return;
    if (typeof message.latestSeq !== 'number') return;

    try {
      this.onNewOps(message.latestSeq);
    } catch {
      // 宿主回调抛错不能掀掉连接（它可能只是渲染逻辑挂了）。
    }
  }
}

/**
 * 创建一个宿主无关的实时连接器。
 *
 * ```ts
 * const rt = createRealtimeClient({
 *   baseUrl,                       // 来自用户设置
 *   getToken: async () => get().token,   // 活取值器，每次连接重读
 *   clientId,
 *   onNewOps: () => { void sync(); },    // 收到信号就跑一次普通 HTTP 同步
 * });
 * rt.connect();
 * // 卸载时：
 * rt.dispose();
 * ```
 */
export function createRealtimeClient(options: RealtimeClientOptions): RealtimeClient {
  return new RealtimeClientImpl(options);
}
