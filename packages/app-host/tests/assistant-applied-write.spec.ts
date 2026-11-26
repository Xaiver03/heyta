/**
 * 「已执行（可撤销）」只能来自**成功的写步骤**
 * =============================================
 *
 * 这条判据是视觉实测抓出来的：假模型的 `list_tasks` 读成功后，回答下面挂着
 * 「Applied (undoable) / Undo this AI action」——读取被说成了写入。
 * 界面在编一件没发生的事，而任何类型检查都不会红。
 */

import { describe, expect, it } from 'vitest';

import { hasAppliedWrite, type AssistantStep } from '../src/ai-assistant.js';

const step = (over: Partial<AssistantStep>): AssistantStep =>
  ({ tool: 'list_tasks', kind: 'read', ok: true, ...over }) as AssistantStep;

describe('hasAppliedWrite', () => {
  it('读成功不算已执行', () => {
    expect(hasAppliedWrite([step({}), step({ tool: 'get_task' })])).toBe(false);
  });

  it('写成功才算', () => {
    expect(hasAppliedWrite([step({}), step({ tool: 'create_task', kind: 'write' })])).toBe(true);
  });

  it('写失败不算', () => {
    expect(hasAppliedWrite([step({ tool: 'create_task', kind: 'write', ok: false })])).toBe(false);
  });

  it('空列表不算', () => {
    expect(hasAppliedWrite([])).toBe(false);
  });
});
