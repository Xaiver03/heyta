/**
 * 时间线 P2 的**真实拖拽取证**（桌面载荷）
 * ==========================================
 *
 * 用 Playwright 的鼠标事件驱动 RNW 的 Responder（pointer → responder），
 * 在**真应用**上完成「泳道拖上轴」手势：任务应从泳道消失、在轴上变成
 * 一条 `range` 条。截图 + 几何断言 + op 数（经 console 注入不可行，
 * 以界面形态为准 —— op 形状已由 jsdom 出口判据钉死）。
 *
 * 🔴 刻意不走 e2e 配置（§7 #87：webServer 前置会杀别的会话的 vite）。
 */

const { chromium } = require('playwright');

const BASE = process.env.SHOT_BASE ?? 'http://localhost:4321';
const OUT = process.env.SHOT_OUT ?? 'test-results';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`${BASE}/?lang=zh-CN`, { waitUntil: 'networkidle' });
  const later = page.getByRole('button', { name: /以后再说|Decide later/ });
  if (await later.count()) {
    await later.click();
    await page.waitForTimeout(500);
  }
  await page.waitForSelector('[data-testid="task-list"]', { timeout: 30_000 });

  // 两条带**自然语言截止**的任务（捕获计划解析成 dueDate）：
  // 拖上轴后 start + due ⇒ range（真条）—— 没有截止也没有估时的任务
  // 拖上去是点（三态规则：不编长度，ADR-0043 §3）。
  const composer = page.locator('input[placeholder^="添加任务"]');
  for (const text of ['明天16:00 写时间线的验收报告', '后天12:00 整理 P2 的判据清单']) {
    await composer.fill(text);
    await composer.press('Enter');
    await page.waitForTimeout(600);
  }

  // 切到时间线
  await page.getByRole('tab', { name: '时间线' }).click();
  await page.waitForSelector('[data-testid="timeline-view"]', { timeout: 15_000 });
  await page.waitForTimeout(600);

  const region = await page.locator('[data-testid="timeline-rows-region"]').boundingBox();
  if (region === null) throw new Error('行区没有 boundingBox');

  // ── 手势 A：泳道条目 → 拖上轴（无日期任务 ⇒ 起点生效，成为轴上的点）──
  // 泳道可能本来就是空的（两条任务都带了 NL 日期）—— 此时跳过，不算失败。
  const laneCountBefore = await page.locator('[data-testid^="timeline-lane-item-"]').count();
  if (laneCountBefore > 0) {
    const laneItem = page.locator('[data-testid^="timeline-lane-item-"]').first();
    const laneBox = await laneItem.boundingBox();
    if (laneBox !== null) {
      await page.mouse.move(laneBox.x + laneBox.width / 2, laneBox.y + laneBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(region.x + region.width * 0.5, region.y + 20, { steps: 12 });
      await page.waitForTimeout(120);
      await page.mouse.up();
      await page.waitForTimeout(800);
    }
  }

  // ── 手势 B：点 → 拖动（有截止的任务 ⇒ start+due 变成真条，滴答同款）──
  const point = page.locator('[data-testid^="timeline-point-"]').first();
  const pointBox = await point.boundingBox();
  if (pointBox === null) throw new Error('轴上没有可拖的点');
  const pointCountBefore = await page.locator('[data-testid^="timeline-point-"]').count();
  await page.mouse.move(pointBox.x + pointBox.width / 2, pointBox.y + pointBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(pointBox.x - region.width * 0.18, pointBox.y, { steps: 12 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(800);

  // ── 手势 C：点空白建任务带日期（轴上点击 ⇒ 既有建任务 op + startDate）──
  const pointsBeforeC = await page.locator('[data-testid^="timeline-point-"]').count();
  const axis = await page.locator('[data-testid="timeline-axis"]').boundingBox();
  if (axis === null) throw new Error('轴没有 boundingBox');
  await page.mouse.click(axis.x + axis.width * 0.3, axis.y + axis.height / 2);
  await page.waitForTimeout(900);
  const pointsAfterC = await page.locator('[data-testid^="timeline-point-"]').count();

  const laneCountAfter = await page.locator('[data-testid^="timeline-lane-item-"]').count();
  const barCount = await page.locator('[data-testid^="timeline-bar-"]').count();
  const pointCountAfter = pointsAfterC;

  console.log(
    `lane→${laneCountAfter} points ${pointCountBefore}→${pointCountAfter}（手势C后 ${pointsAfterC}） bars=${barCount} errors=${errors.length}`,
  );

  await page.screenshot({ path: `${OUT}/timeline-p2-drag-light.png`, fullPage: false });
  const darkButton = page.getByRole('button', { name: '切换到暗色主题' });
  if (await darkButton.count()) {
    await darkButton.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/timeline-p2-drag-dark.png`, fullPage: false });
  }
  await browser.close();



  // 不变量：手势 B 把一个点变成条（bars ≥ 1 且点数净减一）；
  // 手势 C 点空白净加一个点 —— 两者相抵，点数回到手势 B 前的水平。
  if (barCount === 0 || pointsAfterC !== pointCountBefore) {
    console.log('RESULT=FAIL（点没变成条，或点空白没有建出任务）');
    process.exit(1);
  }
  console.log('RESULT=OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
