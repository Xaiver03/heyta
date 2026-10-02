#!/usr/bin/env node
/**
 * 门禁：三个原生壳的**裸视觉值**（P0-9，2026-10-01 UI 审计 G1）
 * ================================================================
 *
 * 为什么存在：`check:design`（check-hardcoded.mjs）的 SCAN_EXT 只认
 * `.ts/.tsx/.js/.jsx/.css` —— `.swift/.cs/.xaml/.c` 天然在语言覆盖之外，
 * 于是三个原生壳是设计系统的**盲区**：Windows 壳的 shell 切片全是
 * `FontSize="28"`、`Opacity="0.7"` 式裸值，Linux 壳零 token 接入，
 * macOS 壳的颜色 token「可读不可用」只能用系统色。
 *
 * 本门禁补最小的一条：**裸 hex 颜色一律不许出现在三壳的手写源码里**。
 * 深度对齐（rem/px/无单位数字的 AST 级检查）刻意不做 —— 那需要对每门
 * 语言各写一个解析器，成本与收益不成比例；hex 是「颜色不归设计系统管」
 * 的最响信号，先拦它。
 *
 * 三个壳与 token 的**管道对账**由各自已有机制负责，这里不重复：
 *   · macOS：`scripts/check-macos-shell.mjs` 断言 HeytaTokens.swift 逐字节一致
 *     （sync-tokens.sh 拷贝）+ 消费点计数；
 *   · Windows：csproj 直接引用仓库唯一一份 generated/HeytaTokens.xaml
 *     （无拷贝 ⇒ 无漂移面），缺文件构建期报错；
 *   · Linux：Makefile 直接 -I 引用仓库唯一一份 generated/heyta-tokens.h，
 *     缺文件 make 报错。
 *
 * 用法：node scripts/check-native-bare-values.mjs
 * 非零退出 = 有裸 hex。每条豁免必须写 why。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname_(fileURLToPath(import.meta.url)), '..');

function dirname_(p) {
  return p.slice(0, p.lastIndexOf('/'));
}

/** 扫描根：壳源码目录 → 语言扩展名。 */
const SCAN = [
  { label: 'apps/desktop-macos（Swift）', path: 'apps/desktop-macos/Sources', exts: ['.swift'] },
  { label: 'apps/desktop-windows（C#/XAML）', path: 'apps/desktop-windows', exts: ['.cs', '.xaml'] },
  { label: 'apps/desktop-linux（C）', path: 'apps/desktop-linux/src', exts: ['.c', '.h'] },
];

/**
 * 豁免（相对仓库根，前缀匹配）。每条必须写 why。
 * 只有**生成物产地**豁免：token 表本身就是 hex 的家。
 */
const ALLOW = [
  {
    prefix: 'apps/desktop-macos/Sources/HeytaMac/Generated/HeytaTokens.swift',
    why: '设计系统 token 的 Swift 生成物（产地）——hex 就是它的内容',
  },
];

/** 裸 hex 颜色。排除 C 预处理里的 `#if`/`#include`（# 后不是 hex 字符）。 */
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;

function isHexLegit(m) {
  const s = m[0];
  return [4, 5, 7, 9].includes(s.length);
}

function collect(dir, exts, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'bin', 'obj', 'node_modules', 'dist'].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) collect(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

const problems = [];
let checked = 0;

for (const root of SCAN) {
  const abs = join(ROOT, root.path);
  let files;
  try {
    files = collect(abs, root.exts);
  } catch {
    console.log(`⏭  ${root.label}：目录不存在，跳过。`);
    continue;
  }
  for (const f of files) {
    const rel = relative(ROOT, f);
    if (ALLOW.some((a) => rel.startsWith(a.prefix))) continue;
    checked++;
    const raw = readFileSync(f, 'utf8');
    // 🔴 先剥块注释（Swift/C 的 /* */ 与 XAML 的 <!-- -->），**保留行数**
    //（用换行填充，保证报出的行号仍准确）——否则注释中间行（不以 * 开头）
    // 里的说明性 hex 会被误报。实测：HeytaMacApp.swift:1372 的 #282828 就是
    // 一段取色记录的注释，第一版没剥块注释时误报了它。
    // 行注释（// 与 ///）在剥完块注释后按行掐尾。
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/\/\/.*$/gm, '');
    const lines = stripped.split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(HEX_RE)) {
        if (!isHexLegit(m)) continue;
        problems.push({ file: rel, line: i + 1, text: m[0], root: root.label });
      }
    });
  }
}

console.log(`\n检查 ${checked} 个原生壳源文件（Swift / C# / XAML / C）的裸 hex 颜色。`);

if (problems.length > 0) {
  console.log(`\n🔴 ${problems.length} 处裸 hex —— 原生壳的颜色必须来自设计系统 token：\n`);
  const byFile = new Map();
  for (const p of problems) {
    if (!byFile.has(p.file)) byFile.set(p.file, []);
    byFile.get(p.file).push(p);
  }
  for (const [file, list] of byFile) {
    console.log(`   ${file}`);
    for (const p of list.slice(0, 6)) console.log(`      ${p.line}: ${p.text}  ← ${p.root}`);
    if (list.length > 6) console.log(`      …还有 ${list.length - 6} 处`);
  }
  console.log(
    '\n   修法：macOS 用 HeytaTokens.color(HeytaTokens.Light.colorXxx)；' +
      'Windows 用 {ThemeResource HeytaColorXxx}（App.xaml 已合并 generated/HeytaTokens.xaml）；' +
      'Linux 用 generated/heyta.gtk.css 的 @define-color / .heyta-* 样式类。\n' +
      '   若确属合理例外，把理由加进本脚本的 ALLOW（必须写 why）。\n',
  );
  process.exit(1);
}

console.log('\n✅ 原生壳无裸 hex 颜色。\n');
