import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('移动端半屏面板采用', () => {
  it('AI 会话列表用可拖拽半屏，而不是把两行内容垂直居中', () => {
    const code = source('../src/ai/session-list.tsx');
    expect(code).toContain('<BottomSheet');
    expect(code).toContain("detents={['small', 'medium', 'large']}");
    expect(code).not.toContain('<Modal');
  });

  it('AI 会话改名在原面板内完成，不再叠第二层居中 Modal', () => {
    const code = source('../src/ai/session-list.tsx');
    expect(code).not.toContain('<Modal');
    expect(code).toContain('renamingId !== undefined ?');
    expect(code).toContain("testID=\"ai-session-rename-input\"");
  });

  it('AI 引用任务是多选半屏，并保留常驻完成动作', () => {
    const code = source('../src/ai/task-attachment.tsx');
    expect(code).toContain('<BottomSheet');
    expect(code).toContain('footer={');
    expect(code).not.toContain('<Modal');
  });

  it('日历显示范围保留上下文，在半屏里暂存选择', () => {
    const code = source('../src/screens/CalendarScopeSheet.tsx');
    expect(code).toContain('<BottomSheet');
    expect(code).toContain("detents={['medium', 'large']}");
    expect(code).toContain('footer={');
    expect(code).not.toContain('<Modal');
  });

  it('专注时长预设是轻量半屏；成长统计仍是完整页面', () => {
    const code = source('../src/screens/FocusScreen.tsx');
    expect(code).toContain('<BottomSheet');
    expect(code).toContain('visible={durationOpen}');
    expect(code).toContain('presentationStyle="fullScreen"');
  });
});
