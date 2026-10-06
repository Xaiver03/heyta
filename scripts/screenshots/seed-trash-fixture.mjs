#!/usr/bin/env node
/**
 * 帮助中心回收站配图（W07）的 seed 产物生成器
 * ==========================================
 *
 * 产出的是一份**由真宿主写出来的**导出文档（含墓碑 + 完整 op-log），
 * 给截图流水线当 seed 用：浏览器那侧走应用自己的"从备份还原"通道把它读进空库，
 * 于是回收站里四类各有一行。
 *
 * 🔴 为什么必须经由 CLI 而不是直接写 JSON（§10.222 末段那条警告）：
 * 手写的"含四类墓碑的 JSON"证明的是 `import` 能吞任意字节，**不是**回收站能列出四类。
 * 这里每一条 op 都是 `@heyta/app-host` 的动作写进真 SQLite、再由导出层读回来的。
 *
 * 🔴 判据是**存在性**（每一类都得有 deleted ≥ 1），不是"总数对不对"：
 * W5 那条教训的另一半 —— 断言只会验写了什么，不会验少了什么。
 *
 * 用法：
 *   node scripts/screenshots/seed-trash-fixture.mjs [--out <路径>] [--skip <TASK|NOTE|PROJECT|HABIT>]
 * `--skip` 只给自检用（少删一类 ⇒ 判据必须转红），别拿它产正式产物。
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const CLI = join(ROOT, 'apps', 'node-host', 'dist', 'cli.js');

/** 回收站那四路（`toTrashItems` 的同源词表），每路一句中文标题。 */
const KINDS = [
  // 🔴 任务是**顶层动词**（`add` / `remove`），另外三类是 `<名词> <动词>`。
  // 这里曾经把任务也写成 `(a) => ['add', ...a]`，于是建任务变成 `add add 写周报`、
  // 删任务变成 `add remove <id>`：任务一条都没删掉，而判据报的是 `TASK(0)`。
  { type: 'TASK', cmd: (a) => a, title: '写周报' },
  { type: 'NOTE', cmd: (a) => ['notes', ...a], title: '门口便利店要换招牌' },
  { type: 'PROJECT', cmd: (a) => ['projects', ...a], title: '年度体检' },
  { type: 'HABIT', cmd: (a) => ['habits', ...a], title: '每天阅读 20 分钟' },
];

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const outPath = resolve(arg('--out', join(HERE, 'fixtures', 'trash-four-kinds.json')));
const skip = arg('--skip', '');

function cli(db, argv) {
  const run = spawnSync(process.execPath, [CLI, '--db', db, ...argv], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  if (run.status !== 0) {
    throw new Error(`CLI ${argv.join(' ')} 退 ${run.status}：${(run.stderr || run.stdout).trim()}`);
  }
  return run.stdout;
}

if (!KINDS.some((k) => k.type === skip) && skip !== '') {
  throw new Error(`--skip 只认 ${KINDS.map((k) => k.type).join(' / ')}，给的是 ${skip}`);
}

const dir = mkdtempSync(join(tmpdir(), 'heyta-seed-trash-'));
const db = join(dir, 'heyta.sqlite');
try {
  for (const kind of KINDS) {
    const added = JSON.parse(cli(db, [...kind.cmd(['add', kind.title]), '--json']));
    if (kind.type === skip) continue;
    cli(db, [...kind.cmd(['remove', added.id]), '--json']);
  }
  mkdirSync(dirname(outPath), { recursive: true });
  cli(db, ['export', '--out', outPath, '--json']);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const doc = JSON.parse(readFileSync(outPath, 'utf8'));
const counts = doc.counts?.entities ?? {};
// 存在性 + "建了几条就删了几条"：后者挡的是**混进多余行**那一类（比如命令前缀写错，
// 于是 `add add 写周报` 建出一条叫 "add" 的任务、`add remove <id>` 又建一条叫 "remove" 的），
// 那种产物在界面上照样能画出四类行，只是每一类旁边多了一行垃圾。
// 判据的分母**永远是四类**：`--skip` 只决定"这一类删不删"，不决定"要不要检查它"。
// （早先这里写成 `KINDS.filter((k) => k.type !== skip)`，于是 `--skip HABIT` 自己报 SEED=OK ——
//  一个会把故障从分母里摘掉的自检等于没有自检。）
const bad = KINDS.flatMap((k) => {
  const c = counts[k.type] ?? {};
  const reasons = [];
  if ((c.deleted ?? 0) < 1) reasons.push('一条都没删掉');
  else if ((c.total ?? 0) !== (c.deleted ?? 0)) reasons.push(`建 ${c.total} 条却只删了 ${c.deleted} 条`);
  return reasons.map((reason) => `${k.type}：${reason}`);
});

if (!Array.isArray(doc.opLog) || doc.opLog.length === 0) {
  console.error('SEED=FAIL 导出里没有 op-log ⇒ 这份产物不是任何宿主写出来的');
  process.exit(1);
}
if (bad.length > 0) {
  console.error(
    `SEED=FAIL ${bad.join('；')}\n  读数：${KINDS.map(
      (k) => `${k.type} ${counts[k.type]?.total ?? 0}/${counts[k.type]?.deleted ?? 0}`,
    ).join(' ')}`,
  );
  process.exit(1);
}

console.log(
  `SEED=OK 已写 ${outPath.replace(`${ROOT}/`, '')} —— ` +
    KINDS.map((k) => `${k.type} 删 ${counts[k.type].deleted} 条`).join('，') +
    `，opLog ${doc.opLog.length} 条`,
);
