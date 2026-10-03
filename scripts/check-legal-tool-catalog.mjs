#!/usr/bin/env node
/**
 * 法务条款里的**本机接口工具表**必须与实际工具目录对账
 * ====================================================
 *
 * 为什么要有这一条（W10 实测出来的洞）：
 *
 * `packages/legal/src/documents/ai-and-transfer.ts` 里有一张逐工具的表，表后紧跟一句
 * 「未列出的工具视为未授权」。那句话把**这张表当成了授权面** —— 于是少一行不是
 * "文档少写一格"，而是**对着用户少说一项"打开之后那个程序能读到什么"**。
 * W10 给目录加了 4 条 EVENT 工具（读 2 写 2），而**没有任何一层会红**：
 * `check:legal-copy` 只管生成物与真源一致，`check:ai-tools` 只管 AI 那条链，
 * 两边的名字集合谁都没比过。这属于 §7 元规则 2 说的"恒不失败的判据"的反面 ——
 * **判据根本不存在**。
 *
 * 三条判定，每条都拦一个真实会被写出来的错：
 *
 * | # | 判据 | 拦住的是 |
 * |---|---|---|
 * | 1 | 中文表的工具名集合 == `LOCAL_API_TOOLS` | 加了工具忘了披露（就是 W10 这一次） |
 * | 2 | 英文表的工具名集合 == `LOCAL_API_TOOLS` | **只改一边**（L 系列硬要求双语成对） |
 * | 3 | 两表**逐行同序** | 名字都在、集合也相等，但**行贴错了对象**（只在中文侧重排、或中英行序不同） |
 *
 * ⚠️ 第 3 条不是洁癖：臂 C 实测的就是"中文表里把最后两行整行上下交换"——
 * 此时判据 1 与 2 完全无感（两边名字集合都还等于目录），而渲染出来的界面会是
 * 「`update_event` — 新建倒数日」。只有顺序能抓住它。
 *
 * 读法照本仓门禁的既有习惯：**扫源码，不依赖构建产物**（否则"忘了 build"会伪装成"文档漂了"）。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS_FILE = path.join(ROOT, 'packages/local-api/src/tools.ts');
const LEGAL_FILE = path.join(ROOT, 'packages/legal/src/documents/ai-and-transfer.ts');

/** 目录里 `LOCAL_API_TOOLS` 那一段的 `name:`，按声明顺序。 */
function catalogNames() {
  const text = readFileSync(TOOLS_FILE, 'utf8');
  const start = text.indexOf('export const LOCAL_API_TOOLS');
  if (start < 0) throw new Error(`${TOOLS_FILE} 里找不到 \`export const LOCAL_API_TOOLS\``);
  const end = text.indexOf('\n];', start);
  if (end < 0) throw new Error(`${TOOLS_FILE} 里 \`LOCAL_API_TOOLS\` 数组没有闭合（判据的前提破了，不是文档的问题）`);
  return [...text.slice(start, end).matchAll(/^\s+name: '([a-z_]+)',$/gm)].map((m) => m[1]);
}

/** 从法务文件里取出两张工具表（按出现顺序：中、英）。 */
function legalTables() {
  const lines = readFileSync(LEGAL_FILE, 'utf8').split('\n');
  const tables = [];
  for (let i = 0; i < lines.length; i += 1) {
    const head = /^\s*head: \['(工具|Tool)',/.exec(lines[i]);
    if (head === null) continue;
    if (!/^\s*rows: \[$/.test(lines[i + 1] ?? '')) {
      throw new Error(`${LEGAL_FILE}:${String(i + 1)} 的表头后面不是 \`rows: [\`，解析前提不成立`);
    }
    const names = [];
    for (let j = i + 2; j < lines.length; j += 1) {
      const row = /^\s*\['`([a-z_]+)`',/.exec(lines[j]);
      if (row !== null) {
        names.push(row[1]);
        continue;
      }
      if (/^\s*\],$/.test(lines[j])) break;
      if (/^\s*\[/.test(lines[j])) {
        throw new Error(`${LEGAL_FILE}:${String(j + 1)} 有一行的第一个格子不是反引号包起来的工具名，无法对账`);
      }
    }
    tables.push({ lang: head[1] === '工具' ? 'zh' : 'en', line: i + 1, names });
  }
  return tables;
}

const catalog = catalogNames();
const tables = legalTables();
const problems = [];

if (catalog.length === 0) problems.push('工具目录解析出 0 条 —— 判据没有分母，先修解析');
if (tables.length !== 2) {
  problems.push(`法务文件里应当恰好有 2 张工具表（中、英各一张），实际 ${String(tables.length)} 张`);
}

const zh = tables.find((t) => t.lang === 'zh');
const en = tables.find((t) => t.lang === 'en');
const want = [...catalog].sort();

for (const table of [zh, en]) {
  if (table === undefined) continue;
  const got = [...table.names].sort();
  const missing = want.filter((n) => !got.includes(n));
  const extra = got.filter((n) => !want.includes(n));
  if (missing.length > 0) {
    problems.push(
      `${table.lang === 'zh' ? '中文' : 'English'}表（第 ${String(table.line)} 行）缺 ${String(missing.length)} 个工具：${missing.join(', ')} —— 目录里有、条款里没说，而条款把这张表当成了授权面`,
    );
  }
  if (extra.length > 0) {
    problems.push(
      `${table.lang === 'zh' ? '中文' : 'English'}表（第 ${String(table.line)} 行）多出 ${String(extra.length)} 个：${extra.join(', ')} —— 条款里有、目录里没有，等于承诺了一个不存在的开关`,
    );
  }
}

if (zh !== undefined && en !== undefined && zh.names.join(',') !== en.names.join(',')) {
  problems.push(
    `中英两表的工具顺序不一致（集合相等也可能行贴错对象）：\n  zh: ${zh.names.join(' ')}\n  en: ${en.names.join(' ')}`,
  );
}

if (problems.length > 0) {
  console.error('❌ 法务条款里的本机接口工具表与目录不一致：');
  for (const p of problems) console.error(`  • ${p}`);
  console.error(`\n目录 ${String(catalog.length)} 条：${catalog.join(', ')}`);
  process.exit(1);
}

console.log(
  `✅ 本机接口工具表对账通过：目录 ${String(catalog.length)} 条 == 中文表 == 英文表，且中英逐行同序（${catalog.join(', ')}）`,
);
