#!/usr/bin/env node
/**
 * Real WebKit rail evidence runner for S9-82.
 *
 * Uses a persistent WebKit profile because the app's production web backend is
 * OPFS SQLite; an ephemeral Playwright context exposes storage APIs but cannot
 * open the OPFS directory. This runner does not mock storage or network data.
 * Start Vite separately, for example on port 4369, then run this file.
 */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const { webkit } = require(join(repoRoot, 'e2e/node_modules/@playwright/test'));

const baseUrl = process.env['HEYTA_RAIL_WEBKIT_URL'] ?? 'http://127.0.0.1:4369';
const evidenceDir = join(repoRoot, 'apps/web/evidence/rail-webkit-s9-82');
const profileDir = process.env['HEYTA_WEBKIT_PROFILE'] ?? '/tmp/heyta-webkit-persistent-app-profile';
const reportPath = join(evidenceDir, 'rail-webkit-s9-82.json');
const viewportWide = { width: 1440, height: 900 };

function fail(message) {
  throw new Error(message);
}

function finiteRect(rect) {
  return rect !== null && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite);
}

async function waitForApp(page) {
  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForSelector('input[placeholder^="添加任务"]', { timeout: 15_000 });
  const consent = page.getByTestId('privacy-consent-dialog');
  if (await consent.isVisible().catch(() => false)) {
    await page.getByTestId('privacy-consent-local-only').click();
    await consent.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);
  }
  const errorScreen = page.locator('[role="alert"][data-testid="error-screen"]');
  if (await errorScreen.count()) fail(`storage error screen: ${await errorScreen.innerText()}`);
}

async function switchTheme(page, target) {
  const current = await page.locator('html').getAttribute('data-theme');
  if (current === target) return;
  await page.getByTestId('account-menu-avatar').click();
  await page.getByTestId('account-menu-settings').click();
  const sheet = page.getByTestId('settings-sheet');
  await sheet.waitFor({ state: 'visible', timeout: 5_000 });
  const appearance = page.locator('button[aria-controls="settings-group-appearance"]');
  await appearance.click();
  await page.getByTestId('theme-toggle').click();
  await page.waitForFunction((expected) => document.documentElement.getAttribute('data-theme') === expected, target);
  await page.getByTestId('settings-sheet-close').click();
  await sheet.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);
}

async function focusWithKeyboard(page, tab) {
  // A real Tab event establishes WebKit's keyboard modality; then focus the
  // requested rail control even when its DOM order is behind the scroller.
  await page.keyboard.press('Tab');
  await tab.focus();
  await page.waitForTimeout(240);
}

async function tabGeometry(page, tab, mode) {
  if (mode === 'focus') await page.mouse.move(900, 450);
  await tab.scrollIntoViewIfNeeded();
  if (mode === 'hover') await tab.hover({ force: true });
  else await focusWithKeyboard(page, tab);
  await page.waitForTimeout(240);
  return tab.evaluate((button, interactionMode) => {
    const label = button.querySelector('.ht-rail__label');
    const buttonRect = button.getBoundingClientRect();
    const labelRect = label?.getBoundingClientRect() ?? null;
    const style = label === null ? null : getComputedStyle(label);
    return {
      name: button.getAttribute('aria-label') ?? label?.textContent?.trim() ?? button.getAttribute('data-testid') ?? 'unnamed',
      testId: button.getAttribute('data-testid'),
      button: { x: buttonRect.x, y: buttonRect.y, width: buttonRect.width, height: buttonRect.height },
      label: labelRect === null ? null : { x: labelRect.x, y: labelRect.y, width: labelRect.width, height: labelRect.height },
      labelOpacity: style?.opacity ?? null,
      labelVisibility: style?.visibility ?? null,
      mode: interactionMode,
    };
  }, mode);
}

function assertTooltip(probe, viewport, context) {
  if (probe.label === null) fail(`${context}: missing .ht-rail__label`);
  const label = probe.label;
  if (!finiteRect(label)) fail(`${context}: label has invalid geometry`);
  if (label.x < -0.5 || label.y < -0.5 || label.x + label.width > viewport.width + 0.5 || label.y + label.height > viewport.height + 0.5) {
    fail(`${context}: tooltip escaped viewport: ${JSON.stringify({ label, viewport })}`);
  }
  const buttonCenter = probe.button.y + probe.button.height / 2;
  const labelCenter = label.y + label.height / 2;
  if (Math.abs(labelCenter - buttonCenter) > 1.5) fail(`${context}: tooltip not vertically centered: ${JSON.stringify({ probe, buttonCenter, labelCenter })}`);
  if (label.x + 1 < probe.button.x + probe.button.width) fail(`${context}: tooltip is not to the right of its button: ${JSON.stringify({ probe })}`);
  if (Number(probe.labelOpacity) < 0.95 || probe.labelVisibility === 'hidden') fail(`${context}: tooltip is not visible: ${JSON.stringify(probe)}`);
}

async function collectRailAxis(page) {
  return page.evaluate(() => {
    const rail = document.querySelector('nav.ht-rail');
    if (rail === null) throw new Error('rail not rendered');
    const controls = [
      document.querySelector('[data-testid="account-menu-avatar"]'),
      ...rail.querySelectorAll('.ht-rail__tab'),
    ].filter((element, index, all) => element !== null && all.indexOf(element) === index);
    const railRect = rail.getBoundingClientRect();
    return {
      railCenter: railRect.left + railRect.width / 2,
      controls: controls.map((element) => {
        const rect = element.getBoundingClientRect();
        const svg = element.querySelector('svg');
        const svgRect = svg?.getBoundingClientRect() ?? null;
        return {
          testId: element.getAttribute('data-testid'),
          label: element.querySelector('.ht-rail__label')?.textContent?.trim() ?? element.getAttribute('aria-label') ?? 'unnamed',
          buttonCenter: rect.left + rect.width / 2,
          svgCenter: svgRect === null ? null : svgRect.left + svgRect.width / 2,
          button: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      }),
    };
  });
}

async function main() {
  await mkdir(evidenceDir, { recursive: true });
  const context = await webkit.launchPersistentContext(profileDir, { viewport: viewportWide });
  const page = context.pages()[0] ?? await context.newPage();
  const consoleEvents = [];
  const pageErrors = [];
  const requestFailures = [];
  page.on('console', (message) => consoleEvents.push({ type: message.type(), text: message.text() }));
  page.on('pageerror', (error) => pageErrors.push({ name: error.name, message: error.message, stack: error.stack ?? null }));
  page.on('requestfailed', (request) => requestFailures.push({ method: request.method(), url: request.url(), error: request.failure()?.errorText ?? 'unknown' }));
  const report = {
    ok: false,
    baseUrl,
    profileDir,
    userAgent: null,
    themes: [],
    axis: null,
    assistantMark: null,
    scroll: null,
    resize: null,
    consoleEvents,
    pageErrors,
    requestFailures,
  };

  try {
    await waitForApp(page);
    report.userAgent = await page.evaluate(() => navigator.userAgent);
    const tabCount = await page.locator('nav.ht-rail .ht-rail__tab').count();
    if (tabCount < 5) fail(`expected full rail, got ${String(tabCount)} tabs`);
    report.axis = await collectRailAxis(page);
    for (const control of report.axis.controls) {
      if (Math.abs(control.buttonCenter - report.axis.railCenter) > 1.5) fail(`button off rail axis: ${JSON.stringify(control)}`);
      if (control.svgCenter !== null && Math.abs(control.svgCenter - control.buttonCenter) > 1.5) fail(`svg off button axis: ${JSON.stringify(control)}`);
    }

    const assistant = page.locator('[data-testid="rail-assistant"] [data-assistant-mark="double-page"]');
    const assistantBox = await assistant.boundingBox();
    const assistantButton = assistant.locator('xpath=ancestor::button[1]');
    const assistantButtonBox = await assistantButton.boundingBox();
    if (assistantBox === null || assistantBox.width <= 0 || assistantBox.height <= 0) fail('assistant mark is not visible');
    if (assistantButtonBox === null) fail('assistant mark has no rail button');
    report.assistantMark = { count: await assistant.count(), box: assistantBox, buttonBox: assistantButtonBox, visible: await assistant.isVisible() };

    for (const theme of ['light', 'dark']) {
      await switchTheme(page, theme);
      const viewport = page.viewportSize();
      const controls = [];
      for (let index = 0; index < tabCount; index += 1) {
        const tab = page.locator('nav.ht-rail .ht-rail__tab').nth(index);
        const hover = await tabGeometry(page, tab, 'hover');
        assertTooltip(hover, viewport, `${theme} tab ${String(index)} hover`);
        const focus = await tabGeometry(page, tab, 'focus');
        assertTooltip(focus, viewport, `${theme} tab ${String(index)} focus`);
        controls.push({ index, hover, focus });
      }
      await page.screenshot({ path: join(evidenceDir, `rail-${theme}-1440x900.png`), fullPage: true });
      report.themes.push({ theme, viewport, controls });
    }

    await page.setViewportSize({ width: 1280, height: 420 });
    const scrollState = await page.evaluate(() => {
      const scroller = document.querySelector('.ht-rail__tabs');
      if (scroller === null) throw new Error('rail tab scroller not rendered');
      scroller.scrollTop = scroller.scrollHeight;
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      return { scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight };
    });
    const visibleTab = page.locator('.ht-rail__tabs .ht-rail__tab').filter({ visible: true }).last();
    const scrollProbe = await tabGeometry(page, visibleTab, 'hover');
    const scrollViewport = page.viewportSize();
    assertTooltip(scrollProbe, scrollViewport, 'scrolled tab focus');
    report.scroll = { viewport: scrollViewport, state: scrollState, probe: scrollProbe };
    await page.screenshot({ path: join(evidenceDir, 'rail-dark-scrolled-1280x420.png'), fullPage: true });

    await page.setViewportSize({ width: 1280, height: 720 });
    const resizeTab = page.locator('nav.ht-rail .ht-rail__tab').first();
    const beforeResize = await tabGeometry(page, resizeTab, 'hover');
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.waitForTimeout(100);
    await resizeTab.hover({ force: true });
    await page.waitForTimeout(240);
    const afterResize = await resizeTab.boundingBox();
    const afterResizeLabel = await resizeTab.locator('.ht-rail__label').boundingBox();
    const resizeViewport = page.viewportSize();
    if (afterResize === null || afterResizeLabel === null) fail('tooltip disappeared after resize');
    const resizeProbe = await resizeTab.evaluate((button) => {
      const label = button.querySelector('.ht-rail__label');
      const br = button.getBoundingClientRect();
      const lr = label?.getBoundingClientRect();
      return lr === undefined || lr === null ? null : { button: { x: br.x, y: br.y, width: br.width, height: br.height }, label: { x: lr.x, y: lr.y, width: lr.width, height: lr.height } };
    });
    if (resizeProbe === null) fail('resize tooltip has no geometry');
    assertTooltip({ ...resizeProbe, labelOpacity: '1', labelVisibility: 'visible' }, resizeViewport, 'resized tab focus');
    report.resize = { beforeViewport: { width: 1280, height: 720 }, before: beforeResize, afterViewport: resizeViewport, after: resizeProbe };
    await page.screenshot({ path: join(evidenceDir, 'rail-dark-resized-1024x600.png'), fullPage: true });

    report.ok = true;
  } catch (error) {
    report.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    await page.screenshot({ path: join(evidenceDir, 'rail-webkit-s9-82-failure.png'), fullPage: true }).catch(() => undefined);
  } finally {
    report.consoleEvents = consoleEvents;
    report.pageErrors = pageErrors;
    report.requestFailures = requestFailures;
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    await context.close();
  }
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

await main();
