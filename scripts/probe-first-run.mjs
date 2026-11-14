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
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} 通过`);
process.exit(failed.length === 0 ? 0 : 1);
