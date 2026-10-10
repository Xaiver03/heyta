import { expect, test } from '@playwright/test';
import { openApp, switchTheme, waitForOverlaySettled } from './helpers';

for (const width of [375, 1440]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`Help browser entries ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 });
      await openApp(page, '/?lang=zh-CN');
      if (theme === 'dark') await switchTheme(page, 'dark');
      await page.getByRole('button', { name: '帮助', exact: true }).click();
      const panel = page.getByTestId('about-panel');
      await expect(panel).toBeVisible();
      // 🔴 入场动画 `ht-sheet-in` 把整块 `opacity` 从 0 跑到 1，动画中途按截图拍到的是
      // 下层视图叠上来的**过渡帧**（`waitForOverlaySettled` 的注释里记着同一前科）。
      // 下面那些断言量的是 DOM/CSS/几何，不受影响；受影响的是给人打开看的那张图。
      await waitForOverlaySettled(page, 'settings-sheet');
      await expect(page.getByTestId('settings-sheet').getByRole('heading')).toHaveCount(1);
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
