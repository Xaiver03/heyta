#!/usr/bin/env node
// 工单 §8 那张「单 / 状态 / 读数」落地记录表的形状判据。
//
// 为什么需要它（不是顺手加的一条）：目标第 4 条要求"每完成一单回填 §8 落地记录
// （读数含判据条数 / 变异臂红集 / 截图路径），状态只允许未开工/进行中/已完成，不许写基本完成"。
// 这句话一直**只有散文在守**。2026-10-04 16:5x 现量事故：W1 那一格把 19 行 prose（含一个 bash 围栏）
// 直接写在表格单元里，而 GFM 的表格遇到第一行非表格文本就结束 —— 于是整张表截断在 W1，
// W1b 往后 15 枚工单行全部渲染成正文里的裸竖线，**而"状态列写的是什么、有没有截图"没有任何东西在看**。
// 那一处是我自己在数"这张表有几枚工单行"（只认出 2 枚）时挖出来的。
//
// 🔴 判据不抄工单清单（那是一份会漂的抄件）：单元 id 从表里现读，只判四件事 ——
//   行闭合、状态词表封闭、"提了截图就得真有引用"、表外不许有孤儿行。
// ⚠️ 不判"列数等于表头"：本表读数栏**合法地**出现竖线（`ps … | grep …`、`a | b` 式并排列），
//   要分辨就得掩码码段，而掩码在本表上两次实测都漂（同一批行先读出 7 列再读出 2/4/5/4 列）。
//   一条在它的样本上说不清对错的判据不该用来拦事 —— 拦"行被拆成多行"这件事，
//   用"没有闭合竖线"这一条没有歧义的形状就够了。
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const rootIdx = process.argv.indexOf('--root');
const root =
  rootIdx === -1
    ? (() => {
        try {
          return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
        } catch {
          return process.cwd();
        }
      })()
    : process.argv[rootIdx + 1];
const argv = process.argv;
const docArg = argv.slice(2).find((a, i) => !a.startsWith('--') && a !== root && i + 2 !== rootIdx + 1);
const doc = docArg ? (docArg.startsWith('/') ? docArg : join(root, docArg)) : join(root, 'docs/plans/detail-pane-alignment.md');
if (!existsSync(doc)) {
  console.log(`🔴 取样文档不存在：${doc}`);
  process.exit(1);
}
const lines = readFileSync(doc, 'utf8').split('\n');

const HEADER = /^\|\s*单\s*\|\s*状态\s*\|\s*读数/;
const UNIT = /^\|\s*(W[0-9]+[a-z]?)\b/;
const IMG = /\.(?:png|jpg|jpeg|webp)/;

const head = lines.findIndex((l) => HEADER.test(l));
if (head === -1) {
  console.log('🔴 找不到 `| 单 | 状态 | 读数` 那张表 —— 表被改名或删掉，本判据拒绝报绿。');
  process.exit(1);
}

// 表区间：表头往下连续以 `|` 开头的行（这就是 GFM 对表格结束的定义，也是这次事故的成因）
const rows = [];
for (let i = head + 2; i < lines.length; i += 1) {
  if (!lines[i].startsWith('|')) break;
  const m = lines[i].match(UNIT);
  if (m) rows.push({ id: m[1], line: i + 1, text: lines[i] });
}
if (rows.length === 0) {
  console.log('🔴 数据行解析出 0 枚 —— 抽取形状坏了，"全部合规"在这种集合上是永真的，拒绝报绿。');
  process.exit(1);
}

const dumps = [];
const dump = (title, list, fmt) => {
  if (!list.length) return;
  dumps.push(`\n${title}（${list.length} 条）：`);
  for (const r of list) dumps.push(`  ${fmt(r)}`);
};

// 腿 1：闭合竖线
const unclosed = rows.filter((r) => !/\|\s*$/.test(r.text));

// 腿 2：状态词表封闭。**只看状态那一格**，而且是文本层取格（不掩码头），
// 因为整行找会把"（…所以还不算已完成）"这种修饰语当成状态声明 —— 臂 S2 就是这么把第一版打红的：
// 抹掉「进行中」之后判据照样绿，它读到了同一格后面那句"还不算已完成"。
// 取法：单号之后、遇到第一个 `（` 或下一个 `|` 为止 —— 本表的写法约定就是"状态词 + 括注"。
// 取不到任何一档 ⇒ 红（目标第 4 条那句禁词"基本完成"第一次有机器消费者）。
const STATUS = ['已完成', '进行中', '未开工'];
const statusCell = (t) => {
  const p1 = t.indexOf('|');
  const p2 = t.indexOf('|', p1 + 1);
  const rest = t.slice(p2 + 1);
  const cuts = [rest.indexOf('（'), rest.indexOf('|')].filter((i) => i > 0);
  return (cuts.length ? rest.slice(0, Math.min(...cuts)) : rest).trim();
};
const parsed = rows.map((r) => {
  const cell = statusCell(r.text);
  let declared = null;
  let at = Infinity;
  for (const s of STATUS) {
    const i = cell.indexOf(s);
    if (i !== -1 && i < at) {
      at = i;
      declared = s;
    }
  }
  return { ...r, cell: cell.slice(0, 40), declared };
});
const badStatus = parsed.filter((r) => r.declared === null);

// 腿 3：单元 id 不许重（重了就有一单被记两次、另一单没记）
const dup = rows.filter((r, i) => rows.findIndex((x) => x.id === r.id) !== i);

// 腿 4：读数里出现「截图」这个词的行必须带着图片引用（或写明封闭例外措辞）。
// ⚠️ 射程只到"声称看过图的那格没写路径"，**不**到"该不该有图" —— 后者要读界面代码，不是文本判据能答的。
const NO_UI = '无界面格';
const shotMissing = rows.filter((r) => /截图/.test(r.text) && !IMG.test(r.text) && !r.text.includes(NO_UI));

// 腿 5：孤儿行 —— 以 `| W…` 开头而**前一行的内容落在表之外**（既不是表格行也不是表头/分隔行）的行。
// ⚠️ 前一行为空**不能豁免**：GFM 里空行就是表格的结束，紧跟空行的 `| W…` 行不是表格的一部分，
// 它渲染成正文 —— 那正是本次事故的形状。第一版给了空行豁免，臂 S5 当场存活（插一行普通文字进去
// 都不红），因为插进去的就是"文字 + 空行 + 原来的行"。
const orphans = [];
for (let i = 1; i < lines.length; i += 1) {
  if (!UNIT.test(lines[i])) continue;
  if (lines[i - 1].startsWith('|')) continue;
  orphans.push({ line: i + 1, text: lines[i].slice(0, 60) });
}

console.log(`取样：${doc.startsWith(root + '/') ? doc.slice(root.length + 1) : doc}`);
console.log(`表区间：第 ${head + 1} 行起，连续 ${rows.length} 枚工单行，列结构 = 单/状态/读数`);
console.log(
  `逐行读数：${parsed.map((r) => `${r.id}=${r.declared ?? '无法判定'}${/截图/.test(r.text) ? (IMG.test(r.text) ? '(图✓)' : '(图✗)') : ''}`).join(' ')}`,
);
dump('🔴 数据行没有闭合竖线（多半是一行被写成多行 / 表格正在往外漏）', unclosed, (r) => `:${r.line} ${r.id} 结尾 ${JSON.stringify(r.text.slice(-18))}`);
dump('🔴 状态没命中封闭三档（已完成/进行中/未开工 —— "基本完成"这类落在这里）', badStatus, (r) => `:${r.line} ${r.id} → 状态格「${r.cell}」`);
dump('🔴 工单 id 重复', dup, (r) => `:${r.line} ${r.id}`);
dump('🔴 读数里写了「截图」却没带任何图片引用（也没写「无界面格」）', shotMissing, (r) => `:${r.line} ${r.id}`);
dump('🔴 表外的孤儿工单行（表格被中途截断的化石 —— 它们渲染成正文，状态等于没人记）', orphans, (r) => `:${r.line} ${r.text}`);

const bad = unclosed.length + badStatus.length + dup.length + shotMissing.length + orphans.length;
if (dumps.length) console.log(dumps.join('\n'));
console.log(`\n结论：${bad === 0 ? '§8 落地记录表的行闭合、状态词表、id 唯一、截图栏位、表连续性五项都成立 ✅' : `🔴 ${bad} 处不成立`}`);
process.exit(bad === 0 ? 0 : 1);
