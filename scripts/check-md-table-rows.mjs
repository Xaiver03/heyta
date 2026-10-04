#!/usr/bin/env node
/**
 * Markdown 表格行自检（R15b 收口那轮加的）。
 *
 * ## 为什么要有这一条
 *
 * 18:1x 收口时给台账加了一行，加完用肉眼看不出结构坏了 —— 而机器一查就是
 * **4 处**：三行少一个分隔符（渲染时整列错位），一行把联合类型里的 `|` 写在了
 * 代码段里没转义（渲染时凭空多一列）。这类缺陷的**症状不是报错，是表格静默错位**，
 * 而这份文档就是交给下一个会话的唯一交接物。
 *
 * 第二类更隐蔽：把一条长表格行**折成多个物理行**（GFM 的表行不能跨物理行）。
 * 折行那几行在源码里读着顺，渲染出来却是"表格在第 N 行就断了，后面是一段裸文字"，
 * 而下一个接手的会话读到的是原文，他会以为表格还在。`ui-review-fill-zh-timeline.md`
 * 里实测有 2 行这样（R3、R6），本轮已并回单行。
 *
 * 第三类（R14c 那轮加 —— **它放走了上面两枚真缺陷**）：列数比对是"每一行 vs 它所在
 * 连续块的第一行"。表格中间一旦混进空行，GFM 在那里就把表截断了，本脚本也跟着**重新
 * 起一个表头** —— 于是一块只有数据行、没有表头也没有分隔行的碎片，会被当成"新表的第一行"，
 * **永远没有对象可比**。实测：本线台账 §4 里有 5 枚这样的空行，其中两行各自带一枚没转义的
 * 裸竖线（都是 5 列，而表头是 4 列），就这样躲过了前两道判据 —— 直到有人往它们后面追加
 * 第三行才红。⇒ 光比列数不够，还得问一句"这一块到底是不是一张表"：**表头下面必须紧跟分隔行**。
 *
 * ## 范围：为什么圈的是清单里那几个文件，而不是整篇 docs 目录
 *
 * 现量（同这两个判据跑全仓）：**179 个 .md 里 27 个有问题，共 73 处** —— 大多在
 * 别的条线的台账里。一条**天生红的门禁等于没有门禁**（AGENTS §8.3），而把它们
 * 一次性抹平就是替别人改他正在写的文件。所以这里用显式清单，加进来的前提是
 * "这个文件归本线写、且现量干净"：过程账 + 上级台账 + 本轮新写的交接与复盘
 * （四份，21:4x 现量 rc=0）。
 *
 * 🔴 **`docs/plans/README.md` 刻意不在清单里**，而且不是"忘了"：21:4x 用同一套判据跑它，
 * 命中 1 处在**第 17 行**（倒数纪念日那条索引行是 2 列，而那张表的表头是 3 列 —— 长说明
 * 因此落在"看这一份"列、"说明"列空）。`git show HEAD:docs/plans/README.md` 里**同样有它**，
 * 所以那不是别人未提交的半成品，是 HEAD 里就存在的缺陷，但它不归本线、文件又正被并行会话改动。
 * ⇒ 现量命令登记在本轮交接 §4 G，由倒数那条线自己收；在它收掉之前把 README 加进清单
 * = 造一条天生红的门禁。
 *
 * 🔴 **同一条理由挡掉了另外两份法务调研**（2026-10-04 给清单加回收站那条线的五个文件时现量）：
 * `docs/research/legal-dataflow-ai-rights.md` **5 处**（`:24` 是 4 列而表头 5 列；`:243-246` 各 2 列而表头 3 列）、
 * `docs/research/legal-pipl-baseline.md` **3 处**（`:1593` 与 `:1623-1625` 各 3 列而表头 4 列）。
 * 两份在 10-04 现量**都没有未提交 diff**（所以不是别人的半成品），但最近提交分别是
 * `6e447033`（GDPR 对齐批次）与 `881aa92a`（同意闸门 G-11/G-12），**都不是回收站那条线写的**
 * ⇒ 按"谁写谁收"逐文件登记进 `docs/plans/trash-and-archive.md` §10.6，不由本门禁代它们红。
 * 它们收掉之后只需把路径加进下面的 `FILES`，**判据本身不用改**。
 *
 * 其余的**逐文件登记**在本轮计划 §6，谁写谁收。
 *
 * 跑法：`node scripts/check-md-table-rows.mjs`（退出码 0 = 干净；非 0 = 有错位，
 * 逐条打印 `文件:行号` 与两个列数）。它**不需要任何依赖**，也不需要构建。
 */
import { readFileSync } from 'node:fs';

const FILES = [
  'docs/plans/calendar-year-time-and-mobile-profile.md',
  'docs/plans/ui-review-fill-zh-timeline.md',
  'docs/plans/calendar-profile-handoff.md',
  'docs/plans/calendar-profile-reflection.md',
  // 回收站与归档那条线的台账/ADR/调研（2026-10-04 加入，逐文件现量 rc=0）。
  'docs/plans/trash-and-archive.md',
  'docs/adr/0048-deletion-four-states-and-the-no-physical-erase-boundary.md',
  'docs/research/trash-and-archive-best-practice.md',
  'docs/research/legal-dataflow-client.md',
  'docs/research/legal-dataflow-server.md',
];

/** 未被 `\` 转义的竖线的位置。 */
function pipePositions(line) {
  const out = [];
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== '|') continue;
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && line[j] === '\\'; j -= 1) backslashes += 1;
    if (backslashes % 2 === 0) out.push(i);
  }
  return out;
}

const problems = [];

/** 分隔行（`|---|:--:|`）：它才是"这是一张表"的唯一凭据。 */
function isDelimiterRow(line) {
  return /^\|[\s:\-\|]+\|$/.test(line);
}

for (const file of FILES) {
  const lines = readFileSync(file, 'utf8').split('\n');
  // 代码围栏内部不做表格判断（``` 里的竖线是代码，不是列）
  let fence = null;
  let headerCells = null;
  let inTable = false;
  // 连续 `|` 行的块起点（1-based）；空行/标题/正文都会结束一块
  let blockStart = null;

  const closeBlock = () => {
    if (blockStart === null) return;
    const headerLine = String(lines[blockStart - 1] ?? '').trim();
    const nextLine = String(lines[blockStart] ?? '').trim();
    // 单行的块：它自己若是分隔行则属于上面已被跳过的表，否则就是"没有表头的碎片"
    if (!isDelimiterRow(headerLine) && !isDelimiterRow(nextLine)) {
      problems.push(
        `${file}:${blockStart} 这一块的表头下面没有分隔行（GFM 把它当裸文字渲染 ⇒ 列数判据对整个碎片失效）`,
      );
    }
    blockStart = null;
  };

  lines.forEach((raw, idx) => {
    const n = idx + 1;
    const line = raw.trim();
    const fenceMark = /^(`{3,}|~{3,})/.exec(line);
    if (fenceMark !== null) {
      const marker = fenceMark[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      inTable = false;
      headerCells = null;
      closeBlock();
      return;
    }
    if (fence !== null) return;

    if (line.startsWith('|')) {
      if (blockStart === null) blockStart = n;
      // 分隔行：定形状的不是它，但它确认"这里是一张表"
      if (isDelimiterRow(line)) return;
      const cells = pipePositions(line).length - 1;
      if (!inTable) {
        inTable = true;
        headerCells = cells;
      } else if (cells !== headerCells) {
        problems.push(`${file}:${n} 列数 ${cells}（本表表头是 ${headerCells}）`);
      }
      return;
    }
    closeBlock();
    if (inTable && line !== '') {
      // 表格里出现不以 `|` 开头的非空行 = 要么表被截断了，要么这是一条续行
      const startsHeading = line.startsWith('#');
      const startsQuote = line.startsWith('>');
      const startsList = /^[-*]\s/.test(line) || /^\d+\.\s/.test(line);
      if (!startsHeading && !startsQuote && !startsList) {
        problems.push(`${file}:${n} 表格行被折成多个物理行（GFM 会在上一行就结束这张表）`);
      }
      inTable = false;
      headerCells = null;
    }
    if (line === '') {
      inTable = false;
      headerCells = null;
    }
  });

  // 文件以表格块结尾时，上面的"块结束"分支不会触发，这里补一次
  closeBlock();
}

if (problems.length > 0) {
  console.error(`✖ markdown 表格行错位 ${problems.length} 处：`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`✔ markdown 表格行：${FILES.length} 个文件，列数、断行与"是不是表"都一致`);
