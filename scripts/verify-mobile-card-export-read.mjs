#!/usr/bin/env node
/**
 * `verify-mobile-card-export.sh` 的读数器（把"从源文件里取一个值"这件事全部收在这里）。
 *
 * 🔴 为什么单独一个文件而不是 shell 里的 `node -e '…'`：
 * 这些取值要靠正则，而正则穿过 bash 单引号再穿过 JS 字符串字面量会**多落一层转义**
 * （`"\\s"` 到 RegExp 手里变成"字面反斜杠 + s"，于是恒不命中 —— 症状是"词条取不到"，
 * 看起来像产品缺词条）。转义层数这种东西不该靠小心，所以载荷落在文件里。
 *
 * 每条都遵守同一条纪律：**取不到就非零退出并点名取不到什么**，
 * 绝不返回空串让调用方把它当成"界面上没有这个东西"（空串会让后面的 grep 恒真）。
 *
 * 用法：
 *   node scripts/verify-mobile-card-export-read.mjs zh <i18n-key>
 *   node scripts/verify-mobile-card-export-read.mjs contract <导出名>
 *   node scripts/verify-mobile-card-export-read.mjs png <png 路径>
 *   node scripts/verify-mobile-card-export-read.mjs card-title <uiautomator.xml> <a11y 模板，{title} 为占位>
 */
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = process.env.HEYTA_REPO_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [mode, arg1, arg2] = process.argv.slice(2);

const die = (msg) => {
  process.stderr.write(`READER_FAIL ${msg}\n`);
  process.exit(2);
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** i18n 真源是**一行一条**的扁平表（`check:ui-language` 就靠这个形状解析）。 */
function zh(key) {
  const src = readFileSync(join(repoRoot, 'packages/i18n/src/locales/zh-CN.ts'), 'utf8');
  const re = new RegExp(`^\\s*'${escapeRe(key)}':\\s*'((?:[^'\\\\]|\\\\.)*)',\\s*$`, 'm');
  const m = src.match(re);
  if (!m) die(`zh 词条取不到：${key}`);
  const value = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  if (value === '') die(`zh 词条是空串：${key}`);
  return value;
}

/**
 * 契约常量：从**构建产物**里读那一对数，不在这里重算 `Math.round(1080*4/3)`。
 *
 * 🔴 为什么不 parse 源文件：`EXPORT_CARD_HEIGHT_PX` 是**推导值**（源文件里就是句
 * `Math.round(...)`），脚本再抄一遍公式就等于把契约的第二套算法写进验收里 ——
 * 那恰好是这张卡本单要防的事（"预览一套、导出另一套"）。
 * ⚠️ 代价是读的是 dist，所以必须验 dist 不比 src 旧（AGENTS §7 #27 那一族）。
 */
async function contract(name) {
  const srcFile = join(repoRoot, 'packages/shared-schema/src/card-export-contract.ts');
  const distFile = join(repoRoot, 'packages/shared-schema/dist/index.mjs');
  let st;
  try {
    st = statSync(distFile);
  } catch {
    die(`读不到 dist 产物（先 pnpm --filter @heyta/shared-schema build）：${distFile}`);
  }
  if (st.mtimeMs < statSync(srcFile).mtimeMs) {
    die(`dist 比 src 旧，数的是上一个版本：${distFile}`);
  }
  const mod = await import(pathToFileURL(distFile).href);
  const value = mod[name];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    die(`契约常量缺失或不是正整数：${name} = ${String(value)}`);
  }
  return String(value);
}

/**
 * 光栅读数一律复用仓库里那台**唯一**的 PNG 读数器（`scripts/screenshots/png-stats.mjs`），
 * 不在验收脚本里再解析一遍 IHDR。
 *
 * 🔴 透明这件事要的是 `hasTransparency`（逐样本看有没有非满 alpha），
 *    **不是** `hasAlpha`（那只是 IHDR colorType 带不带 alpha 通道）——
 *    web 那张成品图 colorType 是 RGBA 而像素全不透明，拿 `hasAlpha` 当判据会把
 *    一条正确的产品行为测成缺陷。
 */
async function png(file) {
  const abs = resolve(file);
  const { inspectPng, looksBlank, looksSmeared } = await import(
    pathToFileURL(join(repoRoot, 'scripts/screenshots/png-stats.mjs')).href
  );
  const stats = inspectPng(abs);
  return [
    `W=${stats.width}`,
    `H=${stats.height}`,
    `BYTES=${stats.bytes}`,
    `TRANSPARENT=${stats.hasTransparency}`,
    `BLANK=${looksBlank(stats)}`,
    `SMEARED=${looksSmeared(stats)}`,
    `SHA=${stats.hash.slice(0, 12)}`,
  ].join(' ');
}

/**
 * 从 uiautomator 快照里剥出**第一张卡片的标题**：a11y 名是 `{title}` 模板填出来的，
 * 所以把它当正则模板匹配即可。取不到就失败 —— 不许让调用方拿空串去拼菜单名。
 */
function cardTitle(xmlPath, template) {
  const src = readFileSync(resolve(xmlPath), 'utf8');
  const body = template.replace(/\\'/g, "'");
  const pattern = escapeRe(body).replace(escapeRe('{title}'), '([\\s\\S]+?)');
  const re = new RegExp(`content-desc="${pattern}"`, 'g');
  for (const m of src.matchAll(re)) {
    const title = m[1];
    if (title && title !== '') return title;
  }
  die('uiautomator 快照里没有带菜单 a11y 名的卡片');
}

let out;
switch (mode) {
  case 'zh':
    out = arg1 ? zh(arg1) : die('缺参数：zh <key>');
    break;
  case 'contract':
    out = arg1 ? await contract(arg1) : die('缺参数：contract <name>');
    break;
  case 'png':
    out = arg1 ? await png(arg1) : die('缺参数：png <file>');
    break;
  case 'card-title':
    out = arg1 && arg2 ? cardTitle(arg1, arg2) : die('缺参数：card-title <xml> <template>');
    break;
  default:
    die(`未知模式：${String(mode)}`);
}
process.stdout.write(out);
