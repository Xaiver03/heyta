/**
 * Markdown ↔ HTML 双向转换（C1 ② 编辑器侧）
 *
 * 加载：Markdown → HTML（markdown-it, html:false）→ TipTap 解析
 * 保存：TipTap getHTML() → Markdown（turndown）
 *
 * 裁决（计划 C1 第 3 条）：不用 tiptap-markdown（§3.1 没过），
 * 映射写在本仓。
 */

import MarkdownIt from 'markdown-it';
import TurndownService from 'turndown';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

export function markdownToHtml(source: string): string {
  return md.render(source);
}

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html).trim();
}
