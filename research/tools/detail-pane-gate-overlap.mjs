#!/usr/bin/env node
/**
 * 本线那十条腿 与 main 上那条共享门禁 `scripts/check-md-table-rows.mjs` 的**重叠矩阵**。
 *
 * 为什么需要它（任务 #29 的另一半）：合流时要把本线这两份文档加进 main 那条门禁的 `FILES` 名册。
 * 加进去之前必须先量清两件事，否则 #29 只是一句"到时候再看"：
 *   ① 本线合法的内容会不会被 main 那把判成红（→ 加名册当场就红，合流被堵住）；
 *   ② 同一处坏被两把**同时**点名时，谁是权威（→ 不去重就会有人为了少一条红而删掉一把）。
 *
 * 做法：把工单文档拷进 /tmp，注入四类**各自独立**的坏形状，两把门禁各跑一遍，打矩阵。
 * 判的是"哪几把会红"，不是"红几条"—— 条数随文档增长而漂，矩阵的**列**才是可迁移的结论。
 *
 * 跑法：node research/tools/detail-pane-gate-overlap.mjs
 * 退出码：0 = 矩阵跑出来了（不管哪一格是红）；2 = 载体不可用（取不到 main 那把脚本 / 注入没生效）。
 *   🔴 1 不是"发现问题"，这个脚本没有"应然"，它只报读数。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const PLAN = 'docs/plans/detail-pane-alignment.md';
const MINE = join(repoRoot, 'scripts/check-detail-pane-status-table.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'dp-overlap-'));

/** 从 main 取那条共享门禁（本支还没有它），并把它的 FILES 换成本线这两份文档。 */
const sharedSrc = execFileSync('git', ['-C', repoRoot, 'show', 'main:scripts/check-md-table-rows.mjs'], { encoding: 'utf8' });
const filesArray = sharedSrc.match(/const FILES = \[[\s\S]*?\];/);
if (!filesArray) {
  console.log('PROBE_BROKEN 取不到 main 那条门禁里的 FILES 数组（形状变了）⇒ 本矩阵没有判据可跑');
  process.exit(2);
}
const SHARED = join(scratch, 'md-table-rows-from-main.mjs');
// 那条脚本原本硬写 FILES 名册（合流后才轮得到本线那两份文档），这里把它换成"从 argv 收文件"，
// 其余判据**一条都不改** —— 改判据就变成"我在测我自己写的东西"，矩阵就没有意义了。
writeFileSync(SHARED, sharedSrc.replace(filesArray[0], 'const FILES = process.argv.slice(2);'));

const ORIGINAL = readFileSync(join(repoRoot, PLAN), 'utf8');
const run = (script, args) => {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: repoRoot });
  return { rc: r.status, out: `${r.stdout}${r.stderr}` };
};

/** 四类坏形状，各自只改一处；每一类都断言"注入确实改了字节"。 */
const mutants = [];
const inject = (name, fn) => {
  const next = fn(ORIGINAL);
  if (next === ORIGINAL) {
    console.log(`PROBE_BROKEN 注入类「${name}」没有改动文档 —— 抽取形状对不上原文，矩阵不可信`);
    process.exit(2);
  }
  const file = join(scratch, `${name}.md`);
  writeFileSync(file, next, 'utf8');
  mutants.push({ name, file });
};

// D1 表格单元的 code span 里出现裸竖线（本线腿 9 的靶）。
inject('D1-码段裸竖线', (t) => {
  const ls = t.split('\n');
  const head = ls.findIndex((l) => /^\|\s*单\s*\|\s*状态\s*\|\s*读数/.test(l));
  const idx = ls.findIndex((l, i) => i > head + 1 && /^\|\s*W[0-9]+[a-z]?\b.*\|\s*$/.test(l));
  ls[idx] = ls[idx].replace(/\|\s*$/, ' 演示 `a|b` 这种写法 |');
  return ls.join('\n');
});
// D2 一行表格被折成两个物理行（本线腿 1 的靶；main 那把按"断行"判）。
inject('D2-表格行折成两行', (t) => {
  const ls = t.split('\n');
  const head = ls.findIndex((l) => /^\|\s*单\s*\|\s*状态\s*\|\s*读数/.test(l));
  const idx = ls.findIndex((l, i) => i > head + 1 && /^\|\s*W[0-9]+[a-z]?\b.*\|\s*$/.test(l));
  const row = ls[idx];
  const cut = row.indexOf(' | ', 4);
  ls.splice(idx, 1, row.slice(0, cut + 2), row.slice(cut + 2));
  return ls.join('\n');
});
// D3 有序列表块里的编号与位置不一致（只有本线腿 10 管）。
// 🔴 靶必须落在**围栏外**的列表块：门禁扫的时候跳过代码围栏，围栏里的 `N. ` 是命令输出，不算列表项
//    —— 第一版直接 `match(/^(\d+)\. /m)` 取到的就是围栏里的一个，注入后判据"没红"，
//    那是**注入没打中对象**，不是"两把都不管"（这一格差点被我写成结论）。
inject('D3-列表编号错位', (t) => {
  const ls = t.split('\n');
  let inFence = false;
  for (let i = 0; i < ls.length; i += 1) {
    if (/^```/.test(ls[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = ls[i].match(/^(\d+)\.\s/);
    if (!m) continue;
    // 往后看：这个块至少还要有一条 `N. `，否则改一条不会造成"错位"
    let more = 0;
    for (let j = i + 1; j < ls.length && j < i + 12; j += 1) {
      if (/^(\d+)\.\s/.test(ls[j])) more += 1;
      if (/^#/.test(ls[j])) break;
    }
    if (more < 2) continue;
    ls[i] = ls[i].replace(/^(\d+)\./, `${Number(m[1]) + 5}.`);
    return ls.join('\n');
  }
  throw new Error('D3 在围栏外找不到 ≥3 条的有序列表块 —— 注入没有对象');
});
// D4 表格行少了一个分隔竖线 ⇒ 列数与表头不符（只有 main 那把管；本线**有意**不判列数）。
inject('D4-列数不符', (t) => {
  const ls = t.split('\n');
  const head = ls.findIndex((l) => /^\|\s*单\s*\|\s*状态\s*\|\s*读数/.test(l));
  const idx = ls.findIndex((l, i) => i > head + 1 && /^\|\s*W[0-9]+[a-z]?\b.*\|\s*$/.test(l));
  const first = ls[idx].indexOf('|', ls[idx].indexOf('|') + 1);
  ls[idx] = ls[idx].slice(0, first) + ls[idx].slice(first + 1);
  return ls.join('\n');
});

const redSet = (out) => {
  const hits = [];
  for (const line of out.split('\n')) {
    // 🔴 不截标题：腿名由判据脚本自己打印，这里截一段就成了第二份抄件（抄件必漂）。
    //    代价是矩阵变高，所以一条腿一行，而不是拼成一列。
    const m = line.match(/^🔴 (.+?)（(\d+) 条）：$/);
    if (m) hits.push(`    ${m[1]}（${m[2]} 条）`);
  }
  return hits;
};

console.log('类别｜本线 RC｜本线点名了哪几条腿｜main 的 check-md-table-rows RC｜main 的原文');
for (const { name, file } of mutants) {
  const mine = run(MINE, [file]);
  const shared = run(SHARED, [file, file]);
  const mineLegs = redSet(mine.out);
  const sharedLine = shared.out
    .split('\n')
    .find((l) => /错位|没有分隔行|折成|列数/.test(l))
    ?.trim()
    .replace(/^[^ ]*dp-overlap[^ ]*/,'副本');
  console.log(
    `${name}｜RC=${mine.rc}｜${mineLegs.length ? '\n' + mineLegs.join('\n') : '（无一条腿点名）'}` +
      `｜RC=${shared.rc}｜${sharedLine ? sharedLine.slice(0, 96) : '（没点名）'}`,
  );
}

rmSync(scratch, { recursive: true, force: true });
console.log('\n读法：两把都红的格 = 会双报，#29 的去重口径要写明以谁为准；只有一把红的格 = 另一把不能删。');
