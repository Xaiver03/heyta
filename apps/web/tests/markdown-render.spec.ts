import { describe, it, expect } from 'vitest';
import { renderNoteMarkdown } from '../src/features/tasks/markdown-render.js';

describe('C1 ① Markdown 渲染（html: false 防线）', () => {
  it('注入 <img onerror=…> 不产生真实 HTML 元素', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const html = renderNoteMarkdown(evil);
    expect(html).not.toMatch(/<img\b/);
    expect(html).toContain('&lt;img');
  });

  it('注入 <script> 不产生真实 HTML 元素', () => {
    const evil = '<script>document.cookie</script>';
    const html = renderNoteMarkdown(evil);
    expect(html).not.toMatch(/<script\b/);
  });

  it('注入 <a href="javascript:…"> 不产生真实链接元素', () => {
    const evil = '<a href="javascript:alert(1)">click</a>';
    const html = renderNoteMarkdown(evil);
    expect(html).not.toMatch(/<a\b/);
    expect(html).toContain('&lt;a');
  });

  it('合法 Markdown 正常渲染', () => {
    const md = '# 标题\n\n**粗体** 和 *斜体*\n\n- 列表项\n- [ ] 复选框';
    const html = renderNoteMarkdown(md);
    expect(html).toContain('<h1>');
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
    expect(html).toContain('<li>');
  });

  it('换行渲染为 <br>（breaks: true）', () => {
    const html = renderNoteMarkdown('第一行\n第二行');
    expect(html).toContain('<br');
  });
});
