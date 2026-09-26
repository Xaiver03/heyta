/**
 * 本地 API / MCP 测试
 * =====================
 *
 * 承重的断言只有四条，对应 ADR-0011 的四条不可商量的规则：
 *
 *   1. 🔴 **默认关** —— 工具默认全部关闭，未列出 = 关闭
 *   2. 🔴 **只监听回环** —— 尤其 `0.0.0.0` 必须被拒（它最容易被误当成"本机"）
 *   3. 🔴 **显式 token** —— 且身份检查**在**工具存在性检查**之前**
 *   4. 🔴🔴 **加密条目可列举、不可读** —— Bear 的底线
 *
 * 第 4 条最重要：**它坏掉的时候，用户看不到任何症状。**
 * 工具照样工作、结果照样"合理"，只是把用户以为受保护的内容交出去了。
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCAL_API_CONFIG,
  LOCAL_API_TOOLS,
  authorizeToolCall,
  findTool,
  isLoopbackAddress,
  projectAllForTool,
  projectForTool,
  readItemForTool,
  toolNames,
  validateLocalApiConfig,
  type LocalApiConfig,
  type LocalApiItem,
  type LocalApiWriteIntent,
  type LocalApiWritePort,
} from '../src/index.js';

// ─────────────────────────────────────────────────────────────────────────

const OPEN_CONFIG: LocalApiConfig = {
  enabled: true,
  bindAddress: '127.0.0.1',
  port: 47_119,
  token: 'tok_abc123',
  grants: { list_tasks: true },
};

const PROTECTED: LocalApiItem = {
  id: 't1',
  title: '体检报告',
  dueDate: '2026-10-01',
  priority: 'high',
  completed: false,
  body: '身份证号 110101...；医保卡密码是……',
  readable: false,
};

const NORMAL: LocalApiItem = {
  id: 't2',
  title: '交周报',
  dueDate: '2026-09-27',
  priority: 'medium',
  completed: false,
  body: '记得附上本周的图表',
  readable: true,
};

// ─────────────────────────────────────────────────────────────────────────

describe('默认值 —— 一切都是关的', () => {
  it('🔴 默认配置是关的', () => {
    expect(DEFAULT_LOCAL_API_CONFIG.enabled).toBe(false);
  });

  it('🔴 默认只绑定回环', () => {
    expect(DEFAULT_LOCAL_API_CONFIG.bindAddress).toBe('127.0.0.1');
  });

  it('🔴 每一个工具都默认关闭（包括读工具）', () => {
    // 读工具也默认关：读走全部任务同样是泄漏。
    for (const tool of LOCAL_API_TOOLS) {
      expect(tool.defaultEnabled, tool.name).toBe(false);
    }
    expect(LOCAL_API_TOOLS.length).toBeGreaterThan(0);
  });

  it('工具目录保持很小（每多一个，"默认关"清单就长一条）', () => {
    // 这是个防膨胀断言：Joplin 有 11 个，那是笔记应用。
    // 这里是任务管理，超过 10 个就该先问"真的需要吗"。
    expect(LOCAL_API_TOOLS.length).toBeLessThanOrEqual(10);
  });

  it('读写工具都有，且名字唯一', () => {
    expect(LOCAL_API_TOOLS.some((t) => t.kind === 'read')).toBe(true);
    expect(LOCAL_API_TOOLS.some((t) => t.kind === 'write')).toBe(true);
    expect(new Set(toolNames()).size).toBe(LOCAL_API_TOOLS.length);
  });

  it('findTool 认得自己目录里的工具，不认别的', () => {
    expect(findTool('list_tasks')?.kind).toBe('read');
    expect(findTool('create_task')?.kind).toBe('write');
    expect(findTool('delete_everything')).toBeUndefined();
  });
});

describe('🔴 只监听回环', () => {
  it('回环地址全部接受', () => {
    for (const a of ['127.0.0.1', '127.0.0.5', 'localhost', '::1', '[::1]', 'LOCALHOST']) {
      expect(isLoopbackAddress(a), a).toBe(true);
    }
  });

  it('🔴 0.0.0.0 / :: / * 必须拒绝（最容易被误当成"本机"）', () => {
    for (const a of ['0.0.0.0', '::', '*']) {
      expect(isLoopbackAddress(a), a).toBe(false);
    }
  });

  it('局域网与公网地址拒绝', () => {
    for (const a of ['192.168.1.10', '10.0.0.1', '8.8.8.8', 'my-nas.lan', 'example.com']) {
      expect(isLoopbackAddress(a), a).toBe(false);
    }
  });

  it('合法性可疑的输入一律拒绝（不做善意猜测）', () => {
    for (const a of ['127.0.0.256', '127.0.0', '127.0.0.1.5', '', '   ']) {
      expect(isLoopbackAddress(a), JSON.stringify(a)).toBe(false);
    }
  });

  it('打开时绑定非回环 → 配置被拒，且说明为什么', () => {
    const v = validateLocalApiConfig({ ...OPEN_CONFIG, bindAddress: '0.0.0.0' });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe('not-loopback');
      expect(v.message).toContain('回环');
    }
  });

  it('🔴 关着的时候允许配置不完整（先填一半再打开，不该被拦）', () => {
    expect(validateLocalApiConfig({ ...DEFAULT_LOCAL_API_CONFIG }).ok).toBe(true);
    expect(
      validateLocalApiConfig({ enabled: false, bindAddress: '0.0.0.0', port: 0 }).ok,
    ).toBe(true);
  });
});

describe('🔴 显式 token', () => {
  it('打开时没有 token → 配置被拒', () => {
    const v = validateLocalApiConfig({ enabled: true, bindAddress: '127.0.0.1', port: 47_119 });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe('token-required');
      // 说明要讲清楚"防的是本机其他程序"，否则用户会以为这是多余的步骤
      expect(v.message).toContain('任何程序');
    }
  });

  it('空白 token 不算 token', () => {
    expect(validateLocalApiConfig({ ...OPEN_CONFIG, token: '   ' }).ok).toBe(false);
    expect(validateLocalApiConfig({ ...OPEN_CONFIG, token: '' }).ok).toBe(false);
  });

  it('端口必须是 1–65535 的整数', () => {
    for (const port of [0, -1, 65_536, 1.5, Number.NaN]) {
      const v = validateLocalApiConfig({ ...OPEN_CONFIG, port });
      expect(v.ok, String(port)).toBe(false);
    }
  });

  it('token 正确 + 已授权 → 放行', () => {
    const v = authorizeToolCall(OPEN_CONFIG, 'list_tasks', 'tok_abc123');
    expect(v.allowed).toBe(true);
    if (v.allowed) expect(v.tool.name).toBe('list_tasks');
  });

  it('token 错误 / 缺失 → 拒绝', () => {
    const wrong = authorizeToolCall(OPEN_CONFIG, 'list_tasks', 'tok_wrong');
    expect(wrong.allowed).toBe(false);
    if (!wrong.allowed) expect(wrong.reason).toBe('token-mismatch');

    const missing = authorizeToolCall(OPEN_CONFIG, 'list_tasks', undefined);
    expect(missing.allowed).toBe(false);
    if (!missing.allowed) expect(missing.reason).toBe('token-mismatch');
  });

  it('长度不同的 token 也拒绝（定长比较的另一半）', () => {
    const v = authorizeToolCall(OPEN_CONFIG, 'list_tasks', 'tok_abc1234567890');
    expect(v.allowed).toBe(false);
  });

  it('总开关关着 → 拒绝，且原因是 api-disabled（不是 token 问题）', () => {
    const v = authorizeToolCall({ ...OPEN_CONFIG, enabled: false }, 'list_tasks', 'tok_abc123');
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.reason).toBe('api-disabled');
  });

  it('🔴 身份检查在工具存在性检查**之前**（否则能枚举出有哪些工具）', () => {
    // 没带 token 时，无论问哪个工具名，错误必须**完全一样** ——
    // 如果"未知工具"和"已知工具"给出不同错误，调用方就能枚举出工具目录。
    const knownTool = authorizeToolCall(OPEN_CONFIG, 'list_tasks', undefined);
    const unknownTool = authorizeToolCall(OPEN_CONFIG, 'totally_made_up', undefined);
    expect(knownTool.allowed).toBe(false);
    expect(unknownTool.allowed).toBe(false);
    if (!knownTool.allowed && !unknownTool.allowed) {
      expect(knownTool.reason).toBe('token-mismatch');
      expect(unknownTool.reason).toBe('token-mismatch');
      expect(knownTool.message).toBe(unknownTool.message);
    }
  });

  it('token 对了之后，未知工具才报 tool-unknown', () => {
    const v = authorizeToolCall(OPEN_CONFIG, 'totally_made_up', 'tok_abc123');
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.reason).toBe('tool-unknown');
  });
});

describe('🔴 逐工具授权：未列出 = 关闭', () => {
  it('未授权的工具被拒，且说明"默认全部关闭"', () => {
    // OPEN_CONFIG 只授权了 list_tasks
    const v = authorizeToolCall(OPEN_CONFIG, 'create_task', 'tok_abc123');
    expect(v.allowed).toBe(false);
    if (!v.allowed) {
      expect(v.reason).toBe('tool-not-granted');
      expect(v.message).toContain('默认全部关闭');
    }
  });

  it('grants 完全缺失时，所有工具都拒绝', () => {
    const noGrants: LocalApiConfig = { ...OPEN_CONFIG, grants: undefined };
    for (const name of toolNames()) {
      const v = authorizeToolCall(noGrants, name, 'tok_abc123');
      expect(v.allowed, name).toBe(false);
      if (!v.allowed) expect(v.reason, name).toBe('tool-not-granted');
    }
  });

  it('🔴 授权必须是显式 true —— false / 假值都不算', () => {
    const weird: LocalApiConfig = {
      ...OPEN_CONFIG,
      grants: { list_tasks: false, get_task: undefined as unknown as boolean },
    };
    expect(authorizeToolCall(weird, 'list_tasks', 'tok_abc123').allowed).toBe(false);
    expect(authorizeToolCall(weird, 'get_task', 'tok_abc123').allowed).toBe(false);
  });

  it('逐个授权互不影响', () => {
    const cfg: LocalApiConfig = {
      ...OPEN_CONFIG,
      grants: { list_tasks: true, get_task: true },
    };
    expect(authorizeToolCall(cfg, 'list_tasks', 'tok_abc123').allowed).toBe(true);
    expect(authorizeToolCall(cfg, 'get_task', 'tok_abc123').allowed).toBe(true);
    expect(authorizeToolCall(cfg, 'create_task', 'tok_abc123').allowed).toBe(false);
  });
});

describe('🔴🔴 加密条目：可列举，不可读（Bear 的底线）', () => {
  it('🔴 不可读条目的**正文必须消失**', () => {
    const projected = projectForTool(PROTECTED);
    expect(projected.body).toBeUndefined();
    // 序列化一遍再查，防止 body 藏在别的地方
    expect(JSON.stringify(projected)).not.toContain('身份证号');
    expect(JSON.stringify(projected)).not.toContain('医保卡密码');
  });

  it('🔴 但元数据保留 —— "存在"必须能被看见（Bear: "can be listed"）', () => {
    const projected = projectForTool(PROTECTED);
    expect(projected.id).toBe('t1');
    expect(projected.title).toBe('体检报告');
    expect(projected.dueDate).toBe('2026-10-01');
    expect(projected.priority).toBe('high');
    expect(projected.readable).toBe(false);
  });

  it('可读条目原样返回（不能被"保护"逻辑误伤）', () => {
    const projected = projectForTool(NORMAL);
    expect(projected.body).toBe('记得附上本周的图表');
    expect(projected).toEqual(NORMAL);
  });

  it('🔴 列表里可读与不可读混在一起时，逐条判定', () => {
    const list = projectAllForTool([PROTECTED, NORMAL]);
    expect(list[0]?.body).toBeUndefined();
    expect(list[0]?.title).toBe('体检报告');
    expect(list[1]?.body).toBe('记得附上本周的图表');
    // 整份列表的序列化里不许出现受保护正文
    expect(JSON.stringify(list)).not.toContain('身份证号');
  });

  it('🔴 白名单重建：将来新增的敏感字段**默认不暴露**', () => {
    // 模拟"以后有人给 LocalApiItem 加了个 attachments 字段"
    const future = {
      ...PROTECTED,
      attachments: ['报告.pdf'],
      location: '医院',
    } as unknown as LocalApiItem;
    const projected = projectForTool(future) as unknown as Record<string, unknown>;
    // 黑名单写法（delete body）会让这两个字段漏出去；白名单不会。
    expect(projected['attachments']).toBeUndefined();
    expect(projected['location']).toBeUndefined();
  });

  it('🔴 get_task 对不可读条目**明确拒绝**，而不是返回空结果', () => {
    const v = readItemForTool(PROTECTED);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe('not-readable');
      // 必须说明"这是设计如此"，否则会被当成 bug 反复报
      expect(v.message).toContain('受保护');
      expect(v.message).toContain('不是错误');
    }
  });

  it('get_task 对可读条目正常返回', () => {
    const v = readItemForTool(NORMAL);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.item.body).toBe('记得附上本周的图表');
  });
});

describe('写入路径 —— 只能经 dispatch 形状的端口', () => {
  it('写入端口只有一个方法，且接受不透明 intent', async () => {
    const seen: LocalApiWriteIntent[] = [];
    const port: LocalApiWritePort = {
      submit: (intent) => {
        seen.push(intent);
        return Promise.resolve({ ok: true, taskId: 'new-1' });
      },
    };

    const result = await port.submit({ action: 'create-task', title: '买咖啡豆' });
    expect(result).toEqual({ ok: true, taskId: 'new-1' });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.action).toBe('create-task');
  });

  it('🔴 本包**没有**任何 op 构造函数（写入意图是封闭联合）', async () => {
    // 这个测试的价值不在断言内容，而在**类型系统**：
    // 下面这行如果去掉 as never 就会编译失败，
    // 因为 LocalApiWriteIntent 是封闭的三种动作。
    // → 工具**表达不出**"随便改个字段"或"自己拼个 op"。
    const port: LocalApiWritePort = {
      submit: () => Promise.resolve({ ok: false, reason: 'invalid', message: '拒绝' }),
    };
    const result = await port.submit({ action: 'not-a-real-action' } as never);
    expect(result.ok).toBe(false);
  });

  it('三种写入动作的形状是固定的', () => {
    const intents: LocalApiWriteIntent[] = [
      { action: 'create-task', title: '写方案', dueDate: '2026-10-01', priority: 'high' },
      { action: 'update-task', taskId: 't2', fields: { title: '改过的标题' } },
      { action: 'complete-task', taskId: 't2' },
    ];
    expect(intents.map((i) => i.action)).toEqual([
      'create-task',
      'update-task',
      'complete-task',
    ]);
  });
});
