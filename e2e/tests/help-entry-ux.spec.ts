import { expect, test } from '@playwright/test';
import { openApp, switchTheme, waitForOverlaySettled } from './helpers';

for (const width of [375, 1440]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`Help browser entries ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 });
      await openApp(page, '/?lang=zh-CN');
      if (theme === 'dark') await switchTheme(page, 'dark');
      // 🔴 窄屏（compact rail）那一档，「帮助」不在常驻 rail 上，而在「更多」面板里
      // （`CompactRailNavigation.tsx` 把面板整块 `hidden={!open}`，隐藏子树不进无障碍树 ——
      // 直接 `getByRole('button', { name: '帮助' })` 在那一档是**等不到**而不是点不到）。
      // 先按人的真路径试一次常驻 rail 的直达，等不到才展开「更多」——
      // 判定用带等待的 click，不用 `isVisible()` 快照（`helpers.ts` 里 `switchView` 记着同一坑）。
      const help = page.getByRole('button', { name: '帮助', exact: true });
      try {
        await help.click({ timeout: 5_000 });
      } catch {
        await page.getByTestId('compact-rail-more').click();
        await help.click();
      }
      const panel = page.getByTestId('about-panel');
      await expect(panel).toBeVisible();
      // 🔴 入场动画 `ht-sheet-in` 把整块 `opacity` 从 0 跑到 1，动画中途按截图拍到的是
      // 下层视图叠上来的**过渡帧**（`waitForOverlaySettled` 的注释里记着同一前科）。
      // 下面那些断言量的是 DOM/CSS/几何，不受影响；受影响的是给人打开看的那张图。
      await waitForOverlaySettled(page, 'settings-sheet');
      /**
       * 🔴 **导航里的当前项必须落在可视窗口内**。窄屏那根分组导航是横向可滚的条（七项总宽
       * 远超窗口），而这一条路径**不经过导航按钮自己的 `onClick`** —— 旧代码把 `scrollIntoView`
       * 只挂在那个 `onClick` 上，于是内容面已经换成帮助、导航还停在最左边，`aria-current="page"`
       * 那条选中态整个画在窗口外（台账实测 375：当前项在文档 x `631..737`，窗口只到 `x=315`）。
       * 同一规则的 jsdom 版判据在 `apps/web/tests/settings-nav-reveal.spec.tsx`；这一条量**几何**，
       * 因为它要回答的是用户那一问 —— "我看得见我被选中了吗"。
       */
      const settingsNav = page.locator('.ht-settings__nav');
      const currentNav = settingsNav.locator('[aria-current="page"]');
      await expect(currentNav, '设置导航里必须有一项被标成当前档').toHaveCount(1);
      const navBox = await settingsNav.boundingBox();
      const currentBox = await currentNav.boundingBox();
      expect(navBox, '设置导航必须在布局里').not.toBeNull();
      expect(currentBox, '当前项必须在布局里').not.toBeNull();
      expect(
        currentBox!.x >= navBox!.x - 0.5 && currentBox!.x + currentBox!.width <= navBox!.x + navBox!.width + 0.5,
        `当前项落在导航可视窗口外：窗口 x=${navBox!.x}..${navBox!.x + navBox!.width}，当前项 x=${currentBox!.x}..${currentBox!.x + currentBox!.width}`,
      ).toBe(true);
      /*
       * 🔴 2026-10-31 起设置内容面**不再渲染节标题**（裁决与理由逐字在
       * `apps/web/src/App.tsx:350-358`：左栏已经用主色底 + `aria-current="page"`
       * 说了"你在哪一节"，内容面再写一遍同一个词，就是同一份信息架构画了两次）。
       * ⇒ 原来这一句（`settings-sheet` 里 heading === 1）的**前提整个消失**，
       * 现量是 `33 × locator resolved to 0 elements`（2026-11-04 那一趟的原文）。
       *
       * 判据本义不变 —— "这一屏有且只有一个名字，而且就是当前那一节"。它现在挂在三处
       * 现量上，三处缺一条都会让"无名的一屏"或"两份名字"重新长出来：
       *   ① 浮层自己是 `role="dialog"`，必须有可访问名（空名字 = 读屏只听到"对话框"）；
       *   ② 内容面**只有一节**是显示着的（其余节带 `hidden`，不进无障碍树）；
       *   ③ 那一节的名字与左栏选中项**是同一句话**（同一个词条键，不是第二份文案）。
       * 同一件事的 jsdom 版判据在 `apps/web/tests/settings-sheet-ia.spec.tsx`
       * 「内容面不重复侧栏已经指出的节标题」那一条。
       */
      const sheet = page.getByTestId('settings-sheet');
      await expect(sheet).toHaveAttribute('role', 'dialog');
      const sheetName = (await sheet.getAttribute('aria-label'))?.trim() ?? '';
      expect(sheetName, '设置浮层没有可访问名 —— 读屏用户听到的会是一个没有名字的对话框').not.toBe('');
      const shownGroups = sheet.locator('section.ht-settings__group:not([hidden])');
      await expect(shownGroups, '设置内容面同时画出了不只一节（或一节都没画）').toHaveCount(1);
      await expect(shownGroups).toHaveAttribute(
        'aria-label',
        (await currentNav.textContent())?.trim() ?? '',
      );
      await expect(page.getByTestId('detail-pane-toggle')).toHaveCount(0);
      const links = page.getByTestId('about-links').getByRole('link');
      await expect(links).toHaveCount(4);
      for (const [index, path] of ['/docs', '/changelog', '/pricing'].entries()) {
        const link = links.nth(index);
        await expect(link).toHaveAttribute('href', `https://heyta.waytofuture.cn${path}`);
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        const box = await link.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        await expect(link).not.toHaveCSS('text-decoration-line', 'underline');
      }
      /**
       * 🔴 投诉/举报入口与三条站点链接**同形**（一行可点的链接、同样 44px 的目标区），
       * 但走的是 `mailto:`：不带 `target="_blank"`（会先开一片空白标签页，读起来像
       * 点了没反应），也不带那支"在新标签打开"的斜箭头。
       * 邮箱从 `@heyta/legal` 的 `OPERATOR.contactEmail` 取，主题由词条表给。
       */
      const feedback = page.getByTestId('about-link-feedback');
      await expect(feedback).toHaveAttribute('href', /^mailto:heyta@waytofuture\.cn\?subject=/);
      // 一行里是"标题 + 说明"两格（与上面三条同形），所以判**含**而不是逐字相等。
      await expect(feedback).toContainText('投诉与举报');
      // mailto 上这两个属性必须**不存在**：`target="_blank"` 会让 Chrome 先开一片空白标签页。
      expect(await feedback.getAttribute('target')).toBeNull();
      expect(await feedback.getAttribute('rel')).toBeNull();
      const feedbackBox = await feedback.boundingBox();
      expect(feedbackBox!.height).toBeGreaterThanOrEqual(44);
      expect(feedbackBox!.x + feedbackBox!.width).toBeLessThanOrEqual(width);
      await expect(feedback).not.toHaveCSS('text-decoration-line', 'underline');
      await expect(panel).not.toContainText('搜索引擎');
      await expect(panel).not.toContainText('PWA');
      await expect(page.getByTestId('settings-sheet-close')).toBeVisible();
      await page.screenshot({ path: `../apps/web/evidence/help-entry/help-${width}-${theme}.png` });
      await page.getByTestId('settings-sheet-close').click();
      await expect(page.getByTestId('settings-sheet')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: '收集箱', exact: true })).toBeVisible();
    });
  }
}
