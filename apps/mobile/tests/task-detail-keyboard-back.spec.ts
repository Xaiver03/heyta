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

    /**
     * 🔴 接线从 `onRequestClose={handleRequestClose}` 变成 `onBack={handleRequestClose}`
     * —— 外壳改成共享原语 `BottomSheet` 之后，**返回键那一格由原语的 `onBack`
     * 承载**（原语内部再把它挂到 `Modal` 的 `onRequestClose`）。
     *
     * 判据要盯的东西没变，而且**更该盯**：三条随手关的通道（背景 / 下拉 / ×）
     * 必须与返回键分开 —— 键盘开着时点 × 若也走"先收键盘"，会读成"点了没反应"。
     * 所以这里钉的是"两个回调各就各位"，不是某一行字符串。
     */
    expect(SOURCE).toContain('onBack={handleRequestClose}');
    expect(SOURCE).toContain('onDismiss={close}');
    // 反向：返回键处理器**不许**被当成随手关那一格（反之亦然）。
    expect(SOURCE).not.toContain('onDismiss={handleRequestClose}');
    expect(SOURCE).not.toContain('onBack={close}');
  });
});
