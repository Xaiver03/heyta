/**
 * 产品截图执行器。
 *
 *   pnpm screenshot:list                 # 只列出目标，不截图
 *   pnpm screenshot:capture              # 截全部（需要站点已在本地起好）
 *   pnpm screenshot:capture -- --only W01
 *   pnpm screenshot:app-store            # 按 App Store 尺寸截 iPhone/iPad/Mac
 *
 * 移植自 SSOS 的思路（声明式目标 + 就绪门控 + 遮挡物处理 + 生产硬闸门），
 * 但用本仓库已有的 **Playwright**（`~/node_modules/playwright`），不引入 puppeteer。
 *
 * ── 三条设计约束，都是踩过的坑 ────────────────────────────────────────────
 *
 * 1. **等文案，不等时间。** 固定 `sleep` 在快机器上浪费、在慢机器上截到半成品。
 *    `readyText` 同时验证"渲染出来了"和"渲染的是对的那个页面"。
 * 2. **web 的视图靠点标签，不靠改 URL。** 见 `targets.mjs` 的说明 ——
 *    `apps/web` 的视图是 React state，goto 同一个 URL 会得到同一个视图。
 * 3. **🔴 生产环境要显式开闸。** 只认 `HEYTA_ALLOW_PRODUCTION=1`。
 *    默认只允许 localhost / 127.0.0.1 —— 免得手一抖把真实用户数据截进仓库。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright';

import { inspectPng, looksBlank } from './png-stats.mjs';
import { settleForShot } from './head-reveal.mjs';
import { APP_STORE_DEVICES, ARTIFACT_ROOT, DEVICES, SITES, TARGETS, artifactName, expectedGroups } from './targets.mjs';

const root = process.cwd();

/** 生产闸门：只有 localhost 免开闸，其余一律要显式环境变量。 */
function assertSafeUrl(baseUrl) {
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(baseUrl);
  if (isLocal) return;
  if (process.env.HEYTA_ALLOW_PRODUCTION === '1') {
    console.warn(`  ⚠️  目标是非本地地址（${baseUrl}）—— 因为你设置了 HEYTA_ALLOW_PRODUCTION=1 才继续`);
    return;
  }
  throw new Error(
    `拒绝对非本地地址截图：${baseUrl}\n` +
      `   截图可能包含真实用户数据。确实要这么做就设 HEYTA_ALLOW_PRODUCTION=1。`,
  );
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index > -1 ? process.argv[index + 1] : undefined;
}

const only = argValue('--only');
const deviceOverride = argValue('--device');
const appStore = process.argv.includes('--app-store');
const listOnly = process.argv.includes('--list');

if (listOnly) {
  for (const group of expectedGroups()) {
    console.log(`\n${group.label}  (${group.targets.length} 张)`);
    for (const target of group.targets) {
      console.log(`  ${target.id}  ${artifactName(target).padEnd(26)} readyText="${target.readyText}"`);
    }
  }
  process.exit(0);
}

// ── 组装要截的清单 ─────────────────────────────────────────────────────
let jobs = [];
if (appStore) {
  const appStoreTargets = TARGETS.filter((t) => t.appStore);
  for (const device of Object.values(APP_STORE_DEVICES)) {
    for (const target of appStoreTargets) {
      jobs.push({
        target,
        device,
        folder: `app-store/${device.id}`,
        // App Store 用固定视口，忽略 target.device
      });
    }
  }
} else {
  for (const group of expectedGroups()) {
    for (const target of group.targets) {
      const device = deviceOverride ? DEVICES[deviceOverride] : DEVICES[target.device];
      jobs.push({ target, device, folder: group.folder });
    }
  }
}

if (only) jobs = jobs.filter((job) => job.target.id === only);
if (jobs.length === 0) {
  console.error('没有匹配的目标');
  process.exit(1);
}

for (const site of Object.values(SITES)) assertSafeUrl(site.baseUrl);

console.log(`准备截 ${jobs.length} 张\n`);

const browser = await chromium.launch();
const written = [];
const failed = [];

/**
 * 点掉遮挡物（引导弹窗、公告条、**首启同意闸门**）。
 *
 * 🔴 **必须在"点导航标签"之前**跑一趟，而不是只在就绪门控之后。
 * 本轮（10-04）实测：`--only W07` 两趟都停在「aria-selected 没变成 true」，
 * 而 `elementFromPoint(tab 的中心)` 读到的是**一个 `position:fixed; z-index:400` 的遮罩 DIV**，
 * 不是 rail 按钮 —— 也就是说 `force: true` 那一下落在遮罩上，**视图从来没切过**
 * （独立读数：`.ht-rail__tab--active` 仍是「任务」、`ht-trash` 不在 DOM 里）。
 * 那层遮罩是 10-02 `881aa92a` 的首启同意闸门；`dismissTexts` 原先只在门控**之后**跑，
 * 只能清"视图内部"的横幅，救不了导航这一下。
 *
 * ⚠️ 那条 `aria-selected` 回读**不该因此被放宽** —— 它这次拦住的正是假证据
 * （一张盖着同意卡、却命名为「回收站」的图）。
 *
 * 已经选过同意的 context 上这一层不存在，所以等待必须**容错**：等不到就往下走。
 */
async function dismissOverlays(page, texts) {
  for (const text of texts) {
    const button = page.getByRole('button', { name: text });
    await button.first().waitFor({ state: 'attached', timeout: 2_000 }).catch(() => {});
    if (await button.count() && await button.first().isVisible().catch(() => false)) {
      await button.first().click().catch(() => {});
      // 首启同意层带淡出动画；在动画结束前强制点击 rail 会把事件送到
      // 仍在顶层的遮罩。等按钮隐藏后再继续，避免截图流水线偶发吞掉导航点击。
      await button.first().waitFor({ state: 'hidden', timeout: 2_000 }).catch(() => {});
      await page.waitForTimeout(150);
    }
  }
}

/**
 * 在 rail 的「更多」菜单里打开低频视图。
 *
 * 视图注册表仍然用 `view`/`readyText` 描述目标，但低频项不一定存在于 DOM：
 * 它只在菜单展开后才渲染。截图执行器必须复现真实用户路径，不能用隐藏节点或
 * 直接改 React 状态来绕过 IA。返回值表示是否走了菜单路径。
 */
async function openViewControl(page, target, locale) {
  const direct = page
    .getByRole('tab', { name: target.readyText, exact: false })
    .or(page.getByRole('button', { name: target.readyText, exact: false }))
    .first();
  try {
    await direct.waitFor({ state: 'attached', timeout: 1_500 });
    return { control: direct, viaMenu: false };
  } catch {
    const moreLabel = locale === 'en' ? 'More' : '更多';
    const more = page.getByRole('button', { name: moreLabel, exact: true }).first();
    await more.waitFor({ state: 'attached', timeout: 20_000 });
    // 窄屏 rail 是单行横向滚动容器；先把入口滚进视口，再点击真实控件。
    await more.scrollIntoViewIfNeeded().catch(() => {});
    // 首启遮罩收起后，窄屏网格还会重新计算一次 rail 的位置。等盒子连续
    // 两次读数相同再点，避免事件落在过渡中的旧命中区域。
    let previousBox = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const box = await more.boundingBox();
      if (box && previousBox && ['x', 'y', 'width', 'height'].every((key) => Math.abs(box[key] - previousBox[key]) < 0.5)) {
        break;
      }
      previousBox = box;
      await page.waitForTimeout(80);
    }
    // Playwright 的触摸命中检测在横向 overflow 容器里仍可能把稳定的按钮判成
    // “不可点击”；这里调用的仍是同一枚真实按钮的 click handler，不写 React 状态，
    // 也不绕过随后对菜单项和 aria-selected 的回读。
    await more.evaluate((element) => element.click());
    const menuItem = page.getByRole('menuitem', { name: target.readyText, exact: false }).first();
    await menuItem.waitFor({ state: 'attached', timeout: 5_000 });
    return { control: menuItem, viaMenu: true };
  }
}

/**
 * 为需要展示默认关闭模块的目标，走产品自己的设置开关打开它。
 * 截图目标不能靠注入 localStorage 假造“用户已启用”，否则菜单可发现性没有被验到。
 */
async function enableTargetModules(page, target) {
  const modules = target.enableModules ?? [];
  if (modules.length === 0) return;
  const avatar = page.getByTestId('account-menu-avatar');
  await avatar.waitFor({ state: 'attached', timeout: 20_000 });
  await avatar.click({ force: true });
  await page.getByTestId('account-menu-settings').click({ force: true });
  for (const key of modules) {
    const toggle = page.getByTestId(`feature-modules-${key}`);
    await toggle.waitFor({ state: 'attached', timeout: 20_000 });
    if (!(await toggle.isChecked())) await toggle.check({ force: true });
  }
}

async function openSettingsView(page) {
  const avatar = page.getByTestId('account-menu-avatar');
  await avatar.waitFor({ state: 'attached', timeout: 20_000 });
  await avatar.click({ force: true });
  const settings = page.getByTestId('account-menu-settings');
  await settings.waitFor({ state: 'attached', timeout: 20_000 });
  await settings.click({ force: true });
}

/**
 * 截图前把**悬浮态与焦点态**清掉。
 *
 * 🔴 这不是美化，是"图演示的是哪个状态"的问题。rail 的名字被刻意做成
 * **只在 hover / 键盘聚焦时出现**的浮层（`styles/app/inbox.css` 的 `.ht-rail__label`，
 * 2026-09-30 产品负责人："只显示 icon，hover 显示真名"）。而 `openVia: 'tab'` 的
 * 流程必然把鼠标和焦点留在那颗导航按钮上 ⇒ 每张"切视图"的图里都会盖着一个
 * 写着目标名字的深色气泡（实测 10-04 的 `W07-回收站.png` 正是这样）。
 * 那个状态用户平时看不到，拿它当"回收站长什么样"的配图是在演示一个瞬时态。
 */
async function clearHoverAndFocus(page) {
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(150);
}

/**
 * 把声明式 `seed` 走**产品自己的「从备份还原」通道**喂进这个 context。
 *
 * 为什么走界面而不是直接写 IndexedDB：这张图的主张是"回收站里四类都有"，
 * 而那句话的真伪取决于**产品能不能把一份四类都删过的备份还原进来**。
 * 绕过界面种数据，截出来的图证明的是夹具会写库，不是产品能用。
 *
 * 🔴 还原之后不重新加载也不算数 —— 主循环紧接着有一次真 `goto`，
 *    所以种进去的东西必须在**重启后仍在界面上**，这才是"落库"的证据。
 */
async function applySeed(page, site, target) {
  const absPath = join(root, target.seed.fixture);
  if (!existsSync(absPath)) {
    throw new Error(
      `seed 夹具不存在：${target.seed.fixture}\n` +
        `   ⇒ 先生成它：node scripts/screenshots/seed-trash-fixture.mjs（别手写墓碑 JSON，也别放宽这条）`,
    );
  }
  const langQuery = target.locale === 'zh-CN' ? '' : `?lang=${target.locale}`;
  await page.goto(site.baseUrl + langQuery, { waitUntil: 'domcontentloaded' });
  await dismissOverlays(page, target.dismissTexts);

  // 🔴 「设置」不在 rail 上，它在**头像菜单**里（`apps/web/src/features/shell/AccountMenu.tsx`
  //    的 `account-menu-settings`）。这里原来写的是
  //    `getByRole('tab'|'button', { name: settingsLabel, exact: false })` —— `exact: false`
  //    把「设置」当成了子串，命中的是同步状态栏那颗**「同步设置」**。
  //    失败形状值得记下来：它不是"点错了一个看得见的东西"，而是**点开了一个永远不会渲染
  //    `import-panel` 的浮层**，于是这条腿等成一个看不出根因的 20s 超时。
  const avatar = page.getByTestId('account-menu-avatar');
  await avatar.waitFor({ state: 'attached', timeout: 20_000 });
  await avatar.scrollIntoViewIfNeeded().catch(() => {});
  await avatar.click({ force: true });

  const settings = page.getByTestId('account-menu-settings');
  await settings.waitFor({ state: 'attached', timeout: 20_000 });
  // 抄件要**钉在界面上**，不然它和 `dismissTexts` 一样会悄悄过期：
  // 菜单项的可及名必须真的含 `settingsLabel`，否则词条改了而这份没改时，
  // 下面点到的仍是某个"看着像设置"的东西。
  const settingsName = `${(await settings.getAttribute('aria-label')) ?? ''} ${(await settings.innerText()).trim()}`.trim();
  if (!settingsName.includes(target.seed.settingsLabel)) {
    throw new Error(
      `seed：头像菜单里那一枚的实际文案是 ${JSON.stringify(settingsName)}，` +
        `与抄件 ${JSON.stringify(target.seed.settingsLabel)} 对不上 ⇒ 改词条要同时改 targets.mjs`,
    );
  }
  await settings.click({ force: true });

  await page.getByTestId('import-panel').waitFor({ state: 'attached', timeout: 20_000 });
  await page.getByTestId('import-file').setInputFiles(absPath);
  const runButton = page.getByTestId('import-run');
  await runButton.waitFor({ state: 'attached', timeout: 10_000 });
  // 🔴 按钮仍 disabled = 文件根本没进界面状态（不是"慢"）。这时点下去什么都不会发生，
  //    而后续的 success 判据会等成一个看不懂的超时。
  if (await runButton.isDisabled()) {
    throw new Error('seed：选了夹具但「还原」按钮仍是 disabled ⇒ 文件没进入界面状态，还原从未发生');
  }
  await runButton.click();

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await page.getByTestId('import-success').count()) return;
    const refused = page.getByTestId('import-refused');
    if (await refused.count()) {
      throw new Error(`seed：产品拒绝还原这份夹具 —— ${await refused.first().innerText()}`);
    }
    if (await page.getByTestId('import-failed').count()) {
      throw new Error(`seed：还原抛错（import-failed），夹具=${target.seed.fixture}`);
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`seed：等了 20s 没出现 import-success（夹具=${target.seed.fixture}）`);
}

/**
 * 存在性判据：**夹具里每一条被删的行，回收站界面必须有一行**。
 *
 * 🔴 刻意逐条数夹具里的标题，而不是"看起来有四类"：§10.226 的量是
 *    "断言只会验界面写了什么，不会验界面少了什么" —— 而这张图的全部主张就是四类都进得来。
 *    标题是用户自己的字（TrashBoard 原样显示、不翻译），所以中英文两张图共用同一组期望值。
 */
async function assertSeededTitles(page, target) {
  const doc = JSON.parse(readFileSync(join(root, target.seed.fixture), 'utf8'));
  const expected = [];
  for (const rows of Object.values(doc.entities ?? {})) {
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row?.deletedAt == null) continue;
      // 🔴 每类的标题字段不一样（任务 title / 便签 content / 清单与习惯 name），
      //    规则的真源是 `@heyta/domain#toTrashItems`，这里那份是它的镜像 ——
      //    少取一个字段就等于把那一类从判据的分母里悄悄摘掉（§10.226 那条"分母"教训的形状）。
      const label = String(row.title ?? row.content ?? row.name ?? '').trim();
      if (label !== '') expected.push(label);
    }
  }
  if (expected.length === 0) {
    throw new Error(
      `seed 夹具里一条"被删且有标题"的行都没有（${target.seed.fixture}）⇒ 这条判据没有分母，重新生成夹具`,
    );
  }
  const missing = [];
  for (const label of expected) {
    const hits = await page
      .getByText(label, { exact: false })
      .locator('visible=true')
      .first()
      .count()
      .catch(() => 0);
    if (!hits) missing.push(label);
  }
  if (missing.length > 0) {
    throw new Error(
      `回收站界面少了 ${missing.length}/${expected.length} 行：${missing.join('、')}\n` +
        `   ⇒ 这张图会被命名为「回收站」却演示不出四类，那是假证据。不要放宽这条判据 —— 先查还原有没有真的落库`,
    );
  }
  console.log(`  🌱 seed 到位：回收站列出 ${expected.length} 行（夹具里每一条被删的行都命中）`);
}

for (const job of jobs) {
  const { target, device, folder } = job;
  const site = SITES[target.site];
  // 界面语言：应用首启会读取浏览器语言，也接受落地页传入的 `?lang=`；
  // 两层都设，保持协商结果与截图目标一致。
  const locale = target.locale ?? 'zh-CN';
  const langQuery = locale === 'zh-CN' ? '' : `?lang=${locale}`;
  const outPath = join(root, ARTIFACT_ROOT, folder, artifactName(target));
  mkdirSync(dirname(outPath), { recursive: true });

  const context = await browser.newContext({
    // 全部从**设备层**读（Playwright newContext 的形状）
    viewport: device.viewport,
    deviceScaleFactor: device.deviceScaleFactor ?? 1,
    isMobile: device.isMobile ?? false,
    hasTouch: device.hasTouch ?? false,
    userAgent: device.userAgent,
    locale,
  });
  const page = await context.newPage();

  try {
    // 种数据排在导航**之前**：还原发生在设置视图里，而主流程紧接着还有一次 goto ——
    // 那一次重新加载顺带证明了"还原的东西落库了"，不是只活在内存里的一趟。
    if (target.seed) {
      await applySeed(page, site, target);
    }
    if (target.openVia === 'tab') {
      // 🔴 视图是 React state：必须先落到应用，再点导航标签。
      //
      // ⚠️ 视图切换器是 `<button role="tab">` —— **角色是 `tab` 不是 `button`**，
      //    用 getByRole('button') 找不到（实测：8 个视图只有"设置"能过，
      //    而那还是因为它当时恰好渲染成 button；后来它变成 tab 之后连它也挂了）。
      //    所以用 `.or()` 同时接受两种角色。
      //
      // 🔴 而且**必须 waitFor，不能先 count()**：
      //    `goto(domcontentloaded)` 返回时 React 还没挂载完，
      //    立刻 count() 一定是 0 —— 这个坑我实测踩过一次（11 张全挂）。
      //    waitFor 会一直等到元素出现，两件事一次解决。
      await page.goto(site.baseUrl + langQuery, { waitUntil: 'domcontentloaded' });
      await dismissOverlays(page, target.dismissTexts);
      await enableTargetModules(page, target);
      if (target.view === 'settings') {
        // 设置不属于 rail 目的地，必须从头像菜单进入；把它当成“更多”项会
        // 误把同步设置或隐藏的文本节点当成目标。
        await openSettingsView(page);
      } else {
        const opened = await openViewControl(page, target, locale);
        const control = opened.control;      // ⚠️ 只等 `attached`，**不等 `visible`**：实测移动视口（390px）下标签栏被压成
        //    8px 宽，从"四象限"往后的标签**整段溢出到屏幕外**
      //    （四象限 x=312..392 已越界、习惯 x=396..464 完全在屏外）。
      //    它们有盒子、`isVisible()` 也返回 true，但 `waitFor({state:'visible'})`
      //    会因为布局竞态等不到 —— MW01/MW03 过、MW02 挂。
      //    这也是**一个真实的移动端布局缺陷**，交 UI 那条线修。
        await control.waitFor({ state: 'attached', timeout: 20_000 });
      // 🔴 导航**之前**清一次遮挡物（理由见 `dismissOverlays` 的注释：
      //    遮罩盖住 rail 时，`force: true` 点的是遮罩，视图不切）。
        await dismissOverlays(page, target.dismissTexts);
        await control.scrollIntoViewIfNeeded().catch(() => {});

      // 🔴 `force: true` 是必要的，而且**不是**为了"绕过问题"：
      //    实测在移动视口（390x844）下，头部标题 / 搜索框 / header actions
      //    会**盖在标签栏上**，Playwright 的命中检测因此一直重试到超时
      //    （报 "other element intercepts pointer events"）。
      //    同一个视图有时过、有时不过（MW01/MW03 过、MW02 挂）⇒ 竞态。
      //    这是**一个真实的移动端布局缺陷**，应交给 UI 那条线修；
      //    截图流水线不该被它卡住，但**必须自己验证点击真的生效**，
      //    否则会静默截成上一个视图 —— 那就是在制造假证据。
        await control.click({ force: true });

      // 回读：该 tab 必须真的变成选中态。等不到就报错，绝不含糊地往下截。
      // 菜单项点击后会关闭菜单，并把当前视图提升回 rail；因此菜单路径要从
      // 新渲染的 tab 读取 aria-selected，而不是从已卸载的 menuitem 读取。
        const selectedControl = opened.viaMenu
        ? page.getByRole('tab', { name: target.readyText, exact: false }).first()
        : control;
        const deadline = Date.now() + 5_000;
        let selected = false;
        while (Date.now() < deadline) {
          if ((await selectedControl.getAttribute('aria-selected')) === 'true') {
          selected = true;
            break;
          }
          await page.waitForTimeout(100);
        }
        if (!selected) {
        // 🔴 报错必须说出**是谁盖住了点击目标**。只说"aria-selected 没变成 true"，
        //    读起来像"回读太严"，于是人会去放宽回读 —— 而真因是一层 `position:fixed` 遮罩
        //    （本轮实测：上一轮据此怀疑 `.first()` 命中了同名但非选中的控件，方向整个错）。
          const box = await control.boundingBox().catch(() => null);
          const blockedBy = box
          ? await page
              .evaluate(([x, y]) => {
                const el = document.elementFromPoint(x, y);
                if (!el) return '中心点已在视口外';
                const cls = typeof el.className === 'string' ? `.${el.className.trim().replace(/\s+/g, '.')}` : '';
                const css =
                  el instanceof HTMLElement
                    ? (() => {
                        const s = getComputedStyle(el);
                        return `pos=${s.position} z=${s.zIndex}`;
                      })()
                    : '';
                return `${el.tagName}${cls} [${css}]`;
              }, [box.x + box.width / 2, box.y + box.height / 2])
              .catch(() => '（读不到中心点）')
          : '（拿不到盒位置）';
          throw new Error(
          `点了「${target.readyText}」但它的 aria-selected 没变成 true —— ` +
            `视图没有真的切换，继续截图会产出**假证据**（截成上一个视图）。\n` +
            `   该控件中心点上实际最靠上的是：${blockedBy}\n` +
            `   ⇒ 若不是它自己或它的子节点，就是**有遮挡物盖住了点击目标**：` +
            `把它加进 targets.mjs 的 dismissTexts（遮挡物在导航前清），**不要放宽这条回读**。`,
          );
        }
      }
    } else {
      await page.goto(new URL(target.path + langQuery, site.baseUrl).toString(), { waitUntil: 'domcontentloaded' });
    }

    // 就绪门控：等真实文案**可见**。
    //
    // 🔴 `getByText(...).first()` 是个陷阱：`.first()` 命中 DOM 里第一个匹配，
    //    而那个可能是**隐藏的**（移动端侧栏里的象限标签就是这种），
    //    于是 `waitFor()` 默认等 visible 会一直等到超时 ——
    //    MW02 就是这么挂的（点击明明成功了，卡在门控上）。
    //    改用 `visible=true` 选择器引擎：只看**在屏上**的那些。
    await page
      .getByText(target.readyText, { exact: false })
      .locator('visible=true')
      .first()
      .waitFor({ timeout: 20_000 });

    // 遮挡物：出现就点掉（引导弹窗、公告条）。视图内部那一层要在就绪门控**之后**再清一次 ——
    // 导航之前的那一趟清的是"挡住导航"的那一层（见 `dismissOverlays`）。
    await dismissOverlays(page, target.dismissTexts);

    // 先清悬浮/焦点态，再等动画收敛（顺序反了会把气泡的淡出留在图里）
    await clearHoverAndFocus(page);
    // 🔴 截图前的收尾等待：**等揭示落位，不等时间**（本文件头部设计约束第 1 条）。
    //    原来这里是固定 `waitForTimeout(600)`，而落地页页头走 `.lp-mask` +
    //    `translateY(112%)→0%` 的错峰揭示 —— 600ms 在快机器上浪费、在慢机器上
    //    **截到一条空白带**（审计文档 §8.110：六张图里四张是这样，而它们被当成
    //    "界面有问题"的证据去查，查的是一个不存在的问题）。
    //    没有 `.lp-h1` 的应用视图仍走那 600ms：那些页面没有可等的揭示，
    //    把它们接进新判据只会让每张图都等一个永远不成立的条件。
    // 🔴 有 seed 的目标：**先验"该出现的行都出现了"，再截图**。
    //    顺序很重要 —— 判据在截图之后的话，图已经落盘了才发现少一类，
    //    而那张半成品图会被下一次的门禁当成"已有产物"放过。
    if (target.seed) {
      await assertSeededTitles(page, target);
    }
    const settled = await settleForShot(page);
    await page.screenshot({ path: outPath, fullPage: target.fullPage });

    // 截完**立刻**自检：空白图当场报出来，别等最后的门禁
    const stats = inspectPng(outPath);
    const blank = looksBlank(stats);
    written.push({ outPath, stats, blank, settled });
    console.log(
      `  ${blank ? '🔴' : '✅'} ${folder}/${stats.name}  ${stats.width}×${stats.height}` +
        `  内容 ${(stats.contentRatio * 100).toFixed(1)}%  色阶 ${stats.colorSpan}  等待 ${settled}`,
    );
    if (blank) failed.push(stats.name);
  } catch (error) {
    // 🔴 全部行都要打出来。原先只取 `split('\n')[0]`，于是"是谁盖住了点击目标"
    //    那两行诊断**在真实输出里根本看不见**（实测：臂 1 复跑只印出第一句），
    //    等于把刚修好的自解释能力又截回那句"看起来像判据太严"的话。
    const lines = String(error).split('\n').filter((l) => l.trim() !== '');
    console.error(`  🔴 ${target.id} ${target.name}:`);
    for (const l of lines.slice(0, 6)) console.error(`     ${l}`);
    failed.push(artifactName(target));
  } finally {
    await context.close();
  }
}

await browser.close();

// 产物索引：给下一次/别人看"这批图是什么时候、什么尺寸截的"
const manifestPath = join(root, ARTIFACT_ROOT, 'manifest.json');
mkdirSync(dirname(manifestPath), { recursive: true });
writeFileSync(
  manifestPath,
  JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      targets: jobs.length,
      artifacts: written.map(({ outPath, stats }) => ({
        path: outPath.replace(`${root}/`, ''),
        width: stats.width,
        height: stats.height,
        contentRatio: Number(stats.contentRatio.toFixed(4)),
        colorSpan: stats.colorSpan,
        sha256: stats.hash,
      })),
    },
    null,
    2,
  ),
);

console.log(`\n产物索引：${manifestPath.replace(`${root}/`, '')}`);
if (failed.length > 0) {
  console.error(`\n🔴 ${failed.length} 张有问题（空白或失败）：${failed.join('、')}`);
  console.error('   不要靠调低阈值让它变绿 —— 先查页面。');
  process.exit(1);
}
console.log('✅ 全部截图非空白，尺寸正确');
