/**
 * `DbAdapter` 共享契约
 * ====================
 *
 * ADR-0003 §2.2 的硬要求：
 *
 * > **同一套契约测试跑遍所有实现** —— 换后端时上层一行不用改
 *
 * 🔴 **为什么必须共享，而不是每个实现各写一份测试：**
 * 只有一个实现时，"存储可替换"只是**声明**。接口上一切被 IndexedDB 的
 * 具体行为悄悄决定的东西 —— 键的比较顺序、唯一索引冲突时整条记录不入库、
 * 访问未列入事务的 store 要报错、布尔不能当键…… —— 都不会有人发现，
 * 直到移植到 SQLite 时才集中爆炸，而那时已经有真实用户数据在上面了。
 *
 * 各实现自己写的测试会**重复实现者的假设**，而假设错了测试照样绿。
 * 只有同一份测试跑在两个实现上，才能把"接口"和"某个实现的行为"分开。
 *
 * 用法：
 *
 * ```ts
 * runDbAdapterContract({
 *   name: 'MemoryDbAdapter',
 *   create: async () => new MemoryDbAdapter(INDEXEDDB_SCHEMA),
 * });
 * ```
 */

import { describe, expect, it } from 'vitest';

import type { DbAdapter } from '../../src/db.types.js';
import { AdapterDestroyedError } from '../../src/errors.js';
import { ALL_STORES, OP_FIELDS, OP_INDEXES, STORES } from '../../src/stores.js';

export interface AdapterContractOptions {
  name: string;
  /** 每次调用返回一个**全新且已 init** 的适配器。 */
  create: () => Promise<DbAdapter>;
}

/** 造一条 ops 记录，形状与 `IndexedDbOpLogStore` 实际写入的一致。 */
function opRecord(over: Record<string, unknown> = {}): Record<string, unknown> {
  const id = (over.op as Record<string, unknown> | undefined)?.id ?? `op-${Math.random().toString(36).slice(2, 10)}`;
  return {
    op: {
      id,
      entityType: 'TASK',
      entityId: 'task-1',
      payload: { title: '任务' },
      clientId: 'client-a',
      timestamp: 1_000,
      vectorClock: { 'client-a': 1 },
      ...((over.op as Record<string, unknown> | undefined) ?? {}),
    },
    source: 'local',
    applyStatus: 'applied',
    uploadStatus: 'pending',
    ...over,
  };
}

export function runDbAdapterContract({ name, create }: AdapterContractOptions): void {
  describe(`DbAdapter 契约 —— ${name}`, () => {
    const withDb = async (fn: (db: DbAdapter) => Promise<void>): Promise<void> => {
      const db = await create();
      try {
        await fn(db);
      } finally {
        db.close();
      }
    };

    // ── 生命周期 ────────────────────────────────────────────

    it('init 幂等且可并发调用', async () => {
      await withDb(async (db) => {
        await Promise.all([db.init(), db.init(), db.init()]);
      });
    });

    // ── 基础键值 ────────────────────────────────────────────

    it('add 的自增主键单调递增且无空洞', async () => {
      await withDb(async (db) => {
        const a = await db.add(STORES.OPS, opRecord());
        const b = await db.add(STORES.OPS, opRecord());
        const c = await db.add(STORES.OPS, opRecord());
        expect([a, b, c]).toEqual([1, 2, 3]);
      });
    });

    it('自增主键写回记录本身（in-line key）', async () => {
      await withDb(async (db) => {
        await db.add(STORES.OPS, opRecord());
        const rows = await db.getAll<Record<string, unknown>>(STORES.OPS);
        expect(rows[0]![OP_FIELDS.SEQ]).toBe(1);
      });
    });

    it('get / put / delete / count / clear 闭环', async () => {
      await withDb(async (db) => {
        await db.put(STORES.META, { key: 'k1', value: 'v1' });
        expect(await db.get(STORES.META, 'k1')).toEqual({ key: 'k1', value: 'v1' });
        expect(await db.count(STORES.META)).toBe(1);

        await db.put(STORES.META, { key: 'k1', value: 'v2' });
        expect(await db.get(STORES.META, 'k1')).toEqual({ key: 'k1', value: 'v2' });
        expect(await db.count(STORES.META)).toBe(1);

        await db.delete(STORES.META, 'k1');
        expect(await db.get(STORES.META, 'k1')).toBeUndefined();

        await db.put(STORES.META, { key: 'k2', value: 1 });
        await db.clear(STORES.META);
        expect(await db.count(STORES.META)).toBe(0);
      });
    });

    it('get 不存在的键返回 undefined，不抛错', async () => {
      await withDb(async (db) => {
        expect(await db.get(STORES.META, 'nope')).toBeUndefined();
      });
    });

    // ── 区间语义 ────────────────────────────────────────────

    it('getAll limit applies after the key range and is preserved inside transactions', async () => {
      await withDb(async (db) => {
        for (let i = 0; i < 8; i++) await db.add(STORES.OPS, opRecord());
        const range = { lower: 3, lowerOpen: true, upper: 8, upperOpen: true };
        expect((await db.getAll<Record<string, unknown>>(STORES.OPS, range, 2)).map((r) => r[OP_FIELDS.SEQ])).toEqual([4, 5]);
        await db.transaction([STORES.OPS], 'readonly', async (tx) => {
          expect((await tx.getAll<Record<string, unknown>>(STORES.OPS, range, 2)).map((r) => r[OP_FIELDS.SEQ])).toEqual([4, 5]);
        });
        await expect(db.getAll(STORES.OPS, undefined, 0)).rejects.toThrow();
      });
    });

    it('区间是**闭开**语义：lower 含、upperOpen 不含', async () => {
      await withDb(async (db) => {
        for (let i = 0; i < 5; i++) await db.add(STORES.OPS, opRecord());

        const all = await db.getAll<Record<string, unknown>>(STORES.OPS, { lower: 1, upper: 5, upperOpen: true });
        expect(all.map((r) => r[OP_FIELDS.SEQ])).toEqual([1, 2, 3, 4]);

        const incl = await db.getAll<Record<string, unknown>>(STORES.OPS, { lower: 1, upper: 5 });
        expect(incl.map((r) => r[OP_FIELDS.SEQ])).toEqual([1, 2, 3, 4, 5]);

        const open = await db.getAll<Record<string, unknown>>(STORES.OPS, { lower: 1, lowerOpen: true, upper: 4 });
        expect(open.map((r) => r[OP_FIELDS.SEQ])).toEqual([2, 3, 4]);

        // 只有下界 / 只有上界
        const lowerOnly = await db.getAll<Record<string, unknown>>(STORES.OPS, { lower: 3 });
        expect(lowerOnly.map((r) => r[OP_FIELDS.SEQ])).toEqual([3, 4, 5]);
        const upperOnly = await db.getAll<Record<string, unknown>>(STORES.OPS, { upper: 3, upperOpen: true });
        expect(upperOnly.map((r) => r[OP_FIELDS.SEQ])).toEqual([1, 2]);
      });
    });

    it('getAll 按主键升序返回（不是插入顺序）', async () => {
      await withDb(async (db) => {
        await db.put(STORES.META, { key: 'c', value: 3 });
        await db.put(STORES.META, { key: 'a', value: 1 });
        await db.put(STORES.META, { key: 'b', value: 2 });
        const rows = await db.getAll<{ key: string }>(STORES.META);
        expect(rows.map((r) => r.key)).toEqual(['a', 'b', 'c']);
      });
    });

    // ── 索引 ───────────────────────────────────────────────

    it('🔴 唯一索引冲突时**整条记录都不入库**', async () => {
      await withDb(async (db) => {
        const rec = opRecord({ op: { id: 'dup' } });
        await db.add(STORES.OPS, rec);

        await expect(db.add(STORES.OPS, opRecord({ op: { id: 'dup' } }))).rejects.toThrow();

        // 去重靠的就是这一条：`addToleratingDuplicate` 假设失败的写入不留痕迹
        expect(await db.count(STORES.OPS)).toBe(1);
      });
    });

    it('复合索引能按 [entityType, entityId] 精确命中', async () => {
      await withDb(async (db) => {
        await db.add(STORES.OPS, opRecord({ op: { entityType: 'TASK', entityId: 'a' } }));
        await db.add(STORES.OPS, opRecord({ op: { entityType: 'TASK', entityId: 'b' } }));
        await db.add(STORES.OPS, opRecord({ op: { entityType: 'NOTE', entityId: 'a' } }));

        const hit = await db.getAllFromIndex<Record<string, unknown>>(STORES.OPS, OP_INDEXES.ENTITY, [
          'TASK',
          'a',
        ]);
        expect(hit).toHaveLength(1);
        expect((hit[0]!.op as Record<string, unknown>)['entityId']).toBe('a');
      });
    });

    it('🔴 嵌套 keyPath（`op.id`）的索引真的能命中', async () => {
      await withDb(async (db) => {
        await db.add(STORES.OPS, opRecord({ op: { id: 'nested-1' } }));

        // keyPath 写成顶层 `id` 时，索引恒不命中**且不报错** ——
        // 这是曾经真实发生过的 bug，必须由契约锁住。
        const found = await db.getFromIndex<Record<string, unknown>>(STORES.OPS, OP_INDEXES.OP_ID, 'nested-1');
        expect(found).toBeDefined();

        const key = await db.getKeyFromIndex(STORES.OPS, OP_INDEXES.OP_ID, 'nested-1');
        expect(key).toBe(1);

        expect(await db.getFromIndex(STORES.OPS, OP_INDEXES.OP_ID, 'missing')).toBeUndefined();
      });
    });

    it('标量索引查询是精确匹配，不是前缀匹配', async () => {
      await withDb(async (db) => {
        await db.add(STORES.OPS, opRecord({ uploadStatus: 'pending' }));
        await db.add(STORES.OPS, opRecord({ uploadStatus: 'uploaded' }));
        await db.add(STORES.OPS, opRecord({ uploadStatus: 'pending' }));

        // 标量必须被当作精确键处理。若实现把它误当区间或全表，这里会返回 3 条。
        const pending = await db.getAllFromIndex<Record<string, unknown>>(
          STORES.OPS,
          OP_INDEXES.PENDING_UPLOAD,
          'pending',
        );
        expect(pending).toHaveLength(2);
        expect(await db.countFromIndex(STORES.OPS, OP_INDEXES.PENDING_UPLOAD, 'pending')).toBe(2);
      });
    });

    it('multiEntry 索引按数组元素展开，且同一记录只出现一次', async () => {
      await withDb(async (db) => {
        await db.add(STORES.OPS, opRecord({ op: { id: 'm1', entityIds: ['x', 'y'] } }));
        await db.add(STORES.OPS, opRecord({ op: { id: 'm2', entityIds: ['y', 'z'] } }));

        const yHits = await db.getAllFromIndex<Record<string, unknown>>(
          STORES.OPS,
          OP_INDEXES.ENTITY_IDS,
          'y',
        );
        expect(yHits).toHaveLength(2);

        const xHits = await db.getAllFromIndex<Record<string, unknown>>(
          STORES.OPS,
          OP_INDEXES.ENTITY_IDS,
          'x',
        );
        expect(xHits).toHaveLength(1);
        // 一条记录命中多个元素时，不能重复出现
        expect(await db.countFromIndex(STORES.OPS, OP_INDEXES.ENTITY_IDS, 'y')).toBe(2);
      });
    });

    it('索引区间查询', async () => {
      await withDb(async (db) => {
        for (let i = 1; i <= 5; i++) {
          await db.add(STORES.OPS, opRecord({ op: { timestamp: i } }));
        }
        const rows = await db.getAllFromIndex<Record<string, unknown>>(
          STORES.OPS,
          OP_INDEXES.PENDING_UPLOAD,
          { lower: 'pending' },
        );
        // 全部都是 pending，区间覆盖全部
        expect(rows).toHaveLength(5);
      });
    });

    it('复合主键的 store（state）能按数组键存取', async () => {
      await withDb(async (db) => {
        await db.put(STORES.STATE, { entityType: 'TASK', entityId: 't1', data: { title: 'A' } });
        await db.put(STORES.STATE, { entityType: 'TASK', entityId: 't2', data: { title: 'B' } });

        const one = await db.get<{ data: { title: string } }>(STORES.STATE, ['TASK', 't1'] as never);
        expect(one?.data.title).toBe('A');
        expect(await db.count(STORES.STATE)).toBe(2);
      });
    });

    // ── 游标 ───────────────────────────────────────────────

    it('游标 limit 生效', async () => {
      await withDb(async (db) => {
        for (let i = 0; i < 5; i++) await db.add(STORES.OPS, opRecord());

        const seen: number[] = [];
        await db.iterate<Record<string, unknown>>(STORES.OPS, { limit: 2 }, (_v, key) => {
          seen.push(key as number);
          return 'continue';
        });
        expect(seen).toEqual([1, 2]);
      });
    });

    it('游标 limit 非法时立刻抛错（防止扫全表把移动端卡死）', async () => {
      await withDb(async (db) => {
        await expect(
          db.iterate(STORES.OPS, { limit: 0 }, () => 'continue'),
        ).rejects.toThrow();
        await expect(
          db.iterate(STORES.OPS, { limit: -1 }, () => 'continue'),
        ).rejects.toThrow();
      });
    });

    it("游标 'stop' 不删任何东西", async () => {
      await withDb(async (db) => {
        for (let i = 0; i < 3; i++) await db.add(STORES.OPS, opRecord());

        await db.iterate(STORES.OPS, {}, () => 'stop');
        expect(await db.count(STORES.OPS)).toBe(3);
      });
    });

    it("游标 'delete' 边删边继续，'delete-stop' 删完当前条就停", async () => {
      await withDb(async (db) => {
        for (let i = 0; i < 4; i++) await db.add(STORES.OPS, opRecord());

        await db.iterate(STORES.OPS, {}, () => 'delete-stop');
        expect(await db.count(STORES.OPS)).toBe(3);

        await db.iterate(STORES.OPS, {}, () => 'delete');
        expect(await db.count(STORES.OPS)).toBe(0);
      });
    });

    it('游标 prev 方向可用', async () => {
      await withDb(async (db) => {
        for (let i = 0; i < 3; i++) await db.add(STORES.OPS, opRecord());

        const seen: number[] = [];
        await db.iterate<Record<string, unknown>>(STORES.OPS, { direction: 'prev', limit: 2 }, (_v, key) => {
          seen.push(key as number);
          return 'continue';
        });
        expect(seen).toEqual([3, 2]);
      });
    });

    // ── 事务 ───────────────────────────────────────────────

    it('事务提交后才决议，且数据全部落盘', async () => {
      await withDb(async (db) => {
        await db.transaction([STORES.META], 'readwrite', async (tx) => {
          await tx.put(STORES.META, { key: 'a', value: 1 });
          await tx.put(STORES.META, { key: 'b', value: 2 });
        });
        expect(await db.count(STORES.META)).toBe(2);
      });
    });

    it('🔴 事务里抛错 → **整体回滚**，不留半截数据', async () => {
      await withDb(async (db) => {
        await db.put(STORES.META, { key: 'preexisting', value: 1 });

        await expect(
          db.transaction([STORES.META], 'readwrite', async (tx) => {
            await tx.put(STORES.META, { key: 'a', value: 1 });
            await tx.put(STORES.META, { key: 'preexisting', value: 999 });
            throw new Error('故意失败');
          }),
        ).rejects.toThrow('故意失败');

        // ① 事务里新写的不能留下
        expect(await db.get(STORES.META, 'a')).toBeUndefined();
        // ② 事务里**改动的已有记录**也必须回滚 —— 只回滚新增是个常见半成品
        expect(await db.get(STORES.META, 'preexisting')).toEqual({ key: 'preexisting', value: 1 });
      });
    });

    it('访问未列入事务的 store 会明确报错，而不是静默放行', async () => {
      await withDb(async (db) => {
        await expect(
          db.transaction([STORES.META], 'readwrite', async (tx) => tx.get(STORES.OPS, 1)),
        ).rejects.toThrow();
      });
    });

    it('并发事务都能正确落盘（不互相覆盖）', async () => {
      await withDb(async (db) => {
        await Promise.all(
          Array.from({ length: 10 }, (_v, i) =>
            db.transaction([STORES.META], 'readwrite', async (tx) =>
              tx.put(STORES.META, { key: `k${i}`, value: i }),
            ),
          ),
        );
        expect(await db.count(STORES.META)).toBe(10);
      });
    });

    it('事务里用索引查询（同一事务内可见自己刚写的）', async () => {
      await withDb(async (db) => {
        const seq = await db.transaction([STORES.OPS], 'readwrite', async (tx) => {
          const s = await tx.add(STORES.OPS, opRecord({ op: { id: 'tx-1' } }));
          const found = await tx.getFromIndex(STORES.OPS, OP_INDEXES.OP_ID, 'tx-1');
          expect(found).toBeDefined();
          return s;
        });
        expect(seq).toBe(1);
      });
    });

    // ── 销毁（批次 E2）───────────────────────────────────────
    /**
     * 🔴 这四条钉的是「注销账号 = 这台设备上的我没了」这句话里**存储层能负责的那一段**。
     *
     * 之所以放在共享契约里而不是各实现自己测：这一条的失败方式是
     * **"某个宿主/某个实现忘了"**，而忘了不会报错 —— 只会继续留着明文。
     * 只有一份跑遍所有实现的判据才能让"漏了一个实现"这件事变红。
     */
    it('destroy 要么删掉持久容器，要么**说清为什么没删**（不许静默）', async () => {
      const db = await create();
      await db.add(STORES.META, { key: 'k', value: 1 });
      const report = await db.destroy();
      db.close();

      expect(report.target, '报告必须说清销毁的是哪一个库').not.toBe('');
      // 这条析取式就是 `DbDestroyReport` 存在的全部理由：
      // "没删容器"必须**带原因**，否则它与"删了"在下游长得一模一样。
      if (!report.containerRemoved) {
        expect(typeof report.reason, `容器没删掉却没给原因：${JSON.stringify(report)}`).toBe(
          'string',
        );
        expect(report.reason, '原因不能是空串').not.toBe('');
      }
    });

    /**
     * 🔴 这一条腿**原来**写的是"destroy 之后每个 store 都是空的"，而它在每一套实现上
     * 都不可能失败：契约的 `create()` 每次都换一份**新**存储（`freshIndexedDb`、
     * `:memory:`），于是"读到 0 条"是新存储的性质，与被销毁的那个实例**无关**
     * （`tests/destroy.spec.ts` 的注释早就写明这件事）。
     *
     * 更糟的是它把唯一真正要防的行为当成了合规通过：销毁后**继续用同一个实例**去读
     * 会走"透明重开"那条路，把刚删掉的容器重新建成一张空壳 —— 报告说"销毁成功"，
     * 盘上多出一张库，读出来确实 0 条，于是链上没有任何一层觉得自己错了（计划 §10.146：
     * iOS 设备级那枚 73728 字节 / 6 张空表的残留，字节数与这条共享层路径逐字相同）。
     *
     * 现在这一条钉的是接口真正的承诺：**销毁即死路**。要重新用必须换新实例。
     * 「读回空」那一半不在这里证明 —— 它只在**真的持久**的实现上才是问题，
     * 落点是 `tests/destroy.spec.ts` 里那些临时文件用例。
     */
    // 🔴 共享契约只能用**四个消费者都实现**的匹配子。vitest 的 `expect` 是超集，而
    // `research/spikes/sqlite-driver-csharp/entry.ts` 那份替身只有 `toBe` / `toEqual` / `toThrow`：
    // 这一枚腿原先写成 `rejects` + 实例判据，vitest 全绿、跨语言重放当场报那枚匹配子不存在（计划 §10.198）。
    // 取错误对象的 `name` 与类比身份，跨 realm（Jint 里的类不是宿主那个类）反而更准。
    const rejectionName = async (run: Promise<unknown>): Promise<string> =>
      await run.then(
        () => '(没有抛错)',
        (error: unknown) => (error as Error).name,
      );

    it('destroy 之后这个实例是**死路**：普通读写必须抛，不许静默重建容器', async () => {
      const db = await create();
      await db.add(STORES.OPS, opRecord());
      await db.add(STORES.META, { key: 'k', value: 1 });
      await db.destroy();

      for (const store of ALL_STORES) {
        expect(
          await rejectionName(db.count(store)),
          `销毁后「${store}」竟然还答应读 —— 它会顺手把容器建回来`,
        ).toBe(AdapterDestroyedError.name);
      }
      expect(await rejectionName(db.add(STORES.OPS, opRecord())), '销毁后竟然还答应写').toBe(
        AdapterDestroyedError.name,
      );
      expect(await rejectionName(db.init()), '销毁后竟然还答应重开').toBe(AdapterDestroyedError.name);
      db.close();
    });

    it('destroy 的 storesCleared 不少于 schema 里的 store 数（漏表会被数出来）', async () => {
      const db = await create();
      const report = await db.destroy();
      expect(
        report.storesCleared,
        `只清了 ${String(report.storesCleared)} 个，schema 里有 ${String(ALL_STORES.length)} 个`,
      ).toBeGreaterThanOrEqual(ALL_STORES.length);
      db.close();
    });

    it('destroy 幂等：销毁一份已经没了的库不是错误', async () => {
      const db = await create();
      await db.destroy();
      await expect(db.destroy()).resolves.toMatchObject({ storesCleared: expect.any(Number) });
      db.close();
    });
  });
}
