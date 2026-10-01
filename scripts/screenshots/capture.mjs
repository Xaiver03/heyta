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
        .first();
      // ⚠️ 只等 `attached`，**不等 `visible`**：实测移动视口（390px）下标签栏被压成
      //    8px 宽，从"四象限"往后的标签**整段溢出到屏幕外**
      //    （四象限 x=312..392 已越界、习惯 x=396..464 完全在屏外）。
      //    它们有盒子、`isVisible()` 也返回 true，但 `waitFor({state:'visible'})`
      //    会因为布局竞态等不到 —— MW01/MW03 过、MW02 挂。
      //    这也是**一个真实的移动端布局缺陷**，交 UI 那条线修。
      await control.waitFor({ state: 'attached', timeout: 20_000 });
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
        throw new Error(
          `点了「${target.readyText}」但它的 aria-selected 没变成 true —— ` +
            `视图没有真的切换，继续截图会产出**假证据**（截成上一个视图）`,
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

    // 遮挡物：出现就点掉（引导弹窗、公告条）
    for (const text of target.dismissTexts) {
      const button = page.getByRole('button', { name: text });
      if (await button.count()) {
        await button.first().click().catch(() => {});
        await page.waitForTimeout(300);
      }
    }

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
    console.error(`  🔴 ${target.id} ${target.name}: ${String(error).split('\n')[0]}`);
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
