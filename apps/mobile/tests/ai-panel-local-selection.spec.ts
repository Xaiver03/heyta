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

  // 🔴 法定显式标识（《标识办法》+ GB 45438-2025）。移动端没有渲染器（加
  //    react-test-renderer 要先过可维护性 + 许可证两道门，见
  //    `calendar-view-entry.spec.ts` 文件头），所以这一格是**接线形状**的断言：
  //    宿主必须从 i18n 取词注入、记录组件必须按角色画。界面级证据在设备腿
  //    （`pnpm verify:mobile-ios`），不许把这两条读成"移动端已肉眼验过"。
  it('宿主把显式标识的文字从 i18n 注入，而不是硬编码一句', () => {
    expect(source).toMatch(/generatedLabel=\{t\('common\.ai\.generatedLabel'\)\}/);
  });

  it('记录组件在助手回答与提案两类消息上画显式标识，用户与错误消息上不画', () => {
    const transcript = stripComments(read('apps/mobile/src/ai/chat-transcript.tsx'));
    expect(transcript).toContain("import { AiGeneratedLabel } from '@heyta/ui'");
    expect(transcript).toMatch(
      /item\.role === 'assistant' \|\| item\.role === 'proposal'/,
    );
    expect(transcript).toMatch(/isGenerated[\s\S]{0,120}<AiGeneratedLabel/);
    // 负向对照：标识不能挂在用户消息或错误消息那两类上。
    expect(transcript).not.toMatch(/isUser \|\| isError[\s\S]{0,80}<AiGeneratedLabel/);
  });
});
