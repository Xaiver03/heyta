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
 * 第四类（04 08:1x 加 —— 本轮把"是不是表"想错了两次才找到的）。**先记一次否证**：这单原本
 * 登记的是"本脚本抓不到『行尾少 `|`』和『代码段里有裸 `|`』这两型"。把三种形状喂进现脚本
 * （`/tmp/mdg-fixture/shapes.md`）实测：行尾少 `|` 报 `列数 1（表头 2）`，代码段裸 `|` 报
 * `列数 3（表头 2）`——**两型都抓得到**，登记的那句话是错的。真正放走缺陷的是**两种缺陷互相抵消**：
 *
 *     | A | B | C |
 *     |---|---|---|
 *     | 1 | `a | b` | 2        ← 行尾少一个 `|`（少一格）＋ 代码段里裸 `|`（多一格）
 *
 * 计数恰好等于表头，脚本对它**一个字都不说**（实测：`shapes.md:21` 无输出），而渲染仍是错位的。
 * ⇒ 判据不能只问"数对不对"，还得问"这些格本身站得住吗"。可观测痕迹是 GFM 的顺序决定的：
 * **先按未转义竖线拆格，再在每格里解析行内内容**，所以"作者本意把竖线写进代码里"必然留下
 * 一格**配不成对的落单反引号**。第四类就数这个。
 *
 * ⚠️ 这条判据的**第一版是错的**，而且错得会被当成"别人有 3 处缺陷"：它整行配对反引号，
 * 于是把上一格的开与下一格的闭配成一对，指着 `calendar-year-time-and-mobile-profile.md:110`
 * 说"代码段里有未转义竖线"—— 把那一行读一遍就知道那些竖线是**正常的列分隔符**。
 * 两版的命中集合**不是同一组**（04 08:1x 逐行现量）：整行版在那个文件报 110、1092、1092（同一行两枚），
 * 按格版报 110、1092、1098 —— 行数巧合都是 3，**逐行读过去才知道只有前两枚是同一处**。
 * 判"是缺陷"靠的是格内配对，不是整行；而"两边都是 3"这种巧合恰好说明：**只报计数的对账挡不住归因错**。
 *
 * 🔴 存量**不吸收**：那 3 行在别的条线正在写的台账里，去改就是在别人活跃的文件里造冲突，
 * 而一条天生红的门禁等于没有门禁（AGENTS §8.3）。所以用 `CODE_SPAN_BASELINE` 冻结成
 * "只许减不许增"，并且反向也钉：现量低于登记值同样报红 —— 这张表只能跟着现实缩，
 * 不能变成一条永远不会触发的装饰。
 *
 * 全仓基线（04 08:1x 现量，扫 **2841** 个 .md（docs/research/apps/server/packages/根））：
 * 命中 **30 行 / 16 个文件**。已进清单的只有 1 个文件的 3 行；其余 27 行分布 ——
 * `multi-platform-widgets-progress.md` 7、`multi-end-coverage-handoff.md` 4、
 * `legal-compliance-before-filing.md` 3、`goal-multi-end-coverage.md` 2，
 * 以及 `apps/desktop-windows/README.md`、`docs/README.md`、`adr/0010`、`adr/0034`、
 * `phase-2-multi-platform`、`site-and-parity-alignment`、`trash-and-archive`、
 * `reference/pricing-and-coupons`、`research/spikes/rnw-content-island/README`、
 * `runbooks/desktop`、`research/parts/part2b-caldav-ical-push` 各 1。
 * **登记为各自的债，由各自收**，本批不代改（复现命令与逐行清单在本轮计划 §8.4 ㉕）。
 *
 *
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
  // 倒数纪念日这条线的两份台账（04 08:0x 加）。加进来的前提与上面四份一样："归本线写、
  // 且现量干净" —— 现量是 `node /tmp/mdg-fixture/probe-countdown.mjs` 那套同样的判据跑出 **rc=0**
  // 之后才加的；加之前它有 **4 处**（三处段落紧贴表尾 + 一处我上轮改表格留下的重复尾巴行）。
  'docs/plans/countdown-anniversary.md',
  'docs/plans/countdown-batch2-handoff.md',
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

/**
 * 拆完之后**反引号配不成对**的格子下标（0-based，只数真正的格子）。
 *
 * 🔴 判据的形状，是这一轮实测纠正出来的。原先写的是"整行扫描行内代码段里的裸竖线"，
 *    那会**误报**：`docs/plans/calendar-year-time-and-mobile-profile.md:110` 与 `:1092`
 *    被它指着说"代码段里有未转义竖线"，把那一行读一遍就知道反了 —— 那些竖线就是**正常的列分隔符**，
 *    误报的原因是整行配对反引号：这一行里反引号run的**总数**是偶数但**跨格**配对（第 N 格的开
 *    与第 N+1 格的闭被配成一对），于是把中间的合法分隔符当成了"代码段内部"。
 *
 *    GFM 的真实顺序是：**先按未转义竖线拆格，再在每一格里解析行内内容**。所以"作者本意把竖线
 *    写进代码里"这件事的唯一可观测痕迹是：**这一格自己的反引号配不成对**（开局没关）。
 *    `| \`foo | bar\` |` 拆出 `` `foo `` 与 `` bar` `` —— 两格各剩一个落单反引号 ⇒ 这才是要抓的。
 */
function unbalancedBacktickCells(line) {
  const pipes = pipePositions(line);
  if (pipes.length === 0) return [];
  let from = pipes[0] + 1;
  let to = line.length;
  // 行尾那个竖线是**分隔符**（GFM 允许省），它之后的内容不是格子
  if (pipes.length > 1 && pipes[pipes.length - 1] === line.length - 1) to = line.length - 1;
  const bounds = pipes.filter((p) => p >= from && p < to);
  const cells = [];
  let cursor = from;
  for (const p of bounds) { cells.push([cursor, p]); cursor = p + 1; }
  if (cursor <= to) cells.push([cursor, to]);

  const bad = [];
  cells.forEach(([a, b], idx) => {
    const cell = line.slice(a, b);
    // 逐段跳过反引号 run：闭合必须是**同样长度**的一串（CommonMark）
    let i = 0;
    let open = -1;
    while (i < cell.length) {
      if (cell[i] === '\\') { i += 2; continue; }
      if (cell[i] !== '`') { i += 1; continue; }
      let len = 0;
      while (cell[i + len] === '`') len += 1;
      if (open === -1) { open = len; i += len; continue; }
      if (len === open) { open = -1; i += len; continue; }
      // 长度不同的 run 不是闭合，继续往里走（它只是内容里的一个 run）
      i += len;
    }
    if (open !== -1) bad.push(idx + 1);
  });
  return bad;
}

const problems = [];

/** 新增判据（反引号配不成对）的**冻结基线**：只许减、不许增。
 *  🔴 为什么有这张表而不是把那些行一起修掉：它们分别在别的条线正在写的台账里
 *      （`calendar-year-time-and-mobile-profile.md` 3 行 04 08:1x 现量），我去改就是
 *      在别人活跃的文件里造冲突；而"一条天生红的门禁等于没有门禁"（AGENTS §8.3）。
 *      所以这条判据的作用域写清楚：**它挡的是新增**，存量逐条登记在本轮计划 §6，谁写谁收。
 *      这张表是刻意的摩擦 —— 清一行就删一个键，删到最后它空了，缺陷也就没了。 */
const CODE_SPAN_BASELINE = {
  'docs/plans/calendar-year-time-and-mobile-profile.md': 3,
};
const codeSpanHits = [];

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
      const csBad = unbalancedBacktickCells(line);
      if (csBad.length > 0) codeSpanHits.push({ file, n, cells: csBad });
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

// 反引号判据按文件与基线比数量（存量不吸收，净增必红）
const byFile = new Map();
for (const h of codeSpanHits) byFile.set(h.file, (byFile.get(h.file) ?? 0) + 1);
for (const [file, count] of byFile) {
  const allowed = CODE_SPAN_BASELINE[file] ?? 0;
  if (count > allowed) {
    const rows = codeSpanHits.filter((h) => h.file === file).slice(0, 4);
    problems.push(
      `${file} 有 ${count} 行表格里的反引号配不成对（基线 ${allowed}，只许减不许增）—— 每行的"格"里剩下落单反引号，说明本该写成 \`a \\| b\` 的竖线被当成了列分隔符：\n      ${rows.map((r) => `${file}:${r.n}（第 ${r.cells.join('/')} 格）`).join('\n      ')}`,
    );
  }
}
// 基线里若有文件的实际命中已低于登记值 ⇒ 提示收回（防止这张表悄悄变成新的"永远通过"）
for (const [file, allowed] of Object.entries(CODE_SPAN_BASELINE)) {
  const got = byFile.get(file) ?? 0;
  if (got < allowed) {
    problems.push(`${file} 反引号基线登记 ${allowed}，现量 ${got} ⇒ 把 CODE_SPAN_BASELINE 里的这个键改掉（这张表只许跟着现实缩，不许跟着现实胀）`);
  }
}

if (problems.length > 0) {
  console.error(`✖ markdown 表格行错位 ${problems.length} 处：`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`✔ markdown 表格行：${FILES.length} 个文件，列数、断行、"是不是表"与格内反引号配对都一致（第四类基线 ${Object.values(CODE_SPAN_BASELINE).reduce((a, b) => a + b, 0)} 行，只许减）`);
