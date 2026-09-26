/**
 * 本地 API 协议处理测试
 * ======================
 *
 * 这个文件测的是"**从收到请求到决定回什么**"这一段，不含传输。
 *
 * 三条承重断言：
 *
 *   1. 🔴 **写只通过 `host.submit` 发生** —— 用记账的假 host 数出来。
 *      这是"写入必须经 `dispatch()`"在包边界上唯一能被证明的部分。
 *   2. 🔴 **受保护条目读不到正文，且 `get_task` 明确报错**（不是空结果）
 *   3. 🔴 **未授权的工具在 `tools/list` 里看不见，调用时报"没有这个方法"**
 */

import { describe, expect, it } from 'vitest';

import {
  JSON_RPC_ERRORS,
  createLocalApiHandler,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type LocalApiConfig,
  type LocalApiHost,
  type LocalApiItem,
  type LocalApiWriteIntent,
  type LocalApiWriteResult,
} from '../src/index.js';

const TOKEN = 'tok_abc123';

const CONFIG: LocalApiConfig = {
  enabled: true,
  bindAddress: '127.0.0.1',
  port: 47_119,
  token: TOKEN,
  grants: {
    list_tasks: true,
    get_task: true,
    list_projects: true,
    create_task: true,
    update_task: true,
    complete_task: true,
  },
};

/** 只授权一部分 —— 用来测"未授权的调不动"。 */
const RESTRICTED: LocalApiConfig = {
  ...CONFIG,
  grants: { list_tasks: true, get_task: true, list_projects: true, create_task: true },
};

const TASKS: readonly LocalApiItem[] = [
  { id: 't1', title: '交周报', body: '附上图表', readable: true },
  {
    id: 't2',
    title: '体检报告',
    dueDate: '2026-10-01',
    body: '身份证号 110101...',
    readable: false,
  },
];

/** 记账的假 host —— **本文件最重要的测试工具**。 */
function recordingHost() {
  const submitted: LocalApiWriteIntent[] = [];
  const calls: string[] = [];
  const host: LocalApiHost = {
    listTasks: (args) => {
      calls.push('listTasks');
      return Promise.resolve(
        args.completed === undefined ? TASKS : TASKS.filter((t) => t.completed === args.completed),
      );
    },
    getTask: (id) => {
      calls.push('getTask');
      return Promise.resolve(TASKS.find((t) => t.id === id));
    },
    listProjects: () => {
      calls.push('listProjects');
      return Promise.resolve([{ id: 'p1', name: '工作', taskCount: 3 }]);
    },
    submit: (intent) => {
      calls.push('submit');
      submitted.push(intent);
      return Promise.resolve<LocalApiWriteResult>({ ok: true, taskId: 'new-1' });
    },
  };
  return { host, submitted, calls };
}

function handler(config: LocalApiConfig = CONFIG, host?: LocalApiHost) {
  const rec = recordingHost();
  const h = createLocalApiHandler({
    host: host ?? rec.host,
    getConfig: () => config,
    now: () => 1_000,
  });
  return { handle: h, ...rec };
}

function req(method: string, params?: unknown, id: string | number = 1): JsonRpcRequest {
  return { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
}

/** 从响应里取出工具返回的文本内容。 */
function textOf(response: JsonRpcResponse): string {
  const r = response as { result?: { content?: readonly { text: string }[] } };
  return r.result?.content?.[0]?.text ?? '';
}

// ─────────────────────────────────────────────────────────────────────────

/**
 * 断言"这是一个响应，不是通知的静默丢弃"。
 *
 * `LocalApiHandler` 现在会返回 `undefined` 表示**这是一条通知、不该回复**。
 * 本文件里除通知那组之外，发的都带 `id`，所以应该永远拿到响应 ——
 * 这个 helper 把那件事变成一条**断言**，而不是一个 `!`。
 */
function expectResponse<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  return value as T;
}

describe('会话闸门 —— token 与总开关', () => {
  it('没带 token 时，任何方法都拒绝', async () => {
    const { handle } = handler();
    for (const method of ['initialize', 'tools/list', 'tools/call']) {
      const res = expectResponse(await handle(req(method), undefined));
      expect('error' in res, method).toBe(true);
    }
  });

  it('token 错误时同样拒绝', async () => {
    const { handle } = handler();
    const res = expectResponse(await handle(req('initialize'), 'wrong'));
    expect('error' in res).toBe(true);
  });

  it('总开关关着时拒绝（即使 token 对）', async () => {
    const { handle } = handler({ ...CONFIG, enabled: false });
    const res = expectResponse(await handle(req('initialize'), TOKEN));
    expect('error' in res).toBe(true);
    if ('error' in res) expect(res.error.message).toContain('未启用');
  });

  it('🔴 没带 token 与"方法不存在"给出**不同**的错误（前者是会话问题）', async () => {
    const { handle } = handler();
    const noToken = expectResponse(await handle(req('initialize'), undefined));
    const badMethod = expectResponse(await handle(req('no/such'), TOKEN));
    expect('error' in noToken).toBe(true);
    expect('error' in badMethod).toBe(true);
    if ('error' in noToken && 'error' in badMethod) {
      // 会话问题必须先于方法名被检查出来
      expect(noToken.error.message).toContain('token');
      expect(badMethod.error.code).toBe(JSON_RPC_ERRORS.methodNotFound);
    }
  });
});

describe('initialize', () => {
  it('返回协议版本与服务名', async () => {
    const { handle } = handler();
    const res = expectResponse(await handle(req('initialize'), TOKEN));
    expect('result' in res).toBe(true);
    const r = (res as { result: { serverInfo: { name: string }; protocolVersion: string } }).result;
    expect(r.serverInfo.name).toBe('heyta');
    expect(r.protocolVersion).toBeTruthy();
  });

  it('没有任何工具被授权时，说明这一点', async () => {
    const { handle } = handler({ ...CONFIG, grants: {} });
    const res = expectResponse(await handle(req('initialize'), TOKEN));
    const r = (res as { result: { instructions: string } }).result;
    expect(r.instructions).toContain('没有任何工具被授权');
  });
});

describe('🔴 tools/list —— 未授权的工具不可见', () => {
  it('只列出已授权的工具', async () => {
    const { handle } = handler();
    const res = expectResponse(await handle(req('tools/list'), TOKEN));
    const tools = (res as { result: { tools: readonly { name: string }[] } }).result.tools;
    expect(tools).toHaveLength(6);
    // 限制授权后只剩 4 个
    const restricted = handler(RESTRICTED);
    const r2 = await restricted.handle(req('tools/list'), TOKEN);
    const names = (r2 as { result: { tools: readonly { name: string }[] } }).result.tools.map((t) => t.name);
    expect(names).toEqual(['list_tasks', 'get_task', 'list_projects', 'create_task']);
    expect(JSON.stringify(names)).not.toContain('complete_task');
  });

  it('没有任何授权时列表为空', async () => {
    const { handle } = handler({ ...CONFIG, grants: {} });
    const res = expectResponse(await handle(req('tools/list'), TOKEN));
    const tools = (res as { result: { tools: readonly unknown[] } }).result.tools;
    expect(tools).toHaveLength(0);
  });
});

describe('🔴🔴 读操作：受保护条目', () => {
  it('🔴 list_tasks 返回受保护条目的**元数据但无正文**', async () => {
    const { handle } = handler();
    const res = expectResponse(await handle(req('tools/call', { name: 'list_tasks', arguments: {} }), TOKEN));
    const text = textOf(res);

    expect(text).toContain('体检报告'); // 存在可见
    expect(text).not.toContain('身份证号'); // 内容不可见
    expect(text).toContain('交周报');
    expect(text).toContain('附上图表'); // 可读条目的正文正常
  });

  it('🔴 get_task 对受保护条目**报错**，不是返回空结果', async () => {
    const { handle } = handler();
    const res = expectResponse(await handle(req('tools/call', { name: 'get_task', arguments: { taskId: 't2' } }), TOKEN));
    expect('error' in res).toBe(true);
    if ('error' in res) {
      expect(res.error.message).toContain('受保护');
      expect(res.error.message).toContain('不是错误');
    }
  });

  it('get_task 对可读条目正常返回正文', async () => {
    const { handle } = handler();
    const res = expectResponse(await handle(req('tools/call', { name: 'get_task', arguments: { taskId: 't1' } }), TOKEN));
    expect(textOf(res)).toContain('附上图表');
  });

  it('get_task 找不到时返回明确的"没找到"', async () => {
    const { handle } = handler();
    const res = expectResponse(await handle(req('tools/call', { name: 'get_task', arguments: { taskId: 'nope' } }), TOKEN));
    expect(textOf(res)).toContain('没有找到');
  });

  it('get_task 缺 taskId → invalidParams', async () => {
    const { handle } = handler();
    const res = expectResponse(await handle(req('tools/call', { name: 'get_task', arguments: {} }), TOKEN));
    if ('error' in res) expect(res.error.code).toBe(JSON_RPC_ERRORS.invalidParams);
    else throw new Error('应当报错');
  });

  it('list_projects 正常返回', async () => {
    const { handle } = handler();
    const res = expectResponse(await handle(req('tools/call', { name: 'list_projects', arguments: {} }), TOKEN));
    expect(textOf(res)).toContain('工作');
  });
});

describe('🔴🔴 写操作：只经 host.submit', () => {
  it('🔴 create_task 会**恰好调用一次** host.submit，且 intent 形状正确', async () => {
    const { handle, submitted, calls } = handler();
    const res = expectResponse(await handle(
      req('tools/call', { name: 'create_task', arguments: { title: '买咖啡豆', dueDate: '2026-10-01' } }),
      TOKEN,
    ));

    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toEqual({
      action: 'create-task',
      title: '买咖啡豆',
      dueDate: '2026-10-01',
    });
    // 除了 listTasks/getTask/listProjects/submit，没有别的数据访问路径
    expect(calls).toEqual(['submit']);
    expect('result' in res).toBe(true);
  });

  it('🔴 update_task / complete_task 同样只经 submit', async () => {
    const { handle, submitted } = handler();
    expectResponse(await handle(
      req('tools/call', { name: 'update_task', arguments: { taskId: 't1', fields: { title: '新标题' } } }),
      TOKEN,
    ));
    expectResponse(await handle(req('tools/call', { name: 'complete_task', arguments: { taskId: 't1' } }), TOKEN));
    expect(submitted.map((i) => i.action)).toEqual(['update-task', 'complete-task']);
  });

  it('create_task 缺 title → invalidParams，且**不调用** submit', async () => {
    const { handle, submitted } = handler();
    const res = expectResponse(await handle(req('tools/call', { name: 'create_task', arguments: {} }), TOKEN));
    if ('error' in res) expect(res.error.code).toBe(JSON_RPC_ERRORS.invalidParams);
    else throw new Error('应当报错');
    expect(submitted).toHaveLength(0);
  });

  it('submit 返回失败时，工具结果标记 isError 而不是协议错误', async () => {
    const failing: LocalApiHost = {
      listTasks: () => Promise.resolve([]),
      getTask: () => Promise.resolve(undefined),
      listProjects: () => Promise.resolve([]),
      submit: () => Promise.resolve({ ok: false, reason: 'invalid', message: '标题太长' }),
    };
    const { handle } = handler(CONFIG, failing);
    const res = expectResponse(await handle(req('tools/call', { name: 'create_task', arguments: { title: 'x' } }), TOKEN));
    expect('result' in res).toBe(true);
    const r = (res as { result: { isError?: boolean } }).result;
    expect(r.isError).toBe(true);
    expect(textOf(res)).toContain('标题太长');
  });

  it('🔴 未授权的写工具**调不动**（且报"没有这个方法"）', async () => {
    const { handle, submitted } = handler(RESTRICTED); // 没授权 complete_task
    const res = expectResponse(await handle(req('tools/call', { name: 'complete_task', arguments: { taskId: 't1' } }), TOKEN));
    expect('error' in res).toBe(true);
    if ('error' in res) expect(res.error.code).toBe(JSON_RPC_ERRORS.methodNotFound);
    expect(submitted).toHaveLength(0);
  });

  it('写入的动作集合是封闭的三种', async () => {
    const { handle, submitted } = handler();
    for (const [name, args] of [
      ['create_task', { title: 'a' }],
      ['update_task', { taskId: 't', fields: {} }],
      ['complete_task', { taskId: 't' }],
    ] as const) {
      expectResponse(await handle(req('tools/call', { name, arguments: args }), TOKEN));
    }
    expect([...new Set(submitted.map((i) => i.action))].sort()).toEqual([
      'complete-task',
      'create-task',
      'update-task',
    ]);
  });
});

describe('配置是**动态读取**的（撤销授权立即生效）', () => {
  it('🔴 运行中撤销授权后，同一个工具立刻调不动', async () => {
    let config: LocalApiConfig = { ...CONFIG };
    const rec = recordingHost();
    const handle = createLocalApiHandler({ host: rec.host, getConfig: () => config });

    const before = expectResponse(await handle(req('tools/call', { name: 'create_task', arguments: { title: 'x' } }), TOKEN));
    expect('result' in before).toBe(true);

    // 用户去设置里关掉了 create_task
    config = { ...CONFIG, grants: { list_tasks: true } };

    const after = expectResponse(await handle(req('tools/call', { name: 'create_task', arguments: { title: 'y' } }), TOKEN));
    expect('error' in after).toBe(true);
    expect(rec.submitted).toHaveLength(1); // 第二次没有落库
  });

  it('🔴 运行中关掉总开关，整个服务立刻不可用', async () => {
    let config: LocalApiConfig = { ...CONFIG };
    const rec = recordingHost();
    const handle = createLocalApiHandler({ host: rec.host, getConfig: () => config });

    config = { ...CONFIG, enabled: false };
    const res = expectResponse(await handle(req('tools/list'), TOKEN));
    expect('error' in res).toBe(true);
  });
});

describe('未知方法', () => {
  it('报 methodNotFound（会话合法时）', async () => {
    const { handle } = handler();
    const res = expectResponse(await handle(req('resources/list'), TOKEN));
    if ('error' in res) expect(res.error.code).toBe(JSON_RPC_ERRORS.methodNotFound);
    else throw new Error('应当报错');
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 通知（notification）不得有响应', () => {
  it('🔴🔴 没有 id 的请求返回 undefined —— 不回任何东西', async () => {
    const { host } = recordingHost();
    const handle = createLocalApiHandler({ host, getConfig: () => CONFIG });

    // 这正是 MCP 客户端在 initialize 之后立刻会发的
    const response = await handle(
      { jsonrpc: '2.0', method: 'notifications/initialized' } as never,
      CONFIG.token,
    );
    expect(response).toBeUndefined();
  });

  it('🔴 未知的通知方法也**不**回 -32601（回一条错误同样是违约）', async () => {
    const { host } = recordingHost();
    const handle = createLocalApiHandler({ host, getConfig: () => CONFIG });
    const response = await handle(
      { jsonrpc: '2.0', method: 'notifications/cancelled' } as never,
      CONFIG.token,
    );
    expect(response).toBeUndefined();
  });

  it('🔴 id 为 0 的请求**仍然要回**（0 是合法的 id，不能被当成"没有 id"）', async () => {
    const { host } = recordingHost();
    const handle = createLocalApiHandler({ host, getConfig: () => CONFIG });
    const response = await handle({ jsonrpc: '2.0', id: 0, method: 'tools/list' }, CONFIG.token);
    expect(response).toBeDefined();
    expect((response as { id: number }).id).toBe(0);
  });

  it('🔴 id 为空字符串的请求也要回', async () => {
    const { host } = recordingHost();
    const handle = createLocalApiHandler({ host, getConfig: () => CONFIG });
    const response = await handle({ jsonrpc: '2.0', id: '', method: 'tools/list' }, CONFIG.token);
    expect(response).toBeDefined();
  });

  it('🔴 未授权时的通知**也**是静默丢弃（不能靠响应差异探测）', async () => {
    const { host } = recordingHost();
    const handle = createLocalApiHandler({ host, getConfig: () => CONFIG });
    const response = await handle(
      { jsonrpc: '2.0', method: 'notifications/initialized' } as never,
      'wrong-token',
    );
    expect(response).toBeUndefined();
  });

  it('有 id 的请求行为不变（回归）', async () => {
    const { host } = recordingHost();
    const handle = createLocalApiHandler({ host, getConfig: () => CONFIG });
    const response = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize' }, CONFIG.token);
    expect(response).toBeDefined();
  });
});
