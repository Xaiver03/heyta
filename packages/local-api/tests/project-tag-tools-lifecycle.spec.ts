/**
 * PROJECT / TAG 写工具（P1：改名 / 归档 / 删除 / 改名标签 / 删除标签）的**行为**判据
 * ==============================================================================
 *
 * 契约：`docs/plans/2026-11-22-tool-layer-p0-p1-contract.md` §3（project.ts / tag.ts 行）。
 *
 * 每个工具钉三件事，缺一件就有东西在说谎：
 * 1. 🔴 **正常参数产出合法的写入意图** —— 且字段一个不多一个不少；
 * 2. 🔴 **未知参数一律拒绝** —— 严格白名单，而不是"忽略多出来的键"；
 * 3. 🔴 **缺必填 / 类型不对一律拒绝** —— 不猜、不补默认值。
 *
 * 另外钉住目录声明：写工具 `egressFields: []`、`kind:'write'`、`defaultEnabled:false`、
 * 风险档与契约逐条一致（改名 = `write`；归档/删除 = `destructive-reversible`）。
 *
 * 本文件只驱动 `toWriteIntent`（纯函数，不碰宿主）—— "落库由 op-log 单入口完成"由
 * app-host 的 `submitIntent` 判据负责，不在本包这一层。
 */

import { describe, expect, it } from 'vitest';

import { LOCAL_API_TOOLS, findTool, toWriteIntent } from '../src/index.js';

/** 驱动一次 `toWriteIntent` 并取出意图；顺带把"应当是 ok"这条先说清。 */
function intentOf(name: string, args: Record<string, unknown>): Record<string, unknown> & { action: string } {
  const outcome = toWriteIntent(name, args);
  expect(outcome.ok, `期望 ${name} 合法：${JSON.stringify({ args, outcome })}`).toBe(true);
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome.intent as Record<string, unknown> & { action: string };
}

/** 断言一组参数被**拒绝**（且不是"注册不齐"那种系统错）。 */
function expectRejected(name: string, args: Record<string, unknown>, mustMention?: string): void {
  const outcome = toWriteIntent(name, args);
  expect(outcome.ok, `期望 ${name} 拒绝：${JSON.stringify(args)}`).toBe(false);
  if (outcome.ok) return;
  // 拒绝必须是"你的参数错"，不能是"这个工具没人认领"——后者是 heyta 的缺陷。
  expect(outcome.message).not.toContain('注册不齐');
  if (mustMention !== undefined) expect(outcome.message).toContain(mustMention);
}

// ─────────────────────────────────────────────────────────────────────────
// rename_project
// ─────────────────────────────────────────────────────────────────────────
describe('rename_project：参数 → 意图', () => {
  it('正常参数产出 rename-project 意图', () => {
    expect(intentOf('rename_project', { projectId: 'p1', name: '读书' })).toEqual({
      action: 'rename-project',
      projectId: 'p1',
      name: '读书',
    });
  });

  it('未知参数被拒绝', () => {
    expectRejected('rename_project', { projectId: 'p1', name: '读书', color: 'red' }, 'color');
  });

  it('缺必填 / 空白名 / 类型不对被拒绝', () => {
    expectRejected('rename_project', {}, 'projectId');
    expectRejected('rename_project', { projectId: 'p1' }, 'name');
    expectRejected('rename_project', { name: '读书' }, 'projectId');
    expectRejected('rename_project', { projectId: 'p1', name: '   ' });
    expectRejected('rename_project', { projectId: '', name: '读书' });
    expectRejected('rename_project', { projectId: 'p1', name: 42 });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// archive_project
// ─────────────────────────────────────────────────────────────────────────
describe('archive_project：参数 → 意图', () => {
  it('省略 archived ⇒ 意图里**不出现** archived 键（默认归档由宿主按 ?? true 落）', () => {
    const intent = intentOf('archive_project', { projectId: 'p1' });
    expect(intent).toEqual({ action: 'archive-project', projectId: 'p1' });
    expect('archived' in intent).toBe(false);
  });

  it('archived:false / true 原样带上', () => {
    expect(intentOf('archive_project', { projectId: 'p1', archived: false })).toEqual({
      action: 'archive-project',
      projectId: 'p1',
      archived: false,
    });
    expect(intentOf('archive_project', { projectId: 'p1', archived: true })).toEqual({
      action: 'archive-project',
      projectId: 'p1',
      archived: true,
    });
  });

  it('未知参数被拒绝', () => {
    expectRejected('archive_project', { projectId: 'p1', silent: true }, 'silent');
  });

  it('缺必填 / archived 不是布尔被拒绝', () => {
    expectRejected('archive_project', {}, 'projectId');
    expectRejected('archive_project', { projectId: '' });
    // 🔴 不是布尔时不许当成"没给"：那会把"恢复"默默变成"归档"。
    expectRejected('archive_project', { projectId: 'p1', archived: 'true' }, 'archived');
    expectRejected('archive_project', { projectId: 'p1', archived: 1 }, 'archived');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// delete_project
// ─────────────────────────────────────────────────────────────────────────
describe('delete_project：参数 → 意图', () => {
  it('正常参数产出 delete-project 意图', () => {
    expect(intentOf('delete_project', { projectId: 'p1' })).toEqual({
      action: 'delete-project',
      projectId: 'p1',
    });
  });

  it('未知参数被拒绝', () => {
    expectRejected('delete_project', { projectId: 'p1', purge: true }, 'purge');
  });

  it('缺必填 / 类型不对被拒绝', () => {
    expectRejected('delete_project', {}, 'projectId');
    expectRejected('delete_project', { projectId: '' });
    expectRejected('delete_project', { projectId: 7 });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// rename_tag
// ─────────────────────────────────────────────────────────────────────────
describe('rename_tag：参数 → 意图', () => {
  it('正常参数产出 rename-tag 意图', () => {
    expect(intentOf('rename_tag', { tagId: 'g1', name: '家里' })).toEqual({
      action: 'rename-tag',
      tagId: 'g1',
      name: '家里',
    });
  });

  it('未知参数被拒绝', () => {
    expectRejected('rename_tag', { tagId: 'g1', name: '家里', color: '#fff' }, 'color');
  });

  it('缺必填 / 空白名 / 类型不对被拒绝', () => {
    expectRejected('rename_tag', {}, 'tagId');
    expectRejected('rename_tag', { tagId: 'g1' }, 'name');
    expectRejected('rename_tag', { name: '家里' }, 'tagId');
    expectRejected('rename_tag', { tagId: 'g1', name: '  ' });
    expectRejected('rename_tag', { tagId: 'g1', name: null });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// delete_tag
// ─────────────────────────────────────────────────────────────────────────
describe('delete_tag：参数 → 意图', () => {
  it('正常参数产出 delete-tag 意图', () => {
    expect(intentOf('delete_tag', { tagId: 'g1' })).toEqual({
      action: 'delete-tag',
      tagId: 'g1',
    });
  });

  it('未知参数被拒绝', () => {
    expectRejected('delete_tag', { tagId: 'g1', alsoTasks: true }, 'alsoTasks');
  });

  it('缺必填 / 类型不对被拒绝', () => {
    expectRejected('delete_tag', {}, 'tagId');
    expectRejected('delete_tag', { tagId: '' });
    expectRejected('delete_tag', { tagId: 7 });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 目录声明（风险档 / 出境面 / 默认关）
// ─────────────────────────────────────────────────────────────────────────
describe('目录声明与契约 §3 逐条一致', () => {
  const EXPECTED = [
    { name: 'rename_project', risk: 'write' },
    { name: 'archive_project', risk: 'destructive-reversible' },
    { name: 'delete_project', risk: 'destructive-reversible' },
    { name: 'rename_tag', risk: 'write' },
    { name: 'delete_tag', risk: 'destructive-reversible' },
  ] as const;

  it('五个工具都在目录里，且 kind/risk/egressFields/defaultEnabled 正确', () => {
    for (const { name, risk } of EXPECTED) {
      const tool = findTool(name);
      expect(tool, `目录里没有「${name}」`).toBeDefined();
      expect(tool?.kind, `${name} 必须是写工具`).toBe('write');
      expect(tool?.risk, `${name} 的风险档`).toBe(risk);
      expect(tool?.egressFields, `${name} 只产出提案 ⇒ 出境面必须为空`).toEqual([]);
      expect(tool?.defaultEnabled, `${name} 必须默认关`).toBe(false);
    }
  });

  it('它们确实进了全局目录（不是只在 pack 里）', () => {
    const names = LOCAL_API_TOOLS.map((t) => t.name);
    for (const { name } of EXPECTED) expect(names).toContain(name);
  });
});
