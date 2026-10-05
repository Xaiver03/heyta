#!/usr/bin/env node
/**
 * **评审辅助，不是门禁。** 扫 `docs/research/self-host-distribution-audit.md` 的缺口登记表，
 * 把"登记行说没关，而正文后来说关了"这一类**互相打脸**的行打成候选给人看。
 *
 * 为什么不挂进 `pnpm check`（这条决定是量出来的，不是偏好）：
 * 判状态只能扫关键词，而**引用旧措辞本身就是关键词命中**。2026-10-05 第一次跑它时的实测假阳性
 * 就是这一条的自证：`G-47` 那一行已经改成"已闭"，可它后面跟着解释漂移的那句
 * `这半句曾在行尾挂了很久"未闭"` —— 引号里的 `未闭` 让它在纯关键词裁判下仍然是红的。
 * 一条会这样红的判据挂进链里，下一次真漂移就混在噪音里没人看 ⇒ 比没有判据更糟（AGENTS §7 元规则 2）。
 *
 * 所以它的正确用法是：**写完"某条已关"那一段之后跑一次**，把候选逐条读一遍。
 * 台账里那两处真漂移（`G-42` 整行、`G-47` 行尾那句 `G-53 … 未闭`）就是这么找到的，
 * 读数与回写在 §8.159。
 *
 * 用法：node research/tools/selfhost-registry-drift-sweep.mjs [文档路径]
 *      退出码：0 = 跑完了（候选不为零也退 0，它是给人读的）；2 = 装置没接上（读不到文件 / 一行登记都没抓到）。
 *
 * 🔴 **为什么今天不挂进 `pnpm check`**（两条都是现量，不是偏好）：
 *  1. 挂链要改根 `package.json`，而它此刻正是**落地的唯一阻塞项**（`selfhost-landing-blockers.mjs` 现量
 *     `阻塞集 1 枚 = package.json`，别人未提交）—— 为一条评审辅助去加宽那一枚的合并面，拿窗口换便利；
 *  2. 更自然的落点是 `research/tools/docs-link-check.mjs`（它已经在管"章节引用有效"这类事），
 *     但那枚文件此刻在主检出里是 `M`（别人正在改它）。本分支一碰它，它就从"不重叠"变成重叠 + 未提交 ⇒
 *     进阻塞集，且它不在预置十一族里 ⇒ 开窗时直接 `fam.other`。
 *  ⇒ 现在它是**工具**；等落地之后这两条前提都不成立时，再决定要不要给它一条会红的判据
 *    （真判据的形状见下面"规则 A"：登记行的状态栏必须指着一个 `§8.x` 现场，光"§7 备好"那种没有现场的最容易烂）。
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOC = process.argv[2] ?? join(ROOT, 'docs/research/self-host-distribution-audit.md');
if (!existsSync(DOC)) {
  console.error(`🔴 读不到要扫的文档：${DOC} ⇒ 没有分母（这不叫"没有漂移"）`);
  process.exit(2);
}

const lines = readFileSync(DOC, 'utf8').split('\n');
const OPEN = /未关|未闭|未做|尚未|待拍板|待落地|未实现|未验|❔/;
const CLOSED = /已关|已闭|本批关闭|已按.*关闭|转正/;
const ROW_RE = /^\|\s*((?:G-\d+[①-⑧b]?|#\d+))\s*\|/;

/* 登记表行：同一个编号可能在好几张表里各有一行，逐行都收（只留第一条就会把"另一张表还没回写"漏掉）。 */
const rows = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(ROW_RE);
  if (!m) continue;
  const cells = lines[i].split('|').map((c) => c.trim()).filter((c) => c !== '');
  rows.push({ id: m[1], line: i + 1, status: cells[cells.length - 1] ?? '', lineText: lines[i] });
}

/* 正文里的结论句：按它所属的 `### 8.x` 小节归位，这样"最新"才有可比较的单位（行号只用来排序）。 */
let section = '（§8.x 之前的前言段）';
const mentions = new Map();
for (let i = 0; i < lines.length; i++) {
  const h = lines[i].match(/^### (8\.\d+)/);
  if (h) section = `§${h[1]}`;
  if (ROW_RE.test(lines[i])) continue;
  for (const r of rows) {
    if (!lines[i].includes(r.id)) continue;
    const e = mentions.get(r.id) ?? { closed: [], open: [] };
    if (CLOSED.test(lines[i])) e.closed.push({ line: i + 1, section });
    if (OPEN.test(lines[i])) e.open.push({ line: i + 1, section });
    mentions.set(r.id, e);
  }
}

let candidates = 0;
for (const r of rows) {
  const m = mentions.get(r.id) ?? { closed: [], open: [] };
  const lastClosed = m.closed[m.closed.length - 1];
  if (!OPEN.test(r.status) || !lastClosed || lastClosed.line <= r.line) continue;
  const cited = r.status.includes(lastClosed.section);
  candidates++;
  console.log(`${cited ? 'ℹ️ 已引用' : '⚠️ 候选'} ${r.id} 行 ${r.line}：状态 "${r.status.slice(0, 52)}…" ` +
    `而正文 ${lastClosed.section}（第 ${lastClosed.line} 行）说它已关` +
    (cited ? ' —— 行里已指向那一节，多半是**引用旧措辞**造成的命中，读一眼即可' : ' —— 这行**没有指向**那一节，八成是登记没回写'));
}

/* 规则 A（真判据的形状）：整行必须指着一个 `§8.x` 现场。
 * 🔴 读**整行**而不是只读状态栏：`G-48b` 那行的现场写在中间那格（"§8.19 读数 B"），
 *    只读最后一格就会把它误报成没有出处 —— 只看一栏的判据测不到"其实写了，写在别处"。
 * 没有现场的状态行是最容易烂的那种 —— 它没有任何东西会把人带回正文去复核。
 * 今天实测：改之前 `G-42` 那行整行只写着"改法已在 §7 备好"（指本文档的静态章节，不是出事现场），
 * 而它正是这批里唯一一条**正文从不点它的名**、于是六天没人回去看过的登记行。 */
let noScene = 0;
for (const r of rows) {
  if (/§8\.\d+/.test(r.lineText)) continue;
  noScene++;
  console.log(`⚠️ 规则A ${r.id} 行 ${r.line}：整行没有「§8.x」现场 ⇒ 这行烂了也没人会被带回去看：` +
    `"${r.status.slice(0, 60)}…"`);
}

if (rows.length === 0) {
  console.error('🔴 一行登记都没抓到 ⇒ 表格形状变了，本工具的锚点已经够不着（这不叫"没有漂移"）');
  process.exit(2);
}
console.log(`\n登记表行 ${rows.length} 条（编号 ${new Set(rows.map((x) => x.id)).size} 个）· 正文"已关"类结论 ` +
  `${[...mentions.values()].reduce((a, e) => a + e.closed.length, 0)} 处 · 打脸候选 ${candidates} 条 · 无现场行 ${noScene} 条`);
console.log('这是评审辅助：候选要逐条读，命中不等于缺陷（见文件头那条实测假阳性）。它今天不挂链，理由也在那儿。');

