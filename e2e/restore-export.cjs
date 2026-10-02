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

  // 凭据：同步设置对话框（打开时对齐已存配置，填写后「保存并同步」）
  await page.locator('[aria-label="同步设置"]').first().click();
  await page.getByLabel('服务端地址').fill(SERVER);
  await page.getByLabel('访问令牌').fill(TOKEN);
  await page.getByLabel('端到端加密口令').fill('e2ee-passphrase');
  await page.getByRole('button', { name: /保存并同步/ }).click();
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
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
  await page.locator('[aria-label="新清单名称"]').fill('backup-list-1');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  await page.locator('[aria-label="新建标签"]').click();
  await page.locator('[aria-label="新标签名称"]').fill('backup-tag-1');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  console.log('STEP list+tag OK');

  // 打开设置 sheet：头像菜单 → 设置
  await page.locator('[aria-haspopup="menu"]').first().click();
  await page.waitForTimeout(500);
  await page.getByRole('menuitem', { name: '设置' }).first().click();
  await page.waitForTimeout(800);

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
