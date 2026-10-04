// 只读审计：计划文档里每一条"截图已看"引用的图片，**是否真的在版本库里**。
// 形状来自任务 #27（四张 e2e 图只在 test-results 临时目录 ⇒ 账面绿、证据不常驻）。
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const ROOT = process.cwd();
const files = process.argv.slice(2);

const tracked = new Set(
  execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean),
);

const re = /(?:\.{0,2}\/|[\w.-]+\/)+[\w.一-龥 -]*\.(?:png|jpg|jpeg|webp)/g;
const hits = new Map();

for (const f of files) {
  const text = readFileSync(resolve(ROOT, f), 'utf8');
  // 两遍：带路径的 + 裸文件名（文档里大量写的是 `card-light.png` 这种，只扫带斜杠的会漏一整类）
  const found = [
    ...(text.match(re) ?? []),
    ...(text.match(/[\w.一-龥-]+\.(?:png|jpe?g|webp)/g) ?? []),
  ];
  for (const m of found) {
    if (!hits.has(m)) hits.set(m, { count: 0, where: f });
    hits.get(m).count += 1;
  }
}

const byName = new Map();
for (const t of tracked) byName.set(t.split('/').pop(), t);

const rows = [...hits.entries()].map(([p, info]) => {
  // 🔴 防我自己这条审计的假阳性：文档里 `../../apps/mobile/.../latest-card.png` 这种
  //    相对写法（从某份 README 的视角抄进正文的）必须先归一，否则会被判成 MISSING ——
  //    而那个文件**是在库里的**。第一版就把它判成了 MISSING，是探针坏了不是证据丢了。
  const clean = p.replace(/^\.?\.(?:\/|\/\.)+\s*/, '').replace(/^(\.\.\/)+/, '').replace(/^\.\//, '');
  let state;
  if (clean.startsWith('/tmp/') || clean.includes('test-results/')) state = 'TEMP';
  else if (clean.startsWith('dist/')) state = 'IGNORED-artifact';
  else if (tracked.has(clean)) state = 'TRACKED';
  else if (existsSync(resolve(ROOT, clean))) state = 'ON-DISK-untracked';
  else if (byName.has(clean.split('/').pop())) state = 'TRACKED-by-name';
  else state = 'MISSING';
  return { p, clean, state, count: info.count, where: info.where };
});

const order = ['TRACKED', 'TRACKED-by-name', 'ON-DISK-untracked', 'TEMP', 'IGNORED-artifact', 'MISSING'];
for (const s of order) {
  const g = rows.filter((r) => r.state === s).sort((a, b) => b.count - a.count);
  console.log(`\n### ${s}  (${g.length} 个不同路径 / ${g.reduce((a, r) => a + r.count, 0)} 处引用)`);
  if (s !== 'TRACKED') for (const r of g) console.log(`  ${r.count}x  ${r.p}   ← ${r.where}`);
}
