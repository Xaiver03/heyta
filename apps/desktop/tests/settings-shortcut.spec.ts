import { expect, it } from 'vitest';
import { isSettingsShortcut } from '../src/settings-shortcut.js';

const keyDown = { type: 'keyDown', key: ',' } as const;

it('macOS：⌘, 打开设置', () => {
  expect(isSettingsShortcut({ ...keyDown, meta: true }, 'darwin')).toBe(true);
});

it('macOS：只按 ⌘ 以外的修饰键不算（Ctrl+, 在 mac 上不是我们的命令）', () => {
  expect(isSettingsShortcut({ ...keyDown, control: true }, 'darwin')).toBe(false);
});

it('Windows/Linux：Ctrl+, 打开设置', () => {
  expect(isSettingsShortcut({ ...keyDown, control: true }, 'win32')).toBe(true);
  expect(isSettingsShortcut({ ...keyDown, control: true }, 'linux')).toBe(true);
});

it('不带修饰键的逗号是输入，不是命令', () => {
  expect(isSettingsShortcut(keyDown, 'darwin')).toBe(false);
  expect(isSettingsShortcut(keyDown, 'win32')).toBe(false);
});

it('keyUp 同样带着 `,`，不筛会触发两次', () => {
  expect(isSettingsShortcut({ type: 'keyUp', key: ',', meta: true }, 'darwin')).toBe(false);
});

it('别的键 + 修饰键不算', () => {
  expect(isSettingsShortcut({ ...keyDown, key: '.', meta: true }, 'darwin')).toBe(false);
});
