/**
 * PROJECT / HABIT 两个新工具包的**行为**判据
 * ============================================
 *
 * `tool-pack-coverage.spec.ts` 钉的是"每个工具都被认领了"（注册完整性）。
 * 本文件钉的是另外三件事，每一件都是"少了它就有东西在说谎"：
 *
 * 1. 🔴 **写工具只产出意图，永远不碰宿主** —— 参数检查、字段挑选、
 *    "缺参数就拒而不是当成没传"。
 * 2. 🔴 **默认关是逐个的** —— 新增的三个工具在没有任何授权时**不可见**，
 *    而不是"看得见但调不动"（ADR-0011 第 1 条与 `mcp.spec.ts` 同一条立场）。
 * 3. 🔴 **写成功的结果说出它落地的是哪个实体** —— 清单的 id 不许回成 `taskId`，
 *    否则模型与外部程序都以为刚建了一条任务。
 */

import { describe, expect, it } from 'vitest';

import {
  LOCAL_API_TOOLS,
  createLocalApiHandler,
  findTool,
  listAuthorizedTools,
  runReadTool,
  toWriteIntent,
  type JsonRpcRequest,
  type LocalApiFocusSession,
  type LocalApiHabit,
  type LocalApiHabitLog,
  type LocalApiEventItem,
  type LocalApiHost,
  type LocalApiItem,
  type LocalApiNoteRow,
  type LocalApiReminder,
  type LocalApiTag,
  type LocalApiWriteIntent,
  type LocalApiWriteResult,
} from '../src/index.js';

const HABITS: readonly LocalApiHabit[] = [
  { id: 'h1', name: '喝水', target: 8, unit: '杯', goalType: 'atLeast' },
  { id: 'h2', name: '不碰手机' },
];

/** 记账的假宿主：谁被调过、`submit` 收到什么，全部留痕。 */
function recordingHost() {
  const calls: string[] = [];
  const submitted: LocalApiWriteIntent[] = [];
  const host: LocalApiHost = {
    listTasks: () => {
      calls.push('listTasks');
      return Promise.resolve<readonly LocalApiItem[]>([]);
    },
    getTask: () => Promise.resolve(undefined),
    listProjects: () => {
      calls.push('listProjects');
      return Promise.resolve([]);
    },
    listHabits: () => {
      calls.push('listHabits');
      return Promise.resolve(HABITS);
    },
    listTags: () => Promise.resolve([] as readonly LocalApiTag[]),
    listNotes: () => Promise.resolve([] as readonly LocalApiNoteRow[]),
    getNote: () => Promise.resolve(undefined),
    listHabitLogs: () => Promise.resolve([] as readonly LocalApiHabitLog[]),
    listFocusSessions: () => Promise.resolve([] as readonly LocalApiFocusSession[]),
    listReminders: () => Promise.resolve([] as readonly LocalApiReminder[]),
    listEvents: () => Promise.resolve([] as readonly LocalApiEventItem[]),
    getEvent: () => Promise.resolve(undefined),

    submit: (intent) => {
      calls.push('submit');
      submitted.push(intent);
      return Promise.resolve<LocalApiWriteResult>({
        ok: true,
        taskId: 'created-1',
        ...(intent.action === 'create-project'
          ? { entityId: 'project-1', entityType: 'PROJECT' as const }
          : {}),
        ...(intent.action === 'create-habit'
          ? { entityId: 'habit-1', entityType: 'HABIT' as const }
          : {}),
      });
    },
  };
  return { host, calls, submitted };
}

describe('create_project：参数 → 意图', () => {
  it('最小合法参数产出 create-project 意图，且**一个宿主方法都不调**', () => {
    const { host, calls } = recordingHost();
    const outcome = toWriteIntent('create_project', { name: '读书' });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.intent).toEqual({ action: 'create-project', name: '读书' });
    // 🔴 这条是"提案不等于落库"的**协议层**一半：`toWriteIntent` 是纯函数。
    expect(calls).toEqual([]);
    void host;
  });

  it('parentId 给了就带上，没给就**不放这个键**', () => {
    const withParent = toWriteIntent('create_project', { name: '子清单', parentId: 'p1' });
    expect(withParent.ok && withParent.intent).toEqual({
      action: 'create-project',
      name: '子清单',
      parentId: 'p1',
    });
    const top = toWriteIntent('create_project', { name: '顶层' });
    expect(top.ok && 'parentId' in (top.intent as object)).toBe(false);
  });

  it('🔴 缺 name / 空白 name 一律**拒绝**，而不是建一条没有名字的清单', () => {
    for (const args of [{}, { name: '' }, { name: '   ' }, { name: 42 }]) {
      const outcome = toWriteIntent('create_project', args);
      expect(outcome.ok, JSON.stringify(args)).toBe(false);
      if (outcome.ok) continue;
      // 也不能被误报成"注册不齐"—— 那是 heyta 的缺陷，不是用户的参数错。
      expect(outcome.message).not.toContain('注册不齐');
      expect(outcome.message).toContain('name');
    }
  });

  it('name 不是字符串时不接受"猜一个"（对象 / 数组 / null 全部拒）', () => {
    for (const raw of [{ a: 1 }, ['读书'], null, undefined, true]) {
      expect(toWriteIntent('create_project', { name: raw }).ok).toBe(false);
    }
  });
});

describe('create_habit：参数 → 意图', () => {
  it('可选字段只在**给了且形状对**时才进意图', () => {
    const full = toWriteIntent('create_habit', {
      name: '喝水',
      target: 8,
      unit: '杯',
      goalType: 'atMost',
    });
    expect(full.ok && full.intent).toEqual({
      action: 'create-habit',
      name: '喝水',
      target: 8,
      unit: '杯',
      goalType: 'atMost',
    });

    // `target` 是字符串（模型常这么回）⇒ 三个可选字段一律**丢掉**，不"转换一下"。
    const sloppy = toWriteIntent('create_habit', { name: '喝水', target: '8' });
    expect(sloppy.ok && sloppy.intent).toEqual({ action: 'create-habit', name: '喝水' });
  });

  it('🔴 缺 name 被拒；口径/单位的**取值合法性**不在这里判（归宿主）', () => {
    expect(toWriteIntent('create_habit', {}).ok).toBe(false);
    expect(toWriteIntent('create_habit', { name: '  ' }).ok).toBe(false);
    // 这一条**故意**是 ok 的：词表在 domain，本包零依赖、不能 import 它。
    // 判它的是 `packages/app-host/tests/local-api-host-project-habit.spec.ts`。
    const weird = toWriteIntent('create_habit', { name: '喝水', goalType: 'whenever' });
    expect(weird.ok).toBe(true);
  });
});

describe('list_habits：真的从宿主读到东西', () => {
  it('读到的就是宿主给的那份，且**没调用别的宿主方法**', async () => {
    const { host, calls } = recordingHost();
    const outcome = await runReadTool(host, 'list_habits', {});
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.payload).toEqual(HABITS);
    expect(calls).toEqual(['listHabits']);
  });

  it('空表**不是错误**（"这台机器还没有习惯"是一个合法答案）', async () => {
    const empty: LocalApiHost = {
      listTasks: () => Promise.resolve([]),
      getTask: () => Promise.resolve(undefined),
      listProjects: () => Promise.resolve([]),
      listHabits: () => Promise.resolve([]),
      listTags: () => Promise.resolve([] as readonly LocalApiTag[]),
      listNotes: () => Promise.resolve([] as readonly LocalApiNoteRow[]),
      getNote: () => Promise.resolve(undefined),
      listHabitLogs: () => Promise.resolve([] as readonly LocalApiHabitLog[]),
      listFocusSessions: () => Promise.resolve([] as readonly LocalApiFocusSession[]),
      listReminders: () => Promise.resolve([] as readonly LocalApiReminder[]),
    listEvents: () => Promise.resolve([] as readonly LocalApiEventItem[]),
    getEvent: () => Promise.resolve(undefined),

      submit: () => Promise.resolve({ ok: true, taskId: 'x' }),
    };
    const outcome = await runReadTool(empty, 'list_habits', {});
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.payload).toEqual([]);
  });
});

describe('🔴 新工具默认关，且未授权时对外不可见', () => {
  const NEW_TOOLS = ['list_habits', 'create_project', 'create_habit'] as const;

  it('目录条目都在，且 `defaultEnabled` 逐字是 false', () => {
    for (const name of NEW_TOOLS) {
      const tool = findTool(name);
      expect(tool, `目录里没有「${name}」`).toBeDefined();
      expect(tool?.defaultEnabled, `${name} 必须默认关`).toBe(false);
      // 声明必须是数组（可以合法为空），出境逐字段披露靠它。
      expect(Array.isArray(tool?.egressFields), `${name} 的 egressFields 不是数组`).toBe(true);
    }
  });

  it('一份授权都没有时，三个新工具**一个都不出现**', () => {
    for (const grants of [undefined, {}]) {
      const names = listAuthorizedTools(grants).map((t) => t.name);
      for (const name of NEW_TOOLS) expect(names, String(name)).not.toContain(name);
    }
  });

  it('逐个授权只让**那一个**可见（没有"开一个送一串"）', () => {
    const names = listAuthorizedTools({ create_habit: true }).map((t) => t.name);
    expect(names).toEqual(['create_habit']);
  });

  it('未授权的新工具**调不动**，且错误与"没有这个工具"不可区分', async () => {
    const { host, calls } = recordingHost();
    const handle = createLocalApiHandler({
      host,
      getConfig: () => ({
        enabled: true,
        bindAddress: '127.0.0.1',
        port: 47_119,
        token: 'tok',
        grants: { list_tasks: true },
      }),
    });
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'create_project', arguments: { name: '读书' } },
    };
    const res = await handle(req, 'tok');
    expect(res !== undefined && 'error' in res).toBe(true);
    if (res === undefined || !('error' in res)) return;
    // 与"方法不存在"**逐字相同**：否则没授权的调用方能枚举出工具目录。
    expect(res.error.message).toBe('没有这个方法。');
    expect(calls).toEqual([]);
  });
});

describe('🔴 写入结果必须说清落地的是哪个实体', () => {
  const config = {
    enabled: true,
    bindAddress: '127.0.0.1',
    port: 47_119,
    token: 'tok',
    grants: { create_project: true, create_habit: true },
  } as const;

  /** 跑一次工具调用并取出返回的文本内容。 */
  async function call(name: string, args: Record<string, unknown>): Promise<string> {
    const { host } = recordingHost();
    const handle = createLocalApiHandler({ host, getConfig: () => ({ ...config, grants: { ...config.grants } }) });
    const res = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, 'tok');
    expect(res !== undefined && 'result' in res).toBe(true);
    const r = res as { result: { content: readonly { text: string }[] } };
    return r.result.content[0]?.text ?? '';
  }

  it('create_project 的回包里有 `entityId` + `entityType`，**没有** `taskId`', async () => {
    const text = await call('create_project', { name: '读书' });
    expect(text).toContain('"entityType": "PROJECT"');
    expect(text).toContain('"entityId": "project-1"');
    // 🔴 这条才是牙齿：把它改成"照旧回 taskId"，模型就以为刚建了一条任务。
    expect(text).not.toContain('taskId');
  });

  it('create_habit 的回包同样点名实体类型', async () => {
    const text = await call('create_habit', { name: '喝水' });
    expect(text).toContain('"entityType": "HABIT"');
    expect(text).not.toContain('taskId');
  });

  it('任务写入**保持既有形状**（`{ok:true,taskId}`，不多不少）', async () => {
    const { host } = recordingHost();
    const handle = createLocalApiHandler({
      host,
      getConfig: () => ({ ...config, grants: { create_task: true } }),
    });
    const res = await handle(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_task', arguments: { title: 'x' } } },
      'tok',
    );
    const r = res as { result: { content: readonly { text: string }[] } };
    expect(JSON.parse(r.result.content[0]?.text ?? '{}')).toEqual({ ok: true, taskId: 'created-1' });
  });
});

describe('写工具的出境字段（覆盖**整份**目录，以后加工具不必再来加名字）', () => {
  it('目录里每一个 write 工具的 `egressFields` 都是空表', () => {
    const writes = LOCAL_API_TOOLS.filter((t) => t.kind === 'write');
    expect(writes.length).toBeGreaterThanOrEqual(5);
    for (const tool of writes) {
      expect(tool.egressFields, `${tool.name} 只产出提案、结果不回送模型 ⇒ 不该有出境字段`).toEqual([]);
    }
  });

  it('每个 read 工具的 `egressFields` 都非空且带 `<实体>.<字段>` 的命名', () => {
    const reads = LOCAL_API_TOOLS.filter((t) => t.kind === 'read');
    for (const tool of reads) {
      expect(tool.egressFields.length, tool.name).toBeGreaterThan(0);
      for (const field of tool.egressFields) {
        expect(field, `${tool.name} 的字段 ${field} 不符合「实体.字段」口径`).toMatch(/^[a-z_]+\.[A-Za-z]+$/);
      }
    }
  });
});
