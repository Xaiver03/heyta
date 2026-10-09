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

// 真实的 `default` **与 `granted`** 两态只存在于有头 Chromium。原先这里只写了 `default`，
// 2026-10-09 无头那一趟把它照出来了：`granted` 档设完权限后回读 `Notification.permission`
// 得到的是 `denied`（`report.json` 里 `mode:'granted'` 那 4 格 `permission:'denied'`、
// granted 卡 0 张），`allPermissionStatesRendered` 因此判假红。⇒ 无头那一档取三态，
// 跳过的两态如实写进 report，而不是让五档 `.every` 对着空集合假装齐了。
// 有头 = 会开一个抢前台的窗口（AGENTS §6.2 规定二），所以它必须是显式 opt-in。
const HEADED = process.env.HEYTA_RESPONSIVE_HEADED !== '0';
const HEADLESS_SKIPPED = ['default', 'granted'];
const reminderModes = HEADED
  ? ['default', 'granted', 'denied', 'unsupported', 'error']
  : ['denied', 'unsupported', 'error'];
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

/**
 * 选设置浮层里的某一组。
 *
 * 🔴 **两种形状都要认**：HEAD 的导航是 `<a class="ht-settings__nav-link" href="#settings-group-x">`
 * （长页面 + 锚点跳转），而那笔未提交的两栏设置 IA 把它换成
 * `button[aria-controls="settings-group-x"]` + 一次只显示一组。原先这里只写后者，
 * 于是这枚**已入库**的装置在干净检出上定位器恒空、死在第一次点击（2026-10-09 现量：
 * `git show HEAD:apps/web/src/App.tsx | grep -c aria-controls` = 0）。
 * ⚠️ 找不到就响亮失败，不静默继续 —— 否则下面的截图会全对着同一屏拍，而 `.every`
 * 那类判据对空集合是真（同一形状见文件末尾那条 `everyCaseCoversEverySelectedMode`）。
 */
async function openGroup(page, group) {
  await openSettings(page);
  const link = page.locator(
    `button.ht-settings__nav-link[aria-controls="settings-group-${group}"],` +
    ` a.ht-settings__nav-link[href="#settings-group-${group}"]`,
  );
  const found = await link.count();
  if (found !== 1) {
    throw new Error(`设置导航里「${group}」那一档命中 ${found} 枚（应为 1）：button[aria-controls] 与 a[href="#…"] 两种形状各查了一次`);
  }
  await link.first().click();
  const navLabel = (await link.first().innerText()).trim();
  const section = page.locator(`#settings-group-${group}`);
  await section.waitFor({ state: 'visible', timeout: 15_000 });
  // 落定之后再拍：等**浮层自己**那条入场淡入跑完，而不是睡固定毫秒 ——
  // 动画中途按的截图会把下层视图叠进来，看着像文字压文字的排版事故（仓里
  // `waitForOverlaySettled` 的注释记着同一前科）。
  await page.evaluate(async () => {
    const sheet = document.querySelector('[data-testid="settings-sheet"]');
    await Promise.all((sheet ? sheet.getAnimations() : []).map((a) => a.finished.catch(() => undefined)));
  });
  return navLabel;
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

/**
 * 明暗 × 视口下把「个人资料」与「账号与安全」各拍一张，并记下这一组的标题、
 * 文本量与几何。加这一趟的理由是覆盖表实测出来的洞：
 * `apps/web/evidence/account-suite/` 那 11 张里带 dark 命名的 **0 张**，
 * `assistant/` 7 张里 1 张 —— 而本轮的验收要求是"实际验收深浅主题"。
 * 这枚装置是本线的，补这两组不需要动别人在写的 spec。
 */
async function captureGroup(browser, spec, group) {
  const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, locale: 'zh-CN' });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('heyta.locale', 'zh-CN'));
  await page.goto(`${ORIGIN}/?lang=zh-CN`);
  await decidePrivacy(page);
  if (spec.theme === 'dark') await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  const navLabel = await openGroup(page, group);
  const facts = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const title = el?.querySelector('.ht-settings__group-title, h2, h3') ?? null;
    const r = el?.getBoundingClientRect();
    return {
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      theme: document.documentElement.dataset.theme ?? 'light',
      title: title?.textContent?.trim() ?? null,
      box: r ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : null,
      textLength: (el?.innerText ?? '').trim().length,
      // 这一组里可交互控件的枚数。判"空壳分组"用的就是它 —— 比"文本长度 > 某个我拍的数"硬：
      // 未登录时「账号与安全」整组只有一句门禁文案（实测 33 字），任何字面阈值都会把
      // **正常的一屏**判成缺陷，而那才是这条判据该回答的问题（这一组能不能被操作）。
      interactive: el ? el.querySelectorAll('button, a[href], input').length : 0,
    };
  }, `settings-group-${group}`);
  await page.screenshot({ path: `${OUT}/${spec.theme}-${spec.width}-${group}.png`, fullPage: true });
  await context.close();
  return { theme: spec.theme, width: spec.width, group, navLabel, facts };
}

// Headed Chromium is required for the real `default` notification state; headless
// Chromium coerces notifications to `denied` even after Browser.setPermission.
const browser = await chromium.launch({ headless: !HEADED });
const reminders = [];
for (const spec of cases) {
  for (const mode of reminderModes) reminders.push(await captureReminder(browser, spec, mode));
}
const data = [];
for (const spec of cases) data.push(await dataJourney(browser, spec));
const sweepGroups = ['profile', 'account'];
const groups = [];
for (const spec of cases) for (const group of sweepGroups) groups.push(await captureGroup(browser, spec, group));
await browser.close();

const report = {
  origin: ORIGIN,
  carrier: {
    headless: !HEADED,
    reminderModes,
    skippedReminderModes: HEADED ? [] : HEADLESS_SKIPPED,
    skipReason: HEADED
      ? null
      : 'default 与 granted 两态在无头 Chromium 里都会退化成 denied（granted 那一格是 2026-10-09 无头趟实测出来的），而无头是不抢前台的唯一一档（AGENTS §6.2 规定二）',
  },
  cases,
  reminders,
  data,
  sweepGroups,
  groups,
  assertions: {
    noHorizontalOverflow: [...reminders.map((x) => x.facts), ...data.map((x) => x.before)].every((x) => x.documentScrollWidth <= x.documentClientWidth + 1),
    allPermissionStatesRendered: reminders.every((x) => x.mode === 'default' ? x.statuses.request : x.mode === 'granted' ? x.statuses.granted : x.mode === 'denied' ? x.statuses.denied : x.mode === 'unsupported' ? x.statuses.unsupported : x.statuses.failed),
    dataFailurePreserved: data.every((x) => x.failurePreserved.summaryVisible && x.failurePreserved.refusalVisible && x.failurePreserved.panelVisible),
    existingDataRefusedWithoutLoss: data.every((x) => x.existingTaskStillVisible && x.refusedExisting.length > 0),
    cancelPreserved: data.every((x) => x.cancelPreserved),
    // 漏跑一态/一个视口不会让上面任何一条变红（`.every` 对空集合是真），所以覆盖本身要单独钉。
    everyCaseCoversEverySelectedMode: cases.every((spec) =>
      reminderModes.every((mode) =>
        reminders.some((x) => x.theme === spec.theme && x.width === spec.width && x.mode === mode))),
    // ── 明暗 × 视口下「个人资料 / 账号与安全」两组（补 account-suite 零暗色那个洞）──
    everyCaseCoversEverySweepGroup: cases.every((spec) =>
      sweepGroups.every((group) =>
        groups.some((x) => x.theme === spec.theme && x.width === spec.width && x.group === group))),
    groupSweepThemeApplied: groups.every((x) => x.facts.theme === x.theme),
    groupSweepTitleMatchesNav: groups.every((x) => Boolean(x.facts.title) && x.facts.title === x.navLabel),
    groupSweepActionable: groups.every((x) => x.facts.interactive >= 1),
    groupSweepNoHorizontalOverflow: groups.every((x) => x.facts.documentScrollWidth <= x.facts.documentClientWidth + 1),
  },
};
await writeFile(`${OUT}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.assertions, null, 2));
if (!Object.values(report.assertions).every(Boolean)) process.exitCode = 1;
