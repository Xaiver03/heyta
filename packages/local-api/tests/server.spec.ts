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
    // 🔴 2026-10-03 更正：这里原本是 `expect(text).toContain('附上图表')`，
    // 注释写着"可读条目的正文正常"。那句**与工具自己的契约相反** ——
    // `list_tasks` 的目录描述是"不返回备注正文 —— 备注要单独用 get_task 取"，
    // 它的 `egressFields` 里也**没有** `task.body`（那份声明是给用户看、
    // 并且是助手出境复查的唯一依据）。实现跟着宿主侧那个"列表与详情共用
    // `taskToItem`"走了，测试又跟着实现走了，于是承诺和现实各说各话。
    // 现在按**承诺**钉：列表里正文不出现，正文只在 `get_task` 出（下一条测试）。
    expect(text).not.toContain('附上图表');
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
// 🔴🔴 `list_tasks` 的日期参数
// ─────────────────────────────────────────────────────────────────────────
//
// 这组用例守的是 `list.today` 那条缺陷（AI-G3 / 计划 W3）的**契约半边**：
// 日期参数存在、被校验、被如实递给宿主，且**校验不成立时绝不降级**。
//
// 🔴 每条拒绝用例都额外断言"宿主一次都没被调用"。这一条才是牙齿：
// "报错"和"忽略这个参数、照样返回全量前 N 条"在响应上长得几乎一样，
// 而后者正是原缺陷的形状 —— 只断言 `invalidParams` 的话，
// 把 `return { ok: false }` 改成 `// 忽略` 照样全绿。
//
// 至于"筛出来的到底是不是那几天"，判据在**宿主层**的用例里
// （`packages/app-host/tests/local-api-host-due-filter.spec.ts`）——
// 那才是"结果集"，本包的假 host 给不出真结果。

/** 记录收到的查询条件的假 host。 */
function captureHost(items: readonly LocalApiItem[] = TASKS) {
  const seen: Parameters<LocalApiHost['listTasks']>[0][] = [];
  const host: LocalApiHost = {
    listTasks: (args) => {
      seen.push(args);
      return Promise.resolve(items);
    },
    getTask: () => Promise.resolve(undefined),
    listProjects: () => Promise.resolve([]),
    submit: () => Promise.resolve<LocalApiWriteResult>({ ok: true, taskId: 'x' }),
  };
  return { host, seen };
}

async function callListTasks(args: Record<string, unknown>, host: LocalApiHost) {
  const { handle } = handler(CONFIG, host);
  return expectResponse(await handle(req('tools/call', { name: 'list_tasks', arguments: args }), TOKEN));
}

describe('🔴🔴 list_tasks 的日期参数：校验、透传、不降级', () => {
  it('dueOn 合法时**原样递给宿主**（不是在这里把日期吃掉）', async () => {
    const { host, seen } = captureHost();
    const res = await callListTasks({ dueOn: '2026-03-15' }, host);
    expect('result' in res).toBe(true);
    expect(seen).toEqual([{ dueOn: '2026-03-15' }]);
  });

  it('dueFrom + dueTo 成对递给宿主（闭区间，两端都在）', async () => {
    const { host, seen } = captureHost();
    await callListTasks({ dueFrom: '2026-03-15', dueTo: '2026-03-20' }, host);
    expect(seen).toEqual([{ dueFrom: '2026-03-15', dueTo: '2026-03-20' }]);
  });

  it('🔴 与 projectId / completed / limit **共存**时一起递过去（不是互斥覆盖）', async () => {
    const { host, seen } = captureHost();
    await callListTasks(
      { projectId: 'p1', completed: false, limit: 10, dueFrom: '2026-03-15', dueTo: '2026-03-16' },
      host,
    );
    expect(seen).toEqual([
      { projectId: 'p1', completed: false, limit: 10, dueFrom: '2026-03-15', dueTo: '2026-03-16' },
    ]);
  });

  it('🔴 不传日期时**不往宿主塞任何日期键**（最常见的调用形态不是错误）', async () => {
    const { host, seen } = captureHost();
    const res = await callListTasks({}, host);
    expect('result' in res).toBe(true);
    expect(seen).toEqual([{}]);
    // 而且默认仍然返回全部 —— 挡住"成对校验把空参数判死"这种自我伤害
    expect(textOf(res)).toContain('交周报');
  });

  it('🔴 跨度**正好 14 天**（含两端）通过', async () => {
    const { host, seen } = captureHost();
    const res = await callListTasks({ dueFrom: '2026-03-01', dueTo: '2026-03-14' }, host);
    expect('result' in res, JSON.stringify(seen)).toBe(true);
    expect(seen[0]?.dueFrom).toBe('2026-03-01');
    expect(seen[0]?.dueTo).toBe('2026-03-14');
  });

  it('🔴 跨度 15 天被拒，**且一次都没读数据**，消息里说明上限是多少', async () => {
    const { host, seen } = captureHost();
    const res = await callListTasks({ dueFrom: '2026-03-01', dueTo: '2026-03-15' }, host);
    if ('error' in res) {
      expect(res.error.code).toBe(JSON_RPC_ERRORS.invalidParams);
      expect(res.error.message).toContain('14');
      // 上界口径也钉住：报的是**含两端**的 15 天，不是差值 14
      expect(res.error.message).toContain('15 天');
    } else throw new Error('15 天的范围必须被拒');
    expect(seen).toEqual([]);
  });

  it('🔴 格式不对 / 不存在的一天被拒，**不降级成"这个参数没传"**', async () => {
    for (const bad of ['2026-3-5', '明天', '2026-02-30', '2026-13-01', '2026-03-15T10:00', 42, null]) {
      const { host, seen } = captureHost();
      const res = await callListTasks({ dueOn: bad }, host);
      if ('error' in res) expect(res.error.code, JSON.stringify(bad)).toBe(JSON_RPC_ERRORS.invalidParams);
      else throw new Error(`「${String(bad)}」必须被拒，而不是照样列出全量`);
      // 🔴 这条才是与原缺陷的分界：被拒 ⇒ **没有**返回 2 条全量任务
      expect(seen, JSON.stringify(bad)).toEqual([]);
    }
  });

  it('🔴 2 月 29 日按**闰年**判定（2024 存在、2025 不存在）', async () => {
    const ok = captureHost();
    expect('result' in (await callListTasks({ dueOn: '2024-02-29' }, ok.host))).toBe(true);
    const bad = captureHost();
    expect('error' in (await callListTasks({ dueOn: '2025-02-29' }, bad.host))).toBe(true);
    expect(bad.seen).toEqual([]);
  });

  it('dueOn 与 dueFrom / dueTo **互斥**：同时给被拒', async () => {
    for (const combo of [
      { dueOn: '2026-03-15', dueFrom: '2026-03-15', dueTo: '2026-03-16' },
      { dueOn: '2026-03-15', dueTo: '2026-03-16' },
    ]) {
      const { host, seen } = captureHost();
      const res = await callListTasks(combo, host);
      if ('error' in res) expect(res.error.message).toContain('二选一');
      else throw new Error(JSON.stringify(combo));
      expect(seen).toEqual([]);
    }
  });

  it('🔴 只给 dueFrom 或只给 dueTo 被拒（半开 = 没有上界）', async () => {
    for (const combo of [{ dueFrom: '2026-03-15' }, { dueTo: '2026-03-15' }]) {
      const { host, seen } = captureHost();
      const res = await callListTasks(combo, host);
      if ('error' in res) expect(res.error.message).toContain('一起给');
      else throw new Error(JSON.stringify(combo));
      expect(seen).toEqual([]);
    }
  });

  it('dueFrom 晚于 dueTo 被拒（**不是**静默返回空）', async () => {
    const { host, seen } = captureHost();
    const res = await callListTasks({ dueFrom: '2026-03-20', dueTo: '2026-03-15' }, host);
    if ('error' in res) expect(res.error.message).toContain('不能晚于');
    else throw new Error('反向范围必须报错');
    expect(seen).toEqual([]);
  });

  it('🔴 日期参数的类型不看：非字符串一律拒（`{ dueOn: {} }` 不许变成"全都算"）', async () => {
    const { host, seen } = captureHost();
    const res = await callListTasks({ dueOn: { toString: () => '2026-03-15' } }, host);
    expect('error' in res).toBe(true);
    expect(seen).toEqual([]);
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
