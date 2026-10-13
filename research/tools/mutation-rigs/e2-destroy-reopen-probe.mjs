// #87 的判据装置：`destroy()` 之后一次**普通读**会不会把空壳建回来。
//
// 为什么需要它：iOS 设备级那一趟（计划 §10.147）量到"注销后 5 秒 heyta.sqlite 又以 6 张空表回来"，
// 第一归因几乎必然指向 iOS 原生桥 —— 那是最贵的一种错，因为设备一趟 8 分钟还要抢模拟器窗口。
// 这条装置不开设备、不起模拟器，3 秒给出同一件事的读数；它的字节数（73728）与设备级那枚残留
// **逐字相同**，所以归因从"平台"改成"共享层"是靠这条量出来的。
//
// 🔴 它**不改工作树里的任何文件**：只在临时目录里造一份真库。
// 载具全部来自 `packages/storage/dist`（与生产同一份实现），不复制适配器逻辑。
//
// 用法：node research/tools/mutation-rigs/e2-destroy-reopen-probe.mjs
// 退出码：0 = 销毁之后盘上确实没有残留（判据成立）；1 = 被重建（当前 HEAD 就是这个形状）。
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ROOT 从**本文件自己的位置**推导，不写死某台机器的检出路径。
const ROOT = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');

const { SqliteAdapter, INDEXEDDB_SCHEMA } = await import(`${ROOT}/packages/storage/dist/index.js`);
const { NodeSqliteDriver } = await import(
  `${ROOT}/packages/storage/dist/sqlite/node-sqlite-driver.js`
);

const NEEDLE = '写进磁盘的明文标题-8f21c';
const dir = mkdtempSync(join(tmpdir(), 'heyta-reopen-'));
const path = join(dir, 'heyta.sqlite');

const listing = () => readdirSync(dir).filter((f) => f.startsWith('heyta.sqlite')).sort().join(',') || '（无）';
const bytesOf = () => (existsSync(path) ? readFileSync(path) : null);
const hasNeedle = (buf) => (buf ? buf.includes(Buffer.from(NEEDLE, 'utf8')) : 'n/a');
// 不依赖 SQL 连接：表名就躺在 sqlite_master 的页里，按可读串扫一遍足够定性。
const tablesOf = (buf) =>
  !buf
    ? 'n/a'
    : `${['ops', 'ops__mt3', 'state', 'meta', 'archive', '__heyta_seq'].filter((t) =>
        buf.toString('latin1').includes(t),
      ).length} 枚`;

// ops 的 keyPath 是**顶层** `seq`（INDEXEDDB_SCHEMA 现量），业务字段嵌在 `op.*` 下。
const OP = {
  seq: 1,
  op: {
    id: 'op-1',
    entityType: 'TASK',
    entityId: 'task-1',
    payload: { title: NEEDLE },
    clientId: 'client-a',
    timestamp: 1000,
    vectorClock: { 'client-a': 1 },
  },
  source: 'local',
  applyStatus: 'applied',
  uploadStatus: 'pending',
};

const adapter = new SqliteAdapter({
  schema: INDEXEDDB_SCHEMA,
  driverFactory: () => new NodeSqliteDriver(path),
});

await adapter.init();
await adapter.put('ops', OP);
const before = bytesOf();
console.log(
  `A 写入后      文件=${listing()} 字节=${before?.length} ops=${await adapter.count('ops')} ` +
    `明文=${hasNeedle(before)}（这一腿是**前提证明**：没写进去就别想证明删掉了）`,
);

const report = await adapter.destroy();
// 🔴 必须在**下一次读之前**量"文件没了"：`containerGone` 如果晚一步算，重建出来的那个文件
//    会让它变成 false，于是这台装置会把"销毁成功 + 随后被重建"误报成"销毁没删掉"（实测踩过）。
const goneRightAfterDestroy = !existsSync(path);
console.log(
  `B destroy()   containerRemoved=${report.containerRemoved} storesCleared=${report.storesCleared ?? '未报'} ` +
    `→ 文件=${listing()}`,
);

// ── 关键一问：销毁之后，一次普通的**读**（不是写、不是重启）会不会把 schema 建回来 ──
// ⚠️ `PROBE_SKIP_READ=1` 只用来**验这台装置自己能报绿**（否则"恒红"和"真缺陷"在它身上长得一样），
//    它不是产品判据的档位 —— 跳过那一发读，等于没问那个问题。
let readErr = '';
let ops = 'n/a';
if (process.env.PROBE_SKIP_READ === '1') {
  readErr = '（本趟按 PROBE_SKIP_READ=1 跳过了那一发读）';
} else {
  try {
    ops = String(await adapter.count('ops'));
  } catch (error) {
    readErr = error instanceof Error ? error.message : String(error);
  }
}
const after = bytesOf();
console.log(
  `C 一次普通读  → 文件=${listing()} 字节=${after?.length ?? 0} ops=${ops} ` +
    `schema=${tablesOf(after)} 明文=${hasNeedle(after)}${readErr ? ` 抛错=${readErr}` : ''}`,
);

// 前提腿：A 那一发没真写进去时，C 的"没有残留"就是空的，必须响亮失败而不是判绿。
const premiseHeld = hasNeedle(before) === true && (before?.length ?? 0) > 0;
const containerGone = report.containerRemoved === true && goneRightAfterDestroy;
const reopened = existsSync(path);

console.log('');
if (!premiseHeld) {
  console.log('PROBE=PREMISE-FAIL（A 那一发没把明文写进盘上 ⇒ C 无意义，别读成"销毁成功"）');
} else if (!containerGone) {
  console.log('PROBE=DESTROY-FAIL（destroy 报了 containerRemoved 但盘上还在 ⇒ 报告在说谎，先看那一头）');
} else if (reopened) {
  console.log(
    `PROBE=REOPENED（销毁后一次普通读把 ${after?.length} 字节 / ${tablesOf(after)} 的空壳建了回来）`,
  );
} else {
  console.log(
    process.env.PROBE_SKIP_READ === '1'
      ? 'PROBE=clean（本趟**跳过了那一发读** ⇒ 它只证明这台装置会报绿，不构成产品结论）'
      : 'PROBE=clean（销毁之后一次普通读不再留下任何文件 —— §10.2 的文件级承诺成立）',
  );
}
console.log(
  `   边界：明文是否回来=${hasNeedle(after)}（false 意味着这枚红**不是**明文泄漏，而是"残留 0 枚"那句承诺）`,
);

rmSync(dir, { recursive: true, force: true });
const failed = !premiseHeld || !containerGone || reopened;
process.exit(failed ? 1 : 0);
