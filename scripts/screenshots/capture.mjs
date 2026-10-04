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

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright';

import { inspectPng, looksBlank } from './png-stats.mjs';
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
    if (await button.count()) {
      await button.first().click().catch(() => {});
      await page.waitForTimeout(300);
    }
  }
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

for (const job of jobs) {
  const { target, device, folder } = job;
  const site = SITES[target.site];
  // 界面语言。🔴 真正让 web 界面切语言的是 URL 上的 `?lang=` 参数，
  // 不是浏览器协商 —— 应用刻意不读 navigator.language
  // （apps/web/src/lib/locale.ts 文件头）。两层都设，保持一致。
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
      const control = page
        .getByRole('tab', { name: target.readyText, exact: false })
        .or(page.getByRole('button', { name: target.readyText, exact: false }))
        .first();      // ⚠️ 只等 `attached`，**不等 `visible`**：实测移动视口（390px）下标签栏被压成
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
      const deadline = Date.now() + 5_000;
      let selected = false;
      while (Date.now() < deadline) {
        if ((await control.getAttribute('aria-selected')) === 'true') {
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
    // 动画/字体收敛，避免截到过渡中间态
    await page.waitForTimeout(600);
    await page.screenshot({ path: outPath, fullPage: target.fullPage });

    // 截完**立刻**自检：空白图当场报出来，别等最后的门禁
    const stats = inspectPng(outPath);
    const blank = looksBlank(stats);
    written.push({ outPath, stats, blank });
    console.log(
      `  ${blank ? '🔴' : '✅'} ${folder}/${stats.name}  ${stats.width}×${stats.height}` +
        `  内容 ${(stats.contentRatio * 100).toFixed(1)}%  色阶 ${stats.colorSpan}`,
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
