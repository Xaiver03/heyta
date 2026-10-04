#!/usr/bin/env node
/**
 * `scripts/check-detail-pane-c1-coverage.mjs` 的变异臂（工单 §8.59 / §8.64）。
 *
 * 那条判据把目标第 1 条「每个待拍值都要有外部调研，带日期 + 出处」从散文承诺变成能失败的属性：
 * C1 每行要么有 C1b 对照节、要么写明封闭例外类别；每个对照节都要有日期与出处（URL 或 `file:line`）。
 * §8.59 那趟 M1–M6 是手敲的一次性命令，之后判据加了 `--root`（合流预检要在**产物树**里跑）——
 * 参数形状一变，"文档路径"和"`--root` 的实参"就会互相吃掉，所以把手敲的臂固化成装置，
 * 并补两条守 `--root` 的臂（M7/M8）。
 *
 * 跑法（linked worktree 里别用 `pnpm run`，它会先做 deps-status 预检）：
 *   node research/tools/mutation-rigs/mutate-detail-pane-c1-coverage.mjs
 *
 * 十臂的**预期**（M7/M8 与两条对照是守载体的臂）：
 *   M1 表里加一行既无对照节也不写例外   → 红在「没有 C1b 对照节…」，且点名 `#14`
 *   M2 把例外的理由改成词表外的一句话   → 同一腿红，且**例外数从 1 掉到 0**（证明类别是封闭的）
 *   M3 加一节回指表里不存在的行号       → 红在「回指了表里不存在的行号」
 *   M4 抹掉某节的日期                   → 红在「缺日期或缺出处」，读数里 `日期=false`
 *   M5 抹掉某节的 URL 与 file:line      → 同一条腿，`URL=false file:line=false`
 *   M6 把整张表删掉                     → 红在「C1 表解析出 0 行」（拒绝在空集合上报绿）
 *   M7 指一篇不存在的文档               → 红并把**传入的原样路径**打出来（守绝对路径被 `join` 拼坏）
 *   M8 只给 `--root` 不给文档           → 必须**绿**且读的是那棵树里的文档（守 `--root` 实参被当成文档吃掉）
 *   对照 未变异的副本                   → 全绿 RC=0
 *
 * 全程只改 /tmp 副本；仓库工作树与别人的产物不动。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const GATE = process.argv[2] ?? join(repoRoot, 'scripts/check-detail-pane-c1-coverage.mjs');
const DOC = 'docs/research/detail-pane-alignment-and-spaced-review.md';
const ORIGINAL = readFileSync(join(repoRoot, DOC), 'utf8');

const scratch = mkdtempSync(join(tmpdir(), 'dp-c1-'));
const doc = join(scratch, 'doc.md');
writeFileSync(doc, ORIGINAL, 'utf8');

const fail = [];
const notes = [];
const check = (arm, cond, detail) => {
  (cond ? notes : fail).push(`  ${cond ? '✅' : '🔴'} ${arm}${detail ? ` —— ${detail}` : ''}`);
};

const run = (args) => {
  const r = spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8' });
  return { rc: r.status, out: `${r.stdout}${r.stderr}` };
};
const withDoc = (mutate, args = [doc]) => {
  writeFileSync(doc, ORIGINAL, 'utf8');
  if (mutate) {
    const next = mutate(ORIGINAL);
    // 🔴 变异必须真的改动文档：静默 0 命中的替换会让臂"红"的原因变成别的注入，或干脆永远不红。
    if (next === ORIGINAL) throw new Error('变异没有改动文档（抽取形状对不上原文）—— 臂是装饰，拒绝继续。');
    writeFileSync(doc, next, 'utf8');
  }
  return run(args);
};
const legCount = (out, title) => {
  const seg = out.split(`\n${title}（`)[1];
  if (!seg) return 0;
  const m = seg.match(/^(\d+) 条）/);
  return m ? Number(m[1]) : 0;
};
const counts = (out) => {
  const m = out.match(/C1 行 (\d+) 行 ⇒ 有对照节 (\d+) \/ 例外 (\d+) \/ 未覆盖 (\d+)；C1b 节 (\d+) 个/);
  return m ? { rows: +m[1], covered: +m[2], excused: +m[3], unexcused: +m[4], sections: +m[5] } : null;
};
const UNCOV = '🔴 要拍的值没有 C1b 对照节，也没写清属于哪一类例外';
const ORPHAN = '🔴 C1b 节回指了表里不存在的行号（研究了不存在的题）';
const WEAK = '🔴 C1b 节缺日期或缺出处（URL 或 file:line 择一即可）';

// 定位辅助：表里最后一行 / 某个节的正文区间
const lastRowIdx = (text) => {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^## C1[.．]/.test(l.trim()));
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  let idx = -1;
  for (let i = start; i < end; i += 1) if (/^\|\s*\d+\s*\|/.test(lines[i])) idx = i;
  return { lines, end, idx };
};

const base = withDoc(null);
const bc = counts(base.out);
check('对照 未变异副本全绿', base.rc === 0 && bc !== null && bc.rows > 0 && bc.sections > 0, `RC=${base.rc}｜${JSON.stringify(bc)}`);
if (base.rc !== 0) {
  console.log(base.out);
  console.log('🔴 基线就是红的，M1/M2 那种"恰好 +1"都失去意义 —— 先修文档或判据。');
  process.exit(1);
}

// M1：加一行既无对照节也无例外
const m1 = withDoc((t) => {
  const { lines, idx } = lastRowIdx(t);
  lines.splice(idx + 1, 0, '| 14 | 装置注入的一格：既没写例外也没对照节 | A | 占位 |');
  return lines.join('\n');
});
const m1out = m1.out;
check(
  'M1 新行无对照节 → 红且点名 #14',
  m1.rc === 1 && legCount(m1out, UNCOV) === 1 && m1out.includes('#14') && m1out.includes('🔴 1 处不成立'),
  `RC=${m1.rc}｜未覆盖 ${counts(m1out)?.unexcused}`,
);

// M2：把例外理由改成词表外的一句话（封闭类别的牙）
// ⚠️ 那一行**同时命中两条词表分支**（`不是"要拍的值"` 和 `没有 C1b 对照节`），只抹掉一条它照样算例外 ——
// 第一版就是这么写的，症状是"臂没红"而不是"文档没被改"。所以两条都得抹，并断言**两次替换都真的落了**。
const m2res = withDoc((t) => {
  const line = t.split('\n').find((l) => /^\|\s*3\s*\|/.test(l));
  const after = line
    .replace(/它不是.要拍的值./, '它已经被处理完')
    .replace(/所以\*\*没有\s*C1b\s*对照节\*\*/, '所以**已经收尾了**');
  if (after === line) throw new Error('M2 的替换没命中（静默空改动 = 臂是装饰）');
  if (/不是.要拍的值.|没有\s*C1b\s*对照节/.test(after)) throw new Error('M2 抹不干净：两条词表分支还剩一条');
  return t.replace(line, after);
});
const m2out = m2res.out;
const m2c = counts(m2out);
check(
  'M2 词表外的理由不算例外',
  m2res.rc === 1 && legCount(m2out, UNCOV) === 1 && m2out.includes('#3') && m2c.excused === bc.excused - 1,
  `RC=${m2res.rc}｜例外 ${bc.excused}→${m2c.excused}，未覆盖 ${bc.unexcused}→${m2c.unexcused}`,
);

// M3：一节回指不存在的行号
const m3 = withDoc((t) =>
  `${t}\n### C1b-Q99（= C1 #99：装置注入的孤儿节）\n\n2026-10-04 取证：` + '`packages/domain/src/task.ts:1`' + `\n`,
);
const m3out = m3.out;
check(
  'M3 孤儿节 → 红并报缺的行号',
  m3.rc === 1 && legCount(m3out, ORPHAN) === 1 && m3out.includes('缺行号 99'),
  `RC=${m3.rc}｜节数 ${bc.sections}→${counts(m3out)?.sections}`,
);

// M4：抹掉某节的日期
const m4 = withDoc((t) => {
  const i = t.indexOf('### C1b-Q1（');
  if (i === -1) throw new Error('M4 找不到被改的节标题（原文形状变了，臂要跟着改）');
  const j = t.indexOf('\n### ', i + 5);
  return `${t.slice(0, i)}${t.slice(i, j).replace(/20\d\d-\d\d-\d\d/g, '（日期被装置抹掉）')}${t.slice(j)}`;
});
const m4out = m4.out;
check(
  'M4 缺日期 → 红且读数 日期=false',
  m4.rc === 1 && legCount(m4out, WEAK) === 1 && m4out.includes('日期=false'),
  `RC=${m4.rc}｜弱节 ${legCount(m4out, WEAK)} 条`,
);

// M5：抹掉某节的 URL 与 file:line（两种出处都没了才算缺出处）
const m5 = withDoc((t) => {
  const i = t.indexOf('### C1b-Q1（');
  if (i === -1) throw new Error('M5 找不到被改的节标题（原文形状变了，臂要跟着改）');
  const j = t.indexOf('\n### ', i + 5);
  const body = t
    .slice(i, j)
    .replace(/https?:\/\/\S+/g, '（链接被装置抹掉）')
    .replace(/[\w./-]+\.(ts|tsx|js|mjs|json|css|md|swift|kt|ets|java|py|sh):\d+/g, '（行号引用被装置抹掉）');
  return `${t.slice(0, i)}${body}${t.slice(j)}`;
});
const m5out = m5.out;
check(
  'M5 两种出处都没 → 红且读数 URL=false file:line=false',
  m5.rc === 1 && legCount(m5out, WEAK) >= 1 && /URL=false file:line=false/.test(m5out),
  `RC=${m5.rc}｜弱节 ${legCount(m5out, WEAK)} 条`,
);

// M6：整张表删掉（保留 `## C1.` 标题与下一个 `## `）→ 空集合必须拒绿
const m6 = withDoc((t) => {
  const lines = t.split('\n');
  const start = lines.findIndex((l) => /^## C1[.．]/.test(l.trim()));
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return [...lines.slice(0, start + 1), '', ...lines.slice(end)].join('\n');
});
const m6out = m6.out;
check('M6 表为空 → 拒绝报绿', m6.rc === 1 && m6out.includes('C1 表解析出 0 行'), `RC=${m6.rc}｜空集合那一档`);

// M7：不存在的文档 → 必须把**传入的原样路径**打出来（守绝对路径被 `join(root, …)` 拼坏）
const missingPath = join(scratch, 'no-such-doc.md');
const m7 = run([missingPath]);
check(
  'M7 文档不存在 → 红且出处是原样路径',
  m7.rc === 1 && m7.out.includes(`取样文档不存在：${missingPath}`),
  `RC=${m7.rc}`,
);

// M8：只给 `--root` 不给文档 → 实参不许被当成文档路径吃掉
const treeRoot = join(scratch, 'tree');
execFileSync('sh', [
  '-c',
  `mkdir -p "$0/tree" && git -C "$1" archive HEAD -- "$2" | tar -x -C "$0/tree"`,
  scratch,
  repoRoot,
  DOC,
]);
const m8 = run(['--root', treeRoot]);
check(
  'M8 产物树模式（只给 --root）→ 绿且读的是树里的文档',
  m8.rc === 0 && counts(m8.out) !== null && m8.out.includes(`取样：${DOC}`),
  `RC=${m8.rc}｜${JSON.stringify(counts(m8.out))}`,
);

// 对照：恢复干净后全绿
const control = withDoc(null);
check('对照 恢复干净后全绿', control.rc === 0, `RC=${control.rc}`);

rmSync(scratch, { recursive: true, force: true });

console.log(`\n读数：判据 ${GATE.split('/').pop()}｜C1 ${bc.rows} 行（有节 ${bc.covered} / 例外 ${bc.excused} / 未覆盖 ${bc.unexcused}）｜C1b ${bc.sections} 节`);
console.log(`\n${[...notes, ...fail].join('\n')}`);
if (fail.length) {
  console.log(`\n🔴 ${fail.length}/${notes.length + fail.length} 臂不合格`);
  process.exit(1);
}
console.log(`\n结论：${notes.length}/${notes.length + fail.length} 臂符合预期（8 变异臂 + 3 条对照/守载体）✅`);
