#!/usr/bin/env node
/**
 * PWA 清单的两个颜色字段与设计 token 对账
 * ==========================================
 *
 *     node scripts/gen-pwa-colors.mjs           # 写入
 *     node scripts/gen-pwa-colors.mjs --check   # 只读对账（CI / 门禁）
 *
 * 为什么需要它：`manifest.webmanifest` 是 JSON，不能用 `var(--ht-*)`，
 * 这两个值只能写字面量 —— 于是它成了 tokens.css 之外**唯一可能静默漂移**的
 * 一处品牌色。实测就漂过一次：`background_color` 写 `#f8fafc`(slate-50)，
 * 而设计系统的 `color.background` 是 `#f1f5f9`(slate-100)。
 *
 * 映射（每个字段绑一个语义 token，不绑原始色阶）：
 *   theme_color      ← color.primary      （浏览器 UI 的主题色）
 *   background_color ← color.background   （启动画面底色，必须与页面底一致，
 *                                          否则 PWA 冷启动会闪一下）
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const TOKENS = join(ROOT, 'packages/design-system/src/tokens.css');
const MANIFEST = join(ROOT, 'apps/web/public/manifest.webmanifest');
const CHECK = process.argv.includes('--check');

/** 语义 token → manifest 字段。改映射就改这张表，别在下面散着判。 */
const MAP = {
  theme_color: 'color-primary',
  background_color: 'color-background',
};

/**
 * 只保留**亮色**部分。
 * tokens.css 的排列是：先若干段 `:root`（原始色阶 / 语义色 / 尺 / 动效），
 * 再才是 `[data-theme='dark']` 与 `[data-theme-preset=…]` 覆盖块 —— 后者
 * 同样声明 `--ht-color-*`。若在整份文件里取"最后一个匹配"，拿到的是**暗色值**
 * （实测踩过：theme_color 取到 blue-400、background 取到暗色底 #080e1a）。
 * 所以在第一个 `[data-theme` 处截断，后面全部丢弃。
 */
const css = readFileSync(TOKENS, 'utf8').split('[data-theme')[0];

/** 解析亮色里的语义色，展开一层 var() 链（够用且可读，不引第三方）。 */
function readToken(name) {
  const key = `--ht-${name}`;
  const all = [...css.matchAll(new RegExp(`${key}:\\s*([^;]+);`, 'g'))];
  const last = all.length > 0 ? all[all.length - 1][1].trim() : undefined;
  if (last === undefined) throw new Error(`tokens.css（亮色部分）里没有 ${key}`);
  const varRef = /^var\(\s*(--ht-[a-z0-9-]+)\s*\)$/.exec(last);
  if (varRef) {
    const inner = [...css.matchAll(new RegExp(`${varRef[1]}:\\s*([^;]+);`, 'g'))].pop();
    if (inner === undefined) throw new Error(`tokens.css 里没有 ${varRef[1]}（被 ${key} 引用）`);
    return inner[1].trim();
  }
  return last;
}

const expected = Object.fromEntries(
  Object.entries(MAP).map(([field, token]) => [field, readToken(token)]),
);

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const diffs = Object.entries(expected).filter(([field, want]) => manifest[field] !== want);

if (CHECK) {
  if (diffs.length > 0) {
    console.error('❌ manifest.webmanifest 的颜色与 token 不一致：');
    for (const [field, want] of diffs) {
      console.error(`   ${field}: 现 ${String(manifest[field])} → 应 ${want}（${MAP[field]}）`);
    }
    console.error('   修：node scripts/gen-pwa-colors.mjs');
    process.exit(1);
  }
  console.log(`✅ manifest 颜色与 token 一致（${Object.entries(expected).map(([k, v]) => `${k}=${v}`).join('，')}）`);
} else {
  if (diffs.length === 0) {
    console.log('✅ 已是最新，无需写入');
  } else {
    for (const [field, want] of diffs) manifest[field] = want;
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    for (const [field, want] of diffs) console.log(`   ${field} → ${want}`);
    console.log('✅ 已写入 manifest.webmanifest');
  }
}
