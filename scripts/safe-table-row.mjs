#!/usr/bin/env node
/**
 * `safe-table-row` —— **插一行之前，先确认它会和表对齐**。
 * ======================================================================
 *
 * ## 它解决什么
 *
 * 2026-10-16/17 两天里，我**九次**把一张表的行写错（多一格 / 少一格 / 插了一行不以 `|` 开头的），
 * 而每一次都是**事后的** `--table-cells` 抓到的。⇒ 这个工具把检查**挪到写之前**。
 *
 * ## 用法
 *
 *   # 干跑（默认）：只说要插在哪、会不会破表，不写文件
 *   node scripts/safe-table-row.mjs <文件> <锚点> <新行文件>
 *
 *   # 真写（只有列数通过才写）
 *   node scripts/safe-table-row.mjs <文件> <锚点> <新行文件> --write
 *
 * `<锚点>` 是一段**必须恰好出现一次**的文本；新行插在它**之后**的那一行之前。
 *
 * ## 它怎么判"对齐"
 *
 * 表以**分隔行**（`|---|`）为准 —— 与 `--table-cells` 同一条纪律。
 * ⇒ 先在**内存里**把新行插进去，再对**整张表**重新数一遍；**任何一行不等就拒绝写**。
 *
 * ⚠️ **它只查列数**，不查内容（写作质量、事实对不对，那还是人的事）。
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** 把一行按 `|` 拆成单元格，`\|` 先遮掉。返回 `|` 的个数（N 列 ⇒ N+1 个竖线）。 */
export function pipeCount(line) {
  return line.replace(/\\\|/g, '\u0001').split('|').length - 1;
}


/**
 * **从一组单元格生成一行** —— 裸竖线自动转义，列数**由构造保证**。
 *
 * 🔴 为什么要有：2026-10-16/17 两天里我**十次**把表写坏，而**绝大多数是"格子里有裸竖线"**
 * （`grep -E "a|b"`、`\`|\``、`process.env.X || 'v'`…）。⇒ **校验**只能事后拦住，
 * **生成**能让它**不可能发生**。
 *
 * ⚠️ 它**只转义还没转义的**竖线：`\|`（已转义）保持原样 —— 否则会把 `\|` 变成 `\\|`。
 */
export function escapeCell(cell) {
  return String(cell).replace(/(?<!\\)\|/g, '\\|');
}

/** `renderRow(['a','b','c'])` ⇒ `| a | b | c |`（`pipeCount` 恒为 `cells.length + 1`）。 */
export function renderRow(cells) {
  if (cells.length === 0) throw new Error('至少要有一个单元格');
  return `| ${cells.map(escapeCell).join(' | ')} |`;
}

/** 找 `idx` 所在的那张表：往上找表头、往下找分隔行。返回期望的竖线数；找不到表返回 null。 */
export function expectedPipes(lines, idx) {
  // 🔴 **分隔行在数据行的上方** ⇒ 必须**向上找**。
  //    第一版向下找 ⇒ 最后一行（下面就是空行）永远找不到分隔行，被误判成"这里不是表格"。
  // ⚠️ `idx` 可能**等于 `lines.length`**（锚点就是最后一行时）⇒ 从最后一行开始往回找。
  for (let i = Math.min(idx, lines.length - 1); i >= 0; i -= 1) {
    const t = (lines[i] ?? '').trim();
    if (/^\|[\s:|-]+\|$/.test(t)) return pipeCount(lines[i]);
    if (t !== '' && !t.startsWith('|')) break;
  }
  return null;
}

/** 干跑：返回 `{ ok, where, want, got }`。 */
export function checkInsert(text, anchor, newRow) {
  const lines = text.split('\n');
  const hits = lines.map((l, i) => (l.includes(anchor) ? i : -1)).filter((i) => i !== -1);
  if (hits.length === 0) return { ok: false, why: `锚点没找到：${anchor}` };
  if (hits.length > 1) return { ok: false, why: `锚点出现 ${hits.length} 次（必须唯一）：${anchor}` };
  const at = hits[0] + 1;
  const want = expectedPipes(lines, at);
  if (want === null) return { ok: false, why: `锚点那句下面不是表格：${anchor}` };
  // 🔴 **新行本身必须以 `|` 开头** —— 否则它会**掉出表格**（渲染成普通段落），
  //    而下面的"整表重扫"会**跳过**不以 `|` 开头的行 ⇒ 不查这条就放过去了（自检第 4 臂抓到）。
  if (!newRow.trimStart().startsWith('|')) return { ok: false, why: '新行不是以 `|` 开头的表格行' };
  const got = pipeCount(newRow);
  const next = [...lines.slice(0, at), newRow, ...lines.slice(at)];
  // 插入之后，**整张表**每一行都要等 —— 而不只看新行
  const bad = [];
  for (let i = 0; i < next.length; i += 1) {
    if (!/^\|/.test(next[i].trim())) continue;
    if (/^\|[\s:|-]+\|$/.test(next[i].trim())) continue;
    const w = expectedPipes(next, i);
    if (w !== null && pipeCount(next[i]) !== w) bad.push(i + 1);
  }
  return { ok: bad.length === 0, where: at + 1, want, got, bad, next };
}


/**
 * **替换**一行之前，先确认**新旧两行**都和表对齐。
 *
 * 🔴 为什么要有：2026-10-17 我把 §9.1 的一行**替换**成了 3 格，而那张表只有 2 列 —— 之所以没被拦住，
 * **是因为 `checkInsert` 只管"插入"，替换根本没走它**（`B118`）。
 * ⇒ 替换也要有闸门，而且**新旧两行都要查**（老行可能**本来就是坏的**，那样"替换"会把它一起写进去）。
 */
export function checkReplace(text, anchor, newRow) {
  const lines = text.split('\n');
  const hits = lines.map((l, i) => (l.includes(anchor) ? i : -1)).filter((i) => i !== -1);
  if (hits.length === 0) return { ok: false, why: `锚点没找到：${anchor}` };
  if (hits.length > 1) return { ok: false, why: `锚点出现 ${hits.length} 次（必须唯一）：${anchor}` };
  if (!newRow.trimStart().startsWith('|')) return { ok: false, why: '新行不是以竖线开头的表格行' };
  const at = hits[0];
  const want = expectedPipes(lines, at);
  if (want === null) return { ok: false, why: `锚点那行不在表格里：${anchor}` };
  const oldGot = pipeCount(lines[at]);
  if (oldGot !== want) {
    return { ok: false, why: `**被替换的那行本来就是坏的**（${oldGot} 个竖线，表要 ${want} 个）⇒ 先修它，别用替换盖过去` };
  }
  const got = pipeCount(newRow);
  if (got !== want) return { ok: false, why: `新行 ${got} 个竖线，表要 ${want} 个` };
  const next = [...lines.slice(0, at), newRow, ...lines.slice(at + 1)];
  return { ok: true, line: at + 1, want, got, next };
}


/**
 * **按行号替换**一行 —— 锚点不唯一时的出口。
 *
 * 🔴 为什么要有（`B217`）：2026-10-17 我改 §1 的 `A7` 那行，而 `| **A7** |` 在 §1 与 §9 各出现一次
 * ⇒ `checkReplace` 拒绝（"锚点出现 2 次"）⇒ 我**退化成手拼行**，然后**连踩三个坑**（缺首尾竖线、多一格、少个空格）
 * ⇒ **三个都被判据抓到，但本该由工具拦住**。
 * ⇒ 所以给一个"**你知道是哪一行**"的入口：**行号必须指向一个真正的表格行**，且**新旧两行都要和表对齐**。
 */
export function checkReplaceAtLine(text, lineNo, newRow) {
  const lines = text.split('\n');
  if (!Number.isInteger(lineNo) || lineNo < 1 || lineNo > lines.length) {
    return { ok: false, why: `行号越界：${lineNo}（这份文件共 ${lines.length} 行）` };
  }
  if (!newRow.trimStart().startsWith('|')) return { ok: false, why: '新行不是以竖线开头的表格行' };
  const at = lineNo - 1;
  if (!/^\|/.test(lines[at].trim())) return { ok: false, why: `第 ${lineNo} 行不是表格行：${lines[at].slice(0, 60)}` };
  if (/^\|[\s:|-]+\|$/.test(lines[at].trim())) return { ok: false, why: `第 ${lineNo} 行是**分隔行**（\`|---|\`），不是数据行` };
  const want = expectedPipes(lines, at);
  if (want === null) return { ok: false, why: `第 ${lineNo} 行不在表格里` };
  const oldGot = pipeCount(lines[at]);
  if (oldGot !== want) {
    return { ok: false, why: `**被替换的那行本来就是坏的**（${oldGot} 个竖线，表要 ${want} 个）⇒ 先修它` };
  }
  const got = pipeCount(newRow);
  if (got !== want) return { ok: false, why: `新行 ${got} 个竖线，表要 ${want} 个` };
  const next = [...lines.slice(0, at), newRow, ...lines.slice(at + 1)];
  return { ok: true, line: lineNo, want, got, next };
}


/** 打印**新旧两行**的差异（截断到 110 字）—— 闸门拦列数，**不拦内容**，所以让人自己看一眼。 */
export function formatDiff(oldLine, newLine) {
  const cut = (s) => (s.length > 110 ? `${s.slice(0, 110)}…` : s);
  const out = [];
  if (oldLine === null) out.push(`  + 新增: ${cut(newLine)}`);
  else { out.push(`  - 旧: ${cut(oldLine)}`); out.push(`  + 新: ${cut(newLine)}`); }
  return out.join('\n');
}

/** 自检：三条臂（多一格 / 少一格 / 正确）。 */
function selfTest() {
  const table = ['| a | b |', '|---|---|', '| x | y |'].join('\n');
  // ⚠️ 锚点要选**最后一个数据行**（`| x | y |`）—— 选表头的话新行会插到分隔行前面（自检第 1 版就这样错）。
  const anchor = '| x | y |';
  const arms = [
    ['正确 ⇒ 通过', checkInsert(table, anchor, '| p | q |').ok === true],
    ['多一格 ⇒ 拒绝', checkInsert(table, anchor, '| p | q | r |').ok === false],
    ['少一格 ⇒ 拒绝', checkInsert(table, anchor, '| p |').ok === false],
    ['不以 | 开头 ⇒ 拒绝', checkInsert(table, anchor, 'p | q |').ok === false],
    ['锚点不存在 ⇒ 拒绝', checkInsert(table, 'zzz', '| p | q |').ok === false],
    ['renderRow：裸竖线被转义 ⇒ 仍是 2 格', pipeCount(renderRow(['a|b', 'c'])) === 3],
    ['renderRow：已转义的竖线不二次转义', renderRow(['a\\|b']).includes('a\\|b')],
    ['checkReplace：列数对 ⇒ 通过', checkReplace(table, '| x | y |', '| p | q |').ok === true],
    ['checkReplace：新行 3 格 ⇒ 拒绝', checkReplace(table, '| x | y |', '| p | q | r |').ok === false],
    ['formatDiff：新增只一行，替换两行',
      formatDiff(null, 'x').split('\n').length === 1 && formatDiff('a', 'b').split('\n').length === 2],
    ['checkReplace：老行本来就坏 ⇒ 拒绝',
      checkReplace(['| a | b |', '|---|---|', '| x | y | z |'].join('\n'), '| x | y | z |', '| p | q |').ok === false],
  ];
  {
    const t = '| a | b |\n|---|---|\n| 1 | 2 |\n| **A7** | x |';
    const good = checkReplaceAtLine(t, 4, '| **A7** | y |');
    const badCount = checkReplaceAtLine(t, 4, '| **A7** | y | z |');
    const notRow = checkReplaceAtLine(t, 2, '| **A7** | y |');
    const oob = checkReplaceAtLine(t, 99, '| **A7** | y |');
    arms.push(['臂 --line：同内容锚点出现两次也能按行号替换（成功）', good.ok === true]);
    arms.push(['臂 --line：列数多一格 ⇒ 拒绝', badCount.ok === false]);
    arms.push(['臂 --line：行号指到分隔行 ⇒ 拒绝', notRow.ok === false]);
    arms.push(['臂 --line：行号越界 ⇒ 拒绝', oob.ok === false]);
  }
  for (const [name, ok] of arms) console.log(`  ${ok ? '✅' : '🔴'} ${name}`);
  const failed = arms.filter(([, ok]) => !ok).length;
  console.log(`\n臂数 ${arms.length}，失败 ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

if (process.argv.includes('--line')) {
  const lineNo = Number(process.argv[process.argv.indexOf('--line') + 1]);
  const rest = process.argv.slice(2).filter((a) => !a.startsWith('--') && a !== String(lineNo));
  const [fileL, rowFileL] = rest;
  const textL = readFileSync(fileL, 'utf8');
  const rowL = readFileSync(rowFileL, 'utf8').replace(/\n$/, '');
  const rL = checkReplaceAtLine(textL, lineNo, rowL);
  if (!rL.ok) { console.log(`🔴 拒绝：${rL.why}`); process.exit(1); }
  console.log(`✅ 对齐（替换第 ${rL.line} 行，${rL.want} 个竖线）`);
  console.log(formatDiff(textL.split('\n')[rL.line - 1], rowL));
  if (process.argv.includes('--write')) { writeFileSync(fileL, rL.next.join('\n')); console.log('   已写入（--write）'); }
  else console.log('   （干跑；加 --write 才写文件）');
  process.exit(0);
}

if (process.argv.includes('--replace')) {
  const [file2, anchor2, rowFile2] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const text2 = readFileSync(file2, 'utf8');
  const row2 = readFileSync(rowFile2, 'utf8').replace(/\n$/, '');
  const r2 = checkReplace(text2, anchor2, row2);
  if (!r2.ok) { console.log(`🔴 拒绝：${r2.why}`); process.exit(1); }
  console.log(`✅ 对齐（替换第 ${r2.line} 行，${r2.want} 个竖线）`);
  console.log(formatDiff(text2.split('\n')[r2.line - 1], row2));
  if (process.argv.includes('--write')) { writeFileSync(file2, r2.next.join('\n')); console.log('   已写入（--write）'); }
  else console.log('   （干跑；加 --write 才写文件）');
  process.exit(0);
}

if (process.argv.includes('--render')) {
  const cellsFile = process.argv[process.argv.indexOf('--render') + 1];
  const cells = JSON.parse(readFileSync(cellsFile, 'utf8'));
  process.stdout.write(renderRow(cells));
  process.exit(0);
}

const isMain = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (process.argv.includes('--self-test')) selfTest();
  const [file, anchor, rowFile] = args;
  if (file === undefined || anchor === undefined || rowFile === undefined) {
    console.log('用法: node scripts/safe-table-row.mjs <文件> <锚点> <新行文件> [--write]');
    process.exit(2);
  }
  const text = readFileSync(file, 'utf8');
  const row = readFileSync(rowFile, 'utf8').replace(/\n$/, '');
  const r = checkInsert(text, anchor, row);
  if (!r.ok) {
    console.log(`🔴 拒绝：${r.why ?? `插入后第 ${r.bad.join(' / ')} 行的列数不对`}`);
    if (r.want !== undefined) console.log(`   期望 ${r.want} 个竖线，新行有 ${r.got} 个`);
    process.exit(1);
  }
  console.log(`✅ 对齐（第 ${r.where} 行，${r.want} 个竖线）`);
  console.log(formatDiff(null, row));
  if (process.argv.includes('--write')) {
    writeFileSync(file, r.next.join('\n'));
    console.log('   已写入（--write）');
  } else {
    console.log('   （干跑；加 --write 才写文件）');
  }
}
