import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { addTask, openApp, switchTheme } from './helpers';

const OUT = '../apps/web/evidence/data-transfer-final';
async function openData(page: Page) {
  await page.getByTestId('account-menu-avatar').click();
  await page.getByTestId('account-menu-settings').click();
  await page.locator('[aria-controls="settings-group-data"]').click();
  await expect(page.getByTestId('bulk-toolbar')).toHaveCount(0);
  await expect(page.getByTestId('task-sort')).toHaveCount(0);
}

for (const theme of ['light', 'dark'] as const) {
  test(`真实下载、非空拒绝与空库还原 ${theme}`, async ({ page, browser, baseURL }) => {
    await mkdir(OUT, { recursive: true });
    const errors: string[] = [];
    const track = (p: Page) => {
      p.on('pageerror', e => errors.push(e.message));
      p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    };
    track(page);
    const title = `数据往返验收 ${theme}`;
    await openApp(page, '/?lang=zh-CN');
    if (theme === 'dark') await switchTheme(page, theme);
    await addTask(page, title);
    await openData(page);
    const backup = `${OUT}/backup-${theme}.json`;
    await rm(backup, { force: true });
    const pending = page.waitForEvent('download');
    await page.getByTestId('export-json').click();
    const download = await pending;
    await download.saveAs(backup);
    const body = JSON.parse(await readFile(backup, 'utf8'));
    await page.screenshot({ path: `${OUT}/export-${theme}.png`, fullPage: true });
    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toMatch(/\.json$/);
    expect(JSON.stringify(body.entities)).toContain(title);
    expect(body.opLog.length).toBeGreaterThan(0);

    const markdownPending = page.waitForEvent('download');
    await page.getByTestId('export-markdown').click();
    const markdown = await markdownPending;
    const mdPath = `${OUT}/tasks-${theme}.md`;
    await markdown.saveAs(mdPath);
    expect(await readFile(mdPath, 'utf8')).toContain(title);

    // 同一备份不能覆盖已有本地任务。
    await page.getByTestId('import-file').setInputFiles(backup);
    await page.getByTestId('import-run').click();
    await page.getByTestId('import-refused').waitFor();
    await page.getByTestId('import-refused').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/refused-${theme}.png`, fullPage: true });
    await expect(page.getByTestId('import-success')).toHaveCount(0);

    // 真正独立的浏览器存储，不能清原库后把同一个页面当第二台设备。
    const targetContext = await browser.newContext({ baseURL, locale: 'zh-CN' });
    const target = await targetContext.newPage();
    track(target);
    try {
      await openApp(target, '/?lang=zh-CN');
      if (theme === 'dark') await switchTheme(target, theme);
      await openData(target);
      await target.getByTestId('import-file').setInputFiles(backup);
      await target.getByTestId('import-run').click();
      await target.getByTestId('import-success').waitFor();
      await target.getByTestId('import-success').scrollIntoViewIfNeeded();
      await target.screenshot({ path: `${OUT}/restored-${theme}.png`, fullPage: true });
      await expect(target.getByTestId('import-refused')).toHaveCount(0);
      await target.getByTestId('settings-sheet-close').click();
      await target.reload();
      await expect(target.getByText(title, { exact: true })).toBeVisible();
      await target.screenshot({ path: `${OUT}/persisted-${theme}.png` });
      await writeFile(`${OUT}/result-${theme}.json`, JSON.stringify({
        downloaded: download.suggestedFilename(), opCount: body.opLog.length,
        nonemptyRefused: true, restoredAndReloaded: true, consoleErrors: errors,
      }, null, 2));
      expect(errors).toEqual([]);
    } finally { await targetContext.close(); }
  });
}
