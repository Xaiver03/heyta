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
// 🔴 判据不抄工单清单（那是一份会漂的抄件）：单元 id 从表里现读，只判形状与在场 ——
//   行闭合、状态词表封闭、id 唯一、"提了截图就得真有引用"、表外不许有工单段（按分隔行判）、
//   已开工的行必须记到变异那一层（或写明 `无变异面` + 理由）。
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

// 腿 4：读数里**声称看过界面图**的行必须带着图片引用（或写明封闭例外措辞）。
// ⚠️ 射程只到"声称看过图的那格没写路径"，**不**到"该不该有图" —— 后者要读界面代码，不是文本判据能答的。
// 🔴 触发词不能只认"截图"：工单 §4 的原话是"必须截图**且人看图**"，而表里的合法写法有
//   "八张图逐张看过""七张图，逐张打开看过""人已看图"好几种 —— 只认"截图"的话，
//   下一轮谁换了措辞就把这一档整格读成"没声称看过图"，判据静默失去对象（臂 N4 钉的就是这一条）。
//   选词只收**指图的**（截图/看图/逐张/张图/人眼复核），不收"看过"：那一格正文里的"没看过代码"
//   也会被它选中 —— 现量表内 8 枚声称看图的行用这套词同样命中 8 枚，一个不多（假红为零）。
const CLAIM_IMG = /截图|看图|逐张|张图|人眼复核/;
const NO_UI = '无界面格';
const shotMissing = rows.filter((r) => CLAIM_IMG.test(r.text) && !IMG.test(r.text) && !r.text.includes(NO_UI));

// 腿 5：表外的工单行 —— 以 `| W…` 开头、属于某一段**连续竖线行**，而那一段里**没有分隔行**
// （`|---|---|`）⇒ 那一段在 GFM 里根本不是表格，里面的行渲染成正文，状态等于没人记。
//
// 为什么判据是"这一段有没有分隔行"而不是"这一行的状态格有没有状态词"：
// 后者被现量否证过一次。产物树里 main 那一侧带回的整段 13 行旧抄件，`| W10 | ⏸ 不在本篇开工（…`
// 那一行的措辞**不在封闭三档里**，按状态词筛就漏掉它 —— 而腿 2 只扫表区间，也看不见它。
// 于是"掉在表外 + 状态词不合规"这一组合恰好互相掩护：越是不合规的写法越不容易被注意到。
// 分隔行这一条不看内容，形状上就说清了"这段是不是表"。
// ⚠️ 也不能写成"所有 `| W…` 行都得在表区间里"：本文件后面还有一张「单 → 落到哪一步」表，
// 它的行同样以 `| W…` 开头（现量 6 行，含 `| W0、W8a |` 这种一行带两个号的写法），那是**合法的表**
// （它自己带着分隔行），只按形状判会把这 6 行全报成假红。
// ⚠️ 空行**不豁免**：GFM 里空行就是表格的结束，紧跟空行的 `| W…` 段同样渲染成正文 ——
// 那正是 2026-10-04 那次事故的形状。第一版给了空行豁免，臂 S5 当场存活。
// 边界（实测，别读成"表外的行一律有牙"）：一枚掉出来的行如果**正好贴在另一张真表的末尾**，
// 它会跟着那张表的分隔行被当成合法 —— 2026-10-04 17:2x 现量：把 `| W7 | ✅ 已完成 | …` 插进
// 「单 → 落到哪一步」那张表之后判据 **RC=0**（腿 3 只扫表区间，看不见别的表里的同名 id）。
// 原来这里写的是"那种情形由腿 3 接住"，那句**是错的**，读数与不补这条腿的理由都在工单 §8.68 §5：
// 要接住它必须同时要求"那一格带着状态词"，而那张合法表今天写"做掉/改挂"，
// 谁改天在那一格写"已完成"就是一次假红 —— 在自己的样本上说不清对错的判据不拦事。
const DELIM = /^\|(\s*:?-{2,}:?\s*\|)+\s*$/;
const regionLines = new Set(rows.map((r) => r.line));
const orphans = [];
let run = [];
const flushRun = () => {
  if (!run.length) return;
  const isTable = run.some((i) => DELIM.test(lines[i]));
  if (!isTable) {
    for (const i of run) {
      const m = lines[i].match(UNIT);
      if (m && !regionLines.has(i + 1)) orphans.push({ line: i + 1, text: lines[i].slice(0, 60) });
    }
  }
  run = [];
};
for (let i = 0; i < lines.length; i += 1) {
  if (lines[i].startsWith('|')) run.push(i);
  else flushRun();
}
flushRun();

// 腿 6：已开工的行必须记到"能不能失败"那一层 —— 目标第 4 条要求落地记录含变异臂读数，
// 这一句原来只有散文在守（全仓没有任何东西在看"这一单有没有做变异"）。
// 判"有没有提到变异"而不是"提了几条"：条数由各单自己决定，写死数字就是另一份会漂的抄件。
// ⚠️ 词形是 `变异|臂` 两个都认：本表合法的写法有"变异 22 臂全红""九臂见 §8.37""H 组臂"三种，
// 只匹配"变异"这一词会把后两种读成没记 —— 我第一版的**一次性**审计探针就犯过这个错，
// 据此点名 W1c，被逐行现量否证（那一格写的是"四处面 + 九臂见 §8.37"）。写这条注释是为了让
// 下一个改这里的人别把两个词形收敛成一个。
// 🔴 封闭豁免词 `无变异面`，且**理由必须写在同一格里**（与 c1-coverage 同一条纪律：
// 例外是数据不是脚本里的登记表）。纯文档/纯登记的单走这一档。
// 豁免词必须**带理由**（`无变异面：…`，冒号后至少 4 个字）—— 只写一个光秃秃的豁免词就等于
// 给这一格发了一张空白通行证，所以臂 N3 专门量它。理由不要求特定句式：判"有内容"，不判"内容对不对"。
// 🔴 判"有没有提到变异"之前必须先把豁免词本身挖掉：`无变异面` 这三个字里就含"变异"，
// 不挖的话**光秃秃写一个豁免词**（不给理由）也会命中 needle 而放行 —— 豁免档位自己变成了通行证。
// 臂 N3 就是这条的现量：第一版腿 6 上 N3 命中 0 条。
const EXC = /无变异面[：:][^|]{4,}/;
const mutMissing = parsed.filter((r) => {
  if (r.declared === '未开工') return false;
  if (EXC.test(r.text)) return false;
  return !/变异|臂/.test(r.text.replace(/无变异面/g, ''));
});

console.log(`取样：${doc.startsWith(root + '/') ? doc.slice(root.length + 1) : doc}`);
console.log(`表区间：第 ${head + 1} 行起，连续 ${rows.length} 枚工单行，列结构 = 单/状态/读数`);
console.log(
  `逐行读数：${parsed.map((r) => `${r.id}=${r.declared ?? '无法判定'}${CLAIM_IMG.test(r.text) ? (IMG.test(r.text) ? '(图✓)' : '(图✗)') : ''}`).join(' ')}`,
);
dump('🔴 数据行没有闭合竖线（多半是一行被写成多行 / 表格正在往外漏）', unclosed, (r) => `:${r.line} ${r.id} 结尾 ${JSON.stringify(r.text.slice(-18))}`);
dump('🔴 状态没命中封闭三档（已完成/进行中/未开工 —— "基本完成"这类落在这里）', badStatus, (r) => `:${r.line} ${r.id} → 状态格「${r.cell}」`);
dump('🔴 工单 id 重复', dup, (r) => `:${r.line} ${r.id}`);
dump('🔴 读数里声称看过界面图却没带任何图片引用（也没写「无界面格」）', shotMissing, (r) => `:${r.line} ${r.id}`);
dump('🔴 表外的孤儿工单行（表格被中途截断的化石 —— 它们渲染成正文，状态等于没人记）', orphans, (r) => `:${r.line} ${r.text}`);
dump('🔴 已开工的行没记变异读数（也没写「无变异面」+理由）', mutMissing, (r) => `:${r.line} ${r.id} → 状态格「${r.cell}」`);

const bad = unclosed.length + badStatus.length + dup.length + shotMissing.length + orphans.length + mutMissing.length;
if (dumps.length) console.log(dumps.join('\n'));
console.log(
  `\n结论：${
    bad === 0
      ? '§8 落地记录表的行闭合、状态词表、id 唯一、截图栏位、表外无工单段（按分隔行判）、已开工行有变异读数 —— 六项都成立 ✅'
      : `🔴 ${bad} 处不成立`
  }`,
);
process.exit(bad === 0 ? 0 : 1);
