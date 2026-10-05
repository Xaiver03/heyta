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
//   已开工的行必须记到变异那一层（或写明 `无变异面` + 理由）、
//   已开工的行必须给出**判据条数**（目标第 4 条点名的那一样；19:0x 之前这一格只有散文在守，
//   而现量结果是 W0/W1c 两格真的没有）、变异那一格必须有**臂条数 + 红集**两样在同一句里、
//   任何表格单元的 code span 里不许有裸竖线（19:5x 起），
//   以及有序列表块的字面编号必须与位置一致（20:5x 起 —— 本线的"§8.76 第 N 条"是**跨文档**引用，
//   而渲染层只认块内首项的字面值，编号写错在渲染后完全看不出来）。
// 🔴 腿 1–9 判的是 §8 那张表；腿 10 判的是**传来的每一份文档**（默认 = 工单 + 调研那两份）。
//   把表类判据也套到调研文档上没有意义（它没有 `| 单 | 状态 | 读数` 表），但编号引用两边都有。
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
const positionals = argv
  .slice(2)
  .filter((a, i) => !a.startsWith('--') && !(rootIdx !== -1 && i + 2 === rootIdx + 1) && a !== root);
const PLAN = 'docs/plans/detail-pane-alignment.md';
const RESEARCH = 'docs/research/detail-pane-alignment-and-spaced-review.md';
// 🔴 默认扫**两份**：本线的"§8.76 第 N 条"式引用是**跨文档**的（工单引调研、调研引工单），
//   只守一张表所在那份等于把引用面的一半留在散文里。显式传参时就用传来的那几份（装置要控制自己的副本）。
const docList = (positionals.length ? positionals : [PLAN, RESEARCH])
  .map((a) => (a.startsWith('/') ? a : join(root, a)))
  .filter((p, i) => (i === 0 ? true : existsSync(p)));
const doc = docList[0];
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

// 腿 7：已开工的行必须写出**判据条数**（目标第 4 条点名的三样读数的第一样）。
// 🔴 判别形状是"**同一句里**同时出现 `判据` 与 `N 条/枚`"，不是"某个固定字符窗口"。
// 窗口版被现量否证过两次，方向相反：
//   · 窗口 ≤12 字 ⇒ W4 那格"三条恢复路径、持久化、判据"被当成有读数（**假绿**，那格从没声明过判据条数）；
//   · 窗口收到 ≤6 字 ⇒ W1 的"判据**：共享层 16 条"和 W8a 的"判据**：`packages/i18n/tests/habit-total-copy.spec.ts` 4 条"
//     一起掉出射程（**假红**，而且掉的正是真读数那两格）。
//   两种错都源于"按某一种字面形状判"。分句之后只看语义：**同一句里既有'判据'又有'N 条'**。
//   （分句按 `。`/`；`/`<br>` 切 —— 本表的读数栏就用这三个分隔。）
// 豁免沿用腿 6 那条纪律：封闭词 `无判据面：` + 同一格里 ≥4 字理由。⚠️ 写 `判据 0 条 + 为什么是 0`
//   比走豁免更值钱 —— 0 是一个读数，豁免词不是。
const NUM = '[0-9一二三四五六七八九十两]+';
const COUNT = new RegExp(`${NUM}\\s*[条枚]`);
const sentences = (t) => t.split(/[。；;]|<br\s*\/?>/);
const CLAIM_JUDGE = (t) => sentences(t).some((s) => s.includes('判据') && COUNT.test(s));
const JUDGE_EXC = /无判据面[：:][^|]{4,}/;
const judgeMissing = parsed.filter((r) => {
  if (r.declared === '未开工') return false;
  if (JUDGE_EXC.test(r.text)) return false;
  return !CLAIM_JUDGE(r.text.replace(/无判据面/g, ''));
});

// 腿 8：变异那一档光"提到"不够（腿 6 已经管那一条），还得同时有**臂条数**与**红集读数**。
// 目标第 4 条原话是"变异红集"：只有"六臂变异"这一句不够 —— 六臂全红？还是五红一存活？
// 这两个读数的含义相反（**存活的臂恰恰是一单真正产出的判据**，§8.36 那条 W10 的教训就是这么来的）。
// 同一句里要求 `N 臂`（或 `臂…N 条`）+ 结果词。⚠️ 结果词表要按表里真实措辞收，别只收"全红"：
//   "各红在指定那一条"（W3）与"存活"（那是失败读数，仍然算报了红集）都必须算命中。
const CLAIM_ARM = (s) => new RegExp(`${NUM}\\s*臂|臂[^0-9一二三四五六七八九十两]{0,8}${NUM}\\s*[条枚]`).test(s);
//   三种都要收，因为表里真有三种写法：W3"三臂各红在指定那一条" / W8a"A1 …→红" /
//   W5"A1 … ⇒ `ui` + `e2e` 红"（**箭头与'红'之间隔着被点名的是哪几层**，所以箭头式要允许一段间隔）。
//   ⚠️ 第一版只收"全红/各红/存活"，于是 W5 与 W8a 被报成"没记红集" —— 那是**假红**，
//   而且方向危险：它会把人推去补一个本来就在的读数，或者更糟，去改判据让它闭嘴。
//   "逐臂"这种**过程**词不收（"逐臂复原"只说明跑了每一臂，不说明每一臂的结果）。
const RESULT_WORD = /全红|全部失能|各红|存活|转红|不合格|\d+\s*\/\s*\d+|精确|(?:⇒|→|->|=>)[^。|]{0,30}红/;
const ARM_EXC = /无变异面[：:][^|]{4,}/;
const armMissing = parsed.filter((r) => {
  if (r.declared === '未开工') return false;
  if (ARM_EXC.test(r.text)) return false;
  const t = r.text.replace(/无变异面/g, '');
  return !sentences(t).some((s) => CLAIM_ARM(s) && RESULT_WORD.test(s));
});


// 腿 9：任何**表格行**的 code span 里都不许有裸竖线。
// 起因是 19:5x 的现量：本轮我自己往这张表里补读数时写出三处 `` `…a|b…` ``（`grep -cE 'it\(|test\('`、
// 一条正则字面量、一条 import 口径正则），GFM 在解析行内结构**之前**先按未转义竖线切单元，
// 所以码段里的 `|` 一样会把一格劈成两格 —— 症状和腿 1 那类"行往外漏"不同（行仍是闭合的、
// 也仍在表区间里），因此前八条腿**一条都不会红**。这三处是 `/tmp` 一次性扫描照出来的，
// 扫完就没了 ⇒ 没有常驻消费者的话，下一轮补读数还会再从同一处漏回去。
// 🔴 射程是**整份文档里所有表格行**，不只 §8 那一张：三处里有两处在别的表（腿序登记表、合流面读数表），
//   只扫 §8 区间等于把这一半对象排除在外。这条判据与"哪张表"无关，所以能扫得开。
// ⚠️ 转义式（反斜杠加竖线）不算违规（那是 GFM 要求的写法）；反引号**不成对**的行跳过并单独报数 ——
//   宁可少判一行，也不要造出一条说不清对错的假红。跳过数打在承重读数里，K>0 就是探针没射程的信号。
// 🔴 匹配式必须是 `(^|[^\\])` 而不是 `[^\\]`：20:0x 现量，本判据第一版**放走了两处真缺陷** ——
//   码段内容就是一个光秃秃的竖线（`` `|` ``，"收尾的竖线落在哪一行"那种句子），
//   段首没有前驱字符，`[^\\]\|` 读不到它。是 main 那条共享门禁 `check:md-tables` 按列数比对照出来的
//   （它在我这九条腿之外，见工单 §8.87）。
const tableRowLines = lines
  .map((text, i) => ({ line: i + 1, text }))
  .filter((r) => /^\|.*\|\s*$/.test(r.text));
const codeBare = (line) => {
  const segs = line.split(/(`+)/);
  const hits = [];
  let open = null;
  let spanCount = 0;
  for (const seg of segs) {
    const isRun = /^`+$/.test(seg);
    // 定界符：闭合串必须与开启串**等长**（CommonMark），不等长的那一串是码段里的字面反引号
    if (isRun && (open === null || seg.length === open)) {
      if (open === null) spanCount += 1;
      open = open === null ? seg.length : null;
      continue;
    }
    if (open !== null && /(^|[^\\])\|/.test(seg)) hits.push(seg);
  }
  return { hits, spanCount, unbalanced: open !== null };
};
const pipeRows = [];
let codedRows = 0;
let skippedRows = 0;
for (const r of tableRowLines) {
  const { hits, spanCount, unbalanced } = codeBare(r.text);
  if (unbalanced) {
    skippedRows += 1;
    continue;
  }
  if (spanCount > 0) codedRows += 1;
  if (hits.length) pipeRows.push({ ...r, id: r.text.match(UNIT)?.[1] ?? '', sample: hits[0].slice(0, 44) });
}

// 腿 10：有序列表块的**字面编号必须与位置一致**（首项是 start，其后每条 +1）。
// 为什么这条要常驻，而不是"顺手加严"：本线两份文档靠 `§8.76 第 N 条` 这种**源码里的编号**互相引用，
// 而渲染层（CommonMark）只认块内首项的字面值、其余一律按 start + 序号重排 ——
// ⇒ "编号写错"在渲染后**看不出任何异常**，只在按号索引时指错东西，而那正是本批 #20 记的 main 侧台账同款缺陷。
// 现量起因（2026-10-04 20:4x）：给 §8.76 追加一条时，一次性扫描照出该块**有 6 条**字面编号与位置不一致
// （写成 6, 8, 7, 8, 9, 10, 11），而前九条腿**一条都不红** —— 表层判据管不到列表层，与腿 9 是同一族的两层。
// ⚠️ 允许首项不为 1：作者可以故意从 7 起，让编号对上别处的编号表（调研文档 C1 那张逐节清单就这么写，
//   现量 20 条首项 7 的续编）。判的是"**块内等差 1 递增**"，不是"从 1 开始" —— 写成后者会把合法写法判红。
// ⚠️ 代码围栏里的 `N. ` 是命令输出/注释，不算列表项；`|` 行与 `#` 标题会结束一个块（表格里出现
//   "1. " 开头的单元格是常事，把它当列表项会造成一片假红）。
const LIST_ITEM = /^(\d+)\.\s/;
const listBad = [];
const listPerDoc = [];
const numberingScan = (textLines) => {
  const bad = [];
  let blocks = 0;
  let items = 0;
  let inFence = false;
  let i = 0;
  while (i < textLines.length) {
    if (/^```/.test(textLines[i])) {
      inFence = !inFence;
      i += 1;
      continue;
    }
    if (inFence || !LIST_ITEM.test(textLines[i])) {
      i += 1;
      continue;
    }
    const block = [];
    let j = i;
    while (j < textLines.length) {
      const text = textLines[j];
      const m = text.match(LIST_ITEM);
      if (m) {
        block.push({ n: Number(m[1]), line: j + 1 });
        j += 1;
        continue;
      }
      if (text.startsWith('|') || /^#{1,6} /.test(text)) break;
      if (/^(?:\s+\S|\s*$)/.test(text)) {
        j += 1;
        continue;
      }
      break;
    }
    if (block.length > 1) blocks += 1;
    items += block.length;
    block.forEach((b, k) => {
      if (b.n !== block[0].n + k) bad.push({ line: b.line, n: b.n, expect: block[0].n + k, start: block[0].n });
    });
    i = j > i ? j : i + 1;
  }
  return { bad, blocks, items };
};
for (const p of docList) {
  if (!existsSync(p)) continue;
  const label = p.startsWith(root + '/') ? p.slice(root.length + 1) : p;
  const { bad, blocks, items } = numberingScan(readFileSync(p, 'utf8').split('\n'));
  listPerDoc.push(`${label.split('/').pop()}：块 ${String(blocks)}／条目 ${String(items)}／不一致 ${String(bad.length)}`);
  for (const b of bad) listBad.push({ ...b, label });
}

console.log(`取样：${doc.startsWith(root + '/') ? doc.slice(root.length + 1) : doc}`);console.log(`表区间：第 ${head + 1} 行起，连续 ${rows.length} 枚工单行，列结构 = 单/状态/读数`);
console.log(
  `逐行读数：${parsed.map((r) => `${r.id}=${r.declared ?? '无法判定'}${CLAIM_IMG.test(r.text) ? (IMG.test(r.text) ? '(图✓)' : '(图✗)') : ''}`).join(' ')}`,
);
dump('🔴 数据行没有闭合竖线（多半是一行被写成多行 / 表格正在往外漏）', unclosed, (r) => `:${r.line} ${r.id} 结尾 ${JSON.stringify(r.text.slice(-18))}`);
dump('🔴 状态没命中封闭三档（已完成/进行中/未开工 —— "基本完成"这类落在这里）', badStatus, (r) => `:${r.line} ${r.id} → 状态格「${r.cell}」`);
dump('🔴 工单 id 重复', dup, (r) => `:${r.line} ${r.id}`);
dump('🔴 读数里声称看过界面图却没带任何图片引用（也没写「无界面格」）', shotMissing, (r) => `:${r.line} ${r.id}`);
dump('🔴 表外的孤儿工单行（表格被中途截断的化石 —— 它们渲染成正文，状态等于没人记）', orphans, (r) => `:${r.line} ${r.text}`);
dump('🔴 已开工的行没记变异读数（也没写「无变异面」+理由）', mutMissing, (r) => `:${r.line} ${r.id} → 状态格「${r.cell}」`);
dump('🔴 已开工的行没写**判据条数**（也没写「无判据面」+理由）', judgeMissing, (r) => `:${r.line} ${r.id} → 状态格「${r.cell}」`);
dump('🔴 变异那一档没有"臂条数 + 红集"两个读数（光提一句不算，纯文档单走「无变异面」+理由）', armMissing, (r) => `:${r.line} ${r.id} → 状态格「${r.cell}」`);
dump('🔴 表格单元的 code span 里有裸竖线（GFM 会在这里切格，行不裂但格子裂 —— 前八条腿一条都不红）', pipeRows, (r) => `:${r.line} ${r.id || '(非§8表)'} 码段 ${JSON.stringify(r.sample)}`);
dump('🔴 有序列表的字面编号与位置不一致（渲染层看不出来，只有按"第 N 条"索引时指错东西）', listBad, (b) => `${b.label ? `${b.label} ` : ''}:${b.line} 写作 ${String(b.n)}. 而按首项 ${String(b.start)}. 应为 ${String(b.expect)}.`);

// 承重读数：把"这一趟真的扫到了对象"打在输出里 —— 0 枚命中既可能是"全都合规"也可能是"needle 没射程"，
// 没有这两个数就区分不了（腿 4/6 各自撞过一次，见上面注释）。
const started = parsed.filter((r) => r.declared !== '未开工' && !EXC.test(r.text));
const judgeHits = started.filter((r) => CLAIM_JUDGE(r.text)).length;
const armHits = started.filter((r) => sentences(r.text).some((s) => CLAIM_ARM(s) && RESULT_WORD.test(s))).length;
console.log(
  `承重：已开工且未走「无变异面」豁免 ${started.length} 行｜判据条数命中 ${judgeHits}｜臂条数+红集同句命中 ${armHits}`,
);
// 腿 9 的射程单独报一行：表行总数 / 其中含码段的行数 / 因反引号不成对而跳过的行数。
// 🔴 没有这行的话"裸竖线 0 处"和"扫到 0 枚表行"在输出里长得一样（这一族在本线已经踩过三次）。
console.log(`承重(腿9)：表格行 ${tableRowLines.length} 枚｜含 code span ${codedRows} 枚｜反引号不成对而跳过 ${skippedRows} 枚`);
// 腿 10 的射程同理：逐份文档报"块数／条目数"，"0 处不一致"才知道是"都合规"而不是"没扫到列表"。
console.log(`承重(腿10)：${listPerDoc.join('｜')}｜首项不为 1 的续编块算合法`);

const bad =
  unclosed.length +
  badStatus.length +
  dup.length +
  shotMissing.length +
  orphans.length +
  mutMissing.length +
  judgeMissing.length +
  armMissing.length +
  pipeRows.length +
  listBad.length;
if (dumps.length) console.log(dumps.join('\n'));
console.log(
  `\n结论：${
    bad === 0
      ? '§8 落地记录表的行闭合、状态词表、id 唯一、截图栏位、表外无工单段（按分隔行判）、已开工行有变异读数、判据条数、变异"臂条数+红集"两样齐、码段无裸竖线、列表编号与位置一致 —— 十项都成立 ✅'
      : `🔴 ${bad} 处不成立`
  }`,
);
process.exit(bad === 0 ? 0 : 1);

