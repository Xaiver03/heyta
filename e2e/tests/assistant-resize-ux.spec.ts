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
      /*
       * 🔴 2026-10-25 改判据：这条原来断言输入框 `outline-width: 0px` + `border-top-width: 0px`，
       * 也就是"输入区一点框都不画"。那个口径**已经被一次更晚的、有据可查的无障碍决定取代**：
       * `borderless-controls.css:44-51`（2026-10-24）给**所有文本输入的键盘焦点**补回了
       * 可见焦点环，理由是两条 AA：WCAG 2.4.7（Focus Visible）与 1.4.11 的 Boundaries 一节
       * （"控件可以不画边界，但焦点指示必须够对比"）。那次改动的注释里写着它顶着"无描边"
       * 观感 —— 所以现在输入框拿到焦点**就该有** 2px 的主色环。
       *
       * 这条判据要防的事没变，只是要量的东西变了：**不许嵌套两层焦点框**
       * （输入框一层 + 外层 composer 再来一层）。所以现在量两件事：
       *   ① 输入框自己的焦点环 = 全局那一条（`--ht-border-width-thick`，2px）；
       *   ② 外层 `.ht-ai__composer` **没有** outline（层叠两层会在拐角处露双线）。
       */
      const ring = await page.evaluate(() => {
        const inputEl = document.querySelector('[data-testid="ai-assistant-input"]');
        const composer = inputEl?.closest('.ht-ai__composer') ?? null;
        if (inputEl === null || composer === null) return null;
        const inputStyle = getComputedStyle(inputEl);
        const composerStyle = getComputedStyle(composer);
        return {
          inputOutlineWidth: inputStyle.outlineWidth,
          inputOutlineStyle: inputStyle.outlineStyle,
          // ⚠️ 别用 `outline-width` 判"有没有画框"：`outline-style` 为 none 时
          //    Chrome 仍把 `outline-width` 报成初始值 `medium`（= 3px），
          //    于是"没画"会被读成"画了一条 3px"（这一条我当场踩了）。
          composerOutlineStyle: composerStyle.outlineStyle,
          composerOutlineWidth: composerStyle.outlineWidth,
          focused: document.activeElement === inputEl,
          ringToken: getComputedStyle(document.documentElement).getPropertyValue('--ht-border-width-thick').trim(),
        };
      });
      expect(ring, '量不到输入框或 composer ⇒ 这一条没有基准').not.toBeNull();
      expect(ring!.focused, '输入框没拿到焦点 ⇒ 焦点环这一条无从谈起').toBe(true);
      expect(
        ring!.inputOutlineWidth,
        '输入框的焦点环不见了 ⇒ 键盘用户看不出焦点在哪（WCAG 2.4.7）',
      ).toBe(ring!.ringToken);
      expect(
        ring!.inputOutlineStyle,
        '焦点环被改成 none ⇒ 等于没画',
      ).not.toBe('none');
      expect(
        ring!.composerOutlineStyle,
        '外层 composer 也画了 outline ⇒ 输入区出现嵌套双框（这条判据防的就是它）',
      ).toBe('none');
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
