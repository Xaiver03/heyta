import { expect, test } from '@playwright/test';

/**
 * 收集箱界面 vs 滴答清单参照图（产品负责人 2026-10-01 附 macOS 截图）
 * ============================================================
 *
 * 参照图结构（第二列 + 第三列）：
 *   第二列：智能清单（今天 / 最近 7 天 / 收集箱，各带计数，选中行 = 灰底圆角）
 *           → 清单（空 = 淡色说明卡）→ 过滤器（空 = 淡色说明卡）
 *           → 标签（图标 + 名字 + 右端色点）→ 底部 已完成 / 垃圾桶
 *   第三列：页头（视图切换 + 标题 + 排序 + ⋯）
 *           → 常驻「+ 添加任务至 "收集箱"」
 *           → 可折叠分组（▾ 组名 + 计数；已过期组右端「顺延」）
 *           → 行 = 勾选框（逾期橙描边）+ 标题 + 备注预览 + 右端元信息
 *
 * 本文件**只出图**，断言留给真正的对齐轮 —— 先让差距一眼可见。
 */

const SHOT = (name: string) => `test-results/inbox-dida-${name}.png`;

test('收集箱：当前形态取证', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // 🔴 `?lang=zh-CN` 是**必需**的，不是排版偏好：Playwright 的浏览器默认语言是
  // en-US，而 `resolveInitialLocale` 第 3 层问 `navigator.language` ⇒ 界面是英文，
  // `添加任务` 输入框不存在。取证要拍中文界面，就走解析链第 2 层（高于系统语言）。
  await page.goto('/?lang=zh-CN');

  const composer = page.locator('input[placeholder^="添加任务"]');
  await expect(composer).toBeVisible();

  // 种数据：逾期 / 今天 / 无日期，全部走真捕获条（真 op-log）。
  for (const line of ['昨天要交的周报', '今天要开的会', '随时要做的事']) {
    await composer.fill(line);
    await composer.press('Enter');
  }

  // 收集箱 = 侧栏第一项。
  await page.getByRole('button', { name: /收集箱/ }).first().click();
  await expect(page.locator('.ht-header__title').first()).toHaveText('收集箱');

  await page.screenshot({ path: SHOT('inbox'), fullPage: false });

  // 全部任务（收集箱只装无清单的），回到第一张看分组。
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  expect(consoleErrors, '控制台不应有异常').toEqual([]);
});

/**
 * 组头折叠（#10(c)）：**收起一组之后界面说了什么**。
 *
 * 🔴 这一条必须有图，单测给不了：收起态里那枚 ▸ 是 `HeytaIcon`（走
 * `react-native-svg` 的 web 实现）。属性断言只能证明 `aria-expanded` 变了，
 * 证明不了**那个箭头画出来了** —— 图标静默少画一块是这个图标层文件头里
 * 明确写过的失效形态，而它在 DOM 上完全看不出来。
 *
 * 判据三条，缺一不可：行**离开 DOM**、组头**与计数留下**、再点**回得来**。
 */
test('组头折叠：收起后行消失、组头与计数留下', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?lang=zh-CN');

  const composer = page.locator('input[placeholder^="添加任务"]');
  await expect(composer).toBeVisible();
  for (const line of ['随时要做的事', '另一件不急的事']) {
    await composer.fill(line);
    await composer.press('Enter');
  }

  const group = page.locator('[data-testid="task-group-undated"]');
  const toggle = page.locator('[data-testid="task-group-undated-head-toggle"]');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(group.locator('[role="checkbox"]')).toHaveCount(2);

  await page.screenshot({ path: SHOT('collapse-expanded') });

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(group.locator('[role="checkbox"]')).toHaveCount(0);
  // 🔴 组头整条还在，而且**计数还在** —— 收起后看不见"有几条"就是掩耳盗铃。
  await expect(page.locator('[data-testid="task-group-undated-head"]')).toContainText('无截止时间');
  await expect(page.locator('[data-testid="task-group-undated-head"]')).toContainText('2');

  await page.screenshot({ path: SHOT('collapse-collapsed') });

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(group.locator('[role="checkbox"]')).toHaveCount(2);

  // 🔴 暗色不是亮色的反相（AGENTS §5）：那枚 ▸ 用的是 `color.foreground-subtle`，
  // 在亮底上是浅灰 —— 只截图看一眼才知道它在暗底上有没有跟着翻。
  await page.getByRole('button', { name: '切换到暗色主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await toggle.click();
  await expect(group.locator('[role="checkbox"]')).toHaveCount(0);
  await page.screenshot({ path: SHOT('collapse-collapsed-dark') });

  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  expect(consoleErrors, '控制台不应有异常').toEqual([]);
});
