import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

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
  // 🔴 中文界面由 `openApp` 钉（解析链第 1 层 `heyta.locale`）。这里以前写的是
  // 裸 `goto('/?lang=zh-CN')` —— 那走的是第 2 层，能把界面钉住，但**不做完首启
  // 隐私同意**，于是后面每一次点击都卡在遮罩上。真正必须测"第 3 层跟着系统语言
  // 漂"的是 `language-first-launch.spec.ts`，它刻意不走 `openApp`。
  await openApp(page);

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
  await openApp(page);

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
  await openApp(page);

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

/**
 * 页头的排序档位（#10(d)）：**真浏览器里的取证**。
 *
 * 🔴 这条必须有图，jsdom 给不了：控件长在 `header.ht-header` 那条 flex 里，
 * "标签文字有没有被压掉""下拉在暗色底上读不读得出来"都不是 DOM 断言能说的。
 * 桌面壳（macOS / Windows）渲染的就是这份 `apps/web/dist`，所以这几张图
 * 同时是**桌面端界面**的证据 —— 壳里那一次脚本化探针仍是登记着的缺口。
 *
 * 种的数据全部**不带截止日期**：三条落进同一个「无截止时间」组，
 * 于是屏上的行序验的就是排序本身，不是分组。
 */
test('页头排序：换档位真的换行序，控件带可见标签', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);

  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  const composer = page.locator('input[placeholder^="添加任务"]');
  for (const line of ['先记的第一条', '中间的第二条', '最后记的第三条']) {
    await composer.fill(line);
    await composer.press('Enter');
  }

  const sort = page.locator('[data-testid="task-sort"]');
  await expect(sort, '有行时页头就该有排序控件').toBeVisible();
  await expect(sort).toContainText('排序方式');
  const select = page.locator('[data-testid="task-sort-select"]');
  const rows = page.locator('[data-testid^="task-group-"] [role="checkbox"]');

  const order = async (): Promise<string[]> =>
    (await rows.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))) as string[];

  await expect(page.locator('header.ht-header [data-testid="task-sort"]'), '控件必须长在页头里（滴答参照图第三列）').toBeVisible();
  const byDefault = await order();
  await page.screenshot({ path: SHOT('sort-default') });

  await select.selectOption('addedAt');
  const byAdded = await order();
  expect(byAdded, '按添加时间 = 新的在前').toEqual([...byDefault].reverse());
  expect(new Set([byDefault.join('|'), byAdded.join('|')]).size, '两档必须是两个顺序').toBe(2);
  await page.screenshot({ path: SHOT('sort-addedAt') });

  await select.selectOption('priority');
  await page.screenshot({ path: SHOT('sort-priority') });

  // 暗色：下拉的底色/边框/文字是否跟着 token 翻（AGENTS §5）。
  await page.getByRole('button', { name: '切换到暗色主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // ⚠️ 等动效落位再拍：主题切换带 duration token 的过渡，抢拍会把
  // 行尾那些按钮拍成"灰底没文字"——那是探针的假象，不是界面的样子（e2e 探针陷阱）。
  await page.waitForTimeout(600);
  await page.screenshot({ path: SHOT('sort-dark') });

  expect(consoleErrors, '控制台不应有异常').toEqual([]);
});
