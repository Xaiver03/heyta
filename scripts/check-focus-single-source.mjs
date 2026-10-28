#!/usr/bin/env node
/**
 * 焦点实现单一来源门禁（2026-10-27，全局 UX 整改 P0）
 *
 * 它拦三种会重新制造本次缺陷的形状：
 * 1. 功能 CSS 再画一枚局部焦点环；
 * 2. 用 background/color 冒充 :focus-visible；
 * 3. 把全局焦点文件从 app.css 级联末尾挪走。
 *
 * 复合控件可以把环从内层 input 移到外层容器，但必须命中 `:has(input:focus-visible)`
 * 这一显式形状；这不是免死金牌，而是让例外在源码里可被机器识别。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STYLE_DIR = join(ROOT, 'apps/web/src/styles/app');
const APP_CSS = join(ROOT, 'apps/web/src/styles/app.css');
const GLOBAL_FILE = 'borderless-controls.css';

/**
 * 复合控件与拖拽把手不是普通 button：焦点必须落在可操作整体或把手本身。
 * 每条例外都必须今天仍命中，否则登记过期即红，避免例外表变成免死金牌。
 */
const ALLOWED_FOCUS_EXCEPTIONS = [
  { file: 'assistant-layout.css', selector: '.ht-ai__input:focus-visible', kind: 'suppress' },
  { file: 'assistant-layout.css', selector: '.ht-ai__composer:has(.ht-ai__input:focus-visible)', kind: 'paint' },
  { file: 'base.css', selector: '.ht-app__detail-resizer:focus-visible::after', kind: 'paint' },
  { file: 'sidebar.css', selector: '.ht-sidebar__resizer:focus-visible::after', kind: 'paint' },
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.css')) out.push(full);
  }
  return out;
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

function normalize(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function rules(source) {
  const stripped = stripComments(source);
  const found = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of stripped.matchAll(pattern)) {
    found.push({ selector: normalize(match[1]), body: normalize(match[2]) });
  }
  return found;
}

function isCompositeException(selector) {
  return selector.includes(':has(') && selector.includes(':focus-visible');
}

function scanCss(fileName, source) {
  const problems = [];
  const global = fileName === GLOBAL_FILE;
  const exceptionsForFile = ALLOWED_FOCUS_EXCEPTIONS.filter((entry) => entry.file === fileName);

  for (const rule of rules(source)) {
    if (!rule.selector.includes(':focus-visible')) continue;

    const exception = exceptionsForFile.find((entry) => rule.selector === entry.selector);
    const suppressesRing = /(?:^|;)\s*outline\s*:\s*(?:0|none)\b/i.test(rule.body)
      || /(?:^|;)\s*outline-width\s*:\s*0\b/i.test(rule.body);
    const paintsRing = /(?:^|;)\s*outline\s*:\s*var\(--ht-(?:focus-ring-width|border-width-thick)\)\s+solid\s+var\(--ht-color-ring\)/i.test(rule.body);
    const changesPaint = /(?:^|;)\s*(?:background|background-color|color)\s*:/i.test(rule.body);

    if (!global && exception === undefined && paintsRing && !isCompositeException(rule.selector)) {
      problems.push(`${fileName}: 功能 CSS 又画了一枚焦点环 —— ${rule.selector}`);
    }
    if (!global && exception?.kind !== 'paint' && changesPaint) {
      problems.push(`${fileName}: :focus-visible 不得改背景或文字色 —— ${rule.selector}`);
    }
    if (!global && exception?.kind !== 'suppress' && suppressesRing && !isCompositeException(rule.selector)) {
      problems.push(`${fileName}: 功能 CSS 抹掉了焦点环 —— ${rule.selector}`);
    }
    if (global && rule.selector.includes('button') && changesPaint) {
      problems.push(`${fileName}: 全局交互控件焦点环不得靠换底色表达`);
    }
  }

  return problems;
}

function checkFocusExceptions() {
  const problems = [];
  for (const entry of ALLOWED_FOCUS_EXCEPTIONS) {
    const source = readFileSync(join(STYLE_DIR, entry.file), 'utf8');
    if (!rules(source).some((rule) => rule.selector === entry.selector)) {
      problems.push(`${entry.file}: 焦点例外登记已过期，当前源码不再命中 ${entry.selector}`);
    }
  }
  return problems;
}

function checkCascadeOrder() {
  const source = stripComments(readFileSync(APP_CSS, 'utf8'));
  const imports = [...source.matchAll(/@import\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
  const globalIndex = imports.lastIndexOf(`./app/${GLOBAL_FILE}`);
  if (globalIndex === -1) return ['app.css 没有导入 borderless-controls.css'];
  if (globalIndex !== imports.length - 1) {
    return ['app.css 的全局焦点文件必须排在所有 @import 最后，否则局部规则会重新赢回级联'];
  }
  return [];
}

function selfTest() {
  const arms = [
    {
      name: '局部环',
      problems: scanCss('rogue.css', '.foo:focus-visible { outline: var(--ht-focus-ring-width) solid var(--ht-color-ring); }'),
      expectRed: true,
    },
    {
      name: '焦点换底色',
      problems: scanCss('rogue.css', '.foo:focus-visible { background-color: var(--ht-color-primary-subtle); }'),
      expectRed: true,
    },
    {
      name: '全局环',
      problems: scanCss(GLOBAL_FILE, ":is(button, [role='button']):focus-visible { outline: var(--ht-focus-ring-width) solid var(--ht-color-ring); }"),
      expectRed: false,
    },
    {
      name: '复合控件例外',
      problems: scanCss('composite.css', '.option:has(input:focus-visible) { outline: var(--ht-focus-ring-width) solid var(--ht-color-ring); }'),
      expectRed: false,
    },
  ];

  let failed = 0;
  for (const arm of arms) {
    const red = arm.problems.length > 0;
    if (red !== arm.expectRed) {
      failed += 1;
      console.error(`🔴 selftest「${arm.name}」预期 ${arm.expectRed ? '红' : '绿'}，实际 ${red ? '红' : '绿'}`);
    }
  }
  const orderProblems = checkCascadeOrder();
  if (orderProblems.length > 0) {
    failed += 1;
    console.error('🔴 selftest 期间真实级联顺序不绿：', orderProblems.join('；'));
  }
  console.log(failed === 0 ? '✅ 焦点门禁自检：四臂结果符合预期。' : `🔴 焦点门禁自检失败 ${failed} 臂。`);
  process.exit(failed === 0 ? 0 : 1);
}

if (process.argv.includes('--selftest')) selfTest();

const problems = [];
for (const file of walk(STYLE_DIR)) {
  const name = relative(STYLE_DIR, file);
  problems.push(...scanCss(name, readFileSync(file, 'utf8')));
}
problems.push(...checkFocusExceptions(), ...checkCascadeOrder());

const cssFiles = walk(STYLE_DIR).length;
console.log(`焦点实现门禁：扫描 ${cssFiles} 枚 Web CSS，全局实现 ${existsSync(join(STYLE_DIR, GLOBAL_FILE)) ? '存在' : '缺失'}。`);
if (problems.length > 0) {
  console.error('\n🔴 焦点状态重新分叉：');
  for (const line of problems) console.error(`   ${line}`);
  process.exit(1);
}
console.log('✅ 焦点环只有一个来源；功能 CSS 未重画、未抹除、未用底色冒充。');
