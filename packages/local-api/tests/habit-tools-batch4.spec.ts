/**
 * HABIT_LOG 写工具（批次 4：撤销某一天的打卡 `undo_checkin`）的**形状**判据
 * ==========================================================================
 *
 * 契约：`docs/plans/2026-11-22-tool-layer-batch4-contract.md` §3（habit.ts 行 —— 实体归属是
 * HABIT_LOG，写在 `habit-log.ts` 里）。
 *
 * 每个工具钉三件事，缺一件就有东西在说谎：
 * 1. 🔴 **正常参数产出合法的写入意图** —— 字段一个不多一个不少；`date` 省略时**不带该键**。
 * 2. 🔴 **未知参数一律拒绝** —— 严格白名单，而不是"忽略多出来的键"。
 * 3. 🔴 **缺必填 / 类型不对一律拒绝** —— 不猜、不补默认值、不把空串当成"没给"。
 *
 * 另外钉住目录声明：`egressFields: []`、`kind:'write'`、`risk:'write'`、`defaultEnabled:false`。
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
// undo_checkin
// ─────────────────────────────────────────────────────────────────────────
describe('undo_checkin：参数 → 意图', () => {
  it('只给 habitId（省略 date）产出 undo-checkin 意图，且不带 date 键', () => {
    const intent = intentOf('undo_checkin', { habitId: 'h1' });
    expect(intent).toEqual({ action: 'undo-checkin', habitId: 'h1' });
    // 🔴 省略 date 时 intent 里**不能有**这个键（省略 = 今天，由动作层落地）。
    expect(Object.prototype.hasOwnProperty.call(intent, 'date')).toBe(false);
  });

  it('给出 date 时原样带进意图，字段一个不多一个不少', () => {
    expect(intentOf('undo_checkin', { habitId: 'h1', date: '2026-11-22' })).toEqual({
      action: 'undo-checkin',
      habitId: 'h1',
      date: '2026-11-22',
    });
  });

  it('未知参数被拒绝（严格白名单）', () => {
    expectRejected('undo_checkin', { habitId: 'h1', value: 3 }, 'value');
    expectRejected('undo_checkin', { habitId: 'h1', date: '2026-11-22', force: true }, 'force');
    expectRejected('undo_checkin', { habitId: 'h1', name: '早起' }, 'name');
  });

  it('缺必填 / 类型不对 / 非法日期被拒绝', () => {
    expectRejected('undo_checkin', {}, 'habitId');
    expectRejected('undo_checkin', { date: '2026-11-22' }, 'habitId');
    expectRejected('undo_checkin', { habitId: '' }, 'habitId');
    expectRejected('undo_checkin', { habitId: '   ' }, 'habitId');
    expectRejected('undo_checkin', { habitId: 7 }, 'habitId');
    expectRejected('undo_checkin', { habitId: null }, 'habitId');
    // date 类型不对
    expectRejected('undo_checkin', { habitId: 'h1', date: 20261122 }, 'date');
    expectRejected('undo_checkin', { habitId: 'h1', date: null }, 'date');
    // date 格式不对 / 不是真实存在的一天
    expectRejected('undo_checkin', { habitId: 'h1', date: '2026/11/22' }, 'date');
    expectRejected('undo_checkin', { habitId: 'h1', date: '2026-02-30' }, 'date');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 目录声明（风险档 / 出境面 / 默认关）与契约 §3 逐条一致
// ─────────────────────────────────────────────────────────────────────────
describe('目录声明与契约 §3 逐条一致', () => {
  it('undo_checkin 在目录里，且 kind/risk/egressFields/defaultEnabled 正确', () => {
    const tool = findTool('undo_checkin');
    expect(tool, '目录里没有「undo_checkin」').toBeDefined();
    expect(tool?.kind, 'undo_checkin 必须是写工具').toBe('write');
    expect(tool?.risk, 'undo_checkin 的风险档').toBe('write');
    expect(tool?.egressFields, 'undo_checkin 只产出提案 ⇒ 出境面必须为空').toEqual([]);
    expect(tool?.defaultEnabled, 'undo_checkin 必须默认关').toBe(false);
  });

  it('它确实进了全局目录（不是只在 pack 里）', () => {
    expect(LOCAL_API_TOOLS.map((t) => t.name)).toContain('undo_checkin');
  });
});
