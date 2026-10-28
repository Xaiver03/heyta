/**
 * P1「脏表单关闭保护」的真实浏览器判据
 * ===================================
 *
 * 主张只有一句：**有未保存输入的浮层，scrim / Esc / × 三条通道都不许静默丢内容。**
 *
 * 🔴 为什么这一格值得单独一条 spec，而不是"顺手在产品里加个 confirm()"：
 *   · 关闭策略表里原来**没有**"脏锚定层"这一类（`popover` 三条通道全 `dismiss`），
 *     所以"填一半点外面就没了"在模型层面是合法的 —— 缺的是一档，不是缺一段代码；
 *   · 草稿住在组件本地 `useState`（`packages/ui/src/capture/CaptureComposer.tsx`），
 *     卸载即丢，**没有撤销出口** ⇒ 按危险四档这是"不可逆 + 影响面小"，
 *     正确形态是先问一句，而不是事后给撤销。
 *
 * 判据形状取自计划 §P1：干净态可关（对照臂，证明新档没把空表单也拦下来）／
 * 脏态三通道只触发确认且**原值仍在**／取消确认后焦点归还原控件／选择放弃才卸载。
 *
 * ⚠️ 确认框的 testid 与文案是**契约**，不是实现细节：它复用共享的 `DangerDialog`
 *   （`testID="discard-confirm"` ⇒ 按钮是 `-cancel` / `-confirm`，
 *   「继续编辑」在安全那一侧）。不另起一套 discard 对话框是计划 §P1 明写的边界。
 */

import { expect, test, type Page } from '@playwright/test';

import { openApp, switchView } from './helpers';

/** 面板"打开了但什么都没画"这一族缺陷只能从控制台看出来，所以每条都收。 */
function watchConsole(page: Page): string[] {
  const lines: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') lines.push(`[console.error] ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    lines.push(`[pageerror] ${error.message}`);
  });
  return lines;
}

const APP_ZH = '/?lang=zh-CN';
const SHOT = (name: string): string => `../apps/web/evidence/dirty-form-guard/${name}.png`;

const CAPTURE = '[data-testid="calendar-capture"]';
const CAPTURE_INPUT = '[data-testid="capture-input"]';

/* 🔴 确认框按**无障碍名**寻址，不按 testid：共享的 `OverlayModal` 走的是
   react-native-web 自己的 `Modal`，它给内容层写 `role="dialog"` + `aria-modal`
   与 `aria-labelledby`，而 `testID` 不落 DOM（`ModalContent.js:52-54`）。
   拿无障碍名当锚还顺带钉住了另一件事：读屏用户念到的就是这句标题。 */
const DISCARD_TITLE = '放弃这次的修改？';
const discardDialog = (page: Page) => page.getByRole('dialog', { name: DISCARD_TITLE });
const keepButton = (page: Page) => page.getByRole('button', { name: '继续编辑' });
const dropButton = (page: Page) => page.getByRole('button', { name: '放弃修改' });

async function openCapture(page: Page): Promise<void> {
  await switchView(page, '日历');
  await page.locator('[data-testid^="calendar-cell-"]').first().click();
  await expect(page.locator(CAPTURE)).toBeVisible();
}

test('对照臂：没有输入的捕获浮层，Esc 仍然直接关（新档不许把空表单也拦下来）', async ({ page }) => {
  const consoleLines = watchConsole(page);
  await openApp(page, APP_ZH);
  await openCapture(page);

  await page.keyboard.press('Escape');
  await expect(page.locator(CAPTURE)).toHaveCount(0);
  expect(consoleLines, `干净态关闭期间出现控制台错误：${consoleLines.join('\n')}`).toEqual([]);
});

test('🔴 脏捕获浮层：Esc 只触发确认，浮层与原值都还在', async ({ page }) => {
  const consoleLines = watchConsole(page);
  await openApp(page, APP_ZH);
  await openCapture(page);

  await page.locator(CAPTURE_INPUT).fill('写到一半的判据');
  await page.keyboard.press('Escape');

  await expect(discardDialog(page), '脏态按 Esc 要先问「放弃修改？」').toBeVisible();
  await expect(page.locator(CAPTURE), '问的时候就该停住，不许先把浮层关掉').toBeVisible();
  await expect(page.locator(CAPTURE_INPUT)).toHaveValue('写到一半的判据');
  await page.screenshot({ path: SHOT('capture-escape-asks') });
  expect(consoleLines, `确认框期间出现控制台错误：${consoleLines.join('\n')}`).toEqual([]);
});

test('🔴 取消确认后焦点归还原控件，而不是掉进 <body>', async ({ page }) => {
  const consoleLines = watchConsole(page);
  await openApp(page, APP_ZH);
  await openCapture(page);
  await page.locator(CAPTURE_INPUT).fill('焦点要还回来的判据');
  await page.keyboard.press('Escape');
  await expect(discardDialog(page)).toBeVisible();

  await keepButton(page).click();
  await expect(discardDialog(page)).toHaveCount(0);
  await expect(page.locator(CAPTURE)).toBeVisible();
  await expect(page.locator(CAPTURE_INPUT)).toHaveValue('焦点要还回来的判据');
  await expect(page.locator(CAPTURE_INPUT), '确认框收回去之后焦点要落在原输入框').toBeFocused();
});

test('🔴 点背景（scrim）同样先问；选择放弃才卸载', async ({ page }) => {
  const consoleLines = watchConsole(page);
  await openApp(page, APP_ZH);
  await openCapture(page);
  await page.locator(CAPTURE_INPUT).fill('点背景不该丢的判据');

  await page.locator('body').click({ position: { x: 6, y: 6 } });
  await expect(discardDialog(page), '脏态点背景要先问').toBeVisible();
  await expect(page.locator(CAPTURE)).toBeVisible();
  await expect(page.locator(CAPTURE_INPUT)).toHaveValue('点背景不该丢的判据');

  await dropButton(page).click();
  await expect(discardDialog(page)).toHaveCount(0);
  await expect(page.locator(CAPTURE), '明确选了放弃才允许卸载').toHaveCount(0);
});

test('🔴 右上角 × 也走同一格确认，且确认框自己不给"绕过"出口', async ({ page }) => {
  const consoleLines = watchConsole(page);
  await openApp(page, APP_ZH);
  await openCapture(page);
  await page.locator(CAPTURE_INPUT).fill('点叉不该丢的判据');

  // 那枚 × 的无障碍名是「收起输入框」（`web.calendar.capture.close`）——
  // 用文案而不是位置寻址：这一格要的正是"用户看得见的那出口"。
  await page.getByRole('button', { name: '收起输入框' }).click();
  await expect(discardDialog(page)).toBeVisible();

  // 确认框自己是危险档：点它的背景不许等于"确认放弃"。
  await discardDialog(page).press('Escape');
  await expect(discardDialog(page), '确认框上的 Esc 等价于「继续编辑」（安全侧）').toHaveCount(0);
  await expect(page.locator(CAPTURE)).toBeVisible();
  await expect(page.locator(CAPTURE_INPUT)).toHaveValue('点叉不该丢的判据');
});

test('🔴 添加习惯：填了名称再关，也要先问一句', async ({ page }) => {
  const consoleLines = watchConsole(page);
  await openApp(page, APP_ZH);
  await switchView(page, '习惯');
  await page.getByTestId('habits-add-open').click();
  const dialog = page.getByTestId('habit-create-dialog');
  await expect(dialog).toBeVisible();

  await dialog.locator('#ht-habit-create-name').fill('只写了名字的habit');
  await page.keyboard.press('Escape');

  await expect(discardDialog(page), '习惯草稿有 12 个字段，静默丢掉是这一族里最重的一格').toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#ht-habit-create-name')).toHaveValue('只写了名字的habit');
  await page.screenshot({ path: SHOT('habit-create-asks') });

  await dropButton(page).click();
  await expect(dialog).toHaveCount(0);
});
