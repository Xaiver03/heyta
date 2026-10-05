#!/usr/bin/env node
/**
 * 证据图守卫（工单 #40 的落地件）：**只还原"这一趟自己重写的"那几枚**。
 *
 * 背景不是整洁问题，是归属问题：`e2e/tests/*.spec.ts` 里的用例把截图**原地**写进
 * `apps/web/evidence/<族>/`，所以任何一次重跑都会把别人（或上一趟的我）"人看过"的那版字节换掉。
 * 项目记忆里那条"证据 md5 会被别人的 e2e 趟重写而无人报红"讲的是同一件事的另一侧。
 *
 * 🔴 为什么不选"给每枚图配 md5 清单，不一致就判红"：
 *   界面里有相对日期文案（`今天`、`N 天前`），同一份代码隔一天重打像素必然变 ⇒
 *   那条对账要么恒红，要么被迫按天刷新清单（那就成了第二份抄件）。所以这些图的本性是**趟产物**。
 *
 * 🔴 为什么不能一上来就 `git restore -- apps/web/evidence`（整目录）：
 *   那会把"跑之前就已经脏着"的图（别人正想留下的、或我上一趟手动改的）**一起抹掉**，
 *   而输出只说"还原了 N 枚"。所以判据是**两条集合的差**：
 *     snapshot 时就脏 → 一律不动，并逐枚列出；
 *     snapshot 时干净、之后字节变了 → 才是这一趟写的，逐枚**点名**还原。
 *   新增的未跟踪文件同样不动（那是新证据，不是被覆盖的证据）。
 *
 * 跑法：
 *   node scripts/verify-detail-pane-evidence-guard.mjs --snapshot /tmp/x.json
 *   node scripts/verify-detail-pane-evidence-guard.mjs --reconcile /tmp/x.json [--keep]
 * 退出码：0 = 判完（含"没东西可还原"）；1 = 还原动作本身失败；2 = 探针不可用（快照读不到/没给模式）。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const DIR = 'apps/web/evidence';
const argv = process.argv.slice(2);
const mode = argv.includes('--snapshot') ? 'snapshot' : argv.includes('--reconcile') ? 'reconcile' : '';
const file = argv[argv.includes('--snapshot') ? argv.indexOf('--snapshot') + 1 : argv.indexOf('--reconcile') + 1];
const keep = argv.includes('--keep');
if (!mode || !file) {
  console.log('VERDICT=PROBE_BROKEN 用法：--snapshot <json> 或 --reconcile <json> [--keep]');
  process.exit(2);
}

/** 受版本控制的图（跟着 HEAD 走，不含未跟踪的）。 */
const tracked = () =>
  execFileSync('git', ['ls-files', '-z', '--', DIR], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);

/** 工作树里此刻真实存在的图（含未跟踪 —— 用来认"新长出来的"那一档）。 */
const onDisk = () => {
  const out = [];
  const walk = (rel) => {
    for (const name of readdirSync(path.join(ROOT, rel)).sort()) {
      const p = path.join(rel, name);
      const st = statSync(path.join(ROOT, p));
      if (st.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  if (existsSync(path.join(ROOT, DIR))) walk(DIR);
  return out;
};

const md5 = (rel) => {
  const p = path.join(ROOT, rel);
  if (!existsSync(p)) return null;
  return createHash('md5').update(readFileSync(p)).digest('hex');
};

/** 此刻脏着的集合：porcelain 给的是相对仓库根的路径，状态码在第二列。 */
const dirtyNow = () => {
  const out = spawnSync('git', ['status', '--porcelain', '--', DIR], { cwd: ROOT, encoding: 'utf8' }).stdout;
  const set = new Set();
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    set.add(line.slice(3).trim());
  }
  return set;
};

if (mode === 'snapshot') {
  const dirty = dirtyNow();
  const snap = { at: new Date().toISOString(), tracked: {}, untrackedAtSnapshot: [] };
  for (const rel of tracked()) snap.tracked[rel] = { md5: md5(rel), dirtyBefore: dirty.has(rel) };
  for (const rel of onDisk()) if (!snap.tracked[rel]) snap.untrackedAtSnapshot.push(rel);
  writeFileSync(file, JSON.stringify(snap, null, 1));
  console.log(
    `SNAPSHOT 登记=${Object.keys(snap.tracked).length} 枚（其中跑前就脏的 ${Object.values(snap.tracked).filter((v) => v.dirtyBefore).length} 枚）` +
      `｜当时未跟踪 ${snap.untrackedAtSnapshot.length} 枚`,
  );
  process.exit(0);
}

if (!existsSync(file)) {
  console.log(`VERDICT=PROBE_BROKEN 快照文件读不到：${file}（"没东西要还原"与"没快照"必须是两档读数）`);
  process.exit(2);
}
const snap = JSON.parse(readFileSync(file, 'utf8'));
const nowDirty = dirtyNow();
const trackedNow = new Set(tracked());

const rewritten = [];
const untouchedPreexisting = [];
for (const [rel, info] of Object.entries(snap.tracked || {})) {
  const after = md5(rel);
  if (after === null) {
    if (info.dirtyBefore) untouchedPreexisting.push(`${rel}（文件没了，跑前就脏 ⇒ 不动）`);
    else rewritten.push(`${rel}（文件没了）`);
    continue;
  }
  if (after === info.md5) continue;
  if (info.dirtyBefore) {
    untouchedPreexisting.push(rel);
    continue;
  }
  rewritten.push(rel);
}
const added = onDisk().filter((rel) => !trackedNow.has(rel) && !(snap.untrackedAtSnapshot || []).includes(rel));

console.log(
  `EVIDENCE 本趟重写=${rewritten.length} 枚｜跑前就脏（不动）=${untouchedPreexisting.length} 枚｜新增未跟踪（不动）=${added.length} 枚`,
);
for (const l of untouchedPreexisting) console.log(`  · 不动（跑前就是脏的，可能是别人的在途证据）：${l}`);
for (const l of added) console.log(`  · 新增未跟踪：${l}`);

if (keep) {
  console.log(`EVIDENCE_GUARD=KEEP（--keep：这一趟的字节留在盘上，未还原 ${rewritten.length} 枚）`);
  process.exit(0);
}
if (!rewritten.length) {
  console.log('EVIDENCE_GUARD=NO_REWRITE（这一趟没换过任何提交态截图）');
  process.exit(0);
}
// 逐枚点名还原 —— 绝不写目录（目录形状会连"跑前就脏"的那几枚一起抹掉）。
const failed = [];
for (const entry of rewritten) {
  const rel = entry.replace(/（.*）$/, '');
  const r = spawnSync('git', ['restore', '--', rel], { cwd: ROOT, encoding: 'utf8' });
  if ((r.status ?? 1) !== 0) failed.push(rel);
}
if (failed.length) {
  console.log(`EVIDENCE_GUARD=RESTORE_FAILED ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`EVIDENCE_GUARD=RESTORED ${rewritten.length} 枚（逐枚 git restore，提交态就是人看过那一版）`);
process.exit(0);
