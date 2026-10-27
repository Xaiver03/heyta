#!/usr/bin/env node
/**
 * 台架：逐枚注入 `check-gate-wiring` 的每一臂形状，读回**红条数**而不只是 rc。
 * =================================================================
 *
 * 为什么需要它：`--self-test` 那 9 臂判的是 `rc!==0` 且"报错里含这句"。这已经能挡"臂打空"，
 * 但挡不住**红得不是因为那条判据**那一形（比如临时树少拷一枚载体文件 ⇒ 每一条臂都因为
 * "消费方不存在"而红，而文案里恰好也含那句 needle）。
 * 所以这里把每一臂的**全部 🔴 行**列出来，逐枚看"红条数 = 1 且就是那一条判据"。
 * 现量结果（2026-10-28）：除 Ⓒ 是 2 条（摘定义同时把实现变成孤儿，两条都该红、已在台账写明
 * "这一臂不是单判据"），其余每臂 1 条；Ⓐ 那枚阳性对照必须 0 条 —— 它不是 0 就说明整把尺恒红。
 *
 *   node research/tools/mutate-gate-wiring-arms.mjs
 *
 * 它只往临时目录写，工作树一个字不动。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(import.meta.dirname, '..', '..');
const SELF = join(ROOT, 'scripts', 'check-gate-wiring.mjs');
const realPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

// 载体清单从尺自己的两张表里取（写死文件名 = 表一改这枚台架就在测旧形状）
const consumers = [...new Set(readFileSync(SELF, 'utf8').matchAll(/file: '([^']+)'/g).map((m) => m[1]))].sort();

const build = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-gw-arms-'));
  for (const rel of consumers) {
    const src = join(ROOT, rel);
    if (!existsSync(src)) continue;
    const dest = join(dir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(src, 'utf8'), 'utf8');
  }
  const pkg = structuredClone(realPkg);
  const fileEdit = fn(pkg);
  if (fileEdit) {
    writeFileSync(join(dir, fileEdit.file), fileEdit.apply(readFileSync(join(dir, fileEdit.file), 'utf8')), 'utf8');
  }
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  return dir;
};
const dropFromChain = (pkg, seg) => {
  pkg.scripts.check = pkg.scripts.check
    .split('&&')
    .map((s) => s.trim())
    .filter((s) => s !== seg)
    .join(' && ');
};
const NEEDLE = 'pnpm check:worktree-exceptions';

const cases = [
  ['Ⓐ 阳性对照：链与载体原样（红条数必须 0）', () => {}],
  ['Ⓑ 定义在、链段摘掉', (pkg) => dropFromChain(pkg, 'pnpm check:gate-ssh')],
  ['Ⓒ 链段在、定义摘掉（已知是 2 条：判据 3 + 孤儿）', (pkg) => { delete pkg.scripts['check:gate-ssh']; }],
  ['Ⓓ 锚点的链段与定义一起摘（1/3 条都失明）', (pkg) => { dropFromChain(pkg, 'pnpm -r test'); delete pkg.scripts.test; }],
  [
    'Ⓔ 载体里那行改成仍含命令文本的散文（includes 会绿的那一形）',
    () => ({
      file: 'docs/agents/commands.md',
      apply: (t) =>
        t
          .split('\n')
          .map((l) => (l.trimStart().startsWith(NEEDLE) ? `> 补充说明：手工也可以 ${NEEDLE}` : l))
          .join('\n'),
    }),
  ],
  [
    'Ⓕ 载体里那行整行删掉',
    () => ({
      file: 'docs/agents/commands.md',
      apply: (t) => t.split('\n').filter((l) => !l.trimStart().startsWith(NEEDLE)).join('\n'),
    }),
  ],
  ['Ⓖ 实现还在、定义与链段都没了', (pkg) => { dropFromChain(pkg, 'pnpm check:scripts-parse'); delete pkg.scripts['check:scripts-parse']; }],
];

let bad = 0;
for (const [label, fn] of cases) {
  const dir = build(fn);
  try {
    const r = spawnSync(process.execPath, [SELF, '--pkg', join(dir, 'package.json'), '--root', dir], {
      encoding: 'utf8',
      cwd: ROOT,
    });
    const reds = (r.stderr || '').split('\n').filter((l) => l.startsWith('🔴'));
    const wantZero = label.startsWith('Ⓐ');
    const ok = wantZero ? r.status === 0 && reds.length === 0 : r.status === 1 && reds.length >= 1;
    if (!ok) bad += 1;
    console.log(`${ok ? '✅' : '🔴'} ${label} ｜ rc=${r.status} ｜ 红条数=${reds.length}`);
    for (const l of reds.slice(0, 3)) console.log(`      ${l.slice(0, 150)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log(`形状数 ${cases.length} ｜ 不符 ${bad}`);
process.exit(bad === 0 ? 0 : 1);
