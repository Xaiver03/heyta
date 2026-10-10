/**
 * 时间线 P2 排期面的**套件级**验收（桌面载荷）
 * ==============================================
 *
 * 手势 → 界面形态的门禁化版本（此前是一次性脚本 `../timeline-p2-drag.cjs`，
 * 现在按 §6.2 规定一落进套件：先截图再断言、固定路径、抓 console/pageerror）。
 *
 * 覆盖 goal §3.2 的手势（web 载荷；移动端手势 = goal §4 P3）：
 *   B. 点 → 拖动 ⇒ 变成 range 条（start + due，滴答同款）
 *   C. 点空白（轴） ⇒ 建出带日期的任务（新点落在点击时刻）
 *
 * op 形状（每手势 = 一条形状正确的 op）由 jsdom 出口判据钉死：
 * `apps/web/tests/timeline-schedule.spec.tsx` —— 本文件管"真浏览器里手势真的通"。
 */

import { expect, test, type Page } from '@playwright/test';

const SHOT = (name: string): string => `test-results/timeline-p2-${name}.png`;

/** 桌面载荷的统一入口：清理首启面板，落到任务页。 */
async function openApp(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?lang=zh-CN', { waitUntil: 'networkidle' });
  const later = page.getByRole('button', { name: /以后再说|Decide later/ });
  if (await later.count()) {
    await later.click();
    await page.waitForTimeout(500);
  }
  await page.waitForSelector('[data-testid="task-list"]', { timeout: 30_000 });
}

async function addTaskViaComposer(page: Page, text: string): Promise<void> {
  const composer = page.locator('input[placeholder^="添加任务"]');
  await composer.fill(text);
  await composer.press('Enter');
  await page.waitForTimeout(600);
}

test.describe('时间线 P2 · 排期手势（桌面载荷）', () => {
  test('点拖成条 + 点空白建任务带日期', async ({ page }) => {
    await openApp(page);
    // 两条带自然语言截止的任务（due 解析成 dueDate ⇒ 拖动后 start+due ⇒ 条）
    await addTaskViaComposer(page, '明天16:00 写时间线的验收报告');
    await addTaskViaComposer(page, '后天12:00 整理 P2 的判据清单');

    // W1（2026-10-06）：时间线收进「更多」菜单，不再是一级 tab ——
    // 本文件是自包含 spec（本地 openApp），就地走菜单这条真路径。
    await page.locator('.ht-rail__more button').click();
    await page.getByRole('menuitem', { name: '时间线' }).click();
    await page.waitForSelector('[data-testid="timeline-view"]', { timeout: 15_000 });
    await page.waitForTimeout(600);

    // 先截图（失败时也要有图，§6.2 规定一）
    await page.screenshot({ path: SHOT('before'), fullPage: false });

    // ── 手势 B：点 → 拖动 ⇒ 条 ──────────────────────────────────────────
    const region = await page.locator('[data-testid="timeline-rows-region"]').boundingBox();
    expect(region, '行区在场').toBeTruthy();
    const point = page.locator('[data-testid^="timeline-point-"]').first();
    const pointBox = await point.boundingBox();
    expect(pointBox, '轴上有可拖的点').toBeTruthy();

    await page.mouse.move(pointBox!.x + pointBox!.width / 2, pointBox!.y + pointBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(pointBox!.x - region!.width * 0.18, pointBox!.y, { steps: 12 });
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(800);

    const barCount = await page.locator('[data-testid^="timeline-bar-"]').count();
    expect(barCount, '拖过的点变成了 range 条').toBeGreaterThanOrEqual(1);

    // ── 手势 C：点空白（轴）⇒ 建出带日期的任务（新点）───────────────────
    const pointsBefore = await page.locator('[data-testid^="timeline-point-"]').count();
    const axis = await page.locator('[data-testid="timeline-axis"]').boundingBox();
    expect(axis, '轴在场').toBeTruthy();
    await page.mouse.click(axis!.x + axis!.width * 0.3, axis!.y + axis!.height / 2);
    await page.waitForTimeout(900);
    const pointsAfter = await page.locator('[data-testid^="timeline-point-"]').count();
    expect(pointsAfter, '点空白建出了新任务（新点落在点击时刻）').toBe(pointsBefore + 1);

    // 行头文字面仍在（无障碍不许丢）：新任务有标题行
    expect(await page.locator('[data-testid^="timeline-row-"]').count()).toBeGreaterThanOrEqual(2);

    await page.screenshot({ path: SHOT('after'), fullPage: false });
  });

  test('未排期拖拽跨界、resize 取消与键盘入口', async ({ page }) => {
    await openApp(page);
    await addTaskViaComposer(page, '明天16:00 时间线拖拽任务');
    await addTaskViaComposer(page, '未排期跨界任务');

    await page.locator('.ht-rail__more button').click();
    await page.getByRole('menuitem', { name: '时间线' }).click();
    await page.waitForSelector('[data-testid="timeline-view"]', { timeout: 15_000 });
    await page.waitForTimeout(500);

    const scheduledPointId = await page.locator('[data-testid^="timeline-point-"]').first().getAttribute('data-testid');
    expect(scheduledPointId).toBeTruthy();
    const lane = page.locator('[data-testid^="timeline-lane-item-"]').first();
    await expect(lane, '固定夹具必须产生一个未排期泳道条目').toHaveCount(1);
    // 普通点击仍然打开任务入口（先测点击，再测同一个入口的拖拽）。
    await lane.click();
    await expect(lane).toHaveAttribute('aria-pressed', 'true');
    // 打开详情列可能改变轨道宽度，拖拽前必须读取当前几何。
    const laneBox = await lane.boundingBox();
    const region = await page.locator('[data-testid="timeline-rows-region"]').boundingBox();
    expect(laneBox).toBeTruthy();
    expect(region).toBeTruthy();

    const laneBefore = await page.locator('[data-testid^="timeline-lane-item-"]').count();
    await page.mouse.move(laneBox!.x + laneBox!.width / 2, laneBox!.y + laneBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(region!.x + region!.width * 0.5, region!.y + 20, { steps: 14 });
    await page.waitForTimeout(150);
    // 跨出 Pressable 的 hit rect 后，mouseup 之前仍不能写入排期。
    await expect(page.locator('[data-testid^="timeline-lane-item-"]')).toHaveCount(laneBefore);
    await page.mouse.up();
    await expect(page.locator('[data-testid^="timeline-lane-item-"]')).toHaveCount(0);

    // 拖带截止时间的原始点；刚从泳道排期的任务只有起点，不应被伪造成条。
    const point = page.getByTestId(scheduledPointId!);
    const pointBox = await point.boundingBox();
    expect(pointBox).toBeTruthy();
    await page.mouse.move(pointBox!.x + pointBox!.width / 2, pointBox!.y + pointBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(pointBox!.x - region!.width * 0.1, pointBox!.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(700);

    const handle = page.locator('[data-testid^="timeline-resize-"]').first();
    const handleBox = await handle.boundingBox();
    const bar = page.locator('[data-testid^="timeline-bar-"]').first();
    expect(handleBox).toBeTruthy();
    const widthBefore = await bar.evaluate((node) => node.getBoundingClientRect().width);
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + handleBox!.width * 2.5, handleBox!.y, { steps: 12 });
    await page.waitForTimeout(150);
    const widthPreview = await bar.evaluate((node) => node.getBoundingClientRect().width);
    expect(Math.abs(widthPreview - widthBefore), 'resize 应先出现本地预览').toBeGreaterThan(1);
    // 浏览器失焦取消拖拽，不能提交 durationMinutes。
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.mouse.up();
    await expect.poll(() => bar.evaluate((node) => node.getBoundingClientRect().width)).toBeCloseTo(widthBefore, 0);

    // 轴左侧的可见按钮支持键盘创建任务。
    const pointsBefore = await page.locator('[data-testid^="timeline-point-"]').count();
    await page.getByTestId('timeline-create-task').focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => page.locator('[data-testid^="timeline-point-"]').count()).toBe(pointsBefore + 1);
  });
});
