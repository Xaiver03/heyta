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

/**
 * 「最近 7 天」这条智能清单（#10(b)）。
 *
 * 🔴 窗口的**归属规则**在领域层已经单测钉过（含边界、跨月、逾期不在）。
 * 这一条判的是**壳**：那一行点得动吗、页头说的是这一列吗、
 * 侧栏的**计数**与点进去数出来的行数是不是同一个数。
 *
 * 最后一条最容易被跳过：计数字段与列表行各读各的判据时，症状是
 * 「侧栏写 2，点进去 3 条」，而每一层单看都"没错"。
 *
 * ⚠️ 种数据全走**真捕获条**（真 op-log、真解析），不写 localStorage 抄近路。
 */
test('最近 7 天：侧栏计数 == 点进去的行数，逾期那条不在里面', async ({ page }) => {
  // 🔴 `pageerror` 监听要**在导航之前**挂：挂晚了收不到加载期异常，
  //    而"控制台无内容"是最误导人的结果（AGENTS §6.2 规定一第 3 条）。
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?lang=zh-CN');

  const composer = page.locator('input[placeholder^="添加任务"]');
  await expect(composer).toBeVisible();
  // 三条：窗口内两条（今天 / 明天）、窗口外一条（昨天 = 逾期）。
  for (const line of ['今天要开的会', '明天要交的周报', '昨天要补的账']) {
    await composer.fill(line);
    await composer.press('Enter');
  }

  const row = page.locator('[data-testid="nav-scope-next7Days"]');
  await expect(row, '侧栏必须有「最近 7 天」这一行').toBeVisible();
  await expect(row).toContainText('最近 7 天');
  const count = page.locator('[data-testid="nav-scope-next7Days-count"]');
  await expect(count, '有任务时计数要出现').toHaveText('2');

  await page.screenshot({ path: SHOT('next7-sidebar') });

  await row.click();
  await expect(page.locator('.ht-header__title').first()).toHaveText('最近 7 天');

  const boxes = page.locator('[data-testid^="task-group-"] [role="checkbox"]');
  await expect(boxes, '计数说 2，屏上就必须是 2 行').toHaveCount(2);
  // 🔴 逾期那条**不在**这一列：它属于「已过期」，混进来"最近 7 天"这个名字就撒谎。
  await expect(page.locator('[aria-label="完成：昨天要补的账"]')).toHaveCount(0);

  await page.screenshot({ path: SHOT('next7-list') });

  // 暗色：这一列的组头/计数/勾选框在暗底上有没有跟着翻（AGENTS §5）。
  await page.getByRole('button', { name: '切换到暗色主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: SHOT('next7-dark') });

  expect(consoleErrors, '控制台不应有异常').toEqual([]);
});
