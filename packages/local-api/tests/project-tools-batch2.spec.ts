/**
 * PROJECT 写工具（批次 2：层级移动 / 回收站恢复）的**形状**判据
 * ============================================================
 *
 * 契约：`docs/plans/2026-11-22-tool-layer-batch2-contract.md` §3（project.ts 行）。
 *
 * 每个工具钉三件事，缺一件就有东西在说谎：
 * 1. 🔴 **正常参数产出合法的写入意图** —— 字段一个不多一个不少；
 *    `move_project` 省略 `parentId` 时意图里**不出现该键**（= 提为顶层）。
 * 2. 🔴 **未知参数一律拒绝** —— 严格白名单，而不是"忽略多出来的键"。
 * 3. 🔴 **缺必填 / 类型不对一律拒绝** —— 不猜、不补默认值。
 *
 * 另外钉住目录声明：写工具 `egressFields: []`、`kind:'write'`、`defaultEnabled:false`、
 * 风险档两条都是 `write`（移动/恢复都不销毁数据）。
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
// move_project
// ─────────────────────────────────────────────────────────────────────────
describe('move_project：参数 → 意图', () => {
  it('带 parentId ⇒ 产出 move-project 意图并原样带上 parentId', () => {
    expect(intentOf('move_project', { projectId: 'p1', parentId: 'p2' })).toEqual({
      action: 'move-project',
      projectId: 'p1',
      parentId: 'p2',
    });
  });

  it('省略 parentId ⇒ 意图里**不出现** parentId 键（= 提为顶层）', () => {
    const intent = intentOf('move_project', { projectId: 'p1' });
    expect(intent).toEqual({ action: 'move-project', projectId: 'p1' });
    expect('parentId' in intent).toBe(false);
  });

  it('未知参数被拒绝', () => {
    expectRejected('move_project', { projectId: 'p1', order: 3 }, 'order');
    expectRejected('move_project', { projectId: 'p1', parentId: 'p2', color: 'red' }, 'color');
  });

  it('缺必填 / 类型不对被拒绝', () => {
    expectRejected('move_project', {}, 'projectId');
    expectRejected('move_project', { parentId: 'p2' }, 'projectId');
    expectRejected('move_project', { projectId: '' });
    expectRejected('move_project', { projectId: '   ' });
    expectRejected('move_project', { projectId: 7 });
  });

  it('显式给了 parentId 但不是非空字符串 ⇒ 拒绝（不能当成"没给"）', () => {
    expectRejected('move_project', { projectId: 'p1', parentId: '' }, 'parentId');
    expectRejected('move_project', { projectId: 'p1', parentId: '   ' }, 'parentId');
    expectRejected('move_project', { projectId: 'p1', parentId: 42 }, 'parentId');
    expectRejected('move_project', { projectId: 'p1', parentId: null }, 'parentId');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// restore_project
// ─────────────────────────────────────────────────────────────────────────
describe('restore_project：参数 → 意图', () => {
  it('正常参数产出 restore-project 意图', () => {
    expect(intentOf('restore_project', { projectId: 'p1' })).toEqual({
      action: 'restore-project',
      projectId: 'p1',
    });
  });

  it('未知参数被拒绝', () => {
    expectRejected('restore_project', { projectId: 'p1', purge: true }, 'purge');
  });

  it('缺必填 / 类型不对被拒绝', () => {
    expectRejected('restore_project', {}, 'projectId');
    expectRejected('restore_project', { projectId: '' });
    expectRejected('restore_project', { projectId: '   ' });
    expectRejected('restore_project', { projectId: 7 });
    expectRejected('restore_project', { projectId: null });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 目录声明（风险档 / 出境面 / 默认关）
// ─────────────────────────────────────────────────────────────────────────
describe('目录声明与契约 §3 逐条一致', () => {
  const EXPECTED = [
    { name: 'move_project', risk: 'write' },
    { name: 'restore_project', risk: 'write' },
  ] as const;

  it('两个工具都在目录里，且 kind/risk/egressFields/defaultEnabled 正确', () => {
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
