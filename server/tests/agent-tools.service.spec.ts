/** 服务端工具接线：executeAgentToolForUser（op 归约）+ buildAgentToolsOptions 的 catalog/grants。 */
import { describe, expect, it } from 'vitest';

import { buildAgentToolsOptions, executeAgentToolForUser, type OpsReader } from '../src/ai/agent-tools.service.js';

function fakeDb(rows: unknown[], onQuery?: () => void): OpsReader {
  return {
    operation: {
      findMany: async () => {
        onQuery?.();
        return rows;
      },
    },
  };
}

describe('executeAgentToolForUser', () => {
  it('读 op → 归约 → list_tasks 返回未删除任务', async () => {
    const rows = [
      { id: 'a', serverSeq: 0, opType: 'CRT', entityType: 'TASK', entityId: 't1', payload: { title: '写周报' }, schemaVersion: 1, isPayloadEncrypted: false },
      { id: 'b', serverSeq: 1, opType: 'DEL', entityType: 'TASK', entityId: 't1', payload: {}, schemaVersion: 1, isPayloadEncrypted: false },
      { id: 'c', serverSeq: 2, opType: 'CRT', entityType: 'TASK', entityId: 't2', payload: { title: '开会' }, schemaVersion: 1, isPayloadEncrypted: false },
    ];
    const out = await executeAgentToolForUser(fakeDb(rows), '42', 'list_tasks', {});
    expect(out.ok).toBe(true);
    if (out.ok) expect((out.data as Array<{ title: string }>).map((t) => t.title)).toEqual(['开会']);
  });

  it('加密账号 → encrypted-account（不静默返回空）', async () => {
    const rows = [{ id: 'x', serverSeq: 0, opType: 'CRT', entityType: 'TASK', entityId: 't1', payload: {}, schemaVersion: 1, isPayloadEncrypted: true }];
    const out = await executeAgentToolForUser(fakeDb(rows), '42', 'list_tasks', {});
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('encrypted-account');
  });

  it('非加密的归约失败（REPAIR 缺 base）→ failed，不谎报加密', async () => {
    const rows = [{ id: 'r', serverSeq: 0, opType: 'REPAIR', entityType: 'TASK', entityId: 't1', payload: {}, schemaVersion: 1, isPayloadEncrypted: false, repairBaseServerSeq: null }];
    const out = await executeAgentToolForUser(fakeDb(rows), '42', 'list_tasks', {});
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('failed');
  });

  it('目录外工具 → not-found', async () => {
    const out = await executeAgentToolForUser(fakeDb([]), '42', 'purge_everything', {});
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('not-found');
  });
});

describe('buildAgentToolsOptions', () => {
  it('catalog 只含只读工具；grants 全部放行只读；execute 走归约', async () => {
    const opts = buildAgentToolsOptions(fakeDb([]));
    expect(opts.catalog.every((t) => t.risk === 'read')).toBe(true);
    const grants = await opts.resolveGrants('42');
    expect(Object.values(grants).every((v) => v === true)).toBe(true);
    const out = await opts.execute!('list_tasks', {}, { userId: '42' });
    expect(out.ok).toBe(true);
  });
});
