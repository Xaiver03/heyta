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
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  errorCodeForDenial,
  handleToolsCall,
  listMcpTools,
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
    const all = listMcpTools({
      ...CONFIG,
      grants: {
        list_tasks: true,
        get_task: true,
        list_projects: true,
        create_task: true,
        update_task: true,
        complete_task: true,
      },
    });
    expect(all).toHaveLength(6);
    for (const tool of all) {
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
    }
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
