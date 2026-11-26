/**
 * 打印快捷键的判据（覆盖图谱 #70）
 * =================================
 *
 * 🔴 为什么值得单独钉：本仓的打印走**浏览器原生** `window.print()`，没有自研 PDF
 * 引擎可测。真正需要判的就是"**什么时候调它**"这一件事 —— 而它坏掉的样子很安静：
 * 多截一个键（比如把 ⌥⌘P 也当打印）会让某台机器上另一个功能失灵，少截一个键
 * 又会退化成"某些壳里按 ⌘P 没反应"。所以把判断抽成纯函数，逐条打。
 */

import { describe, expect, it } from 'vitest';

import { isPrintShortcut } from '../src/lib/print-shortcut.js';

function ev(partial: Partial<Parameters<typeof isPrintShortcut>[0]>) {
  return { key: 'p', metaKey: false, ctrlKey: false, altKey: false, ...partial };
}

describe('isPrintShortcut', () => {
  it('⌘P 与 Ctrl+P 都算打印（macOS 与 Windows/Linux 各一条主键）', () => {
    expect(isPrintShortcut(ev({ metaKey: true }))).toBe(true);
    expect(isPrintShortcut(ev({ ctrlKey: true }))).toBe(true);
  });

  it('大小写都认（CapsLock / Shift 时 key 会是大写 P）', () => {
    expect(isPrintShortcut(ev({ metaKey: true, key: 'P' }))).toBe(true);
  });

  it('🔴 不带 ⌘/Ctrl 的裸 P 不是打印（否则打字里的 p 会被当成快捷键）', () => {
    expect(isPrintShortcut(ev({}))).toBe(false);
  });

  it('🔴 带 Alt 的组合不抢（⌥⌘P 是别的应用的键，抢它没有理由）', () => {
    expect(isPrintShortcut(ev({ metaKey: true, altKey: true }))).toBe(false);
  });

  it('别的字母不是打印', () => {
    expect(isPrintShortcut(ev({ metaKey: true, key: 'o' }))).toBe(false);
    expect(isPrintShortcut(ev({ metaKey: true, key: 's' }))).toBe(false);
  });
});
