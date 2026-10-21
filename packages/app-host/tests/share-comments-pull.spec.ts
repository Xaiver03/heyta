/**
 * M1 下行链路：`pullShareOps` 的判据
 * =================================
 *
 * 这条线今天整段断的就是这一格 —— `downloadOps` 有实现、有服务端路由，但**零消费者**，
 * 所以两个人互相看不到对方的评论。下面这些用例钉的不是"函数会跑"，
 * 而是那条链**坏过的四种方式**：
 *
 * | 判据 | 坏法 |
 * |---|---|
 * | 拉到之后本地读得到 | 拉了但没折进日志 ⇒ 界面永远"暂无评论" |
 * | 未登录 / 钥匙没解锁 ⇒ **零请求** | 悄悄发未授权请求，或写一条本地解不开的密文 |
 * | 游标推进只在日志落盘**之后** | 先推游标 ⇒ 中途失败那批 op 永远不会再被拉 = **静默丢数据** |
 * | 解密用线上那份 `clientTimestamp` | 用 `now()` ⇒ AAD 差一个字节 ⇒ GCM 必拒（`verify-collab-sync.mjs:228-232` 第一次就红在这） |
 *
 * 变异验证（计划 §9.7 的 M1-c 会落成装置）：把 `setCursor` 那一行去掉 ⇒
 * 「冷启动不重拉」与「第二次 pull 从上次的位置继续」两条必须转红。
 */
import { describe, expect, it } from 'vitest';

import { emptyState, type MaterializedState } from '@heyta/op-log';

import type { ActionContext } from '../src/actions.js';
import {
  createShareCommentsHost,
  ShareKeyUnavailableError,
  ShareNotSignedInError,
  type ShareCommentsHostOptions,
  type ShareLogStorage,
} from '../src/share-comments.js';
import type { ShareOpDownloadPort, ShareOpUploadPort, ShareOpWireRow } from '../src/share-client.js';
import { emptyShareLogState, type ShareLogState } from '../src/share-op-log.js';

const SHARED_TASK = 't-shared';
const T0 = 1_700_000_000_000;

function stateWithRouting(): MaterializedState {
  const state = emptyState();
  const raw = state as unknown as {
    tasks: Record<string, unknown>;
    projects: Record<string, unknown>;
  };
  raw.tasks[SHARED_TASK] = { id: SHARED_TASK, projectId: 'p-shared', title: '共享清单里的任务' };
  raw.projects['p-shared'] = { id: 'p-shared', shareId: 'share-1', name: '共享清单' };
  return state;
}

const ctx: ActionContext = {
  dispatch: async () => undefined,
  getState: stateWithRouting,
};

/** 服务端上的一条远端评论（device-A 写的；`ct:` 前缀就是"密文"）。 */
function wireRow(n: number, over: Partial<ShareOpWireRow> = {}): ShareOpWireRow {
  return {
    id: `op-A-${String(n)}`,
    clientId: 'device-A',
    actionType: 'add comment',
    opType: 'CRT',
    entityType: 'COMMENT',
    entityId: `comment-A-${String(n)}`,
    schemaVersion: 1,
    payload: `ct:${JSON.stringify({ taskId: SHARED_TASK, authorUserId: 'u-a', body: `第 ${String(n)} 句` })}`,
    vectorClock: { 'device-A': 1 },
    serverSeq: n,
    clientTimestamp: T0 + n,
    ...over,
  };
}

/**
 * 一个假的 share 服务端：`after` 之后的 op 分页给出，`latestServerSeq` 是全表最大序。
 *
 * ⚠️ `latestServerSeq` 故意**不**跟着 `after` 走 —— 真服务端报的是"这份日志现在到哪了"，
 * 分页收敛那条判据要的就是这个语义。
 */
function makeServer(
  rows: readonly ShareOpWireRow[],
  opts: {
    readonly failAt?: number;
    /** 第一页只给一条（服务端按**时间**而不是 limit 截页的形状）。 */
    readonly shortFirstPage?: boolean;
    /**
     * 「永远不收敛」那一臂：**无视 `after`** 一直给同一批 —— 真服务端只要有一次
     * 游标算错就是这个形状，而它必须被页数上界拦住，而不是把浏览器钉在死循环里。
     */
    readonly alwaysFullPage?: boolean;
    /** 强制服务端报的头（配合 `alwaysFullPage` 用：头永远比消费位置高）。 */
    readonly head?: number;
  } = {},
): {
  calls: Array<{ after: number; limit: number | undefined }>;
  api: ShareOpUploadPort & ShareOpDownloadPort;
} {
  const calls: Array<{ after: number; limit: number | undefined }> = [];
  const latest = opts.head ?? rows.reduce((m, r) => Math.max(m, r.serverSeq), 0);
  return {
    calls,
    api: {
      // 本文件只测下行；上行端口存在即可（宿主装配要它，用不到）。
      uploadOps: async () => ({ accepted: [], rejected: [], latestServerSeq: latest }),
      downloadOps: async (_shareId, after, limit) => {
        calls.push({ after, limit });
        if (opts.failAt !== undefined && calls.length > opts.failAt) {
          throw new Error('server exploded');
        }
        const source = opts.alwaysFullPage === true ? [...rows] : rows.filter((r) => r.serverSeq > after);
        const pending = source.sort((a, b) => a.serverSeq - b.serverSeq);
        let page = pending.slice(0, limit ?? 200);
        if (opts.shortFirstPage === true && calls.length === 1) page = page.slice(0, 1);
        return { ops: page, cursor: { latestServerSeq: latest } };
      },
    },
  };
}

function makeStorage(seed?: { cursors?: Record<string, number> }): {
  saved: Map<string, ShareLogState>;
  cursors: Map<string, number>;
  storage: ShareLogStorage;
} {
  const saved = new Map<string, ShareLogState>();
  const cursors = new Map<string, number>(Object.entries(seed?.cursors ?? {}));
  return {
    saved,
    cursors,
    storage: {
      load: (shareId) => saved.get(shareId) ?? emptyShareLogState(),
      save: (shareId, log) => {
        saved.set(shareId, log);
      },
      list: () => [...new Set([...saved.keys(), ...cursors.keys()])],
      cursor: (shareId) => cursors.get(shareId) ?? 0,
      setCursor: (shareId, seq) => {
        cursors.set(shareId, seq);
      },
    },
  };
}

function makeHost(
  over: Partial<ShareCommentsHostOptions> & { readonly decryptSpy?: (identity: unknown) => void } = {},
): {
  host: ReturnType<typeof createShareCommentsHost>;
  storage: ReturnType<typeof makeStorage>;
} {
  const { decryptSpy, ...optionOver } = over;
  const storage = makeStorage();
  const server = makeServer([]);
  const host = createShareCommentsHost({
    ctx,
    api: server.api,
    cipherFor: async () => ({
      encrypt: async (payload: string) => `ct:${payload}`,
      decrypt: async (payload: string, identity: unknown) => {
        decryptSpy?.(identity);
        return payload.replace(/^ct:/, '');
      },
    }),
    storage: storage.storage,
    currentUserId: () => 'u-me',
    clientId: 'device-B',
    schemaVersion: 1,
    isSignedIn: () => true,
    now: () => T0 + 90_000,
    ...optionOver,
  });
  return { host, storage };
}

describe('pullShareOps（M1 下行）', () => {
  it('🔴 拉到别人写的评论 ⇒ 本地读得到（这条链断的就是这一格）', async () => {
    const rows = [wireRow(1), wireRow(2)];
    const server = makeServer(rows);
    const { host } = makeHost({ api: server.api });

    expect(host.commentsForTask(SHARED_TASK), '拉之前一条都没有').toHaveLength(0);

    const result = await host.pullShareOps('share-1');
    expect(result).toMatchObject({ fetched: 2, added: 2, cursor: 2, pages: 1 });
    expect(host.commentsForTask(SHARED_TASK).map((c) => c.body)).toEqual(['第 1 句', '第 2 句']);
    expect(host.commentsForTask(SHARED_TASK).map((c) => c.authorUserId)).toEqual(['u-a', 'u-a']);
  });

  it('未登录 ⇒ 抛类型化错误且**零请求**（钉在网络边界，不是"返回了 undefined"）', async () => {
    const server = makeServer([wireRow(1)]);
    const { host } = makeHost({ api: server.api, isSignedIn: () => false });
    await expect(host.pullShareOps('share-1')).rejects.toBeInstanceOf(ShareNotSignedInError);
    expect(server.calls, '未登录一个下行请求都不许发').toHaveLength(0);
  });

  it('密钥没解锁 ⇒ 抛类型化错误且零请求（拉回来也解不开，不如不发）', async () => {
    const server = makeServer([wireRow(1)]);
    const { host } = makeHost({ api: server.api, cipherFor: async () => undefined });
    await expect(host.pullShareOps('share-1')).rejects.toBeInstanceOf(ShareKeyUnavailableError);
    expect(server.calls).toHaveLength(0);
  });

  it('🔴 第二次 pull 从上次的位置继续；同一批重复拉**不长出第二条评论**', async () => {
    const server = makeServer([wireRow(1), wireRow(2)]);
    const { host, storage } = makeHost({ api: server.api });

    await host.pullShareOps('share-1');
    const second = await host.pullShareOps('share-1');

    expect(server.calls.map((c) => c.after), '第二次必须从游标继续，而不是每次从头拉').toEqual([0, 2]);
    expect(second).toMatchObject({ fetched: 0, added: 0, cursor: 2 });
    expect(host.commentsForTask(SHARED_TASK)).toHaveLength(2);

    // 重试/补拉的形状：游标退回 0（比如上一轮崩在推进之前），服务端把同一批再给一遍。
    storage.cursors.set('share-1', 0);
    const third = await host.pullShareOps('share-1');
    expect(third.fetched, '确实又收到了那两条').toBe(2);
    expect(third.added, '但折叠按 op id 去重 ⇒ 没有新 op 进日志').toBe(0);
    expect(host.commentsForTask(SHARED_TASK), '界面上不会长出第二份').toHaveLength(2);
  });

  it('🔴 冷启动：同一份存储重建宿主 ⇒ 游标从盘上读回，旧 op 不重拉、评论照样在', async () => {
    const rows = [wireRow(1), wireRow(2), wireRow(3)];
    const storage = makeStorage();
    const codec = {
      encrypt: async (p: string) => `ct:${p}`,
      decrypt: async (p: string) => p.replace(/^ct:/, ''),
    };
    const build = (api: ShareOpUploadPort & ShareOpDownloadPort): ReturnType<typeof createShareCommentsHost> =>
      createShareCommentsHost({
        ctx,
        api,
        cipherFor: async () => codec,
        storage: storage.storage,
        currentUserId: () => 'u-me',
        clientId: 'device-B',
        schemaVersion: 1,
        isSignedIn: () => true,
      });

    const serverA = makeServer(rows);
    await build(serverA.api).pullShareOps('share-1');
    expect(storage.cursors.get('share-1'), '游标落在存储里，不是只在内存').toBe(3);

    // 新宿主 = 同一份存储（重启），服务端还是那三行。
    const serverB = makeServer(rows);
    const hostB = build(serverB.api);
    const result = await hostB.pullShareOps('share-1');
    expect(serverB.calls.map((c) => c.after), '冷启动第一次就问 after=3').toEqual([3]);
    expect(result.fetched, '旧 op 不重拉').toBe(0);
    // 而读路径靠的是盘上那份日志 —— 评论不依赖这次拉取。
    expect(hostB.commentsForTask(SHARED_TASK).map((c) => c.body)).toEqual(['第 1 句', '第 2 句', '第 3 句']);
  });

  it('🔴 解密用的 identity 是**线上那份**（timestamp = clientTimestamp，不是本地 now）', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const server = makeServer([wireRow(7)]);
    const { host } = makeHost({
      api: server.api,
      decryptSpy: (identity) => {
        seen.push(identity as Record<string, unknown>);
      },
    });
    await host.pullShareOps('share-1');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      id: 'op-A-7',
      clientId: 'device-A',
      actionType: 'add comment',
      opType: 'CRT',
      entityType: 'COMMENT',
      entityId: 'comment-A-7',
      schemaVersion: 1,
      timestamp: T0 + 7,
    });
    expect(seen[0]!.timestamp, '用本地 now() 重建 AAD 会被 GCM 拒 —— 这条判据钉的就是它').not.toBe(T0 + 90_000);
  });

  it('分页收敛：两页追平；一直给非空页时撞上界**抛错**而不是返回半截', async () => {
    const rows = [wireRow(1), wireRow(2), wireRow(3)];
    const server = makeServer(rows);
    const { host, storage } = makeHost({ api: server.api, pullPageSize: 2 });
    const result = await host.pullShareOps('share-1');
    expect(result.pages, '2+1 两页').toBe(2);
    expect(result.fetched).toBe(3);
    expect(storage.cursors.get('share-1')).toBe(3);

    // 病灶形状：服务端无视游标一直给同一批、头还报得比消费位置高 ⇒ 上界必须拦住。
    const stuck = makeServer([wireRow(1)], { alwaysFullPage: true, head: 999 });
    const stuckHost = makeHost({ api: stuck.api, pullPageSize: 1, pullMaxPages: 3 });
    await expect(stuckHost.host.pullShareOps('share-1')).rejects.toThrow(/收敛/);
  });

  it('🔴 服务端头超前于这一页给的内容 ⇒ 游标只推到**已消费**那条，剩下的下一轮补齐', async () => {
    // 这一条是那个 bug 挣来的：第一版把"我消费到哪"和"服务端头在哪"写成同一个变量，
    // 于是第一页只给 1 条而头在 3 时游标直接跳到 3 ⇒ 第 2、3 条**永远不会再被拉**。
    const rows = [wireRow(1), wireRow(2), wireRow(3)];
    const server = makeServer(rows, { shortFirstPage: true });
    const { host, storage } = makeHost({ api: server.api });

    const result = await host.pullShareOps('share-1');
    expect(result.fetched, '三条都要吃到（不是第一页那一条）').toBe(3);
    expect(storage.cursors.get('share-1')).toBe(3);
    expect(host.commentsForTask(SHARED_TASK).map((c) => c.body)).toEqual(['第 1 句', '第 2 句', '第 3 句']);
  });

  it('🔴 先落日志再推游标：中途炸 ⇒ 游标不动、日志不动（下次能补齐）', async () => {
    const rows = [wireRow(1), wireRow(2)];
    const server = makeServer(rows);
    const storage = makeStorage();
    let decrypts = 0;
    const host = createShareCommentsHost({
      ctx,
      api: server.api,
      cipherFor: async () => ({
        encrypt: async (p: string) => `ct:${p}`,
        decrypt: async (p: string) => {
          decrypts += 1;
          if (decrypts === 2) throw new Error('GCM rejected');
          return p.replace(/^ct:/, '');
        },
      }),
      storage: storage.storage,
      currentUserId: () => 'u-me',
      clientId: 'device-B',
      schemaVersion: 1,
      isSignedIn: () => true,
    });
    await expect(host.pullShareOps('share-1')).rejects.toThrow('GCM rejected');
    expect(storage.cursors.get('share-1'), '游标没推进 ⇒ 那批下次还会被拉').toBeUndefined();
    expect(storage.saved.get('share-1')?.ops ?? [], '日志也没落一半').toHaveLength(0);
  });
});
