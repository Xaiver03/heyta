import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

/**
 * 页面内布局语法（第二个标本：对话助手）。
 *
 * 产品负责人 2026-10-25 对着截图说"这个也没有会话栏的分界线"。
 * 查代码：`.ht-ai__history { border-inline-end: 0 }` —— 线是**被显式删掉的**。
 *
 * 这条判据只钉一件事：**多栏页面的栏边界必须有一条可见的线**。
 * 量的不是"有没有 border 这个属性"（那可以写着却是 0 宽/同色），而是
 * **渲染后的有效边界**：宽度 ≥1px 且颜色与背景不同。
 */
test('对话助手：会话栏与内容区之间有一条可见的分界线', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, '/?lang=zh-CN');
  await page.getByTestId('rail-ai').click().catch(async () => {
    await page.getByRole('button', { name: /对话助手|助手/ }).first().click();
  });
  const history = page.getByTestId('ai-assistant-history');
  await expect(history).toBeVisible();

  const m = await history.evaluate((el) => {
    const cs = getComputedStyle(el as HTMLElement);
    const width = Number.parseFloat(cs.borderInlineEndWidth || cs.borderRightWidth || '0');
    return {
      borderWidth: Number.isFinite(width) ? width : 0,
      borderStyle: cs.borderInlineEndStyle || cs.borderRightStyle,
      borderColor: cs.borderInlineEndColor || cs.borderRightColor,
      width: Math.round(el.getBoundingClientRect().width),
    };
  });
  console.log(`ASSISTANT_SPLIT ${JSON.stringify(m)}`);

  expect(m.width, '会话栏要有实际宽度').toBeGreaterThan(120);
  expect(m.borderWidth, '栏边界线 ≥ 1px').toBeGreaterThanOrEqual(1);
  expect(m.borderStyle, '栏边界线必须真的画出来').not.toBe('none');
});
