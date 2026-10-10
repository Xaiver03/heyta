#!/usr/bin/env node
/**
 * Windows 安装态 Widget 旅程 + 帮助外链验收。
 * ===============================================
 *
 * 这条验收只附着到已经运行的 WinUI/WebView2 安装态，不构建、不安装，也不推送
 * 源码。它补 `windows-installed-ux.mjs` 没有覆盖的两条真实产品边界：
 *
 *   1. 原生壳必须被页侧识别为 native，Widget Journey 只显示状态和原生说明，
 *      不能把用户带回 Windows PWA 安装流程；
 *   2. 帮助链接点击后，系统浏览器地址栏必须真的出现目标 URL，同时 WebView2
 *      仍停在 heyta.local。只检查 href 不算通过。
 *
 * 用法（先在本机把 Windows WebView2 CDP 隧道映射到 9287）：
 *
 *   HEYTA_WIN_CDP=http://127.0.0.1:9287 \
 *     node scripts/qa/windows-installed-widget-help.mjs
 *
 * 脚本会通过 `windows-pc` 上的交互式计划任务读取浏览器地址栏 UI Automation
 * 值。SSH 会话本身没有桌面，直接在 SSH 进程里读 UIA 会得到假阴性，所以这个
 * 额外的交互式步骤是严格外链证据的一部分。
 */

import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../e2e/node_modules/@playwright/test/index.mjs';
import { installStepKeys, nativeStepKeys, shellHandlerNames } from './widget-step-words.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CDP = process.env['HEYTA_WIN_CDP'] ?? 'http://127.0.0.1:9287';
const WIN_HOST = process.env['HEYTA_WIN_HOST'] ?? 'windows-pc';
const EXPECTED_HELP = process.env['HEYTA_HELP_EXTERNAL_URL'] ?? 'https://heyta.waytofuture.cn/docs';
const OUT = resolve(
  process.env['HEYTA_WINDOWS_WIDGET_HELP_EVIDENCE'] ??
    `${ROOT}/apps/web/evidence/desktop-widget-help/windows`,
);
const PROBE = resolve(ROOT, 'scripts/qa/windows-external-browser-probe.ps1');

/**
 * 判"这个窗口是不是原生壳"用的是产品自己那三条信号加它自己的封闭名单，不在这枚装置里另写一份。
 * 两条实测理由：① 装置原先写的是 `shellMessageHandlers.length > 0`，比产品松 —— 一枚只暴露
 * `bridge` 之类无关 handler 的普通 WKWebView 会被判"壳注入了信号"，而页侧照样走浏览器岔路；
 * ② 装置原先还把 `backend === 'shell'` 当硬判据，而 `resolveStorageBackend()` 的 `'shell'`
 * 只在 `__heytaHostStoragePort` 存在时才给（`apps/web/src/lib/oplog.ts:107`）⇒ `HEYTA_SHELL_STORAGE=0`
 * 那一趟会先死在这一行，本格想证的"逃生门关掉后也认得壳"根本走不到；③ 修完 ② 之后当场复量发现
 * 装置**取这三条信号的尺**仍与产品不同（装置用 `'x' in globalThis` / `Boolean(x)`，产品用
 * `x !== undefined`），属性存在但值为 `undefined` 时两者读数相反 ⇒ 那条 backend 对账会在真壳上
 * 造一次假红。名单从真源读，**读空就响亮失败**（空集合不许算通过）。
 */
const SHELL_HANDLER_NAMES = shellHandlerNames();
// 两套步骤键都从产品真源读（同一枚模块，理由写在 `widget-step-words.mjs` 文件头）：
// 安装引导是要**判零**的那一套，原生小组件引导是要**记下来**的那一套。
const INSTALL_STEP_KEYS = installStepKeys();
const NATIVE_STEP_KEYS = nativeStepKeys();
// 函数体逐字照 `isNativeShellHost()`（`apps/web/src/pwa/widget-install.ts:99-103`）的三步形状，
// 连"名单在前、注入的 key 在后"的方向一起照 —— 这枚装置里唯一该出现的判断形状就是产品那一枚。
const isNativeShellHost = ({ storagePort, webview2Host, shellMessageHandlers }) => {
  if (storagePort) return true;
  if (webview2Host) return true;
  return SHELL_HANDLER_NAMES.some((name) => shellMessageHandlers.includes(name));
};

mkdirSync(OUT, { recursive: true });

function runFileCommand(command, args) {
  const dir = mkdtempSync('/tmp/heyta-windows-widget-help-');
  const output = resolve(dir, 'output.txt');
  const fd = openSync(output, 'w');
  let result;
  try {
    result = spawnSync(command, args, { stdio: ['ignore', fd, fd] });
  } finally {
    closeSync(fd);
  }
  const text = existsSync(output) ? readFileSync(output, 'utf8') : '';
  try {
    unlinkSync(output);
  } catch {
    // best effort temp cleanup
  }
  return { ...result, text };
}

function powershellEncoded(source) {
  return Buffer.from(source, 'utf16le').toString('base64');
}

const copiedProbe = runFileCommand('scp', [
  '-o', 'ConnectTimeout=15',
  PROBE,
  `${WIN_HOST}:C:/src/heyta-external-browser-probe.ps1`,
]);
if (copiedProbe.status !== 0) {
  throw new Error(`无法把 Windows UIA 探针送到 ${WIN_HOST}：\n${copiedProbe.text}`);
}

function remote(stage) {
  const path = `C:\\src\\heyta-widget-help-${stage}.json`;
  const source = [
    '$ErrorActionPreference = "Stop"',
    `$stage = '${stage}'`,
    `$result = '${path}'`,
    'Remove-Item $result -Force -ErrorAction SilentlyContinue',
    '$task = "heyta-qa-widget-help"',
    'Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue',
    '$run = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\\src\\heyta-external-browser-probe.ps1 -Stage " + $stage + " -OutFile " + $result',
    'schtasks /create /tn $task /tr $run /sc once /st 00:00 /ru $env:USERNAME /it /f | Out-Null',
    'schtasks /run /tn $task | Out-Null',
    'for ($i = 0; $i -lt 40; $i++) { if (Test-Path $result) { Get-Content -Raw $result; exit 0 }; Start-Sleep -Milliseconds 250 }',
    'Write-Output "PROBE_MISSING"',
    'exit 1',
  ].join('; ');
  const encoded = powershellEncoded(source);
  const result = runFileCommand('ssh', [
    '-o', 'ConnectTimeout=15',
    '-o', 'ServerAliveInterval=30',
    WIN_HOST,
    `powershell -NoProfile -EncodedCommand ${encoded}`,
  ]);
  if (result.status !== 0) {
    throw new Error(`Windows ${stage} UIA 取证失败（ssh rc=${String(result.status)}）：\n${result.text}`);
  }
  const line = result.text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.startsWith('{'));
  if (line === undefined) throw new Error(`Windows ${stage} UIA 没有返回 JSON：\n${result.text}`);
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`Windows ${stage} UIA JSON 无法解析：${String(error)}\n${line}`);
  }
}

function normalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch {
    return value.replace(/\/+$/, '');
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await chromium.connectOverCDP(CDP);
const versionResponse = await fetch(`${CDP}/json/version`);
const version = await versionResponse.json();
const targetsResponse = await fetch(`${CDP}/json/list`);
const targets = await targetsResponse.json();
assert(/^Edg\//.test(version.Browser ?? ''), `CDP 不是 Edge/WebView2：${String(version.Browser)}`);
assert(/Windows NT/.test(version['User-Agent'] ?? ''), `CDP 不在 Windows：${String(version['User-Agent'])}`);
assert(
  targets.some((target) => target.type === 'page' && target.url.startsWith('https://heyta.local/')),
  'CDP 中没有 heyta.local 页面目标',
);

const page = browser
  .contexts()
  .flatMap((context) => context.pages())
  .find((candidate) => candidate.url().startsWith('https://heyta.local/'));
assert(page !== undefined, '附着后找不到 heyta.local 页面');
await page.waitForLoadState('domcontentloaded').catch(() => undefined);
await page.waitForTimeout(500);

// 先收系统浏览器前景快照，再让壳里的页面发起外链。before/after 的差异是因果证据。
const beforeBrowser = remote('before');
writeFileSync(resolve(OUT, 'windows-browser-before.json'), `${JSON.stringify(beforeBrowser, null, 2)}\n`);

// Fresh installed profiles show the privacy/network consent dialog before the
// account menu can receive pointer events. It is an app-level first-run sheet,
// so dismiss it for this focused Widget/help journey instead of letting the
// modal backdrop make the later avatar click time out.
const privacyConsentClose = page.locator('[data-testid="privacy-consent-close"]');
if (await privacyConsentClose.count() > 0 && await privacyConsentClose.first().isVisible().catch(() => false)) {
  await privacyConsentClose.first().click();
  await page.waitForTimeout(250);
}

// 帮助入口先回到设置 sheet，再走真实的「帮助 → 文档」路径。
const settingsClose = page.locator('[data-testid="settings-sheet-close"]');
if (await settingsClose.count() > 0 && await settingsClose.first().isVisible().catch(() => false)) {
  await settingsClose.first().click();
  await page.waitForTimeout(250);
}
await page.locator('[data-testid="account-menu-avatar"]').click();
await page.locator('[data-testid="account-menu-settings"]').click();
await page.locator('[data-testid="settings-sheet"]').waitFor();

// Widget Journey 在「显示」组；用 aria-controls 选组，不依赖中文文案或排列位置。
await page.locator('button.ht-settings__nav-link[aria-controls="settings-group-appearance"]').click();
const widget = page.locator('[data-testid="widget-journey-panel"]');
await widget.waitFor();
const widgetFacts = await widget.evaluate((panel, facts) => ({
  statusCount: panel.querySelectorAll('[data-testid="widget-journey-status"]').length,
  statusText: panel.querySelector('[data-testid="widget-journey-status"]')?.textContent?.trim() ?? '',
  capabilityText: panel.querySelector('[data-testid="widget-journey-capability"]')?.textContent?.trim() ?? '',
  // 🔴 "安装步骤"只能按**产品那批键名**数，不能按 `web.widgetJourney.*.step` 这种形状挑：
  //    原生小组件引导的键（`web.widgetJourney.native.*.step1`）同样带 `.step`，
  //    现量 3 枚原生键里有 2 枚会被那个形状选择器算成安装步骤 ⇒ 壳真的给了原生引导时，
  //    旧挑法会在**正确的界面**上报"对着已装好的应用教怎么装应用"。两套键都从真源读。
  installStepCount: [...panel.querySelectorAll('[data-testid]')]
    .map((el) => el.getAttribute('data-testid'))
    .filter((id) => facts.installKeys.includes(id)).length,
  nativeStepCount: [...panel.querySelectorAll('[data-testid]')]
    .map((el) => el.getAttribute('data-testid'))
    .filter((id) => facts.nativeKeys.includes(id)).length,
  backend: (globalThis.__heytaStorage ?? {}).backend ?? '',
  // `isNativeShellHost()` reads these three, not `backend`. Recording them separately is
  // what makes this run evidence about the *shell environment*: an installed build whose
  // storage port is closed still has to expose at least one of them, or the panel would
  // fall back to the browser branch.
  //
  // 🔴 三条测法逐字照抄产品那侧（`!== undefined`，`WidgetJourneyPanel.tsx:45-49`），不用
  //    `in` / `Boolean()`：属性存在但值是 undefined 时两种尺读数相反，而下面那条 backend
  //    对账比的就是产品的 `resolveStorageBackend()`（同样是 `!== undefined`）⇒ 尺不一致会在
  //    真壳上造一次假红。名单经 evaluate 的参数传进来：Playwright 序列化函数体，闭包读不到外层常量。
  shellSignals: {
    storagePort: globalThis.__heytaHostStoragePort !== undefined,
    webview2Host: globalThis.chrome?.webview !== undefined,
    shellMessageHandlers: facts.handlerNames.filter(
      (name) => globalThis.webkit?.messageHandlers?.[name] !== undefined,
    ),
    // 只留证据、不参与判定：壳**实际**注册了哪些 handler 名（含产品名单之外的那些）。
    injectedHandlerKeys: Object.keys(globalThis.webkit?.messageHandlers ?? {}),
  },
  panelText: panel.textContent?.trim() ?? '',
}), { handlerNames: SHELL_HANDLER_NAMES, installKeys: INSTALL_STEP_KEYS, nativeKeys: NATIVE_STEP_KEYS });
assert(widgetFacts.statusCount === 1, `Widget Journey 状态行应恰好 1 条，实际 ${String(widgetFacts.statusCount)}`);
// `backend` 从"硬判据"降级成"对账项"：它只回答"存储端口在不在"，而这一趟要判的是"页侧认不认这是壳"。
// 两者不一致才红（自报 shell 却没注入端口 = 页侧在说谎；注入了端口却自报非 shell = 接线断了）。
assert(
  (widgetFacts.backend === 'shell') === widgetFacts.shellSignals.storagePort,
  `存储后端自报与注入信号不一致：backend=${String(widgetFacts.backend)} storagePort=${String(widgetFacts.shellSignals.storagePort)}`,
);
assert(/原生桌面|native desktop/i.test(widgetFacts.statusText), `状态行没有识别为原生桌面：${widgetFacts.statusText}`);
assert(widgetFacts.capabilityText.length > 0, '原生壳没有渲染小组件能力边界说明');
assert(widgetFacts.installStepCount === 0, `原生壳不应显示 PWA 安装步骤，实际 ${String(widgetFacts.installStepCount)} 条`);
const { storagePort, webview2Host, shellMessageHandlers, injectedHandlerKeys } = widgetFacts.shellSignals;
assert(
  isNativeShellHost(widgetFacts.shellSignals),
  `壳没有注入产品认得的任何一条原生信号（storagePort=${String(storagePort)} webview2Host=${String(webview2Host)} 命中名单=${JSON.stringify(shellMessageHandlers)} 名单=${JSON.stringify(SHELL_HANDLER_NAMES)} 壳实际注册的 handler=${JSON.stringify(injectedHandlerKeys)}）⇒ 页侧只能把它当浏览器`,
);
await widget.scrollIntoViewIfNeeded();
await page.screenshot({ path: resolve(OUT, 'windows-widget-native.png'), fullPage: false });

const shellBefore = page.url();
await page.locator('[data-testid="rail-help"]').click();
await page.locator('[data-testid="about-panel"]').waitFor();
const helpLink = page.locator('[data-testid="about-link-docs"]');
await helpLink.waitFor();
const href = await helpLink.getAttribute('href');
assert(normalUrl(href ?? '') === normalUrl(EXPECTED_HELP), `帮助 href 不正确：${String(href)}`);
await helpLink.click();
await page.waitForTimeout(1500);
const shellAfter = page.url();
assert(shellAfter === shellBefore, `点击帮助后原生壳不应导航：${shellBefore} → ${shellAfter}`);
assert(await page.locator('[data-testid="about-panel"]').isVisible(), '点击帮助后壳内帮助面板不再可见');
await page.screenshot({ path: resolve(OUT, 'windows-help-shell-unchanged.png'), fullPage: false });

const afterBrowser = remote('after');
writeFileSync(resolve(OUT, 'windows-browser-after.json'), `${JSON.stringify(afterBrowser, null, 2)}\n`);
// The scheduled UIA probe may itself briefly become foreground. Verify a real
// browser window and a new tab/changed address instead of depending on focus.
// On Windows, UI Automation can report the foreground Chromium window but omit
// that same window from RootElement's direct-child enumeration (this happened
// in the 2026-10-07 evidence: `foreground.isBrowser=true`, `browsers=[]`).
// Treat the foreground record as a browser candidate too; otherwise a valid
// external handoff is falsely reported as missing merely because focus moved
// during the scheduled probe.
const beforeBrowserRecords = [
  ...(beforeBrowser.browsers ?? []),
  ...(beforeBrowser.foreground?.isBrowser ? [beforeBrowser.foreground] : []),
];
const afterBrowserRecords = [
  ...(afterBrowser.browsers ?? []),
  ...(afterBrowser.foreground?.isBrowser ? [afterBrowser.foreground] : []),
];
const externalBrowser = afterBrowserRecords.find((record) => normalUrl(record.url ?? '') === normalUrl(EXPECTED_HELP));
const actualExternal = externalBrowser?.url ?? '';
assert(externalBrowser?.isBrowser === true, '系统浏览器窗口中没有找到帮助目标地址');
assert(
  normalUrl(actualExternal) === normalUrl(EXPECTED_HELP),
  `系统浏览器地址栏没有打开帮助目标：期望 ${EXPECTED_HELP}，实际 ${actualExternal}`,
);
assert(
  !beforeBrowserRecords.some((record) => record.hwnd === externalBrowser.hwnd && normalUrl(record.url ?? '') === normalUrl(EXPECTED_HELP)) ||
    externalBrowser.tabCount > (beforeBrowserRecords.find((record) => record.hwnd === externalBrowser.hwnd)?.tabCount ?? 0),
  '点击前后均为同一帮助 URL，且没有新窗口或新增标签证据；本次外链交接未证实',
);

const result = {
  cdp: CDP,
  browser: version.Browser,
  shellBefore,
  shellAfter,
  widget: widgetFacts,
  external: {
    expected: EXPECTED_HELP,
    before: beforeBrowser.foreground,
    after: afterBrowser.foreground,
    evidence: 'Windows UI Automation foreground browser address-bar value',
  },
  screenshots: ['windows-widget-native.png', 'windows-help-shell-unchanged.png'],
};
writeFileSync(resolve(OUT, 'windows-widget-help.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(`✅ Windows 安装态 Widget + 帮助外链验收通过：${resolve(OUT)}`);
console.log(JSON.stringify(result, null, 2));
await browser.close();
