/**
 * 销毁（批次 E2）—— 共享契约**覆盖不到**的那一段
 * =================================================
 *
 * `tests/contract/adapter.contract.ts` 里那四条 destroy 判据跑在每一套实现上，
 * 但它们只能证明"接口层没说谎"。E2 的承诺是
 * **「注销之后这台设备上的明文没了」**，而这句话会被两件契约看不见的事推翻：
 *
 * 1. **容器之外还有容器。** SQLite 的 `-wal` / `-shm` 是**另一份明文**：WAL 里是
 *    已提交但还没回填进主文件的页。只删主文件 = 删掉一本、留下抄本。
 *    共享契约跑在 `:memory:` 上，根本没有文件可删，所以它**结构上看不见**这件事。
 * 2. **"成功"可以是伪造的。** `deleteDatabase` 在别的连接没让位时只会 `blocked`；
 *    若在 `onblocked` 里 `resolve()`，调用方拿到的是"销毁成功"，磁盘上什么都没变。
 *    这不是假想的 bug，是这条链上真实存在过的形态 —— 而它**永远绿**，
 *    因为没有任何一层能观测到"没删"。
 *
 * 所以这里的判据全部围绕**契约看不见的那一层**：磁盘上剩了几个文件、
 * 被堵住时到底有没有 resolve。
 */

import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';

import { INDEXEDDB_SCHEMA, IndexedDbAdapter } from '../src/indexeddb/indexeddb-adapter.js';
import { AdapterDestroyedError } from '../src/errors.js';
import { MemoryDbAdapter } from '../src/memory/memory-adapter.js';
import { NodeSqliteDriver } from '../src/sqlite/node-sqlite-driver.js';
import { SqliteAdapter } from '../src/sqlite/sqlite-adapter.js';
import type { SqliteDriver, SqlValue } from '../src/sqlite/sqlite-driver.js';
import { ALL_STORES, STORES } from '../src/stores.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-destroy-'));
  tempDirs.push(dir);
  return dir;
}

function opRecord(id: string): Record<string, unknown> {
  return {
    op: {
      id,
      entityType: 'TASK',
      entityId: 'task-1',
      payload: { title: '写进磁盘的明文标题' },
      clientId: 'client-a',
      timestamp: 1_000,
      vectorClock: { 'client-a': 1 },
    },
    source: 'local',
    applyStatus: 'applied',
    uploadStatus: 'pending',
  };
}

/** 全局 IndexedDB 换成一份**新**的工厂；返回它好让同一场景里再开第二个连接。 */
function freshIdb(): IDBFactory {
  const factory = new IDBFactory();
  const g = globalThis as unknown as { indexedDB: IDBFactory; IDBKeyRange: typeof FakeIDBKeyRange };
  g.indexedDB = factory;
  g.IDBKeyRange = FakeIDBKeyRange;
  return factory;
}

/**
 * 判"有没有还在飞"不许用墙上时钟。
 *
 * ⚠️ 这台机器常年并行跑着设备验收与别人的套件，负载能在 100 以上。
 * 用 `setTimeout(ms)` 去判 pending 会两头出错：机器慢时**正向对照**被判成红
 * （它在窗口内还没跑完），机器快时**变异体**（在第一个宏任务里就 resolve）被漏掉。
 * 改成排空固定轮数的微/宏任务队列 —— 它与机器快慢无关，
 * 而 `deleteDatabase` 的 success/error/blocked 派发最多经过一个任务队列。
 */
function track<T>(promise: Promise<T>): { done: boolean; value?: T } {
  const box: { done: boolean; value?: T } = { done: false };
  promise.then(
    (value) => {
      box.done = true;
      box.value = value;
    },
    () => {
      box.done = true;
    },
  );
  return box;
}

async function drainTaskQueues(rounds = 40): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

describe('destroy —— 磁盘上的字节', () => {
  async function openFileDb(path: string): Promise<SqliteAdapter> {
    const db = new SqliteAdapter({
      schema: INDEXEDDB_SCHEMA,
      driverFactory: () => new NodeSqliteDriver(path),
    });
    await db.init();
    return db;
  }

  it('🔴 销毁后目录里**一个文件都不剩**（含 -wal / -shm 旁挂）', async () => {
    const dir = tempDir();
    const path = join(dir, 'heyta.sqlite');
    const db = await openFileDb(path);
    await db.add(STORES.OPS, opRecord('op-1'));
    await db.add(STORES.META, { key: 'k', value: 1 });

    // ⚠️ 为什么手动种这两个文件：node:sqlite 在这条路径上没有开 WAL，
    // 于是"-wal/-shm 必须一起删"这句判据在真实运行里**从没东西可删** ——
    // 它会永远绿，而"只删主文件"的错误实现照样通过。
    // 种下它们不是造假：WAL 模式（移动端 op-sqlite 就是 WAL）确实会留下这两个，
    // 这里要的正是"漏删旁挂文件必须被数出来"。
    writeFileSync(`${path}-wal`, 'uncheckpointed plaintext page');
    writeFileSync(`${path}-shm`, Buffer.alloc(32, 7));
    expect(readdirSync(dir)).toHaveLength(3);

    const report = await db.destroy();

    expect(report.containerRemoved, JSON.stringify(report)).toBe(true);
    // 数目录而不是 existsSync(主文件)：防的是"改名/挪走"这类看起来没了的形态。
    expect(readdirSync(dir), `销毁后残留：${readdirSync(dir).join(', ')}`).toEqual([]);
  });

  it('报告里的 target 是**真实路径**，不是笼统的 "sqlite"', async () => {
    const dir = tempDir();
    const path = join(dir, 'heyta.sqlite');
    const db = await openFileDb(path);
    const report = await db.destroy();
    // 逐宿主取证（计划 §10.2）要把"销毁的是哪一个库"落到日志上；
    // 一个 'sqlite' 字符串在同一台机器上有两份库时分不清是谁。
    expect(report.target).toBe(path);
    db.close();
  });

  it('销毁后**重开同一路径**读到的是空库', async () => {
    const dir = tempDir();
    const path = join(dir, 'heyta.sqlite');
    const first = await openFileDb(path);
    await first.add(STORES.OPS, opRecord('op-1'));
    await first.destroy();

    const reopened = await openFileDb(path);
    for (const store of ALL_STORES) {
      expect(await reopened.count(store), `重开「${store}」读回了东西`).toBe(0);
    }
    reopened.close();
  });

  it('destroy 幂等：第二次销毁一份已经没了的库不是错误', async () => {
    const dir = tempDir();
    const path = join(dir, 'heyta.sqlite');
    const db = await openFileDb(path);
    await db.add(STORES.OPS, opRecord('op-1'));
    const first = await db.destroy();
    const second = await db.destroy();
    expect(second.containerRemoved, JSON.stringify(second)).toBe(true);
    expect(second.storesCleared).toBe(first.storesCleared);
    expect(readdirSync(dir)).toEqual([]);
  });

  /**
   * 🔴 这一条是 iOS 设备级那枚残留（计划 §10.146/§10.147）的**常驻**版本。
   *
   * 那趟真机验收量到"注销后 5 秒 `heyta.sqlite` 又以 6 张空表回来"，字节数 73728，
   * 与这条共享层路径产出的**逐字相同** —— 归因因此从"iOS 原生桥没删干净"
   * 改成了"销毁后一次普通读把容器建回来"。而设备一趟 8 分钟、要抢模拟器窗口，
   * 不可能挂进 `pnpm check`。这条不开设备、不起模拟器，把同一件事钉成常驻判据：
   * **销毁之后连"想重开"这条路都不许存在**。
   *
   * 两半缺一条都不算数：
   *  · 只断言抛错 ⇒ 实现可以"照样重开、再把读改成抛"，文件仍会被建回来；
   *  · 只断言目录为空 ⇒ 实现可以"答应读但返回空"，那正是把明文泄漏
   *    伪装成"库是空的"的那一种。
   */
  it('🔴 销毁后在同一次运行里**任何一次普通读**都不许把库建回来（抛错 + 目录仍为空）', async () => {
    const dir = tempDir();
    const path = join(dir, 'heyta.sqlite');
    const db = await openFileDb(path);
    await db.add(STORES.OPS, opRecord('op-1'));

    const report = await db.destroy();
    expect(report.containerRemoved, JSON.stringify(report)).toBe(true);
    // 前提腿：销毁那一步之后目录必须真的空 —— 否则下面"还是空"这句话是白捡的。
    expect(readdirSync(dir), '销毁那一步就没删干净').toEqual([]);

    for (const store of ALL_STORES) {
      await expect(
        db.count(store),
        `销毁后「${store}」还答应读 —— 这条读会顺手把容器建回来`,
      ).rejects.toBeInstanceOf(AdapterDestroyedError);
    }
    await expect(db.init(), '销毁后还答应重开').rejects.toBeInstanceOf(AdapterDestroyedError);

    // 那一发被拒绝的读**没有**留下任何东西：这才是"文件级残留 0 枚"的完整形状。
    expect(
      readdirSync(dir),
      `销毁后一次被拒绝的读把库建了回来：${readdirSync(dir).join(', ')}`,
    ).toEqual([]);
  });

  it('🔴 驱动**没有** removeDatabase 时（原生桥那一档），必须报"文件仍在"而不是静默成功', async () => {
    const dir = tempDir();
    const path = join(dir, 'heyta.sqlite');

    // 这就是 Swift / C# / ArkTS 桥在补上 removeDatabase **之前**的形状：
    // 四个方法都在，第五个没有。接口把它做成可选正是为了这种情况能被**报告**出来。
    const inner = new NodeSqliteDriver(path);
    const bridge: SqliteDriver = {
      exec: (sql: string) => inner.exec(sql),
      run: (sql: string, params?: readonly SqlValue[]) => inner.run(sql, params),
      all: <T>(sql: string, params?: readonly SqlValue[]) => inner.all<T>(sql, params),
      close: () => inner.close(),
    };

    const db = new SqliteAdapter({ schema: INDEXEDDB_SCHEMA, driverFactory: () => bridge });
    await db.init();
    await db.add(STORES.OPS, opRecord('op-1'));
    const report = await db.destroy();

    expect(report.containerRemoved, '桥没实现删除容器，报告却声称容器没了').toBe(false);
    expect(report.reason, '没有容器可删却不给原因').toBeTruthy();
    expect(report.storesCleared).toBeGreaterThanOrEqual(ALL_STORES.length);
    // 文件**确实还在** —— 报告说"没删容器"必须与磁盘一致，两个方向都不能说谎。
    expect(readdirSync(dir)).toEqual(['heyta.sqlite']);

    // 🔴 文件还在，所以**内容**必须真的被清掉了 —— 这一句是 `DROP TABLE` 那个循环
    // 唯一的牙：其余每条 destroy 判据都跑在"文件被删掉"的驱动上，
    // 而那些判据在漏删 DROP 的情况下**全绿**（重开一个新连接本来就什么都没有）。
    const survivor = new SqliteAdapter({ schema: INDEXEDDB_SCHEMA, driverFactory: () => new NodeSqliteDriver(path) });
    await survivor.init();
    for (const store of ALL_STORES) {
      expect(await survivor.count(store), `文件留着但「${store}」没清空`).toBe(0);
    }
    survivor.close();
  });
});

describe('destroy —— IndexedDB 不许伪造成功', () => {
  it('正常路径：销毁后同一个工厂上重开读到空', async () => {
    freshIdb();
    const db = new IndexedDbAdapter('heyta-e2-ok');
    await db.init();
    await db.add(STORES.OPS, opRecord('op-1'));
    const report = await db.destroy();
    expect(report.containerRemoved, JSON.stringify(report)).toBe(true);

    const again = new IndexedDbAdapter('heyta-e2-ok');
    await again.init();
    expect(await again.count(STORES.OPS)).toBe(0);
    again.close();
  });

  /**
   * 在**同一份**工厂上开第二个连接，模拟另一个标签页。
   *
   * ⚠️ 两个容易踩的地方（都是先怀疑探针）：
   *  · 必须在适配器建好库**之后**再开。先开会把库建成空的（没有 upgrade 回调建 store），
   *    于是适配器随后 open 同一版本、`onupgradeneeded` 不触发，后面每次事务都报
   *    `No objectStore named ops` —— 症状长得像产品坏了，其实是探针把库抢空了。
   *  · 不传版本号 = "按现有版本打开"，这样它不升版本、不触发 versionchange，
   *    只是单纯占着一个连接。传死版本号等于把 `DB_SCHEMA_VERSION` 抄进测试。
   */
  function openSecondConnection(name: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => reject(new Error(`不该升版本：${name}`));
    });
  }

  it('🔴 别的连接占着且不让位 ⇒ destroy **不许** resolve（onblocked 不是成功）', async () => {
    freshIdb();

    const db = new IndexedDbAdapter('heyta-e2-blocked');
    await db.init();
    await db.add(STORES.OPS, opRecord('op-1'));

    // 另一个"标签页"：直接 indexedDB.open，且**不**处理 versionchange。
    // 真实浏览器里这就是同源的另一个上下文；它一占着，deleteDatabase 只会 blocked。
    const holder = await openSecondConnection('heyta-e2-blocked');

    const promise = db.destroy();
    const destroy = track(promise);
    await drainTaskQueues();

    // 判据本体：还在飞。曾经这里是 onblocked 里 resolve()，
    // 于是这句会变成"销毁成功"，而库里那条明文一个字都没少。
    expect(destroy.done, `被堵住却返回了结果：${JSON.stringify(destroy.value)}`).toBe(false);

    // 反向确认"没删"是真没删，而不是探针看不见的假红/假绿。
    const stillThere = await new Promise<number>((resolve, reject) => {
      const tx = holder.transaction(STORES.OPS, 'readonly');
      const request = tx.objectStore(STORES.OPS).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(stillThere, '探针说没删，但库里其实空了 ⇒ 这条判据在测探针').toBe(1);

    holder.close();
    await expect(promise).resolves.toMatchObject({ containerRemoved: true });
  });

  /**
   * 🔴 这一条钉的是**我们自己**：上一条用一枚"不接 `versionchange` 的裸连接"证明
   * "不让位 ⇒ `deleteDatabase` 永久 blocked"；而注销那条路径上的活连接**就是这个类开的**
   * （`apps/web/src/lib/oplog.ts:135` 的主库、`apps/web/src/lib/vault-session.ts:69` 的
   * `heyta-vault`），销毁器开的却是**另一个实例**（`local-data-destruction.ts:262`，
   * 另有 `WEB_DATABASE_NAMES = ['heyta','heyta-vault','heyta-widget']` 那三个名字走裸 `deleteDatabase`）。
   * ⇒ 没有 `onversionchange` 那三行，Web 的"当场清掉本机明文"会**挂住不返回**，
   * 而挂住不返回在界面上长得和"正在注销"一模一样，日志里一行都不留。
   *
   * 判据不许用计时器断言（这台机器负载能到 100+）：排空固定轮数任务队列后**必须已决议**。
   */
  it('🔴 本适配器自己**不许挡住**那次删除：活连接要在 versionchange 时让位', async () => {
    freshIdb();

    // 应用那一侧：正常在用的一份连接（不是测试手写的裸 `indexedDB.open`）。
    const app = new IndexedDbAdapter('heyta-e2-yields-adapter');
    await app.init();
    await app.add(STORES.OPS, opRecord('op-1'));

    // 销毁器那一侧：真实注销就是这个形状 —— 另开一个实例去删**同一个库名**。
    const eraser = new IndexedDbAdapter('heyta-e2-yields-adapter');
    const destroy = track(eraser.destroy());
    await drainTaskQueues();

    expect(
      destroy.done,
      '应用自己的连接把 deleteDatabase 挡成了永久 blocked ⇒ 那句"当场清掉本机明文"从没返回过',
    ).toBe(true);
    expect(destroy.value?.containerRemoved, JSON.stringify(destroy.value)).toBe(true);

    // 让位之后那份连接确实不在了（下一次读会重开成空库 —— 注意这**不是**"销毁"：
    // 注销之后由宿主自己作废缓存，见计划 §10.188/§10.189，这里只钉"没把删除挡住"）。
    expect(await app.count(STORES.OPS)).toBe(0);
    app.close();
    eraser.close();
  });

  it('正向对照：占着的连接**让位**后 destroy 真的完成（证明上一条不是永远 pending）', async () => {
    freshIdb();

    const db = new IndexedDbAdapter('heyta-e2-yields');
    await db.init();
    await db.add(STORES.OPS, opRecord('op-1'));

    const holder = await openSecondConnection('heyta-e2-yields');
    // 与上一条唯一的区别就是这一行：网页正常关掉旧标签页时会走到这里。
    holder.onversionchange = () => holder.close();

    // 直接 await：它若永远不 resolve，vitest 自己的超时会把这条判据说清楚。
    // （这里不套计时器 —— 计时器在负载高时会把正向对照判成红，那正是上一条要避免的错。）
    await expect(db.destroy()).resolves.toMatchObject({ containerRemoved: true });
  });
});

describe('destroy —— 内存实现', () => {
  it('销毁即死路：报告如实写明"没有持久容器"，而这个实例从此拒绝读写', async () => {
    const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
    await db.init();
    await db.add(STORES.OPS, opRecord('op-1'));
    const report = await db.destroy();

    expect(report.target).toBe('memory');
    // 内存这一档的"销毁"没有容器可删，所以它**必须自己说清楚**，
    // 否则下游会把"清空了 Map"读成"磁盘上没了"。
    expect(report.reason).toBeTruthy();

    // 🔴 这一条改过口径：原先它断言"清空后适配器仍可用，而且自增计数器归零"，
    // 也就是把 `destroy` 当成 `clear`。那样四份实现里只有内存是"作废"的、
    // 其余三份是"能继续用"的，而共享契约无法区分 —— 于是"销毁之后一次普通读
    // 把容器建回盘"这件事在判据层面是**不可见**的（同上一条 SQLite 那段的说明）。
    // 自增计数器归零那个诉求由**新实例**满足：注销后重新注册的宿主用的就是新实例。
    await expect(db.count(STORES.OPS)).rejects.toBeInstanceOf(AdapterDestroyedError);
    await expect(db.add(STORES.OPS, opRecord('op-2'))).rejects.toBeInstanceOf(
      AdapterDestroyedError,
    );

    const fresh = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
    await fresh.init();
    expect(await fresh.count(STORES.OPS)).toBe(0);
    // 新实例的自增从 1 起：不归零的话，下一份数据接着旧 id，
    // 而"注销后重新注册"正是要走这条路。
    expect(await fresh.add(STORES.OPS, opRecord('op-2'))).toBe(1);
    fresh.close();
  });
});
