import { expect, test, type Page } from '@playwright/test';

import {
  openApp,
  openSettingsSheet,
  selectSettingsSection,
  switchTheme,
  waitForOverlaySettled,
} from './helpers';

/**
 * 「重置这一组 AI 设置」这一格的真实浏览器读数（全局 UX 线 P2 那格"未判定"的裁决）
 * ============================================================================
 *
 * 计划 §P2 边界把这格登记成"未判定"而不是"已合规"：它的门禁 R1/R2 都过（无 ×、主按钮 danger），
 * 但**没问过那张表** —— 该不该升成模态表态只取决于一个当时没写进任何文档的判断：
 * 清掉用户填进来的 API 密钥算不算 `destroysIrrecoverableResource`。
 * 2026-10-29 判了：**算**（依据三条都在界面上写着，正文在 `resetAiDanger.ts`）
 * ⇒ `alert` 档 ⇒ 需要模态表态 ⇒ 这一层换吃 `DangerConfirmDialog`。
 *
 * 于是这一格要量的不是"长得像不像"，是**四句只有真浏览器答得了**的：
 *
 *   · 它真的是模态层（`role=dialog` + `aria-modal` + 有可及的名字）；
 *   · **初始焦点在安全侧那枚「取消」上** —— 回车的第一下应当是"不清"；
 *     这一句同时是那条裁决的锚：把 `destroysIrrecoverableResource` 改回 `false`
 *     ⇒ 那一档不再要求模态表态 ⇒ 焦点不接管 ⇒ 这条红；
 *   · 点背景**不关**（表里 `danger-confirm.scrim = deny`）；
 *   · Esc = **取消**（等价于按安全侧那枚），而两种都不许动到设置一个字节。
 *
 * ⚠️ "什么都没清"这一句为什么有牙：全新设备上 `localStorage` 里那格本来是 `null`，
 *    而确认那一下会写进一份默认值 ⇒ 只要 Esc 或背景被接错成"确认"，
 *    前后两个读数就不相等。不需要先造一份非默认设置才有分辨力。
 */

const EVIDENCE = '../apps/web/evidence/ai-reset-danger';
const AI_SETTINGS_KEY = 'heyta.ai.settings';

const stored = (page: Page): Promise<string | null> =>
  page.evaluate((key) => window.localStorage.getItem(key), AI_SETTINGS_KEY);

async function openResetConfirm(page: Page): Promise<void> {
  await openSettingsSheet(page);
  await selectSettingsSection(page, 'ai');
  const trigger = page.getByTestId('reset-ai-settings');
  await expect(trigger, 'AI 设置里没有那枚重置入口').toBeVisible();
  await expect(page.getByTestId('reset-ai-confirm'), '没点第一就不该有确认层').toHaveCount(0);
  await trigger.click();
  await waitForOverlaySettled(page, 'reset-ai-confirm');
}

for (const theme of ['light', 'dark'] as const) {
  test(`AI 重置确认 ${theme}·1440：模态层、清单点名、焦点在安全侧、背景不关、Esc 等价取消`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page, '/?lang=zh-CN');
    if (theme === 'dark') await switchTheme(page, 'dark');

    const before = await stored(page);
    await openResetConfirm(page);

    const dialog = page.getByTestId('reset-ai-confirm');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(dialog, '这一格按 alert 档 ⇒ 必须是模态表态，不是就地一行').toHaveAttribute(
      'aria-modal',
      'true',
    );
    const namedBy = await dialog.getAttribute('aria-labelledby');
    expect(namedBy, '模态层没有可及的名字').toBeTruthy();
    await expect(page.locator(`#${namedBy}`)).not.toBeEmpty();

    // 说清代价要说得出**名字**：一句"确定要重置吗"等于什么都没说。
    const items = dialog.locator('li');
    expect(await items.count(), '要逐条列出会丢的东西').toBeGreaterThanOrEqual(5);
    const listed = (await items.allTextContents()).join(' ');
    for (const word of ['端点', '路由', '出境', '密钥', '开关']) {
      expect(listed, `代价清单里要点名「${word}」`).toContain(word);
    }

    await expect(
      dialog.getByTestId('reset-ai-confirm-cancel'),
      '初始焦点必须在安全侧那枚「取消」上（回车的第一下应当是"不清"）',
    ).toBeFocused();

    await page.screenshot({ path: `${EVIDENCE}/confirm-${theme}-1440.png` });

    // ① 误点背景：这一层不许被关掉，设置也不许多出一份默认值。
    await page.getByTestId('reset-ai-confirm-scrim').click({ position: { x: 12, y: 12 } });
    await expect(dialog, '点背景把危险确认关掉了').toBeVisible();
    expect(await stored(page), '点背景那一下已经在动设置了').toBe(before);

    // ② Esc = 取消（安全侧那一个动作）：层收回，一个字节都不许变。
    await page.keyboard.press('Escape');
    await expect(dialog, 'Esc 应当等价于取消').toHaveCount(0);
    expect(await stored(page), '取消那一下不许清任何东西').toBe(before);
  });
}
