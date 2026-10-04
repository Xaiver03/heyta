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

console.log(`取样：${doc.startsWith(root + '/') ? doc.slice(root.length + 1) : doc}（C1 表 ${lines.slice(start, end).length} 行区间）`);
console.log(
  `C1 行 ${rows.length} 行 ⇒ 有对照节 ${rows.length - uncov.length} / 例外 ${excused.length} / 未覆盖 ${unexcused.length}；C1b 节 ${sections.length} 个（有推荐 ${sections.filter(hasRec).length} / 标题写明不需要拍 ${excusedSections.length} / 缺推荐 ${noRec.length}）`,
);

const dump = (title, list, line) => {
  if (!list.length) return;
  console.log(`\n${title}（${list.length} 条）：`);
  for (const r of list) console.log(line(r));
};
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
dump('· 例外（只从节标题里认）', excusedSections, (s) => `  :${s.line} ${s.title.slice(0, 46)}`);

// 逐节读数（含覆盖到的行号），让覆盖面可数而不是一个总数
console.log('\n逐节读数：');
for (const s of sections) {
  const urls = (s.body.match(/https?:\/\/\S+/g) || []).length;
  const fls = (s.body.match(new RegExp(FILELINE.source, 'g')) || []).length;
  const dates = new Set((s.body.match(new RegExp(DATE.source, 'g')) || [])).size;
  console.log(
    `  :${String(s.line).padStart(4)} ${s.title.split('（')[0].padEnd(9)} 覆盖=[${s.refs.join(',')}] 日期=${dates} URL=${urls} file:line=${fls} 未核实标记=${(s.body.match(/未核实/g) || []).length} 推荐=${
      hasRec(s) ? '有' : SECTION_EXC.test(s.title) ? '例外(标题)' : '🔴无'
    }`,
  );
}

const bad = unexcused.length + orphanSections.length + weak.length + noRec.length;
console.log(
  `\n结论：${
    bad === 0
      ? 'C1 每一行要么有对照节、要么写明例外类别；每个对照节都有日期、出处与推荐那一档（或标题写明不需要拍）✅'
      : `🔴 ${bad} 处不成立`
  }`,
);
process.exit(bad === 0 ? 0 : 1);
