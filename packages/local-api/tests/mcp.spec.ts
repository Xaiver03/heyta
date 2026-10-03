/**
 * MCP 定义测试
 * ==============
 *
 * 承重断言两条：
 *
 *   1. 🔴 **未授权的工具对 MCP 客户端完全不可见**（不是"看得见但调不动"）
 *   2. 🔴 **"工具不存在"与"工具未授权"必须给出逐字相同的错误** ——
 *      否则可以靠错误码把工具目录枚举出来
 */

import { describe, expect, it } from 'vitest';

import {
  JSON_RPC_ERRORS,
  LOCAL_API_TOOLS,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  errorCodeForDenial,
  handleToolsCall,
  hasInputSchemaFor,
  listMcpTools,
  recordedInputSchemaNames,
  type LocalApiConfig,
} from '../src/index.js';

const CONFIG: LocalApiConfig = {
  enabled: true,
  bindAddress: '127.0.0.1',
  port: 47_119,
  token: 'tok_abc123',
  grants: { list_tasks: true, get_task: true },
};

const TOKEN = 'tok_abc123';

describe('listMcpTools —— 只暴露已授权的工具', () => {
  it('🔴 未授权的工具**完全不出现在列表里**', () => {
    const tools = listMcpTools(CONFIG);
    const names = tools.map((t) => t.name);
    expect(names).toEqual(['list_tasks', 'get_task']);
    // 未授权的写工具一个都不能出现
    expect(names).not.toContain('create_task');
    expect(names).not.toContain('complete_task');
    // 整个序列化结果里也不许出现它们
    const json = JSON.stringify(tools);
    expect(json).not.toContain('create_task');
    expect(json).not.toContain('update_task');
  });

  it('没有任何授权时列表为空（而不是"全给"）', () => {
    expect(listMcpTools({ ...CONFIG, grants: undefined })).toHaveLength(0);
    expect(listMcpTools({ ...CONFIG, grants: {} })).toHaveLength(0);
  });

  it('每个工具都带可用的 inputSchema', () => {
    for (const tool of listMcpTools({ ...CONFIG, grants: { list_tasks: true, create_task: true } })) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('🔴 描述里写清"会不会改数据"（模型只有这份列表，没有权限概念）', () => {
    const tools = listMcpTools({ ...CONFIG, grants: { list_tasks: true, create_task: true } });
    const read = tools.find((t) => t.name === 'list_tasks');
    const write = tools.find((t) => t.name === 'create_task');
    expect(read?.description).toContain('只读');
    expect(write?.description).toContain('会修改数据');
  });

  it('additionalProperties 一律 false（不接受不认识的字段）', () => {
    // 🔴 授权集合从**目录**派生：手抄 6 个名字的版本在目录扩到 10 条之后，
    // 这条"全部工具"的检查其实只覆盖了旧的 6 条 —— 新加工具**不会**让它红，
    // 于是"每个工具都守 additionalProperties:false"这句话开始说谎。
    const all = listMcpTools({
      ...CONFIG,
      grants: Object.fromEntries(LOCAL_API_TOOLS.map((t) => [t.name, true])),
    });
    expect(all.length).toBeGreaterThanOrEqual(10);
    expect(all).toHaveLength(LOCAL_API_TOOLS.length);
    for (const tool of all) {
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
    }
  });

  it('🔴 目录里每一条工具都**登记过**参数 schema（`INPUT_SCHEMAS` 不许有静默回退）', () => {
    // `listAuthorizedTools()` 对没登记的工具回退成空 `properties` ——
    // 那与"这个工具真的不接参数"在 MCP 客户端与内置 AI 上**长得一模一样**，
    // 而能力清单只会标 `schemaRecorded:false`、**不会红**（生成器文件头明写了这个取舍）。
    // 所以"忘登记 schema"这件事只有这一条判据会响。目录驱动，不逐工具抄名字。
    const unrecorded = LOCAL_API_TOOLS.filter((t) => !hasInputSchemaFor(t.name)).map((t) => t.name);
    expect(unrecorded, `这些工具没有登记 INPUT_SCHEMAS：${unrecorded.join('、')}`).toEqual([]);
  });

  it('🔴 反向也对：schema 里不许留**孤儿抄件**（目录已删而 schema 还留着）', () => {
    const names = new Set(LOCAL_API_TOOLS.map((t) => t.name));
    const orphans = recordedInputSchemaNames().filter((n) => !names.has(n));
    expect(orphans, `这些 schema 在目录里已经没有对应工具了：${orphans.join('、')}`).toEqual([]);
  });

  it('必填参数被如实标注', () => {
    const tools = listMcpTools({ ...CONFIG, grants: { get_task: true, create_task: true } });
    expect(tools.find((t) => t.name === 'get_task')?.inputSchema.required).toEqual(['taskId']);
    expect(tools.find((t) => t.name === 'create_task')?.inputSchema.required).toEqual(['title']);
  });

  it('协议常量存在', () => {
    expect(MCP_SERVER_NAME).toBe('heyta');
    expect(MCP_PROTOCOL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴 `list_tasks` 的**给模型看**的日期参数
// ─────────────────────────────────────────────────────────────────────────
//
// ⚠️ 这一组的判据落在"描述文字"上，不是落在"参数存在"上，理由是一条别的测试
// 抓不到的约束：`packages/ai/src/provider.ts` 里 `AiInvocation.tools` 的注释明写
// **"这些工具的名字与说明会进入请求体，所以它们也是出境数据"**。
// ⇒ 描述写错 = 用户的数据被一段含糊的说明带错方向，而这段说明**离开过本机**。
// 所以"互斥 / 成对 / 含两端 / 上限多少"必须**写在描述里**，而不是留给模型猜，
// 也不能写成只有内部人才懂的黑话。

/** 取 `list_tasks` 的参数说明。 */
function listTasksProperties(): Record<string, { description?: string }> {
  const tools = listMcpTools({
    ...CONFIG,
    grants: { list_tasks: true, create_task: true, get_task: true, list_projects: true },
  });
  const list = tools.find((t) => t.name === 'list_tasks');
  return (list?.inputSchema.properties ?? {}) as Record<string, { description?: string }>;
}

describe('🔴 list_tasks 的日期参数：schema 与出境描述', () => {
  it('三个日期参数都在 schema 里（缺一个就等于没有那条能力）', () => {
    expect(Object.keys(listTasksProperties()).sort()).toEqual(
      ['completed', 'dueFrom', 'dueTo', 'dueOn', 'limit', 'projectId'].sort(),
    );
  });

  it('🔴 每个日期参数的描述都写清格式，并标出互斥 / 成对', () => {
    const props = listTasksProperties();
    for (const key of ['dueOn', 'dueFrom', 'dueTo'] as const) {
      const description = props[key]?.description ?? '';
      expect(description, key).toContain('YYYY-MM-DD');
      // 组合关系必须写出来，不留给模型猜
      expect(description, key).toMatch(/互斥|一起给/);
    }
  });

  it('🔴 闭区间的口径写在描述里（含两端），上限也写了', () => {
    const props = listTasksProperties();
    const range = `${props.dueFrom?.description ?? ''} ${props.dueTo?.description ?? ''}`;
    expect(range).toContain('包含这一天');
    expect(range).toContain('14');
  });

  it('🔴 整份目录的描述里没有内部黑话（这是出境数据，模型读不懂的行话会直接变成错调用）', () => {
    // 原来只扫 `list_tasks` 一个工具 —— 那意味着**每加一个工具就自动脱离这条判据**。
    // 现在按整份目录扫：工具自己的 `description` 和它的 `inputSchema` 一起进 JSON，
    // 因为模型两边都读。
    const allGrants = Object.fromEntries(LOCAL_API_TOOLS.map((t) => [t.name, true]));
    const tools = listMcpTools({ ...CONFIG, grants: allGrants });
    // 前提：这份扫描真的覆盖了目录。授权漏一个就少扫一个工具，而那句断言不会报。
    expect(tools.length).toBe(LOCAL_API_TOOLS.length);

    const json = JSON.stringify(tools);
    // 一次报**全部**命中，而不是撞到第一个就停 —— 否则修掉一个词之后，
    // 第二个词要再跑一轮才现形，而那一轮可能根本不会有人跑。
    const hits = [
      'ADR',
      'op-log',
      'dispatch',
      'W3',
      'AI-G3',
      'createLocalApiHost',
      'LocalApiHost',
      'EntityModelMap',
      'LOCAL_API_TOOLS',
      'egressFields',
    ].filter((jargon) => json.includes(jargon));
    expect(hits).toEqual([]);

    // 阳性对照：同一份 JSON 里**必须**数得出这些真实存在的串。
    // 少了这一句，"没有黑话"和"什么都没扫到"长得一模一样（比如 grants 少给一片）。
    for (const needle of ['YYYY-MM-DD', '（只读，不会修改任何数据）', '（会修改数据：调用即生效）']) {
      expect(json, needle).toContain(needle);
    }
  });

  it('🔴 limit 的描述说明它作用在筛选**之后**（顺序是这条缺陷的另一半）', () => {
    const limit = listTasksProperties().limit?.description ?? '';
    expect(limit).toContain('默认 50');
    expect(limit).toMatch(/筛完之后|筛完/);
  });

  it('日期参数**不是必填**（不传就是不按日期筛）', () => {
    const tools = listMcpTools({ ...CONFIG, grants: { list_tasks: true } });
    expect(tools.find((t) => t.name === 'list_tasks')?.inputSchema.required).toBeUndefined();
  });
});

describe('handleToolsCall —— 授权与协议的交界', () => {
  it('已授权 + token 对 → 放行，并带上参数', () => {
    const out = handleToolsCall(CONFIG, 'list_tasks', { limit: 10 }, TOKEN);
    expect(out.allowed).toBe(true);
    if (out.allowed) {
      expect(out.toolName).toBe('list_tasks');
      expect(out.args).toEqual({ limit: 10 });
    }
  });

  it('未授权的工具 → 拒绝', () => {
    const out = handleToolsCall(CONFIG, 'create_task', { title: 'x' }, TOKEN);
    expect(out.allowed).toBe(false);
  });

  it('token 错 → 拒绝', () => {
    const out = handleToolsCall(CONFIG, 'list_tasks', {}, 'wrong');
    expect(out.allowed).toBe(false);
  });

  it('未授权与不存在**给出完全相同的错误**（否则可枚举工具目录）', () => {
    const notGranted = handleToolsCall(CONFIG, 'create_task', {}, TOKEN);
    const notExist = handleToolsCall(CONFIG, 'totally_made_up', {}, TOKEN);
    expect(notGranted.allowed).toBe(false);
    expect(notExist.allowed).toBe(false);
    if (!notGranted.allowed && !notExist.allowed) {
      expect(notGranted.error).toEqual(notExist.error);
      // 必须是 methodNotFound —— 报"没权限"等于确认了工具存在
      expect(notGranted.error.code).toBe(JSON_RPC_ERRORS.methodNotFound);
      expect(notGranted.error.message).not.toContain('权限');
    }
  });

  it('🔴 token 错误不泄露任何工具信息', () => {
    const denied = handleToolsCall(CONFIG, 'list_tasks', {}, 'wrong');
    const deniedUnknown = handleToolsCall(CONFIG, 'made_up', {}, 'wrong');
    expect(denied.allowed).toBe(false);
    if (!denied.allowed && !deniedUnknown.allowed) {
      expect(denied.error).toEqual(deniedUnknown.error);
      expect(denied.error.message).not.toContain('list_tasks');
    }
  });
});

describe('errorCodeForDenial —— 错误码映射逐项钉死', () => {
  it('会话级问题用 invalidRequest', () => {
    for (const reason of ['api-disabled', 'token-missing', 'token-mismatch'] as const) {
      expect(errorCodeForDenial(reason).code).toBe(JSON_RPC_ERRORS.invalidRequest);
    }
  });

  it('工具级问题用 methodNotFound（不是"没权限"）', () => {
    for (const reason of ['tool-unknown', 'tool-not-granted'] as const) {
      expect(errorCodeForDenial(reason).code).toBe(JSON_RPC_ERRORS.methodNotFound);
    }
  });

  it('🔴 两类工具级错误合并成同一个响应对象', () => {
    expect(errorCodeForDenial('tool-unknown')).toEqual(errorCodeForDenial('tool-not-granted'));
  });
});
