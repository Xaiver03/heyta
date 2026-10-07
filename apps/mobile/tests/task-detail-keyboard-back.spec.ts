import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(new URL('../src/screens/TaskDetailSheet.tsx', import.meta.url), 'utf8');

describe('移动端任务详情的 Android 返回键', () => {
  it('键盘可见时先 dismiss，键盘不可见时才关闭详情面板', () => {
    const start = SOURCE.indexOf('const handleRequestClose = useCallback');
    const end = SOURCE.indexOf('return (', start);
    expect(start, '缺少 Android 返回键处理器').toBeGreaterThanOrEqual(0);
    expect(end, '返回键处理器没有完整落在组件渲染前').toBeGreaterThan(start);

    const handler = SOURCE.slice(start, end);
    expect(handler).toContain('Keyboard.isVisible()');
    expect(handler).toContain('Keyboard.dismiss()');
    expect(handler).toContain('return;');
    expect(handler).toContain('close();');
    expect(SOURCE).toContain('onRequestClose={handleRequestClose}');
    expect(SOURCE).not.toContain('onRequestClose={close}');
  });
});
