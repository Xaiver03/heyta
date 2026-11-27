/**
 * `control/command-registry.ts` 的契约 —— 覆盖图谱 #6 的数据层
 *
 * 每条判据旁边写它拦的是什么坏法。这些坏法在界面上**全都看起来正常**
 * （面板能开、能打字、能回车），所以只能在这里钉。
 */

import { describe, expect, it, vi } from 'vitest';

import {
  COMMAND_CURSOR_NONE,
  createCommandRegistry,
  filterCommands,
  moveCommandCursor,
  type Command,
} from '../src/control/command-registry.js';

function cmd(partial: Partial<Command> & Pick<Command, 'id' | 'title'>): Command {
  return {
    group: 'navigate',
    run: () => undefined,
    ...partial,
  };
}

describe('createCommandRegistry', () => {
  it('按 id upsert：重复登记不留两条，且顺序保持在第一次的位置', () => {
    const registry = createCommandRegistry();
    registry.register(cmd({ id: 'a', title: '第一版' }));
    registry.register(cmd({ id: 'b', title: '第二' }));
    registry.register(cmd({ id: 'a', title: '改过的第一' }));

    const list = registry.list();
    expect(list.map((c) => c.id)).toEqual(['a', 'b']);
    expect(list[0]?.title).toBe('改过的第一');
    expect(registry.get('a')?.title).toBe('改过的第一');
  });

  it('空 id 当场抛（空 id 无法注销也无法去重）', () => {
    const registry = createCommandRegistry();
    expect(() => registry.register(cmd({ id: '   ', title: 'x' }))).toThrow();
  });

  it('unregister 只删命中的那条；不存在的 id 静默忽略', () => {
    const registry = createCommandRegistry();
    registry.register(cmd({ id: 'a', title: 'A' }));
    registry.register(cmd({ id: 'b', title: 'B' }));
    registry.unregister('a');
    registry.unregister('missing');
    expect(registry.list().map((c) => c.id)).toEqual(['b']);
  });

  it('clear 之后为空', () => {
    const registry = createCommandRegistry();
    registry.register(cmd({ id: 'a', title: 'A' }));
    registry.clear();
    expect(registry.list()).toEqual([]);
  });

  it('register 不调用 run（登记是声明，执行归宿主）', () => {
    const run = vi.fn();
    const registry = createCommandRegistry();
    registry.register(cmd({ id: 'a', title: 'A', run }));
    expect(run).not.toHaveBeenCalled();
  });
});

describe('filterCommands', () => {
  const commands: Command[] = [
    cmd({ id: 'view:today', title: '今天', keywords: ['today'] }),
    cmd({ id: 'view:calendar', title: '日历', keywords: ['calendar'] }),
    cmd({ id: 'settings', title: '应用设置', keywords: ['settings', 'preferences'] }),
  ];

  it('空查询 / 纯空白 ⇒ 原样返回全部（打开即见动作，不是空白）', () => {
    expect(filterCommands(commands, '')).toHaveLength(3);
    expect(filterCommands(commands, '   ')).toHaveLength(3);
  });

  it('按标题匹配（大小写无关地命中 keyword）', () => {
    expect(filterCommands(commands, '日历').map((c) => c.id)).toEqual(['view:calendar']);
    expect(filterCommands(commands, 'SETTINGS').map((c) => c.id)).toEqual(['settings']);
  });

  it('多个词是 AND —— 每个词都要命中', () => {
    // 'app' 命中 settings 的 title（应用）？否 —— 用关键字组合验证 AND：
    expect(filterCommands(commands, 'settings pref').map((c) => c.id)).toEqual(['settings']);
    expect(filterCommands(commands, 'settings calendar')).toEqual([]);
  });

  it('不改变原顺序', () => {
    const filtered = filterCommands(commands, 'e'); // 多条命中时顺序仍是入参序
    const ids = filtered.map((c) => c.id);
    const expectedOrder = commands.filter((c) => ids.includes(c.id)).map((c) => c.id);
    expect(ids).toEqual(expectedOrder);
  });
});

describe('moveCommandCursor', () => {
  it('空列表 ⇒ 无光标', () => {
    expect(moveCommandCursor(COMMAND_CURSOR_NONE, 0, 1)).toBe(COMMAND_CURSOR_NONE);
    expect(moveCommandCursor(0, 0, -1)).toBe(COMMAND_CURSOR_NONE);
  });

  it('无光标时 ↓ 到第一项、↑ 到最后一项（不对称，防"方向键反了"）', () => {
    expect(moveCommandCursor(COMMAND_CURSOR_NONE, 3, 1)).toBe(0);
    expect(moveCommandCursor(COMMAND_CURSOR_NONE, 3, -1)).toBe(2);
  });

  it('两端环绕', () => {
    expect(moveCommandCursor(2, 3, 1)).toBe(0);
    expect(moveCommandCursor(0, 3, -1)).toBe(2);
    expect(moveCommandCursor(1, 3, 1)).toBe(2);
    expect(moveCommandCursor(1, 3, -1)).toBe(0);
  });
});
