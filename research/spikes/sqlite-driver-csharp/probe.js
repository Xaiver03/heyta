/**
 * W0-2 spike：在 C# 宿主的 JS 引擎里，用**真正的 TS `SqliteAdapter`**
 * 跑在**C# 提供的同步 `SqliteDriver`** 上。
 *
 * 这就是 D2 路线的存储形态：
 *   WinUI 3 壳（C#）  →  内嵌 JS 引擎  →  TS 存储栈（同一份源码）
 *                                        ↓ 只在这一层跨语言
 *                                      C# 同步 SqliteDriver（Microsoft.Data.Sqlite）
 *
 * 🔴 测的每一条都是**驱动契约里最容易挂**的地方，而不是"能开库"：
 *    · 复合主键 store（state: ['entityType','entityId']）
 *    · 唯一索引（ops.by_opId）＋ 重复写入必须被拒
 *    · `addToleratingDuplicate` 必须把唯一冲突**吸收成 { ok:false }**，
 *      而不是让整个事务失败 —— 它依赖驱动/适配器的 `isUniqueViolation` 回退
 *    · multiEntry 索引（ops.by_entityIds）
 *    · 事务提交 与 事务回滚（回滚后值必须不存在）
 *
 * 结果全部塞进 `globalThis.__result`（JSON 字符串），由 C# 侧打印。
 * `globalThis.__done` 是给宿主看的分帧标志（见 Program.cs 的微任务泵）。
 */

globalThis.__done = false;
globalThis.__result = null;

(async () => {
  const S = HeytaStorage;
  const steps = [];
  // 🔴 `undefined` 必须显式归一化：`JSON.stringify({name, value: undefined})` 会把
  //    `value` 这个键**整个丢掉**，于是宿主侧 `GetProperty("value")` 抛
  //    KeyNotFoundException —— 而"回滚后读到 undefined"恰恰是**正确结果**，
  //    不是异常。第一次跑就是这么被自己的打印代码炸掉的。
  const record = (name, value) =>
    steps.push({ name, value: value === undefined ? '__undefined__' : value });

  // 🔴 这就是"跨语言边界"，而且只有这一层：
  //    参数与行**都过 JSON 文本**。选 JSON 而不是 CLR 对象直接编组，
  //    是为了让类型映射只有一处、可被读懂；代价是编组开销（见 README 未测项）。
  //
  //    包成函数是因为契约重放那一阶段要**为每个用例造一个新的宿主驱动**
  //    （契约要求 `create()` 返回全新且已 init 的适配器）。
  const wrapDriver = (h) => ({
    exec(sql) {
      h.exec(sql);
    },
    run(sql, params) {
      h.run(sql, JSON.stringify(params ?? []));
    },
    all(sql, params) {
      return JSON.parse(h.all(sql, JSON.stringify(params ?? [])));
    },
    close() {
      h.close();
    },
  });

  const driver = wrapDriver(host);

  const db = new S.SqliteAdapter({
    schema: S.INDEXEDDB_SCHEMA,
    driverFactory: () => driver,
  });

  await db.init();
  record('init（建 4 个 store + 索引）', 'ok');

  // ── meta：字符串主键 ─────────────────────────────────────────────
  await db.put(S.STORES.META, { key: 'probe', value: 42 });
  record('meta 往返', await db.get(S.STORES.META, 'probe'));
  record('meta count', await db.count(S.STORES.META));

  // ── state：复合主键 ['entityType','entityId'] ───────────────────
  await db.put(S.STORES.STATE, { entityType: 'task', entityId: 't1', title: 'A' });
  await db.put(S.STORES.STATE, { entityType: 'task', entityId: 't2', title: 'B' });
  record('state 复合主键 get', await db.get(S.STORES.STATE, ['task', 't1']));
  record('state getAll 条数', (await db.getAll(S.STORES.STATE)).length);

  // ── ops：自增主键 + 唯一索引 + 复合索引 + multiEntry ──────────────
  const opRecord = (id, entityIds) => ({
    op: { id, entityType: 'task', entityId: 't1', entityIds, kind: 'task.create', payload: {} },
    source: 'local',
    uploadStatus: 'pending',
    applyStatus: 'pending',
  });

  await db.add(S.STORES.OPS, opRecord('o1', ['t1', 't2']));
  await db.add(S.STORES.OPS, opRecord('o2', ['t1']));
  record('ops count', await db.count(S.STORES.OPS));
  record(
    'ops by_entity 复合索引命中数',
    (await db.getAllFromIndex(S.STORES.OPS, S.OP_INDEXES.ENTITY, ['task', 't1'])).length,
  );
  record(
    'ops by_entityIds multiEntry 命中数（t2 只在 o1 里）',
    (await db.getAllFromIndex(S.STORES.OPS, S.OP_INDEXES.ENTITY_IDS, 't2')).length,
  );
  record(
    'ops by_applyStatus 命中数',
    (await db.getAllFromIndex(S.STORES.OPS, S.OP_INDEXES.PENDING_APPLY, 'pending')).length,
  );

  // ── 唯一冲突：必须抛（这是唯一索引的意义）────────────────────────
  let uniqueThrew = false;
  let uniqueMessage = '';
  try {
    await db.add(S.STORES.OPS, opRecord('o1', ['t1']));
  } catch (error) {
    uniqueThrew = true;
    uniqueMessage = String(error && error.message ? error.message : error);
  }
  record('重复 opId 被拒', uniqueThrew);
  record('重复 opId 的错误文案', uniqueMessage);
  record('冲突后 ops count 未变', await db.count(S.STORES.OPS));

  // ── addToleratingDuplicate：冲突要被**吸收**，不能让事务炸 ────────
  const tolerated = await db.transaction([S.STORES.OPS], 'readwrite', (tx) =>
    tx.addToleratingDuplicate(S.STORES.OPS, opRecord('o1', ['t1'])),
  );
  record('addToleratingDuplicate 吸收冲突', tolerated);

  // ── 事务提交 ────────────────────────────────────────────────────
  await db.transaction([S.STORES.META], 'readwrite', (tx) =>
    tx.put(S.STORES.META, { key: 'tx', value: 'committed' }),
  );
  record('事务提交后能读到', await db.get(S.STORES.META, 'tx'));

  // ── 事务回滚 ────────────────────────────────────────────────────
  let rollbackMessage = '';
  try {
    await db.transaction([S.STORES.META], 'readwrite', async (tx) => {
      await tx.put(S.STORES.META, { key: 'rolled-back', value: 'should-not-exist' });
      throw new Error('boom');
    });
  } catch (error) {
    rollbackMessage = String(error && error.message ? error.message : error);
  }
  record('回滚：错误冒泡', rollbackMessage);
  record('回滚：值必须不存在', await db.get(S.STORES.META, 'rolled-back'));

  db.close();

  // ══════════════════════════════════════════════════════════════════
  // 第二阶段：**契约重放**
  //
  // 上面那 16 步是我**挑**的（危险项优先）。这里跑的是
  // `packages/storage/tests/contract/*.contract.ts` 的**全部断言**，
  // 一个不挑、一个字不改 —— 配合 `vitest-shim.ts` 在引擎里跑。
  //
  // 🔴 契约的价值全在"同一套断言跑遍所有实现"。C# 侧另写一套断言，
  //    测的就是实现者的假设，而不是接口本身（contract.spec.ts 文件头明令禁止）。
  // ══════════════════════════════════════════════════════════════════
  let contractCounter = 0;
  const makeContractDb = async () => {
    contractCounter += 1;
    const name = `contract-${contractCounter}`;
    // 🔴 每个用例一个**文件库**而不是 `:memory:`：契约要求 `close()` 之后能透明重开，
    //    而重开会再调一次 driverFactory。若用内存库，新连接就是**空库**，
    //    "关掉再打开数据还在"会假失败 —— 那是测试替身的问题，不是实现的问题。
    const adapter = new S.SqliteAdapter({
      schema: S.INDEXEDDB_SCHEMA,
      driverFactory: () => wrapDriver(host.newDriver(name)),
    });
    await adapter.init();
    return adapter;
  };

  S.resetResults();
  S.runDbAdapterContract({ name: 'SqliteAdapter（C# 同步驱动 + Jint）', create: makeContractDb });
  S.runOpLogStoreContract({
    name: 'DbOpLogStore（同一个 C# 驱动）',
    createDb: makeContractDb,
    create: (adapter) => new S.DbOpLogStore(adapter),
  });
  await S.settle();
  const contract = S.report();

  globalThis.__result = JSON.stringify({ ok: true, steps, contract });
  globalThis.__done = true;
})().catch((error) => {
  globalThis.__result = JSON.stringify({
    ok: false,
    error: String(error && error.message ? error.message : error),
    stack: String(error && error.stack ? error.stack : ''),
  });
  globalThis.__done = true;
});
