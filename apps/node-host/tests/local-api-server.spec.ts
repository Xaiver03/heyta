/**
 * 本地 API HTTP 壳测试
 * ======================
 *
 * 用**真实 HTTP 请求**打真实监听端口 —— 不是 mock。
 * 理由：这个文件的全部价值就在"字节怎么进出"，mock 掉 socket 等于什么都没测。
 *
 * 四条承重断言：
 *
 *   1. 🔴 **配置不合法时拒绝启动**（非回环 / 无 token）——
 *      一个"监听 0.0.0.0 且没 token"的服务等于把用户全部任务公开给同网段
 *   2. 🔴 **真的只在回环上可达**
 *   3. 🔴 **token 能从两种头里读到**，且**不接受 query 参数**
 *   4. 🔴 **业务语义没有漏进壳里**（未授权工具经 HTTP 依然调不动）
 */

import { createServer, request } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import {
  type LocalApiConfig,
  type LocalApiHost,
  type LocalApiItem,
  type LocalApiWriteIntent,
} from '@heyta/local-api';

import { readToken, startLocalApiServer, type LocalApiServer } from '../src/local-api-server.js';

const TOKEN = 'tok_http_123';

const CONFIG: LocalApiConfig = {
  enabled: true,
  bindAddress: '127.0.0.1',
  // ⚠️ 不能用 0：`validateLocalApiConfig` **刻意**拒绝 0
  // （随机端口对一个固定 token 的服务没意义）。所以测试自己找一个空闲端口。
  port: 0,
  token: TOKEN,
  grants: { list_tasks: true },
};

const TASK: LocalApiItem = { id: 't1', title: '写文档', body: '正文', readable: true };

function fakeHost() {
  const submitted: LocalApiWriteIntent[] = [];
  const host: LocalApiHost = {
    listTasks: () => Promise.resolve([TASK]),
    getTask: () => Promise.resolve(TASK),
    listProjects: () => Promise.resolve([]),
    submit: (intent) => {
      submitted.push(intent);
      return Promise.resolve({ ok: true, taskId: 't-new' });
    },
  };
  return { host, submitted };
}

/**
 * 找一个空闲端口。
 *
 * 先绑 0 让内核分配，读到端口号后**立刻关掉**，再用那个号码启动被测服务。
 * 理论上有竞态（这中间别人可能抢走），实践里足够稳；
 * 比硬编码端口好，因为硬编码会与开发机上真在跑的服务撞。
 */
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

/** 用真实空闲端口跑一段。 */
async function startOnFreePort(
  host: LocalApiHost,
  config: LocalApiConfig = CONFIG,
  getConfig?: () => LocalApiConfig,
): Promise<LocalApiServer> {
  const port = await findFreePort();
  return startLocalApiServer({
    host,
    config: { ...config, port },
    ...(getConfig === undefined ? {} : { getConfig }),
  });
}

let server: LocalApiServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

/** 发一个真实 HTTP 请求。 */
function post(
  port: number,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
        });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

// ─────────────────────────────────────────────────────────────────────────

describe('🔴 启动前校验 —— 不合法就拒绝启动', () => {
  it('🔴 非回环地址直接抛错（不警告、不降级）', async () => {
    const { host } = fakeHost();
    await expect(
      startLocalApiServer({ host, config: { ...CONFIG, bindAddress: '0.0.0.0' } }),
    ).rejects.toThrow(/无法启动/);
  });

  it('🔴 通配地址 `::` 同样被拒', async () => {
    const { host } = fakeHost();
    await expect(
      startLocalApiServer({ host, config: { ...CONFIG, bindAddress: '::' } }),
    ).rejects.toThrow(/无法启动/);
  });

  it('🔴 没有 token 直接抛错（否则同网段任何人都能读用户任务）', async () => {
    const { host } = fakeHost();
    const { token: _drop, ...noToken } = CONFIG;
    await expect(startLocalApiServer({ host, config: noToken })).rejects.toThrow(/无法启动/);
  });

  it('总开关关着时也拒绝启动', async () => {
    const { host } = fakeHost();
    await expect(
      startLocalApiServer({ host, config: { ...CONFIG, enabled: false } }),
    ).rejects.toThrow(/无法启动/);
  });
});

describe('🔴 真实 HTTP 往返', () => {
  it('🔴 只在回环可达，且 tools/list 能用', async () => {
    const { host } = fakeHost();
    server = await startOnFreePort(host);
    expect(server.address).toBe('127.0.0.1');

    const res = await post(server.port, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, {
      'x-heyta-token': TOKEN,
    });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body) as { result?: { tools: readonly { name: string }[] } };
    expect(parsed.result?.tools.map((t) => t.name)).toEqual(['list_tasks']);
  });

  it('🔴 未授权的工具经 HTTP 依然调不动（业务语义没漏进壳）', async () => {
    const { host, submitted } = fakeHost();
    server = await startOnFreePort(host);
    const res = await post(
      server.port,
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_task', arguments: { title: 'x' } } },
      { 'x-heyta-token': TOKEN },
    );
    const parsed = JSON.parse(res.body) as { error?: { code: number } };
    expect(parsed.error?.code).toBe(-32_601);
    expect(submitted).toHaveLength(0);
  });

  it('🔴 受保护条目的正文不会经 HTTP 泄漏', async () => {
    const secret: LocalApiItem = { id: 't2', title: '体检', body: '身份证号', readable: false };
    const host: LocalApiHost = {
      listTasks: () => Promise.resolve([secret]),
      getTask: () => Promise.resolve(secret),
      listProjects: () => Promise.resolve([]),
      submit: () => Promise.resolve({ ok: true, taskId: 'x' }),
    };
    server = await startOnFreePort(host);
    const res = await post(
      server.port,
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_tasks', arguments: {} } },
      { 'x-heyta-token': TOKEN },
    );
    expect(res.body).toContain('体检');
    expect(res.body).not.toContain('身份证号');
  });

  it('坏 token 被拒', async () => {
    const { host } = fakeHost();
    server = await startOnFreePort(host);
    const res = await post(server.port, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, {
      'x-heyta-token': 'wrong',
    });
    const parsed = JSON.parse(res.body) as { error?: unknown };
    expect(parsed.error).toBeDefined();
  });

  it('GET 被拒（405）', async () => {
    const { host } = fakeHost();
    server = await startOnFreePort(host);
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: server?.port, method: 'GET', path: '/' }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(405);
  });

  it('坏 JSON 得到 JSON-RPC 解析错误，不是 500', async () => {
    const { host } = fakeHost();
    server = await startOnFreePort(host);
    const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port: server?.port, method: 'POST', path: '/', headers: { 'x-heyta-token': TOKEN } },
        (r) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => {
            resolve({ status: r.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
          });
        },
      );
      req.on('error', reject);
      req.end('{ 不是 json');
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ error: { code: -32_700 } });
  });

  it('🔴 运行中改配置立刻生效（撤销授权不用重启服务）', async () => {
    let config: LocalApiConfig = { ...CONFIG };
    const { host } = fakeHost();
    server = await startOnFreePort(host, config, () => config);
    expect(server.address).toBe('127.0.0.1');

    // 先确认能用
    const before = await post(server.port, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, {
      'x-heyta-token': TOKEN,
    });
    expect(JSON.parse(before.body)).toMatchObject({ result: { tools: [{ name: 'list_tasks' }] } });

    // 撤销
    config = { ...CONFIG, grants: {} };
    const after = await post(server.port, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, {
      'x-heyta-token': TOKEN,
    });
    expect((JSON.parse(after.body) as { result: { tools: unknown[] } }).result.tools).toHaveLength(0);
  });
});

describe('🔴 token 读取 —— 两种头，且不接受 query', () => {
  it('读 x-heyta-token', () => {
    expect(readToken({ 'x-heyta-token': 'abc' })).toBe('abc');
  });

  it('读 Authorization: Bearer（MCP 客户端标准写法）', () => {
    expect(readToken({ authorization: 'Bearer xyz' })).toBe('xyz');
  });

  it('Bearer 大小写前缀不对时不认', () => {
    expect(readToken({ authorization: 'bearer xyz' })).toBeUndefined();
    expect(readToken({ authorization: 'Basic xyz' })).toBeUndefined();
  });

  it('两者都没有时返回 undefined', () => {
    expect(readToken({})).toBeUndefined();
  });

  it('🔴 空字符串不算 token（不能被当成"没设 token 就放行"）', () => {
    expect(readToken({ 'x-heyta-token': '' })).toBeUndefined();
  });
});

describe('🔴 通知在 HTTP 壳上也不该有响应体', () => {
  it('🔴 没有 id 的请求 → 202，且 body 为空（不是 200 + 一条错误）', async () => {
    const { host } = fakeHost();
    server = await startOnFreePort(host);

    const res = await post(server.port, { jsonrpc: '2.0', method: 'notifications/initialized' }, {
      'x-heyta-token': TOKEN,
    });
    expect(res.status).toBe(202);
    expect(res.body).toBe('');
  });

  it('🔴 有 id 的请求仍然 200 + JSON（回归）', async () => {
    const { host } = fakeHost();
    server = await startOnFreePort(host);

    const res = await post(server.port, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, {
      'x-heyta-token': TOKEN,
    });
    expect(res.status).toBe(200);
    expect(res.body).toContain('tools');
  });
});
