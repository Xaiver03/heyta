/**
 * 真正的端到端 stdio 测试
 * =========================
 *
 * 🔴 与 `mcp-stdio-server.spec.ts` 的区别：
 *
 * 那个文件用**内存流**测 `startMcpStdioServer` —— 快、稳、能测边界。
 * 但它证明不了**产物能不能被真的拉起**：`tsup` 有没有把入口打出来、
 * 环境变量有没有读到、`process.exit` 的时机对不对、stdout 上会不会
 * 混进 Node 自己的警告。
 *
 * 这个文件**真的 spawn 一个子进程**，用管道跟它说 JSON-RPC。
 * 这是"没有真实 MCP 客户端"这个缺口能补上的最接近的一层。
 *
 * ⚠️ 需要先 `pnpm --filter @heyta/node-host build`。产物不存在时**跳过**，
 * 而不是红 —— 单跑测试不该强制先构建。
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CLI = join(HERE, '..', 'dist', 'cli-mcp.js');

const built = existsSync(CLI);
const describeBuilt = built ? describe : describe.skip;

const TOKEN = 'tok_e2e_stdio_xyz';

let dir: string;
let configPath: string;
let dbPath: string;

beforeAll(() => {
  if (!built) return;
  dir = mkdtempSync(join(tmpdir(), 'heyta-mcp-e2e-'));
  configPath = join(dir, 'local-api.json');
  dbPath = join(dir, 'heyta.db');
});

afterAll(() => {
  if (!built) return;
  rmSync(dir, { recursive: true, force: true });
});

function writeConfig(config: unknown): void {
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
}

interface Session {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * 拉起子进程、喂几行、收 stdout/stderr 和退出码。
 *
 * 🔴 stdout 与 stderr **分开收集** —— 这正是要验证的那条边界。
 */
function run(
  lines: readonly string[],
  options: { token?: string | undefined; config?: unknown; env?: Record<string, string> } = {},
): Promise<Session> {
  if (options.config !== undefined) writeConfig(options.config);

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HEYTA_DB_PATH: dbPath,
    HEYTA_LOCAL_API_CONFIG: configPath,
    ...options.env,
  };
  // 🔴 token 走环境变量（stdio 没有 HTTP 头可挂）
  if (options.token === undefined) delete env['HEYTA_LOCAL_API_TOKEN'];
  else env['HEYTA_LOCAL_API_TOKEN'] = options.token;

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString('utf8');
    });
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
    });
    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code });
    });
    for (const line of lines) child.stdin.write(`${line}\n`);
    child.stdin.end();
  });
}

const BASE_CONFIG = {
  enabled: true,
  bindAddress: '127.0.0.1',
  port: 47_119,
  token: TOKEN,
  grants: { list_tasks: true, get_task: true },
};

function parseStdout(stdout: string): unknown[] {
  return stdout
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as unknown);
}

// ─────────────────────────────────────────────────────────────────────────

describeBuilt('🔴 产物能被真的拉起', () => {
  it('🔴 没有配置文件 → 明确失败，且理由在 stderr', async () => {
    const session = await run([], { env: { HEYTA_LOCAL_API_CONFIG: join(dir, '不存在.json') } });
    expect(session.exitCode).toBe(1);
    expect(session.stderr).toContain('找不到本地 API 配置');
    // 🔴 stdout 上一个字节都没有
    expect(session.stdout).toBe('');
  });

  it('🔴 总开关关着 → 明确失败（不是"默认全开"）', async () => {
    const session = await run([], { config: { ...BASE_CONFIG, enabled: false }, token: TOKEN });
    expect(session.exitCode).toBe(1);
    expect(session.stderr).toContain('总开关是关着的');
    expect(session.stdout).toBe('');
  });

  it('🔴 配置不是合法 JSON → 明确失败', async () => {
    writeFileSync(configPath, '{ 这不是 json');
    const session = await run([], { token: TOKEN });
    expect(session.exitCode).toBe(1);
    expect(session.stderr).toContain('不是合法 JSON');
  });
});

describeBuilt('🔴 真实子进程上的协议往返', () => {
  it('🔴🔴 stdout 上只有合法 JSON-RPC，一行杂质都没有', async () => {
    const session = await run(
      [
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      ],
      { config: BASE_CONFIG, token: TOKEN },
    );

    const lines = session.stdout.split('\n').filter((l) => l.trim() !== '');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const parsed = JSON.parse(line) as { jsonrpc?: string };
      expect(parsed.jsonrpc).toBe('2.0');
    }
    // 启动说明在 stderr，不在 stdout
    expect(session.stderr).toContain('heyta MCP (stdio)');
    expect(session.stdout).not.toContain('heyta MCP');
  });

  it('🔴 initialize 返回 heyta', async () => {
    const session = await run(
      [JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })],
      { config: BASE_CONFIG, token: TOKEN },
    );
    const msgs = parseStdout(session.stdout) as { result?: { serverInfo?: { name: string } } }[];
    expect(msgs[0]?.result?.serverInfo?.name).toBe('heyta');
  });

  it('🔴 只列出已授权的工具（配置里只授了两个）', async () => {
    const session = await run(
      [JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })],
      { config: BASE_CONFIG, token: TOKEN },
    );
    const msgs = parseStdout(session.stdout) as { result?: { tools: { name: string }[] } }[];
    expect(msgs[0]?.result?.tools.map((t) => t.name).sort()).toEqual(['get_task', 'list_tasks']);
  });

  it('🔴🔴 没有 token → 拒绝，且**不返回工具列表**', async () => {
    const session = await run(
      [JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })],
      { config: BASE_CONFIG, token: undefined },
    );
    const msgs = parseStdout(session.stdout) as { error?: unknown; result?: unknown }[];
    expect(msgs[0]?.error).toBeDefined();
    expect(msgs[0]?.result).toBeUndefined();
  });

  it('🔴 token 不对 → 拒绝', async () => {
    const session = await run(
      [JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })],
      { config: BASE_CONFIG, token: '错误的 token' },
    );
    const msgs = parseStdout(session.stdout) as { error?: unknown }[];
    expect(msgs[0]?.error).toBeDefined();
  });

  it('🔴 未授权的工具 → 报"没有这个方法"（不暴露它存在）', async () => {
    const session = await run(
      [
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'complete_task', arguments: { id: 'x' } },
        }),
      ],
      { config: BASE_CONFIG, token: TOKEN },
    );
    const msgs = parseStdout(session.stdout) as { error?: { code: number } }[];
    expect(msgs[0]?.error?.code).toBe(-32_601);
  });

  it('🔴 授权过的读取工具在真实数据库上工作', async () => {
    const session = await run(
      [
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'list_tasks', arguments: {} },
        }),
      ],
      { config: BASE_CONFIG, token: TOKEN },
    );
    const msgs = parseStdout(session.stdout) as {
      result?: { content?: { text: string }[] };
      error?: unknown;
    }[];
    // 空库 → 合法的空列表，不是错误
    expect(msgs[0]?.error).toBeUndefined();
    expect(msgs[0]?.result?.content?.[0]?.text).toBeDefined();
  });

  it('🔴 坏 JSON → 回协议错误，不崩', async () => {
    const session = await run(['{ 坏掉的'], { config: BASE_CONFIG, token: TOKEN });
    const msgs = parseStdout(session.stdout) as { error?: { code: number } }[];
    expect(msgs[0]?.error?.code).toBe(-32_700);
  });

  it('🔴 绑定地址不从配置文件读（写歪了也不影响）', async () => {
    const session = await run(
      [JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })],
      { config: { ...BASE_CONFIG, bindAddress: '0.0.0.0' }, token: TOKEN },
    );
    // stdio 本来就不监听，关键是不能因为它崩掉或拒绝启动
    const msgs = parseStdout(session.stdout) as { result?: unknown }[];
    expect(msgs[0]?.result).toBeDefined();
  });
});

describeBuilt('打包产物自检', () => {
  it('🔴 产物里没有把 node: 前缀去掉（AGENTS.md §7 第 18 条）', async () => {
    const session = await run(
      [JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })],
      { config: BASE_CONFIG, token: TOKEN },
    );
    // 一旦 removeNodeProtocol 被打开，这里会是 ERR_MODULE_NOT_FOUND
    expect(session.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(session.exitCode).toBe(0);
  });

  it('进程在 stdin 关闭后正常退出（不会挂着）', async () => {
    const session = await run([JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })], {
      config: BASE_CONFIG,
      token: TOKEN,
    });
    expect(session.exitCode).toBe(0);
  });
});

describeBuilt('🔴🔴 真实客户端会发的通知', () => {
  it('🔴🔴 initialize 之后紧跟 notifications/initialized → **只有一条**响应', async () => {
    // 真实 MCP 客户端在 initialize 之后**立刻**发这条通知。
    // 如果服务端回了它，客户端会认为服务端违约。
    const session = await run(
      [
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      ],
      { config: BASE_CONFIG, token: TOKEN },
    );

    const lines = session.stdout.split('\n').filter((l) => l.trim() !== '');
    // 🔴 两条请求，**一条**响应
    expect(lines).toHaveLength(1);
    const msg = JSON.parse(lines[0]!) as { id?: number; error?: unknown };
    expect(msg.id).toBe(1);
    expect(msg.error).toBeUndefined();
  });

  it('🔴 通知不产生 -32601（那是违约，不是"宽容"）', async () => {
    const session = await run(
      [JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled' })],
      { config: BASE_CONFIG, token: TOKEN },
    );
    expect(session.stdout.trim()).toBe('');
  });

  it('🔴 通知之后有 id 的请求仍被正常处理', async () => {
    const session = await run(
      [
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' }),
      ],
      { config: BASE_CONFIG, token: TOKEN },
    );
    const lines = session.stdout.split('\n').filter((l) => l.trim() !== '');
    expect(lines).toHaveLength(1);
    expect((JSON.parse(lines[0]!) as { id: number }).id).toBe(7);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🔴🔴 写入路径的真实端到端证明
//
// 本文件此前的 `tools/call` 只跑过**空库上的只读工具**（BASE_CONFIG 只授权
// `list_tasks` / `get_task`）。也就是说：
//
//   **真实二进制上的写入路径，从来没有被执行过一次。**
//
// 而"写入必须经 op-log 的 dispatch()"是 AI-5 的核心约束之一。
// 它此前只在单元层被证明过（"端口是 dispatch 形状的"）——
// 那只证明**接口长得对**，不证明**真的写进去了**。
//
// 下面用**两个进程**证明：A 进程建任务，B 进程读得到。
// 跨进程 = 真的落到了库里（而不是留在内存里）。
// ═══════════════════════════════════════════════════════════════════════════

const WRITE_GRANTS = {
  enabled: true,
  bindAddress: '127.0.0.1',
  port: 47_121,
  token: TOKEN,
  grants: { list_tasks: true, get_task: true, create_task: true },
};

/** 每个测试用**独立**数据库，避免互相污染。 */
function freshDb(name: string): string {
  return join(dir, `write-${name}.db`);
}

const rpc = (id: number, method: string, params?: unknown): string =>
  JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });

/** 一次完整握手。真实客户端在 initialize 之后**必发** notifications/initialized。 */
const HANDSHAKE = [
  rpc(1, 'initialize'),
  JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
];

function textOf(msg: unknown): string {
  const m = msg as { result?: { content?: readonly { text?: string }[] } };
  return (m.result?.content ?? []).map((c) => c.text ?? '').join('\n');
}

describeBuilt('🔴🔴 写入真的经 op-log 落库（真实二进制 + 跨进程）', () => {
  it('🔴🔴 进程 A 建任务，进程 B 读得到 —— 证明真的落库了', async () => {
    const db = freshDb('persist');
    const env = { HEYTA_DB_PATH: db };

    // ── 进程 A：写
    const a = await run(
      [
        ...HANDSHAKE,
        rpc(2, 'tools/call', { name: 'create_task', arguments: { title: '端到端写入验证' } }),
      ],
      { config: WRITE_GRANTS, token: TOKEN, env },
    );
    const aMsgs = parseStdout(a.stdout) as unknown[];
    // initialize + create_task（通知**不该**有回复）
    expect(aMsgs).toHaveLength(2);
    expect(a.exitCode).toBe(0);
    const created = aMsgs[1] as { error?: unknown };
    expect(created.error).toBeUndefined();

    // ── 进程 B：读（全新进程，全新连接）
    const b = await run([...HANDSHAKE, rpc(2, 'tools/call', { name: 'list_tasks', arguments: {} })], {
      config: WRITE_GRANTS,
      token: TOKEN,
      env,
    });
    const bMsgs = parseStdout(b.stdout) as unknown[];
    expect(bMsgs).toHaveLength(2);

    // 🔴 这是本 objective 的核心断言：
    // 换一个进程还能读到 → 写入真的经过了 op-log → storage
    expect(textOf(bMsgs[1])).toContain('端到端写入验证');
  });

  it('🔴 通知（notifications/initialized）在真实进程里**不产生任何 stdout**', async () => {
    const db = freshDb('notif');
    const s = await run(
      [
        rpc(1, 'initialize'),
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        rpc(2, 'tools/list'),
      ],
      { config: WRITE_GRANTS, token: TOKEN, env: { HEYTA_DB_PATH: db } },
    );
    const msgs = parseStdout(s.stdout) as { id?: number }[];
    // 三行请求 → **两行**回复。多一行就说明通知被回复了（真实客户端会报错）
    expect(msgs).toHaveLength(2);
    expect(msgs.map((m) => m.id)).toEqual([1, 2]);
  });

  it('🔴🔴 没授权的写工具必须**拒绝，且不产生副作用**', async () => {
    const db = freshDb('denied');
    const env = { HEYTA_DB_PATH: db };
    const readOnly = { ...WRITE_GRANTS, grants: { list_tasks: true } };

    const a = await run(
      [
        ...HANDSHAKE,
        rpc(2, 'tools/call', { name: 'create_task', arguments: { title: '不该被创建' } }),
      ],
      { config: readOnly, token: TOKEN, env },
    );
    const aMsgs = parseStdout(a.stdout) as { error?: { code: number } }[];
    expect(aMsgs[1]?.error).toBeDefined();

    // 🔴 光断言"报错了"不够 —— 还要证明**真的没写进去**
    const b = await run([...HANDSHAKE, rpc(2, 'tools/call', { name: 'list_tasks', arguments: {} })], {
      config: readOnly,
      token: TOKEN,
      env,
    });
    const bMsgs = parseStdout(b.stdout) as unknown[];
    expect(textOf(bMsgs[1])).not.toContain('不该被创建');
  });

  it('🔴 token 不对时，写请求在真实进程里被拒', async () => {
    const db = freshDb('badtoken');
    const s = await run(
      [
        ...HANDSHAKE,
        rpc(2, 'tools/call', { name: 'create_task', arguments: { title: '不该被创建' } }),
      ],
      { config: WRITE_GRANTS, token: 'WRONG_TOKEN', env: { HEYTA_DB_PATH: db } },
    );
    expect(s.stdout).toContain('error');
    expect(s.stdout).not.toContain('不该被创建');
  });

  it('🔴 写工具的必填参数缺失时报 invalidParams，而不是崩掉', async () => {
    const db = freshDb('noval');
    const s = await run(
      [...HANDSHAKE, rpc(2, 'tools/call', { name: 'create_task', arguments: {} })],
      { config: WRITE_GRANTS, token: TOKEN, env: { HEYTA_DB_PATH: db } },
    );
    const msgs = parseStdout(s.stdout) as { error?: { code: number } }[];
    expect(msgs[1]?.error?.code).toBe(-32_602);
    expect(s.exitCode).toBe(0);
  });
});
