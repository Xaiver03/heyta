#!/usr/bin/env node
/**
 * 提醒权限与数据管理的真实浏览器 UX 取证。
 *
 * 这条脚本只运行 Web Vite 开发服务器，不构建端包、不接触真实账号或邮件。
 * 每个视口/主题都使用独立浏览器上下文，真实点击设置、导出、选择文件与还原。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../e2e/node_modules/@playwright/test/index.mjs';

const ORIGIN = process.env.HEYTA_RESPONSIVE_ORIGIN ?? 'http://127.0.0.1:4379';
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const OUT = resolve(process.env.HEYTA_RESPONSIVE_EVIDENCE ?? `${ROOT}/apps/web/evidence/reminders-data-responsive`);

/**
 * 「种一枚不跟档的共享层节点」的臂号（默认 -1 = 不种）。
 * 为什么要这颗旋钮：`themeLayerRulerSwitchesWithTier` 03:4x 起把作用域内**每一枚**带字面
 * `color` 的节点都配对（不再只看第一枚）。要证明"扩样真的换来了敏感度"，唯一的证法是造出
 * **只有第 2..n 枚坏掉**的界面状态 —— 改前那把尺的样本恰好只有第 0 枚，对它结构上盲。
 * 🔴 种下去的读数必须自己带身份：`carrier.plantedStuckTierIndex` 入册，
 * 另有 `plantedThemeSampleTookEffect` 钉"种的东西确实落了"（同一族见 `groupSweepOffViewportRulerHasTeeth`
 * 与 `helpWrapInjectionTookEffect`）—— 没有那条，"臂红了"与"臂什么都没种上"在输出上长一样。
 */
const PLANT_STUCK_TIER_INDEX = Number(process.env.HEYTA_RESPONSIVE_PLANT_STUCK_TIER ?? '-1');
const PLANTED_STUCK_TIER_COLOR = 'rgb(15, 23, 42)';
if (!Number.isInteger(PLANT_STUCK_TIER_INDEX)) {
  throw new Error(`HEYTA_RESPONSIVE_PLANT_STUCK_TIER 必须是整数臂号，读到的原文：${process.env.HEYTA_RESPONSIVE_PLANT_STUCK_TIER}`);
}
// 只许种在**第 2 枚及以后**：index 0 会连 `sharedLayerColor` 一起改到，那条 `darkTierReachesBothThemeLayers`
// 跟着变红，这一臂就再也证不了"只有配对判据看得见这个坏值"。上限对着 `slice(0, 8)` 那一步。
if (PLANT_STUCK_TIER_INDEX === 0 || PLANT_STUCK_TIER_INDEX > 7) {
  throw new Error(`HEYTA_RESPONSIVE_PLANT_STUCK_TIER 只能是 -1（不种）或 1..7；读到 ${PLANT_STUCK_TIER_INDEX}`);
}

/**
 * 跑哪几腿（默认全跑）。加这颗旋钮的理由不是"方便"，是**这装置在干净检出上跑不动**：
 * 提醒那一腿等的 `reminder-notify-request-failed` 只活在未提交的 `ReminderNotifyPanel.tsx` 里
 * （现量：`git grep -c reminder-notify-request-failed HEAD -- apps/web` 无输出），
 * 所以拿它去量一棵只含已提交内容的树，第一腿就死，后面的分组腿一次也到不了。
 * ⚠️ 选腿不许把覆盖面一起选没：`everySelectedLegProducedCells` 与
 * `unselectedLegsReportEmpty` 两条专门钉这件事（见文件末尾）。
 */
const ALL_LEGS = ['reminders', 'data', 'groups', 'help', 'sync'];
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

/**
 * 证据落点的闸门（2026-10-09 加，先修自己）。理由不是整洁：同日复量整族 `check:ai-e2e` 时现量到
 * **跑一趟会把已跟踪的截图就地改写**（那棵隔离载体 152 枚、主检出 330 枚），覆盖没有归属、没有门禁 ——
 * 证据一旦变成"最近一次跑出来的图"，它就不再指认任何一棵树。本装置默认落的正是已跟踪目录
 * （`git ls-files -- apps/web/evidence/reminders-data-responsive` = 47 枚），所以它是写图者之一。
 * 口径：目标目录里有已跟踪文件 ⇒ 起跑前响亮拒绝；两条出路写在报错里。
 */
const OUT_REL = relative(ROOT, OUT).split(sep).join('/');
const OUT_LABEL = OUT_REL.startsWith('..') ? OUT : OUT_REL;
const trackedInEvidenceDir = (() => {
  if (!OUT_REL || OUT_REL.startsWith('..')) return 0;
  try {
    return execFileSync('git', ['ls-files', '--', OUT_REL], { cwd: ROOT, encoding: 'utf8' })
      .split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
})();
const ALLOW_TRACKED_OVERWRITE = process.env.HEYTA_ALLOW_TRACKED_EVIDENCE === '1';
if (trackedInEvidenceDir > 0 && !ALLOW_TRACKED_OVERWRITE) {
  throw new Error(
    `证据目录 ${OUT_LABEL} 里有 ${trackedInEvidenceDir} 枚**已跟踪**文件，这一趟会把它们就地覆盖掉。` +
      '两条出路：① 换个未跟踪的落点 `HEYTA_RESPONSIVE_EVIDENCE=<临时目录>`（例行复跑走这条）；' +
      '② 确实要刷新入库的那批证据，显式加 `HEYTA_ALLOW_TRACKED_EVIDENCE=1`，并在提交信息里写明是哪一趟、哪棵树。',
  );
}
/**
 * 这一趟读数**指认哪一棵树**（2026-10-10 03:0x 加）。理由不是整洁，是两条在案事实撞在一起：
 * ① 本仓库有一条在案缺陷 ——「跑一趟会把已跟踪证据就地改写 ⇒ 证据不再指认任何一棵树」；
 * ② 主检出上别的线一直在落笔（现量：02:5x 那格量到 70 分钟里落 25 笔）。
 * 于是"整族最新读数"这句话必须自带：起跑那一刻的 `HEAD`、脏集合大小，**以及装置自己的 sha256**
 * —— 最后那枚让「读数 = 当前入库那版装置」这条口径从"人记得去复跑"变成**能机械对账**。
 * ⚠️ 这是**读数不是判据**：它不判红（对账发生在读台账的那一刻，不是跑装置的那一刻），
 * 所以别把它当"有牙的门口" —— 它挡的是"三个月后没人知道这行是哪棵树上量的"。
 */
const RIG_REL = 'scripts/qa/reminders-data-responsive.mjs';
const TREE = (() => {
  const git = (args) => {
    try {
      return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
    } catch {
      return null;
    }
  };
  const dirtyCount = (path) => {
    const out = git(['status', '--porcelain', '--', path]);
    return out === null ? '(git unavailable)' : out.split('\n').filter(Boolean).length;
  };
  const head = git(['rev-parse', 'HEAD']);
  let rigSha = '(rig unreadable)';
  try {
    rigSha = createHash('sha256').update(readFileSync(resolve(ROOT, RIG_REL))).digest('hex').slice(0, 12);
  } catch {}
  return {
    headSha: head ? head.trim() : '(git unavailable)',
    // 🔴 **射程标签**：下面这几枚全部是**跑装置的这棵检出**（`ROOT`）的事实，
    // **不是** `ORIGIN` 那棵树的事实。载体跑（主检出的装置打隔离载体那棵树）时两者不同一棵，
    // 混读会把"主检出 HEAD"当成被界面的那一棵 —— 被服务的那棵树只能由调用方在台账里另记（现量：`cd <载体> && git rev-parse --short HEAD`）。
    root: ROOT,
    provenanceScope: 'rig 的检出（ROOT），不是 ORIGIN 那棵被服务的树',
    rigFile: RIG_REL,
    rigSha256Prefix: rigSha,
    rigWorktreeMatchesHead: dirtyCount(RIG_REL) === 0,
    dirtyFiles: { 'apps/web/src': dirtyCount('apps/web/src'), 'packages/ui/src': dirtyCount('packages/ui/src') },
    at: new Date().toISOString(),
  };
})();

if (process.env.HEYTA_RESPONSIVE_PLAN_ONLY === '1') {
  console.log(JSON.stringify({
    legs: LEGS,
    evidenceDir: OUT_LABEL,
    trackedEvidenceFiles: trackedInEvidenceDir,
    allowedTrackedOverwrite: ALLOW_TRACKED_OVERWRITE,
    tree: TREE,
    browserLaunched: false,
  }));
  process.exit(0);
}

// 五条腿的格子容器。**提前到这里声明**只有一个理由：下面那枚"抛异常也留一份机读状态"的兜底
// 要能读到它们，而兜底必须注册在第一条腿开跑之前。
const reminders = [];
const data = [];
const groups = [];
const helpWrap = [];
const syncPrivacy = [];

/**
 * 🔴 2026-10-10 01:3x 实测到的一个自身缺陷：那一趟跑到分组腿后半段抛了异常，结果是
 * **89 张 PNG + 零机读状态**（没有 `report.json`，当时的启动命令又没留住 stderr）。
 * 于是"判据红"（装置会写报告再退 1）与"根本没跑完"在磁盘上长得一模一样，
 * 下一位只能重跑一遍才知道 —— 而重跑那一趟（01:5x，`-r18`）是 rc=0 全真，异常没复现。
 * 兜底口径：任何未捕获异常都写 `report-failure.json`（炸在哪条腿、已经收到几格、错误原文），
 * 再退 1。**这条兜底不改判据，只让失败的形状可核对。**
 */
let failureWritten = false;
const writeFailure = async (kind, err) => {
  if (failureWritten) return;
  failureWritten = true;
  const message = String(err?.message ?? err).slice(0, 2000);
  const partial = {
    kind,
    message,
    stack: String(err?.stack ?? '').split('\n').slice(0, 6).join('\n'),
    origin: ORIGIN,
    tree: TREE,
    legs: LEGS,
    cellsSoFar: {
      reminders: reminders.length,
      data: data.length,
      groups: groups.length,
      help: helpWrap.length,
      sync: syncPrivacy.length,
    },
    evidenceDir: OUT_LABEL,
    at: new Date().toISOString(),
  };
  try {
    await mkdir(OUT, { recursive: true });
    await writeFile(`${OUT}/report-failure.json`, `${JSON.stringify(partial, null, 2)}\n`);
  } catch {
    // 落点本身写不了就没辙；这里不许把原始错误盖掉
  }
  console.error(`RESPONSIVE_FAILURE ${kind}: ${message}`);
};
process.on('uncaughtException', (err) => {
  writeFailure('uncaughtException', err).finally(() => process.exit(1));
});
process.on('unhandledRejection', (err) => {
  writeFailure('unhandledRejection', err).finally(() => process.exit(1));
});

// 真实的 `default` **与 `granted`** 两态只存在于有头 Chromium。原先这里只写了 `default`，
// 2026-10-09 无头那一趟把它照出来了：`granted` 档设完权限后回读 `Notification.permission`
// 得到的是 `denied`（`report.json` 里 `mode:'granted'` 那 4 格 `permission:'denied'`、
// granted 卡 0 张），`allPermissionStatesRendered` 因此判假红。
// 2026-10-10 00:3x 把"无头到底能不能拿到 granted"按五条通道各测一遍，全部回 `denied`：
// ① `context.grantPermissions(['notifications'])`；② CDP `Browser.setPermission setting:'granted'`
// （带 `browserContextId`，就是下面 denied 档那套）；③ 页面里真调一次 `Notification.requestPermission()`
// 再回读；④ 启动参数 `--headless=new`；⑤ `--disable-features=…NotificationsBlocked… --enable-features=Notifications`。
// ⇒ 这是载体限制，不是探针没做对。原来的处置是**整档跳过**（五档变三档），代价是这两态的界面形状
// 在无头那一趟完全没被看过。现在改成：**注入** `window.Notification` 的那两态（与 `unsupported` /
// `error` 两档同一族做法，它们本来就在注入），并把来源逐格写进 `permissionSource`，
// 另有一条判据钉住"注入的必须标成注入"—— 免得哪天把注入读成了真权限管道。
// 有头 = 会开一个抢前台的窗口（AGENTS §6.2 规定二），所以它必须是显式 opt-in；真权限管道只有那一档算数。
const HEADED = process.env.HEYTA_RESPONSIVE_HEADED !== '0';
const SIMULATED_WHEN_HEADLESS = ['default', 'granted'];
const reminderModes = HEADED
  ? ['default', 'granted', 'denied', 'unsupported', 'error']
  : ['denied', 'unsupported', 'error', 'default', 'granted'];
const isSimulatedMode = (mode) => !HEADED && SIMULATED_WHEN_HEADLESS.includes(mode);
// 🔴 视口口径要对着**台账声称的那句话**量，不是对着方便：主表 UX-S9-31/32 两行写的是
// 「Web 1440/375 亮暗浏览器验收通过」，而这一腿从 10-08 那批起只有 390/1440 ——
// 375 那一档以前只由 `groups` 腿覆盖，而它走的是另外四组，**不含「任务与显示」**
// （显示选项 / 语言组 / 暗色切换 / 提醒状态卡都住在这一组里）。
// ⇒ 10-10 01:3x 把 375 补进来，让那句话有它自己的读数；分组走查腿的 375/768/1440 不动。
const cases = [
  { theme: 'light', width: 375, height: 812 },
  { theme: 'dark', width: 375, height: 812 },
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

/**
 * 🔴 主题必须走应用自己的那条（`heyta.theme` 那一键），**不要**直接写 `dataset.theme`。
 *
 * 这条以前只在 `sync` 腿兑现（它的注释第 1 条就是这件事），其余三条腿一直在硬写属性，
 * 于是那三腿的"暗色档"是**半暗**的：
 *   - CSS 层跟着动 —— `tokens.css` 的暗色覆盖挂在 `<html data-theme>` 上；
 *   - 共享层不动 —— `packages/ui` 的 RN 组件吃的是 `<HeytaUiProvider value=…>` 里那份
 *     JS token（`apps/web/src/App.tsx` 用 `resolveHeytaUiTheme({ scheme: theme })` 解析），
 *     它**根本不读这个 DOM 属性**。
 * 实测（`scripts/qa/probe-theme-layer.mjs`，10-10 00:5x，390×844）：只写属性时同一屏上
 * web 标题是 `rgb(241,245,249)`、共享层 `SettingsSection` 的标题仍是 `rgb(15,23,42)`
 * —— 深底压深字；写 `heyta.theme` 时两层都是 `rgb(241,245,249)`。
 * ⇒ 那是**载体的缺陷**，不是产品的：产品里 `applyTheme(theme)` 与 `uiTheme` 由同一个状态驱动。
 * 亮色档也一并显式写，不再依赖 Playwright 上下文的默认配色。
 */
const seedStorage = (page, theme) => page.addInitScript((t) => {
  localStorage.setItem('heyta.locale', 'zh-CN');
  localStorage.setItem('heyta.theme', t);
}, theme);

/**
 * 量"这一档暗色到底暗了几层"。
 *
 * 取的是**同一屏上两个已知分属两层的节点**：
 *   - CSS 层：当前那一组的区块标题（`ht-settings__group-title` / `ht-settings__title`，web DOM，吃 CSS 变量）；
 *   - 共享层：作用域内**第一个带字面 `color:` 内联样式**的节点。
 *
 * 🔴 为什么"字面值"这个筛法是成立的、而不是图省事：web 侧的内联颜色一律写成
 * `cssVar('color.foreground')`（AGENTS §5 规则一禁裸值，`check:design` 拦），
 * 那种会跟着 CSS 变量走 —— 拿它当共享层，"两层同色"就**永远真**。
 * 只有 RNW 把 JS token 解析成字面色值写进 `style`，所以"字面 color ⇒ 共享层"是有规则背书的判据，
 * 不是碰运气。这条前提要现量，而且**命令本身要能筛掉 `var(`** —— 直接搜 `color: '` 会命中一堆
 * `color: 'var(--ht-color-…)'`（那些是 web 侧写的，会跟着 CSS 变量走，正是本判据要排除的形状）：
 *   `grep -rnE "color:[[:space:]]*['\\\"]" apps/web/src --include='*.tsx' | grep -v "var("`
 * ⇒ 渲染路径上应当**为空**（`check:design` 禁的就是组件里的裸色值）。写注释时别把两次的读数混起来。
 *
 * `sharedLayerFound` 必须入册：找不到就说明这一格量不到共享层，
 * 那是"一条没跑"而不是"跑过了且成立"（§7 第 227 条那一族）。
 * @param {any} page Playwright 页
 * @param {string} [scopeSelector] 作用域；不传就在整棵 document 里找
 */
async function themeLayerFacts(page, scopeSelector) {
  return page.evaluate(({ scope, plantIndex, plantColor }) => {
    // 🔴 `root` 在没命中时**退回整棵 document**，所以"这一格 0 枚候选"有两种读法：
    // 这一组里真没有带字面色的节点，或者那枚选择器根本没命中（改了 IA 的锚点 id 就会这样）。
    // 两种读法在候选数上一模一样 ⇒ 作用域命中与否必须自己交出来（下面 `scopeMatched`，另有那条判据）。
    const scopeEl = scope ? document.querySelector(scope) : null;
    const root = scopeEl ?? document;
    const title = root.querySelector('.ht-settings__group-title')
      ?? root.querySelector('.ht-settings__title')
      ?? document.querySelector('.ht-settings__group-title, .ht-settings__title');
    const literalColorNodes = [...root.querySelectorAll('[style]')].filter((el) => {
      const s = el.getAttribute('style') ?? '';
      return /(^|;)\s*color\s*:/.test(s) && !s.includes('var(');
    });
    // 🔴 这一枚"作用域内第一枚带字面 color 的节点"**不保证与 CSS 层量到的是同一角色**。
    // 2026-10-10 02:0x 两趟读数把这件事钉死了：主检出那棵树量到 30/30 且两枚节点恰好同色
    // （02:2x 再确认：那 30 格里 `sharedLayerSameRoleAsTitle` **全是 false** —— 量到的是「桌面小组件」这类卡片标题，
    //  CSS 层量的是分组标题，所以"同色"是同一枚 token 撞出来的，不是同一角色）；
    // 只含已提交内容那棵树（长页面 + 锚点 IA）在「同步与隐私」那一组量到的第一枚是**状态字**（muted 档），
    // 于是"两层不同色"比的是分组标题 vs 状态字（亮 15,23,42 vs 71,85,105；暗 241,245,249 vs 203,213,225 —— 两侧各自都跟着档位变了）。
    // 我试过改成"只认与 CSS 层同文字的那一枚"，**那一改是明确的退步，两趟读数各证一半**：
    // 主检出那棵树量到 0/30、只含已提交内容那棵树量到 0/24 ⇒ `darkTierReachesBothThemeLayers` 在**两棵树上都变成恒真**
    // （它对"没量到"的格子是 `!found || 同色`，空样本集恒过 —— AGENTS §7 元规则二那种最坏形状），
    // 同时把兄弟判据 `themeLayerRulerSwitchesWithTier` 饿死（它要求亮暗各至少一格量得到）。
    // 也就是说那一改没有把尺修准，只是把一条有牙的判据（r14 那臂量过）换成装饰。
    // ⇒ 选择规则退回原样，但**把角色信息随读数一起交出去**（`sharedLayerNodeText` / `sharedLayerSameRoleAsTitle` /
    // `sharedLayerCandidateCount`），让"这条红是尺挑错了节点"与"这条红是界面半暗"在报告里就分得开。
    const shared = literalColorNodes[0] ?? null;
    const titleText = title ? (title.textContent ?? '').trim() : '';
    return {
      scope: scope ?? '(document)',
      scopeMatched: Boolean(scopeEl),
      // 03:3x 补：把作用域内**每一枚**带字面 `color` 的节点一起交出去（至多 8 枚），
      // 好让"跟档"那条判据的样本不再只压在"第一枚"上 —— 第一枚在 30 格里都是同一枚卡片标题，
      // 于是配对数恒等于 1。配对是按节点文字认身份的，多几枚就多几对。
      // ⚠️ 下面那条 `shared*` 单节点字段**保留不动**：`darkTierReachesBothThemeLayers` 与 r14 那臂认的是它。
      sharedLayerCandidates: literalColorNodes.slice(0, 8).map((el, i) => ({
        text: (el.textContent ?? '').trim().slice(0, 60),
        // 种臂：这一枚的色值被装置钉住，不是界面交出去的（`carrier.plantedStuckTierIndex` 为证）
        color: i === plantIndex ? plantColor : getComputedStyle(el).color,
      })),
      datasetTheme: document.documentElement.dataset.theme ?? '(unset)',
      storedTheme: localStorage.getItem('heyta.theme') ?? '(unset)',
      cssLayerColor: title ? getComputedStyle(title).color : '(css title not found)',
      cssLayerTitleText: titleText || '(css title empty)',
      sharedLayerColor: shared ? getComputedStyle(shared).color : '(shared node not found)',
      sharedLayerNodeText: shared ? (shared.textContent ?? '').trim().slice(0, 60) : '(shared node not found)',
      sharedLayerSameRoleAsTitle: Boolean(shared && titleText && (shared.textContent ?? '').trim() === titleText),
      sharedLayerFound: Boolean(shared),
      sharedLayerCandidateCount: literalColorNodes.length,
    };
  }, { scope: scopeSelector ?? null, plantIndex: PLANT_STUCK_TIER_INDEX, plantColor: PLANTED_STUCK_TIER_COLOR });
}

async function captureReminder(browser, spec, mode) {
  const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, locale: 'zh-CN' });
  const page = await context.newPage();
  await seedStorage(page, spec.theme);
  if (mode === 'unsupported') {
    await page.addInitScript(() => Object.defineProperty(window, 'Notification', { configurable: true, value: undefined }));
  } else if (mode === 'error') {
    await page.addInitScript(() => {
      class SimulatedNotification { static permission = 'default'; static requestPermission() { return Promise.reject(new Error('simulated')); } }
      Object.defineProperty(window, 'Notification', { configurable: true, value: SimulatedNotification });
    });
  }
  if (isSimulatedMode(mode)) {
    // 无头拿不到这两态（上面那五条通道的实测），所以注入 `window.Notification`，
    // 与 unsupported / error 两档同一族做法。来源逐格写进 permissionSource，
    // 另有一条判据钉住"注入的必须标成注入"。真权限管道只有有头那一档算数。
    await page.addInitScript((perm) => {
      class SimulatedNotification {
        static permission = perm;
        static requestPermission() { return Promise.resolve(perm); }
      }
      Object.defineProperty(window, 'Notification', { configurable: true, value: SimulatedNotification });
    }, mode);
    await page.goto(`${ORIGIN}/?lang=zh-CN`);
  } else if (mode === 'granted' || mode === 'denied') {
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
  await openGroup(page, 'appearance');
  const panel = page.getByTestId('reminder-notify-panel');
  await panel.waitFor();
  // The appearance group is intentionally long. Bring the actual reminder
  // card into the viewport before the visual capture; otherwise a full-page
  // sheet screenshot mostly shows the section header and hides the subject of
  // this check below the fold.
  await panel.scrollIntoViewIfNeeded();
  const facts = await layoutFacts(page, 'reminder-notify-panel');
  const themeLayers = await themeLayerFacts(page, '#settings-group-appearance');
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
  // `browser` = 这一态是 Chromium 自己的权限决定；`injected` = 页面里的 `window.Notification`
  // 是本装置注入的（unsupported / error 一直是注入，default 与 granted 在无头下也只能注入）。
  // 这条字段存在的理由：不许让"注入出来的卡片"被读成"真权限管道验过了"。
  const permissionSource = mode === 'denied' || (HEADED && (mode === 'default' || mode === 'granted'))
    ? 'browser'
    : 'injected';
  return { theme: spec.theme, width: spec.width, mode, permissionSource, statuses, facts, themeLayers, screenshot };
}

async function dataJourney(browser, spec) {
  const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, locale: 'zh-CN', acceptDownloads: true });
  const page = await context.newPage();
  await seedStorage(page, spec.theme);
  await page.goto(`${ORIGIN}/?lang=zh-CN`);
  await decidePrivacy(page);
  const input = page.locator('input[placeholder^="添加任务"]');
  await input.fill(`数据管理响应式验收 ${spec.theme} ${spec.width}`);
  await page.getByTestId('capture-submit').click();
  await openGroup(page, 'data');
  const panel = page.getByTestId('data-settings-panel');
  await panel.waitFor();
  const before = await layoutFacts(page, 'data-settings-panel');
  // 数据管理这一面此前只被 CSS 那一层量过（`dataset.theme` 是探针自己写的，量不到共享层，
  // 成因见台账 00:5x 那格）。这一枚读数把它的共享层形状一起交出去，供配对判据用。
  const themeLayers = await themeLayerFacts(page, '#settings-group-data');
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
    theme: spec.theme, width: spec.width, before, themeLayers,
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
  await seedStorage(page, spec.theme);
  await page.goto(`${ORIGIN}/?lang=zh-CN`);
  await decidePrivacy(page);
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
  // 截图之前量：拍的就是被判据打分的那一屏。作用域收到当前这一组，是为了让"哪几组量得到"
  // 这件事**由读数回答**而不是由 import 猜：r13 实测这四组 24 格逐格 `sharedLayerFound=false`
  // （未登录态下 `PasswordPanel`/`SessionsPanel` 那些面板不渲染带字面内联色的节点），
  // 全装置只有「任务与显示」那一组量得到共享层（`themeRulerMeasuredCells` = 20 / 44）。
  // ⇒ 这两条判据守得住的就是那一格；别把它读成"每个设置组的暗色都两层对过账"。
  const themeLayers = await themeLayerFacts(page, `#settings-group-${group}`);
  await page.screenshot({ path: `${OUT}/${spec.theme}-${spec.width}-${group}.png`, fullPage: true });
  await context.close();
  return { theme: spec.theme, width: spec.width, group, navLabel, facts, planted, themeLayers };
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
  // 这一腿只有亮色一档，但**显式**写：不写就变成"依赖 Playwright 上下文的默认配色"，
  // 那是第三个会悄悄变的东西（同一族见 `seedStorage` 上面那段）。
  await seedStorage(page, 'light');
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
if (LEGS.includes('reminders')) {
  for (const spec of cases) {
    for (const mode of reminderModes) reminders.push(await captureReminder(browser, spec, mode));
  }
}
if (LEGS.includes('data')) {
  for (const spec of cases) data.push(await dataJourney(browser, spec));
}
/**
 * 「同步与隐私」那一组的**决定态**交互回归（UX-S9-139 那条裁决的常驻消费者）。
 *
 * 那两条裁决（🔴 「已同意」只给「撤回」、「还没选择」只给「重新选择」；以及「重新选择」开的是
 * **同一张**同意面板而不是第二份同意界面）以前只在写它的那天被手工点过，
 * **仓里没有任何一层在守**（`grep -rn privacy-revoke e2e/tests apps/web/tests` 现量 0 处），
 * 所以一次改文案就能把它悄悄反过来，而界面看起来仍然"有个按钮能点"。
 *
 * 🔴 **「只用本机」那一档该显示哪枚按钮，两棵树不一样**（10-09 15:0x 现量，别当成契约）：
 * `git show HEAD:apps/web/src/features/settings/PrivacyPanel.tsx` 的分叉条件是
 * `record === null` ⇒ 只要有过任何决定（含"只用本机"）就给「撤回」；
 * 工作树那版给的是 `record?.decision !== 'accepted'` ⇒ "只用本机"落到「重新选择」。
 * 后者**没有入库**：它依赖的 `SettingsNotice.tsx` 与 `privacy-settings.css` 在 HEAD 里不存在
 * （`git cat-file -e HEAD:…` 双双 rc≠0），属别人在飞的那半。
 * ⇒ 这一格**只入读数、不作判据**；下面的走查按界面上实际在场的那枚按钮走，两种形状都走得完。
 *
 * 一趟走完三态：**只用本机 / 已同意 / 还没选择**，每态各读一次 DOM 并各拍一张图。
 * 🔴 三态都要**真到达**：只测当前那一态的话，「已同意只给撤回」「没选择只给重新选择」这两条
 * 判据就是在对它们根本没见过的状态打分 —— 而这两态恰恰是按钮最容易长反的一对。
 */
async function privacyReadState(page) {
  return page.evaluate(() => {
    const group = document.getElementById('settings-group-sync');
    const panel = group?.querySelector('[data-testid="privacy-panel"]') ?? null;
    const count = (id) => (panel?.querySelectorAll(`[data-testid="${id}"]`) ?? []).length;
    const text = (id) => panel?.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() ?? null;
    return {
      theme: document.documentElement.dataset.theme ?? 'light',
      panelVisible: Boolean(panel) && panel.getBoundingClientRect().height > 0,
      // 这一份只入读数：整份文档里`privacy-panel`有几枚。第一次真跑时"文档里点得到、
      // 组内数不到"把我带偏过一次（真因见下面 `clickAction` 那段注释），所以留这一栏。
      panelInstances: document.querySelectorAll('[data-testid="privacy-panel"]').length,
      chooseAgain: count('privacy-choose-again'),
      revoke: count('privacy-revoke'),
      chooseLabel: text('privacy-choose-again'),
      revokeLabel: text('privacy-revoke'),
      // 决定态那句话在两棵树里挂在不同结构上（HEAD 是 `p.ht-settings__hint[data-testid=privacy-state]`，
      // 未提交那版把它换成了 `SettingsNotice`）—— testid 两边都在，所以只认 testid。
      stateText: text('privacy-state'),
      // 提示语**只入读数**：HEAD 那份是一句固定的 `revokeHint`，未提交那版才按决定态切换。
      // 把"提示语跟着状态走"写成判据，等于把别人在飞的那半源码当成已入库的契约。
      hints: [...(panel?.querySelectorAll('p[class*="__hint"]') ?? [])].map((p) => p.textContent?.trim() ?? ''),
      // 全文档只许有一张同意面板：第二份就是"另建一套同意界面"，那条纪律的机器尺。
      consentDialogs: document.querySelectorAll('[data-testid="privacy-consent-dialog"]').length,
      notPersistedNotice: count('privacy-revoke-not-persisted'),
    };
  });
}

/**
 * 同意之后被弹出来的登录引导，用它**自己的**关闭把手收掉。
 *
 * 🔴 为什么不能用 Escape：10-09 15:2x 第三趟实测 —— 那一记 Escape 关掉的不是这张模态
 * （它把设置浮层带走了，而 `auth-form-close` 那张面还在），于是后面每一步都对着空 DOM 量，
 * 报错形状是一个 `account-menu-avatar … element is not visible` 的 30s 超时堆栈。
 * 收不掉就响亮地抛，别让它伪装成"这一族没红"。
 */
async function dismissSignInModal(page, where) {
  const modal = page.locator('.ht-sheet__auth');
  if ((await modal.count()) === 0) return { appeared: false, closedBy: null };
  const closer = page.getByTestId('auth-form-close');
  let closedBy = null;
  if ((await closer.count()) === 1) {
    await closer.click({ timeout: 8_000 }).catch(() => undefined);
    closedBy = 'auth-form-close';
  } else {
    await page.keyboard.press('Escape');
    closedBy = 'escape';
  }
  const gone = await modal.waitFor({ state: 'detached', timeout: 6_000 }).then(() => true).catch(() => false);
  if (!gone) {
    throw new Error(`「${where}」之后弹出来的登录引导关不掉（试了 ${closedBy}，`.concat(
      '`auth-form-close` 命中数不是 1 就退到 Escape）—— 这一腿剩下的读数会全部对着被盖住的界面拍，别当通过。',
    ));
  }
  return { appeared: true, closedBy };
}

/**
 * 「同步与隐私」那一组的决定态走查。三态各读一次 DOM、各拍一张图，逐条见上面的注释块。
 *
 * 🔴 走查的起点是**首启那张面板上点「同意」**，不是点「只用本机」。理由不是省事：
 * 「已同意」这一档在**两棵树里都给「撤回」**，所以整条路不需要按树分叉；
 * 而「只用本机」那一档两棵树给的是不同按钮（现量见上面那段），一开始就从它走就必须写分叉，
 * 第一趟那个 `if (local.revoke === 1)` 就是这么来的 —— 分叉本身就是第二处会错的地方。
 * 「只用本机」仍然被走到：它是**最后一步**（从「重新选择」开的面板里点它），
 * 那一格的按钮归属只入读数、不作判据。
 *
 * 🔴 三处"探针必须先把自己弄对"的地方，都是 10-09 连着三趟照出来的，别当风格问题删：
 * 1. **主题走应用自己的机制**（`heyta.theme` 那一键），不直接改 `dataset.theme`。
 *    `apps/web/src/lib/theme.ts` 写着启动时 `applyTheme(resolveInitialTheme())`，手工挂上去的
 *    属性会被盖回 `light` —— 那趟暗色那格读到的就是 light，而 `panelVisible` 照样为真（假绿形状）。
 * 2. **决定之后要等界面落定**，不是睡固定毫秒。那趟 `accept()` 之后 250ms 就去读，读到的是
 *    上一条决定，于是"已同意"这一格整条判据都在对一个没到达的状态打分。这里改成**有界轮询**：
 *    等动作按钮（`readSettled`）或等那句话变口（`readLabelChanged`），最多 6s；
 *    等不到也返回读数并记 `settled:false` —— 判据据实判，等待是为了让红指对地方。
 * 3. **点之前先把控件滚进视口、再量命中**。375 那一档 `elementFromPoint` 曾返回 null
 *    （按钮在 812 高的视口之外）—— 那**不是**"被盖住"，是探针没把东西搬到眼前
 *    （AGENTS §6.2「滚动后重新读 bounds」同一族）。
 */
async function syncPrivacyJourney(browser, spec) {
  const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, locale: 'zh-CN' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(([, theme]) => {
    localStorage.setItem('heyta.locale', 'zh-CN');
    if (theme) localStorage.setItem('heyta.theme', theme);
  }, ['zh-CN', spec.theme === 'dark' ? 'dark' : null]);
  await page.goto(`${ORIGIN}/?lang=zh-CN`);

  // 起点：首启那张同意面板必须真的在场（不在场就说明这棵树没有同意闸，下面的读数全部作废）。
  const dialog = page.getByTestId('privacy-consent-dialog');
  const dialogSeen = await dialog.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
  if (!dialogSeen) {
    await context.close();
    throw new Error(`首启同意面板没出现 —— 这一趟没有"决定"可测，别把下面的读数当通过（载体 ${spec.theme}/${spec.width}）`);
  }
  await page.getByTestId('privacy-consent-accept').click();
  await dialog.waitFor({ state: 'detached' });
  // 未提交那版的 `accept()` 会顺手 `openSignIn()`（HEAD 的 `onClick={accept}` 不会）。
  const signInAfterAccept = await dismissSignInModal(page, '首启点同意');

  await openGroup(page, 'sync');
  // 起点态（还没做决定）的两层形状：与数据管理那一腿同理，这一面此前只有 CSS 层被量过。
  const themeLayers = await themeLayerFacts(page, '#settings-group-sync');
  const states = [];
  const screenshots = [];
  const shot = async (name) => {
    const path = `${OUT}/sync-privacy-${name}-${spec.theme}-${spec.width}.png`;
    await page.screenshot({ path });
    screenshots.push(path.split('/').pop());
  };

  // 有界落定之前先确认面板还在 DOM 里。第三趟就是这里死的：Escape 把设置浮层带走了，
  // 于是后面每一步都对着 null 量。这里把它变成一句能读的报错，并把"还回得来"记成读数。
  let renavigations = 0;
  const ensurePanel = async (why) => {
    const alive = await page.evaluate(() =>
      Boolean(document.querySelector('#settings-group-sync [data-testid="privacy-panel"]')));
    if (alive) return true;
    await openGroup(page, 'sync');
    const back = await page.evaluate(() =>
      Boolean(document.querySelector('#settings-group-sync [data-testid="privacy-panel"]')));
    if (!back) {
      throw new Error(`设置面在「${why}」之后回不来（组内那枚 privacy-panel 不在 DOM 里）—— 这一格不能当通过（载体 ${spec.theme}/${spec.width}）`);
    }
    renavigations += 1;
    return true;
  };

  // 🔴 有界落定：轮询到"期望那枚动作按钮在组内那枚面板里出现"为止，最多 6s。
  // 到点没等到也返回读数并记 `settled:false` —— 后面的判据据实判，不靠等待造绿。
  const readSettled = async (expect) => {
    await ensurePanel(`等 ${expect}`);
    const t0 = Date.now();
    for (;;) {
      const s = await privacyReadState(page);
      if (s[expect] === 1) return { ...s, settledMs: Date.now() - t0, settled: true };
      if (Date.now() - t0 > 6_000) return { ...s, settledMs: Date.now() - t0, settled: false };
      await page.waitForTimeout(150);
    }
  };
  // 另一档落定判据：「我说完一句话，界面那句话得跟着变」。它不比"按钮是哪一枚"更绑源码，
  // 所以能用在不分叉的那一步（重新决定成「只用本机」之后）。
  const readLabelChanged = async (prevText) => {
    await ensurePanel('等决定改口');
    const t0 = Date.now();
    for (;;) {
      const s = await privacyReadState(page);
      if (s.stateText !== prevText) return { ...s, settledMs: Date.now() - t0, settled: true };
      if (Date.now() - t0 > 6_000) return { ...s, settledMs: Date.now() - t0, settled: false };
      await page.waitForTimeout(150);
    }
  };

  const clicks = [];
  const clickAction = async (testId) => {
    await ensurePanel(`点 ${testId} 之前`);
    const hit = await page.evaluate(async (id) => {
      const panel = document.querySelector('#settings-group-sync [data-testid="privacy-panel"]');
      const el = panel?.querySelector(`[data-testid="${id}"]`) ?? null;
      const label = (n) => {
        if (!(n instanceof Element)) return null;
        const cls = (n.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)[0] ?? '';
        const tid = n.getAttribute('data-testid');
        return `${n.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${tid ? `[${tid}]` : ''}`;
      };
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      if (!el) return { present: false, reachable: false, onScreen: false, top: null, rect: null, viewport };
      // 先滚进视口再量：`elementFromPoint` 吃的是视口坐标。
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = el.getBoundingClientRect();
      const cx = Math.round(r.x + r.width / 2);
      const cy = Math.round(r.y + r.height / 2);
      const top = document.elementFromPoint(cx, cy);
      return {
        present: true,
        // 命中测试的判法：`elementFromPoint` 返回该点上最内层的元素。按钮真的在最前面时，
        // 它要么就是按钮本身，要么是按钮的后代；被别的东西盖住时，两者都不成立。
        reachable: top === el || el.contains(top),
        onScreen: r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth,
        topInsidePanel: Boolean(top && panel.contains(top)),
        top: label(top),
        ownLabel: label(el),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        viewport,
      };
    }, testId);
    let via = 'pointer';
    let note = null;
    if (!hit.reachable) {
      // 鼠标点不到 ⇒ 用 DOM 层的 click 把旅程走完：**读数照记、判据照红**，
      // 只是不让一层遮挡把后面三态的判据一起带走（崩溃会让整腿零读数）。
      via = 'dom-fallback';
      await page.evaluate((id) => document.querySelector(`#settings-group-sync [data-testid="privacy-panel"] [data-testid="${id}"]`)?.click(), testId);
    } else {
      try {
        await page.getByTestId(testId).click({ timeout: 8_000 });
      } catch (e) {
        // 命中测试说能点到、真点却超时：这是"载体在抖"还是"界面在骗人"，**不能靠猜**。
        // 记下报错首行再走 DOM 兜底，红照样红，但红里带着可复现的坐标。
        via = 'pointer-timeout';
        note = String(e).split('\n')[0];
        await page.evaluate((id) => document.querySelector(`#settings-group-sync [data-testid="privacy-panel"] [data-testid="${id}"]`)?.click(), testId);
      }
    }
    clicks.push({ testId, ...hit, via, note });
  };

  // ── 走查：已同意 → 撤回 → 还没选择 → 重新选择(开同一张面板) → 只用本机 ──
  const accepted = await readSettled('revoke');
  states.push({ reached: 'accepted', ...accepted, signInAfterAccept });
  await shot('1-accepted');

  await clickAction('privacy-revoke');
  const undecided = await readSettled('chooseAgain');
  states.push({ reached: 'undecided', ...undecided });
  await shot('2-undecided');

  await clickAction('privacy-choose-again');
  const reopened = await dialog.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
  const whileOpen = await privacyReadState(page);
  await shot('3-reopen-dialog');
  // 这一次点「只用本机」而不是「同意」：同意的副作用是把登录引导弹出来，会挡住后面的读数。
  await page.getByTestId('privacy-consent-local-only').click();
  await dialog.waitFor({ state: 'detached' });
  const reopen = { reopenedFromChooseAgain: reopened, dialogsWhileOpen: whileOpen.consentDialogs };
  states.push({ reached: 'local-only', ...(await readLabelChanged(undecided.stateText)) });
  await shot('4-local-only');

  // 🔴 牙：往运行时 DOM 里种两枚坏，上面那把尺必须都数得到。数不到就说明
  // `privacyReadState` 的计数是恒 0 的装饰（同一族前科：不能失败的检查没有价值）。
  await ensurePanel('种坏臂之前');
  const planted = await page.evaluate(() => {
    const panel = document.querySelector('#settings-group-sync [data-testid="privacy-panel"]');
    const actionSel = '[data-testid="privacy-choose-again"], [data-testid="privacy-revoke"]';
    const actionBefore = panel.querySelectorAll(actionSel).length;
    panel.querySelector(actionSel)?.remove();
    const actionAfter = panel.querySelectorAll(actionSel).length;
    const dialogsBefore = document.querySelectorAll('[data-testid="privacy-consent-dialog"]').length;
    const fake = document.createElement('div');
    fake.setAttribute('data-testid', 'privacy-consent-dialog');
    document.body.append(fake);
    const dialogsAfter = document.querySelectorAll('[data-testid="privacy-consent-dialog"]').length;
    fake.remove();
    return { actionBefore, actionAfter, dialogsBefore, dialogsAfter };
  });

  await context.close();
  return {
    theme: spec.theme,
    width: spec.width,
    height: spec.height,
    themeLayers,
    states,
    screenshots,
    clicks,
    reopen,
    renavigations,
    planted,
    pageErrors: errors,
  };
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
if (LEGS.includes('groups')) {
  for (const spec of sweepCases) for (const group of sweepGroups) groups.push(await captureGroup(browser, spec, group));
}
// UX-S9-44 验收列的视口口径：375/768/1440。这一趟只量几何（换行与列宽），
// 主题不影响盒模型，暗色那一档由上面 24 格与 help-entry-ux 各自覆盖。
const helpWrapWidths = [375, 768, 1440];
if (LEGS.includes('help')) {
  for (const width of helpWrapWidths) helpWrap.push(await captureHelpWrap(browser, width));
}
// 「同步与隐私」决定态那一腿的格子：三张（明 1440 / 暗 1440 / 明 375），每张走完整三态。
// 视口跟着这一腿自己要答的问题：桌面那一档看整屏，375 那一档看窄屏下按钮与提示会不会挤。
const syncCases = [
  { theme: 'light', width: 1440, height: 900 },
  { theme: 'dark', width: 1440, height: 900 },
  { theme: 'light', width: 375, height: 812 },
];
if (LEGS.includes('sync')) {
  for (const spec of syncCases) syncPrivacy.push(await syncPrivacyJourney(browser, spec));
}
await browser.close();

// 每根断言属于哪条腿。**这张表本身就是分母自检的对象**：新加一条断言而忘了登记归属，
// 下面那次 `unmapped` 检查会直接抛（否则它会以"恒真的空集合判定"混进 notJudged 之外，
// 让人误读成"这一趟判过了"）。
const assertionOwner = {
  noHorizontalOverflow: ['reminders', 'data'],
  allPermissionStatesRendered: ['reminders'],
  everyCaseCoversEverySelectedMode: ['reminders'],
  reminderPermissionProvenanceIsLabeled: ['reminders'],
  darkTierReachesBothThemeLayers: ['reminders', 'groups'],
  themeLayerRulerSwitchesWithTier: ['reminders', 'groups', 'data', 'sync'],
  plantedThemeSampleTookEffect: ['reminders', 'groups'],
  themeRulerScopesAllMatched: ['reminders', 'groups', 'data', 'sync'],
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
  syncPrivacyThreeStatesReached: ['sync'],
  syncPrivacyPanelVisibleAndThemeApplied: ['sync'],
  syncPrivacyExactlyOneActionPerState: ['sync'],
  syncPrivacyAcceptedShowsOnlyRevoke: ['sync'],
  syncPrivacyRevokeReturnsToChooseAgain: ['sync'],
  syncPrivacyReopenUsesOneAndOnlyOneDialog: ['sync'],
  syncPrivacyEveryStateSettled: ['sync'],
  syncPrivacyConsentDialogUnmountedAfterDecide: ['sync'],
  syncPrivacyDecisionButtonsPointerReachable: ['sync'],
  syncPrivacyBadArmsFlipTheRuler: ['sync'],
};
const TRACKING_ASSERTIONS = ['everySelectedLegProducedItsCells', 'unselectedLegsReportEmpty'];
// 按"怎么到达"取那一态的读数（不是按界面文案取 —— 文案是词条表的账，改一个字就该红的是词条对账，
// 不是这条交互判据）。两棵树的走查顺序不同，但三态都真到达过，所以按到达方式取是稳的。
const privacyRole = (cell, name) => cell.states.find((s) => s.reached === name) ?? null;
const legCells = { reminders: reminders.length, data: data.length, groups: groups.length, help: helpWrap.length, sync: syncPrivacy.length };
const expectedLegCells = {
  reminders: cases.length * reminderModes.length,
  data: cases.length,
  groups: sweepCases.length * sweepGroups.length,
  help: helpWrapWidths.length,
  sync: syncCases.length,
};

// 两层对账尺子的样本：提醒腿（任务与显示组）与分组走查腿（四组）都各交一份。
// 两条判据合起来才是完整的：只量得到几组，看 `themeRulerMeasuredCells`。
const themeRulerCells = [
  ...reminders.map((x) => ({ ...x.themeLayers, theme: x.theme, leg: 'reminders' })),
  ...groups.map((x) => ({ ...x.themeLayers, theme: x.theme, leg: 'groups', group: x.group })),
];

// 两层对账的**配对**样本：同一枚节点（同腿 / 同组 / 同作用域 / 同文字）在亮暗两档各量到一次才算一对。
// 为什么要这一层：`darkTierReachesBothThemeLayers` 比的是两枚**不同角色**的节点是否同色（见那条断言里的限定），
// 换一棵 IA 就不可比（2026-10-10 02:0x 在只含已提交内容那棵树上就是这么判假的）。
// 而"同一枚节点在两档之间色值必须变"与角色无关 —— 半暗那种坏法恰好就是它不变。
// 配对判据吃的格子集合，比 `themeRulerCells` **宽两条腿**：数据管理与同步与隐私也进来。
// 🔴 为什么两条判据不共用一个集合：`darkTierReachesBothThemeLayers` 的谓词是"同一档内那两枚节点同色"，
// 而那两枚的角色不对等已被 02:2x 那格钉死（它比的是卡片标题 vs 分组标题）。把它扩到更多面，
// 只会按面对象多造"标题 vs 状态字"那种**已知不可比**的假红，不会多证一件事；
// 而配对那条与角色无关（它要的是"同一枚节点跨档必须变"），扩它才有意义。
const themeRulerPairCells = [
  ...themeRulerCells,
  ...data.map((x) => ({ ...x.themeLayers, theme: x.theme, leg: 'data' })),
  ...syncPrivacy.map((x) => ({ ...x.themeLayers, theme: x.theme, leg: 'sync' })),
];

const themeRulerPairIndex = new Map();
for (const cell of themeRulerPairCells.filter((x) => x.sharedLayerFound)) {
  // 03:3x 起：样本从"每格第一枚"扩到"每格每一枚"（`sharedLayerCandidates`）。
  // 节点身份仍按**文字**认（同一作用域内同一文字的节点在亮暗两档各量到一次才算一对），
  // 没有这枚字段的格子退回单节点字段，所以这条扩样不会把已有配对清零。
  const samples = (cell.sharedLayerCandidates ?? []).length > 0
    ? cell.sharedLayerCandidates
    : [{ text: cell.sharedLayerNodeText, color: cell.sharedLayerColor }];
  for (const sample of samples) {
    const key = `${cell.leg}|${cell.group ?? ''}|${cell.scope}|${sample.text}`;
    const row = themeRulerPairIndex.get(key) ?? {};
    row[cell.theme] = { shared: sample.color, css: cell.cssLayerColor };
    themeRulerPairIndex.set(key, row);
  }
}
const themeRulerPairs = [...themeRulerPairIndex.values()].filter((row) => row.light && row.dark);

const report = {
  origin: ORIGIN,
  carrier: {
    headless: !HEADED,
    // 这行读数指认的那棵树与那版装置（成因见上面 `TREE` 的注释块）。
    tree: TREE,
    legs: LEGS,
    skippedLegs: ALL_LEGS.filter((l) => !LEGS.includes(l)),
    legCells,
    expectedLegCells,
    reminderModes,
    // 这两态在无头里**拿不到真权限决定**，改成注入（注入的格在 `permissionSource` 里逐格标出）。
    // 实测过五条通道都回 `denied`：`grantPermissions`、CDP `Browser.setPermission('granted')`、
    // 页面里真调 `requestPermission()`、`--headless=new`、`--disable-features/--enable-features` 组合。
    injectedReminderModes: HEADED ? [] : SIMULATED_WHEN_HEADLESS,
    // 暗/亮两档怎么驱动的：走应用自己那条（`localStorage['heyta.theme']`），
    // **不是**直接写 `<html data-theme>` —— 后者只搬得动 CSS 那一层，共享层组件不读它。
    themeCarrier: "localStorage['heyta.theme']（= 产品自己那条开关）",
    // 这把尺子实际量到共享层节点的格数（读数，不是判据）：0 就说明两条判据都在空转。
    themeRulerMeasuredCells: themeRulerCells.filter((x) => x.sharedLayerFound).length,
    themeRulerSampleCells: themeRulerCells.length,
    // 配对上的"同一枚节点 × 亮暗两档"有几对：`themeLayerRulerSwitchesWithTier` 只在它 > 0 时才在判事。
    // ⚠️ 03:4x 起这一枚的口径是**配对到的节点数**，不是格子数（一格最多交 8 枚候选，同文字会并成一条键）。
    themeLayerRulerPairedCells: themeRulerPairs.length,
    // 配对那条吃的格子集合（比上面两枚的集合宽：多了数据管理与同步与隐私两条腿）。
    themeRulerPairSampleCells: themeRulerPairCells.length,
    themeRulerPairMeasuredCells: themeRulerPairCells.filter((x) => x.sharedLayerFound).length,
    // 种臂的身份：-1 = 这趟的每枚色值都来自界面本身；≥0 = 该臂号那枚共享层候选被装置钉住了（见那条判据）。
    plantedStuckTierIndex: PLANT_STUCK_TIER_INDEX,
    realPermissionModes: HEADED
      ? ['default', 'granted', 'denied']
      : ['denied'],
    injectionReason: HEADED
      ? null
      : 'default 与 granted 在无头 Chromium 里都会退化成 denied（2026-10-09 实测，2026-10-10 又按五条通道各测一遍），而无头是不抢前台的唯一一档（AGENTS §6.2 规定二）⇒ 这两态的**卡片渲染**由注入覆盖，**真权限管道**只有有头那一档算数',
  },
  cases,
  reminders,
  data,
  sweepGroups,
  sweepCases,
  groups,
  helpWrapWidths,
  helpWrap,
  syncCases,
  syncPrivacy,
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
    // ── 注入的必须标成注入（2026-10-10：无头拿不到 default/granted 的真权限决定，改成注入渲染）──
    // 这条钉的不是界面，是**这份读数的身份**：哪一格来自 Chromium 的权限决定、哪一格来自装置注入。
    // 它的坏形状很具体 —— 哪天有人把 `permissionSource` 写死成 'browser'，或把 denied 也改成注入，
    // 上面所有判据照样全绿，而报告会把"注入出来的卡片"写成"真权限管道验过了"。
    reminderPermissionProvenanceIsLabeled: reminders.length > 0
      && reminders.every((x) => {
        const expected = x.mode === 'denied' || (HEADED && (x.mode === 'default' || x.mode === 'granted'))
          ? 'browser' : 'injected';
        return x.permissionSource === expected
          // 注入那几格还必须真的读到注入值，否则"标了 injected 其实什么都没注入"也是一格假读数
          && (x.permissionSource === 'browser' || x.statuses.permission === x.mode || x.mode === 'error' || x.mode === 'unsupported');
      })
      && reminders.filter((x) => x.permissionSource === 'browser').every((x) => x.statuses.permission === x.mode),
    // ── 暗色档必须两层都暗（2026-10-10：载体以前只搬得动 CSS 那一层，共享层没跟着换）──
    // 产品的暗色由同一个状态喂两层（`applyTheme(theme)` + `resolveHeytaUiTheme({ scheme: theme })`），
    // 所以"两层不同色"只可能是载体没走那条路。实测见 `scripts/qa/probe-theme-layer.mjs`。
    // 🔴 这条断言的**真实谓词比它的名字弱一档**（02:2x 两趟读数钉的）：它比的是"作用域内第一枚带字面色的
    // 共享层节点"与"分组标题"在**同一档下是否同一个色值**，而这两枚在两棵树上都不是同一角色
    // （主检出 30/30 格 `sharedLayerSameRoleAsTitle` 全 false，量到的是卡片小标题；载体那棵是状态字）。
    // 它仍然抓得住半暗 —— 半暗时两侧色值必然分开（r14 那臂就是这么打红的）—— 但**不许读成"同一角色的两层一致"**。
    // 键名不改：改了会把 r14 那臂与台账引用搬断。角色信息随读数一起给（`sharedLayerNodeText` 等四枚）。
    darkTierReachesBothThemeLayers: themeRulerCells.length > 0
      && themeRulerCells.every((x) => !x.sharedLayerFound
        || x.sharedLayerColor === x.cssLayerColor),
    // 上一条对"共享层节点没量到"是放过的 ⇒ 尺子自己要有一条不空转的对账。
    // 02:3x 起这条**按节点身份配对**（不再只比样本集第一格）：键 = `腿|组|作用域|节点文字`；
    // 03:4x 起样本再厚一档 —— 每格交出**每一枚**带字面 `color` 的节点（至多 8 枚），不再只有第一枚。
    // 判的是：至少 1 对，且**每一对的两层色值都跨档变过**（0 对判假，不放行）。
    // 而"半暗"那种坏法（只写 `dataset.theme`）恰好被它抓到：那时两层各自内部一致、
    // 只是暗档的共享层色**等于亮档**，配对之后那一格就再也混不过去。（AGENTS §7 元规则二）
    themeLayerRulerSwitchesWithTier: themeRulerPairs.length > 0
      && themeRulerPairs.every((row) => row.light.shared !== row.dark.shared
        && row.light.css !== row.dark.css),
    // 种臂（`carrier.plantedStuckTierIndex`）的自证：种了就必须真的钉住 ≥1 枚候选。
    // 没有这条，"这一臂把配对判据打红了"与"这一臂什么都没种上、红是别处来的"在输出上长一样。
    plantedThemeSampleTookEffect: PLANT_STUCK_TIER_INDEX < 0
      || themeRulerCells.some((cell) => (cell.sharedLayerCandidates ?? [])
        .some((c, i) => i === PLANT_STUCK_TIER_INDEX && c.color === PLANTED_STUCK_TIER_COLOR)),
    // 🔴 作用域没命中会**静默退回整棵 document**（那一步就写在 `themeLayerFacts` 里），于是"这一格 0 枚候选"
    // 分不清是"这一组真没有带字面色的节点"还是"锚点 id 被改了"。这条把它从歧义读数变成响亮失败；
    // 它的坏形状是现成的：把传进去的那枚 `#settings-group-*` 改掉，配对集合还会非空、
    // `sharedLayerFound` 还可能因为 document 兜底而为真，只有这一条会红。
    themeRulerScopesAllMatched: themeRulerPairCells.length > 0
      && themeRulerPairCells.every((x) => x.scopeMatched === true),
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
    // ── 「同步与隐私」决定态（UX-S9-139 那条裁决的常驻消费者；此前仓里零层在守）──
    // 分母自检同 help 那族：`.every` 对空集合是真，所以"三态真到达了"必须先钉住，
    // 否则后面每一条都在对没见过的状态打分（这一族最典型的假绿形状）。
    syncPrivacyThreeStatesReached: syncPrivacy.every((x) =>
      ['local-only', 'undecided', 'accepted'].every((r) => privacyRole(x, r) !== null) &&
      // 三态那句话必须互不相同：如果"已同意"与"还没选择"渲染成同一句，界面上就没有决定可言，
      // 而按钮判据仍然可以全绿（它只看两枚 testid 的枚数）。
      new Set(['local-only', 'undecided', 'accepted'].map((r) => privacyRole(x, r).stateText)).size === 3),
    syncPrivacyPanelVisibleAndThemeApplied: syncPrivacy.every((x) =>
      x.states.every((s) => s.panelVisible && s.theme === x.theme)),
    // 每一态**恰好一枚**决定动作：两枚都在=用户看见两个出口，一枚都不在=死胡同（撤回变成永久决定）。
    syncPrivacyExactlyOneActionPerState: syncPrivacy.every((x) =>
      x.states.every((s) => s.chooseAgain + s.revoke === 1)),
    syncPrivacyAcceptedShowsOnlyRevoke: syncPrivacy.every((x) => {
      const a = privacyRole(x, 'accepted');
      return a !== null && a.revoke === 1 && a.chooseAgain === 0 && Boolean(a.revokeLabel);
    }),
    // 撤回之后必须回到「重新选择」那一档 —— 这是 PIPL 第 15 条"便捷的撤回方式"的**后半句**：
    // 改主意的入口也得在。两棵树里 `undecided` 这一态都是撤回之后读到的，所以这条不绑在别人未提交的那半。
    syncPrivacyRevokeReturnsToChooseAgain: syncPrivacy.every((x) => {
      const u = privacyRole(x, 'undecided');
      return u !== null && u.chooseAgain === 1 && u.revoke === 0 && Boolean(u.chooseLabel);
    }),
    syncPrivacyReopenUsesOneAndOnlyOneDialog: syncPrivacy.every((x) =>
      x.reopen?.reopenedFromChooseAgain === true && x.reopen?.dialogsWhileOpen === 1),
    // 🔴 每一态的"等界面落定"必须真的落定。少了这条，读早一步会伪装成"那一态就是这个样子"——
    // 第二趟的四条红全是这个形状（等 250ms 不够，「已同意」那格装的是同意之前的 DOM）。
    syncPrivacyEveryStateSettled: syncPrivacy.every((x) => x.states.every((s) => s.settled === true)),
    syncPrivacyConsentDialogUnmountedAfterDecide: syncPrivacy.every((x) =>
      x.states.every((s) => s.consentDialogs === 0)),
    // 🔴 「在场、可见、稳定」三句话加起来仍然点不到 —— 本腿第一次真跑(10-09 15:1x)就是被
    // 一层 `aria-hidden` 的登录引导装饰面盖住的。上面 `exactlyOneAction` 那几条只数 DOM 里的枚数，
    // 数不出"这枚按钮在真人鼠标底下够不够得着"，所以命中测试单独钉一条（形状见 §6.2 规定一：
    // 断言只会验界面写了什么，不会验界面少了什么 / 被什么盖住）。
    syncPrivacyDecisionButtonsPointerReachable: syncPrivacy.every((x) =>
      x.clicks.length >= 2 && x.clicks.every((c) => c.present && c.reachable && c.via === 'pointer')),
    // 🔴 牙：种进运行时 DOM 的两枚坏必须都数得到。这条转红说的是"上面那几条 counting 已经变成恒 0 的装饰"，
    // 不是界面坏了 —— 和 `groupSweepOffViewportRulerHasTeeth` 同一个用途。
    syncPrivacyBadArmsFlipTheRuler: syncPrivacy.every((x) =>
      x.planted.actionBefore === 1 && x.planted.actionAfter === 0 &&
      x.planted.dialogsAfter === x.planted.dialogsBefore + 1),
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
