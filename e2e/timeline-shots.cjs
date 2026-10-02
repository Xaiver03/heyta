/**
 * 时间线重做的**桌面载荷截图取证**（goal §6.7：人真看，§6.2 规定一）
 * ================================================================
 *
 * 🔴 刻意**不走** e2e 的 playwright.config（它的 webServer 前置会 SIGKILL
 * 别的会话的 dev server，§7 第 87 条）—— 本脚本假设 4321 上已有一台
 * apps/web 的 vite 在跑，只附带一个无头浏览器，不启停任何服务器。
 *
 * 产出（固定路径，供人打开）：
 *   e2e/test-results/timeline-rework-light.png
 *   e2e/test-results/timeline-rework-dark.png
 *
 * 数据：两条带截止（自然语言日期，走捕获计划）+ 一条不带截止（落「未排期」泳道）
 * —— 三态在一屏里齐了。跑完**不清库**（与取证脚本惯例一致，残留登记在台账）。
 */

const { chromium } = require('playwright');

const BASE = process.env.SHOT_BASE ?? 'http://localhost:4321';
const OUT = process.env.SHOT_OUT ?? 'test-results'; // 相对 e2e/ 运行

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`${BASE}/?lang=zh-CN`, { waitUntil: 'networkidle' });
  // 并行会话新加的隐私同意面板：本地取证选「以后再说」（不落同意记录、不联网）
  const later = page.getByRole('button', { name: /以后再说|Decide later/ });
  if (await later.count()) {
    await later.click();
    await page.waitForTimeout(500);
  }
  await page.waitForSelector('[data-testid="task-list"]', { timeout: 30_000 });

  const composer = page.locator('input[placeholder^="添加任务"]');

  async function addTask(text) {
    const before = await page.locator('[data-testid^="task-item-"]').count();
    await composer.fill(text);
    await composer.press('Enter');
    await page
      .waitForFunction(
        (b) => document.querySelectorAll('[data-testid^="task-item-"]').length > b,
        before,
        { timeout: 15_000 },
      )
      .catch(() => {});
  }

  await addTask('明天15:00 交评审稿给产品负责人');
  await addTask('今天18:00 团队周会');
  await addTask('整理时间线的调研笔记');

  // 切到时间线（rail 的 tab 按钮）
  await page.getByRole('tab', { name: '时间线' }).click();
  await page.waitForSelector('[data-testid="timeline-view"]', { timeout: 15_000 });
  await page.waitForTimeout(800);

  await page.screenshot({ path: `${OUT}/timeline-rework-light.png`, fullPage: false });

  // 暗色不是亮色的反相（AGENTS §5）：真的切一次
  const darkButton = page.getByRole('button', { name: '切换到暗色主题' });
  if (await darkButton.count()) {
    await darkButton.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/timeline-rework-dark.png`, fullPage: false });
  } else {
    console.log('WARN: 没找到暗色切换按钮，暗色截图缺失');
  }

  const axisCount = await page.locator('[data-testid="timeline-axis"]').count();
  const pointCount = await page.locator('[data-testid^="timeline-point-"]').count();
  const laneVisible = await page.locator('[data-testid="timeline-lane"]').count();
  console.log(`axis=${axisCount} points=${pointCount} lane=${laneVisible} errors=${errors.length}`);
  if (errors.length) console.log(errors.join('\n'));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
