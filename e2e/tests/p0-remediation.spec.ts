import { expect, test, type Page } from '@playwright/test';

import {
  addTask,
  closeSettingsSheet,
  openApp,
  openSettingsView,
  showDetailColumnContent,
  switchTheme,
  switchView,
} from './helpers';

/**
 * P0 体验整改的**视觉基线重取证**（Goal W9，2026-10-06）
 * =======================================================
 *
 * 工单来源：`docs/research/product-level-ia-ux-audit.md` §8 第 7 条
 * （"统一最新截图与当前代码的视觉基线"）+ W1-W8 各条的截图判据。
 * 对照物：整改前的三张旧图 ——
 * `screenshots/web-mobile/MW01-移动端任务.png`（窄屏竖排）、
 * `apps/web/evidence/detail-pane-overlay/settings-sheet.png`（设置与详情列同屏）、
 * `apps/web/evidence/selection-projections/02-quadrant.png`（四象限空态占屏）。
 *
 * 截图固定落 `apps/web/evidence/p0-remediation/`（§6.2 规定一的"固定路径"），
 * 每张有人看过并在 README 里登记（规定一的"人看"）。
 * 主题走**真开关**（`switchTheme`），不走 emulateMedia —— 那条假绿有过两次前科。
 */

const SHOTS = '../apps/web/evidence/p0-remediation';

/** 规定一第 3 条：抓 console 与 pageerror —— 白屏的根因几乎只在这里现形。 */
function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`[console.error] ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`[pageerror] ${err.message}`));
  return problems;
}

test.describe('P0 整改视觉基线', () => {
  let problems: string[] = [];

  test.afterEach(async () => {
    // 就算断言全绿也打印：console 错误可能在"没断言到的那一面"现形。
    if (problems.length > 0) {
      console.log(`⚠️ 本条用例期间捕获到 ${problems.length} 条浏览器错误：`);
      for (const line of problems) console.log(`  ${line}`);
    }
    problems = [];
  });

  test('W1+W3：任务视图首屏（1440 亮）——主段 ≤4 +「更多」，AI 抽屉默认收起', async ({
    page,
  }) => {
    problems = watchConsole(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await addTask(page, '买两桶漆');
    await addTask(page, '给客厅换一盏暖光的落地灯');

    // 截图在断言前落盘（规定一第 1 条：失败也要有图）。
    await page.screenshot({ path: `${SHOTS}/w1w3-tasks-1440-light.png`, fullPage: false });

    // 🔴 排除助手那一枚（`rail-assistant`）：它同样是 `role="tab"`、但没有 `--tool` 类，
    // 也不是视图目的地（它打开 AI 面）。不排除就会把「主段 ≤4」数成 5。
    const primaryTabs = page.locator(
      '.ht-rail__tabs button[role="tab"]:not(.ht-rail__tab--tool):not([data-testid="rail-assistant"])',
    );
    await expect(
      primaryTabs,
      '主段目的地必须 ≤4（W1：不平铺全部启用模块）',
    ).toHaveCount(4);
    await expect(page.locator('.ht-rail__more button')).toBeVisible();
    /*
     * 🔴 2026-10-25 改判据：`ai-drawer` 这个 testid **已经不存在** —— AI 面不再是"抽屉"，
     * 它现在是右栏里的一块连续面（`ai-agent-surface`；`ai-panels.css:799-802` 记着那次改动的理由：
     * 「工具执行属于对话中的过程状态，不再与聊天并列成两个需要用户选择的入口」）。
     *
     * W3 那条判据要防的事（"AI 不许默认铺开、抢走任务视图的首屏"）仍然成立，只是载体变了：
     * 它现在的守点是 **右栏**是否在、AI 面是否落在右栏里（`ai-row-layout.spec.ts` 的
     * `assertColumn` 逐档量几何）。这里只留一条最小读数：AI 面**在**，而且不是整屏。
     */
    const aiSurface = page.locator('[data-testid="ai-agent-surface"]');
    await expect(aiSurface).toHaveCount(1);
    const aiBox = await aiSurface.boundingBox();
    const viewport = page.viewportSize()!;
    expect(aiBox, 'AI 面有几何').not.toBeNull();
    expect(
      aiBox!.width,
      'W3：AI 面不许铺成整屏（那会抢走任务视图的首屏）—— 它应当落在右栏里',
    ).toBeLessThan(viewport.width * 0.6);
  });

  test('W1：「更多」菜单展开（亮 + 暗两张），键盘路径可用', async ({ page }) => {
    problems = watchConsole(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);

    await page.locator('.ht-rail__more button').click();
    const menu = page.locator('[role="menu"]');
    await expect(menu).toBeVisible();
    await expect(page.locator('[role="menuitem"]')).toHaveCount(6); // 时间线/搜索/番茄钟/成长/便签/倒数纪念日
    await page.screenshot({ path: `${SHOTS}/w1-more-open-light.png` });

    // 键盘路径（W1 判据）：打开聚焦首项；Esc 收起并归还焦点。
    const first = page.locator('[role="menuitem"]').first();
    await expect(first).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(page.locator('.ht-rail__more button')).toBeFocused();

    await switchTheme(page, 'dark');
    await page.locator('.ht-rail__more button').click();
    await expect(menu).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/w1-more-open-dark.png` });
    await page.keyboard.press('Escape');
    await switchTheme(page, 'light');
  });

  test('W2：设置浮层开着 ⇒ 详情列退场（对照旧图 settings-sheet.png）', async ({ page }) => {
    problems = watchConsole(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await showDetailColumnContent(page, 'W2 对照判据甲');

    const column = page.locator('[data-testid="detail-column"]');
    await expect(column).toBeVisible();
    await openSettingsView(page);
    await page.screenshot({ path: `${SHOTS}/w2-settings-suppresses-detail.png` });
    // 隐藏判定（jsdom 侧已有单测，这里钉**视觉态**：不可见）。
    await expect(column, 'W2：设置开着详情列必须不可见').toBeHidden();
    await closeSettingsSheet(page);
    await expect(column).toBeVisible();
  });

  test('W5：四象限空态减重（对照旧图 02-quadrant.png）', async ({ page }) => {
    problems = watchConsole(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await addTask(page, '四象限对照任务一');
    await addTask(page, '四象限对照任务二');
    await switchView(page, '四象限');

    await page.screenshot({ path: `${SHOTS}/w5-quadrant-after.png` });
    await expect(page.getByText('拖任务到这里')).toHaveCount(1);
    // 槽位从 1 起（`quadrant-count-${slot}`，与 jsdom 判据同源）。
    for (let n = 1; n <= 4; n += 1) {
      await expect(page.locator(`[data-testid="quadrant-count-${n}"]`)).toBeVisible();
    }
    await expect(page.locator('[data-testid="quadrant-help"] summary')).toBeVisible();
  });

  test('W6+W7：详情列四分组 + 可改标题与优先级（1440）', async ({ page }) => {
    problems = watchConsole(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await showDetailColumnContent(page, '四分组判据甲');

    await page.screenshot({ path: `${SHOTS}/w6w7-detail-groups.png` });
    for (const key of ['basic', 'time', 'organize', 'automation']) {
      // 词条文字在 e2e 里按中文断言（zh 由 pinChineseUi 钉住）。
      const label = { basic: '基本信息', time: '时间', organize: '组织', automation: '自动化' }[
        key
      ] as string;
      await expect(
        page.locator('h3[data-testid="task-detail-group"]', { hasText: label }),
        `四分组的「${label}」组头必须可见`,
      ).toBeVisible();
    }
    await expect(page.locator('[data-testid="task-priority-select"]')).toBeVisible();
    // 「高级」折叠默认收起（W6）。
    const advanced = page.locator('[data-testid="task-repeat-advanced"]');
    await expect(advanced).toHaveJSProperty('open', false);
  });

  test('W4：375 窄屏 —— 底栏标签单行，范围筛选不再压进底栏（对照 MW01）', async ({ page }) => {
    problems = watchConsole(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await addTask(page, '窄屏对照任务一');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(300); // 等媒体查询布局稳定

    await page.screenshot({ path: `${SHOTS}/w4-narrow-375-tasks.png` });

    // 竖排病灶的几何判据：每个标签的盒必须**宽 > 高**（逐字竖排 = 高 > 宽）。
    const labels = page.locator('.ht-rail__label');
    const count = await labels.count();
    expect(count, '底栏标签数量应为正').toBeGreaterThan(0);
    let hidden = 0;
    let measured = 0;
    for (let i = 0; i < count; i += 1) {
      const box = await labels.nth(i).boundingBox();
      // ⚠️ 375 档是**图标栏**：文案节点仍在 DOM 里，但被隐藏（`boundingBox()` 为 null）。
      // 那条判据要防的是"文字竖排"，而隐藏的文字不会竖排 —— 跳过它，并记一条读数，
      // 免得"跳过"被读成"验过"。真正该守的在下面：**可见的那几枚必须宽 > 高**。
      if (box === null) {
        hidden += 1;
        continue;
      }
      measured += 1;
      expect(
        box.width,
        `第 ${i} 枚标签（${await labels.nth(i).textContent()}）宽 ${box!.width} 必须 > 高 ${box!.height}（单行）`,
      ).toBeGreaterThan(box.height);
    }
    // 🔴 读数要现量（**别把"跳过"读成"验过"**）：可见几枚、隐藏几枚。
    console.log(`[W4] 底栏标签：可见 ${measured} 枚、隐藏 ${hidden} 枚（375 档是图标栏）`);
    // 范围筛选（今天/最近7天/已完成）现在在底栏上方的筛选条里，不逐字竖排。
    const scopeItems = page.locator('.ht-nav__item');
    const scopeCount = await scopeItems.count();
    let scopesMeasured = 0;
    for (let i = 0; i < scopeCount; i += 1) {
      const box = await scopeItems.nth(i).boundingBox();
      // 同 `.ht-rail__label`：375 档里筛选条是收起的，节点在 DOM 里但不可见。
      // 判据要防的是"竖排"，隐藏的节点不会竖排 ⇒ 跳过并记账。
      if (box === null) continue;
      scopesMeasured += 1;
      expect(box.width, `筛选 chip ${i} 也必须横排`).toBeGreaterThan(box.height);
    }
  });
});
