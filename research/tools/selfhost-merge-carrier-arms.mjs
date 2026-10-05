/**
 * `pkgFieldVerdict` 的五臂注入装置（判据入库，装置也入库 —— 否则下一读的人只能信 §8.91 那张表）。
 *
 * 它回答一个二元问题：**载体的 package.json 并集有没有把本批改过的"非 scripts 顶层字段"丢掉**。
 * 并集的构造是"深拷贝 main + 只往 scripts 里加"，所以本批若动过 `dependencies` /
 * `devDependencies` / `pnpm.overrides` / `packageManager`，产出会静默回到 main 那份，
 * 而 scripts 那四条断言（缺键 / 缺链段 / 两侧顺序 / 两侧摘段）一条都不会响。
 *
 * 用法（默认旋钮就够，参数是给"下一批想知道当时怎么样"留的）：
 *   node research/tools/selfhost-merge-carrier-arms.mjs [mainRef] [srcRef]
 * 退出码：0 = 五臂全部符合预期；1 = 有臂不符合（含"载体自己把字段丢了"这一类真事故）。
 *
 * 🔴 两臂**不生来就红**（真实四份必须 ok），三臂**必须红**（三类静默丢都点得到名），
 *    第五臂证明它**不替 main 的决定响** —— main 单方改 devDependencies 时 ok。
 *    少了第一组，这条判据可能只是恒红；少了最后一臂，它可能变成噪音源。
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pkgFieldVerdict } from './selfhost-audit-union.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const git = (args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
const mainRef = process.argv[2] || 'main';
const srcRef = process.argv[3] || 'feat/self-host-distribution';
const baseRef = git(['merge-base', mainRef, srcRef]).trim();
const j = (ref) => JSON.parse(git(['show', `${ref}:package.json`]));

const base = j(baseRef);
const ours = j(mainRef);
const theirs = j(srcRef);
// 磁盘上那一份产出（载体分支每重算一次它就跟着变；臂 1 因此永远在判**当前**载体，不是一份快照）。
let out = null;
try {
  out = j('feat/self-host-merge-main');
} catch {
  console.log('ℹ️ 没有 feat/self-host-merge-main（还没算过载体）⇒ 臂 1 改用并集构造，臂 1-磁盘 那一条跳过');
}
// 并集构造：与 selfhost-merge-carrier.mjs 同一件事（深拷贝 main，只补 scripts 里缺的键）。
const unionOf = (t) => {
  const o = JSON.parse(JSON.stringify(ours));
  for (const [k, v] of Object.entries(t.scripts)) if (!(k in o.scripts)) o.scripts[k] = v;
  return o;
};

let bad = 0;
const arm = (label, r, expect) => {
  const hit = expect === null ? r.ok : !r.ok && r.dropped.join(',') === expect;
  console.log(`${hit ? '✅' : '❌'} ${label}  ok=${r.ok} dropped=[${r.dropped.join(',')}] 比了=${r.counts.compared}  期望=${expect === null ? 'ok' : `红:${expect}`}`);
  if (!hit) bad += 1;
};

if (out) arm('臂1 真实四份（磁盘上的载体对象）', pkgFieldVerdict({ base, ours, theirs, out }), null);
arm('臂1b 真实三份 + 并集构造', pkgFieldVerdict({ base, ours, theirs, out: unionOf(theirs) }), null);

const t2 = JSON.parse(JSON.stringify(theirs));
t2.devDependencies['zzz-added-by-batch'] = '^1.2.3';
arm('臂2 本批往 devDependencies 加一枚', pkgFieldVerdict({ base, ours, theirs: t2, out: unionOf(t2) }), 'devDependencies');

const t3 = JSON.parse(JSON.stringify(theirs));
t3.pnpm = { overrides: { foo: '1.0.0' } };
arm('臂3 本批新增顶层 pnpm.overrides', pkgFieldVerdict({ base, ours, theirs: t3, out: unionOf(t3) }), 'pnpm');

const t4 = JSON.parse(JSON.stringify(theirs));
t4.packageManager = 'pnpm@9.9.9';
arm('臂4 本批改 packageManager', pkgFieldVerdict({ base, ours, theirs: t4, out: unionOf(t4) }), 'packageManager');

const o5 = JSON.parse(JSON.stringify(ours));
o5.devDependencies['only-main'] = '^0.0.1';
arm('臂5 只有 main 改了 devDependencies（本批没动）', pkgFieldVerdict({ base, ours: o5, theirs, out: unionOf(theirs) }), null);

console.log(bad ? `❌ ${bad} 臂不符合预期` : '✅ 五臂全部符合预期（两臂证明不生来就红、三臂证明三类静默丢都能红、第五臂证明不替 main 的决定响）');
process.exit(bad ? 1 : 0);
