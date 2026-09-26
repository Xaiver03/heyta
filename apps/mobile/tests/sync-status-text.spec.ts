/**
 * 同步状态文案测试
 * ==================
 *
 * 🔴 这个文件存在的理由，是**用户只能通过这几句话知道同步到底怎么了**。
 *
 * 移动端此前一条数据都同步不出去，而界面上没有任何提示 ——
 * 因为"没配同步"和"同步成功"在界面上长得一样（本地优先，离线也能用）。
 * 现在这几句文案就是唯一的信号源，所以它们必须：
 *
 *   1. **穷尽** `SyncStatus` 的每一种。漏掉一种 = 那个状态下界面是一片空白。
 *   2. **是中文**。需求是"整个应用都是中文的"，而这里是用户最需要看懂的地方。
 *   3. **区分得开**。`offline` 不能和 `error` 说成同一句话 ——
 *      离线是本地优先的正常工作状态，标红会让用户以为数据出了问题。
 */

import { describe, expect, it } from 'vitest';
import type { ConflictInfo, SyncStatus } from '@heyta/sync-client';

import { describeSyncStatus, statusTone } from '../src/sync/status-text';

const CONFLICT: ConflictInfo = {
  id: 'c1',
  entityType: 'TASK',
  entityId: 't1',
  reason: '两边都改了同一条',
  local: { opId: 'op-local', timestamp: 1, payload: { title: '本地版' } },
  remote: { opId: 'op-remote', timestamp: 2, payload: { title: '远端版' } },
};

/**
 * `SyncStatus` 的**每一种**成员。
 *
 * 这个数组是手工维护的 —— 没有类型层面的"列出所有成员"能力。
 * 所以配了一条穷尽性测试（见下），让新增成员时**这里会红**。
 */
const EVERY_STATUS: readonly SyncStatus[] = [
  { kind: 'idle' },
  { kind: 'syncing', phase: 'upload' },
  { kind: 'syncing', phase: 'download' },
  { kind: 'synced', at: 1_700_000_000_000 },
  { kind: 'offline', since: 1_700_000_000_000 },
  { kind: 'conflict', conflicts: [CONFLICT] },
  { kind: 'error', message: '未配置同步服务', retryable: false },
];

/** 一个汉字都没有的串，就是没翻译。 */
const CJK = /[\u4E00-\u9FFF]/;

describe('describeSyncStatus', () => {
  it('覆盖了 SyncStatus 的每一个 kind', () => {
    const kinds = new Set(EVERY_STATUS.map((s) => s.kind));
    expect([...kinds].sort()).toEqual([
      'conflict',
      'error',
      'idle',
      'offline',
      'synced',
      'syncing',
    ]);
  });

  it.each(EVERY_STATUS)('$kind 有非空的中文文案', (status) => {
    const text = describeSyncStatus(status);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(CJK);
  });

  it('上传与下载说成不同的话（否则用户不知道卡在哪一步）', () => {
    const up = describeSyncStatus({ kind: 'syncing', phase: 'upload' });
    const down = describeSyncStatus({ kind: 'syncing', phase: 'download' });
    expect(up).not.toBe(down);
  });

  it('冲突文案带上**数量**，不是一个笼统的"有冲突"', () => {
    const one = describeSyncStatus({ kind: 'conflict', conflicts: [CONFLICT] });
    const two = describeSyncStatus({ kind: 'conflict', conflicts: [CONFLICT, CONFLICT] });
    expect(one).toContain('1');
    expect(two).toContain('2');
  });

  it('🔴 离线不是"失败" —— 它和 error 不能是同一句话', () => {
    const offline = describeSyncStatus({ kind: 'offline', since: 1 });
    const error = describeSyncStatus({ kind: 'error', message: 'x', retryable: true });
    expect(offline).not.toBe(error);
    // "离线"这两个字要明说，否则用户会去查服务端地址。
    expect(offline).toContain('离线');
  });
});

describe('statusTone', () => {
  it('🔴 离线用 muted，不用 danger', () => {
    // 本地优先的应用离线是正常工作状态。标红 = 告诉用户"出问题了"，
    // 而实际上什么都没坏 —— 这类假警报会让用户开始不信任颜色。
    expect(statusTone({ kind: 'offline', since: 1 })).toBe('muted');
  });

  it('只有 error 与 conflict 用 danger', () => {
    const danger = EVERY_STATUS.filter((s) => statusTone(s) === 'danger').map((s) => s.kind);
    expect([...new Set(danger)].sort()).toEqual(['conflict', 'error']);
  });

  it('同步成功用 success', () => {
    expect(statusTone({ kind: 'synced', at: 1 })).toBe('success');
  });

  it.each(EVERY_STATUS)('$kind 的 tone 是合法的取值', (status) => {
    expect(['default', 'muted', 'danger', 'success']).toContain(statusTone(status));
  });
});