import { expect, test, type Page } from '@playwright/test';

import { openApp, switchView } from './helpers';

/**
 * 页头那一排的"同排只有一档 + 够得到"（全局 UX 线 P7）
 * ==================================================
 *
 * 计划 §P7 的判据里有两句是**几何**的，源码尺量不到：
 *
 *   · **同排控件高度只有一档** —— 同一行里一枚 28px 的图标按钮挨着一枚 40px 的下拉，
 *     读起来就是"这两件事不是一个层级"，而两边的 CSS 各自都合规；
 *   · **交互目标 ≥ 44px** —— `--ht-touch-target-min` 是本仓的可访问性硬下限
 *     （`ai-panels.css:363` 那句注释的原话）。
 *
 * 这一格先**量**再改：量出来的每一枚控件都打印出来（`--reporter=line` 也能看到），
 * 所以红的时候不用猜是哪一枚、高多少。
 *
 * 🔴 期望值不抄 44：下限从同一页的 token 现算。抄进来的数会变成第三份口径。
 */

const EVIDENCE = '../apps/web/evidence/header-controls';

async function tokenPx(page: Page, varName: string): Promise<number> {
  return page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.setProperty('inline-size', `var(${name})`);
    document.body.append(probe);
    const px = Number.parseFloat(getComputedStyle(probe).width);
    probe.remove();
    return px;
  }, varName);
}

/** 这一排里"能点的"：按钮、下拉、以及带 role=button 的东西。 */
const INTERACTIVE = 'button, select, [role="button"]';

for (const width of [1440, 390] as const) {
test(`日历页头 ${width}：同一排的可点控件只有一档高度，且都够到触控下限`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await openApp(page, '/?lang=zh-CN');
  await switchView(page, '日历');

  // 页头那一条：`.ht-header` 里放动作的那一格。
  const row = page.locator('header.ht-header').first();
  await expect(row, '日历页头没画出来').toBeVisible();

  const floor = await tokenPx(page, '--ht-touch-target-min');
  expect(floor, '下限 token 算不出来（这条会空转）').toBeGreaterThan(0);

  const measured = await row.evaluate((el, selector) => {
    const items = Array.from(el.querySelectorAll(selector));
    return items.map((item) => {
      const box = item.getBoundingClientRect();
      return {
        tag: item.tagName.toLowerCase(),
        name:
          item.getAttribute('aria-label') ??
          item.getAttribute('data-testid') ??
          (item.textContent ?? '').trim().slice(0, 16),
        width: Math.round(box.width * 10) / 10,
        height: Math.round(box.height * 10) / 10,
        visible: box.width > 0 && box.height > 0,
      };
    });
  }, INTERACTIVE);

  const shown = measured.filter((m) => m.visible);
  // 把读数打出来：红的时候要能直接看出是哪一枚、高多少（不用再跑一趟）。
  console.log(`[页头同排] 下限=${String(floor)}px`, JSON.stringify(shown));

  expect(shown.length, '这一排一枚可点控件都没量到 ⇒ 选择器或页面变了').toBeGreaterThanOrEqual(3);

  const tooSmall = shown.filter((m) => m.height < floor);
  expect(tooSmall, `这些控件没够到触控下限（${String(floor)}px）：${JSON.stringify(tooSmall)}`).toHaveLength(0);

  // 同排只有一档：取最高的那一枚当基准，其余必须与它齐平（容差 0.5px 给亚像素）。
  const tallest = Math.max(...shown.map((m) => m.height));
  const odd = shown.filter((m) => Math.abs(m.height - tallest) > 0.5);
  expect(odd, `同一排出现两档高度（基准 ${String(tallest)}px）：${JSON.stringify(odd)}`).toHaveLength(0);

  await page.screenshot({ path: `${EVIDENCE}/calendar-header-${String(width)}-light.png` });
});
}
