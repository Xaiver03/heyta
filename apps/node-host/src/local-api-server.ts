/**
 * 本地 API HTTP 壳
 * =================
 *
 * 这个文件**只做一件事**：把 HTTP 上的字节变成 `JsonRpcRequest`，
 * 再把 `JsonRpcResponse` 写回 HTTP。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 它是壳，所以它必须是薄的。
 *
 * 判断标准（ADR-0003 / `host.ts` 顶部同一句话）：
 * **"这个文件里有没有任何一行在决定'业务上该怎么做'？"**
 *
 * 检查一遍：
 * - 收字节、解 JSON、挑 token 头 → 传输差异 ✅
 * - 认证与授权 → **不在**这里，在 `createLocalApiHandler`
 * - 工具该调什么、能不能读、写走哪条路 → **不在**这里，在 `@heyta/local-api` + `local-api-host.ts`
 *
 * 所以这个文件的作用就只剩：**决定怎么监听、怎么读 token**。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 🔴 启动前必须校验，且校验失败必须**拒绝启动**
 *
 * `validateLocalApiConfig` 会在非回环地址或没有 token 时报错。
 * 这里的处理是 **throw**（让进程启动失败），不是"警告一下继续跑"。
 *
 * 理由：一个"监听在 0.0.0.0 且没有 token"的本地 API 等于把用户全部任务
 * 公开给同一网络里的任何人，而**用户以为自己开的是"本机 API"**。
 * 这种情况下宁可起不来。
 */

import { createServer, type Server } from 'node:http';

import {
  createLocalApiHandler,
  validateLocalApiConfig,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type LocalApiConfig,
  type LocalApiHost,
} from '@heyta/local-api';

/** 请求体上限。超过就断开 —— 本机 API 不该收到大 body。 */
const MAX_BODY_BYTES = 1_000_000;

export interface LocalApiServerOptions {
  host: LocalApiHost;
  config: LocalApiConfig;
  /**
   * 取当前配置。
   *
   * 🔴 与处理器一样用**函数**：用户在设置里撤销授权后要立刻生效，
   * 不能等重启。不传时退回启动时的 `config` 快照。
   */
  getConfig?: () => LocalApiConfig;
}

export interface LocalApiServer {
  readonly port: number;
  readonly address: string;
  /** 关掉监听。幂等。 */
  close(): Promise<void>;
}

/**
 * 启动本地 API 服务。
 *
 * @throws 配置不合法（非回环 / 缺 token）时**拒绝启动**。
 */
export async function startLocalApiServer(options: LocalApiServerOptions): Promise<LocalApiServer> {
  const { host, config } = options;
  const getConfig = options.getConfig ?? (() => config);

  // 🔴 总开关关着时必须**拒绝启动**。
  //
  // 为什么不能只靠 `validateLocalApiConfig`：那个函数在 `enabled: false` 时
  // **故意直接返回 ok**，因为设置页面需要"保存一份关着的配置"。
  // 但"能保存"和"能监听"是两件事 —— 后者必须再问一次。
  if (!config.enabled) {
    throw new Error('本地 API 无法启动：总开关是关着的。');
  }

  // 🔴 启动前校验。失败就抛，**不降级**。
  const verdict = validateLocalApiConfig(config);
  if (!verdict.ok) {
    throw new Error(`本地 API 无法启动：${verdict.message}`);
  }

  const handle = createLocalApiHandler({ host, getConfig });

  const server: Server = createServer((req, res) => {
    void (async () => {
      // 只接受 POST —— JSON-RPC 不该走 GET（GET 会被浏览器地址栏、
      // 日志、Referer 更容易泄漏，而 token 是必须带的）。
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: '只接受 POST' }));
        return;
      }

      let body: string;
      try {
        body = await readBody(req);
      } catch {
        res.writeHead(413, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: '请求体过大' }));
        return;
      }

      let parsed: JsonRpcRequest;
      try {
        parsed = JSON.parse(body) as JsonRpcRequest;
      } catch {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32_700, message: 'JSON 解析失败。' },
          }),
        );
        return;
      }

      const response: JsonRpcResponse | undefined = await handle(parsed, readToken(req.headers));

      // 🔴 `undefined` = 通知，按 JSON-RPC 规定不得有响应体。
      // 用 202 Accepted 而不是 200 —— 语义是"收到了，没什么可回的"。
      if (response === undefined) {
        res.writeHead(202);
        res.end();
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(response));
    })().catch(() => {
      // 处理器不该抛；真抛了就回一个通用的内部错误，且**不泄漏堆栈**
      // （堆栈里可能有路径等本机信息）。
      if (!res.headersSent) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32_603, message: '内部错误。' },
          }),
        );
      } else {
        res.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // 🔴 绑定地址来自配置，而配置已被校验为**回环**。
    // 这里不再自己判断一次 —— 判断只该有一个地方（`isLoopbackAddress`）。
    server.listen(config.port, config.bindAddress, () => {
      resolve();
    });
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : config.port;

  return {
    port,
    address: config.bindAddress,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

/**
 * 从请求头里读 token。
 *
 * 支持两种写法：
 * - `x-heyta-token: <token>` —— 本机 API 自己的写法
 * - `authorization: Bearer <token>` —— MCP 客户端的标准写法
 *
 * ⚠️ 刻意**不支持** query 参数（`?token=`）：
 * query 会进访问日志、进 shell 历史、进 Referer。
 * （对照 SSOS 的 `GET /balance` 也明确拒绝 query 传 key。）
 */
export function readToken(headers: Record<string, string | string[] | undefined>): string | undefined {
  const direct = headers['x-heyta-token'];
  if (typeof direct === 'string' && direct !== '') return direct;

  const auth = headers['authorization'];
  const value = Array.isArray(auth) ? auth[0] : auth;
  if (typeof value === 'string' && value.startsWith('Bearer ')) {
    return value.slice('Bearer '.length);
  }
  return undefined;
}

function readBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}
