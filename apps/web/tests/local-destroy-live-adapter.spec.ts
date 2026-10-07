import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AdapterDestroyedError, IndexedDbAdapter } from '@heyta/storage';

import { eraseWebLocalData } from '../src/lib/local-data-destruction.js';
import {
  __resetOpLogForTests,
  destroyLiveStorage,
  initOpLog,
  requireStore,
} from '../src/lib/oplog.js';

/**
 * 注销销毁的是**哪一个适配器实例**（#104 那条腿的语义层）
 * ========================================================
 *
 * ## 这一格原来缺的是什么
 *
 * `eraseWebLocalData()` 此前是 `new IndexedDbAdapter(MAIN_DATABASE).destroy()` ——
 * **另开一个实例**去删盘上的库。盘上确实删掉了，而**这个页面会话真正在用的那个实例**
 * （`lib/oplog.ts` 的模块单例，同步客户端在构造时就把它的 store captures 住了）
 * **没有被标记成已销毁**。于是它下一发读写会走 `indexedDB.open()`，把同名库
 * **空着建回来**：界面报"已清除"，盘上多出一个属于这个人的空壳。
 *
 * `@heyta/storage` 的 errors.ts 把契约写得很清楚：销毁之后是**那个实例**拒绝读写，
 * "而不是把刚删掉的容器重新建成空壳"；要重新用得换新实例。所以真正要判的两件事是分开的：
 *
 *   1. 旧句柄的下一发读写**必须**以 `AdapterDestroyedError` 失败（下面第一条）；
 *   2. 同一条页面会话里**重新登录**必须能用一个新实例跑起来，不能被那个已销毁的实例挡住
 *      （下面第二条 —— 这条是第一条的配对：只清单例不销毁 = 静默重建；只销毁不清单例 = 重新登录永久坏）。
 *
 * ⚠️ **语义层证的是"哪个实例被标记成已销毁"，它证不了"真浏览器里盘上真没字节"** ——
 * 后者住 `e2e/tests/local-data-destruction-browser.spec.ts`（真 Chromium + 真 OPFS），
 * 而"注销之后在**生产产物**里读不回来 + 销毁后拒用"那一腿住
 * `e2e/selfhost-stack/selfhost-web.spec.ts` 的 S4（真容器 + 真服务端 + 打过包的 bundle）。
 * 三层的判据不重叠，这是本仓库一贯的纵深口径（见 `local-data-destruction.spec.ts` 文件头）。
 *
 * ## 为什么这个文件**不 mock** `lib/oplog.js`
 *
 * 隔壁那份把 oplog mock 掉了（它要判的是 OPFS 那一类的**调用顺序**）。这里如果也 mock，
 * 断言的就是桩的行为而不是产品 —— 而"单例有没有被清"这件事**只能**从真模块的模块态里读。
 * 所以这里跑真 `initOpLog()`，靠 `vite.config.ts` 里那个 `VITE_HEYTA_STORAGE=indexeddb`
 * 走 IndexedDB 分支（jsdom 没有 IndexedDB，`tests/setup.ts` 补的是 `fake-indexeddb/auto`）。
 */

function resetIdb(): void {
  const g = globalThis as unknown as { indexedDB: IDBFactory };
  g.indexedDB = new IDBFactory();
}

beforeEach(() => {
  resetIdb();
  __resetOpLogForTests();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  // 🔴 模块单例必须每趟还原：`initOpLog()` 是幂等且**记忆化**的，
  //    留下的 `initPromise` 会让下一趟用例拿到上一趟那个已销毁的实例 ——
  //    症状是"下一趟红在一条跟它无关的断言上"（§7 第 83 条同族：探针留下的状态就是后续判据的输入）。
  __resetOpLogForTests();
});

describe('注销销毁的是活的那个实例（#104 语义层）', () => {
  it('🔴 销毁后，**旧句柄**的下一发读写以 AdapterDestroyedError 失败', async () => {
    await initOpLog();
    const store = requireStore();
    // 阳性对照：注销之前同一发读必须读得出来 —— 否则"它拒了"这条断言在任何环境下都成立。
    await expect(store.countAllOps()).resolves.toBeGreaterThanOrEqual(0);

    const reports = await eraseWebLocalData();
    const main = reports.find((r) => r.target === 'heyta');
    expect(main, `主库那一份报告不见了：${reports.map((r) => r.target).join(', ')}`).toBeTruthy();
    expect(main!.containerRemoved).toBe(true);

    // 这一条就是"销毁后拒用"：不是"读到空"，是**拒绝**。读到空既可能是闸起作用，
    // 也可能是刚把空壳建回来 —— 两种解释在返回值上长得一模一样，所以判据必须是错误类型。
    await expect(store.countAllOps()).rejects.toBeInstanceOf(AdapterDestroyedError);
  });

  it('🔴 同一条会话里重新登录用的是新实例，不会被那个已销毁的挡住', async () => {
    await initOpLog();
    const oldStore = requireStore();
    await eraseWebLocalData();

    await expect(initOpLog()).resolves.toBeUndefined();
    const fresh = requireStore();
    expect(fresh).not.toBe(oldStore);
    await expect(fresh.countAllOps()).resolves.toBe(0);
    // 旧句柄仍然拒（新实例可用 ≠ 旧实例被"复活"）
    await expect(oldStore.countAllOps()).rejects.toBeInstanceOf(AdapterDestroyedError);
  });

  it('没开过存储时 destroyLiveStorage 报 undefined，销毁回落到"新建实例去删"', async () => {
    // 手工在盘上建一份属于这个人的库（模拟上一段会话留下的数据，本趟从没 init 过）。
    const hand = new IndexedDbAdapter('heyta');
    await hand.init();
    expect(await hand.count('ops')).toBeGreaterThanOrEqual(0);
    hand.close();

    expect(await destroyLiveStorage()).toBeUndefined();

    const reports = await eraseWebLocalData();
    expect(reports.find((r) => r.target === 'heyta')?.containerRemoved).toBe(true);
  });

  it('重复调用不抛（第二次已经没有活实例，返回 undefined 而不是炸）', async () => {
    await initOpLog();
    const first = await destroyLiveStorage();
    expect(first?.target).toBe('heyta');
    expect(await destroyLiveStorage()).toBeUndefined();
  });
});
