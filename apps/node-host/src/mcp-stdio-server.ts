/**
 * MCP stdio 传输
 * =================
 *
 * 把 `createLocalApiHandler` 接到**标准输入/输出**上，供 MCP 客户端
 * （Claude Desktop、各种编辑器插件）以子进程方式拉起。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 与 HTTP 壳的差别只有三件事，其余全部复用
 *
 * | | HTTP | stdio |
 * |---|---|---|
 * | 怎么收 | `POST /` body | **stdin 逐行** |
 * | 怎么回 | HTTP 响应 | **stdout 逐行** |
 * | token 从哪来 | `x-heyta-token` / `Authorization` 头 | **环境变量** |
 *
 * 授权判定、工具过滤、受保护条目、写入路径 —— **一行都没有重写**，
 * 因为它们都在 `@heyta/local-api` 里。这正是 ADR-0011 §3.6 分层的目的：
 * 换一种传输不该让规则多一份实现。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 🔴🔴 stdout 是**协议专用**的
 *
 * stdio 传输最容易犯、也最难查的错：往 stdout 打了一行日志。
 * MCP 客户端会把那行当成 JSON-RPC 消息去解析，然后**整条连接就废了** ——
 * 而报错通常只说"协议错误"，不会告诉你是哪一行。
 *
 * 所以：**本文件绝不用 `console.log`**。所有诊断走 `console.error`（stderr）。
 * 有测试断言"stdout 上只有合法 JSON-RPC"。
 *
 * ## 🔴 token 从环境变量来，且**必须有**
 *
 * stdio 没有 HTTP 头可挂。通行做法是从环境变量读。
 * ⚠️ 这与 HTTP 那边一样**不能省**：stdio 客户端是本机进程，
 * 但"是本机进程"不等于"是我授权的进程" —— 那正是 ADR-0011 §3.3 的论点。
 */

import type { Readable, Writable } from 'node:stream';

import { createLocalApiHandler, type LocalApiConfig, type LocalApiHost } from '@heyta/local-api';

/** 从哪个环境变量读 token。 */
export const TOKEN_ENV_VAR = 'HEYTA_LOCAL_API_TOKEN';

export interface McpStdioOptions {
  host: LocalApiHost;
  config: LocalApiConfig;
  getConfig?: () => LocalApiConfig;
  /** 输入流，默认 `process.stdin`。 */
  input?: Readable;
  /** 输出流，默认 `process.stdout`。**只写协议消息。** */
  output?: Writable;
  /** 诊断流，默认 `process.stderr`。 */
  diagnostics?: Writable;
  /**
   * 取 token。默认读 `process.env[TOKEN_ENV_VAR]`。
   *
   * 🔴 注入点：让测试能确定性地验证"没 token 就拒绝"，
   * 而不必真的改进程环境。
   */
  readToken?: () => string | undefined;
}

export interface McpStdioServer {
  /** 处理完所有输入后 resolve。`stdin` 关闭（EOF）即结束。 */
  done: Promise<void>;
  /** 主动停掉（幂等）。 */
  close(): void;
}

/**
 * 启动 stdio 服务。
 *
 * @throws 配置不合法或没有 token 时**拒绝启动** —— 与 HTTP 壳同一条纪律。
 */
export function startMcpStdioServer(options: McpStdioOptions): McpStdioServer {
  const { host, config } = options;
  const getConfig = options.getConfig ?? (() => config);
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const diagnostics = options.diagnostics ?? process.stderr;
  const readToken = options.readToken ?? (() => process.env[TOKEN_ENV_VAR]);

  if (!config.enabled) {
    throw new Error('MCP stdio 无法启动：总开关是关着的。');
  }
  if (config.token === undefined || config.token.trim() === '') {
    throw new Error('MCP stdio 无法启动：没有访问 token。');
  }

  const handle = createLocalApiHandler({ host, getConfig });

  // 🔴 不用 readline：它默认按 \n 切分，正好是 MCP stdio 的帧格式，
  // 但它会把整行解码成字符串、且对超长行没有上限。
  // 这里自己做缓冲，既能设上限，又能保证"只写协议消息"。
  const MAX_LINE_BYTES = 1_000_000;
  let buffer = '';
  let closed = false;
  let overflowed = false;

  let resolveDone: (() => void) | undefined;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  /** 写一行协议消息。**这是本文件唯一往 stdout 写东西的地方。** */
  function writeMessage(payload: unknown): void {
    if (closed) return;
    output.write(`${JSON.stringify(payload)}\n`);
  }

  function log(line: string): void {
    diagnostics.write(`[heyta-mcp] ${line}\n`);
  }

  async function handleLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (trimmed === '') return;

    let request: unknown;
    try {
      request = JSON.parse(trimmed);
    } catch {
      // 解析失败也是协议层的事 —— 回一个 JSON-RPC 错误，而不是崩掉。
      writeMessage({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32_700, message: 'JSON 解析失败。' },
      });
      return;
    }

    if (typeof request !== 'object' || request === null) {
      writeMessage({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32_600, message: '请求必须是一个对象。' },
      });
      return;
    }

    // 🔴 token 每次现读：用户在设置里换了 token 应当立刻生效，
    // 而不是要重启这个子进程。
    const response = await handle(
      request as Parameters<typeof handle>[0],
      readToken(),
    );
    // 🔴 `undefined` = 这是一条**通知**，按 JSON-RPC 规定不得回复。
    if (response !== undefined) writeMessage(response);
  }

  /** 处理缓冲里所有完整的行。 */
  async function drain(): Promise<void> {
    for (;;) {
      const index = buffer.indexOf('\n');
      if (index < 0) return;
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      try {
        await handleLine(line);
      } catch {
        // 🔴 处理器不该抛。真抛了就回一个内部错误，且**不泄漏堆栈**
        // （堆栈里可能有本机路径）。
        writeMessage({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32_603, message: '内部错误。' },
        });
      }
    }
  }

  const onData = (chunk: Buffer | string): void => {
    if (closed) return;
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (buffer.length > MAX_LINE_BYTES) {
      if (!overflowed) {
        overflowed = true;
        // 🔴 **真的关掉，不能只是丢掉缓冲。**
        //
        // 光丢缓冲是错的：那一行的**剩余部分还会继续到达**，
        // 于是它会被当成一条新消息去解析 —— 连接从此**失去同步**，
        // 后面全是 JSON 解析错误。
        //
        // 而且这里有安全含义：一个超长"单行"要么是客户端 bug，
        // 要么是有人在试探内存上限。两种都不该继续服务。
        log(`单行超过上限（${String(MAX_LINE_BYTES)} 字节），关闭连接。`);
        finish();
      }
      return;
    }
    // ⚠️ 不 await：`data` 回调不是 async 的。
    // 顺序由 Node 的事件循环保证（同一 tick 内不会被重入），
    // 且协议本身是按顺序一问一答的。
    void drain().catch(() => {
      /* drain 内部已兜底 */
    });
  };

  const onEnd = (): void => {
    // EOF：把最后一行（可能没有换行结尾）处理掉，然后结束。
    void (async () => {
      if (buffer.trim() !== '') {
        await handleLine(buffer);
      }
      finish();
    })();
  };

  function finish(): void {
    if (closed) return;
    closed = true;
    input.removeListener('data', onData);
    input.removeListener('end', onEnd);
    log('输入结束，退出。');
    resolveDone?.();
  }

  input.on('data', onData);
  input.on('end', onEnd);

  return {
    done,
    close: finish,
  };
}

/**
 * 命令行入口：`node dist/cli-mcp.js`。
 *
 * ⚠️ 刻意**不**在这里读数据库 —— 宿主（`openNodeHost` + `createLocalApiHost`）
 * 由调用方组装。这样这个文件保持"只做传输"。
 */
export function describeStdioStartup(host: LocalApiHost, config: LocalApiConfig): string {
  const granted = Object.entries(config.grants ?? {})
    .filter(([, on]) => on)
    .map(([name]) => name);
  return [
    'heyta MCP (stdio)',
    `  绑定：标准输入/输出`,
    `  已授权工具：${granted.length === 0 ? '（无 —— 客户端看不到任何工具）' : granted.join('、')}`,
    `  token 读取自：${TOKEN_ENV_VAR}`,
    `  宿主：${typeof host.listTasks === 'function' ? '已连接' : '未连接'}`,
  ].join('\n');
}
