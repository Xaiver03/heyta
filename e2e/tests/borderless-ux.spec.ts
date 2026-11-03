import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { decorativeShadowLayers, visibleFocusRing } from './focus-ring';
import { openApp, switchTheme, switchView } from './helpers';

const out = fileURLToPath(new URL('../../apps/web/evidence/borderless-ux', import.meta.url));

test('无描边搜索、键盘结果导航与连续月历在深浅和窄屏可用', async ({ page }) => {
  test.setTimeout(180_000);
  await mkdir(out, { recursive: true });
  await openApp(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByTestId('capture-input').fill('今天 复盘项目');
  await page.getByTestId('capture-input').press('Enter');
  await expect(page.getByRole('checkbox', { name: '完成：复盘项目', exact: true })).toBeVisible();
  const readout = [];
  for (const theme of ['light', 'dark'] as const) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) await switchTheme(page, theme);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await switchView(page, '搜索');
      const input = page.getByTestId('search-panel-input');
      await expect(input).toBeFocused();
      await input.fill('复盘');
      await expect(page.getByTestId('search-panel-results')).toContainText('复盘项目');
      /*
       * 🔴 2026-10-25 改读数口径（**不是放宽**）：这一条原来断言焦点在搜索框里时
       * `outline-width === 0px`，即"输入框不画焦点环"。那个口径已被 2026-10-24 的
       * 无障碍决定取代 —— `borderless-controls.css:44-51` 给**所有文本输入的键盘焦点**
       * 补回了可见焦点环（WCAG 2.4.7 Focus Visible / 1.4.11 Boundaries，注释里写明它顶着
       * "无描边"观感）。所以现在焦点框**就该有** 2px 主色环，没有才是缺陷。
       * 这条用例要守的仍是"无描边"：**面板/边框**不许画（下面两条照旧），
       * 而焦点指示必须看得见。
       *
       * 🔴 2026-11-03 再改一处（同一件事，换了机制）：环从 `outline` 换成了 `box-shadow`
       * （WebKit 的 `outline` 不跟随 `border-radius`）。所以这里不再量 `outline-*`，
       * 而是用共用判据 `./focus-ring`：两种形态都认，环宽仍必须等于全局那条 token。
       * 原来的 `expect(appearance.shadow).toBe('none')`（"输入框一点阴影都不许画"）
       * 也随之过期 —— 阴影现在是**环本身**。它防的事改成：除了环公式那一种形状
       * （`0 0 0 Npx`），不许出现任何带偏移/模糊的装饰投影。
       */
      const appearance = await input.evaluate(el => {
        const s = getComputedStyle(el);
        const ringProbe = document.createElement('span');
        ringProbe.style.cssText = 'position:absolute;visibility:hidden;color:var(--ht-color-ring)';
        document.body.appendChild(ringProbe);
        const ringColor = getComputedStyle(ringProbe).color;
        ringProbe.remove();
        return {
          outline: s.outlineWidth,
          outlineStyle: s.outlineStyle,
          outlineColor: s.outlineColor,
          outlineOffset: s.outlineOffset,
          ring: getComputedStyle(document.documentElement).getPropertyValue('--ht-border-width-thick').trim(),
          border: s.borderTopWidth,
          borderColor: s.borderTopColor,
          boxShadow: s.boxShadow,
          caret: s.caretColor,
          backgroundColor: s.backgroundColor,
          ringColor,
        };
      });
      const ring = visibleFocusRing(appearance);
      expect(
        ring,
        `焦点环不见了 ⇒ 键盘用户看不出焦点在哪（WCAG 2.4.7）。判据接受 outline 与 box-shadow `
          + `两种形态，读数 ${JSON.stringify(appearance)}`,
      ).not.toBeNull();
      expect(ring!.widthPx, '焦点环宽度必须等于全局那条 token').toBe(Number.parseFloat(appearance.ring));
      expect(
        decorativeShadowLayers(appearance.boxShadow),
        '输入框上出现了焦点环以外的装饰投影（环公式只有 `0 0 0 Npx` 这一种形状）',
      ).toEqual([]);
      expect(appearance.border === '0px' || appearance.borderColor === 'rgba(0, 0, 0, 0)').toBe(true);
      await input.press('ArrowDown');
      await page.screenshot({ path: `${out}/search-${width}-${theme}.png` });
      await input.press('Escape');
      await expect(input).toHaveCount(0);
      await switchView(page, '日历');
      await expect(page.getByTestId('detail-pane-toggle')).toHaveCount(0);
      const toggle = page.getByTestId('calendar-sidebar-toggle');
      if (await toggle.isVisible()) {
        const box = await toggle.boundingBox();
        expect(box!.width).toBeLessThanOrEqual(48);
      }
      const cells = page.locator('[data-testid^="calendar-cell-"][role="button"]');
      const rects = await cells.evaluateAll(nodes => nodes.map(n => {
        const r = n.getBoundingClientRect();
        return { x:r.x, y:r.y, right:r.right, bottom:r.bottom };
      }));
      expect(rects.length).toBeGreaterThanOrEqual(28);
      for(let i=1;i<rects.length;i++) {
        const a=rects[i-1]!, b=rects[i]!;
        if(Math.abs(a.y-b.y)<1) expect(Math.abs(b.x-a.right)).toBeLessThan(1);
        else expect(Math.abs(b.y-a.bottom)).toBeLessThan(1);
      }
      await page.screenshot({ path: `${out}/calendar-${width}-${theme}.png` });
      const overflow = await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth+1);
      expect(overflow).toBe(false);
      readout.push({theme,width,appearance,calendarCells:rects.length,overflow});
    }
  }
  await writeFile(`${out}/readout.json`, JSON.stringify(readout,null,2));
});
