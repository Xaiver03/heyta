#!/usr/bin/env node
/**
 * 文档中心的"口音"门禁 —— 公开文档里不许出现开发向内容
 * ================================================
 *
 * 规则来自产品负责人 2026-10-01 的明确指令：
 * **文档中心（/help 的文章、速答、分类页）绝对不能放开发相关的东西；
 * 唯一例外是自托管那块 —— 自托管说明就是写给动手的人看的。**
 * 豁免区按内容划，不按页面划：文档中心的自托管篇、平台页与集成页的
 * 自托管段，都在豁免之列（它们是同一个"给动手的人的说明"）。
 *
 * 为什么它得是一道门禁，而不是一次人工改稿：
 * 上一轮交付里 `purgedAt` / `repeatRule` / `SQLite` / `RFC 5545` / `向量时钟`
 * 全部进过公开正文，而**没有任何一层报错** —— `check:ui-language` 的禁词表
 * 只扫源码里的硬编码字面量，词条表（文案的唯一事实源）恰恰不在它的扫描范围内。
 * 字典里放什么，页面上就说什么；所以对"面向访客的那部分字典"需要一道自己的闸。
 *
 * 判据：对两个 locale 里所有 `site.*` 词条（落地页公开文案）逐条扫禁词表；
 * `site.docs.selfhost.*` **整篇豁免**。范围取 `site.*` 而不只是 `site.docs.*`，
 * 是因为速答（`site.help.*`）与功能页同样面对访客 —— 同一条标准。
 *
 * 🔴 禁词表是"这轮抓到过真问题"的清单，不是语言学：每一项都对应一次真实出现过的
 * 开发向措辞。RRULE / JSON / Markdown / MCP / API 刻意**不在**表里 —— 它们是
 * 产品表面（界面里就有"自定义 RRULE"输入框、导出的文件就是 JSON），
 * 禁它们会把正确的产品文案误杀。
 *
 * 与 `check:ui-language` 的分工：那边管"硬编码文案"与"中英同步"，
 * 这里管"字典本身的口音"。两边同时绿，`pnpm check` 的这一段才算绿。
 */

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// 豁免判据只有一份（2026-10-01 两套门禁打架的成因与理由写在那个文件头）。
import { isSelfhostCopyKey as isSelfhostKey } from './selfhost-voice.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const LOCALES = [
  { file: 'packages/i18n/src/locales/zh-CN.ts', label: 'zh-CN' },
  { file: 'packages/i18n/src/locales/en.ts', label: 'en' },
];


/**
 * 禁词表。判据：这个词出现在面向访客的文案里，只可能是开发视角漏出来了。
 * 每一项后面写它抓的是什么，将来加词时照这个格式补理由。
 */
const FORBIDDEN = [
  // 内部字段与存储引擎名（上轮真实漏出去过的）
  'purgedAt',
  'repeatRule',
  'deletedAt',
  'clientId',
  'SQLite',
  'IndexedDB',
  'op-log',
  'op log',
  // 同步内核与加密算法（隐私页说行为，自托管篇说机制）
  '向量时钟',
  'vector clock',
  'LWW',
  'Argon2',
  'AES-GCM',
  // 规范编号与实现语义（RRULE 本身是界面输入框，允许；编号不允许）
  'RFC ',
  'causal history',
  'floating semantics',
  // 命令行接口的内部叫法与 flag（命令行入口只在自托管篇教）
  'Node 宿主',
  '命令行宿主',
  'node-host',
  '--out',
  '--in',
  '--due',
  '--db',
  // 部署与协议的内部名词（只在自托管篇出现）
  'JWT',
  'WebAuthn',
  'env.example',
  'Docker',
  'docker',
  'schema',
  'Schema',
];

/** 从一个 locale 文件里按行抽出 `'key': 'value',` 对。 */
function parseEntries(path, label) {
  const src = readFileSync(path, 'utf8');
  const entries = [];
  for (const [index, line] of src.split('\n').entries()) {
    // 词条行的统一形状：两个空格缩进 + 单引号 key + 冒号 + 单引号值 + 逗号。
    const match = /^  '([^']+)': '(.*)',\s*$/.exec(line);
    if (match === null) continue;
    entries.push({ key: match[1], value: match[2], line: index + 1, label });
  }
  return entries;
}

const violations = [];
const stats = { scanned: 0, exempt: 0 };

for (const { file, label } of LOCALES) {
  const path = join(repoRoot, file);
  for (const entry of parseEntries(path, label)) {
    // 只看落地页公开文案：`site.*`。应用内的 `web.*` / `mobile.*` 等不在本闸范围
    // （它们的口音由各端自己的验收管）。
    if (!entry.key.startsWith('site.')) continue;
    if (isSelfhostKey(entry.key)) {
      stats.exempt += 1;
      continue;
    }
    stats.scanned += 1;
    for (const term of FORBIDDEN) {
      if (entry.value.includes(term)) {
        violations.push({
          file: relative(repoRoot, path),
          line: entry.line,
          key: entry.key,
          term,
          excerpt: entry.value.slice(0, 80),
        });
      }
    }
  }
}

// 🔴 判据必须能失败的前提是它真的扫到了东西：site 词条数与豁免数都有底线。
// 底线取"远小于现状但大于零"的整数 —— 它们的职责是抓住"扫描器解析坏了"，
// 不是给词条数记账（那会变成一条会过期的判据，见 §7 第 33 条）。
if (stats.scanned < 100) {
  console.error(
    `❌ 只解析到 ${stats.scanned} 条 site.* 词条（预期数百条）—— 解析器与文件形状脱钩了，本闸的"通过"不可信。`,
  );
  process.exit(1);
}
if (stats.exempt < 20) {
  console.error(
    `❌ 自托管豁免区只有 ${stats.exempt} 条 —— 要么 selfhost 词条被误删，要么 key 前缀改了而本闸不知道。`,
  );
  process.exit(1);
}

if (violations.length > 0) {
  console.error(`❌ 公开文档出现开发向内容（${violations.length} 处）。`);
  console.error('   规则：文档中心不放开发内容；唯一豁免 = 自托管相关文案（isSelfhostKey）。');
  console.error('');
  for (const v of violations) {
    console.error(`   · ${v.file}:${v.line}  ${v.key}`);
    console.error(`     命中「${v.term}」：${v.excerpt}…`);
  }
  console.error('');
  console.error('   改法：把这句话改成访客视角的说法；内容本身属于开发者/运维的，搬进自托管篇。');
  process.exit(1);
}

console.log(
  `✅ 文档口音合规：扫描 site.* ${stats.scanned} 条（豁免自托管 ${stats.exempt} 条），禁词表 ${FORBIDDEN.length} 项零命中。`,
);
