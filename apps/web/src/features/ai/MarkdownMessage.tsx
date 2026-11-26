/**
 * 助手回答的 Markdown 渲染（Web）
 * =================================
 *
 * 与移动端 `apps/mobile/src/ai/MarkdownMessage.tsx` 同一个底座（`markdown-it`，
 * MIT），但输出目标不同：那边渲染成 RN 组件，这边是 DOM。
 * **不共用实现**是因为两端的"原语"根本不同（`View/Text` vs `div/span`），
 * 共用只会多一层适配；共用的是**同一份 XSS 防线**（`html: false`）。
 *
 * ## 为什么用 `dangerouslySetInnerHTML`
 *
 * `markdown-it` 在 `html: false` 下会把裸 HTML 全部转义，链接只认它自己的
 * `validateLink`（`javascript:` 被拒）。这是仓库里备注渲染已经用了几年的同一条
 * 防线（`features/tasks/markdown-render.ts`），不是新开的口子。
 *
 * ## 为什么 `useDeferredValue`
 *
 * 流式时每来一个片段就整段重解析，长回答会卡住输入。延后一帧再解析，
 * 用户看到的仍是"文字在长"，但主线程不再被每个字符打断。
 */

import { useDeferredValue, useMemo } from 'react';

import { renderChatMarkdown } from '../tasks/markdown-render.js';

export interface MarkdownMessageProps {
  readonly text: string;
  readonly testId?: string;
  readonly className?: string;
}

export function MarkdownMessage({ text, testId, className }: MarkdownMessageProps): React.JSX.Element {
  const deferred = useDeferredValue(text);
  const html = useMemo(() => renderChatMarkdown(deferred), [deferred]);
  return (
    <div
      className={className === undefined ? 'ht-ai__markdown' : `ht-ai__markdown ${className}`}
      data-testid={testId}
      // 见文件头：html:false + markdown-it 的 validateLink 是既有防线。
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
