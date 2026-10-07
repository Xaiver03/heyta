#!/usr/bin/env node
/**
 * Windows 安装态产品 UX 验收：单一 AI 助手 + 设置选中态。
 * ================================================================
 *
 * 这个脚本只附着到已经安装并在交互式 Windows 会话中运行的 Heyta WebView2，
 * 不构建、不安装、不复制源码。调用方先为 WebView2 开 CDP 并建立 SSH 隧道，
 * 再运行：
 *
 *   HEYTA_WIN_CDP=http://127.0.0.1:9287 node scripts/qa/windows-installed-ux.mjs
 *
 * 身份闸门与 Windows 壳验收共用同一条规则：CDP 必须是 Edge/WebView2，且目标
 * 页面必须是 `https://heyta.local/`。这样不会把本机 Chrome 误当成安装态产品。
 * 证据固定写入 `apps/web/evidence/settings-finish-release/windows/`，不使用
 * `e2e/*-results/` 这类每轮会被 Playwright 清理的目录。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../e2e/node_modules/@playwright/test/index.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CDP = process.env['HEYTA_WIN_CDP'] ?? 'http://127.0.0.1:9287';
const ORIGIN = 'https://heyta.local/';
const OUT = resolve(
  process.env['HEYTA_WINDOWS_UX_EVIDENCE'] ??
    `${ROOT}/apps/web/evidence/settings-finish-release/windows`,
);

mkdirSync(OUT, { recursive: true });

function fail(message) {
  console.error(`❌ ${message}`);
  process.exitCode = 1;
}

async function json(url) {
  const response = await fetch(url).catch(() => null);
  if (response === null || !response.ok) {
    throw new Error(`CDP 不可达：${url}`);
  }
  return response.json();
}

const version = await json(`${CDP}/json/version`);
const targets = await json(`${CDP}/json/list`);
if (!/^Edg\//.test(version.Browser ?? '') || !/Windows NT/.test(version['User-Agent'] ?? '')) {
  throw new Error(
    `身份闸门失败：Browser=${String(version.Browser)} / UA=${String(version['User-Agent'])}`,
  );
}
if (!targets.some((target) => target.type === 'page' && target.url.startsWith(ORIGIN))) {
  throw new Error(
    `CDP 中没有 ${ORIGIN} 页面目标：${targets
      .map((target) => `${target.type}:${target.url}`)
      .join(' | ')}`,
  );
}

// 只附着；不要 browser.close()，否则 Playwright 会把正在验收的安装态壳一起关掉。
const browser = await chromium.connectOverCDP(CDP);
const page = browser
  .contexts()
  .flatMap((context) => context.pages())
  .find((candidate) => candidate.url().startsWith(ORIGIN));
if (page === undefined) throw new Error('附着后找不到 heyta.local 页面');

const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(`console.error: ${message.text()}`);
});
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

await page.waitForLoadState('domcontentloaded').catch(() => undefined);
await page.waitForTimeout(750);

// 首次启动可能有隐私选择遮罩；选择本机模式只为让验收能继续，不改变服务器数据。
const localOnly = page.locator('[data-testid="privacy-consent-local-only"]');
if (await localOnly.count() > 0 && await localOnly.first().isVisible().catch(() => false)) {
  await localOnly.first().click();
  await page.waitForTimeout(350);
}

// 若上一次验收停在设置页，先回到主应用，让 AI 助手和设置都走真实入口。
const closeSettings = page.locator('[data-testid="settings-sheet-close"]');
if (await closeSettings.count() > 0 && await closeSettings.first().isVisible().catch(() => false)) {
  await closeSettings.first().click();
  await page.waitForTimeout(350);
}

const visible = (element) => {
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
};

const ai = await page.evaluate(() => {
  const isVisible = (element) => {
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  };
  const tabs = [...document.querySelectorAll('[role="tab"]')].filter(isVisible);
  const exactToolWords = [...document.querySelectorAll('body *')]
    .filter(isVisible)
    .map((element) => (element.textContent ?? '').trim())
    .filter((text) => /^(工具|tools?)$/i.test(text));
  return {
    assistantPanels: document.querySelectorAll('[data-testid="ai-assistant"]').length,
    assistantInputs: document.querySelectorAll('[data-testid="ai-assistant-input"]').length,
    roleTabs: tabs.map((element) => ({
      text: element.textContent?.trim() ?? '',
      selected: element.getAttribute('aria-selected'),
      testid: element.getAttribute('data-testid'),
    })),
    independentToolTabs: tabs.filter((element) => /工具|tools?/i.test(element.textContent ?? '')).length,
    independentToolWords: exactToolWords.length,
    assistantHeading:
      document.querySelector('[data-testid="ai-assistant"]')?.textContent?.trim().slice(0, 240) ?? '',
  };
});

if (ai.assistantPanels !== 1) throw new Error(`AI 助手面板数量应为 1，实际 ${String(ai.assistantPanels)}`);
if (ai.assistantInputs !== 1) throw new Error(`AI 助手输入框数量应为 1，实际 ${String(ai.assistantInputs)}`);
if (ai.independentToolTabs !== 0 || ai.independentToolWords !== 0) {
  throw new Error(
    `发现独立工具入口：tabs=${String(ai.independentToolTabs)} words=${String(ai.independentToolWords)}`,
  );
}
await page.screenshot({ path: resolve(OUT, 'windows-chatbot.png'), fullPage: false });

// 通过头像菜单进入设置，验证当前设置项是组件化选中态，而不是下划线或纯文字排版。
const avatar = page.locator('[data-testid="account-menu-avatar"]');
if (await avatar.count() === 0) throw new Error('找不到头像菜单入口');
await avatar.first().click();
await page.waitForTimeout(250);
const settingsEntry = page.locator('[data-testid="account-menu-settings"]');
if (await settingsEntry.count() === 0) throw new Error('头像菜单没有设置入口');
await settingsEntry.first().click();
await page.waitForTimeout(500);

const settings = await page.evaluate(() => {
  const active = [...document.querySelectorAll('.ht-settings__nav-link[aria-current="page"]')];
  const style = active[0] === undefined ? null : getComputedStyle(active[0]);
  return {
    activeCount: active.length,
    activeText: active[0]?.textContent?.trim() ?? '',
    activeBackground: style?.backgroundColor ?? null,
    activeBorder: style?.borderColor ?? null,
    activeClass: active[0]?.className ?? '',
  };
});
if (settings.activeCount !== 1) {
  throw new Error(`设置导航必须恰好有一个选中项，实际 ${String(settings.activeCount)}`);
}
if (settings.activeBackground === null || settings.activeBackground === 'rgba(0, 0, 0, 0)') {
  throw new Error('设置选中项没有可见组件高亮背景');
}
await page.screenshot({ path: resolve(OUT, 'windows-settings.png'), fullPage: false });

const result = {
  cdp: CDP,
  browser: version.Browser,
  userAgent: version['User-Agent'],
  page: page.url(),
  ai,
  settings,
  consoleErrors,
  screenshots: ['windows-chatbot.png', 'windows-settings.png'],
};
writeFileSync(resolve(OUT, 'windows-dom.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
if (consoleErrors.length > 0) throw new Error(`页面有控制台错误：${consoleErrors.join('\n')}`);

console.log(`✅ Windows 安装态 UX DOM 验收通过：${resolve(OUT)}`);
console.log(JSON.stringify(result, null, 2));
