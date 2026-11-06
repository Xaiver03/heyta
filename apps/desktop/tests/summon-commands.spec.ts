/**
 * 托盘菜单内容与"命令 → 动作"那张表（R6 判据③的那一半：菜单不许缺项、不许接错）。
 *
 * 🔴 为什么值得单独钉：菜单项接错动作**在界面上看不出来** ——
 * 把「今天」接到"显示主窗"上，窗口照样弹出来，只是列表没换档。
 * 这类"看起来在工作"的错只能靠把映射写成数据、逐条打一遍来拦。
 */

import { expect, it } from 'vitest';

import { DEFAULT_SUMMON_CONFIG } from '../src/summon-config.js';
import {
  SUMMON_TARGETS,
  TRAY_COMMANDS,
  TRAY_LABELS,
  TRAY_TARGETS,
  buildTrayMenu,
  displayAccelerator,
  mapActions,
  mapTrayActions,
} from '../src/summon-commands.js';

/** 五个动作各换一个可辨识的假实现：谁被叫到，断言就知道。 */
function fakeTargets(): Record<string, () => void> & { calls: string[] } {
  const calls: string[] = [];
  const names = ['toggleMainWindow', 'openQuickAdd', 'showToday', 'showMainWindow', 'quit'];
  const targets: Record<string, () => void> = {};
  for (const name of names) targets[name] = () => calls.push(name);
  return Object.assign(targets, { calls });
}

it('四条命令全部在场，文案就是那四个词', () => {
  const items = buildTrayMenu({ config: DEFAULT_SUMMON_CONFIG, platform: 'darwin', problems: [] });
  const labels = items.filter((item) => 'id' in item).map((item) => item.label);
  expect(labels).toEqual(['今天', '快速添加', '显示主窗', '退出']);
  expect(labels).toEqual(TRAY_COMMANDS.map((id) => TRAY_LABELS[id]));
});

it('🔴 退出永远排最后（说明行再多也不许把退出插到中间）', () => {
  const withNotices = buildTrayMenu({
    config: DEFAULT_SUMMON_CONFIG,
    platform: 'darwin',
    problems: ['quickAdd 的组合键「X」没被系统接受', '配置文件里有一项不认识：foo'],
  });
  expect(withNotices[withNotices.length - 1]).toEqual({
    id: 'quit',
    label: '退出',
    enabled: true,
  });
  const commands = withNotices.filter((item) => 'id' in item);
  expect(commands).toHaveLength(TRAY_COMMANDS.length);
});

it('有问题时的说明行不是命令（不许出现一枚点了没反应的"命令"）', () => {
  const items = buildTrayMenu({
    config: DEFAULT_SUMMON_CONFIG,
    platform: 'darwin',
    problems: ['showHide 的组合键「CommandOrControl+Alt+Shift+S」没被系统接受'],
  });
  const notices = items.filter((item) => !('id' in item));
  expect(notices.length).toBeGreaterThan(0);
  for (const notice of notices) expect(notice.enabled).toBe(false);
  // 问题原文要**一字不少**地出现在菜单里，否则用户只知道"不可用"而不知道该怎么办。
  expect(notices.map((n) => n.label).join('\n')).toContain('没被系统接受');
});

it('没问题时一行说明都不画（菜单不许常年挂着与用户无关的诊断）', () => {
  const items = buildTrayMenu({ config: DEFAULT_SUMMON_CONFIG, platform: 'darwin', problems: [] });
  expect(items.every((item) => 'id' in item)).toBe(true);
});

it('每条托盘命令叫到的是它自己那个动作', () => {
  const targets = fakeTargets();
  const actions = mapTrayActions(targets as never);
  for (const id of TRAY_COMMANDS) {
    targets.calls.length = 0;
    actions[id]();
    expect(targets.calls, `${id} 接错动作`).toEqual([TRAY_TARGETS[id]]);
  }
});

it('两条热键分别接"显示/隐藏"与"快速添加"，不接显示主窗', () => {
  expect(SUMMON_TARGETS).toEqual({ showHide: 'toggleMainWindow', quickAdd: 'openQuickAdd' });
  const targets = fakeTargets();
  const handlers = mapActions({
    keys: ['showHide', 'quickAdd'] as const,
    targetOf: (key) => SUMMON_TARGETS[key],
    labelOf: (key) => key,
    targets: targets as never,
  });
  targets.calls.length = 0;
  handlers.showHide();
  handlers.quickAdd();
  expect(targets.calls).toEqual(['toggleMainWindow', 'openQuickAdd']);
});

it('装配时少给一个动作就当场抛，而不是留一枚点了没反应的项', () => {
  const incomplete = { openQuickAdd: () => undefined, showToday: () => undefined, showMainWindow: () => undefined };
  expect(() => mapTrayActions(incomplete as never)).toThrow(/退出/);
});

it('键位说明按平台写成用户认识的样子（macOS 是 ⌃⌥⇧⌘ 这个顺序，不是字母序）', () => {
  expect(displayAccelerator('CommandOrControl+Alt+Shift+S', 'darwin')).toBe('⌥⇧⌘S');
  expect(displayAccelerator('CommandOrControl+Alt+Shift+S', 'win32')).toBe('Ctrl+Alt+Shift+S');
  expect(displayAccelerator('Control+Alt+Delete', 'win32')).toBe('Ctrl+Alt+Delete');
  // 认不出的形状原样返回：这一串的读者是人，不是判据。
  expect(displayAccelerator('怪写法', 'darwin')).toBe('怪写法');
});
