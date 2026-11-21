/** 服务端工具执行器：从 op 归约状态 + 只读工具（list_tasks/projects/notes）。 */
import { describe, expect, it } from 'vitest';

import type { ReplayOperationRow } from '../src/sync/op-replay.js';
import { executeAgentTool, materializeUserState } from '../src/ai/agent-tools.execute.js';

function row(o: Partial<ReplayOperationRow> & { id: string; opType: string; entityType: string; entityId: string }): ReplayOperationRow {
  return {
    serverSeq: 0,
    payload: {},
    schemaVersion: 1,
    isPayloadEncrypted: false,
    ...o,
  } as ReplayOperationRow;
}

describe('服务端工具执行器（op 归约 → 只读工具）', () => {
  it('list_tasks 读回未删除任务、排除已删除/已归档', () => {
    const rows: ReplayOperationRow[] = [
      row({ id: 'a', opType: 'CRT', entityType: 'TASK', entityId: 't1', payload: { title: '写周报' } }),
      row({ id: 'b', opType: 'CRT', entityType: 'TASK', entityId: 't2', payload: { title: '开会' } }),
      row({ id: 'c', opType: 'CRT', entityType: 'TASK', entityId: 't3', payload: { title: '已删' } }),
      row({ id: 'd', opType: 'DEL', entityType: 'TASK', entityId: 't3', payload: {} }),
      row({ id: 'e', opType: 'CRT', entityType: 'TASK', entityId: 't4', payload: { title: '已归档' } }),
      row({ id: 'f', opType: 'UPD', entityType: 'TASK', entityId: 't4', payload: { archived: true } }),
    ];
    const state = materializeUserState(rows);
    const out = executeAgentTool(state, 'list_tasks', {});
    expect(out.ok).toBe(true);
    if (out.ok) {
      const titles = (out.data as Array<{ title: string }>).map((t) => t.title).sort();
      expect(titles).toEqual(['写周报', '开会']);
    }
  });

  it('list_projects 排除归档清单', () => {
    const state = materializeUserState([
      row({ id: 'p1', opType: 'CRT', entityType: 'PROJECT', entityId: 'p1', payload: { name: '工作进行中' } }),
      row({ id: 'p2', opType: 'CRT', entityType: 'PROJECT', entityId: 'p2', payload: { name: '归档了' } }),
      row({ id: 'p3', opType: 'UPD', entityType: 'PROJECT', entityId: 'p2', payload: { archived: true } }),
    ]);
    const out = executeAgentTool(state, 'list_projects', {});
    expect(out.ok).toBe(true);
    if (out.ok) expect((out.data as Array<{ name: string }>).map((p) => p.name)).toEqual(['工作进行中']);
  });

  it('未知/写工具 → not-implemented（不假装成功）', () => {
    const state = materializeUserState([]);
    const out = executeAgentTool(state, 'create_task', { title: 'X' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('not-implemented');
  });

  it('加密 op → 归约抛错（E2EE 账号服务端读不到明文）', () => {
    const rows = [
      row({ id: 'x', opType: 'CRT', entityType: 'TASK', entityId: 't1', payload: { cipher: '...' }, isPayloadEncrypted: true }),
    ];
    expect(() => materializeUserState(rows)).toThrow();
  });
});
