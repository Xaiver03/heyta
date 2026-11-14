#!/usr/bin/env node
/**
 * 首启引导的**真浏览器**读数（一次性验证器，不是长期门禁）。
 *
 * 为什么不用 `e2e/tests/first-run-guide.spec.ts` 跑：那个 runner 要 Playwright 自带的
 * chromium，而本机 `~/Library/Caches/ms-playwright` 在文件沙箱外、`install` 会 EPERM。
 * 这里用**同一个 Playwright API + 本机 Chrome**，把同一条旅程走一遍并把读数打出来。
 * 等浏览器能装时，那份 spec 才是常驻判据；本文件只是"今天这条链真的通"的证据。
 *
 * 用法：node scripts/probe-first-run.mjs   （需要 localhost:5173 在跑）
 */
import { createRequire } from 'node:module';

const require = createRequire(new URL('../e2e/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const BASE = process.env.HEYTA_WEB_URL ?? 'http://localhost:5173/';
const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '🔴'} ${name}${detail ? `  —— ${detail}` : ''}`);
}

const browser = await chromium.launch(
  process.env.HEYTA_SHOT_CHANNEL ? { channel: process.env.HEYTA_SHOT_CHANNEL } : {},
);
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  // 首启同意闸门（与 targets.mjs 的 dismissTexts 同源）。
  const localOnly = page.getByRole('button', { name: '只用本机' });
  if (await localOnly.count()) {
    await localOnly.first().click().catch(() => {});
    await page.waitForTimeout(1200);
  }

  const guide = page.getByTestId('first-run');
  check('首启出现引导', (await guide.count()) > 0);

  const input = page.getByTestId('capture-input');
  const before = await input.inputValue();
  check('输入框初始为空', before === '', JSON.stringify(before));

  await page.getByTestId('first-run-example-1').click();
  await page.waitForTimeout(400);

  const filled = await input.inputValue();
  check('点示例后输入框被灌进原文', filled === '明天下午3点 给客户回邮件', JSON.stringify(filled));

  /*
   * 承重断言：**解析结果必须被界面说出来**。
   *
   * 名字用 `capture-due-capsule-value` 而不是 `capture-chip-value`：后者只活在
   * "截止面板展开"时（`chips` 那一组），而常驻在输入框右侧的是**日期胶囊**
   * （`rowChips` / `capture-due-capsule`）。2026-11-14 实测：灌字后
   * `capture-due-capsule-value` 立刻出现并显示「明天 15:00」——
   * 这才是"用户看得见解析结果"的那一枚。
   */
  const capsule = page.getByTestId('capture-due-capsule-value').first();
  const capsuleCount = await capsule.count();
  const capsuleText = capsuleCount > 0 ? ((await capsule.textContent()) ?? '').trim() : '';
  check(
    '解析结果被界面说出来（日期胶囊）',
    capsuleCount > 0 && capsuleText.length > 0,
    JSON.stringify(capsuleText),
  );

  check('点示例后引导收起', (await guide.count()) === 0);

  await input.press('Enter');
  await page.waitForTimeout(900);
  const created = await page.getByTestId('task-list').getByText('给客户回邮件').count();
  check('回车建出任务（标题已去掉日期那段）', created > 0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  check('刷新后不再出现（有任务时空态不渲染）', (await page.getByTestId('first-run').count()) === 0);

  // ── 第二条旅程：出口 + 标记落盘 ────────────────────────────────
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await ctx2.newPage();
  await p2.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p2.waitForTimeout(3500);
  const lo2 = p2.getByRole('button', { name: '只用本机' });
  if (await lo2.count()) { await lo2.first().click().catch(() => {}); await p2.waitForTimeout(1200); }

  check('新 context 首启也出现引导', (await p2.getByTestId('first-run').count()) > 0);
  await p2.getByTestId('first-run-dismiss').click();
  await p2.waitForTimeout(300);
  check('点出口后引导收起', (await p2.getByTestId('first-run').count()) === 0);
  check('出口不填充输入框', (await p2.getByTestId('capture-input').inputValue()) === '');

  await p2.reload({ waitUntil: 'domcontentloaded' });
  await p2.waitForTimeout(3000);
  // 此刻收集箱仍是空的 ⇒ "不出现"只可能来自落盘标记，不可能来自"空态没渲染"。
  check('刷新后（仍是空收集箱）不再出现 —— 标记真的落了盘', (await p2.getByTestId('first-run').count()) === 0);
  await ctx2.close();

  // ── ③ 暗色：引导在深色主题下画得出来，且示例按钮不是"白底压白字" ──────────
  const ctxDark = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  });
  const pDark = await ctxDark.newPage();
  await pDark.goto(BASE, { waitUntil: 'domcontentloaded' });
  await pDark.waitForTimeout(3500);
  const loDark = pDark.getByRole('button', { name: '只用本机' });
  if (await loDark.count()) { await loDark.first().click().catch(() => {}); await pDark.waitForTimeout(1200); }
  check('暗色下引导出现', (await pDark.getByTestId('first-run').count()) > 0);
  const contrast = await pDark.evaluate(() => {
    const btn = document.querySelector('[data-testid="first-run-example-1"]');
    if (!btn) return null;
    const s = getComputedStyle(btn);
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b] = m[1].split(',').map((x) => parseFloat(x));
      return { r, g, b };
    };
    const fg = parse(s.color);
    const bg = parse(s.backgroundColor);
    if (!fg || !bg) return null;
    const lum = ({ r, g, b }) => {
      const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const a = lum(fg) + 0.05;
    const b2 = lum(bg) + 0.05;
    return Math.round((Math.max(a, b2) / Math.min(a, b2)) * 100) / 100;
  });
  check('暗色下示例按钮文字对比度 ≥ 4.5:1', contrast !== null && contrast >= 4.5, `ratio=${String(contrast)}`);
  await ctxDark.close();

  // ── ④ 键盘可达：Tab 能走到示例，Enter 能触发（不靠鼠标） ──────────────
  const ctxKb = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pKb = await ctxKb.newPage();
  await pKb.goto(BASE, { waitUntil: 'domcontentloaded' });
  await pKb.waitForTimeout(3500);
  const loKb = pKb.getByRole('button', { name: '只用本机' });
  if (await loKb.count()) { await loKb.first().click().catch(() => {}); await pKb.waitForTimeout(1200); }

  let reached = false;
  for (let i = 0; i < 40; i += 1) {
    await pKb.keyboard.press('Tab');
    const id = await pKb.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');
    if (id === 'first-run-example-1') { reached = true; break; }
  }
  check('键盘 Tab 能走到第一条示例', reached);

  /*
   * ⑤ 读屏可读：示例按钮的**可及名**就是它的文字，不是空按钮。
   * ⚠️ 这一步必须排在 Enter **之前** —— Enter 会触发 onFillDraft ⇒ markSeen ⇒
   *    引导卸载，之后 `[data-testid^="first-run-example-"]` 一个都查不到，
   *    读起来像"按钮没有可及名"，实际是"按钮已经不在了"。
   */
  const names = await pKb.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[data-testid^="first-run-example-"]')) {
      out.push((el.getAttribute('aria-label') ?? el.textContent ?? '').trim());
    }
    return out;
  });
  check(
    '示例按钮的可及名非空且是完整一句',
    names.length === 3 && names.every((n) => n.length >= 6),
    JSON.stringify(names),
  );

  if (reached) {
    await pKb.keyboard.press('Enter');
    await pKb.waitForTimeout(400);
    check(
      '键盘 Enter 触发填充（不靠鼠标）',
      (await pKb.getByTestId('capture-input').inputValue()) === '明天下午3点 给客户回邮件',
    );
  }
  await ctxKb.close();
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} 通过`);
process.exit(failed.length === 0 ? 0 : 1);
