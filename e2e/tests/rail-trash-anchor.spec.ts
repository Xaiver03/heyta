import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

/**
 * rail 下段：回收站贴在「通知 / 帮助」那一组上面（左下角），不挂在上段列表的尾巴。
 *
 * 2026-10-04 产品负责人看图后拍的形：「左边回收站的那个 logo 应该放到那个帮助那上面，
 * 就是放到左下角。」在此之前它其实**已经**是"工具段"了（`TOOL_VIEW_TABS`），
 * 但那段从来没真的贴到底 —— `.ht-rail__tab--tool:first-of-type { margin-top: auto }`
 * 里的 `:first-of-type` 选的是**父元素里第一个 `<button>`**，而工具段的父元素是
 * `role="tablist"`，那里第一个按钮是「任务」。于是那条规则实际只作用在 tablist
 * **外面**的铃铛上，回收站一直跟着上段列表排。
 *
 * 🔴 这条用例钉的是**几何**，jsdom 测不到（`getBoundingClientRect` 在那里恒为 0），
 * 所以它必须在真浏览器里跑。而它同时钉住两件容易做错的事：
 * ① 回收站仍然是 `role="tab"` 且**在 tablist 里面** —— 把它挪到铃铛与帮助之间
 *    在视觉上更"贴着帮助"，但那会让 `role=tab` 跑到 tablist 外面（无效 a11y 结构，
 *    `App.tsx` 与 `inbox.css` 里各写了一次这个理由）；
 * ② 它必须**离开**上段：与上段最后一项（搜索）的间距要明显大于与铃铛的间距。
 */
test.use({ viewport: { width: 1280, height: 900 } });

test.describe('rail 下段：回收站贴底', () => {
  test('回收站在左下角，排在通知与帮助之前，且仍是 tablist 里的 tab', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

    await openApp(page);

    const rail = page.locator('nav.ht-rail');
    const trash = page.getByRole('tab', { name: '回收站' });
    const lastMainTab = page.getByRole('tab', { name: '搜索' });
    const bell = page.locator('nav.ht-rail > button[aria-haspopup="dialog"]');
    const help = page.getByTestId('rail-help');

    // 存在性先于取值：拿不到这几个按钮就说明外壳没起来，后面的几何读数全是废的。
    await expect(trash).toBeVisible();
    await expect(bell).toBeVisible();
    await expect(help).toBeVisible();

    // ① a11y 结构：它必须在 tablist 里面（这条会挡住"为了贴着帮助把它挪出去"的改法）
    await expect(
      page.locator('[role="tablist"] [role="tab"]:has-text("回收站")'),
    ).toHaveCount(1);

    // 先截图，再断言 —— 失败时也要有图可看（AGENTS §6.2 规定一）
    await page.screenshot({ path: 'test-results/rail-trash-anchor.png' });

    const [r, t, m, b, h] = [
      await rail.boundingBox(),
      await trash.boundingBox(),
      await lastMainTab.boundingBox(),
      await bell.boundingBox(),
      await help.boundingBox(),
    ];
    for (const [name, box] of [['rail', r], ['回收站', t], ['搜索', m], ['通知', b], ['帮助', h]] as const) {
      expect(box, `${name} 量不到包围盒（外壳没渲染？）`).not.toBeNull();
    }
    const railBox = r!;
    const trashBox = t!;
    const mainBox = m!;
    const bellBox = b!;
    const helpBox = h!;

    // ② 自上而下的顺序：回收站 → 通知 → 帮助
    expect(trashBox.y + trashBox.height, '回收站的下沿应在通知上沿之前').toBeLessThanOrEqual(bellBox.y + 1);
    expect(bellBox.y + bellBox.height, '通知的下沿应在帮助上沿之前').toBeLessThanOrEqual(helpBox.y + 1);

    // ③ 它属于**下段**：与上段最后一项的间距，要明显大于与通知的间距
    const gapAbove = trashBox.y - (mainBox.y + mainBox.height);
    const gapBelow = bellBox.y - (trashBox.y + trashBox.height);
    expect(gapAbove, `回收站与上段最后一项只隔 ${String(Math.round(gapAbove))}px —— 它没贴到底`).toBeGreaterThan(
      gapBelow * 3,
    );

    // ④ 它在 rail 的下半段，且整组离底部不远
    expect(trashBox.y, '回收站不在 rail 的下半段').toBeGreaterThan(railBox.y + railBox.height / 2);
    /*
      🔴 这一条原来量的是「帮助」的底边 —— 因为写它的时候帮助就是下段**最后一枚**。
      2026-10-06 工单 H9 把同步那一组搬到下段末尾（产品负责人："同步按钮不应该放在
      左下角侧边栏的左下角吗？"），于是"贴着 rail 底部"的那个人换了。
      这里跟着换成下段的**末位**（同步那一组），而不是把阈值放松 ——
      这条钉的从来是"下段这一组贴底"，不是"帮助这一枚贴底"。
    */
    const syncGroup = page.getByTestId('sync-rail');
    const syncBox = await syncGroup.boundingBox();
    expect(syncBox, '量不到同步那一组的盒子 ⇒ 下段末尾没画出来').not.toBeNull();
    expect(
      railBox.y + railBox.height - (syncBox!.y + syncBox!.height),
      '同步那一组没有贴着 rail 底部（下段末尾浮起来了）',
    ).toBeLessThan(syncBox!.height);
    expect(
      syncBox!.y,
      '同步那一组不在「帮助」之下 ⇒ 下段顺序变了（回收站 → 通知 → 帮助 → 同步）',
    ).toBeGreaterThan(helpBox.y + helpBox.height - 1);

    expect(consoleErrors, `控制台报错：${consoleErrors.join(' | ')}`).toEqual([]);
  });
});
