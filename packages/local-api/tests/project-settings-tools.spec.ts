/**
 * 清单级设置写工具的**形状**判据（2026-11-24 工作包 A）
 * ======================================================
 *
 * 工具：`set_project_icon` / `set_project_view_mode` / `set_project_kind` /
 * `set_project_show_in_smart_list`（`packages/local-api/src/tools/project.ts`）。
 *
 * 每个工具钉三件事，缺一件就有东西在说谎：
 * 1. 正常参数产出合法意图（字段一个不多一个不少；省略可选字段时**不带该键**）。
 * 2. 未知参数一律拒绝（严格白名单）。
 * 3. 缺必填 / 类型不对一律拒绝（不猜、不补默认）。
 *
 * 🔴 闭集 / 枚举**词表**的校验不在这里：本包零依赖、看不见 domain 的
 * `PROJECT_ICONS` / 枚举，词表归动作层（`app-host`）。这里只钉形状。
 *
 * 本文件只驱动 `toWriteIntent`（纯函数，不碰宿主）；落库由 `app-host` 的
 * 提案/确认判据负责（见 `ai-tool-proposal-all-writes.spec.ts`）。
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

// ─────────────── set_project_icon ───────────────
describe('set_project_icon', () => {
  it('给 icon 产出 set-project-icon', () => {
    expect(intentOf('set_project_icon', { projectId: 'p1', icon: 'star' })).toEqual({
      action: 'set-project-icon',
      projectId: 'p1',
      icon: 'star',
    });
  });
  it('省略 icon = 清除，意图里不带 icon 键', () => {
    const i = intentOf('set_project_icon', { projectId: 'p1' });
    expect(i).toEqual({ action: 'set-project-icon', projectId: 'p1' });
    expect(has(i, 'icon')).toBe(false);
  });
  it('未知参数拒绝', () => {
    expectRejected('set_project_icon', { projectId: 'p1', icon: 'star', x: 1 }, 'x');
  });
  it('icon 空串 / 非串 ⇒ 拒（要清除请省略）', () => {
    expectRejected('set_project_icon', { projectId: 'p1', icon: '' }, 'icon');
    expectRejected('set_project_icon', { projectId: 'p1', icon: '   ' }, 'icon');
    expectRejected('set_project_icon', { projectId: 'p1', icon: 7 }, 'icon');
  });
  it('projectId 缺 / 空 / 非串 ⇒ 拒', () => {
    expectRejected('set_project_icon', { icon: 'star' }, 'projectId');
    expectRejected('set_project_icon', { projectId: '', icon: 'star' }, 'projectId');
    expectRejected('set_project_icon', { projectId: '   ', icon: 'star' }, 'projectId');
    expectRejected('set_project_icon', { projectId: 7, icon: 'star' }, 'projectId');
  });
});

// ─────────────── set_project_view_mode ───────────────
describe('set_project_view_mode', () => {
  it('给 viewMode 产出 set-project-view-mode', () => {
    expect(intentOf('set_project_view_mode', { projectId: 'p1', viewMode: 'board' })).toEqual({
      action: 'set-project-view-mode',
      projectId: 'p1',
      viewMode: 'board',
    });
  });
  it('省略 viewMode = 清除，意图里不带 viewMode 键', () => {
    const i = intentOf('set_project_view_mode', { projectId: 'p1' });
    expect(i).toEqual({ action: 'set-project-view-mode', projectId: 'p1' });
    expect(has(i, 'viewMode')).toBe(false);
  });
  it('未知参数拒绝', () => {
    expectRejected('set_project_view_mode', { projectId: 'p1', viewMode: 'board', y: 1 }, 'y');
  });
  it('viewMode 空串 / 非串 ⇒ 拒', () => {
    expectRejected('set_project_view_mode', { projectId: 'p1', viewMode: '' }, 'viewMode');
    expectRejected('set_project_view_mode', { projectId: 'p1', viewMode: '   ' }, 'viewMode');
    expectRejected('set_project_view_mode', { projectId: 'p1', viewMode: 3 }, 'viewMode');
  });
  it('projectId 缺 / 空 / 非串 ⇒ 拒', () => {
    expectRejected('set_project_view_mode', { viewMode: 'board' }, 'projectId');
    expectRejected('set_project_view_mode', { projectId: '', viewMode: 'board' }, 'projectId');
    expectRejected('set_project_view_mode', { projectId: 7, viewMode: 'board' }, 'projectId');
  });
});

// ─────────────── set_project_kind ───────────────
describe('set_project_kind', () => {
  it('给 kind 产出 set-project-kind', () => {
    expect(intentOf('set_project_kind', { projectId: 'p1', kind: 'notes' })).toEqual({
      action: 'set-project-kind',
      projectId: 'p1',
      kind: 'notes',
    });
  });
  it('省略 kind = 清除，意图里不带 kind 键', () => {
    const i = intentOf('set_project_kind', { projectId: 'p1' });
    expect(i).toEqual({ action: 'set-project-kind', projectId: 'p1' });
    expect(has(i, 'kind')).toBe(false);
  });
  it('未知参数拒绝', () => {
    expectRejected('set_project_kind', { projectId: 'p1', kind: 'notes', z: 1 }, 'z');
  });
  it('kind 空串 / 非串 ⇒ 拒', () => {
    expectRejected('set_project_kind', { projectId: 'p1', kind: '' }, 'kind');
    expectRejected('set_project_kind', { projectId: 'p1', kind: '   ' }, 'kind');
    expectRejected('set_project_kind', { projectId: 'p1', kind: 1 }, 'kind');
  });
  it('projectId 缺 / 空 / 非串 ⇒ 拒', () => {
    expectRejected('set_project_kind', { kind: 'notes' }, 'projectId');
    expectRejected('set_project_kind', { projectId: '', kind: 'notes' }, 'projectId');
    expectRejected('set_project_kind', { projectId: 7, kind: 'notes' }, 'projectId');
  });
});

// ─────────────── set_project_show_in_smart_list ───────────────
describe('set_project_show_in_smart_list', () => {
  it('true / false 都产出 set-project-show-in-smart-list', () => {
    expect(intentOf('set_project_show_in_smart_list', { projectId: 'p1', showInSmartList: true })).toEqual({
      action: 'set-project-show-in-smart-list',
      projectId: 'p1',
      showInSmartList: true,
    });
    expect(intentOf('set_project_show_in_smart_list', { projectId: 'p1', showInSmartList: false })).toEqual({
      action: 'set-project-show-in-smart-list',
      projectId: 'p1',
      showInSmartList: false,
    });
  });
  it('🔴 showInSmartList 是**必填布尔**：缺了它不当作缺省 true 悄悄放行', () => {
    expectRejected('set_project_show_in_smart_list', { projectId: 'p1' }, 'showInSmartList');
  });
  it('未知参数 / 非布尔 ⇒ 拒', () => {
    expectRejected('set_project_show_in_smart_list', { projectId: 'p1', showInSmartList: true, w: 1 }, 'w');
    expectRejected('set_project_show_in_smart_list', { projectId: 'p1', showInSmartList: 'true' }, 'showInSmartList');
    expectRejected('set_project_show_in_smart_list', { projectId: 'p1', showInSmartList: 1 }, 'showInSmartList');
    expectRejected('set_project_show_in_smart_list', { projectId: 'p1', showInSmartList: null }, 'showInSmartList');
  });
  it('projectId 缺 / 空 / 非串 ⇒ 拒', () => {
    expectRejected('set_project_show_in_smart_list', { showInSmartList: true }, 'projectId');
    expectRejected('set_project_show_in_smart_list', { projectId: '', showInSmartList: true }, 'projectId');
    expectRejected('set_project_show_in_smart_list', { projectId: 7, showInSmartList: true }, 'projectId');
  });
});

// ─────────────── 目录声明 ───────────────
describe('目录声明：四个清单设置工具均 write / risk write / egress [] / 默认关 / 在全局目录', () => {
  const names = [
    'set_project_icon',
    'set_project_view_mode',
    'set_project_kind',
    'set_project_show_in_smart_list',
  ];
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
