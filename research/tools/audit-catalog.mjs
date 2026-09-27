#!/usr/bin/env node
/**
 * 词条表的**互补**审计
 * =====================
 *
 * `packages/i18n/tests/catalog.spec.ts` 已经保证了 5 条：key 集合一致、
 * zh 含汉字、en 不含汉字、没有空串、取值路径正确。
 *
 * 这个工具查的是它**没查**的几类，每一类都真的会出现：
 *
 *   1. **占位符在两种语言里不一致** —— 最危险的一类。zh 写了 `当前是 {port}`，
 *      翻译时漏了 `{port}`，界面上不是报错，而是**那半句话凭空消失**；
 *      反过来 en 多一个 `{port}` 则会在中英之间显示不一致的参数。
 *      现有测试对占位符**一个字都没查**（`translate.ts` 只是替换，缺变量时保留原样）。
 *   2. **en 里的中文标点** —— 规则 3 查的是"含汉字"，而 `，。：、（）「」` **不是汉字**，
 *      所以它们能悄悄通过门禁。
 *      ⚠️ 但 `·`（U+00B7）、`—`（U+2014）、`…`（U+2026）**在英文排版里是正常字符**，
 *      所以这里只把**中日韩标点区 / 全角区**判为错误，其余非 ASCII 只列出来供目视 ——
 *      第一版把 `Today · day {day}` 判成违规，那是假阳性。
 *   3. **两种语言逐字相同的词条** —— 除了 `common.brand` / `common.lang.*`
 *      这种"本来就该一样"的，其余相同就意味着"这条没翻"。
 *      （注意：现有测试能挡住"en 里填中文"，挡不住"en 里填的是同一句英文"。）
 *   4. **定义了但没人用的 key** —— 词条表只增不减，208 条新词条里混进死 key
 *      没有任何检查会报。判据是"这个字面量在 `apps/<app>/src` 或
 *      `packages/<pkg>/src` 里出现过"（门禁禁止拼 key，所以字面量匹配是可靠的；
 *      `labelKey: 'web.x'` 这类**以数据形式**持有的 key 也算用到）。
 *
 * ⚠️ 它**不是门禁**：1–3 是"应该修"，4 有明显误报可能（比如只在测试里用到的 key）。
 * 用法：
 *   node research/tools/audit-catalog.mjs
 *   node research/tools/audit-catalog.mjs --used-only   # 只报死 key
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ZH_PATH = path.join(ROOT, 'packages/i18n/src/locales/zh-CN.ts');
const EN_PATH = path.join(ROOT, 'packages/i18n/src/locales/en.ts');

/** 逐行解析 `  'key': 'value',`（门禁要求一条一行）。 */
function parseCatalog(file) {
  const out = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^ {2}'([^']+)':\s*'(.*)',?\s*$/.exec(line);
    if (m === null) continue;
    out.set(m[1], m[2]);
  }
  return out;
}

const PLACEHOLDER = /\{(\w+)\}/g;
const placeholders = (text) => [...text.matchAll(PLACEHOLDER)].map((m) => m[1]).sort();

const zh = parseCatalog(ZH_PATH);
const en = parseCatalog(EN_PATH);

const problems = [];
const eyeball = [];
const allowedSame = new Set(['common.brand', 'common.lang.zh', 'common.lang.en']);

for (const [key, zhText] of zh) {
  const enText = en.get(key);
  if (enText === undefined) {
    problems.push(['缺 en', key, '']);
    continue;
  }

  // 1. 占位符必须一一对应。
  //    ⚠️ `…One` 这类**单数兄弟词条**会刻意不同：英文说 `this one place`，
  //    中文仍需要 `{count}`。所以只报出来供人确认，措辞上写明不是必然的错误。
  const a = placeholders(zhText).join(',');
  const b = placeholders(enText).join(',');
  if (a !== b) problems.push(['占位符不一致（需人确认）', key, `zh(${a || '无'}) vs en(${b || '无'})`]);

  // 2. en 里不许有中日韩标点 / 全角字符（那才是"从中文搬过来"的痕迹）
  const cjkPunct = [...enText].filter((ch) => /[\u3000-\u303f\uff00-\uffef]/.test(ch));
  if (cjkPunct.length > 0) problems.push(['en 含中文标点', key, [...new Set(cjkPunct)].join(' ')]);
  // 其余非 ASCII（·、—、…、弯引号）只记录，供目视 —— 它们在英文排版里合法
  const nonAscii = [...enText].filter((ch) => ch.codePointAt(0) > 127);
  if (nonAscii.length > 0 && cjkPunct.length === 0 && !allowedSame.has(key)) {
    eyeball.push([key, [...new Set(nonAscii)].join(' ')]);
  }

  // 3. 两种语言逐字相同
  if (zhText === enText && !allowedSame.has(key)) problems.push(['zh/en 相同', key, zhText]);
}

// 4. 死 key：在源码里找字面量
function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || ['node_modules', 'dist', 'build', 'coverage'].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) acc.push(full);
  }
  return acc;
}

const sources = [];
for (const group of ['apps', 'packages']) {
  for (const entry of readdirSync(path.join(ROOT, group), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const src = path.join(ROOT, group, entry.name, 'src');
    try {
      if (statSync(src).isDirectory()) sources.push(...walk(src));
    } catch {
      /* 没有 src 的包 */
    }
  }
}
// 词条表自己当然含有每个 key 的字面量 —— 排除 `packages/i18n`，
// 否则每个 key 都会"被用到"，这一项就永远是零。
const outside = sources.filter((f) => !f.includes(`${path.sep}packages${path.sep}i18n${path.sep}`));
const haystack = outside.map((f) => readFileSync(f, 'utf8')).join('\n');
// 两种引号都算：`main.tsx` 里是 `titleKey="web.error.storage.title"`。
// 第一版只找单引号，于是把两条**真的在用**的 key 报成了死 key。
const dead = [...zh.keys()].filter(
  (k) => !haystack.includes(`'${k}'`) && !haystack.includes(`"${k}"`),
);

const only = process.argv.includes('--used-only');
const groups = new Map();
for (const [kind, key, detail] of problems) {
  if (!groups.has(kind)) groups.set(kind, []);
  groups.get(kind).push([key, detail]);
}

console.log(`词条表：zh ${zh.size} 条 / en ${en.size} 条\n`);
let total = 0;
for (const [kind, items] of groups) {
  if (only && kind === '死 key') continue;
  total += items.length;
  console.log(`【${kind}】${items.length} 条`);
  for (const [key, detail] of items.slice(0, 25)) console.log(`   ${key}  ${detail}`);
  if (items.length > 25) console.log(`   … 还有 ${items.length - 25} 条`);
  console.log('');
}
if (!only) {
  console.log(`【定义了但源码里没出现】${dead.length} 条`);
  for (const k of dead.slice(0, 25)) console.log(`   ${k}`);
  if (dead.length > 25) console.log(`   … 还有 ${dead.length - 25} 条`);
  console.log('');
}
console.log(`【en 含非 ASCII 但非中文标点（目视，多半合法）】${eyeball.length} 条`);
for (const [key, chars] of eyeball) console.log(`   ${key}  ${chars}`);
console.log('');
console.log(total === 0 ? '✅ 真问题为零。' : `⚠️ 需处理 ${total} 条。（目视项 ${eyeball.length} 条不计入）`);