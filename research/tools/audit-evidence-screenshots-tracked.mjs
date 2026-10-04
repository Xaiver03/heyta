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
  // 🔴 裸名这一遍要**带上前面的字符**一起记：文件名里有空格（`…-10月11日 星期日.png`）、
  //    或者写成花括号展开（`{png,webview.png}`）时，正则会把**一个名字切成两截**，
  //    切出来的那半截在库里当然找不到 ⇒ 判成 MISSING，而证据其实是在库里的。
  //    那是本审计自己的解析噪声，不是台账的欠账，必须单独归一类、不能混进 MISSING 里让人重复排查。
  for (const m of text.matchAll(re)) push(m[0], f, text.slice(Math.max(0, m.index - 14), m.index));
  for (const m of text.matchAll(/[\w.一-龥-]+\.(?:png|jpe?g|webp)/g)) push(m[0], f, text.slice(Math.max(0, m.index - 14), m.index));
}

function push(m, where, pre) {
  if (!hits.has(m)) hits.set(m, { count: 0, where, pre });
  const h = hits.get(m);
  h.count += 1;
  if (!h.pre) h.pre = pre;
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
  return { p, clean, state, count: info.count, where: info.where, pre: info.pre };
});

const order = ['TRACKED', 'TRACKED-by-name', 'ON-DISK-untracked', 'TEMP', 'IGNORED-artifact', 'MISSING'];
for (const s of order) {
  const g = rows.filter((r) => r.state === s).sort((a, b) => b.count - a.count);
  console.log(`\n### ${s}  (${g.length} 个不同路径 / ${g.reduce((a, r) => a + r.count, 0)} 处引用)`);
  // MISSING 那一段**多打一行前文**：本审计会把"文件名里带空格"（`…10月11日 星期日.png`）
  // 与"花括号展开"（`{png,webview.png}`）切成半截，切出来的那半截必然 MISSING。
  // 不去写一条自动改判的启发式 —— "前面是空格"这个形状与"这句话里正常提到某个图"完全一样，
  // 用它改判会把**真的欠账**也一起藏掉，那比多三行噪声贵得多。
  if (s !== 'TRACKED') for (const r of g) {
    console.log(`  ${r.count}x  ${r.p}   ← ${r.where}`);
    if (s === 'MISSING') console.log(`        前文: ${JSON.stringify(r.pre ?? '')}`);
  }
}
