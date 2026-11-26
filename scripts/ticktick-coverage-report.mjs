#!/usr/bin/env node
// 滴答覆盖图谱查询器 + 档位校验/回填
// 真源：docs/research/ticktick-coverage-graph.md §3 主表（6 列：#/屏/实现度/靶子/档/备注）
// 用法：node scripts/ticktick-coverage-report.mjs          # 体检 + 校验
//       node scripts/ticktick-coverage-report.mjs --fix    # 按规则回填档列
import fs from 'node:fs';

const FILE = 'docs/research/ticktick-coverage-graph.md';
const UNIQUE = new Set([76, 77, 78, 79]); // heyta 独有屏：本就不需滴答靶子

const norm = (v) => (v.startsWith('有') ? '有' : v.startsWith('半有') ? '半有' : v.startsWith('无') ? '无' : '未核实');
const hasTgt = (t) => /^(A|D)/.test(t);
// 五档：A 完全学到(有+靶子) / H 半有(半有+靶子) / B 缺靶子(有或半有+无靶) / C 缺功能(无+靶子) / D 双缺
const calc = (implRaw, tgt) => {
  const impl = norm(implRaw), t = hasTgt(tgt);
  if (impl === '无') return t ? 'C' : 'D';
  if (!t) return 'B';
  return impl === '有' ? 'A' : 'H';
};

if (process.argv.includes('--fix')) {
  const lines = fs.readFileSync(FILE, 'utf8').split('\n');
  let fixed = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\|\s*(\d+)\s*\|/);
    if (!m) continue;
    const c = lines[i].split('|');
    if (c.length !== 8) continue; // 仅 §3 主表(6列)
    const n = +c[1];
    if (n < 1 || n > 79) continue;
    const g = UNIQUE.has(n) ? 'A' : calc(c[3].trim(), c[4].trim());
    if (c[5].trim().replace(/\*/g, '') !== g) { c[5] = ' ' + g + ' '; lines[i] = c.join('|'); fixed++; }
  }
  fs.writeFileSync(FILE, lines.join('\n'));
  console.log(`已按五档规则回填档列：${fixed} 处改动`);
  process.exit(0);
}

const g = fs.readFileSync(FILE, 'utf8');
const R = [], seen = new Set();
for (const ln of g.split('\n')) {
  const m = ln.match(/^\|\s*(\d+)\s*\|/);
  if (!m) continue;
  const c = ln.split('|').map((s) => s.trim());
  if (c.length !== 8) continue;
  const n = +c[1];
  if (n < 1 || n > 79 || seen.has(n)) continue;
  seen.add(n);
  R.push({ n, name: c[2], impl: c[3], tgt: c[4], grade: c[5].replace(/\*/g, '').trim() });
}

const tally = (arr, k) => arr.reduce((a, r) => ((a[r[k]] = (a[r[k]] || 0) + 1), a), {});
const by = (x) => R.filter((r) => r.grade === x);
const mism = R.filter((r) => (UNIQUE.has(r.n) ? 'A' : calc(r.impl, r.tgt)) !== r.grade);

console.log('═'.repeat(56));
console.log('滴答清单覆盖体检 · ' + FILE);
console.log('═'.repeat(56));
console.log(`格子总数: ${R.length}   产品实现度: ${JSON.stringify(tally(R, 'impl'))}`);
console.log(`档位分布: ${JSON.stringify(tally(R, 'grade'))}`);
console.log(`\n真正学到(A 完全) ${by('A').length} 格（含 heyta 独有无需靶子 ${[...UNIQUE].filter((n) => R.some((r) => r.n === n)).length} 格）`);
console.log(`半有(H 功能差一截但有靶子) ${by('H').length} 格`);
console.log(`没学到: B缺靶子 ${by('B').length} + D双缺 ${by('D').length} = ${by('B').length + by('D').length} 格；另 C缺功能 ${by('C').length}`);

const show = (label, xs, extra = () => '') => {
  console.log(`\n── ${label} (${xs.length}) ──`);
  for (const r of xs) console.log(`  #${r.n}\t${r.name}${extra(r)}`);
};
show('D 双缺（别做，先取证）', by('D'));
show('B 有功能·缺靶子（看着有其实凭猜）', by('B'), (r) => `\t靶子=${r.tgt}`);
show('H 半有·有靶子（照靶子补齐那半）', by('H'));
show('C 有靶子·缺功能（成本最低）', by('C'));

if (mism.length) {
  console.log('\n⚠ 档位与规则不一致（跑 --fix 自动修）:');
  for (const r of mism) console.log(`  #${r.n} 填=${r.grade} 算=${UNIQUE.has(r.n) ? 'A' : calc(r.impl, r.tgt)} impl=${r.impl} tgt=${r.tgt}`);
  process.exitCode = 1;
} else console.log('\n✅ 档位与规则一致（自洽）');
