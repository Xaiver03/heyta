/**
 * HABIT 写工具（批次 3：改名 / 删除到回收站 / 从回收站恢复）的**形状**判据
 * ==========================================================================
 *
 * 契约：`docs/plans/2026-11-22-tool-layer-batch3-contract.md` §3（habit.ts 行）。
 *
 * 每个工具钉三件事，缺一件就有东西在说谎：
 * 1. 🔴 **正常参数产出合法的写入意图** —— 字段一个不多一个不少。
 * 2. 🔴 **未知参数一律拒绝** —— 严格白名单，而不是"忽略多出来的键"。
 * 3. 🔴 **缺必填 / 类型不对一律拒绝** —— 不猜、不补默认值、不把空串当成"没给"。
 *
 * 另外钉住目录声明：`egressFields: []`、`kind:'write'`、`defaultEnabled:false`，
 * 以及风险档（删除 = `destructive-reversible`（→ 回收站可逆），改名/恢复 = `write`）。
 *
 * 本文件只驱动 `toWriteIntent`（纯函数，不碰宿主）—— "落库由 op-log 单入口完成"
 * 由 app-host 的 `submitIntent` 判据负责，不在本包这一层。
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
// rename_habit
// ─────────────────────────────────────────────────────────────────────────
describe('rename_habit：参数 → 意图', () => {
  it('正常参数产出 rename-habit 意图，字段一个不多一个不少', () => {
    expect(intentOf('rename_habit', { habitId: 'h1', name: '早起' })).toEqual({
      action: 'rename-habit',
      habitId: 'h1',
      name: '早起',
    });
  });

  it('未知参数被拒绝（严格白名单）', () => {
    expectRejected('rename_habit', { habitId: 'h1', name: '早起', color: 'red' }, 'color');
    expectRejected('rename_habit', { habitId: 'h1', name: '早起', target: 3 }, 'target');
  });

  it('缺必填 / 类型不对被拒绝', () => {
    expectRejected('rename_habit', {}, 'habitId');
    expectRejected('rename_habit', { name: '早起' }, 'habitId');
    expectRejected('rename_habit', { habitId: 'h1' }, 'name');
    expectRejected('rename_habit', { habitId: 'h1', name: '' }, 'name');
    expectRejected('rename_habit', { habitId: 'h1', name: '   ' }, 'name');
    expectRejected('rename_habit', { habitId: 7, name: '早起' }, 'habitId');
    expectRejected('rename_habit', { habitId: 'h1', name: 42 }, 'name');
    expectRejected('rename_habit', { habitId: 'h1', name: null }, 'name');
    expectRejected('rename_habit', { habitId: '', name: '早起' }, 'habitId');
    expectRejected('rename_habit', { habitId: '   ', name: '早起' }, 'habitId');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// delete_habit
// ─────────────────────────────────────────────────────────────────────────
describe('delete_habit：参数 → 意图', () => {
  it('正常参数产出 delete-habit 意图', () => {
    expect(intentOf('delete_habit', { habitId: 'h1' })).toEqual({
      action: 'delete-habit',
      habitId: 'h1',
    });
  });

  it('未知参数被拒绝（严格白名单，尤其不许带 purge）', () => {
    expectRejected('delete_habit', { habitId: 'h1', purge: true }, 'purge');
    expectRejected('delete_habit', { habitId: 'h1', name: '早起' }, 'name');
  });

  it('缺必填 / 类型不对被拒绝', () => {
    expectRejected('delete_habit', {}, 'habitId');
    expectRejected('delete_habit', { habitId: '' }, 'habitId');
    expectRejected('delete_habit', { habitId: '   ' }, 'habitId');
    expectRejected('delete_habit', { habitId: 7 }, 'habitId');
    expectRejected('delete_habit', { habitId: null }, 'habitId');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// restore_habit
// ─────────────────────────────────────────────────────────────────────────
describe('restore_habit：参数 → 意图', () => {
  it('正常参数产出 restore-habit 意图', () => {
    expect(intentOf('restore_habit', { habitId: 'h1' })).toEqual({
      action: 'restore-habit',
      habitId: 'h1',
    });
  });

  it('未知参数被拒绝（严格白名单）', () => {
    expectRejected('restore_habit', { habitId: 'h1', force: true }, 'force');
    expectRejected('restore_habit', { habitId: 'h1', name: '早起' }, 'name');
  });

  it('缺必填 / 类型不对被拒绝', () => {
    expectRejected('restore_habit', {}, 'habitId');
    expectRejected('restore_habit', { habitId: '' }, 'habitId');
    expectRejected('restore_habit', { habitId: '   ' }, 'habitId');
    expectRejected('restore_habit', { habitId: 7 }, 'habitId');
    expectRejected('restore_habit', { habitId: null }, 'habitId');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 目录声明（风险档 / 出境面 / 默认关）与契约 §3 逐条一致
// ─────────────────────────────────────────────────────────────────────────
describe('目录声明与契约 §3 逐条一致', () => {
  const EXPECTED = [
    { name: 'rename_habit', risk: 'write' },
    { name: 'delete_habit', risk: 'destructive-reversible' },
    { name: 'restore_habit', risk: 'write' },
  ] as const;

  it('三个工具都在目录里，且 kind/risk/egressFields/defaultEnabled 正确', () => {
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
