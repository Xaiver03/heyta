/**
 * 习惯频次编辑器（工单 H5）的**真浏览器**判据。
 * =============================================
 *
 * 🔴 这一族存在的理由不是"再测一遍 jsdom"：`apps/web/tests/habit-frequency-editor.spec.tsx`
 * 那 10 条已经覆盖了"点了哪一格发什么"。这里钉的是**只有真浏览器能回答**的三件事：
 *
 *   1. **落盘**：改完刷新还在（jsdom 里那棵根一拆就没磁盘了）；
 *   2. 🔴 **几何**：展开那一排 chip 有没有被推出视口 —— 这是工单 H3 看图照出来的
 *      那一族（`toBeVisible()` 只验"有非空 bounding box"，不验"在不在视口里"）。
 *      那一次是**事后看图**才发现，这一次把判据**前置**到新控件上；
 *   3. **暗色**：AGENTS §5「暗色不是亮色的反相，必须实际切换查看」。
 *
 * 载体：`vite preview` + `apps/web/dist`（见 `playwright.detail-pane.config.ts` 文件头）。
 * ⚠️ 改了 `apps/web` 或 `packages/*` **必须先重打**，否则测的是旧产物（§7 第 27 条）：
 *     pnpm --filter @heyta/ui build && pnpm --filter @heyta/app-host build \
 *       && pnpm --filter @heyta/web build
 * 跑法：
 *     cd e2e && npx playwright test tests/habit-frequency.spec.ts \
 *       --config playwright.detail-pane.config.ts
 */
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

import { addHabit, boxOf, openApp, selectHabit, switchView } from './helpers';

const APP_ZH = '/?lang=zh-CN';

/** 截图落**固定路径**（§6.2 规定一第 2 条）。 */
const SHOT = (name: string) =>
  fileURLToPath(new URL(`../../apps/web/evidence/habit-frequency/${name}.png`, import.meta.url));

const summary = (page: Page) => page.locator('[data-testid^="habit-freq-summary-"]').first();

const panel = (page: Page) => page.locator('[data-testid^="habit-freq-panel-"]').first();

/** 面板里**按下**的那些格（三档那一排 + 星期那一排共用 `aria-pressed`）。 */
const pressedChips = (page: Page) =>
  page.locator('[data-testid^="habit-freq-panel-"] [aria-pressed="true"]');

/**
 * 展开面板 —— **已经开着就不点**。
 *
 * 🔴 这一手不是偷懒，是这两个控件的行为**不一样**：图标选择器选完就收起
 *    （`HabitIconPicker` 在 `onChange` 里 `setOpen(false)`），而频次面板选完**不收起**
 *    —— 挑了「每周挑几天」还要接着挑日子，收起会把第二步的路径打断。
 *    第一版这里照抄了图标那一族的"再展开一次"，于是 4 条红在"点了摘要而面板没出来"，
 *    实际是**把开着的面板关掉了**（`setOpen(was => !was)`）。
 *    ⇒ 用例里凡是"再读一次面板"的地方都必须走这个幂等的版本。
 */
async function openPanel(page: Page, name: string): Promise<void> {
  const toggle = page.getByRole('button', { name: `「${name}」的频次` }).first();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(panel(page), '面板不在 ⇒ 摘要那颗没把面板开出来').toBeVisible();
}

/** 等摘要变成某句话（写入是异步的：dispatch → op-log → 重渲染）。 */
async function expectSummary(page: Page, want: string | RegExp, why: string): Promise<void> {
  await expect
    .poll(async () => (await summary(page).textContent()) ?? '', {
      message: why,
      timeout: 10_000,
    })
    .toMatch(want instanceof RegExp ? want : new RegExp(want));
}

test.describe('习惯频次编辑器（H5，web 端）', () => {
  test('Q1 摘要常驻可见：没设过频次就说「每天」，展开能看到三档', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));

    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
    await addHabit(page, '周复盘');
    await selectHabit(page, '周复盘');

    await expect(summary(page), '摘要不常驻 ⇒ 折叠着看不出这条习惯多久一次').toHaveText(/每天/);
    await openPanel(page, '周复盘');
    await expect(
      page.getByRole('button', { name: '每天一次' }),
      '三档里少了「每天一次」',
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '每周挑几天' })).toBeVisible();
    await expect(page.getByRole('button', { name: '每隔几天' })).toBeVisible();
    await page.screenshot({ path: SHOT('panel-open') });
    expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
  });

  test('Q2 🔴 切「每周挑几天」⇒ 摘要改口 + 恰好带一天 + 刷新后仍在', async ({ page }) => {
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
    await addHabit(page, '写周报');
    await selectHabit(page, '写周报');

    await openPanel(page, '写周报');
    await page.getByRole('button', { name: '每周挑几天' }).click();
    await expectSummary(page, /每周/, '点了「每周挑几天」而摘要没改口');

    // 🔴 带**一天**而不是零天：空集合会被动作层抛（`habit-actions.spec.ts` F4），
    //    于是用户看到的是"点了没反应"。按下态里除了档位那一格，还应有一格星期。
    const pressed = await pressedChips(page).allTextContents();
    expect(pressed.length, `按下的格数=${String(pressed.length)}，应至少 档位1 + 星期1`).toBeGreaterThanOrEqual(
      2,
    );
    await page.screenshot({ path: SHOT('weekly-selected') });

    await page.reload();
    await switchView(page, '习惯');
    await selectHabit(page, '写周报');
    await expectSummary(page, /每周/, '刷新之后摘要回到「每天」⇒ 没落盘或没读回来');
  });

  test('Q3 🔴「每隔几天」只在按了那一档时才写（不跟 keystroke），且刷新后仍在', async ({ page }) => {
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
    await addHabit(page, '换水');
    await selectHabit(page, '换水');

    await openPanel(page, '换水');
    // 🔴 存在性**反向**：还没切到那一档时，N 那一行根本不该画出来（第一版它无条件渲染，
    //    于是"每周"的习惯旁边摆着一个值为 2 的"每隔几天做一次"和一句隔 2 天的说明 ——
    //    界面把不生效的规则连数字一起显示，而当时 7 条断言全绿，因为它们只验"该有的在不在"）。
    await expect(page.locator('[data-testid^="habit-freq-n-"]')).toHaveCount(0);

    const n = page.locator('[data-testid^="habit-freq-n-"]').first();
    await page.getByRole('button', { name: '每隔几天' }).click();
    await expectSummary(page, /每\s*2\s*天/, '按了那一档而摘要没改口');
    await expect(n, '切到那一档之后 N 那一行还不出来').toBeVisible();

    await n.fill('1');
    await n.fill('10');
    // 🔴 输入过程**不许**已经改口：那会先落一条"每 1 天"（被归一成每天）再落一条每 10 天，
    //    中间那条是用户没要的状态，而 op-log 是永久存量。
    await expectSummary(page, /每\s*2\s*天/, '摘要跟着 keystroke 动了 ⇒ 每敲一个数字一条 op');

    await page.getByRole('button', { name: '每隔几天' }).click();
    await expectSummary(page, /每\s*10\s*天/, '按了那一档而数字没提交');
    // 反向对照：切到这一档之后，星期那一排就该整排不见（两档的零件同时摆着 = 界面在猜）。
    await expect(page.locator('[data-testid^="habit-freq-day-"]')).toHaveCount(0);

    await page.reload();
    await switchView(page, '习惯');
    await selectHabit(page, '换水');
    await expectSummary(page, /每\s*10\s*天/, '刷新之后数字没落盘');
    await page.screenshot({ path: SHOT('interval-ten') });
  });

  test('Q4 退回「每天一次」⇒ 摘要回「每天」且刷新后仍在（清除写的是 null）', async ({ page }) => {
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
    await addHabit(page, '冥想');
    await selectHabit(page, '冥想');

    await openPanel(page, '冥想');
    await page.getByRole('button', { name: '每隔几天' }).click();
    await expectSummary(page, /每\s*\d+\s*天/, '先设一个 interval 作为前置');

    await openPanel(page, '冥想');
    await page.getByRole('button', { name: '每天一次' }).click();
    await expectSummary(page, /^每天$/, '退回每天没生效');

    await page.reload();
    await switchView(page, '习惯');
    await selectHabit(page, '冥想');
    await expectSummary(page, /^每天$/, '刷新后又变回 interval ⇒ 清除没写成 null');
  });

  test('Q5 🔴 摘要与面板按下态说的是同一句话（同一判断不许两处画得不一样）', async ({ page }) => {
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
    await addHabit(page, '背单词');
    await selectHabit(page, '背单词');

    await openPanel(page, '背单词');
    await page.getByRole('button', { name: '每周挑几天' }).click();
    await expectSummary(page, /每周/, '前置：先切到每周');
    await openPanel(page, '背单词');

    const pressedDays = (await pressedChips(page).allTextContents())
      .map((s) => s.trim())
      .filter((s) => s.length === 1);
    const text = (await summary(page).textContent()) ?? '';
    for (const day of pressedDays) {
      expect(text, `面板里「${day}」按下，摘要却没念它`).toContain(day);
    }
    expect(pressedDays.length, '摘要念了每周，面板里却一格都没按下').toBeGreaterThan(0);
  });

  test('Q6 🔴 几何：展开的每一格都在视口内、都在窗格内', async ({ page }) => {
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
    await addHabit(page, '拉伸');
    await selectHabit(page, '拉伸');

    await openPanel(page, '拉伸');
    await page.getByRole('button', { name: '每周挑几天' }).click();
    // 🔴 先**把前提等出来**再量几何。第一版这里直接 `openPanel` + 数格子，于是
    //    "切档没生效"被报成"展开的格数不是 3 档 + 7 天"（收到 3 枚 = 只有三档那一排），
    //    读起来像布局坏了，实际是**下面那个 for 循环一次都没跑到** ——
    //    一条判据的失败信息说错了话，比没有信息更糟（§7 元规则 1）。
    await expectSummary(page, /每周/, '点了「每周挑几天」而摘要没改口');
    await openPanel(page, '拉伸');
    await expect(
      page.locator('[data-testid^="habit-freq-day-"]'),
      '摘要已经是「每周」，星期那一排却没出来',
    ).toHaveCount(7);

    const viewport = page.viewportSize();
    expect(viewport, '量不到视口尺寸 ⇒ 这一条没有基准').not.toBeNull();
    const pane = await boxOf(page, page.getByTestId('habit-pane'), '详情窗格');
    const boxes = await page
      .locator('[data-testid^="habit-freq-panel-"] button')
      .evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, right: r.right, label: (el.textContent ?? '').trim() };
        }),
      );
    // 三档 + 七个星期 = 10 枚。少一枚就是有一枚被排到别处去了。
    expect(boxes, '展开的格数不是 3 档 + 7 天').toHaveLength(10);
    for (const b of boxes) {
      expect(
        b.right,
        `「${b.label}」右边缘 ${String(Math.round(b.right))}px 超出视口宽 ${String(
          Math.round(viewport?.width ?? 0),
        )}px —— 看不见的那一格等于没有那一格`,
      ).toBeLessThanOrEqual((viewport?.width ?? 0) - 1);
      expect(b.x, `「${b.label}」被推到视口左边外面`).toBeGreaterThanOrEqual(0);
      /* 🔴 左边界也必须对着**窗格**量，不能只对着视口量。这条是臂台 N5 连打空四版之后
         现量出来的（`tmp/h7-readings/n5-dump2.log`）：把星期那一排撑到不换行 + 每枚 142px 时，
         整排宽度超出详情窗格，浏览器把它**向左**挤出了窗格 —— 干净态一枚 chip 在 `x=983`
         （窗格 945..1264），变异态同一排落在 `x≈128..1146`。**右边缘 1146 仍然小于窗格右边界**，
         所以只量右边界的这条判据在"整排已经逃出自己的容器"时照样全绿。
         这条用例的名字写的是"都在窗格内"，那么两个边都得对着窗格量。 */
      expect(
        b.x,
        `「${b.label}」左边缘 ${String(Math.round(b.x))}px 退到窗格左边界 ${String(
          Math.round(pane.x),
        )}px 之外 —— 被挤出自己那一栏的格子，等于那一格没人管了`,
      ).toBeGreaterThanOrEqual(pane.x - 1);
      expect(b.right, `「${b.label}」超出窗格右边界`).toBeLessThanOrEqual(pane.x + pane.width + 1);
    }
    await page.screenshot({ path: SHOT('weekly-in-viewport') });
  });

  test('Q7 暗色：摘要与按下态照旧读得到（§5「暗色不是反相」）', async ({ page }) => {
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
    await addHabit(page, '阅读');
    await selectHabit(page, '阅读');

    await openPanel(page, '阅读');
    await page.getByRole('button', { name: '每周挑几天' }).click();
    await expectSummary(page, /每周/, '暗色前置：先切到每周');

    await page.getByRole('button', { name: '切换到暗色主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await openPanel(page, '阅读');
    const text = (await summary(page).textContent()) ?? '';
    expect(text).toContain('每周');
    const pressed = await pressedChips(page).count();
    expect(pressed, '暗色下按下态读不出来（对比度或颜色没取 token）').toBeGreaterThanOrEqual(2);

    // 🔴 按下那一格的**边框**在暗色下也要取到主色 token：`.ht-habit__freq-chip[aria-pressed]`
    //    用的是 `--ht-color-primary`，写死颜色时这里会读到一个与 token 无关的值。
    const primary = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--ht-color-primary').trim(),
    );
    expect(primary, '暗色下取不到主色 token').not.toBe('');
    const border = await pressedChips(page)
      .first()
      .evaluate((el) => getComputedStyle(el).borderTopColor);
    expect(border, `按下那一格的边框是 ${border}，与主色 token ${primary} 无关`).not.toBe('');
    await page.screenshot({ path: SHOT('weekly-dark') });
  });
});
