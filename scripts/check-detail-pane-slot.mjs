#!/usr/bin/env node
/**
 * 详情列**槽里放什么**的常驻门禁（工单 `docs/plans/detail-pane-alignment.md` §6 的第 1、2、3 行）。
 * =============================================================================
 *
 * 工单 §6 那张"明确不做"表在 §8.39 被逐行量过一次：9 行里只有 3 行有常驻载体，
 * 其中"不许抄滴答的空态插画""不许抄侧栏那两张空态引导卡""不许用 emoji 当图标"这三行的载体是
 * 两个 `/tmp` 里的一次性探针 —— 跑完就没了。🔴 一次性探针挡不住**下一轮**有人加进去：
 * 那三行当时能读成"没做"，六周后就不能了，而没有任何一层会失败。本脚本把那三行钉成常驻判据。
 *
 * ## 射程怎么定的（这是本文件最重要的一段）
 *
 * 不写死文件清单 —— 写死的清单就是下一份会漂的抄件。射程**从代码里解析出来**：
 *
 *   1. 在 `apps/web/src/App.tsx` 里找 `data-testid="detail-column"` 那枚 `<aside>`，
 *      按 `<aside` / `</aside>` 的配对算出"槽区域"；
 *   2. 槽区域里出现的每个大写组件标签，回到 App.tsx 的 import 语句解析成仓库内文件 ——
 *      那些文件就是"往槽里画东西的生产者"，**全部纳入扫描**；
 *   3. 解析不到的（比如从 workspace 包来的组件）**大声列出来**，不静默当成扫过了。
 *
 * ⇒ 以后谁往槽里加一个新的内容组件，扫描射程**自动**把它算进去，不需要改这个脚本。
 *
 * ## 四条腿
 *
 * | 腿 | 判的是什么 | 对应 §6 哪一行 |
 *|---|---|---|
 * | A 槽内不许手写标记 | 槽区域里出现小写 DOM 标签（`<img>` `<div>` `<p>` …）或裸文本 ⇒ 红。槽的内容必须由"内容生产者"组件提供；装配处手写标记就是"往槽里塞装饰"的形状 | 2、3 |
 * | B 不许装饰性图形 | 槽区域 + 每个生产者文件里出现 位图/矢量插画/`Illustration`/`插画` 这类形状 ⇒ 红。⚠️ **Lucide 图标不算**（`icon={…}` 走的是共享 `EmptyState`，AGENTS §5 要的就是它） | 2 |
 * | C 不许 emoji 当图标/文案 | 同样范围内，**剥掉注释之后**出现 emoji 码位 ⇒ 红 | 1 |
 * | D 引导卡形状 | 同样范围内出现「引导 / 新手 / onboarding」⇒ 红（滴答侧栏那两张卡片的形状；§6 第 3 行明文不抄，且被第二批截图二次印证它吃纵向空间） | 3 |
 *
 * 🔴 **腿 C 为什么要剥注释**：§8.39 那次探针的口径改了三次才站住 —— 整行扫会命中 43 处，
 * 而那些全是注释里我自己写的状态记号 🔴⚠️（"渲染出来"的 emoji 是 0）。
 * 判"界面上出现 emoji"就必须只看会被渲染的部分；被剥掉的那几条是**承重数**，会打在读数里。
 *
 * ## 非空哨兵与"射程没变窄"的自检
 *
 * 槽解析不出来 ⇒ 红（不是跳过）。生产者解析出 0 个 ⇒ **不算红**（今天其余视图的槽本来就空着，
 * 那是 §6.2 的设计），但会把这件事连同"腿 B/C/D 这一趟实际扫了几行"一起打出来：
 * 分母为 0 的 0 命中不构成证据，读的人要看得见分母。
 *
 * ## 跑法
 *
 *   node scripts/check-detail-pane-slot.mjs              # 本检出
 *   node scripts/check-detail-pane-slot.mjs --root <dir> # 换一棵树（合流预检的产物载体用）
 *
 * 变异装置：`research/tools/mutation-rigs/mutate-detail-pane-slot.mjs`（各臂红在哪条腿写在装置里）。
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

const rootArgIdx = process.argv.indexOf('--root');
const ROOT = rootArgIdx === -1
  ? execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  : resolve(process.argv[rootArgIdx + 1]);

const APP = join(ROOT, 'apps/web/src/App.tsx');
const failures = [];
const notes = [];
const fail = (title, items) => {
  if (!items.length) return;
  failures.push(title);
  items.forEach((l) => failures.push(`      · ${l}`));
};

if (!existsSync(APP)) {
  console.log(`🔴 取样文件不存在：${APP.slice(ROOT.length + 1) || APP} —— 这一趟没有读数，按红处理。`);
  console.log('结论：详情列槽位判据**没能跑**（0 条判据成立，不等于全部成立）');
  process.exit(1);
}

const appSrc = readFileSync(APP, 'utf8');

// —— 1. 槽区域：按 <aside …> / </aside> 配对，不猜行号
const openRe = /<aside\b[^>]*data-testid="detail-column"[^>]*>/g;
const openMatch = openRe.exec(appSrc);
if (!openMatch) {
  console.log('🔴 在 App.tsx 里找不到带 `data-testid="detail-column"` 的 <aside>。');
  console.log('      ⇒ 槽被改名/拆掉/挪走了。本判据不会替你判断"这是不是有意为之"，它只拒绝继续读一个它看不见的东西。');
  console.log('结论：详情列槽位判据没能跑');
  process.exit(1);
}
const regionStart = openMatch.index;
let depth = 0;
let regionEnd = -1;
const tagRe = /<aside\b[^>]*\/>|<aside\b|<\/aside>/g;
tagRe.lastIndex = regionStart;
for (let m = tagRe.exec(appSrc); m; m = tagRe.exec(appSrc)) {
  if (m[0].endsWith('/>')) { if (depth === 0) { regionEnd = m.index + m[0].length; break; } depth -= 1; continue; }
  if (m[0] === '</aside>') {
    depth -= 1;
    if (depth === 0) { regionEnd = m.index + m[0].length; break; }
  } else depth += 1;
}
// 🔴 分流"结构判据跑不了"的两种成因 —— 它们的处置完全相反，所以**必须在配对结论之前**跑：
//  ① 槽区域内还留着**冲突标记** ⇒ 这是 §8.47 第 3 节没做完，不是产品缺陷。两侧各自都写了一枚
//     `<aside data-testid="detail-column">`（main 侧装 AI 面，本批侧装专注面），而真实现场里
//     **配对失败正是 marker 造成的**（两个开标签 + 一个闭标签）⇒ 把 marker 判据放在配对之后，
//     产物树里永远只会读到"配对解析不出来"，这条分流形同没写。
//  ② 真的没有闭合（有人把 `</aside>` 拆走了）⇒ 判据够不着对象，也是红，但要人去看代码而不是去清 marker。
// ⚠️ 上面这句不是推演：A6 那一臂造的靶是**闭合平衡**的 marker 形状，于是它在判据放错顺序时仍然通过。
//    真实现场的形状记在装置 A7（工单 §8.75）。
{
  const afterOpen = appSrc.slice(regionStart);
  const closeIdx = afterOpen.indexOf('</aside>');
  const scannedWindow = afterOpen.slice(0, closeIdx === -1 ? afterOpen.length : closeIdx);
  if (/^<<<<<<< |^=======|^>>>>>>> /m.test(scannedWindow)) {
    console.log('🔴 槽区域里仍带冲突标记（`<<<<<<<` / `=======` / `>>>>>>>`）⇒ 详情列这一格**两侧各写了一份内容**，结构判据无法判断。');
    console.log('      这一档不是"槽里有装饰"，也不是"合并合坏了"：它是 §8.47 第 3 节那一枚 App.tsx 冲突还没裁决。');
    console.log('      处置：择一/并排裁决之后重跑本判据（工单 §8.75 记的是这一格的产品侧含义）。');
    console.log('结论：详情列槽位判据没能跑（marker 未清）');
    process.exit(1);
  }
}
if (regionEnd === -1) {
  console.log('🔴 那枚 <aside> 的闭合标签配对解析不出来（`<aside` 与 `</aside>` 数不上）⇒ 槽区域读不到，按红处理。');
  console.log('结论：详情列槽位判据没能跑');
  process.exit(1);
}
const region = appSrc.slice(regionStart, regionEnd);
// 🔴 腿 A 判的是**槽里面**写了什么，所以要把那枚 `<aside>` 自身摘掉再扫 ——
// 第一版直接扫整段区域，于是 `<aside>` 自己就成了"手写 DOM 标记"，门禁在**干净代码上**报红。
// 这种红长得像"有人往槽里塞了东西"，其实是探针把容器算进了内容。
const inner = region.replace(/^<aside\b[^>]*>/, '').replace(/<\/aside>\s*$/, '');
const regionLines = region.split('\n').length;

// —— 2. 生产者：槽里面（不含那枚 <aside> 自身）的大写标签 → App.tsx 的 import → 仓库内文件
const usedComponents = [...new Set([...inner.matchAll(/<([A-Z][A-Za-z0-9.]*)\b/g)].map((m) => m[1].split('.')[0]))];
const importRe = /^import\s+(?:([A-Z][A-Za-z0-9]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/gm;
const importedFrom = new Map();
for (let m = importRe.exec(appSrc); m; m = importRe.exec(appSrc)) {
  const spec = m[3];
  if (m[1]) importedFrom.set(m[1], spec);
  for (const rawName of (m[2] || '').split(',')) {
    const name = rawName.trim().split(/\s+as\s+/).pop();
    if (name) importedFrom.set(name, spec);
  }
}
const producers = [];
const unresolved = [];
for (const name of usedComponents) {
  const spec = importedFrom.get(name);
  if (!spec || !spec.startsWith('.')) { unresolved.push(`${name} ← ${spec || '（App.tsx 里没有它的 import）'}`); continue; }
  const base = dirname(join(ROOT, 'apps/web/src/App.tsx'));
  const cleaned = spec.replace(/\.js$/, '');
  const cands = [join(base, `${cleaned}.tsx`), join(base, `${cleaned}.ts`), join(base, cleaned, 'index.tsx')];
  const hit = cands.find((c) => existsSync(c));
  if (!hit) { unresolved.push(`${name} ← ${spec}（解析不到仓库内文件）`); continue; }
  producers.push({ name, file: hit });
}

// —— 3. 扫描范围 = 槽区域本身 + 每个生产者文件（剥注释后判）
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const sources = [{ label: 'App.tsx 的槽里面', raw: inner }, ...producers.map((p) => ({ label: p.name, raw: readFileSync(p.file, 'utf8') }))];
const bodies = sources.map((s) => ({ label: s.label, text: stripComments(s.raw) }));
const scannedLines = bodies.reduce((sum, b) => sum + b.text.split('\n').length, 0);

// 腿 A：槽里面不许手写 DOM 标记 / 裸文本
const tagsInRegion = [...inner.matchAll(/<([A-Za-z][A-Za-z0-9.]*)/g)].map((m) => m[1]);
const handWritten = tagsInRegion.filter((t) => /^[a-z]/.test(t));
const outsideTags = inner
  .replace(/<[^>]*>/g, '')
  .replace(/\{[^{}]*\}/g, '')
  .replace(/[{}()?:;=<>]/g, '')
  .trim();
const strayText = outsideTags.length > 0 && !/^\s*$/.test(outsideTags) ? [outsideTags.slice(0, 60)] : [];
fail('🔴 腿 A：槽里手写了 DOM 标记或裸文本 —— 装配处只许放"内容生产者"组件（§6 第 2、3 行的形状就是从这里进来的）',
  [...handWritten.map((t) => `<${t}> 直接写在槽里`), ...strayText.map((s) => `裸文本：${JSON.stringify(s)}`)]);

// 腿 B：装饰性图形
const DECOR = [
  { re: /<img\b/g, why: '位图标签' },
  { re: /<Image\b/g, why: 'RN <Image>（照片/插画通道）' },
  { re: /<svg\b|\.svg['")\]]/g, why: '矢量插画通道' },
  { re: /\.png['")\]]|\.jpg['")\]]|\.webp['")\]]|\.jpeg['")\]]/g, why: '位图资产引用' },
  { re: /[Ii]llustration/g, why: 'illustration 形状' },
  { re: /插画/g, why: "「插画」字样（注释已剥，所以这是会被渲染或至少是代码里的概念）" },
];
const decorHits = [];
for (const b of bodies) {
  for (const d of DECOR) {
    const n = (b.text.match(d.re) || []).length;
    if (n) decorHits.push(`${b.label}：${d.why} 命中 ${n} 处`);
  }
}
fail('🔴 腿 B：槽的射程内出现装饰性图形（§6 第 2 行：不抄滴答那套"无选中时空态插画"）', decorHits);

// 腿 C：emoji（剥注释后）
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu;
const emojiHits = [];
for (const b of bodies) {
  const n = (b.text.match(EMOJI) || []).length;
  if (n) emojiHits.push(`${b.label}：${n} 处 emoji 码位`);
}
const emojiCount = (t) => (t.match(EMOJI) || []).length;
// 承重数：各段"注释里的 emoji 记号"被剥掉了几处 —— §8.39 那次整行扫命中 43 条全是这类记号，
// 所以"剥掉的那几条"必须打出来，否则读的人分不清"没有 emoji"和"探针把 emoji 都当注释剥了"。
const commentEmoji = sources.reduce((sum, s) => sum + Math.max(0, emojiCount(s.raw) - emojiCount(stripComments(s.raw))), 0);
fail('🔴 腿 C：槽的射程内出现 emoji（AGENTS §5 硬错 + §6 第 1 行：图标统一 Lucide 闭集）', emojiHits);

// 腿 D：引导卡形状
const GUIDE = /引导|新手|onboarding/i;
const guideHits = bodies.filter((b) => GUIDE.test(b.text)).map((b) => `${b.label}：出现「引导/新手/onboarding」字样`);
fail('🔴 腿 D：槽的射程内出现引导卡形状（§6 第 3 行：不抄侧栏那两张空态引导卡，它吃纵向空间）', guideHits);

// —— 读数
console.log(`取样：${APP.slice(ROOT.length + 1)}（--root 模式=${rootArgIdx !== -1 ? '是' : '否'}，树=${ROOT}）`);
console.log(`槽区域（含容器）：${regionLines} 行；解析出的内容生产者 ${producers.length} 枚（${producers.map((p) => p.name).join(' / ') || '无 —— 今天其余视图的槽按 §6.2 是空着的设计'}）`);
console.log(`扫描射程：${bodies.length} 段文本，剥注释后共 ${scannedLines} 行；命中 A=${handWritten.length + strayText.length} B=${decorHits.length} C=${emojiHits.length} D=${guideHits.length}`);
if (producers.length === 0) {
  console.log('⚠️ 这一趟没有生产者 ⇒ 腿 B/C/D 的射程只剩槽区域本身。绿只说"槽区域里没有装饰"，**不**说"槽里画出来的东西没有装饰"。');
}
if (unresolved.length) {
  console.log(`⚠️ 射程外（解析不到仓库内文件，本判据没有看它们）：${unresolved.join(' | ')}`);
}
if (commentEmoji > 0) {
  console.log(`（对照：射程里**注释中**的 emoji 记号 ${commentEmoji} 处被剥掉不计 —— §8.39 那条口径改了三次的教训，这几条是承重数）`);
}
if (failures.length) console.log(failures.join('\n'));
console.log(`结论：详情列槽位 —— 手写标记、装饰图形、emoji、引导卡 ${failures.length ? '🔴 有腿不成立' : '四条腿都成立 ✅'}`);
process.exit(failures.length ? 1 : 0);
