import { describe, expect, it } from 'vitest';

import type { AiToolRunOutcome } from '../src/ai-tool-run.js';
import { toolRunToCloudResult } from '../src/ai-local-tools.js';

describe('toolRunToCloudResult（本地工具结果 → 传输结果）', () => {
  it('observation → ok:true 带数据', () => {
    const run = { kind: 'observation', ruleId: 'r', tool: 'list_tasks', data: [{ title: 'A' }] } as unknown as AiToolRunOutcome;
    expect(toolRunToCloudResult(run)).toEqual({ ok: true, data: [{ title: 'A' }] });
  });

  it('proposal（写）→ write-needs-confirm，绝不静默执行', () => {
    const run = {
      kind: 'proposal',
      proposal: { ruleId: 'r', tool: 'create_task', intent: { action: 'create-task', title: 'A' } },
    } as unknown as AiToolRunOutcome;
    const result = toolRunToCloudResult(run);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('write-needs-confirm');
      expect(result.message).toContain('create_task');
    }
  });

  it('denied / failed / ambiguous / none 都不假装成功', () => {
    expect(toolRunToCloudResult({ kind: 'denied', tool: 'x', message: '没授权' } as unknown as AiToolRunOutcome)).toEqual({
      ok: false,
      reason: 'denied',
      message: '没授权',
    });
    expect(toolRunToCloudResult({ kind: 'failed', tool: 'x', reason: 'unknown-tool', message: '没有这个工具' } as unknown as AiToolRunOutcome)).toEqual({
      ok: false,
      reason: 'failed',
      message: '没有这个工具',
    });
    const amb = toolRunToCloudResult({ kind: 'ambiguous', candidates: [] } as unknown as AiToolRunOutcome);
    expect(amb.ok).toBe(false);
    if (!amb.ok) expect(amb.reason).toBe('ambiguous');
    const none = toolRunToCloudResult({ kind: 'none', reason: 'no-match' } as unknown as AiToolRunOutcome);
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.reason).toBe('none');
  });
});
