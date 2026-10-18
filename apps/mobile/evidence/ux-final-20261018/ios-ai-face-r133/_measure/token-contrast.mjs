#!/usr/bin/env node
/**
 * 量一枚语义 token 对另一枚（前景/背景）的 WCAG 对比度，两档主题各一次。
 *
 * 为什么不用截图上的像素当唯一读数：像素里混了抗锯齿与半透明叠色，
 * 而 `tokens.css` 才是设计系统的唯一事实源。这里用**设计系统自己的**
 * `contrast()`（`packages/design-system/src/css-tokens.ts`）在 token 层算，
 * 截图像素只用来证明"这个值真的到了屏幕上"。
 *
 * 用法：
 *   node apps/mobile/evidence/ux-final-20261018/ios-ai-face-r133/_measure/token-contrast.mjs \
 *     color.border-strong color.surface
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../../../../');
const CSS_PATH = resolve(REPO, 'packages/design-system/src/tokens.css');

// 本脚本只覆盖三件事：抽变量表 + 递归展开 var() + WCAG 相对亮度。
// 不 import `src/css-tokens.ts` —— 那是 TS，纯 node 跑不动，而为一枚读数去起
// vitest 不划算。**代价**：解析实现与门禁里的那份是两套，会漂。
// 所以每条读数都要配一枚**正对照**（tokens.css 自己公布过数值的对），
// 见本目录 RESULT.md 里那条命令；正对照对不上就说明这份解析坏了，读数作废。
const css = readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function blocks(source) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(source))) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}

function varsOf(selectorMatch) {
  const map = new Map();
  for (const b of blocks(css)) {
    if (selectorMatch(b.selector)) {
      for (const line of b.body.split('\n')) {
        const d = line.match(/^\s*(--[\w-]+)\s*:\s*([^;]+);/);
        if (d) map.set(d[1], d[2].trim());
      }
    }
  }
  return map;
}

const rootVars = varsOf((s) => s === ':root' || s === 'html');
const darkVars = varsOf((s) => s.includes("data-theme='dark'") || s.includes('[data-theme="dark"]'));

function resolveVar(name, vars) {
  const raw = vars.get(name) ?? rootVars.get(name);
  if (!raw) throw new Error(`unknown var ${name}`);
  return raw.replace(/var\((--[\w-]+)\)/g, (_, inner) => resolveVar(inner, vars));
}

function parseColor(value) {
  const v = value.trim();
  let m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = v.match(/^rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?\)$/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  throw new Error(`unparsed color: ${value}`);
}

function relLum([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(fg, bg) {
  const [a, b] = [relLum(fg), relLum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

const [fgToken, bgToken] = process.argv.slice(2);
if (!fgToken || !bgToken) {
  console.error('usage: token-contrast.mjs <fg token name> <bg token name>   e.g. color.border-strong color.surface');
  process.exit(2);
}
const fgVar = `--ht-${fgToken.replace(/\./g, '-')}`;
const bgVar = `--ht-${bgToken.replace(/\./g, '-')}`;

for (const theme of ['light', 'dark']) {
  const vars = theme === 'dark' ? new Map([...rootVars, ...darkVars]) : rootVars;
  const fg = parseColor(resolveVar(fgVar, vars));
  const bg = parseColor(resolveVar(bgVar, vars));
  console.log(
    theme.padEnd(6),
    `${fgToken}=${fg.join(',')} on ${bgToken}=${bg.join(',')}`,
    '=>',
    `${contrast(fg, bg).toFixed(2)}:1`,
    contrast(fg, bg) >= 3 ? 'PASS(3:1)' : 'FAIL(<3:1)',
  );
}
