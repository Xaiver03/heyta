import { mkdir, writeFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';
import { visibleFocusRing } from './focus-ring';
import { openApp, switchTheme } from './helpers';

/** 打开页头那枚 `⋯` —— 助手入口在 2026-11-02 第三刀搬进了它里面。 */
async function openTaskMenu(page: Page): Promise<void> {
  const trigger = page.getByTestId('task-menu-open');
  await expect(trigger, '任务视图页头必须有一枚 ⋯（助手入口住在里面）').toBeVisible();
  await trigger.click();
  await expect(page.getByTestId('task-menu')).toBeVisible();
}

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
       *   ② 外层 `.ht-ai__composer` **没有**第二枚环（层叠两层会在拐角处露双线）。
       *
       * 🔴 2026-11-03 改机制（不是放宽）：输入类控件的环从 `outline` 换成了 `box-shadow`
       * —— WebKit 的 `outline` 不跟随 `border-radius`，产品负责人看着这个对话框问
       * 「为什么这个对话框还是没有圆角」。环还在画面上，只是不再画在 `outline` 上，
       * 所以①改成共用判据 `./focus-ring`，环宽仍判"等于全局那条 token"；
       * ②从"没有 outline"扩到"**两种形态都不许有环**"（否则换成 box-shadow 之后，
       * 外面再套一层就查不出来了 —— 那等于把这条判据的牙齿拔掉）。
       */
      const ring = await page.evaluate(() => {
        const inputEl = document.querySelector('[data-testid="ai-assistant-input"]');
        const composer = inputEl?.closest('.ht-ai__composer') ?? null;
        if (inputEl === null || composer === null) return null;
        const inputStyle = getComputedStyle(inputEl);
        const composerStyle = getComputedStyle(composer);
        // 把 token 解析成具体颜色（`--ht-color-ring` 是 `var(...)` 链，直接读 custom property 是空串）。
        const colorProbe = document.createElement('span');
        colorProbe.style.cssText = 'position:absolute;visibility:hidden;color:var(--ht-color-ring)';
        document.body.appendChild(colorProbe);
        const ringColor = getComputedStyle(colorProbe).color;
        colorProbe.remove();
        return {
          input: {
            outlineStyle: inputStyle.outlineStyle,
            outlineWidth: inputStyle.outlineWidth,
            outlineColor: inputStyle.outlineColor,
            outlineOffset: inputStyle.outlineOffset,
            boxShadow: inputStyle.boxShadow,
            backgroundColor: inputStyle.backgroundColor,
            ringColor,
          },
          composer: {
            outlineStyle: composerStyle.outlineStyle,
            outlineWidth: composerStyle.outlineWidth,
            outlineColor: composerStyle.outlineColor,
            outlineOffset: composerStyle.outlineOffset,
            boxShadow: composerStyle.boxShadow,
            backgroundColor: composerStyle.backgroundColor,
            ringColor,
          },
          focused: document.activeElement === inputEl,
          ringToken: getComputedStyle(document.documentElement).getPropertyValue('--ht-border-width-thick').trim(),
        };
      });
      expect(ring, '量不到输入框或 composer ⇒ 这一条没有基准').not.toBeNull();
      expect(ring!.focused, '输入框没拿到焦点 ⇒ 焦点环这一条无从谈起').toBe(true);
      const inputRing = visibleFocusRing(ring!.input);
      expect(
        inputRing,
        `输入框的焦点环不见了 ⇒ 键盘用户看不出焦点在哪（WCAG 2.4.7）：读数 ${JSON.stringify(ring!.input)}`,
      ).not.toBeNull();
      expect(
        inputRing!.widthPx,
        `输入框的焦点环不是全局那一条（${String(inputRing!.widthPx)}px ≠ ${ring!.ringToken}）`,
      ).toBe(Number.parseFloat(ring!.ringToken));
      expect(
        visibleFocusRing(ring!.composer),
        `外层 composer 也画了一枚焦点环（${ring!.composer.outlineStyle} / ${ring!.composer.boxShadow}）`
          + ' ⇒ 输入区出现嵌套双框（这条判据防的就是它）',
      ).toBeNull();
      await expect(input).toHaveCSS('border-top-width', '0px');
      await page.screenshot({ path: `${evidence}/${theme}-${target}.png` });
    }
  }
  await input.fill('拖拽后草稿仍保留');
  await page.setViewportSize({ width: 390, height: 844 });
  await openTaskMenu(page);
  await page.getByTestId('assistant-open').click();
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('拖拽后草稿仍保留');
  await page.screenshot({ path: `${evidence}/mobile-dark.png` });
  await writeFile(`${evidence}/readout.json`, JSON.stringify(readings, null, 2));
});
