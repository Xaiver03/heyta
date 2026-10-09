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

/**
 * 跑哪几腿（默认全跑）。加这颗旋钮的理由不是"方便"，是**这装置在干净检出上跑不动**：
 * 提醒那一腿等的 `reminder-notify-request-failed` 只活在未提交的 `ReminderNotifyPanel.tsx` 里
 * （现量：`git grep -c reminder-notify-request-failed HEAD -- apps/web` 无输出），
 * 所以拿它去量一棵只含已提交内容的树，第一腿就死，后面的分组腿一次也到不了。
 * ⚠️ 选腿不许把覆盖面一起选没：`everySelectedLegProducedCells` 与
 * `unselectedLegsReportEmpty` 两条专门钉这件事（见文件末尾）。
 */
const ALL_LEGS = ['reminders', 'data', 'groups', 'help'];
const LEGS = (process.env.HEYTA_RESPONSIVE_LEGS ?? ALL_LEGS.join(','))
  .split(',').map((x) => x.trim()).filter(Boolean);
for (const leg of LEGS) {
  if (!ALL_LEGS.includes(leg)) {
    throw new Error(`HEYTA_RESPONSIVE_LEGS 里有不认识的腿「${leg}」，认识的是：${ALL_LEGS.join(' / ')}`);
  }
}
if (LEGS.length === 0) {
  throw new Error('HEYTA_RESPONSIVE_LEGS 选了零条腿 —— 那这趟什么都没判，别让它退 0');
}

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
    // 超时不许裸等 30 秒再抛一个 TimeoutError —— 那会把"这棵树没有取证口"与
    // "取证口在场但这一态没渲染"两种相反的成因压成同一条红。
    const appeared = await page.getByTestId('reminder-notify-request-failed')
      .waitFor({ timeout: 8_000 }).then(() => true).catch(() => false);
    if (!appeared) {
      const family = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="reminder-notify-"]')]
        .map((el) => el.getAttribute('data-testid')));
      throw new Error(family.length === 0
        ? `提醒面板在这棵树上没有任何 reminder-notify-* 取证口（同族读到 0 枚），这一腿对它不适用 —— 不是产品缺陷。载体：${ORIGIN}`
        : `reminder-notify-request-failed 没出现，而同族取证口在场（${family.join(', ')}）⇒ 「请求失败」这一态确实没渲染`);
    }
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
 * 明暗 × 视口下把「个人资料 / 账号与安全 / 同步与隐私 / AI 与集成」各拍一张，
 * 并记下这一组的导航文案、标题、可交互控件枚数与几何。加这一趟的理由是覆盖表实测出来的洞：
 * `apps/web/evidence/account-suite/` 那 11 张里带 dark 命名的 **0 张**，
 * `assistant/` 7 张里 1 张 —— 而本轮的验收要求是"实际验收深浅主题"。
 * 「显示」与「数据管理」两组由本装置另外两趟覆盖，「关于与帮助」由 help-entry-ux 覆盖。
 * 补这四组用的是本线自己的装置，没有去改别人在写的 spec。
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
    // 「有没有内容被推出可视区」必须由这把尺回答，不能拿 `documentElement.scrollWidth` 顶：
    // 外壳 rail 自带横向滚动容器，溢出被它吞掉之后文档账上是干净的（2026-10-09 两棵树各量一次：
    // 旧树 scrollWidth=742 而 .ht-rail__tabs 右缘 535；当前树 scrollWidth=375 而同一枚右缘 549
    // —— 内容出界两棵树都还在，只有前一种被记成"溢出"）。
    const vw = document.documentElement.clientWidth;
    const interactive = [...document.querySelectorAll('button, a[href], input')];
    const outOfViewport = (list) => list.filter((node) => {
      const b = node.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && b.right > vw + 1;
    }).length;
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
      // 出界读数**分两栏**：整屏的（含外壳 rail，那一栏今天非零、归属不在本线）与这一组自己的
      // （那一栏才是本线四组设置面的判据对象）。混成一个数，外壳的旧账就会挂到设置面头上。
      offViewportWholeScreen: outOfViewport(interactive),
      offViewportInsideGroup: el ? outOfViewport([...el.querySelectorAll('button, a[href], input')]) : 0,
    };
  }, `settings-group-${group}`);
  // 牙：往这一组里种一枚必定出界的控件，上面那把尺必须数得到它。数不到就是尺坏了，
  // 而 `offViewportInsideGroup === 0` 那条绿会变成装饰（同一族前科：不能失败的检查没有价值）。
  const planted = await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const vw = document.documentElement.clientWidth;
    const probe = document.createElement('button');
    probe.type = 'button';
    probe.textContent = 'heyta-off-viewport-probe';
    probe.style.cssText = `position:absolute;top:0;left:${vw + 200}px;width:120px;height:24px;`;
    el.appendChild(probe);
    const b = probe.getBoundingClientRect();
    const counted = b.right > vw + 1;
    probe.remove();
    return counted;
  }, `settings-group-${group}`);
  await page.screenshot({ path: `${OUT}/${spec.theme}-${spec.width}-${group}.png`, fullPage: true });
  await context.close();
  return { theme: spec.theme, width: spec.width, group, navLabel, facts, planted };
}

/** 那四条外链行的判定。**唯一一份**：好态与三条坏臂都走这里 —— 对照臂里再手写一遍谓词，
 * 证的只是那份手写夹具，不是这把尺本身。 */
function helpRowJudgment(arm, viewportWidth) {
  return {
    wraps: arm.rows.every((x) => x.lineCount !== null && x.lineCount >= 2),
    copyFitsColumn: arm.rows.every((x) => x.copyWidth !== null && x.copyWidth <= arm.linksWidth + 1),
    rowInsideViewport: arm.rows.every((x) => x.rowRight <= viewportWidth + 1),
    noTextOverlappingArrow: arm.rows.every((x) => x.overlapsArrow !== true),
    noHorizontalOverflow: arm.doc.scrollWidth <= arm.doc.clientWidth + 1,
  };
}

const HELP_LONG_TITLE = '帮助与问题反馈的超长中文标题换行实测';

/**
 * 「关于与帮助」那四条外链行的**长标题**取证（补 UX-S9-44 验收列欠的那一句）。
 *
 * 台账要求的是"喂一枚超出容器宽度的标题再量行盒/换行"，而不是给组标题写一条恒真的
 * 断言（组标题是 i18n 词条，长度受门禁约束，永远不会因用户数据变长 —— 那条判据不会有人撞到）。
 *
 * 四态各量一次，坏态是**运行时注入在元素自己的 style 上**的，没有改共享工作树里的 CSS：
 * `wrap`（真 CSS）· `nowrap`（单行不折）· `ellipsis`（截断省略号 —— "换行"那句最现实的
 * 第二种反面）· `fixedWidth`（把文字列钉死成比内容窄，这是"文本压住图标"唯一的可达坏形）。
 *
 * 🔴 换行的尺是 `高度 / 元素自己的 line-height`，**不是** `getClientRects().length`：
 * `.ht-type-row-title` 是块级，块级元素的 client rects 就是它那**一枚**盒子，
 * 五行的标题也报 1 —— 第一版就是照它量的，把真在换行的界面读成"没换行"。
 */
async function captureHelpWrap(browser, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'zh-CN' });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('heyta.locale', 'zh-CN'));
  await page.goto(`${ORIGIN}/?lang=zh-CN`);
  await decidePrivacy(page);
  await openGroup(page, 'help');

  const measure = (arm) => page.evaluate(({ longText, arm }) => {
    const links = document.querySelector('.ht-settings__help-links');
    const rows = [...document.querySelectorAll('.ht-settings__help-links .ht-settings__help-link')];
    return {
      arm,
      linksWidth: links ? Math.round(links.getBoundingClientRect().width * 100) / 100 : null,
      doc: {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      },
      rows: rows.map((row, index) => {
        const title = row.querySelector('.ht-type-row-title');
        const copy = row.querySelector('.ht-settings__help-copy');
        const iconBox = row.querySelector('.ht-settings__help-icon');
        const arrow = [...row.querySelectorAll('svg')].find((s) => s !== iconBox?.querySelector('svg')) ?? null;
        if (!title) return { index, missing: true, lineCount: null, copyWidth: null, rowRight: Infinity, overlapsArrow: false };
        if (arm !== 'baseline') title.textContent = longText.repeat(4);
        title.style.whiteSpace = arm === 'nowrap' || arm === 'ellipsis' ? 'nowrap' : '';
        title.style.overflow = arm === 'ellipsis' ? 'hidden' : '';
        title.style.textOverflow = arm === 'ellipsis' ? 'ellipsis' : '';
        if (copy) copy.style.flex = arm === 'fixedWidth' ? '0 0 100px' : '';
        const lineHeight = Number.parseFloat(getComputedStyle(title).lineHeight) || null;
        const tr = title.getBoundingClientRect();
        const rr = row.getBoundingClientRect();
        const ar = arrow?.getBoundingClientRect() ?? null;
        return {
          index,
          textLength: title.textContent.length,
          lineHeight,
          lineCount: lineHeight ? Math.round((tr.height / lineHeight) * 100) / 100 : null,
          copyWidth: Math.round((copy?.getBoundingClientRect().width ?? 0) * 100) / 100,
          rowRight: Math.round(rr.right * 100) / 100,
          // 文本与尾部外链箭头之间的水平间隙（负数=压住了）。
          gapToArrow: ar ? Math.round((ar.left - tr.right) * 100) / 100 : null,
          overlapsArrow: ar ? tr.right > ar.left : false,
        };
      }),
    };
  }, { longText: HELP_LONG_TITLE, arm });

  const baseline = await measure('baseline');
  const wrap = await measure('wrap');
  await page.screenshot({ path: `${OUT}/light-${width}-help-long-title.png` });
  const nowrap = await measure('nowrap');
  const ellipsis = await measure('ellipsis');
  const fixedWidth = await measure('fixedWidth');
  await context.close();

  const badArms = { nowrap, ellipsis, fixedWidth };
  return {
    width,
    baseline,
    wrap,
    badArms,
    judgment: helpRowJudgment(wrap, width),
    badJudgments: Object.fromEntries(
      Object.entries(badArms).map(([name, arm]) => [name, helpRowJudgment(arm, width)]),
    ),
  };
}

// Headed Chromium is required for the real `default` notification state; headless
// Chromium coerces notifications to `denied` even after Browser.setPermission.
const browser = await chromium.launch({ headless: !HEADED });
const reminders = [];
if (LEGS.includes('reminders')) {
  for (const spec of cases) {
    for (const mode of reminderModes) reminders.push(await captureReminder(browser, spec, mode));
  }
}
const data = [];
if (LEGS.includes('data')) {
  for (const spec of cases) data.push(await dataJourney(browser, spec));
}
const sweepGroups = ['profile', 'account', 'sync', 'ai'];
// 视口口径跟着台账 UX-S9-44 那一行的**验收列原文**（375/768/1440 无横向溢出），
// 不跟着上面 `cases` 的 390 —— 差 15px 也算两套口径。
const sweepCases = [
  { theme: 'light', width: 375, height: 812 },
  { theme: 'dark', width: 375, height: 812 },
  { theme: 'light', width: 768, height: 900 },
  { theme: 'dark', width: 768, height: 900 },
  { theme: 'light', width: 1440, height: 900 },
  { theme: 'dark', width: 1440, height: 900 },
];
const groups = [];
if (LEGS.includes('groups')) {
  for (const spec of sweepCases) for (const group of sweepGroups) groups.push(await captureGroup(browser, spec, group));
}
// UX-S9-44 验收列的视口口径：375/768/1440。这一趟只量几何（换行与列宽），
// 主题不影响盒模型，暗色那一档由上面 24 格与 help-entry-ux 各自覆盖。
const helpWrapWidths = [375, 768, 1440];
const helpWrap = [];
if (LEGS.includes('help')) {
  for (const width of helpWrapWidths) helpWrap.push(await captureHelpWrap(browser, width));
}
await browser.close();

// 每根断言属于哪条腿。**这张表本身就是分母自检的对象**：新加一条断言而忘了登记归属，
// 下面那次 `unmapped` 检查会直接抛（否则它会以"恒真的空集合判定"混进 notJudged 之外，
// 让人误读成"这一趟判过了"）。
const assertionOwner = {
  noHorizontalOverflow: ['reminders', 'data'],
  allPermissionStatesRendered: ['reminders'],
  everyCaseCoversEverySelectedMode: ['reminders'],
  dataFailurePreserved: ['data'],
  existingDataRefusedWithoutLoss: ['data'],
  cancelPreserved: ['data'],
  everyCaseCoversEverySweepGroup: ['groups'],
  groupSweepThemeApplied: ['groups'],
  groupSweepTitleMatchesNav: ['groups'],
  groupSweepActionable: ['groups'],
  groupSweepNoHorizontalOverflow: ['groups'],
  groupSweepNothingPushedOffViewport: ['groups'],
  groupSweepOffViewportRulerHasTeeth: ['groups'],
  helpWrapFourRowsMeasured: ['help'],
  helpWrapInjectionTookEffect: ['help'],
  helpLongTitleWraps: ['help'],
  helpLongTitleStaysInContentColumn: ['help'],
  helpLongTitleRowInsideViewport: ['help'],
  helpLongTitleNoHorizontalOverflow: ['help'],
  helpLongTitleBadArmsFlipTheJudgment: ['help'],
};
const TRACKING_ASSERTIONS = ['everySelectedLegProducedItsCells', 'unselectedLegsReportEmpty'];
const legCells = { reminders: reminders.length, data: data.length, groups: groups.length, help: helpWrap.length };
const expectedLegCells = {
  reminders: cases.length * reminderModes.length,
  data: cases.length,
  groups: sweepCases.length * sweepGroups.length,
  help: helpWrapWidths.length,
};

const report = {
  origin: ORIGIN,
  carrier: {
    headless: !HEADED,
    legs: LEGS,
    skippedLegs: ALL_LEGS.filter((l) => !LEGS.includes(l)),
    legCells,
    expectedLegCells,
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
  sweepCases,
  groups,
  helpWrapWidths,
  helpWrap,
  assertions: {
    // ── 选腿旋钮自己的 tracking 腿：选了的必须交出应得格子数，没选的必须是空的 ──
    // 少了这两条，"只跑 groups 那一趟"就能靠 `.every` 对空集合为真把另外三条腿报成通过。
    everySelectedLegProducedItsCells: LEGS.every((leg) => legCells[leg] === expectedLegCells[leg]),
    unselectedLegsReportEmpty: ALL_LEGS.filter((l) => !LEGS.includes(l)).every((leg) => legCells[leg] === 0),
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
    everyCaseCoversEverySweepGroup: sweepCases.every((spec) =>
      sweepGroups.every((group) =>
        groups.some((x) => x.theme === spec.theme && x.width === spec.width && x.group === group))),
    groupSweepThemeApplied: groups.every((x) => x.facts.theme === x.theme),
    groupSweepTitleMatchesNav: groups.every((x) => Boolean(x.facts.title) && x.facts.title === x.navLabel),
    groupSweepActionable: groups.every((x) => x.facts.interactive >= 1),
    groupSweepNoHorizontalOverflow: groups.every((x) => x.facts.documentScrollWidth <= x.facts.documentClientWidth + 1),
    // 出界这一格分两条：一条判设置面自己（本线的地盘），一条判这把尺能不能数到种下去的坏值。
    // 整屏那一栏（`offViewportWholeScreen`）**只入读数不入门禁** —— 它今天非零，成因是外壳 rail
    // 在 375 档把导航项排出可视区，那是外壳那一面的账，不由本线代改、也不许拿它凑成"我没判"。
    groupSweepNothingPushedOffViewport: groups.every((x) => x.facts.offViewportInsideGroup === 0),
    groupSweepOffViewportRulerHasTeeth: groups.every((x) => x.planted === true),
    // ── UX-S9-44 验收列欠的那句「长标题自然换行」（关于与帮助的四条外链行）──
    // 分母自检：`.every` 对空集合是真，所以"四行都量到了"必须先钉住。
    helpWrapFourRowsMeasured: helpWrap.every((x) =>
      [x.baseline, x.wrap, ...Object.values(x.badArms)].every((arm) =>
        arm.rows.length === 4 && arm.rows.every((r) => !r.missing && r.lineCount !== null))),
    // 前提断言：注入的那枚长标题真的进了界面（否则下面每条都是对着短标题量的）。
    helpWrapInjectionTookEffect: helpWrap.every((x) =>
      x.wrap.rows.every((r, i) => r.textLength > x.baseline.rows[i].textLength)),
    helpLongTitleWraps: helpWrap.every((x) => x.judgment.wraps),
    helpLongTitleStaysInContentColumn: helpWrap.every((x) => x.judgment.copyFitsColumn),
    helpLongTitleRowInsideViewport: helpWrap.every((x) => x.judgment.rowInsideViewport),
    helpLongTitleNoHorizontalOverflow: helpWrap.every((x) => x.judgment.noHorizontalOverflow),
    // 🔴 牙齿：三条注入的坏臂必须**各自**打翻至少一条谓词。哪一天这四条行的布局改了
    // 以致坏臂再也打不翻，这条转红说的是"上面那几条已经变成恒真的装饰"，不是界面坏了。
    // 「文本压住箭头」那一格不在这里：`fixedWidth` 那条坏臂就是为它造的，量到四种状态下
    // 间隙恒 16px —— 这套 flex 布局里箭头跟着行走，压住不可达。它记为**读数**（`gapToArrow`），
    // 不记为判据；把一条永远不会假的断言写进 assertions 比不写更坏（AGENTS §7 元规则二）。
    helpLongTitleBadArmsFlipTheJudgment: helpWrap.every((x) =>
      Object.values(x.badJudgments).every((j) =>
        !j.wraps || !j.copyFitsColumn || !j.rowInsideViewport || !j.noHorizontalOverflow)),
  },
};
// 分母自检：这张归属表必须覆盖每一条断言。漏登记不是"少一行注释"——那条断言会既不进
// `notJudged` 也不被认成"这一趟判过的"，读报告的人就分不清"判过"与"那腿根本没选"。
const unmapped = Object.keys(report.assertions)
  .filter((k) => !assertionOwner[k] && !TRACKING_ASSERTIONS.includes(k));
if (unmapped.length > 0) {
  throw new Error(`这些断言没在 assertionOwner 里登记属于哪条腿：${unmapped.join(', ')}`);
}
report.notJudged = Object.entries(assertionOwner)
  .filter(([, owners]) => !owners.some((o) => LEGS.includes(o)))
  .map(([k]) => k);
const judged = Object.entries(report.assertions)
  .filter(([k]) => TRACKING_ASSERTIONS.includes(k) || (assertionOwner[k] ?? []).some((o) => LEGS.includes(o)));
if (judged.length === 0) {
  throw new Error(`这一趟一条断言都没判（legs=${LEGS.join(',')}）—— 别让它退 0`);
}
await writeFile(`${OUT}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ legs: LEGS, skippedLegs: report.carrier.skippedLegs, assertions: report.assertions, notJudged: report.notJudged }, null, 2));
if (judged.some(([, value]) => !value)) process.exitCode = 1;
