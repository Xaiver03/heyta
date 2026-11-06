/**
 * 备注的 Markdown 渲染（C1 ① 渲染侧先行）
 * =========================================
 *
 * 裁决（计划 C1 那节第 2 条）：备注源格式定成 Markdown，不定 HTML。
 * `Task.notes` 是 `string`，一个字段不用动。
 *
 * 🔴 XSS 防线：`markdown-it` 必须 `html: false`。
 * 判据在 `apps/web/tests/markdown-render.spec.tsx`（注入 `<img onerror=…>` 断言不产生元素）。
 */

import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: true,
});

export function renderNoteMarkdown(source: string): string {
  return md.render(source);
}
