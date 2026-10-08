/**
 * 单一 Chatbot 不拥有任务详情选中态。
 *
 * 这是一个架构边界的负向对照：行为级会话测试在
 * `assistant-local-history.spec.ts` / `chat-session-primitives.spec.ts`，这里只需
 * 防止移动壳重新接回共享 selection 槽，或把旧五表单面板带回来。
 */

import { describe, expect, it } from 'vitest';

import { read, stripComments } from './source-reading';

const source = stripComments(read('apps/mobile/src/ai/AssistantScreen.tsx'));

describe('移动端单一 Chatbot 的入口边界', () => {
  it('Chatbot 没有 import 选中态、没有 useSelected、没有 selection.select', () => {
    expect(source).not.toMatch(/from '\.\.\/lib\/selection'/);
    expect(source).not.toMatch(/\buseSelected\w*\s*\(/);
    expect(source).not.toMatch(/\bselection\.select\w*\s*\(/);
  });

  it('只有一个会话入口，不再把五个旧表单组件当成移动端产品入口', () => {
    expect(source).toContain('ChatComposer');
    expect(source).toContain('ChatTranscript');
    for (const oldPanel of ['CapturePanel', 'BreakdownPanel', 'PrioritizePanel', 'DurationPanel', 'ToolPanel']) {
      expect(source).not.toMatch(new RegExp(`function ${oldPanel}\\s*\\(`));
    }
  });
});
