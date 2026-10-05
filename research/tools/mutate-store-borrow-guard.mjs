/**
 * 借 store 守卫的**变异台 + 等价台**（一次性可复跑，不碰真文件、不碰 git）。
 *
 * 为什么要有这个文件：AGENTS §8 第 3 条"不能失败的检查没有价值"，而 §8.189 那四朵变异
 * 若只活在某趟对话里，下一位就没有办法复核"这八条臂真的各守住一道守卫"。
 * 台账 §8.189 记的是当时的读数；**臂数与红臂集以本脚本自己打印的为准**，不要抄进任何文档。
 *
 * 用法：`node research/tools/mutate-store-borrow-guard.mjs`
 *   两档退出码：0 = 每朵变异都打红了它那一组（守卫有牙）且等价台只差在预期的那一档；
 *   1 = 有变异的红臂集是空的（那档守卫没臂）、或等价差落到了预期外的输入档（抽取改了语义）。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = join(HERE, 'selfhost-store-borrow.mjs');
const UNREAD = '读不到';

const text = readFileSync(TARGET, 'utf8');
if (!text.includes('export function borrowStep')) {
  console.error('❌ 目标文件里没有 borrowStep —— 判定本体又搬回载体了？本台没有可变异的东西。');
  process.exit(1);
}

/** 四朵变异：各自摘掉/挪动一道守卫。`re` 没匹配上 = 这趟变异根本没发生，要响亮报出来。 */
const MUTATIONS = [
  {
    name: 'M1 摘掉"两侧锁必须逐字节相同"',
    re: / {2}if \(lockSrc !== lockDst\) \{[\s\S]*?\n {2}\}\n/,
    expect: ['A1', 'A2', 'A4', 'A5'],
  },
  {
    name: 'M2 摘掉"源里必须有 .pnpm"',
    re: / {2}if \(!srcHasPnpm\) \{[\s\S]*?\n {2}\}\n/,
    expect: ['A3', 'A8'],
  },
  {
    name: 'M3 摘掉"读不出数 ≠ 相等"',
    re: / {2}if \(lockSrc === UNREADABLE \|\| lockDst === UNREADABLE\) \{[\s\S]*?\n {2}\}\n/,
    expect: ['A7'],
  },
];

/** M4：把"目标本来就有根 store ⇒ skip"挪到函数最前面（顺序变异）。 */
const SKIP_LINE = text.match(/\n {2}if \(rel === '' && dstHasStore\)[^\n]*\n/);
const FN_HEAD = "export function borrowStep({ rel = '', lockSrc, lockDst, srcHasPnpm, dstHasStore, dstNmExists }) {\n";
if (SKIP_LINE && text.includes(FN_HEAD)) {
  MUTATIONS.push({
    name: 'M4 把 skip 挪到守卫前面（顺序）',
    apply: (t) => t.replace(SKIP_LINE[0], '\n').replace(FN_HEAD, FN_HEAD + SKIP_LINE[0]),
    expect: ['A4', 'A8'],
  });
} else {
  console.log('⚠️ M4 没做成：找不到那句 skip 或函数头 ⇒ 顺序这一档此刻没有台可变异（不是通过）');
}

const problems = [];
const runArmed = (mutatedText, label) => {
  const f = join('/tmp', `sb-mut-${label}.mjs`);
  writeFileSync(f, mutatedText);
  let out = '';
  try {
    out = execFileSync('node', [f, '--selftest'], { encoding: 'utf8' });
  } catch (e) {
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  // 副本是本台自己造的夹具，读完就删 —— 留在 /tmp 的东西下一位会当成"某次真跑留下的"。
  rmSync(f, { force: true });
  return out.split('\n').filter((l) => /^RED\s/.test(l)).map((l) => l.replace(/^RED\s+/, '').split(' ')[0]);
};

const base = runArmed(text, 'base');
console.log(`对照（未变异）红臂 = ${base.length} 条 ${base.length ? `[${base.join(', ')}] ⇒ 判据本体已坏` : '⇒ 判据本体完好'}`);
if (base.length) problems.push('未变异的自检就有红臂');

for (const [i, m] of MUTATIONS.entries()) {
  const mutated = m.apply ? m.apply(text) : text.replace(m.re, '');
  if (mutated === text) {
    console.log(`${m.name} ⇒ NO-OP（正则没匹配上，这趟变异没发生，读数无效）`);
    problems.push(`${m.name}：变异没发生`);
    continue;
  }
  const red = runArmed(mutated, `m${i}`);
  const hit = red.filter((r) => r.startsWith('A'));
  console.log(`${m.name} ⇒ 红臂 [${red.join(', ') || '（空）'}] 期望其中含 ${m.expect.join('/')}`);
  if (!hit.length) problems.push(`${m.name}：一臂未红 ⇒ 这档守卫没有牙`);
  for (const e of m.expect) if (!hit.includes(e)) problems.push(`${m.name}：应当红它的 ${e} 没红`);
}

/* ── 等价台：把改动前的内联判断原样重写，与新判定在全组合上对账 ──
 * 用途不是"验证相等"，而是**量出差落在哪一档**：差若出现在预期外输入，就是抽取改了语义。 */
const { borrowStep } = await import(pathToFileURL(TARGET).href);
const oldStep = ({ rel, lockSrc, lockDst, srcHasPnpm, dstHasStore, dstNmExists }) => {
  if (lockSrc !== lockDst) return 'refuse:R_LOCK';
  if (!srcHasPnpm) return 'refuse:R_SRC';
  if (dstHasStore && rel === '') return 'skip';
  if (dstNmExists && rel !== '') return 'skip';
  return 'link';
};
const norm = (r) => (r.action === 'refuse'
  ? `refuse:${r.reason.startsWith('两侧锁') ? 'R_LOCK' : 'R_SRC'}`
  : r.action);

const onlyOlder = []; // 新判定比旧的**更宽松**的格子 —— 一个都不许有
let diffs = 0;
let cells = 0;
for (const lockSrc of ['aaaa', 'bbbb', UNREAD]) {
  for (const lockDst of ['aaaa', 'bbbb', UNREAD]) {
    for (const rel of ['', 'e2e/']) {
      for (const srcHasPnpm of [true, false]) {
        for (const dstHasStore of [true, false]) {
          for (const dstNmExists of [true, false]) {
            cells += 1;
            const w = { rel, lockSrc, lockDst, srcHasPnpm, dstHasStore, dstNmExists };
            const o = oldStep(w);
            const n = norm(borrowStep(w));
            if (o === n) continue;
            diffs += 1;
            if (n === 'link' || (o.startsWith('refuse') && n === 'skip')) {
              onlyOlder.push(`rel=${rel || '(根)'} ${JSON.stringify(w)} 旧=${o} 新=${n}`);
            }
          }
        }
      }
    }
  }
}
console.log(`等价台：全组合 ${cells} 格 · 语义差 ${diffs} 格 · 其中"新判定更宽松"的 ${onlyOlder.length} 格`);
for (const d of onlyOlder) console.log(`  ❌ ${d}`);
if (onlyOlder.length) problems.push('抽取让守卫变松了（至少一格）');

if (problems.length) {
  console.error(`\n❌ 本台判据不通过（${problems.length} 条）：\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log('\n✅ 每朵变异都打红了它那一组臂，等价台的差只落在收紧的那一档');
