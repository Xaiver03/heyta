/**
 * `control/shortcut-model.ts` 的契约 —— 覆盖图谱 #7 的按键判断
 *
 * 这里钉的是「按了到底触发哪条」的那条链：事件 → 规范串 → 登记表查 id。
 * 它坏了在界面上只有一种表现 —— "按了没反应"或"按一下触发两下"，
 * 两者都不会报错，所以只能靠这些格子。
 */

import { describe, expect, it } from 'vitest';

import {
  comboMatches,
  findShortcutConflicts,
  formatKeyCombo,
  keyComboFromEvent,
  matchShortcut,
  parseKeyCombo,
  type KeyEventLike,
  type ShortcutBinding,
} from '../src/control/shortcut-model.js';

function ev(partial: Partial<KeyEventLike> & Pick<KeyEventLike, 'key'>): KeyEventLike {
  return partial;
}

describe('parseKeyCombo', () => {
  it('接受规范串与常见别名，顺序无关', () => {
    expect(parseKeyCombo('Meta+Shift+P')).toEqual({ ctrl: false, alt: false, shift: true, meta: true, key: 'P' });
    expect(parseKeyCombo('shift+cmd+p')).toEqual({ ctrl: false, alt: false, shift: true, meta: true, key: 'P' });
    expect(parseKeyCombo('Ctrl+Alt+Delete')).toEqual({ ctrl: true, alt: true, shift: false, meta: false, key: 'Delete' });
  });

  it('单字符键名归一为大写', () => {
    expect(parseKeyCombo('Meta+k')?.key).toBe('K');
    expect(parseKeyCombo('Space')?.key).toBe('Space');
  });

  it('空串 / 未知修饰键 ⇒ null（不静默降级成某个默认键）', () => {
    expect(parseKeyCombo('')).toBeNull();
    expect(parseKeyCombo('Hyper+P')).toBeNull();
  });
});

describe('keyComboFromEvent', () => {
  it('只按修饰键 ⇒ null（不成命令）', () => {
    expect(keyComboFromEvent(ev({ key: 'Shift', shiftKey: true }))).toBeNull();
    expect(keyComboFromEvent(ev({ key: 'Meta', metaKey: true }))).toBeNull();
  });

  it('macOS：主修饰键是 ⌘（metaKey），⌃ 记为次修饰键 Ctrl', () => {
    expect(keyComboFromEvent(ev({ key: 'p', metaKey: true, shiftKey: true }), 'darwin')).toBe('Shift+Meta+P');
    expect(keyComboFromEvent(ev({ key: 'k', metaKey: true }), 'darwin')).toBe('Meta+K');
    expect(keyComboFromEvent(ev({ key: 'k', ctrlKey: true }), 'darwin')).toBe('Ctrl+K');
  });

  it('其他平台：主修饰键是 Ctrl（ctrlKey），归一到 Meta 以便同一条登记跨平台成立', () => {
    expect(keyComboFromEvent(ev({ key: 'p', ctrlKey: true, shiftKey: true }), 'other')).toBe('Shift+Meta+P');
    expect(keyComboFromEvent(ev({ key: ',', ctrlKey: true }), 'other')).toBe('Meta+,');
  });

  it('🔴 不再用 shiftKey 改字母大小写（event.key 已是大写 P，double 会错）', () => {
    expect(keyComboFromEvent(ev({ key: 'P', shiftKey: true, metaKey: true }), 'darwin')).toBe('Shift+Meta+P');
  });
});

describe('comboMatches', () => {
  it('大小写 / 别名 / 顺序都容忍', () => {
    expect(comboMatches('Meta+Shift+P', 'shift+command+p')).toBe(true);
    expect(comboMatches('Meta+K', 'Meta+P')).toBe(false);
    expect(comboMatches('Meta+K', 'Nonsense+')).toBe(false);
  });
});

describe('formatKeyCombo', () => {
  it('macOS：无分隔符，顺序 ⌃⌥⇧⌘', () => {
    expect(formatKeyCombo('Meta+Shift+P', 'darwin')).toBe('⇧⌘P');
    expect(formatKeyCombo('Ctrl+Alt+Shift+Meta+Space', 'darwin')).toBe('⌃⌥⇧⌘空格');
  });

  it('其他平台：+ 号连接，主修饰键 Meta 显示为 Ctrl', () => {
    expect(formatKeyCombo('Meta+Shift+P', 'other')).toBe('Ctrl+Shift+P');
    expect(formatKeyCombo('Ctrl+K', 'other')).toBe('Ctrl+K');
  });

  it('解析不了就原样返回（这串的读者是人）', () => {
    expect(formatKeyCombo('Hyper+P', 'darwin')).toBe('Hyper+P');
  });
});

describe('matchShortcut', () => {
  const bindings: ShortcutBinding[] = [
    { id: 'palette', combo: 'Meta+Shift+P' },
    { id: 'settings', combo: 'Meta+,' },
  ];

  it('命中返回 id；未命中/空事件返回 undefined', () => {
    expect(matchShortcut(bindings, 'Shift+Meta+P')).toBe('palette');
    expect(matchShortcut(bindings, 'Meta+K')).toBeUndefined();
    expect(matchShortcut(bindings, null)).toBeUndefined();
  });
});

describe('findShortcutConflicts', () => {
  it('同一作用域内两条命令抢同一个键 ⇒ 报出来', () => {
    const conflicts = findShortcutConflicts([
      { id: 'a', combo: 'Meta+K' },
      { id: 'b', combo: 'Meta+K' },
      { id: 'c', combo: 'Meta+P' },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.ids).toEqual(['a', 'b']);
  });

  it('无冲突 ⇒ 空数组；同一 id 重复不算冲突', () => {
    expect(findShortcutConflicts([{ id: 'a', combo: 'Meta+K' }])).toEqual([]);
    expect(
      findShortcutConflicts([
        { id: 'a', combo: 'Meta+K' },
        { id: 'a', combo: 'Meta+K' },
      ]),
    ).toEqual([]);
  });
});
