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

/**
 * 两个实例只差一条渲染规则：聊天气泡里的链接必须**新标签打开**。
 *
 * 备注里点链接跳走会丢掉当前编辑状态，所以备注保持默认（同窗）；
 * 助手的回答是阅读面，跳走会把对话滚走，所以必须新标签。
 * 用同一个工厂、只传一个布尔，避免两份 `MarkdownIt` 配置各漂各的。
 */
function createMarkdown(options: { linksInNewTab: boolean }): InstanceType<typeof MarkdownIt> {
  const instance = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    breaks: true,
  });
  if (options.linksInNewTab) {
    const defaultLinkOpen = instance.renderer.rules.link_open;
    instance.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
      tokens[idx]?.attrSet('target', '_blank');
      tokens[idx]?.attrSet('rel', 'noopener noreferrer');
      return defaultLinkOpen !== undefined
        ? defaultLinkOpen(tokens, idx, opts, env, self)
        : self.renderToken(tokens, idx, opts);
    };
  }
  return instance;
}

const noteMd = createMarkdown({ linksInNewTab: false });
const chatMd = createMarkdown({ linksInNewTab: true });

export function renderNoteMarkdown(source: string): string {
  return noteMd.render(source);
}

/**
 * 助手回答的 Markdown（含新标签链接）。
 *
 * 🔴 与备注共用同一道 XSS 防线：`html: false`，裸 HTML 一律转义。
 */
export function renderChatMarkdown(source: string): string {
  // markdown-it 的渲染结果末尾总带一个换行；放进 `textContent` 会让
  // 断言与复制出来的文本多一个空行。截掉它，不是改语义。
  return chatMd.render(source).trimEnd();
}
