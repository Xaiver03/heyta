import { describe, expect, it } from 'vitest';

import { emptyState, type MaterializedState } from '@heyta/op-log';
import { deriveShareIdentityKeyPair, signShareOpWire } from '@heyta/sync-core';

import type { ActionContext } from '../src/actions.js';
import { createShareCommentsHost, type ShareLogStorage } from '../src/share-comments.js';
import type { ShareOpDownloadPort, ShareOpUploadPort, ShareOpWireRow } from '../src/share-client.js';
import { emptyShareLogState, type ShareLogState } from '../src/share-op-log.js';
import {
  decideShareOpVerification,
  ShareSignatureRosterUnavailableError,
  type ShareOpVerifyRow,
} from '../src/share-verify.js';

/**
 * M4-4 读侧判据（ADR-0069 裁决五的对偶那半边）。
 *
 * 🔴 这一族钉的是**最后一道**：服务端是唯一持有那批密文的人，它要能在我们眼皮底下把一条
 * 换成另一条，唯一能发现的地方就是拉取之后的这一步。三层判据里"宿主/界面层"那一档
 * （"把盘上那一枚签名字节改掉 ⇒ 另一台读到的是具名失败，而不是静默的错数据"）落在这里。
 */
const SHARE_ID = 'share-1';
const SHARED_TASK = 't-shared';
const T0 = 1_700_000_000_000;
const author = deriveShareIdentityKeyPair(new Uint8Array(32).fill(31));
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

function stateWithRouting(): MaterializedState {
  const state = emptyState();
  const raw = state as unknown as { tasks: Record<string, unknown>; projects: Record<string, unknown> };
  raw.tasks[SHARED_TASK] = { id: SHARED_TASK, projectId: 'p-shared', title: '共享清单里的任务' };
  raw.projects['p-shared'] = { id: 'p-shared', shareId: SHARE_ID, name: '共享清单' };
  return state;
}

const ctx: ActionContext = { dispatch: async () => undefined, getState: stateWithRouting };

/**
 * 一条**签过名**的远端评论（载荷用替身 `ct:`：签名只认字节，不认识信封格式）。
 *
 * `tamperPayload` 的形状是"签的是原文、给回来的载荷多了一个字节" —— 与攻击面同构：
 * 库里那一格被动过，而签名还是原来那枚。
 */
function signedRow(
  n: number,
  over: { readonly signerMemberId?: string; readonly tamperPayload?: boolean } = {},
): ShareOpWireRow {
  const signerMemberId = over.signerMemberId ?? 'member-A';
  const honestPayload = `ct:${JSON.stringify({ taskId: SHARED_TASK, authorUserId: 'u-a', body: `第 ${String(n)} 句` })}`;
  const wire = {
    id: `op-A-${String(n)}`,
    clientId: 'device-A',
    actionType: 'add comment',
    opType: 'CRT',
    entityType: 'COMMENT',
    entityId: `comment-A-${String(n)}`,
    schemaVersion: 1,
    payload: honestPayload,
    vectorClock: { 'device-A': 1 },
    clientTimestamp: T0 + n,
    // 🔴 与生产写侧同形：`isPayloadEncrypted` 在签名域里（ADR-0069 裁决三），
    // 签的那份必须等于将要落库、再被读回来的那一份 —— 漏了这一格，合法签名也会读成失败。
    isPayloadEncrypted: true,
  };
  return {
    ...wire,
    payload: over.tamperPayload === true ? `${honestPayload}x` : honestPayload,
    serverSeq: n,
    signerMemberId,
    signature: signShareOpWire(author.ed25519SecretKey, { shareId: SHARE_ID, signerMemberId, wire }),
  };
}

/** 存量行：M4 之前落库的那些，没有作者列、也没有签名。 */
function legacyRow(n: number): ShareOpWireRow {
  return {
    id: `op-legacy-${String(n)}`,
    clientId: 'device-A',
    actionType: 'add comment',
    opType: 'CRT',
    entityType: 'COMMENT',
    entityId: `comment-legacy-${String(n)}`,
    schemaVersion: 1,
    payload: `ct:${JSON.stringify({ taskId: SHARED_TASK, authorUserId: 'u-a', body: `旧的第 ${String(n)} 句` })}`,
    vectorClock: { 'device-A': 1 },
    serverSeq: n,
    clientTimestamp: T0 + n,
  };
}

function makeServer(rows: readonly ShareOpWireRow[]): ShareOpUploadPort & ShareOpDownloadPort {
  const latest = rows.reduce((m, r) => Math.max(m, r.serverSeq), 0);
  return {
    uploadOps: async () => ({ accepted: [], rejected: [], latestServerSeq: latest }),
    downloadOps: async (_shareId, after) => ({
      ops: rows.filter((r) => r.serverSeq > after),
      cursor: { latestServerSeq: latest },
    }),
  };
}

function makeHost(rows: readonly ShareOpWireRow[], roster: Record<string, string> | undefined) {
  const saved = new Map<string, ShareLogState>();
  const cursors = new Map<string, number>();
  const storage: ShareLogStorage = {
    load: (shareId) => saved.get(shareId) ?? emptyShareLogState(),
    save: (shareId, log) => {
      saved.set(shareId, log);
    },
    list: () => [...saved.keys()],
    cursor: (shareId) => cursors.get(shareId) ?? 0,
    setCursor: (shareId, seq) => {
      cursors.set(shareId, seq);
    },
  };
  const host = createShareCommentsHost({
    ctx,
    api: makeServer(rows),
    cipherFor: async () => ({
      encrypt: async (payload: string) => `ct:${payload}`,
      decrypt: async (payload: string) => payload.replace(/^ct:/, ''),
    }),
    signerFor: async () => ({ memberId: 'member-me', ed25519SecretKey: author.ed25519SecretKey }),
    verifiersFor: async () => roster,
    storage,
    currentUserId: () => 'u-me',
    clientId: 'device-B',
    schemaVersion: 1,
    isSignedIn: () => true,
    now: () => T0 + 90_000,
  });
  return { host, saved, cursors };
}

describe('读侧验签判定（纯函数那一层）', () => {
  const asVerifyRow = (row: ShareOpWireRow): ShareOpVerifyRow => row;

  it('存量行（没有作者列）⇒ 收下，而且**不需要名单**', () => {
    const row = legacyRow(1);
    expect(decideShareOpVerification({ shareId: SHARE_ID, row: asVerifyRow(row), roster: undefined })).toEqual({ accepted: true });
  });

  it('签名对得上 ⇒ 收下', () => {
    const row = signedRow(1);
    const roster = { 'member-A': b64(author.ed25519PublicKey) };
    expect(decideShareOpVerification({ shareId: SHARE_ID, row: asVerifyRow(row), roster })).toEqual({ accepted: true });
  });

  it('载荷被改过一个字节 ⇒ 具名 invalid，并把是哪一条交出来', () => {
    // 🔴 这一枚就是"另一台读到的是具名失败，而不是静默的错数据"那一格的判据本体。
    const honest = signedRow(1);
    const forged: ShareOpVerifyRow = { ...honest, payload: `${String(honest.payload)}x` };
    const verdict = decideShareOpVerification({
      shareId: SHARE_ID,
      row: forged,
      roster: { 'member-A': b64(author.ed25519PublicKey) },
    });
    expect(verdict.accepted).toBe(false);
    if (verdict.accepted) return;
    expect(verdict.rejection).toMatchObject({
      shareId: SHARE_ID,
      opId: 'op-A-1',
      serverSeq: 1,
      outcome: 'invalid',
      signerMemberId: 'member-A',
    });
  });

  it('作者有值但名单里查不到 ⇒ 具名 signer-unregistered（与 invalid 不互相顶包）', () => {
    const verdict = decideShareOpVerification({
      shareId: SHARE_ID,
      row: asVerifyRow(signedRow(1)),
      roster: { 'member-other': b64(author.ed25519PublicKey) },
    });
    expect(verdict.accepted).toBe(false);
    if (verdict.accepted) return;
    expect(verdict.rejection.outcome).toBe('signer-unregistered');
  });

  it('需要验却没有名单 ⇒ 抛具名错误（"没验过"不许被读成"验过了"）', () => {
    expect(() => decideShareOpVerification({ shareId: SHARE_ID, row: asVerifyRow(signedRow(1)), roster: undefined }))
      .toThrow(ShareSignatureRosterUnavailableError);
  });

  it('换一份 share 去验同一条 ⇒ invalid（签名绑住 shareId，跨清单搬一条不成立）', () => {
    const verdict = decideShareOpVerification({
      shareId: 'share-other',
      row: asVerifyRow(signedRow(1)),
      roster: { 'member-A': b64(author.ed25519PublicKey) },
    });
    expect(verdict.accepted).toBe(false);
  });
});

describe('读侧验签接在 pull 的生产路径上', () => {
  const roster = { 'member-A': b64(author.ed25519PublicKey) };

  it('对照臂：签名完好 ⇒ 物化、无报警、游标推到头', async () => {
    const { host, saved, cursors } = makeHost([signedRow(1), signedRow(2)], roster);
    const result = await host.pullShareOps(SHARE_ID);
    expect(result.added).toBe(2);
    expect(result.rejections ?? []).toHaveLength(0);
    expect(host.signatureRejections()).toHaveLength(0);
    expect(cursors.get(SHARE_ID)).toBe(2);
    expect(saved.get(SHARE_ID)?.ops.map((o) => o.id)).toEqual(['op-A-1', 'op-A-2']);
  });

  it('🔴 伪造那条不物化、游标停在它之前、报警有名字，而它前面的照常落地', async () => {
    const good = signedRow(1);
    const forged = signedRow(2, { tamperPayload: true });
    const { host, saved, cursors } = makeHost([good, forged, signedRow(3)], roster);
    const result = await host.pullShareOps(SHARE_ID);

    expect(result.added, '只有伪造之前那一条进来').toBe(1);
    expect(saved.get(SHARE_ID)?.ops.map((o) => o.id)).toEqual(['op-A-1']);
    expect(cursors.get(SHARE_ID), '游标绝不能跨过没验过的行（跨过去=那条永远不会再被看到）').toBe(1);
    expect(result.rejections).toHaveLength(1);
    expect(host.signatureRejections(), '界面读的就是这一格').toMatchObject([
      { opId: 'op-A-2', outcome: 'invalid', serverSeq: 2 },
    ]);
    // 🔴 那条伪造的内容**没有**进视图：症状不能是"别人的话被换了一句而没人知道"。
    expect(host.commentsForTask(SHARED_TASK).map((c) => c.id)).toEqual(['comment-A-1']);
  });

  it('再拉一轮：同一条还会再撞上来、再报一次（报警不落盘也不会自己消失）', async () => {
    const forged = signedRow(1, { tamperPayload: true });
    const { host, cursors } = makeHost([forged], roster);
    await host.pullShareOps(SHARE_ID);
    expect(host.signatureRejections()).toHaveLength(1);
    expect(cursors.get(SHARE_ID), '前面没有可收的行 ⇒ 游标原地不动').toBe(0);

    await host.pullShareOps(SHARE_ID);
    expect(host.signatureRejections()).toHaveLength(1);
  });

  it('名单取不到而日志里有署名行 ⇒ 整轮拉失败，一条都不折进日志', async () => {
    const { host, saved, cursors } = makeHost([signedRow(1)], undefined);
    await expect(host.pullShareOps(SHARE_ID)).rejects.toBeInstanceOf(ShareSignatureRosterUnavailableError);
    expect(saved.get(SHARE_ID), '没验证过的东西不许进日志').toBeUndefined();
    expect(cursors.get(SHARE_ID)).toBeUndefined();
  });

  it('存量行不需要名单，也不报警（"没验过"与"伪造"必须是两档）', async () => {
    const { host, cursors } = makeHost([legacyRow(1), legacyRow(2)], undefined);
    const result = await host.pullShareOps(SHARE_ID);
    expect(result.added).toBe(2);
    expect(host.signatureRejections()).toHaveLength(0);
    expect(cursors.get(SHARE_ID)).toBe(2);
  });
});
