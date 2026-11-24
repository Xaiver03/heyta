/**
 * SECTION（清单内分组，ADR-0091）工具包的行为判据
 * =================================================
 *
 * 写工具钉三件事（同 `project-tag-tools-lifecycle.spec.ts`）：
 *   1. 正常参数产出合法意图，字段一个不多一个不少；
 *   2. 未知参数一律拒绝（严格白名单，不是"忽略多出来的键"）；
 *   3. 缺必填 / 类型不对一律拒绝（不猜、不补默认值）。
 *
 * 读工具钉两件事：
 *   1. 宿主接了 `listSections` ⇒ 出境只在声明的五格里，且 `order` 缺席时不出现；
 *   2. 宿主没接（`listSections` 未注入）⇒ **明确说读不到**，不是给一个空列表。
 */

import { describe, expect, it } from 'vitest';

import {
  LOCAL_API_TOOLS,
  findTool,
  runReadTool,
  toWriteIntent,
  type LocalApiEventItem,
  type LocalApiHost,
  type LocalApiWriteResult,
} from '../src/index.js';

function intentOf(name: string, args: Record<string, unknown>): Record<string, unknown> & { action: string } {
  const outcome = toWriteIntent(name, args);
  expect(outcome.ok, `期望 ${name} 合法：${JSON.stringify({ args, outcome })}`).toBe(true);
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome.intent as Record<string, unknown> & { action: string };
}

function expectRejected(name: string, args: Record<string, unknown>, mustMention?: string): void {
  const outcome = toWriteIntent(name, args);
  expect(outcome.ok, `期望 ${name} 拒绝：${JSON.stringify(args)}`).toBe(false);
  if (outcome.ok) return;
  expect(outcome.message).not.toContain('注册不齐');
  if (mustMention !== undefined) expect(outcome.message).toContain(mustMention);
}

/** 只实现本文件用到的读路径的假宿主；`listSections` 可选（省略即验证"读不到"那条）。 */
function host(withSections: boolean): LocalApiHost {
  const base: LocalApiHost = {
    listTasks: async () => [],
    getTask: async () => undefined,
    listProjects: async () => [],
    listHabits: async () => [],
    listTags: async () => [],
    listNotes: async () => [],
    getNote: async () => undefined,
    listHabitLogs: async () => [],
    listFocusSessions: async () => [],
    listReminders: async () => [],
    listEvents: () => Promise.resolve([] as readonly LocalApiEventItem[]),
    getEvent: async () => undefined,
    submit: async (): Promise<LocalApiWriteResult> => ({ ok: true, taskId: 'created-1' }),
  };
  if (withSections) {
    base.listSections = async (projectId: string) => [
      { id: 'sec-1', projectId, name: '新手入门', taskCount: 3 },
      { id: 'sec-2', projectId, name: '功能模块', order: 2, taskCount: 6 },
    ];
  }
  return base;
}

// ─────────────────────────────────────────────────────────────────────────
// create_section
// ─────────────────────────────────────────────────────────────────────────
describe('create_section：参数 → 意图', () => {
  it('正常参数产出 create-section 意图', () => {
    expect(intentOf('create_section', { projectId: 'p1', name: '新手入门' })).toEqual({
      action: 'create-section',
      projectId: 'p1',
      name: '新手入门',
    });
  });

  it('未知参数被拒绝', () => {
    expectRejected('create_section', { projectId: 'p1', name: '组', color: 'red' }, 'color');
  });

  it('缺必填 / 空白名 / 类型不对被拒绝', () => {
    expectRejected('create_section', {}, 'projectId');
    expectRejected('create_section', { projectId: 'p1' }, 'name');
    expectRejected('create_section', { name: '组' }, 'projectId');
    expectRejected('create_section', { projectId: 'p1', name: '   ' });
    expectRejected('create_section', { projectId: '', name: '组' });
    expectRejected('create_section', { projectId: 'p1', name: 42 });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// rename_section
// ─────────────────────────────────────────────────────────────────────────
describe('rename_section：参数 → 意图', () => {
  it('正常参数产出 rename-section 意图', () => {
    expect(intentOf('rename_section', { sectionId: 's1', name: '功能模块' })).toEqual({
      action: 'rename-section',
      sectionId: 's1',
      name: '功能模块',
    });
  });

  it('未知参数被拒绝', () => {
    expectRejected('rename_section', { sectionId: 's1', name: '组', order: 1 }, 'order');
  });

  it('缺必填 / 空白名 / 类型不对被拒绝', () => {
    expectRejected('rename_section', {}, 'sectionId');
    expectRejected('rename_section', { sectionId: 's1' }, 'name');
    expectRejected('rename_section', { sectionId: 's1', name: '  ' });
    expectRejected('rename_section', { sectionId: '', name: '组' });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// reorder_section
// ─────────────────────────────────────────────────────────────────────────
describe('reorder_section：参数 → 意图', () => {
  it('正常参数产出 reorder-section 意图', () => {
    expect(intentOf('reorder_section', { sectionId: 's1', order: 2 })).toEqual({
      action: 'reorder-section',
      sectionId: 's1',
      order: 2,
    });
  });

  it('未知参数被拒绝', () => {
    expectRejected('reorder_section', { sectionId: 's1', order: 2, name: '组' }, 'name');
  });

  it('order 非非负整数 / 类型不对被拒绝', () => {
    expectRejected('reorder_section', { sectionId: 's1' }, 'order');
    expectRejected('reorder_section', { sectionId: 's1', order: -1 });
    expectRejected('reorder_section', { sectionId: 's1', order: 1.5 });
    expectRejected('reorder_section', { sectionId: 's1', order: '2' });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// set_task_section
// ─────────────────────────────────────────────────────────────────────────
describe('set_task_section：参数 → 意图', () => {
  it('带 sectionId ⇒ 意图里带上它', () => {
    expect(intentOf('set_task_section', { taskId: 't1', sectionId: 's1' })).toEqual({
      action: 'set-task-section',
      taskId: 't1',
      sectionId: 's1',
    });
  });

  it('🔴 省略 sectionId ⇒ 意图里**不出现** sectionId 键（移出到未分组）', () => {
    const intent = intentOf('set_task_section', { taskId: 't1' });
    expect(intent).toEqual({ action: 'set-task-section', taskId: 't1' });
    expect('sectionId' in intent).toBe(false);
  });

  it('未知参数被拒绝', () => {
    expectRejected('set_task_section', { taskId: 't1', sectionId: 's1', order: 1 }, 'order');
  });

  it('缺 taskId / 空 sectionId 被拒绝', () => {
    expectRejected('set_task_section', {}, 'taskId');
    expectRejected('set_task_section', { taskId: '' }, 'taskId');
    expectRejected('set_task_section', { taskId: 't1', sectionId: '' }, 'sectionId');
    expectRejected('set_task_section', { taskId: 't1', sectionId: 42 }, 'sectionId');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// delete_section
// ─────────────────────────────────────────────────────────────────────────
describe('delete_section：参数 → 意图', () => {
  it('正常参数产出 delete-section 意图', () => {
    expect(intentOf('delete_section', { sectionId: 's1' })).toEqual({
      action: 'delete-section',
      sectionId: 's1',
    });
  });

  it('未知参数被拒绝', () => {
    expectRejected('delete_section', { sectionId: 's1', force: true }, 'force');
  });

  it('缺 sectionId / 空值被拒绝', () => {
    expectRejected('delete_section', {}, 'sectionId');
    expectRejected('delete_section', { sectionId: '' }, 'sectionId');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// list_sections（读）
// ─────────────────────────────────────────────────────────────────────────
describe('list_sections：读侧', () => {
  it('宿主接了 listSections ⇒ 出境只在声明的五格；order 缺席时不出现', async () => {
    const outcome = await runReadTool(host(true), 'list_sections', { projectId: 'p1' });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const rows = outcome.payload as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ id: 'sec-1', projectId: 'p1', name: '新手入门', taskCount: 3 });
    expect('order' in rows[0]!).toBe(false);
    expect(rows[1]).toEqual({ id: 'sec-2', projectId: 'p1', name: '功能模块', order: 2, taskCount: 6 });
    // 出境键都在声明里。
    const declared = new Set((findTool('list_sections')?.egressFields ?? []).map((f) => f.split('.').at(-1) ?? f));
    for (const key of new Set(rows.flatMap((r) => Object.keys(r)))) {
      expect(declared.has(key), `未声明的出境键：${key}`).toBe(true);
    }
  });

  it('🔴 宿主没接 listSections ⇒ 明确说读不到，而不是空列表', async () => {
    const outcome = await runReadTool(host(false), 'list_sections', { projectId: 'p1' });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain('没有分组读取能力');
  });

  it('缺 projectId ⇒ 拒绝', async () => {
    const outcome = await runReadTool(host(true), 'list_sections', {});
    expect(outcome.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 目录声明
// ─────────────────────────────────────────────────────────────────────────
describe('目录声明：SECTION 读写工具', () => {
  const SECTION_TOOLS = ['list_sections', 'create_section', 'rename_section', 'reorder_section', 'set_task_section', 'delete_section'];

  it('六个工具都在目录里，且实体归属 SECTION', () => {
    for (const name of SECTION_TOOLS) {
      const tool = findTool(name);
      expect(tool, `目录缺 ${name}`).toBeDefined();
    }
    // 目录里的工具都能被 pack 处理（tool-pack-coverage 会真跑一遍；这里只对名字）。
    expect(LOCAL_API_TOOLS.some((t) => t.name === 'list_sections' && t.kind === 'read')).toBe(true);
  });

  it('读工具声明非空 egressFields；写工具 egressFields 为空', () => {
    expect((findTool('list_sections')?.egressFields ?? []).length).toBeGreaterThan(0);
    for (const name of SECTION_TOOLS.filter((n) => n !== 'list_sections')) {
      expect(findTool(name)?.egressFields, `${name} 应当声明空 egressFields`).toEqual([]);
      expect(findTool(name)?.kind).toBe('write');
    }
  });

  it('默认不启用（与所有工具同一条：默认关）', () => {
    for (const name of SECTION_TOOLS) {
      expect(findTool(name)?.defaultEnabled).toBe(false);
    }
  });

  it('删除是 destructive-reversible（软删可恢复），其余写是 write', () => {
    expect(findTool('delete_section')?.risk).toBe('destructive-reversible');
    for (const name of ['create_section', 'rename_section', 'reorder_section', 'set_task_section']) {
      expect(findTool(name)?.risk).toBe('write');
    }
  });
});
