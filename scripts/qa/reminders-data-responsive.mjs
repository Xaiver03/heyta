#!/usr/bin/env node
/**
 * 提醒权限与数据管理的真实浏览器 UX 取证。
 *
 * 这条脚本只运行 Web Vite 开发服务器，不构建端包、不接触真实账号或邮件。
 * 每个视口/主题都使用独立浏览器上下文，真实点击设置、导出、选择文件与还原。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../e2e/node_modules/@playwright/test/index.mjs';

const ORIGIN = process.env.HEYTA_RESPONSIVE_ORIGIN ?? 'http://127.0.0.1:4379';
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const OUT = resolve(process.env.HEYTA_RESPONSIVE_EVIDENCE ?? `${ROOT}/apps/web/evidence/reminders-data-responsive`);
const cases = [
  { theme: 'light', width: 390, height: 844 },
  { theme: 'dark', width: 390, height: 844 },
  { theme: 'light', width: 1440, height: 960 },
  { theme: 'dark', width: 1440, height: 960 },
];

await mkdir(OUT, { recursive: true });

async function setBrowserPermission(page, setting) {
  await page.goto(`${ORIGIN}/?lang=zh-CN`);
  await page.context().clearPermissions();
  const cdp = await page.context().newCDPSession(page);
  const { targetInfo } = await cdp.send('Target.getTargetInfo');
  await cdp.send('Browser.setPermission', {
    permission: { name: 'notifications' },
    setting,
    origin: ORIGIN,
    browserContextId: targetInfo.browserContextId,
  });
  if (setting === 'granted') await page.context().grantPermissions(['notifications'], { origin: ORIGIN });
  // Keep the CDP session attached for explicit granted/denied states. Chromium
  // rolls Browser.setPermission back to `default` when the session is detached;
  // this is why the existing permission suite retains the session for those
  // cases and detaches only the real prompt case.
  if (setting === 'prompt') await cdp.detach();
}

async function decidePrivacy(page) {
  const dialog = page.getByTestId('privacy-consent-dialog');
  const shown = await dialog.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
  if (shown) {
    await page.getByTestId('privacy-consent-local-only').click();
    await dialog.waitFor({ state: 'detached' });
  }
}

async function openSettings(page) {
  await decidePrivacy(page);
  await page.getByTestId('account-menu-avatar').click();
  await page.getByTestId('account-menu-settings').click();
  await page.getByTestId('settings-sheet').waitFor();
}

async function openGroup(page, group) {
  await openSettings(page);
  await page.locator(`button.ht-settings__nav-link[aria-controls="settings-group-${group}"]`).click();
  await page.waitForTimeout(120);
}

async function layoutFacts(page, testId) {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    const sheet = document.querySelector('[data-testid="settings-sheet"]');
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      panel: el ? (() => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })() : null,
      sheet: sheet ? (() => { const r = sheet.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, scrollHeight: sheet.scrollHeight, clientHeight: sheet.clientHeight }; })() : null,
    };
  }, testId);
}

async function captureReminder(browser, spec, mode) {
  const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, locale: 'zh-CN' });
  const page = await context.newPage();
  await page.addInitScript((theme) => localStorage.setItem('heyta.locale', 'zh-CN'), spec.theme);
  if (mode === 'unsupported') {
    await page.addInitScript(() => Object.defineProperty(window, 'Notification', { configurable: true, value: undefined }));
  } else if (mode === 'error') {
    await page.addInitScript(() => {
      class SimulatedNotification { static permission = 'default'; static requestPermission() { return Promise.reject(new Error('simulated')); } }
      Object.defineProperty(window, 'Notification', { configurable: true, value: SimulatedNotification });
    });
  }
  if (mode === 'granted' || mode === 'denied') {
    await setBrowserPermission(page, mode);
    await page.reload();
    // Re-apply after the app's first boot. Chromium keeps the context-level
    // decision, while the app refreshes its own panel state on this reload.
    if (mode === 'granted') {
      await page.context().grantPermissions(['notifications'], { origin: ORIGIN });
    } else {
      const cdp = await page.context().newCDPSession(page);
      const { targetInfo } = await cdp.send('Target.getTargetInfo');
      await cdp.send('Browser.setPermission', {
        permission: { name: 'notifications' }, setting: 'denied', origin: ORIGIN,
        browserContextId: targetInfo.browserContextId,
      });
    }
    await page.reload();
  } else if (mode === 'default') {
    await setBrowserPermission(page, 'prompt');
  } else await page.goto(`${ORIGIN}/?lang=zh-CN`);
  await decidePrivacy(page);
  if (spec.theme === 'dark') await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await openGroup(page, 'appearance');
  const panel = page.getByTestId('reminder-notify-panel');
  await panel.waitFor();
  // The appearance group is intentionally long. Bring the actual reminder
  // card into the viewport before the visual capture; otherwise a full-page
  // sheet screenshot mostly shows the section header and hides the subject of
  // this check below the fold.
  await panel.scrollIntoViewIfNeeded();
  const facts = await layoutFacts(page, 'reminder-notify-panel');
  const statuses = await page.evaluate(() => ({
    granted: Boolean(document.querySelector('[data-testid="reminder-notify-granted"]')),
    denied: Boolean(document.querySelector('[data-testid="reminder-notify-denied"]')),
    unsupported: Boolean(document.querySelector('[data-testid="reminder-notify-unsupported"]')),
    failed: Boolean(document.querySelector('[data-testid="reminder-notify-request-failed"]')),
    request: Boolean(document.querySelector('[data-testid="reminder-notify-request"]')),
    permission: globalThis.Notification?.permission ?? 'unsupported',
  }));
  if (mode === 'error') {
    await page.getByTestId('reminder-notify-request').click();
    await page.getByTestId('reminder-notify-request-failed').waitFor();
    statuses.failed = true;
  }
  const screenshot = `${OUT}/${spec.theme}-${spec.width}-reminder-${mode}.png`;
  await page.screenshot({ path: screenshot, fullPage: true });
  await context.close();
  return { theme: spec.theme, width: spec.width, mode, statuses, facts, screenshot };
}

async function dataJourney(browser, spec) {
  const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, locale: 'zh-CN', acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('heyta.locale', 'zh-CN'));
  await page.goto(`${ORIGIN}/?lang=zh-CN`);
  await decidePrivacy(page);
  if (spec.theme === 'dark') await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  const input = page.locator('input[placeholder^="添加任务"]');
  await input.fill(`数据管理响应式验收 ${spec.theme} ${spec.width}`);
  await page.getByTestId('capture-submit').click();
  await openGroup(page, 'data');
  const panel = page.getByTestId('data-settings-panel');
  await panel.waitFor();
  const before = await layoutFacts(page, 'data-settings-panel');
  await page.screenshot({ path: `${OUT}/${spec.theme}-${spec.width}-data-before.png`, fullPage: true });

  const jsonDownload = page.waitForEvent('download');
  await page.getByTestId('export-json').click();
  const download = await jsonDownload;
  const backup = `${OUT}/${spec.theme}-${spec.width}-backup.json`;
  await download.saveAs(backup);
  const backupBody = JSON.parse(await readFile(backup, 'utf8'));
  const markdownDownload = page.waitForEvent('download');
  await page.getByTestId('export-markdown').click();
  const markdown = await markdownDownload;
  const markdownPath = `${OUT}/${spec.theme}-${spec.width}-tasks.md`;
  await markdown.saveAs(markdownPath);

  // 失败反馈必须保留已选择文件和数据管理上下文。
  const invalid = `${OUT}/${spec.theme}-${spec.width}-invalid.json`;
  await writeFile(invalid, '{ definitely not valid json');
  await page.getByTestId('import-file').setInputFiles(invalid);
  await page.getByTestId('import-run').click();
  await page.getByTestId('import-refused').waitFor();
  const failurePreserved = {
    summaryVisible: await page.getByTestId('import-file-summary').isVisible(),
    refusalVisible: await page.getByTestId('import-refused').isVisible(),
    panelVisible: await panel.isVisible(),
  };
  await page.screenshot({ path: `${OUT}/${spec.theme}-${spec.width}-data-failure-preserved.png`, fullPage: true });

  // 选择已存在任务的备份必须拒绝，且不能清空现有任务。
  await page.getByTestId('import-file').setInputFiles(backup);
  await page.getByTestId('import-run').click();
  await page.getByTestId('import-refused').waitFor();
  const refusedExisting = await page.getByTestId('import-refused').innerText();
  const existingTaskStillVisible = await page.getByText(`数据管理响应式验收 ${spec.theme} ${spec.width}`, { exact: true }).isVisible();

  // 浏览器取消文件选择不会触发 change；保留当前文件摘要作为 UX 证据。
  const beforeCancelName = await page.getByTestId('import-file-summary').innerText();
  await page.getByTestId('import-file').evaluate((input) => input.dispatchEvent(new Event('cancel', { bubbles: true })));
  const cancelPreserved = (await page.getByTestId('import-file-summary').innerText()) === beforeCancelName;
  await page.screenshot({ path: `${OUT}/${spec.theme}-${spec.width}-data-refused-existing.png`, fullPage: true });
  await context.close();
  return {
    theme: spec.theme, width: spec.width, before,
    exports: { json: backup, markdown: markdownPath, jsonEntities: backupBody.entities?.length ?? 0, opCount: backupBody.opLog?.length ?? 0 },
    failurePreserved, refusedExisting, existingTaskStillVisible, cancelPreserved,
  };
}

// Headed Chromium is required for the real `default` notification state; headless
// Chromium coerces notifications to `denied` even after Browser.setPermission.
const browser = await chromium.launch({ headless: false });
const reminders = [];
for (const spec of cases) {
  for (const mode of ['default', 'granted', 'denied', 'unsupported', 'error']) reminders.push(await captureReminder(browser, spec, mode));
}
const data = [];
for (const spec of cases) data.push(await dataJourney(browser, spec));
await browser.close();

const report = {
  origin: ORIGIN,
  cases,
  reminders,
  data,
  assertions: {
    noHorizontalOverflow: [...reminders.map((x) => x.facts), ...data.map((x) => x.before)].every((x) => x.documentScrollWidth <= x.documentClientWidth + 1),
    allPermissionStatesRendered: reminders.every((x) => x.mode === 'default' ? x.statuses.request : x.mode === 'granted' ? x.statuses.granted : x.mode === 'denied' ? x.statuses.denied : x.mode === 'unsupported' ? x.statuses.unsupported : x.statuses.failed),
    dataFailurePreserved: data.every((x) => x.failurePreserved.summaryVisible && x.failurePreserved.refusalVisible && x.failurePreserved.panelVisible),
    existingDataRefusedWithoutLoss: data.every((x) => x.existingTaskStillVisible && x.refusedExisting.length > 0),
    cancelPreserved: data.every((x) => x.cancelPreserved),
  },
};
await writeFile(`${OUT}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.assertions, null, 2));
if (!Object.values(report.assertions).every(Boolean)) process.exitCode = 1;
