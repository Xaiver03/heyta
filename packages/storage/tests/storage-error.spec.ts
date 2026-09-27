/**
 * 存储失败的**结构化原因**
 * ==========================
 *
 * 这份测试存在的理由只有一条：**错误屏渲染的是 `error.message` 原文**。
 * （`apps/web/src/main.tsx:52` 取出来 → `ErrorScreen.tsx:74` 直接显示。）
 * 所以只要 `packages/storage` 抛的是裸 `Error` + 中文，英文界面的用户就会在
 * 应用启动失败时读到一句中文 —— 而**门禁扫不到**（它查的是字面量，
 * 这里渲染的是一个变量）。
 *
 * 于是这一层要钉两件事：
 *
 *   1. **真的有 `kind`**（壳才能按 `kind` 取词条）；
 *   2. **`message` 逐字没变**（它有诊断价值，而且现有测试按它断言）。
 *
 * 🔴 第一个用例**不伪造浏览器行为**：它先用 `version = 1` 占住一条连接
 * （模拟"另一个标签页还开着旧版本"），再让适配器按 `DB_SCHEMA_VERSION = 2` 打开，
 * 于是 `fake-indexeddb` 会**真的**派发 `blocked`。这正是线上触发条件
 * （同一个站点开了两个标签页，其中一个是旧版本）。
 */

import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import { IndexedDbAdapter } from '../src/indexeddb/indexeddb-adapter.js';
import { StorageError, storageError } from '../src/errors.js';
import { STORES } from '../src/stores.js';

/** 每个用例一份全新的 IndexedDB 全局（与 `indexeddb.spec.ts` 同一手法）。 */
function freshIndexedDb(): IDBFactory {
  const g = globalThis as unknown as {
    indexedDB: IDBFactory;
    IDBKeyRange: typeof FakeIDBKeyRange;
  };
  g.indexedDB = new IDBFactory();
  g.IDBKeyRange = FakeIDBKeyRange;
  return g.indexedDB;
}

const uniqueName = (): string => `errors-${Math.random().toString(36).slice(2, 10)}`;

describe('StorageFailure：真实失败都带结构化原因', () => {
  beforeEach(() => {
    freshIndexedDb();
  });

  it('🔴 升级被其它标签页阻塞 → upgrade-blocked（真实 blocked 事件）', async () => {
    const name = uniqueName();

    // 1) 以**低版本**占住连接：这正是"另一个标签页还开着旧版本"。
    const held = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('占位连接打开失败'));
    });

    try {
      // 2) 适配器按更高的版本打开 → 升级被上面那条连接挡住。
      const adapter = new IndexedDbAdapter(name);
      await expect(adapter.init()).rejects.toMatchObject({
        failure: { kind: 'upgrade-blocked' },
        // 这条 message 是**用户唯一会读到的东西**，改造前后必须逐字相同。
        message: 'IndexedDB 升级被其它标签页阻塞 —— 请关闭该应用的其它窗口后重试',
      });
    } finally {
      held.close();
    }
  });

  it('抛出来的不是裸 Error，而是带 failure 的 StorageError', async () => {
    const name = uniqueName();
    const held = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('占位连接打开失败'));
    });

    try {
      const adapter = new IndexedDbAdapter(name);
      const error: unknown = await adapter.init().then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(StorageError);
      // 壳里的用法：`err instanceof StorageError ? err.failure.kind : …`
      expect((error as StorageError).failure.kind).toBe('upgrade-blocked');
    } finally {
      held.close();
    }
  });

  it('事务里访问未声明的 store → programming-error（用户无从下手的那一类）', async () => {
    const adapter = new IndexedDbAdapter(uniqueName());
    await adapter.init();

    // ⚠️ 用**公开方法**触发 `makeTx` 的断言。`tx.store(...)` 不是公开 API
    // （它是内部辅助函数），调它会得到 `TypeError` —— 那是测试写错了，
    // 不是被测代码的缺陷。第一版就是这么写错的。
    const error: unknown = await adapter
      .transaction([STORES.META], 'readonly', async (tx) => tx.get('这个 store 不存在', 'k'))
      .then(
        () => undefined,
        (e: unknown) => e,
      );

    expect(error).toBeInstanceOf(StorageError);
    // 🔴 这一条同时钉住 `asStorageError` 的"一手结构优先"：
    // 事务体外面还有一层统一 catch，用 `storageError()` 直接包会把
    // `programming-error` 降级成笼统的 `request-failed`。
    expect((error as StorageError).failure).toEqual({ kind: 'programming-error' });
    // 编程错误的细节留在 message 里（错误屏把它降级成"详情"）。
    expect((error as StorageError).message).toContain('这个 store 不存在');
  });
});

describe('storageError()：包装时不改变 message', () => {
  it('驱动自己的错误优先 —— message 与 `request.error ?? new Error(兜底)` 逐字相同', () => {
    const wrapped = storageError(new Error('故意失败'), 'IndexedDB 请求失败', {
      kind: 'request-failed',
    });
    expect(wrapped.message).toBe('故意失败');
    expect(wrapped.failure).toEqual({ kind: 'request-failed' });
  });

  it('驱动没给错误对象时才用兜底句（`?? ` 的语义）', () => {
    expect(storageError(null, 'IndexedDB 请求失败', { kind: 'request-failed' }).message).toBe(
      'IndexedDB 请求失败',
    );
    expect(storageError(undefined, '删除数据库失败', { kind: 'request-failed' }).message).toBe(
      '删除数据库失败',
    );
  });

  it('非 Error 的 rejection 值也被包成 Error（比"原样抛出去"更严）', () => {
    const wrapped = storageError('驱动返回了一个字符串', '兜底', { kind: 'request-failed' });
    expect(wrapped).toBeInstanceOf(StorageError);
    expect(wrapped.message).toBe('驱动返回了一个字符串');
  });

  it('🔴 cause 保留驱动原始错误 —— 唯一索引冲突的判定只能靠它', () => {
    // 包一层之后 `error.name` 就不再是驱动那个名字了，所以
    // `addToleratingDuplicate` 必须往 `cause` 里找 `ConstraintError`。
    // 丢掉 cause 的后果是实测过的：幂等写入的 4 个既有用例当场变红。
    const driverError = new Error('dup');
    driverError.name = 'ConstraintError';
    const wrapped = storageError(driverError, '兜底', { kind: 'request-failed' });
    expect(wrapped.name).toBe('StorageError');
    expect((wrapped.cause as Error).name).toBe('ConstraintError');
  });

  it('name 是 StorageError，方便日志里一眼认出来', () => {
    expect(storageError(new Error('x'), 'y', { kind: 'open-failed' }).name).toBe('StorageError');
  });
});