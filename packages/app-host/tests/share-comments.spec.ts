import { describe, expect, it } from 'vitest';

import { emptyState, type MaterializedState } from '@heyta/op-log';
import { deriveShareIdentityKeyPair } from '@heyta/sync-core';

import type { ActionContext } from '../src/actions.js';
import { ListNotSharedError } from '../src/comment-actions.js';
import {
  createShareCommentsHost,
  ShareKeyUnavailableError,
  ShareNotSignedInError,
  type ShareCommentsHostOptions,
  type ShareLogStorage,
} from '../src/share-comments.js';
import { emptyShareLogState, type ShareLogState } from '../src/share-op-log.js';
import type { ShareOpDownloadPort, ShareOpUploadReceipt } from '../src/share-client.js';

/**
 * W3-T2 判据：三片接起来之后，"用户想对某条任务说一句话"真的**出得去**、
 * 且**只在该出去的条件下出去**。
 *
 * 两个端口都是可注入的（注入的是**真 fetch 的替身与内存存储**，断言的是形状与次数），
 * 这样"零请求"这类判据钉在**边界**上，而不是"函数返回了 undefined"。
 */
const SHARED_TASK = 't-shared';
const PERSONAL_TASK = 't-personal';

/** 固定种子的签名身份：让每条用例签出来的东西可复现。 */
const author = deriveShareIdentityKeyPair(new Uint8Array(32).fill(21));

function stateWithRouting(): MaterializedState {
  const state = emptyState();
  // 测试替身：只放路由需要看的两个桶（tasks / projects）。整棵 state 的形状是真的，
  // 里面只填本判据用到的行 —— 这也是 `comment-actions.ts` 的路由实际会读的两处。
  const raw = state as unknown as {
    tasks: Record<string, unknown>;
    projects: Record<string, unknown>;
  };
  raw.tasks[SHARED_TASK] = { id: SHARED_TASK, projectId: 'p-shared', title: '共享清单里的任务' };
  raw.tasks[PERSONAL_TASK] = { id: PERSONAL_TASK, projectId: 'p-personal', title: '个人清单里的任务' };
  raw.projects['p-shared'] = { id: 'p-shared', shareId: 'share-1', name: '共享清单' };
  raw.projects['p-personal'] = { id: 'p-personal', name: '个人清单' };
  return state;
}

function makeCtx(): ActionContext {
  return {
    dispatch: async () => undefined,
    getState: stateWithRouting,
  };
}

function makeStorage(): { saved: Map<string, ShareLogState>; storage: ShareLogStorage } {
  const saved = new Map<string, ShareLogState>();
  const cursors = new Map<string, number>();
  return {
    saved,
    storage: {
      load: (shareId) => saved.get(shareId) ?? emptyShareLogState(),
      save: (shareId, log) => {
        saved.set(shareId, log);
      },
      list: () => [...saved.keys()],
      cursor: (shareId) => cursors.get(shareId) ?? 0,
      setCursor: (shareId, seq) => {
        cursors.set(shareId, seq);
      },
    },
  };
}

function makeApi(): {
  calls: Array<{ shareId: string; ops: readonly unknown[] }>;
  api: {
    uploadOps: (shareId: string, ops: readonly unknown[]) => Promise<ShareOpUploadReceipt>;
    downloadOps: ShareOpDownloadPort['downloadOps'];
  };
} {
  const calls: Array<{ shareId: string; ops: readonly unknown[] }> = [];
  return {
    calls,
    api: {
      uploadOps: async (shareId, ops) => {
        calls.push({ shareId, ops });
        // 回执按**真实线协议形状**给（`accepted: [{id, serverSeq}]`）：dispatcher 判"写成功"
        // 读的就是这一格，替身给一个别的形状会让判据验的是替身而不是协议。
        // 这一枚替身 = "全收的假服务端"；要测被拒的臂就在用例里覆盖 uploadOps。
        return {
          accepted: ops.map((op, index) => ({ id: (op as { id: string }).id, serverSeq: index + 1 })),
          rejected: [],
          latestServerSeq: ops.length,
        };
      },
      // 本文件只测**上行**那半边；下行有自己的一套判据（`share-comments-pull.spec.ts`）。
      downloadOps: async () => ({ ops: [], cursor: { latestServerSeq: 0 } }),
    },
  };
}

/** 替身编解码器：`ct:` 前缀当密文，解回来就是原来那份 JSON。 */
const codec = (): {
  encrypt: (payload: string) => Promise<string>;
  decrypt: (payload: string) => Promise<string>;
} => ({
  encrypt: async (payload: string) => `ct:${payload}`,
  decrypt: async (payload: string) => payload.replace(/^ct:/, ''),
});

function makeHost(over: Partial<ShareCommentsHostOptions> = {}): {
  host: ReturnType<typeof createShareCommentsHost>;
  calls: Array<{ shareId: string; ops: readonly unknown[] }>;
  saved: Map<string, ShareLogState>;
} {
  const { calls, api } = makeApi();
  const { saved, storage } = makeStorage();
  const host = createShareCommentsHost({
    ctx: makeCtx(),
    api,
    cipherFor: async () => codec(),
    // 真派生一枚 Ed25519（固定种子）：签名走的是生产原语，替身只做"有没有签名件"这一档。
    // 签名本身对不对由 `share-client.spec.ts` 那几条读侧判据钉，这里不重复。
    signerFor: async () => ({ memberId: 'member-1', ed25519SecretKey: author.ed25519SecretKey }),
    storage,
    currentUserId: () => 'u-me',
    clientId: 'device-A',
    schemaVersion: 1,
    isSignedIn: () => true,
    now: () => 1_700_000_000_000,
    newCommentId: () => 'comment-1',
    newOpId: () => 'op-1',
    ...over,
  });
  return { host, calls, saved };
}

describe('share-comments 宿主（W3-T2）', () => {
  it('共享清单里发评论 ⇒ 恰好一次上行，且本地立刻能看到（就地折进 share 日志）', async () => {
    const { host, calls, saved } = makeHost();
    await host.actions.addComment(SHARED_TASK, '第一句');

    expect(calls, '恰好一次上行').toHaveLength(1);
    expect(calls[0]!.shareId, '上行到的是那条共享清单').toBe('share-1');
    const op = calls[0]!.ops[0] as Record<string, unknown>;
    expect(op['entityType']).toBe('COMMENT');
    expect(op['opType']).toBe('CRT');
    expect(op['actionType']).toBe('add comment');
    expect(op['isPayloadEncrypted'], '线上那条是密文').toBe(true);
    expect(String(op['payload'])).toContain('第一句'); // ct:{...} —— 替身加密器的形状

    const rows = host.commentsForTask(SHARED_TASK);
    expect(rows, '本地立刻可见（不必等下一次拉取）').toHaveLength(1);
    expect(rows[0]!.id).toBe('comment-1');
    expect(saved.get('share-1')?.ops.map((o) => o.id), '落盘的是这条 share 的日志').toEqual(['op-1']);
    expect(saved.get('share-1')?.clock, '时钟也落下来了').toEqual({ 'device-A': 1 });
  });

  it('个人清单里发评论 ⇒ ListNotSharedError，零请求、零落盘', async () => {
    const { host, calls, saved } = makeHost();
    await expect(host.actions.addComment(PERSONAL_TASK, '不该出去')).rejects.toBeInstanceOf(ListNotSharedError);
    expect(calls, '零请求').toHaveLength(0);
    expect(saved.size, '零落盘').toBe(0);
    expect(host.commentsForTask(PERSONAL_TASK)).toHaveLength(0);
  });

  it('未登录 ⇒ ShareNotSignedInError，零请求、零落盘', async () => {
    const { host, calls, saved } = makeHost({ isSignedIn: () => false });
    await expect(host.actions.addComment(SHARED_TASK, '未登录')).rejects.toBeInstanceOf(ShareNotSignedInError);
    expect(calls).toHaveLength(0);
    expect(saved.size).toBe(0);
  });

  it('密钥没解锁 ⇒ ShareKeyUnavailableError，零请求、零落盘', async () => {
    const { host, calls, saved } = makeHost({ cipherFor: async () => undefined });
    await expect(host.actions.addComment(SHARED_TASK, '钥匙没到')).rejects.toBeInstanceOf(ShareKeyUnavailableError);
    expect(calls).toHaveLength(0);
    expect(saved.size).toBe(0);
  });

  it('冷启动：只用落盘那份日志重建宿主，评论照样在（重放整条，不是增量）', async () => {
    const first = makeHost();
    await first.host.actions.addComment(SHARED_TASK, '第一句');
    const persisted = first.saved.get('share-1');
    expect(persisted).toBeDefined();

    // 新宿主 = 同一个存储（模拟重启），不重新发任何请求：
    const { calls, api } = makeApi();
    const second = createShareCommentsHost({
      ctx: makeCtx(),
      api,
      cipherFor: async () => codec(),
      // 与 `makeHost` 同一枚签名件：冷启动这一趟只是"重放已经落盘的那条"，一个请求都不发，
      // 但宿主构造要求签名件在场（缺了它，写侧会在真正要发的时候才具名失败）。
      signerFor: async () => ({ memberId: 'member-1', ed25519SecretKey: author.ed25519SecretKey }),
      storage: { load: () => persisted, save: () => undefined, list: () => ['share-1'], cursor: () => 0, setCursor: () => undefined },
      currentUserId: () => 'u-me',
      clientId: 'device-A',
      schemaVersion: 1,
      isSignedIn: () => true,
    });
    expect(second.commentsForTask(SHARED_TASK).map((c) => c.id)).toEqual(['comment-1']);
    expect(calls, '冷启动读日志不该产生任何请求').toHaveLength(0);
  });
});
