#!/usr/bin/env node
/**
 * 设计样式预览器（design preview）
 * ==============================
 *
 *   node scripts/design-preview.mjs [--out <png>] [--width <px>]
 *   pnpm design:preview
 *
 * 用途：改完 design token / 组件样式后，**不用起整套 Web 应用**、也不用登录，
 * 就能把关键构件（侧栏菜单行 / 设置卡片 / 空状态）按**真实样式**渲染成一张 PNG 自检。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么必须加载**完整 CSS 链路**（这条是踩过的坑）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 曾经有一次性预览脚本只引了 `tokens.css + sidebar.css` 两份样式，漏掉
 * `reset.css` 与 `styles/app/borderless-controls.css` —— 结果浏览器把
 * `<button>` 的**默认灰底 + 黑边**原样画了出来，侧栏菜单行看起来"灰色带描边、很脏"，
 * 而真实应用根本没有那个样子（`reset.css` 有 `button{border:none;background:none}`，
 * `borderless-controls.css` 再兜一层 `!important`）。
 *
 * 教训：预览件**必须**和真实应用读同一套 CSS，否则你验证的是假象，还会误判成设计缺陷。
 * 所以这里按 `apps/web/src/main.tsx` + `styles/app.css` 的实际顺序拼：
 * tokens → reset → typography → app.css 的全部 @import 模块。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 边界
 * ─────────────────────────────────────────────────────────────────────────
 * · 这是**静态样式板**，不是产品截图：markup 用真实类名复刻各构件，
 *   不覆盖交互态/数据态。要截真实整屏请用 `pnpm screenshot:capture`。
 * · 依赖本机 `playwright`（与 `scripts/screenshots/capture.mjs` 同一来源，未打进依赖）。
 * · 产物默认写到 `.local/design-preview/`（已被 .gitignore，不会污染仓库）。
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
};
const outPath = arg('--out', join(ROOT, '.local/design-preview/design-preview.png'));
const width = Number(arg('--width', '1240'));

const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

/** 按 app.css 里的 @import 顺序，把 22 个模块拼成一整段 CSS。 */
function collectAppCss() {
  const dir = resolve(ROOT, 'apps/web/src/styles');
  const src = readFileSync(join(dir, 'app.css'), 'utf8');
  const specs = [...src.matchAll(/@import\s+['"](\.[^'"]+)['"]\s*;/g)].map((m) => m[1]);
  return specs.map((s) => readFileSync(resolve(dir, s), 'utf8')).join('\n');
}

const css = [
  read('packages/design-system/src/tokens.css'),
  read('packages/design-system/src/reset.css'),
  read('packages/design-system/generated/typography.css'),
  collectAppCss(),
].join('\n');

const artwork = JSON.parse(read('packages/ui/src/empty-state/state-artwork.generated.json'))['zh-CN']['tasks'];

const ICON_CAL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
const ICON_CHK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>';
const navItem = (inner, label, active) =>
  `<button type="button" class="ht-nav__item"${active ? ' aria-current="true"' : ''}>${inner}<span>${label}</span></button>`;

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${css}
html, body { margin: 0; }
body {
  background: var(--ht-color-background);
  color: var(--ht-color-foreground);
  font-family: var(--ht-font-sans);
  font-size: var(--ht-font-size-base);
  padding: 28px;
  display: flex;
  gap: 28px;
  align-items: flex-start;
}
.pv-h { margin: 0 0 10px 4px; font-size: 13px; font-weight: 600; color: var(--ht-color-foreground-muted); }
.pv-side { width: 240px; background: var(--ht-color-surface); border: 1px solid var(--ht-color-border-subtle); border-radius: 12px; padding: 8px; }
.pv-card { width: 300px; background: var(--ht-color-surface); border: 1px solid var(--ht-color-border-subtle); border-radius: 12px; overflow: hidden; }
.pv-card .row { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; font-size: .9rem; }
.pv-card .row + .row { border-top: 1px solid var(--ht-color-border-subtle); }
.pv-card .v { color: var(--ht-color-foreground-subtle); }
.pv-empty { width: 290px; padding: 40px 20px; display: flex; flex-direction: column; align-items: center; gap: 12px; background: var(--ht-color-surface); border: 1px solid var(--ht-color-border-subtle); border-radius: 12px; }
.pv-empty img { width: 64px; height: 64px; object-fit: contain; }
.pv-empty .t { font-size: 1rem; font-weight: 500; color: var(--ht-color-foreground-muted); }
.pv-empty .h { font-size: .875rem; color: var(--ht-color-foreground-subtle); }
</style></head><body>
<div>
  <div class="pv-h">侧栏菜单（透明行 + 选中/悬停才有底色）</div>
  <div class="pv-side"><div class="ht-nav">
    ${navItem(`<span class="ht-nav__lead">${ICON_CAL}</span>`, '最近 7 天', false)}
    ${navItem(`<span class="ht-nav__lead">${ICON_CHK}</span>`, '已完成', true)}
    ${navItem('<span class="ht-nav__lead"><span class="ht-swatch ht-swatch--q1"></span></span>', '重要且紧急', false)}
    ${navItem('<span class="ht-nav__lead"><span class="ht-swatch ht-swatch--q2"></span></span>', '重要不紧急', false)}
    ${navItem('<span class="ht-nav__lead"><span class="ht-swatch ht-swatch--q3"></span></span>', '紧急不重要', false)}
  </div></div>
</div>
<div>
  <div class="pv-h">设置卡片（无投影 + 极淡描边）</div>
  <div class="pv-card">
    <div class="row"><span>截止时间显示方式</span><span class="v">日期</span></div>
    <div class="row"><span>语言</span><span class="v">中文</span></div>
    <div class="row"><span>外观</span><span class="v">浅色</span></div>
  </div>
</div>
<div>
  <div class="pv-h">空状态（统一灰底基础型）</div>
  <div class="pv-empty"><img src="${artwork}" alt=""><div class="t">收集箱是空的</div><div class="h">在上面输入框添加第一个任务</div></div>
</div>
</body></html>`;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('需要本机 playwright（与 scripts/screenshots/capture.mjs 同一依赖）。');
  console.error('   缺它就装一下：npm i -g playwright && npx playwright install chromium');
  process.exit(1);
}

mkdirSync(dirname(outPath), { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width, height: 460 } });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(250);
  await page.screenshot({ path: outPath });
} finally {
  await browser.close();
}
console.log(`✅ 设计样式预览已生成：${outPath}`);
