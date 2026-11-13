#!/usr/bin/env node
/**
 * 临时探针：量 390×844 视口下 rail 导航的几何。
 *
 * 为什么要有它：`scripts/screenshots/capture.mjs` 的注释里留着一条
 * 2026-10 的观察 ——「移动视口（390px）下标签栏被压成 8px 宽，从四象限往后的
 * 标签整段溢出到屏幕外……这是一个真实的移动端布局缺陷，交 UI 那条线修」。
 * 那条观察没有判据，所以它可能早就修了、也可能还在。这个脚本把它变成读数。
 *
 * 用法：node scripts/screenshots/probe-mobile-rail.mjs   （需要 localhost:5173 在跑）
 */
import { createRequire } from 'node:module';

const require = createRequire(new URL('../e2e/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const BASE = process.env.HEYTA_WEB_URL ?? 'http://localhost:5173/';
const browser = await chromium.launch(
  process.env.HEYTA_SHOT_CHANNEL ? { channel: process.env.HEYTA_SHOT_CHANNEL } : {},
);
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
});
const page = await context.newPage();
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

// 首启同意闸门：点「只用本机」进入主界面（文案与 targets.mjs 的 dismissTexts 同源）。
const localOnly = page.getByRole('button', { name: '只用本机' });
if (await localOnly.count()) {
  await localOnly.first().click().catch(() => {});
  await page.waitForTimeout(1500);
}

const viewport = page.viewportSize();
const report = await page.evaluate((vw) => {
  const nodes = Array.from(
    document.querySelectorAll('.ht-rail__tab, [role="tab"], nav button'),
  );
  const rows = nodes.map((el) => {
    const r = el.getBoundingClientRect();
    const text = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 12);
    return {
      text,
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      outsideRight: r.x + r.width > vw + 1,
      outsideLeft: r.x < -1,
      clipped: r.width < 24 || r.height < 24,
    };
  });
  return {
    total: rows.length,
    overflowRight: rows.filter((r) => r.outsideRight).length,
    overflowLeft: rows.filter((r) => r.outsideLeft).length,
    tooSmall: rows.filter((r) => r.clipped).length,
    rows,
  };
}, viewport.width);

console.log(JSON.stringify({ viewport, ...report }, null, 2));
await browser.close();
