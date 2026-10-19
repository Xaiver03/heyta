#!/usr/bin/env node
/**
 * r160：web 首屏隐私卡在**真浏览器**里的读数 —— 补 `f21dc1d39` 那笔修复在 web 面缺的那一层。
 *
 * 已有的那一半：`apps/web/tests/privacy-consent-sheet.spec.tsx` 用 jsdom 钉住了
 * 「屏幕上那句话 == 可及名称」，并带变异臂（改前红）。缺的一半：这条判据从没在浏览器里跑过，
 * 而本仓的界面验收规矩是"Playwright 真跑 + 人真看图"。
 *
 * 三档：1440×900 浅 · 1440×900 暗 · 375×812 浅。每档量同一件事：
 * 那枚出口的 `textContent` 与 `aria-label` 逐字相等、且它的框宽明显大于"只装一枚图标"。
 *
 * 退出码三档分开：**0** 判了且合格 · **1** 判了且不合格 · **2** 没干活（服务起不来 / 分母为空）。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..', '..');
const PW = pathToFileURL(join(ROOT, 'e2e/node_modules/@playwright/test/index.mjs')).href;
const { chromium } = await import(PW);

const CASES = [
  { name: '1440-light', width: 1440, height: 900, scheme: 'light' },
  { name: '1440-dark', width: 1440, height: 900, scheme: 'dark' },
  { name: '375-light', width: 375, height: 812, scheme: 'light' },
];
if (CASES.length === 0) {
  console.error('拒绝执行：待验档位为空 —— 空分母会伪装成 PASS');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const vite = spawn(join(ROOT, 'apps/web/node_modules/.bin/vite'),
  ['--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: join(ROOT, 'apps/web'), stdio: ['ignore', 'pipe', 'pipe'], detached: false });
let viteOut = '';
vite.stdout.on('data', (b) => { viteOut += b.toString(); });
vite.stderr.on('data', (b) => { viteOut += b.toString(); });

let ready = false;
for (let i = 0; i < 90 && !ready; i += 1) {
  if (/ready in/i.test(viteOut)) ready = true;
  else await sleep(1000);
}
if (!ready) {
  console.error(`RESULT=VITE_NOT_READY —— 读数一条都不存在：${viteOut.slice(0, 300)}`);
  vite.kill('SIGTERM');
  process.exit(2);
}

const report = {
  carrier: {
    tree: ROOT,
    headSha: execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    servedBy: 'vite dev（本机、自要空端口、只关自己那枚 pid）',
    headless: true,
  },
  gate: '出口 textContent 逐字等于 aria-label，且框宽 > 只装图标那一档',
  cases: [],
};
let red = 0;
const browser = await chromium.launch({ headless: true });
try {
  for (const c of CASES) {
    const ctx = await browser.newContext({ viewport: { width: c.width, height: c.height }, colorScheme: c.scheme });
    const page = await ctx.newPage();
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    const dialog = page.getByTestId('privacy-consent-dialog');
    let row;
    try {
      await dialog.waitFor({ state: 'visible', timeout: 15000 });
      // 🔴 卡片是淡入的，首拍会拿到一张半透明 + 转圈的图（人眼层就废了）。
      //    等它自己不透明、且遮罩上的加载指示不再挡住卡片，再拍。
      for (let i = 0; i < 40; i += 1) {
        const settled = await dialog.evaluate((el) => Number(getComputedStyle(el).opacity) >= 0.99);
        if (settled) break;
        await sleep(250);
      }
      const close = page.getByTestId('privacy-consent-close');
      row = await close.evaluate((el) => ({
        text: el.textContent?.trim() ?? '',
        aria: el.getAttribute('aria-label') ?? '',
        box: (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }))(el.getBoundingClientRect()),
      }));
      row.shot = `privacy-sheet-${c.name}.png`;
      await dialog.screenshot({ path: join(HERE, row.shot) });
      row.textEqualsAria = row.text !== '' && row.text === row.aria;
      row.widerThanIconSquare = row.box.width > row.box.height;
      row.pass = row.textEqualsAria && row.widerThanIconSquare;
    } catch (e) {
      row = { error: String(e).slice(0, 200), pass: false };
    }
    if (!row.pass) red += 1;
    report.cases.push({ ...c, ...row });
    console.log(`CASE ${c.name} pass=${row.pass} text="${row.text ?? ''}" aria="${row.aria ?? ''}" box=${JSON.stringify(row.box ?? null)}`);
    await ctx.close();
  }
} finally {
  vite.kill('SIGTERM');
  await browser.close();
}

const { writeFileSync } = await import('node:fs');
writeFileSync(join(HERE, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`分母=${CASES.length} 档 ｜ 红=${red}`);
if (red > 0) {
  console.error(`RESULT=FAIL ${red}/${CASES.length} 档不合格`);
  process.exit(1);
}
console.log(`RESULT=PASS ${CASES.length} 档全部「屏幕上的字 == 可及名称」`);
process.exit(0);
