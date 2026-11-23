/**
 * 清单 / 习惯属性写工具（批次 6）的**形状**判据
 * ==============================================
 *
 * 契约：`docs/plans/ai-event-tool-contract.md` §5.4（颜色/图标：AI 只在用户明确点名时执行）；
 * 工具：`set_project_color` / `set_habit_color` / `set_habit_icon` / `set_habit_goal` / `set_habit_frequency`。
 *
 * 每个工具钉三件事，缺一件就有东西在说谎：
 * 1. 正常参数产出合法意图（字段一个不多一个不少；省略可选字段时**不带该键**）。
 * 2. 未知参数一律拒绝（严格白名单）。
 * 3. 缺必填 / 类型不对 / 越界一律拒绝（不猜、不补默认）。
 *
 * 本文件只驱动 `toWriteIntent`（纯函数，不碰宿主）；落库由 app-host 的 `submitIntent` 判据负责。
 */

import { describe, expect, it } from 'vitest';

import { LOCAL_API_TOOLS, findTool, toWriteIntent } from '../src/index.js';

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

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

// ─────────────── set_project_color ───────────────
describe('set_project_color', () => {
  it('给 color 产出 set-project-color', () => {
    expect(intentOf('set_project_color', { projectId: 'p1', color: 3 })).toEqual({
      action: 'set-project-color',
      projectId: 'p1',
      color: 3,
    });
  });
  it('省略 color = 清除，意图里不带 color 键', () => {
    const i = intentOf('set_project_color', { projectId: 'p1' });
    expect(i).toEqual({ action: 'set-project-color', projectId: 'p1' });
    expect(has(i, 'color')).toBe(false);
  });
  it('未知参数拒绝', () => {
    expectRejected('set_project_color', { projectId: 'p1', color: 3, x: 1 }, 'x');
  });
  it('color 不是 1–8 整数 ⇒ 拒', () => {
    for (const c of [0, 9, 3.5, -1, 100]) expectRejected('set_project_color', { projectId: 'p1', color: c }, 'color');
    expectRejected('set_project_color', { projectId: 'p1', color: '3' }, 'color');
    expectRejected('set_project_color', { projectId: 'p1', color: null }, 'color');
  });
  it('projectId 缺 / 空 / 非串 ⇒ 拒', () => {
    expectRejected('set_project_color', { color: 3 }, 'projectId');
    expectRejected('set_project_color', { projectId: '', color: 3 }, 'projectId');
    expectRejected('set_project_color', { projectId: '   ', color: 3 }, 'projectId');
    expectRejected('set_project_color', { projectId: 7, color: 3 }, 'projectId');
  });
});

// ─────────────── set_habit_color ───────────────
describe('set_habit_color', () => {
  it('给 color 产出 set-habit-color', () => {
    expect(intentOf('set_habit_color', { habitId: 'h1', color: 2 })).toEqual({
      action: 'set-habit-color',
      habitId: 'h1',
      color: 2,
    });
  });
  it('省略 color = 清除', () => {
    const i = intentOf('set_habit_color', { habitId: 'h1' });
    expect(i).toEqual({ action: 'set-habit-color', habitId: 'h1' });
    expect(has(i, 'color')).toBe(false);
  });
  it('未知参数 / color 越界 / habitId 缺失 ⇒ 拒', () => {
    expectRejected('set_habit_color', { habitId: 'h1', color: 2, y: 1 }, 'y');
    expectRejected('set_habit_color', { habitId: 'h1', color: 9 }, 'color');
    expectRejected('set_habit_color', { color: 2 }, 'habitId');
    expectRejected('set_habit_color', { habitId: '', color: 2 }, 'habitId');
  });
});

// ─────────────── set_habit_icon ───────────────
describe('set_habit_icon', () => {
  it('给 icon 产出 set-habit-icon', () => {
    expect(intentOf('set_habit_icon', { habitId: 'h1', icon: 'book' })).toEqual({
      action: 'set-habit-icon',
      habitId: 'h1',
      icon: 'book',
    });
  });
  it('省略 icon = 清除', () => {
    const i = intentOf('set_habit_icon', { habitId: 'h1' });
    expect(i).toEqual({ action: 'set-habit-icon', habitId: 'h1' });
    expect(has(i, 'icon')).toBe(false);
  });
  it('未知参数 / icon 空串或非串 / habitId 缺失 ⇒ 拒', () => {
    expectRejected('set_habit_icon', { habitId: 'h1', icon: 'book', z: 1 }, 'z');
    expectRejected('set_habit_icon', { habitId: 'h1', icon: '' }, 'icon');
    expectRejected('set_habit_icon', { habitId: 'h1', icon: '   ' }, 'icon');
    expectRejected('set_habit_icon', { habitId: 'h1', icon: 7 }, 'icon');
    expectRejected('set_habit_icon', { icon: 'book' }, 'habitId');
  });
});

// ─────────────── set_habit_goal ───────────────
describe('set_habit_goal', () => {
  it('target 产出 set-habit-goal（只带给的字段）', () => {
    expect(intentOf('set_habit_goal', { habitId: 'h1', target: 5 })).toEqual({
      action: 'set-habit-goal',
      habitId: 'h1',
      target: 5,
    });
  });
  it('三字段可同时给', () => {
    expect(intentOf('set_habit_goal', { habitId: 'h1', target: 8, unit: '杯', goalType: 'atMost' })).toEqual({
      action: 'set-habit-goal',
      habitId: 'h1',
      target: 8,
      unit: '杯',
      goalType: 'atMost',
    });
  });
  it('一个字段都不给 ⇒ 拒（至少给一个）', () => {
    expectRejected('set_habit_goal', { habitId: 'h1' }, '至少');
  });
  it('未知参数 / 类型不对 / habitId 缺失 ⇒ 拒', () => {
    expectRejected('set_habit_goal', { habitId: 'h1', target: 5, w: 1 }, 'w');
    expectRejected('set_habit_goal', { habitId: 'h1', target: '5' }, 'target');
    expectRejected('set_habit_goal', { habitId: 'h1', unit: 3 }, 'unit');
    expectRejected('set_habit_goal', { habitId: 'h1', goalType: 1 }, 'goalType');
    expectRejected('set_habit_goal', { target: 5 }, 'habitId');
  });
});

// ─────────────── set_habit_frequency ───────────────
describe('set_habit_frequency', () => {
  it('frequency 对象产出 set-habit-frequency', () => {
    expect(intentOf('set_habit_frequency', { habitId: 'h1', frequency: { type: 'daily' } })).toEqual({
      action: 'set-habit-frequency',
      habitId: 'h1',
      frequency: { type: 'daily' },
    });
  });
  it('省略 frequency = 退回每天，不带该键', () => {
    const i = intentOf('set_habit_frequency', { habitId: 'h1' });
    expect(i).toEqual({ action: 'set-habit-frequency', habitId: 'h1' });
    expect(has(i, 'frequency')).toBe(false);
  });
  it('未知参数 / frequency 非对象 / habitId 缺失 ⇒ 拒', () => {
    expectRejected('set_habit_frequency', { habitId: 'h1', frequency: { type: 'daily' }, v: 1 }, 'v');
    expectRejected('set_habit_frequency', { habitId: 'h1', frequency: 'daily' }, 'frequency');
    expectRejected('set_habit_frequency', { habitId: 'h1', frequency: [1] }, 'frequency');
    expectRejected('set_habit_frequency', { habitId: 'h1', frequency: null }, 'frequency');
    expectRejected('set_habit_frequency', { frequency: { type: 'daily' } }, 'habitId');
  });
});

// ─────────────── 目录声明 ───────────────
describe('目录声明：五个属性工具均 write / risk write / egress [] / 默认关 / 在全局目录', () => {
  const names = ['set_project_color', 'set_habit_color', 'set_habit_icon', 'set_habit_goal', 'set_habit_frequency'];
  for (const name of names) {
    it(name, () => {
      const tool = findTool(name);
      expect(tool, `目录里没有「${name}」`).toBeDefined();
      expect(tool?.kind).toBe('write');
      expect(tool?.risk).toBe('write');
      expect(tool?.egressFields).toEqual([]);
      expect(tool?.defaultEnabled).toBe(false);
      expect(LOCAL_API_TOOLS.map((t) => t.name)).toContain(name);
    });
  }
});
