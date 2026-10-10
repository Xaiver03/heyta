/* web 端真导出（批五判据的输入）
 * ======================================
 * 真浏览器 + 真服务端：测试账号 → 凭据 → 建 3 任务/1 清单/1 标签 →
 * ExportPanel 导出 JSON 下载到指定路径。
 * 用法：node restore-export.cjs <email> <password> <token> <out.json>
 * 前置：vite 已在 WEB_BASE（默认 127.0.0.1:4322）、服务端 TEST_MODE。
 */
const { chromium } = require('@playwright/test');

const BASE = process.env.WEB_BASE || 'http://127.0.0.1:4322';
const SERVER = process.env.SERVER_URL || 'http://127.0.0.1:3000';
const [, , EMAIL, PASSWORD, TOKEN, OUT] = process.argv;

/*
 * 打开设置浮层：头像菜单 → 设置。
 *
 * 🔴 「设置」不在 rail 上，它在头像菜单里；这里只走 testID（语言中立），
 * 不再用 `[aria-haspopup="menu"]` + 「设置」菜单项名那两条子串匹配 ——
 * 同一份到达方式在本脚本里出现两遍就会漂移。
 */
async function openSettingsSheet(page) {
  await page.locator('[data-testid="account-menu-avatar"]').click();
  await page.waitForTimeout(500);
  await page.locator('[data-testid="account-menu-settings"]').click();
  await page.waitForTimeout(800);
}

/*
 * 进 **设置 → 同步** 那一节（工单 H9 第 3 刀，2026-10-06 之后的形状）。
 * 「同步设置」不再是 rail 齿轮点开的同级对话框，而是设置浮层里的**一节**：
 * 那是个带 aria-label 的 `<section>` ⇒ 可访问角色是 **region**，所以旧的
 * `[aria-label="同步设置"]`（点齿轮）与 `getByRole('dialog', {name:'同步设置'})`
 * 都不再命中。这一节住在可滚动的长列表里 ⇒ 必须先滚到它才点得到。
 * 本脚本自己的 helper，不去借 `e2e/tests/helpers.ts`（不同 testDir、不同 config）。
 */
async function openSyncSection(page) {
  await openSettingsSheet(page);
  const section = page.locator('[data-testid="sync-settings-panel"]');
  await section.waitFor({ state: 'visible', timeout: 30000 });
  await section.scrollIntoViewIfNeeded();
  return section;
}

/** 收掉设置浮层（它自己的 ✕；「关闭同步设置」那颗随 H9 第 3 刀一起没了）。 */
async function closeSettingsSheet(page) {
  await page.locator('[data-testid="settings-sheet-close"]').click();
  await page.waitForTimeout(600);
}

async function main() {
  if (!EMAIL || !PASSWORD || !TOKEN || !OUT) throw new Error('usage: node restore-export.cjs <email> <password> <token> <out.json>');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 120)));

  await page.goto(BASE + '/?lang=zh-CN', { waitUntil: 'networkidle' });
  const agree = page.getByRole('button', { name: /同意并联网/ });
  if (await agree.count()) { await agree.click(); await page.waitForTimeout(400); }
  await page.waitForSelector('[data-testid="task-list"]', { timeout: 30000 });
  console.log('STEP app-open OK');

  // 凭据：设置 → 同步 那一节（挂载时按已存配置播种，填完点「保存并同步」）
  const syncSection = await openSyncSection(page);
  await syncSection.getByLabel('服务端地址').fill(SERVER);
  await syncSection.getByLabel('访问令牌').fill(TOKEN);
  await syncSection.getByLabel('端到端加密口令').fill('e2ee-passphrase');
  await syncSection.getByRole('button', { name: /保存并同步/ }).click();
  await page.waitForTimeout(1500);
  // 🔴 保存不再关那一层（它现在就在设置浮层里），所以必须自己走浮层的出口 ✕。
  // 旧写法在这里按 Escape —— 那时它是"关掉同步设置对话框"；现在 Esc 收的是**设置浮层**，
  // 语义变了，而 ✕ 是那一层自己的、看得见的那个出口（§7 第 80 条：Esc 在输入框聚焦时
  // 会被 RN-web 的 stopPropagation 吃掉，别依赖它）。
  await closeSettingsSheet(page);
  console.log('STEP credentials OK');

  // 建 3 个任务
  const composer = page.locator('input[placeholder^="添加任务"]');
  for (const name of ['backup-task-1', 'backup-task-2', 'backup-task-3']) {
    await composer.fill(name);
    await composer.press('Enter');
    await page.waitForTimeout(400);
  }
  console.log('STEP tasks OK');

  // 建 1 个清单与 1 个标签（ProjectsPanel 的 + / 输入 / 提交）
  await page.locator('[aria-label="新建清单"]').click();
  await page.locator('#ht-category-create-name').fill('backup-list-1');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  await page.locator('[aria-label="新建标签"]').click();
  await page.locator('#ht-category-create-name').fill('backup-tag-1');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  console.log('STEP list+tag OK');

  // 打开设置 sheet：头像菜单 → 设置（与上面凭据那一段同一条到达路径）
  await openSettingsSheet(page);

  // 导出面板：下载 JSON
  await page.locator('[data-testid="export-panel"]').scrollIntoViewIfNeeded();
  const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
  await page.locator('[data-testid="export-json"]').click();
  const download = await downloadPromise;
  await download.saveAs(OUT);
  console.log('STEP export saved to', OUT);
  await browser.close();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', String(e).slice(0, 300));
    process.exit(1);
  });
