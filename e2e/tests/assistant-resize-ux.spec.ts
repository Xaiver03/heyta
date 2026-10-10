import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { openApp, switchTheme } from './helpers';

const evidence = '../apps/web/evidence/assistant-responsive';

test('助手随侧栏连续拖动重排，输入区无嵌套焦点框', async ({ page }) => {
  test.setTimeout(120_000);
  await mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 1600, height: 900 });
  await openApp(page, '/?lang=zh-CN');
  const input = page.getByTestId('ai-assistant-input');
  await expect(input).toBeVisible();
  const handle = page.locator('.ht-app__detail-resizer');
  const readings = [];
  for (const theme of ['light', 'dark'] as const) {
    if (theme === 'dark') await switchTheme(page, theme);
    for (const target of [480, 416, 352, 288, 240, 320, 480]) {
      const detail = await page.getByTestId('detail-column').boundingBox();
      const grip = await handle.boundingBox();
      expect(detail).not.toBeNull();
      expect(grip).not.toBeNull();
      const x = grip!.x + grip!.width / 2;
      const y = grip!.y + grip!.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      // 连续指针移动，避免只设置 CSS 变量而遗漏真实拖拽路径。
      for (let step = 1; step <= 6; step++) {
        await page.mouse.move(x + (detail!.width - target) * step / 6, y);
        const reading = await page.locator('.ht-ai__main').evaluate((main) => {
          const bounds = main.getBoundingClientRect();
          const elements = Array.from(main.querySelectorAll<HTMLElement>(
            '.ht-ai__header, .ht-ai__composer, .ht-ai__input, .ht-ai__send-button, .ht-ai__suggestion',
          ));
          return {
            width: bounds.width,
            overflow: elements.filter((element) => {
              const rect = element.getBoundingClientRect();
              return rect.width > 0 && (rect.right > bounds.right + 1 || rect.left < bounds.left - 1);
            }).map((element) => element.className),
            documentOverflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        readings.push({ theme, target, step, ...reading });
        expect(reading.overflow).toEqual([]);
        expect(reading.documentOverflow).toBe(false);
      }
      await page.mouse.up();
      await input.click();
      await expect(input).toHaveCSS('outline-width', '0px');
      await expect(input).toHaveCSS('border-top-width', '0px');
      await page.screenshot({ path: `${evidence}/${theme}-${target}.png` });
    }
  }
  await input.fill('拖拽后草稿仍保留');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('assistant-open').click();
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('拖拽后草稿仍保留');
  await page.screenshot({ path: `${evidence}/mobile-dark.png` });
  await writeFile(`${evidence}/readout.json`, JSON.stringify(readings, null, 2));
});
