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
const REGISTRY_FILE = path.join(ROOT, 'packages/local-api/src/tools/registry.ts');
const TOOLS_DIR = path.join(ROOT, 'packages/local-api/src/tools');
const LEGAL_FILE = path.join(ROOT, 'packages/legal/src/documents/ai-and-transfer.ts');

/**
 * 目录里的工具名**集合**（排序后返回）。
 *
 * 🔴 为什么不再从 `tools.ts` 里找 `export const LOCAL_API_TOOLS`：目录已按实体拆包，
 * `tools.ts` 那一行现在只是 `export { LOCAL_API_TOOLS } from './tools/registry.js'`，
 * 定义搬到了 `tools/registry.ts` 的装配表 + 各实体文件。继续按旧形状扫的结果是
 * 门禁对着合并态直接抛异常（"目录解析不到"），而它要拦的那件事——**加了工具没写进条款**——
 * 反而没人说了。
 *
 * 取数口径：**只认装配表真的并进来的那些实体文件**，所以一个新工具不会因为
 * 写在别的文件里就悄悄漏掉，也不会因为多写了一行 `name:` 就凭空多出来。
 * 这里刻意**不复刻** registry 的"读在前、写在后"顺序规则 —— 那是 `buildToolPackRegistry`
 * 的不变量，由 `packages/local-api/tests/server.spec.ts` 与 node-host 的 stdio 用例逐字钉着；
 * 本门禁要的是集合相等 + 中英两表**互相**同序（见下面的 `join(',')` 比较）。
 */
function catalogNames() {
  const reg = readFileSync(REGISTRY_FILE, 'utf8');
  const block = /export const LOCAL_API_TOOL_PACKS[^\n]*\n([\s\S]*?)\n\];/.exec(reg);
  if (block === null) {
    throw new Error(`${REGISTRY_FILE} 里找不到 \`export const LOCAL_API_TOOL_PACKS\` —— 装配表就是这个集合的定义处，解析前提破了，不是文档的问题`);
  }
  const symbols = [...block[1].matchAll(/^\s*(\w+),/gm)].map((m) => m[1]);
  if (symbols.length === 0) throw new Error('装配表里一个 pack 都没有 ⇒ 这条判据没有分母');
  const moduleOf = new Map(
    [...reg.matchAll(/import \{ (\w+) \} from '\.\/([a-z-]+)\.js'/g)].map((m) => [m[1], m[2]]),
  );
  const names = [];
  for (const symbol of symbols) {
    const mod = moduleOf.get(symbol);
    if (mod === undefined) {
      throw new Error(`装配表并进了 ${symbol}，但 ${REGISTRY_FILE} 里读不到它的结构导入 —— 无法判断它来自哪个实体文件`);
    }
    const src = readFileSync(path.join(TOOLS_DIR, `${mod}.ts`), 'utf8');
    const marks = [...src.matchAll(/^\s+name: '([a-z_]+)',$/gm)];
    for (let i = 0; i < marks.length; i += 1) {
      const seg = src.slice(marks[i].index, i + 1 < marks.length ? marks[i + 1].index : src.length);
      // 只认工具对象（带 kind 的那一段），不认参数 schema 里同名的键
      if (/kind: '(read|write)',/.test(seg)) names.push(marks[i][1]);
    }
    if (marks.length === 0) throw new Error(`${mod}.ts 里解析不到任何 \`name:\` —— ${symbol} 声称有工具却没有声明`);
  }
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length > 0) {
    throw new Error(`同一个工具名出现在两个实体文件里：${[...new Set(dupes)].join(', ')} —— registry 运行时会抛，但门禁不能等到运行时`);
  }
  return [...names].sort();
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
