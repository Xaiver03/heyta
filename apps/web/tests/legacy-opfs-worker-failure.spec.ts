/**
 * 「旧 OPFS 的探测 worker 起不来」这一族：启动**不许**挂死。
 * ==========================================================
 *
 * ## 为什么单开这一枚文件
 *
 * `initOpLog()` 按模块级 Promise 记忆化，一个文件里只能初始化一次
 * （`storage-backend-shell.spec.ts` 文件头就写了这条）。而这一档要的是
 * **另一种环境**：那里 Worker 压根不存在（jsdom 没实现 ⇒ `new Worker` 直接抛，
 * 被 `importIntoEmptyTarget` 的 catch 接住），这里要的是
 * **"Worker 构造成功、但永远不回话，只发一个 `error` 事件"** ——
 * 那才是 Linux 原生壳里实测到的形状（自定义 scheme 下 `type:'module'` 的 worker
 * 构造即失败：`worker-error` 有事件、`message` 是空串，而壳的 scheme 处理程序
 * 根本没收到那一发请求）。
 *
 * 🔴 没有 `oplog.ts` 里那个 `Promise.race`，`await session.ready` **永不 settle**，
 *    这条用例会一路挂到 vitest 超时。也就是说：这条判据的"能红"形态就是**挂死**，
 *    而那正是它在生产里对用户做的事 —— 应用不开、不报错、日志干净。
 *    变异复现（把 `Promise.race([...])` 换回 `await session.ready`）：本文件转红。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DbOpLogStore,
  INDEXEDDB_SCHEMA,
  MemoryDbAdapter,
  createOpLogWirePort,
  serveOpLogWorker,
} from '@heyta/storage';

import { initOpLog } from '../src/lib/oplog.js';
import { rawJsonPortPair } from './helpers/host-storage-port.js';

/** 一个"起不来"的 Worker：构造成功、`error` 事件照发、消息永远不答。 */
class DeadWorker {
  static instances: DeadWorker[] = [];
  static terminateCalls = 0;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  private readonly listeners = new Map<string, Set<(e: unknown) => void>>();

  constructor() {
    DeadWorker.instances.push(this);
    queueMicrotask(() => this.fire('error', { message: 'module worker 在这一档 scheme 下起不来' }));
  }

  addEventListener(type: string, listener: (e: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type: string, listener: (e: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** 永远不回话 —— 这正是"卡在 ready"的那一半。 */
  postMessage(): void {
    /* 刻意什么都不做 */
  }

  terminate(): void {
    DeadWorker.terminateCalls += 1;
  }

  private fire(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

type Reported = { backend?: string; clientId?: string };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  DeadWorker.instances = [];
  DeadWorker.terminateCalls = 0;
  delete (globalThis as { __heytaStorage?: Reported }).__heytaStorage;
});

describe('旧 OPFS 探测 worker 起不来时，启动必须继续（第五条守卫）', () => {
  it('🔴 initOpLog 落定、后端仍报 shell、迁移失败留下痕迹，而不是永远卡在 ready', async () => {
    vi.stubGlobal('Worker', DeadWorker);

    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });

    // 壳那一侧照常起：这一档要验的不是交握，是"另一条腿挂了也不许拖着启动"。
    const shellDb = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
    await shellDb.init();
    const raw = rawJsonPortPair();
    serveOpLogWorker(
      createOpLogWirePort(raw.shellSide),
      Promise.resolve({ store: new DbOpLogStore(shellDb) as never, clientId: 'linux-shell-client' }),
    );
    (window as Window & { __heytaHostStoragePort?: unknown }).__heytaHostStoragePort = raw.pageSide;

    await initOpLog('dead-legacy-worker-test');

    expect(DeadWorker.instances, '迁移确实去开了那个 worker（否则这条判据测的是别的东西）').toHaveLength(
      1,
    );
    const reported = (globalThis as { __heytaStorage?: Reported }).__heytaStorage;
    expect(reported?.backend, '探测腿失败不许改变"这次用的是哪条存储路径"').toBe('shell');
    expect(
      reported?.clientId,
      'clientId 仍必须来自壳侧的 ready 交握 —— 挂掉的只是那条一次性的迁移',
    ).toBe('linux-shell-client');
    expect(
      errors.join('\n'),
      '失败必须留痕（守卫第五条：不阻断启动，但要看得见）',
    ).toContain('旧 OPFS SQLite 迁移失败');
    expect(DeadWorker.terminateCalls, '失败的 worker 也要被关掉').toBeGreaterThan(0);
  }, 8_000);
});
