/**
 * 助手回答的 Markdown（Web）
 * ==========================
 *
 * 这一层守两件事：
 *   1. 真的渲染结构（列表 / 代码 / 表格），不是把 Markdown 当纯文本；
 *   2. XSS 防线没被 `dangerouslySetInnerHTML` 打开 —— 裸 HTML 一律转义，
 *      链接新标签打开且带 `noopener`。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

const { MarkdownMessage } = await import('../src/features/ai/MarkdownMessage.js');

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(text: string): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<MarkdownMessage text={text} testId="md" />);
  });
  return container;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('结构', () => {
  it('列表 / 加粗 / 行内代码 / 代码块 / 表格都真的成了元素', () => {
    const el = render(
      [
        '**结论**',
        '',
        '- 先做 A',
        '- 再做 B',
        '',
        '`npm test`',
        '',
        '```ts',
        'const a = 1;',
        '```',
        '',
        '| 列 | 值 |',
        '| --- | --- |',
        '| 一 | 1 |',
      ].join('\n'),
    );
    expect(el.querySelector('strong')?.textContent).toBe('结论');
    expect(el.querySelectorAll('li')).toHaveLength(2);
    expect(el.querySelector('code')?.textContent).toBe('npm test');
    expect(el.querySelector('pre code')?.textContent).toContain('const a = 1;');
    expect(el.querySelectorAll('table th')).toHaveLength(2);
    expect(el.querySelector('table td')?.textContent).toBe('一');
  });

  it('段落不吞字：两段都在（块之间允许一个换行）', () => {
    const el = render('第一段\n\n第二段');
    const text = el.textContent ?? '';
    expect(text).toContain('第一段');
    expect(text).toContain('第二段');
    // 每段只出现一次，且没有把内容重复渲染。
    expect(text.split('第一段')).toHaveLength(2);
  });
});

describe('XSS 与链接', () => {
  it('裸 HTML 被转义：不产生元素、不保留 onerror', () => {
    const el = render('<img src=x onerror="alert(1)">');
    expect(el.querySelector('img')).toBeNull();
    // 「没有元素」是判据；转义后的文本里出现 onerror 字样不算漏洞。
    expect(el.querySelector('[onerror]')).toBeNull();
    expect(el.textContent).toContain('<img');
  });

  it('链接新标签打开，且 rel 带 noopener', () => {
    const el = render('[文档](https://example.com/a)');
    const link = el.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com/a');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toContain('noopener');
  });

  it('javascript: 链接不产生可点的 href', () => {
    const el = render('[x](javascript:alert(1))');
    const link = el.querySelector('a');
    expect(link?.getAttribute('href') ?? '').not.toContain('javascript:');
  });
});
