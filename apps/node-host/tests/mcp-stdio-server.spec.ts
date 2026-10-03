/**
 * MCP stdio 传输测试
 * ====================
 *
 * 🔴 最重要的一条是 **stdout 纯净性**：
 * 一条混进 stdout 的日志会让 MCP 客户端把整条连接废掉，
 * 而报错只会说"协议错误"，不告诉你是哪一行。
 *
 * 用**内存流**测，不真的碰进程的 stdin/stdout ——
 * 测试不该劫持自己进程的标准流。
 */

import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  type LocalApiConfig,
  type LocalApiFocusSession,
  type LocalApiHabitLog,
  type LocalApiHost,
  type LocalApiItem,
  type LocalApiNoteRow,
  type LocalApiReminder,
  type LocalApiTag,
  type LocalApiWriteIntent,
} from '@heyta/local-api';

import {
  TOKEN_ENV_VAR,
  describeStdioStartup,
  startMcpStdioServer,
  type McpStdioOptions,
} from '../src/mcp-stdio-server.js';

const TOKEN = 'tok_stdio_abc';

const CONFIG: LocalApiConfig = {
  enabled: true,
  bindAddress: '127.0.0.1',
  port: 47_119,
  token: TOKEN,
  grants: { list_tasks: true, get_task: true, create_task: true },
};

const TASKS: readonly LocalApiItem[] = [
  { id: 't1', title: '写文档', body: '正文', readable: true },
  { id: 't2', title: '体检报告', body: '身份证号', readable: false },
];

function fakeHost() {
  const submitted: LocalApiWriteIntent[] = [];
  const host: LocalApiHost = {
    listTasks: () => Promise.resolve(TASKS),
    getTask: (id) => Promise.resolve(TASKS.find((t) => t.id === id)),
    listProjects: () => Promise.resolve([]),
    listHabits: () => Promise.resolve([]),
    listTags: () => Promise.resolve([] as readonly LocalApiTag[]),
    listNotes: () => Promise.resolve([] as readonly LocalApiNoteRow[]),
    getNote: () => Promise.resolve(undefined),
    listHabitLogs: () => Promise.resolve([] as readonly LocalApiHabitLog[]),
    listFocusSessions: () => Promise.resolve([] as readonly LocalApiFocusSession[]),
    listReminders: () => Promise.resolve([] as readonly LocalApiReminder[]),
    listEvents: () => Promise.resolve([]),
    getEvent: () => Promise.resolve(undefined),
    submit: (intent) => {
      submitted.push(intent);
      return Promise.resolve({ ok: true, taskId: 'new-1' });
    },
  };
  return { host, submitted };
}

/** 一个可控的 stdio 会话。 */
function startSession(overrides: Partial<McpStdioOptions> = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const diagnostics = new PassThrough();

  let out = '';
  let err = '';
  output.on('data', (c: Buffer) => {
    out += c.toString('utf8');
  });
  diagnostics.on('data', (c: Buffer) => {
    err += c.toString('utf8');
  });

  const { host, submitted } = fakeHost();
  const server = startMcpStdioServer({
    host,
    config: CONFIG,
    input,
    output,
    diagnostics,
    readToken: () => TOKEN,
    ...overrides,
  });

  return {
    input,
    server,
    submitted,
    stdout: () => out,
    stderr: () => err,
    /** 写一行进去。 */
    send(line: string) {
      input.write(`${line}\n`);
    },
    /** 解析出 stdout 上的所有消息。 */
    messages(): unknown[] {
      return out
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l) as unknown);
    },
    end() {
      input.end();
    },
  };
}

/** 等到输出里出现 n 条消息（或超时）。 */
async function waitForMessages(session: ReturnType<typeof startSession>, n: number): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (session.messages().length >= n) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`等不到 ${String(n)} 条消息，实际 ${String(session.messages().length)} 条`);
}

// ─────────────────────────────────────────────────────────────────────────

describe('🔴 启动前校验', () => {
  it('总开关关着 → 拒绝启动', () => {
    expect(() => startSession({ config: { ...CONFIG, enabled: false } })).toThrow(/总开关/);
  });

  it('🔴 没有 token → 拒绝启动（stdio 一样不能省）', () => {
    const { token: _drop, ...noToken } = CONFIG;
    expect(() => startSession({ config: noToken })).toThrow(/token/);
  });
});

describe('🔴🔴 stdout 纯净性', () => {
  it('🔴🔴 stdout 上只有合法 JSON-RPC，一行杂质都没有', async () => {
    const s = startSession();
    s.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
    s.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
    await waitForMessages(s, 2);

    const lines = s.stdout().split('\n').filter((l) => l.trim() !== '');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const parsed = JSON.parse(line) as { jsonrpc?: string; id?: number };
      // 每一行都得是 JSON-RPC 2.0 消息
      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.id).toBeDefined();
    }
  });

  it('🔴 诊断信息走 stderr，不走 stdout', async () => {
    const s = startSession();
    s.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
    await waitForMessages(s, 1);
    s.end();
    await s.server.done;

    // stderr 上有心跳说明
    expect(s.stderr()).toContain('[heyta-mcp]');
    // 而 stdout 上仍然只有协议消息
    expect(s.stdout()).not.toContain('[heyta-mcp]');
    for (const line of s.stdout().split('\n').filter((l) => l.trim() !== '')) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('🔴 坏 JSON 也只回一条协议错误，不往 stdout 打日志', async () => {
    const s = startSession();
    s.send('{ 这不是 json');
    await waitForMessages(s, 1);
    const msgs = s.messages() as { error?: { code: number } }[];
    expect(msgs[0]?.error?.code).toBe(-32_700);
    expect(s.stdout()).not.toContain('这不是 json');
  });
});

describe('协议往返', () => {
  it('initialize 返回服务名', async () => {
    const s = startSession();
    s.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
    await waitForMessages(s, 1);
    const msg = (s.messages() as { result?: { serverInfo?: { name: string } } }[])[0];
    expect(msg?.result?.serverInfo?.name).toBe('heyta');
  });

  it('🔴 tools/list 只列已授权的工具', async () => {
    const s = startSession();
    s.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    await waitForMessages(s, 1);
    const msg = (s.messages() as { result?: { tools: { name: string }[] } }[])[0];
    expect(msg?.result?.tools.map((t) => t.name)).toEqual(['list_tasks', 'get_task', 'create_task']);
  });

  it('🔴 受保护条目的正文不经 stdio 泄漏', async () => {
    const s = startSession();
    s.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_tasks', arguments: {} },
      }),
    );
    await waitForMessages(s, 1);
    const raw = s.stdout();
    expect(raw).toContain('体检报告');
    expect(raw).not.toContain('身份证号');
  });

  it('🔴 写入经 host.submit（HTTP 与 stdio 是同一条写入路径）', async () => {
    const s = startSession();
    s.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'create_task', arguments: { title: '买咖啡豆' } },
      }),
    );
    await waitForMessages(s, 1);
    expect(s.submitted).toHaveLength(1);
    expect(s.submitted[0]).toEqual({ action: 'create-task', title: '买咖啡豆' });
  });

  it('多行连续请求按顺序各自回一条', async () => {
    const s = startSession();
    for (let i = 1; i <= 3; i += 1) {
      s.send(JSON.stringify({ jsonrpc: '2.0', id: i, method: 'tools/list' }));
    }
    await waitForMessages(s, 3);
    const ids = (s.messages() as { id: number }[]).map((m) => m.id);
    expect(ids).toEqual([1, 2, 3]);
  });

  it('🔴 一行里塞两条（缺换行的边界）不会被误当成一条', async () => {
    const s = startSession();
    // 故意不带换行，最后靠 EOF 收尾
    s.input.write(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' }));
    await waitForMessages(s, 0).catch(() => undefined);
    expect(s.messages()).toHaveLength(0); // 还没换行 → 还没处理
    s.end();
    await s.server.done;
    // EOF 时兜底处理最后一行
    const msgs = s.messages() as { id?: number }[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.id).toBe(9);
  });

  it('空行被忽略（不产生消息）', async () => {
    const s = startSession();
    s.send('');
    s.send('   ');
    s.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    await waitForMessages(s, 1);
    expect(s.messages()).toHaveLength(1);
  });

  it('非对象请求回 -32600', async () => {
    const s = startSession();
    s.send('"just a string"');
    await waitForMessages(s, 1);
    expect((s.messages() as { error?: { code: number } }[])[0]?.error?.code).toBe(-32_600);
  });
});

describe('🔴 token 每次现读（改设置立刻生效，不用重启子进程）', () => {
  it('🔴 运行中换掉 token 后，旧 token 立刻失效', async () => {
    let token = TOKEN;
    const s = startSession({ readToken: () => token });
    s.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    await waitForMessages(s, 1);
    expect((s.messages()[0] as { result?: unknown }).result).toBeDefined();

    token = 'a-different-token';
    s.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
    await waitForMessages(s, 2);
    expect((s.messages()[1] as { error?: unknown }).error).toBeDefined();
  });

  it('🔴 没有 token 时拒绝（不是"stdin 就算授权"）', async () => {
    const s = startSession({ readToken: () => undefined });
    s.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    await waitForMessages(s, 1);
    expect((s.messages()[0] as { error?: unknown }).error).toBeDefined();
  });
});

describe('EOF 与关闭', () => {
  it('输入的 end 会让 done resolve', async () => {
    const s = startSession();
    s.end();
    await s.server.done;
    expect(s.stderr()).toContain('退出');
  });

  it('close 是幂等的', async () => {
    const s = startSession();
    s.server.close();
    s.server.close();
    await s.server.done;
  });

  it('关闭之后不再往 stdout 写东西', async () => {
    const s = startSession();
    s.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    await waitForMessages(s, 1);
    const before = s.stdout();
    s.server.close();
    s.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(s.stdout()).toBe(before);
  });
});

describe('describeStdioStartup', () => {
  it('🔴 没有授权工具时明说"客户端看不到任何工具"', () => {
    const { host } = fakeHost();
    const text = describeStdioStartup(host, { ...CONFIG, grants: {} });
    expect(text).toContain('客户端看不到任何工具');
  });

  it('列出已授权的工具名', () => {
    const { host } = fakeHost();
    const text = describeStdioStartup(host, CONFIG);
    expect(text).toContain('list_tasks');
    expect(text).not.toContain('complete_task');
  });

  it('说明 token 从哪个环境变量读', () => {
    const { host } = fakeHost();
    expect(describeStdioStartup(host, CONFIG)).toContain(TOKEN_ENV_VAR);
  });
});

describe('🔴🔴 超长单行：必须真的关闭，不能只是丢缓冲', () => {
  it('🔴🔴 超过上限的行会让连接关闭（done resolve）', async () => {
    const s = startSession();
    s.send(`{"jsonrpc":"2.0","id":1,"method":"${'x'.repeat(1_100_000)}"}`);
    // 真的关掉了 —— done 会 resolve
    await s.server.done;
    expect(s.stderr()).toContain('关闭连接');
  });

  it('🔴 关闭之后**不再**把那一行的残余当成新消息解析', async () => {
    const s = startSession();
    // 先发一个超长行的开头
    s.input.write(`{"jsonrpc":"2.0","id":1,"method":"${'y'.repeat(1_100_000)}`);
    await s.server.done;
    // 再把"剩余部分 + 一条合法请求"推进来
    s.send('","params":{}}');
    s.send(JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list' }));
    await new Promise((r) => setTimeout(r, 30));
    // 🔴 一条响应都不该有 —— 尤其不能有 id=99 的
    expect(s.messages()).toHaveLength(0);
  });

  it('正好在限内的行正常处理（上限不是紧到离谱）', async () => {
    const s = startSession();
    // 造一条合法但很大的 tools/list（用超长但合法的 id 撑大）
    const bigId = 'z'.repeat(200_000);
    s.send(JSON.stringify({ jsonrpc: '2.0', id: bigId, method: 'tools/list' }));
    await waitForMessages(s, 1);
    expect(s.messages()).toHaveLength(1);
  });
});
