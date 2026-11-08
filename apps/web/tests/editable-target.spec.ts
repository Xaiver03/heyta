/**
 * 「按键目标该不该让路」的钉子（`isEditableTarget`）
 * ==================================================
 *
 * 这一枚管的是全局快捷键的**第一道门**：抢了输入框里的 ⌘Z，用户刚打的字会被整段撤掉，
 * 而浏览器原生撤销栈也一起乱掉 —— 症状像"输入法坏了"，不像"我们的键盘处理写错了"。
 *
 * 三条判据，每条都写了"读反了会长成什么样"：
 *
 * 1. **文本输入类必须让路**（`input`/`textarea`/`select`、contenteditable）。
 *    读反了：⌘Z 在搜索框里撤销任务，而不是撤销刚打的字。
 * 2. **非文本 input 不让路**（checkbox/radio/range…）。
 *    读反了：焦点停在任务的勾选框上（很常见，Tab 走过去就停那儿）时 ⌘Z 完全失效 ——
 *    用户会以为撤销坏了。这正是"按标签名一律让路"那一版的红法。
 * 3. **`contenteditable="false"` 不让路** —— 它是**字符串**，`'false'` 是真值。
 *    读反了（写成 `if (el.contentEditable)`）：所有元素都被判成可编辑 ⇒
 *    **全局快捷键全体静默失效**，而且没有任何报错。
 */

import { describe, expect, it } from 'vitest';

import { isEditableTarget } from '../src/lib/editable-target.js';

function el(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.firstElementChild!;
}

describe('isEditableTarget', () => {
  it('文本输入类让路（输入框 / 多行 / 下拉）', () => {
    expect(isEditableTarget(el('<input type="text">'))).toBe(true);
    expect(isEditableTarget(el('<input>'))).toBe(true);
    expect(isEditableTarget(el('<input type="search">'))).toBe(true);
    expect(isEditableTarget(el('<textarea></textarea>'))).toBe(true);
    expect(isEditableTarget(el('<select></select>'))).toBe(true);
  });

  it('🔴 非文本 input 不让路（勾选框上按 ⌘Z 该撤销任务，不是撤销勾选）', () => {
    expect(isEditableTarget(el('<input type="checkbox">'))).toBe(false);
    expect(isEditableTarget(el('<input type="radio">'))).toBe(false);
    expect(isEditableTarget(el('<input type="range">'))).toBe(false);
    expect(isEditableTarget(el('<input type="button">'))).toBe(false);
  });

  it('🔴 contenteditable="false" 不让路（它是字符串，`"false"` 是真值）', () => {
    expect(isEditableTarget(el('<div contenteditable="false"></div>'))).toBe(false);
    expect(isEditableTarget(el('<div></div>'))).toBe(false);
  });

  it('contenteditable 的各种"是"写法都让路', () => {
    expect(isEditableTarget(el('<div contenteditable="true"></div>'))).toBe(true);
    expect(isEditableTarget(el('<div contenteditable=""></div>'))).toBe(true);
    expect(isEditableTarget(el('<div contenteditable="plaintext-only"></div>'))).toBe(true);
  });

  it('普通的按钮/容器不让路（焦点停在那里时 ⌘Z 仍由我们处理）', () => {
    expect(isEditableTarget(el('<button type="button">x</button>'))).toBe(false);
    expect(isEditableTarget(el('<div><span>x</span></div>') as Element)).toBe(false);
  });

  it('null / 非 Element（Document、window）不炸、也不让路', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(document)).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
  });
});
