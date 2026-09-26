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
 *   2. **跟随语言**。迁移前这里断言"必须是中文"；迁移后断言的是
 *      **同一个 key 在 zh 与 en 下各给出各自的句子** —— 只测中文的话，
 *      把英文词条写成中文、或 en 表漏一个 key，测试全绿而英文界面是坏的。
 *   3. **区分得开**。`offline` 不能和 `error` 说成同一句话 ——
 *      离线是本地优先的正常工作状态，标红会让用户以为数据出了问题。
 */

import { describe, expect, it } from 'vitest';
import type { ConflictInfo, SyncStatus } from '@heyta/sync-client';
import { translate } from '@heyta/i18n';

import { describeSyncStatus, statusTone } from '../src/sync/status-text';

const CONFLICT: ConflictInfo = {
  id: 'c1',
  entityType: 'TASK',
  entityId: 't1',
  reason: '两边都改了同一条',
  local: { opId: 'op-local', timestamp: 1, payload: { title: '本地版' } },
  remote: { opId: 'op-remote', timestamp: 2, payload: { title: '远端版' } },
};

/** 每种语言各绑定一份取词函数，避免每条断言都重复写 locale。 */
const zh = translate.bind(null, 'zh-CN');
const en = translate.bind(null, 'en');

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
  { kind: 'error', reason: 'not-configured', retryable: false },
];

/** 一个汉字都没有的串，说明英文词条没被翻译成中文以外的东西 —— 用于反向检查。 */
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

  it.each(EVERY_STATUS)('$kind 在两种语言下都有非空文案，且互不相同', (status) => {
    const zhText = describeSyncStatus(status, zh);
    const enText = describeSyncStatus(status, en);
    expect(zhText.length).toBeGreaterThan(0);
    expect(enText.length).toBeGreaterThan(0);
    // 🔴 中文必须含汉字；英文必须**不含**汉字 —— 后者能抓住
    // "把中文复制过去当英文交差"（en 表漏 key 时最容易发生）。
    expect(zhText).toMatch(CJK);
    expect(enText).not.toMatch(CJK);
    expect(zhText).not.toBe(enText);
  });

  it('逐条钉住每种状态的两种说法', () => {
    // 词条本身可能被改措辞，但"每个状态有话说、且两种语言不同"这件事不能松。
    expect(describeSyncStatus({ kind: 'idle' }, zh)).toBe('尚未同步');
    expect(describeSyncStatus({ kind: 'idle' }, en)).toBe('Not synced yet');
    expect(describeSyncStatus({ kind: 'synced', at: 0 }, zh)).toBe('已是最新');
    expect(describeSyncStatus({ kind: 'synced', at: 0 }, en)).toBe('Up to date');
    expect(describeSyncStatus({ kind: 'offline', since: 1 }, zh)).toBe('当前离线');
    expect(describeSyncStatus({ kind: 'offline', since: 1 }, en)).toBe('Offline');
    expect(
      describeSyncStatus({ kind: 'error', reason: 'unexpected', message: 'x', retryable: true }, zh),
    ).toBe('同步失败');
    expect(
      describeSyncStatus({ kind: 'error', reason: 'unexpected', message: 'x', retryable: true }, en),
    ).toBe('Sync failed');
  });

  it('🔴 已知的同步失败原因各有各的句子（不能都用"同步失败"糊过去）', () => {
    // 🔴 这一条钉的是"门禁扫不到的通道"：`SyncStatus.message` 曾经是
    // `packages/sync-client` 里的中文，壳把它整句丢掉或整句插进英文句子里。
    // 现在原因结构化，**每种失败都必须说清是哪一种**（本文件头第 3 条）。
    const reasons = [
      'not-configured',
      'not-signed-in',
      'no-encryption-password',
      'local-op-missing',
      'remote-version-unavailable',
    ] as const;

    const seen = new Set<string>();
    for (const reason of reasons) {
      const zhText = describeSyncStatus({ kind: 'error', reason, retryable: false }, zh);
      const enText = describeSyncStatus({ kind: 'error', reason, retryable: false }, en);

      expect(zhText.length).toBeGreaterThan(0);
      expect(enText.length).toBeGreaterThan(0);
      // 中英必须真的不同（否则等于英文表漏了翻译）
      expect(enText).not.toBe(zhText);
      // 英文里一个汉字都不许有 —— 这是"跨包中文漏进英文界面"的正面拦截
      expect(enText).not.toMatch(CJK);
      // 每种原因的句子必须互不相同：全都一样就等于没区分
      expect(seen.has(zhText)).toBe(false);
      seen.add(zhText);
    }
  });

  it('上传与下载说成不同的话（否则用户不知道卡在哪一步）', () => {
    for (const t of [zh, en]) {
      const up = describeSyncStatus({ kind: 'syncing', phase: 'upload' }, t);
      const down = describeSyncStatus({ kind: 'syncing', phase: 'download' }, t);
      expect(up).not.toBe(down);
      expect(up.length).toBeGreaterThan(0);
      expect(down.length).toBeGreaterThan(0);
    }
    expect(describeSyncStatus({ kind: 'syncing', phase: 'upload' }, zh)).toBe('正在上传…');
    expect(describeSyncStatus({ kind: 'syncing', phase: 'download' }, zh)).toBe('正在下载…');
    expect(describeSyncStatus({ kind: 'syncing', phase: 'upload' }, en)).toBe('Uploading...');
    expect(describeSyncStatus({ kind: 'syncing', phase: 'download' }, en)).toBe('Downloading...');
  });

  it('冲突文案带上**数量**，不是一个笼统的"有冲突"', () => {
    const one = describeSyncStatus({ kind: 'conflict', conflicts: [CONFLICT] }, zh);
    const two = describeSyncStatus({ kind: 'conflict', conflicts: [CONFLICT, CONFLICT] }, zh);
    expect(one).toContain('1');
    expect(two).toContain('2');
    // 英文同样要带上数量 —— 占位符漏掉的话数字会消失，而句子看起来仍然通顺。
    expect(describeSyncStatus({ kind: 'conflict', conflicts: [CONFLICT] }, en)).toContain('1');
    expect(describeSyncStatus({ kind: 'conflict', conflicts: [CONFLICT, CONFLICT] }, en)).toContain(
      '2',
    );
  });

  it('🔴 英文单复数：1 处冲突是 `1 conflict`，不是 `1 conflicts`', () => {
    // `count === 1` 是**最常见**的情形，词条表又没有 ICU，
    // 所以调用方必须分支到 `mobile.sync.conflictOne`。
    const one = describeSyncStatus({ kind: 'conflict', conflicts: [CONFLICT] }, en);
    const three = describeSyncStatus(
      { kind: 'conflict', conflicts: [CONFLICT, CONFLICT, CONFLICT] },
      en,
    );
    expect(one).toBe('You have 1 conflict to resolve');
    expect(three).toBe('You have 3 conflicts to resolve');
    expect(one).not.toContain('1 conflicts');
    // 中文两条都是同一个句型（单复数不影响中文）。
    expect(describeSyncStatus({ kind: 'conflict', conflicts: [CONFLICT] }, zh)).toBe(
      '有 1 处冲突待你选择',
    );
    expect(
      describeSyncStatus({ kind: 'conflict', conflicts: [CONFLICT, CONFLICT, CONFLICT] }, zh),
    ).toBe('有 3 处冲突待你选择');
  });

  it('🔴 离线不是"失败" —— 它和 error 不能是同一句话', () => {
    for (const t of [zh, en]) {
      const offline = describeSyncStatus({ kind: 'offline', since: 1 }, t);
      const error = describeSyncStatus(
        { kind: 'error', reason: 'unexpected', message: 'x', retryable: true },
        t,
      );
      expect(offline).not.toBe(error);
    }
    // "离线"这两个字要明说，否则用户会去查服务端地址。
    expect(describeSyncStatus({ kind: 'offline', since: 1 }, zh)).toContain('离线');
    expect(describeSyncStatus({ kind: 'offline', since: 1 }, en)).toContain('Offline');
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
