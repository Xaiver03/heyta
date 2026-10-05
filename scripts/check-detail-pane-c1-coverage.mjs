#!/usr/bin/env node
// C1（要拍的值）与 C1b（别人怎么做的）之间的对账判据 —— 把工单目标第 1 条
// 「先对卡住工单的待拍值做外部调研，带日期+出处+未核实标记，把结论**与推荐**写回 C1 表」
// 从一句**散文承诺**变成一个能失败的属性。
//
// 为什么必须有：C1 那张表用的是"每一行都要有一个 C1b 对照节"这种**封闭句式**，
// 而封闭句式没有对账门禁时，句式本身就是一条会悄悄烂掉的断言
// （本仓库为法务条款里同一形状的句式修过一次：AGENTS §9「2026-10-03 批次」L' 那条）。
// 今天往 C1 加第 14 行、不写对照节，不会有任何东西失败 —— 而这正是目标第 1 条要防的事。
//
// 🔴 例外**不在本脚本里另立一张表**（那是一份会漂的抄件）：例外的判据就是那一行自己写的理由，
// 且理由必须命中下面的**封闭类别**。随便写一句"已处理"不算例外 —— 绕过判据最省力的写法
// 恰好就是填一个理由，所以类别是封闭的。
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// `--root DIR`：合流预检把候选树解到 /tmp 后在那里跑（那种目录没有 git 索引）。
// 本判据只看文档结构，索引本来就用不上 —— 加这个旋钮只是为了**不必在 /tmp 里跑 git**。
const rootIdx = process.argv.indexOf('--root');
let root;
if (rootIdx === -1) {
  // 默认仍是仓库根（从子目录跑也要能找到 `docs/…`）；拿不到就退回 cwd ——
  // 产物树模式（`--root`）本来就没有索引，所以这里不因为 git 缺失而失败。
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    root = process.cwd();
  }
} else {
  root = process.argv[rootIdx + 1];
}
const DEFAULT_DOC = 'docs/research/detail-pane-alignment-and-spaced-review.md';
// 🔴 `--root` 的实参不是文档：不排掉它，产物树模式下 `docArg` 会拿到那枚目录，
// `existsSync` 为真、`readFileSync(dir)` 直接 EISDIR —— 症状是"判据自己崩了"，不是"查到红"。
const argv = process.argv;
const docArg = argv.slice(2).find((a, i) => !a.startsWith('--') && i + 2 !== rootIdx + 1);
// 绝对路径原样收（变异臂的夹具在库外）：`join(root, '/tmp/x.md')` 会拼成 `root/tmp/x.md`，
// 那种"文件不存在"的红会报在错的对象上。
const doc = docArg ? (docArg.startsWith('/') ? docArg : join(root, docArg)) : join(root, DEFAULT_DOC);
if (!existsSync(doc)) {
  console.log(`🔴 取样文档不存在：${doc}`);
  process.exit(1);
}
const text = readFileSync(doc, 'utf8');
const lines = text.split('\n');

// —— C1 表：`## C1.` 与 `## C1b` 之间那些以 `| <数字> |` 开头的行
const start = lines.findIndex((l) => /^## C1[.．]/.test(l.trim()));
const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
if (start === -1 || end === -1) {
  console.log('🔴 找不到 `## C1.` 到下一个 `## ` 之间的区间 —— 表被改名或挪走，本判据拒绝报绿。');
  process.exit(1);
}
const rows = [];
for (let i = start; i < end; i += 1) {
  const m = lines[i].match(/^\|\s*(\d+)\s*\|(.*)$/);
  if (m) rows.push({ n: Number(m[1]), body: m[2], line: i + 1 });
}
if (rows.length === 0) {
  console.log('🔴 C1 表解析出 0 行（抽取形状坏了 = 覆盖数 0 看起来像"全部已覆盖"）—— 拒绝报绿。');
  process.exit(1);
}

// —— C1b 节：标题里用 `= C1 #N` 或 `#N 做不做` 这类形状回指行号
const sections = [];
for (let i = 0; i < lines.length; i += 1) {
  const m = lines[i].match(/^### (C1b-[^\n]*)$/);
  if (!m) continue;
  const title = m[1];
  let j = i + 1;
  while (j < lines.length && !/^###? /.test(lines[j])) j += 1;
  const body = lines.slice(i + 1, j).join('\n');
  const refs = [...title.matchAll(/#(\d+)/g)].map((x) => Number(x[1]));
  sections.push({ title, line: i + 1, refs, body });
}
if (sections.length === 0) {
  console.log('🔴 C1b 节解析出 0 个 —— 同上，拒绝报绿。');
  process.exit(1);
}

const coveredBy = new Map();
for (const s of sections) for (const n of s.refs) {
  if (!coveredBy.has(n)) coveredBy.set(n, []);
  coveredBy.get(n).push(s.title.split('（')[0]);
}

// 封闭类别：两类"不需要外部调研"的合法情形。判定只看那一行**自己怎么写**，
// 命中不到任何一类 ⇒ 按未覆盖处理（红）。
const EXCATEGORIES = [
  ['已核-不需要拍', /已核[^。]{0,20}不需要拍|不需要拍/],
  ['不是要拍的值-已随工单落码', /不是.要拍的值.|没有\s*C1b\s*对照节/],
];

const DATE = /20\d\d-\d\d-\d\d/;
const URLRE = /https?:\/\//;
// file:line 也算出处 —— 本线有一节（C1b-Q7）的取证全是读源码，零 URL。
// 把"必须有 URL"写成判据会逼着那种节塞链接凑数，而那正是目标第 1 条反过来的东西。
const FILELINE = /[\w./-]+\.(ts|tsx|js|mjs|json|css|md|swift|kt|ets|java|py|sh):\d+/;

const uncov = rows.filter((r) => !coveredBy.has(r.n));
const excused = uncov.filter((r) => EXCATEGORIES.some(([, re]) => re.test(r.body)));
const unexcused = uncov.filter((r) => !EXCATEGORIES.some(([, re]) => re.test(r.body)));

const orphanSections = sections.filter((s) => s.refs.some((n) => !rows.some((r) => r.n === n)));
const weak = sections.filter((s) => !DATE.test(s.body) || (!URLRE.test(s.body) && !FILELINE.test(s.body)));

// 腿 4：每个对照节必须给出**推荐**那一档。
// 为什么单独一条：目标第 1 条的原话是"把结论**与推荐**写回"，而上面那三档只判"有没有日期与出处" ——
// 2026-10-04 现量：把 C1b-Q6 的整段推荐摘掉，本判据仍然报绿（那是"取证做完了但没给答案"的形状，
// 恰恰是这一条要拦的）。
// 🔴 形状取本文档自己的写法约定：**行首加粗标签 + 冒号**，且标签里含「推荐/建议」
// （现量 8/9 节全是这个形状，第 9 节走下面的例外档）。
// ⚠️ 只认行首加粗标签，**不**写成"整节含「推荐」二字即算"：C1b-Q8 那张表里就有 Apple 原文
//   "we recommend using a tertiary button" 的中文转述 —— 按整节含词判会把**别人的话**当成我们的推荐，
//   摘掉推荐段照样绿，等于这条腿没有牙。
// ⚠️ 词形收 推荐|建议 两个：只认「推荐」的话，下一轮谁写成「建议」就把这一节整节读成"没给答案"，
//   判据静默失去对象（同一批在 §8 表腿 7 上实测过：触发词表只认一种字面形状就是这条路）。
const REC_LABEL = /^\*\*([^*\n]{1,40})\*\*[：:]/;
const REC_WORD = /推荐|建议/;
const hasRec = (s) => s.body.split('\n').some((l) => REC_LABEL.test(l) && REC_WORD.test(l.match(REC_LABEL)[1]));
// 例外档**只从节标题里认**，不扫正文 —— 现量理由：C1b-Q1 正文里有一句
// "⇒ 这条可以直接写进 W4 的判据，不需要拍板"，那是**别的事**的措辞。若扫正文，
// 那一节哪天真的没了推荐就会被这句现成的话豁免掉（绕过判据最省力的写法就是复用别人的句子）。
const SECTION_EXC = /已核[^。]{0,20}不需要拍|不需要拍/;
const noRec = sections.filter((s) => !hasRec(s) && !SECTION_EXC.test(s.title));
const excusedSections = sections.filter((s) => !hasRec(s) && SECTION_EXC.test(s.title));

// 腿 5：回指**待拍值**的对照节必须有**外部锚** —— URL，或指向第三方源码的 `file:line`。
// 为什么单独一条：目标第 1 条的原话是"做**外部**调研（**别人怎么做的**），带日期+出处"，
// 而上面那条 weak 只问"有没有出处"，自家代码的 `packages/x.ts:12` 也算 ——
// 于是"只读了我们自己的代码"那种节可以全绿过关，而它恰恰没有回答"别人怎么做的"。
// 🔴 自家/第三方**按路径形状分**，不靠登记表：本仓顶层目录（AGENTS §2 那张仓库地图）开头的算自家，
//   其余（裸文件名 `StreakList.kt:48`、克隆里的相对路径 `cards/OverviewCard.kt:47`、
//   `website/common/script/ops/scoreTask.js:326`、`research/…` 下的 vendored 克隆）算第三方。
//   20:2x 现量：本档**没有一条**第三方引用写成 `research/` 前缀（33 条全写成裸文件名/相对路径），
//   所以第一版按 `research/` 认出来的第三方数 = 0 —— 一条没有样本的分支不算判据，改成按顶层目录反向认。
// ⚠️ 这一条**不是**"必须有 URL"：把口径写成"必须 URL"会逼那种节塞链接凑数，
//   那正是目标第 1 条反过来的东西（与 weak 那条同一个理由）。
// 例外档仍只从**节标题**认（`不需要拍`）：那一行的题本身不需要"别人怎么做的"，所以对它这一档不适用。
// ⚠️ 例外**只从标题认，绝不扫正文** —— 理由与腿 4 同一件事故（正文里现成的别人那句话会顶掉我们这一档）。
const OWN_PATH = /^(packages|apps|server|scripts|e2e|docs)\//;
// 🔴 但**裸文件名**不算第三方。腿 5 的第一版按"有没有本仓顶层目录前缀"反向认，
//   于是自家文件写成 `ListsSection.tsx:174`（2026-10-04 21:5x 实测自己就这么写过）会被数成
//   "第三方源码引用"，那一节于是拿到 `外部锚=有` —— 而这恰恰是腿 5 存在的理由（自家行号不许冒充外部证据）。
//   ⇒ 现在把裸名拿 `git ls-files` 的**在册文件名**对一次：在仓库里有同名文件的裸名算自家。
//   ⚠️ 产物树模式（`--root`，合流预检解到 /tmp 的那棵树）里没有索引 ⇒ 这一档**判不了**，
//      如实打出来并**不改判**（宁可漏判也不在缺信息时红别人的文档）。
let trackedNames = null;
let trackedWhy = '';
try {
  trackedNames = new Set(
    execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n')
      .filter(Boolean)
      .map((p) => p.split('/').pop()),
  );
} catch (e) {
  trackedWhy = String(e.shortMessage || e.message).split('\n')[0].slice(0, 60);
}
const OWN_BY_BASENAME = (ref) => {
  if (!trackedNames) return false;
  if (ref.includes('/')) return false;
  return trackedNames.has(ref.split(':')[0]);
};
const flsOf = (body) => body.match(new RegExp(FILELINE.source, 'g')) || [];
const extFlOf = (body) => flsOf(body).filter((p) => !OWN_PATH.test(p) && !OWN_BY_BASENAME(p));
const ownFlOf = (body) => flsOf(body).filter((p) => OWN_PATH.test(p) || OWN_BY_BASENAME(p));
const hasExternal = (s) => URLRE.test(s.body) || extFlOf(s.body).length > 0;
const noExt = sections.filter((s) => !hasExternal(s) && !SECTION_EXC.test(s.title));
const excusedExt = sections.filter((s) => !hasExternal(s) && SECTION_EXC.test(s.title));

// 腿 6：**未核实台账**（`## B6.` / `## C2.`）的每一条必须写明怎么关掉它。
// 为什么落在台账而不是落在 C1b 各节：目标第 1 条那句"带日期+出处+**未核实标记**"，
// 本文档的实现方式是把未核实项**集中登记**到 B6/C2（各节里只留指针），所以"每节 ≥1 枚
// 未核实字样"那种形状与文档自己的组织约定冲突 —— 会逼着已经核完的节去伪造一枚标记。
// 于是这一档问的是台账本身的老问题：2026-10-04 21:3x 现量 34 条未核实项里只有 3 条写了
// 「补法」⇒ 31 条只说明"这条不算依据"，不说明"下一轮靠什么把它算依据"，也没有一条写明
// 拿不到。那种台账会在每一轮被重读一遍、每一轮都原地重新推断一次成本。
// 🔴 三档词表是封闭的，且**划线不算结案**：`~~…~~` 只表示"原句被推翻"，被推翻的条目里
//   仍然常带一条活的尾巴（现量：C2 #1 划掉的是"右栏放什么"，尾巴是"其余 6 个视图仍未穷举"）。
//   真要结案就写 `结案取证：` —— 让结案这个动作留下证据，而不是留下删除线。
// 🔴 标签位置：B6 #1/#2 是**行内**写法（"…只证到 PMID。补法：取 SAGE DOI 原文 PDF"），
//   C2 #21 是**独立续行**写法 —— 只认行首会把已有补法的两条读成缺，那是探针形状错不是内容缺。
//   所以取"标签前是行首/空白/句读"这一档，且仍要求紧跟冒号（"这条的补法以后再想"不算有补法）。
const CLOSER_LABEL = /(?:^|[\s。；，])\*{0,2}(?:补法|不可补|结案取证)\*{0,2}\s*[：:]/;
const ledgerItems = [];
for (const headRe of [/^## B6[.．]/, /^## C2[.．]/]) {
  const s = lines.findIndex((l) => headRe.test(l.trim()));
  if (s === -1) {
    console.log('🔴 未核实台账小节整段找不到（B6 或 C2 被改名/挪走）—— 分母为空，本判据拒绝报绿。');
    process.exit(1);
  }
  let e = s + 1;
  while (e < lines.length && !/^## /.test(lines[e])) e += 1;
  let cur = null;
  for (let i = s + 1; i < e; i += 1) {
    const m = lines[i].match(/^(\d+)\.\s/);
    if (m) {
      // 批次说明行（"第二批（…）："）不带编号，天然进不到这里；`---` 分隔线也不算条目的一部分
      if (cur) ledgerItems.push(cur);
      cur = { head: headRe.source, n: Number(m[1]), line: i + 1, body: [lines[i]] };
      continue;
    }
    if (!cur) continue;
    if (/^---\s*$/.test(lines[i])) {
      ledgerItems.push(cur);
      cur = null;
      continue;
    }
    cur.body.push(lines[i]);
  }
  if (cur) ledgerItems.push(cur);
}
const openLedger = ledgerItems.filter((it) => !it.body.some((l) => CLOSER_LABEL.test(l)));
const closedLedger = ledgerItems.filter((it) => it.body.some((l) => CLOSER_LABEL.test(l)));
const perLedger = Object.entries(
  ledgerItems.reduce((acc, it) => {
    acc[it.head] = (acc[it.head] || 0) + 1;
    return acc;
  }, {}),
);

// 腿 7：Markdown 的表格行**必须是一个物理行**。
// 为什么 C1 表要单独有一条：上面那些腿是用正则从 `| N |` 起手的行里**取前几格**的，
// 一行被写成两个物理行时，第一行照样匹配、照样被计数，于是"这一行有对照节/有推荐"全部成立，
// 而它在渲染里根本不是表格 —— 状态等于没人记。§8.135 在工单表上实测过一次（那枚红活了
// 12 趟门禁没人看见），2026-10-05 本线在 C1 表的 #14 行上**又**踩了一次，所以这一档从
// "靠人眼"改成"有腿"。形状判据：起头是竖线而不以竖线收尾，或不以竖线起头却以竖线收尾
// （后者是断行的尾巴），两种都算断。围栏代码块跳过；引用块里的表格行（`> | …`）先剥前缀再判。
const brokenRows = [];
{
  let fence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (/^```/.test(raw.trim())) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const t = raw.replace(/^>\s?/, '').trimEnd();
    if (!t.includes('|')) continue;
    const starts = t.startsWith('|');
    const ends = t.endsWith('|');
    if (starts !== ends) brokenRows.push({ line: i + 1, kind: starts ? '起而不收' : '收而不起', text: t.slice(0, 64) });
  }
}

console.log(`取样：${doc.startsWith(root + '/') ? doc.slice(root.length + 1) : doc}（C1 表 ${lines.slice(start, end).length} 行区间）`);
console.log(
  `C1 行 ${rows.length} 行 ⇒ 有对照节 ${rows.length - uncov.length} / 例外 ${excused.length} / 未覆盖 ${unexcused.length}；C1b 节 ${sections.length} 个（有推荐 ${sections.filter(hasRec).length} / 标题写明不需要拍 ${excusedSections.length} / 缺推荐 ${noRec.length}）（有外部锚 ${sections.filter(hasExternal).length} / 缺外部锚 ${noExt.length} / 标题豁免 ${excusedExt.length}）`,
);

const dump = (title, list, line) => {
  if (!list.length) return;
  console.log(`\n${title}（${list.length} 条）：`);
  for (const r of list) console.log(line(r));
};
console.log(
  `承重(腿5)：在册文件名 ${
    trackedNames
      ? `${String(trackedNames.size)} 枚 —— 裸名 file:line 命中它就算**自家**，不算外部锚`
      : `取不到 ⇒ 裸名这一档判不了，本轮一律按第三方算（原因：${trackedWhy}）`
  }`,
);
dump('🔴 要拍的值没有 C1b 对照节，也没写清属于哪一类例外', unexcused, (r) => `  :${r.line} #${r.n} ${r.body.slice(0, 70)}…`);
dump('· 例外（类别从那一行自己的文本里认）', excused, (r) => {
  const [name] = EXCATEGORIES.find(([, re]) => re.test(r.body));
  return `  :${r.line} #${r.n} → 类别「${name}」`;
});
dump('🔴 C1b 节回指了表里不存在的行号（研究了不存在的题）', orphanSections, (s) => {
  const bad = s.refs.filter((n) => !rows.some((r) => r.n === n));
  return `  :${s.line} ${s.title.slice(0, 46)} —— 缺行号 ${bad.join(',')}`;
});
dump('🔴 C1b 节缺日期或缺出处（URL 或 file:line 择一即可）', weak, (s) => {
  const hasDate = DATE.test(s.body);
  const hasUrl = URLRE.test(s.body);
  const hasFile = FILELINE.test(s.body);
  return `  :${s.line} ${s.title.slice(0, 46)} —— 日期=${hasDate} URL=${hasUrl} file:line=${hasFile}`;
});
dump('🔴 C1b 节没有「推荐/建议」那一档，标题也没写明不需要拍（取证齐了但没给答案）', noRec, (s) => {
  const labels = s.body.split('\n').filter((l) => REC_LABEL.test(l)).map((l) => l.match(REC_LABEL)[1]);
  return `  :${s.line} ${s.title.split('（')[0]} —— 行首加粗标签=[${labels.join(' / ') || '（无）'}]`;
});
dump('🔴 C1b 节只有自家路径的 file:line 而没有 URL，也没有第三方源码引用（没回答"别人怎么做的"）', noExt, (s) => {
  const own = ownFlOf(s.body);
  const shown = own.length ? `${own.slice(0, 4).join(' ')}${own.length > 4 ? ' …' : ''}` : '（无）';
  return `  :${s.line} ${s.title.split('（')[0]} —— 自家路径引用=[${shown}]`;
});
dump('· 例外（只从节标题里认）', excusedSections, (s) => `  :${s.line} ${s.title.slice(0, 46)}`);
dump(
  '🔴 未核实台账里这条没写「补法 / 不可补 / 结案取证」中的任何一档（只说明"不算依据"，不说明"下一轮怎么关掉它"）',
  openLedger,
  (it) => `  :${it.line} ${it.head === '^## B6[.．]' ? 'B6' : 'C2'} #${it.n} ${it.body[0].replace(/^\d+\.\s*/, '').slice(0, 58)}…`,
);

dump('🔴 这一行不是完整的表格行（Markdown 里表格行必须是一个物理行 ⇒ 它在渲染中不是表格，状态等于没人记）', brokenRows, (r) => `  :${r.line} ${r.kind} —— ${r.text}…`);

// 逐节读数（含覆盖到的行号），让覆盖面可数而不是一个总数
console.log(`\n承重(腿6)：${perLedger.map(([h, n]) => `${h === '^## B6[.．]' ? 'B6' : 'C2'} ${n} 条`).join('｜')}｜已结案档 ${closedLedger.length}｜缺 ${openLedger.length}（三档词表：补法/不可补/结案取证；划线不结案）`);
console.log(`承重(腿7)：非围栏区里以竖线起头或收尾的行 ${lines.filter((l) => { const t = l.replace(/^>\s?/, '').trim(); return t.startsWith('|') || t.endsWith('|'); }).length} 行参与形状判 ⇒ 断成多个物理行的 ${brokenRows.length} 处（一条表格行 = 一个物理行；否则它在渲染里根本不是表格，那一格的状态等于没人记）`);
console.log('\n逐节读数：');
for (const s of sections) {
  const urls = (s.body.match(/https?:\/\/\S+/g) || []).length;
  const fls = flsOf(s.body).length;
  const extFl = extFlOf(s.body).length;
  const dates = new Set((s.body.match(new RegExp(DATE.source, 'g')) || [])).size;
  console.log(
    `  :${String(s.line).padStart(4)} ${s.title.split('（')[0].padEnd(9)} 覆盖=[${s.refs.join(',')}] 日期=${dates} URL=${urls} file:line=${fls}（第三方 ${extFl}） 外部锚=${hasExternal(s) ? '有' : '🔴无'} 未核实标记=${(s.body.match(/未核实/g) || []).length} 推荐=${
      hasRec(s) ? '有' : SECTION_EXC.test(s.title) ? '例外(标题)' : '🔴无'
    }`,
  );
}

const bad = unexcused.length + orphanSections.length + weak.length + noRec.length + noExt.length + openLedger.length + brokenRows.length;
console.log(
  `\n结论：${
    bad === 0
      ? 'C1 每一行要么有对照节、要么写明例外类别；每个对照节都有日期、出处、**外部锚**（URL 或第三方源码行号）与推荐那一档（或标题写明不需要拍）；未核实台账逐条带「补法 / 不可补 / 结案取证」；正文里每条表格行都是一个完整的物理行 ✅'
      : `🔴 ${bad} 处不成立（含腿 7 的断行 ${brokenRows.length} 处）`
  }`,
);
process.exit(bad === 0 ? 0 : 1);
