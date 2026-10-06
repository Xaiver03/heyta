/**
 * 「到期后本地数据仍然完整可读写」—— **硬约束的机械保障**
 * ==========================================================
 *
 * `docs/plans/subscription-boundary.md` §2 的原话是
 * 「本地数据 🔴 一个字都不动。本地优先是这个产品的底层承诺，
 * 付费状态**永远不许**影响本地可用性」。
 *
 * 一句承诺写在文档里是没有约束力的。这个文件把它变成三条可执行断言：
 *
 *   1. **已经存在的任务**在到期后仍然读得到、改得动；
 *   2. **到期后新写的东西**照样落 op-log（不是留在内存里假装成功）；
 *   3. 降级路径**一个携带任务内容的请求都不发**（E2EE 硬约束）。
 *
 * 它挂的是**真 op-log + 真 IndexedDB**，不做内存替身 ——
 * 因为要证明的恰恰是"数据真的还在盘上"。
 */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IndexedDbAdapter, IndexedDbOpLogStore } from '@heyta/storage';
import { emptyState } from '@heyta/op-log';
import type { Operation } from '@heyta/sync-core';

import {
  __resetOpLogForTests,
  initOpLog,
  selectVisibleTasks,
  useTaskStore,
} from '../src/features/tasks/store.js';
import { __resetSubscriptionForTests, useSubscriptionStore } from '../src/features/subscription/store.js';
import { useSyncStore } from '../src/features/sync/store.js';

let dbName: string;
let fetchMock: ReturnType<typeof vi.fn>;

const NOW = new Date(2026, 8, 25, 10, 0, 0).getTime();

/** 让权益探测端点回一个"到期"的拒绝。 */
function stubExpiredProbe(): void {
  fetchMock = vi.fn(() =>
    Promise.resolve({
      status: 402,
      ok: false,
      json: () =>
        Promise.resolve({ errorCode: 'SUBSCRIPTION_REQUIRED', reason: 'PERIOD_ENDED' }),
    } as unknown as Response),
  );
  vi.stubGlobal('fetch', fetchMock);
}

/** 让权益探测端点像一个**自托管**服务端那样放行。 */
function stubSelfHostedProbe(): void {
  fetchMock = vi.fn(() =>
    Promise.resolve({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ latestSeq: 7, devicesOnline: 1 }),
    } as unknown as Response),
  );
  vi.stubGlobal('fetch', fetchMock);
}

/** 从盘上把 op 读回来 —— 这正是"导出"会读的那份东西。 */
async function readOpsFromDisk(): Promise<Operation<string>[]> {
  const db = new IndexedDbAdapter(dbName);
  await db.init();
  const store = new IndexedDbOpLogStore<Operation<string>>(db);
  const rows = await store.getAllOps();
  db.close();
  return rows.map((row) => row.op);
}

/** 把当前同步/订阅状态都推到「官方托管同步已到期」。 */
async function expireHostedSync(): Promise<void> {
  stubExpiredProbe();
  useSyncStore.setState({ baseUrl: 'https://sync.example.com', token: 'token-123' });
  const access = await useSubscriptionStore.getState().refresh();
  expect(access.kind).toBe('restricted');
}

beforeEach(async () => {
  const g = globalThis as unknown as {
    indexedDB: IDBFactory;
    IDBKeyRange: typeof IDBKeyRange;
  };
  g.indexedDB = new IDBFactory();
  g.IDBKeyRange = IDBKeyRange;

  dbName = `subscription-downgrade-${Math.random().toString(36).slice(2)}`;
  __resetOpLogForTests();
  __resetSubscriptionForTests();
  useSyncStore.setState({ baseUrl: '', token: undefined, syncSettingsRequested: false });
  useTaskStore.setState({
    entities: emptyState(),
    filter: { kind: 'all' },
    now: NOW,
    ready: false,
  });
  await initOpLog(dbName);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('🔴 到期后本地任务数据仍然完整可读写', () => {
  it('keeps every existing task readable and editable after expiry', async () => {
    await useTaskStore.getState().addTask('买菜');
    await useTaskStore.getState().addTask('写周报');
    const before = selectVisibleTasks(useTaskStore.getState()).map((t) => t.title);
    expect(before).toEqual(['买菜', '写周报']);

    await expireHostedSync();

    // ① 读：全部还在，顺序不变。
    expect(selectVisibleTasks(useTaskStore.getState()).map((t) => t.title)).toEqual(before);

    // ② 改：编辑备注、完成/取消完成都照样工作。
    const id = Object.keys(useTaskStore.getState().entities.tasks)[0]!;
    await useTaskStore.getState().setNote(id, '到期后写的备注');
    expect(useTaskStore.getState().entities.tasks[id]!.note).toBe('到期后写的备注');

    await useTaskStore.getState().toggleComplete(id);
    expect(useTaskStore.getState().entities.tasks[id]!.completedAt).toBeTypeOf('number');
    await useTaskStore.getState().toggleComplete(id);
    expect(useTaskStore.getState().entities.tasks[id]!.completedAt).toBeUndefined();

    // ③ 到期之后**仍然能新增**任务（本地优先的底层承诺）。
    await useTaskStore.getState().addTask('到期后新建的任务');
    expect(selectVisibleTasks(useTaskStore.getState()).map((t) => t.title)).toContain(
      '到期后新建的任务',
    );
  });

  it('到期后的每一次写入都真的落盘（不是内存里的假成功）', async () => {
    await useTaskStore.getState().addTask('旧任务');
    const opsBefore = await readOpsFromDisk();

    await expireHostedSync();

    await useTaskStore.getState().addTask('到期后新建的任务');
    const opsAfter = await readOpsFromDisk();

    expect(opsAfter.length).toBe(opsBefore.length + 1);
    // 盘上的 op 里能看到新的那条标题 —— 也就是"导出"读到的东西是完整的。
    const serialized = JSON.stringify(opsAfter);
    expect(serialized).toContain('到期后新建的任务');
    expect(serialized).toContain('旧任务');
  });

  it('不删、不清空：到期前后盘上 op 条数只增不减', async () => {
    await useTaskStore.getState().addTask('一');
    await useTaskStore.getState().addTask('二');
    const before = (await readOpsFromDisk()).length;

    await expireHostedSync();
    await useSubscriptionStore.getState().refresh();
    await useSubscriptionStore.getState().refresh();

    expect((await readOpsFromDisk()).length).toBeGreaterThanOrEqual(before);
  });
});

describe('🔴 自托管（未配置订阅）下不出现任何付费/降级行为', () => {
  it('a self-hosted server (gate closed) leaves everything unrestricted', async () => {
    stubSelfHostedProbe();
    useSyncStore.setState({ baseUrl: 'http://192.168.1.9:3000', token: 'local-token' });

    const access = await useSubscriptionStore.getState().refresh();
    expect(access).toEqual({ kind: 'unrestricted', because: 'entitled' });
  });

  it('nothing is configured → not even a request, and no restriction', async () => {
    stubExpiredProbe();
    useSyncStore.setState({ baseUrl: '', token: undefined });

    const access = await useSubscriptionStore.getState().refresh();
    expect(access.kind).toBe('unrestricted');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a network failure never downgrades the user', async () => {
    fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetchMock);
    useSyncStore.setState({ baseUrl: 'https://sync.example.com', token: 'token-123' });

    const access = await useSubscriptionStore.getState().refresh();
    expect(access.kind).toBe('unrestricted');
  });

  it('a self-hosted server never sees a downgrade even while tasks exist', async () => {
    await useTaskStore.getState().addTask('本机任务');
    stubSelfHostedProbe();
    useSyncStore.setState({ baseUrl: 'http://192.168.1.9:3000', token: 'local-token' });

    await useSubscriptionStore.getState().refresh();
    expect(useSubscriptionStore.getState().access.kind).toBe('unrestricted');
    expect(selectVisibleTasks(useTaskStore.getState()).map((t) => t.title)).toEqual([
      '本机任务',
    ]);
  });
});

describe('🔴 E2EE：降级路径不发起任何携带任务内容的请求', () => {
  it('the entitlement probe is a body-less GET even when tasks exist', async () => {
    await useTaskStore.getState().addTask('不能被上传的机密任务标题');
    await expireHostedSync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    // 请求里不能出现任何任务内容 / 任务形状的字段。
    const serialized = JSON.stringify({ url, init });
    expect(serialized).not.toContain('不能被上传的机密任务标题');
    expect(serialized.toLowerCase()).not.toContain('entitytype');
    expect(serialized.toLowerCase()).not.toContain('vectorclock');
    // 不许打到携带载荷的同步端点。
    expect(String(url)).not.toContain('/ops');
    expect(String(url)).not.toContain('/snapshot');
  });

  it('repeated entitlement checks still never upload anything', async () => {
    await useTaskStore.getState().addTask('机密 A');
    await useTaskStore.getState().addTask('机密 B');

    stubExpiredProbe();
    useSyncStore.setState({ baseUrl: 'https://sync.example.com', token: 'token-123' });
    await useSubscriptionStore.getState().refresh();
    await useSubscriptionStore.getState().refresh();
    await useSubscriptionStore.getState().refresh();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [url, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(init.method).toBe('GET');
      expect(init.body).toBeUndefined();
      expect(String(url)).not.toContain('/ops');
    }
  });
});
