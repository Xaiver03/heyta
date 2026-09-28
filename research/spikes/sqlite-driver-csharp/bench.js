/**
 * 跨语言编组开销基准（D2 路线**唯一还没答**的问题）。
 *
 * 问的是：`SqliteDriver` 每次调用都跨一次 C# ↔ JS 边界，**够快吗**？
 *
 *   · `probe.js` / 契约重放证明了**对不对**；
 *   · 这里证明**快不快** —— 如果 JSON 桥太慢，整条 D2 存储设计就得换。
 *
 * ## 比什么
 *
 * 同一个查询，两条返回路径：
 *
 *   A. **JSON 桥**（当前实现）：C# 把行序列化成 JSON 文本，JS 侧 `JSON.parse`
 *   B. **直接编组**：C# 返回 CLR 对象数组，交给 Jint 的 interop 去包
 *
 * 而且每种都测**两个消费层次**，否则对 B 不公平：
 *
 *   ① 只取 `rows.length` —— 测"过桥本身"
 *   ② 遍历并把某个数值列加起来 —— 测"真的把每一列都读出来"
 *
 * 只测 ① 的话，B 的**逐属性 interop 开销**会藏在 ② 里不被计入，
 * 于是结论会偏向"直接编组更快"。这个偏差必须显式消掉。
 *
 * ## 怎么读
 *
 * 报告里给的是 **每次调用的微秒数**与**行的吞吐**。
 * 关键不是"哪个数大"，而是：**在最坏的行数下，UI 的一帧（16.7ms）里能做几次这样的调用**。
 */

globalThis.__benchDone = false;
globalThis.__bench = null;

// 🔴 必须是 **async** IIFE：末尾挂了 `.catch()` 兜底。
//    第一版写成同步 IIFE，跑起来是 `Cannot read property 'catch' of undefined` ——
//    而且报错点指向文件最后一行，离真正的原因（第 33 行的箭头函数不是 async）很远。
(async () => {
  // 🔴 用**自己的**驱动，不碰根 `host`：`probe.js` 结束时会 `db.close()`，
  //    那会把根连接关掉（它是适配器的 driverFactory 拿到的那个）。
  //    基准要的是一张干净的、独占的表。
  const H = host.newDriver('bench');
  // 计时仍用根 host 的时钟 —— 它是静态 Stopwatch，与连接是否打开无关。
  const nowMicros = () => host.nowMicros();
  const rows = [];

  /** JSON 桥：与 probe.js 里那一层**逐字相同**。 */
  const allJson = (sql, params) => JSON.parse(H.all(sql, JSON.stringify(params ?? [])));
  /** 直接编组：CLR 对象数组，靠 Jint interop 包成 JS 上的东西。 */
  const allDirect = (sql, params) => H.allDirect(sql, JSON.stringify(params ?? []));

  H.exec('DROP TABLE IF EXISTS bench');
  H.exec(
    'CREATE TABLE bench (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, payload TEXT, score REAL, flag INTEGER)',
  );

  const fill = (count) => {
    H.exec('BEGIN');
    for (let i = 0; i < count; i++) {
      H.run(
        'INSERT INTO bench (name, payload, score, flag) VALUES (?, ?, ?, ?)',
        JSON.stringify([`name-${i}`, 'x'.repeat(64), i * 1.5, i % 2]),
      );
    }
    H.exec('COMMIT');
  };

  /**
   * 跑一个用例：先热身，再计时。
   * 迭代次数随行数反比，让每档的总工作量大致相当。
   *
   * 🔴 **失败要记成数据，不能让整个基准死掉。**
   *    第一次跑的时候，"直接编组"那条路把 Jint 的 512MB 内存上限撑爆了
   *    （`MemoryLimitExceededException`），于是**后面所有档都没测到** ——
   *    报告变成一片空白，而"测不出来"本身恰恰是结论。
   */
  const measure = (label, fn, iterations) => {
    try {
      const warmup = Math.max(1, Math.floor(iterations / 5));
      for (let i = 0; i < warmup; i++) fn();
      const started = nowMicros();
      for (let i = 0; i < iterations; i++) fn();
      const elapsed = nowMicros() - started;
      const perCallUs = elapsed / iterations;
      rows.push({
        label,
        iterations,
        perCallUs: Math.round(perCallUs * 100) / 100,
        totalMs: Math.round(elapsed / 10) / 100,
      });
      return perCallUs;
    } catch (error) {
      rows.push({
        label,
        iterations,
        perCallUs: null,
        totalMs: null,
        error: String(error && error.message ? error.message : error).slice(0, 120),
      });
      return null;
    }
  };

  const COUNTS = [1, 10, 100, 1000, 2000];
  let inserted = 0;

  for (const count of COUNTS) {
    fill(count - inserted);
    inserted = count;

    // 迭代次数：小结果集多跑几次，大结果集少跑几次，让每档的总行量大致相当。
    const iterations = Math.max(3, Math.min(300, Math.round(6000 / Math.max(1, count))));

    // 🔴 归因基线：只做 C# 那一侧（读行 + 序列化），**不过桥、不 parse**。
    //    它和"JSON 桥 · 只过桥"的差值，就是"字符串过桥 + JS 侧 JSON.parse"的代价。
    measure(
      `基线 · 仅 C# 侧读行+序列化（不过桥）· ${count} 行`,
      () => H.allJsonLength('SELECT * FROM bench', '[]'),
      iterations,
    );
    measure(`JSON 桥 · ${count} 行 · 只过桥`, () => allJson('SELECT * FROM bench').length, iterations);
    measure(
      `JSON 桥 · ${count} 行 · 读满列`,
      () => {
        const result = allJson('SELECT * FROM bench');
        let sum = 0;
        for (let i = 0; i < result.length; i++) sum += result[i].score;
        return sum;
      },
      iterations,
    );
    measure(`直接编组 · ${count} 行 · 只过桥`, () => allDirect('SELECT * FROM bench').length, iterations);
    measure(
      `直接编组 · ${count} 行 · 读满列`,
      () => {
        const result = allDirect('SELECT * FROM bench');
        let sum = 0;
        for (let i = 0; i < result.length; i++) sum += result[i]['score'];
        return sum;
      },
      iterations,
    );
  }

  // 固定开销：没有行要编组时，一次调用本身有多贵（含 SQL 解释 + 过桥）。
  measure('固定开销 · SELECT COUNT(*)', () => H.all('SELECT COUNT(*) AS n FROM bench', '[]'), 2000);
  // 写路径：只有 4 个参数要过去，返回路径空。
  measure(
    '写路径 · INSERT 一行',
    () => H.run('INSERT INTO bench (name, payload, score, flag) VALUES (?, ?, ?, ?)', JSON.stringify(['w', 'x', 1, 0])),
    2000,
  );

  globalThis.__bench = JSON.stringify({
    ok: true,
    counts: COUNTS,
    rows,
  });
  globalThis.__benchDone = true;
})().catch((error) => {
  globalThis.__bench = JSON.stringify({
    ok: false,
    error: String(error && error.message ? error.message : error),
    stack: String(error && error.stack ? error.stack : ''),
  });
  globalThis.__benchDone = true;
});
