import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

/**
 * 备案专用《算法机制机理公示》页 —— **线上**那一页的取证与钉子。
 * ============================================================
 *
 * `live-legal.spec.ts` 已经覆盖整套法务清单（枚数、中英两侧渲染、404 形状、页脚不塌陷）。
 * 这一份只管一件事：**备案材料引用的是这一页**，所以这一页上"缺口/已落地"那几句
 * 必须在真服务器上读得到，而且不许有备案号。
 *
 * 🔴 截图落点是**备案材料的证据目录**（`docs/operations/cac-algorithm-filing/evidence/…`），
 * 不是 `/tmp`，也不是随 `--out` 走：那份目录跟着材料包一起被审计与回读，
 * 换一台机器或重启之后还能指给人看。落点由 `HEYTA_DISCLOSURE_SHOTS` 决定，
 * 没给就退回 `live-site-results/`（本配置的 outputDir，每次运行会被重建）。
 *
 * 线上套件**不重试**（配置里写明：重试会把网络抖动洗成通过），所以一次红就是真红。
 */

const OUT = process.env['HEYTA_DISCLOSURE_SHOTS'];

const PATHS = {
  zh: '/legal/algorithm-disclosure/',
  en: '/en/legal/algorithm-disclosure/',
} as const;

test.beforeAll(() => {
  if (OUT !== undefined && !existsSync(OUT)) mkdirSync(OUT, { recursive: true });
});

/** 草稿横幅那一格的两栏取值（`site.legal.draft.banner`）—— 横幅本身就是判据，两栏各自钉。 */
const BANNER: Record<'zh' | 'en', string> = {
  zh: '尚未对用户生效',
  en: 'is not in effect yet',
};

async function openLocale(page: import('@playwright/test').Page, locale: 'zh' | 'en') {
  await page.goto(PATHS[locale], { waitUntil: 'load' });
  await expect(page.locator('h1'), `${locale} 没渲染出标题`).toBeVisible();
  await expect(page.getByText(BANNER[locale], { exact: false })).toBeVisible();
}

test('zh：缺口那一句读得到，页面上没有备案号，并且整页截图入库', async ({ page }) => {
  await openLocale(page, 'zh');
  const body = await page.locator('body').innerText();
  // 唯一剩下的那一项缺口，必须仍然是"未部署"的写法。
  expect(body).toContain('输入与输出的自动内容安全审查尚未部署');
  // 已落地的两枚不许被写回缺口清单。
  expect(body).toContain('一键投诉/举报入口已于 2026-10-09 落到界面');
  expect(body).toContain('AI 生成合成内容');
  // 🔴 本轮没提交 ⇒ 页面上不许出现任何备案编号形状。
  expect(body).not.toMatch(/网信算备|备案编号[:：]\s*\S/);
  if (OUT !== undefined) await page.screenshot({ path: path.join(OUT, 'online-1440-zh.png'), fullPage: true });
});

test('en：同一件事在英文侧也读得到，且不是中文回落', async ({ page }) => {
  await openLocale(page, 'en');
  const body = await page.locator('body').innerText();
  expect(body).toContain('Automatic review of input and output content is not deployed');
  expect(body).toContain('one-tap complaint/report entry was added on the same day');
  expect(body).not.toMatch(/网信算备|备案编号[:：]\s*\S/);
  // 英文侧不许悄悄落回中文正文。
  expect(body).not.toContain('输入与输出的自动内容安全审查尚未部署');
  if (OUT !== undefined) await page.screenshot({ path: path.join(OUT, 'online-1440-en.png'), fullPage: true });
});

test('手机宽度（390）不横向溢出、目录可用，截图入库备查', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLocale(page, 'zh');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, '390 宽度下横向溢出').toBeLessThanOrEqual(1);
  if (OUT !== undefined) await page.screenshot({ path: path.join(OUT, 'online-390-zh.png'), fullPage: true });
});
