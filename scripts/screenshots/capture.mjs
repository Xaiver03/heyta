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
  const outPath = join(root, ARTIFACT_ROOT, folder, artifactName(target));
  mkdirSync(dirname(outPath), { recursive: true });

  const context = await browser.newContext({
    viewport: device.viewport,
    deviceScaleFactor: device.viewport.deviceScaleFactor ?? 1,
    isMobile: device.viewport.isMobile ?? false,
    hasTouch: device.viewport.hasTouch ?? false,
    userAgent: device.viewport.userAgent,
    locale: 'zh-CN',
  });
  const page = await context.newPage();

  try {
    if (target.openVia === 'tab') {
      // 🔴 视图是 React state：必须先落到应用，再点导航标签
      await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded' });
      const tab = page.getByRole('button', { name: target.readyText }).first();
      await tab.waitFor({ state: 'visible', timeout: 15_000 });
      await tab.click();
    } else {
      await page.goto(new URL(target.path, site.baseUrl).toString(), { waitUntil: 'domcontentloaded' });
    }

    // 就绪门控：等真实文案出现
    await page.getByText(target.readyText, { exact: false }).first().waitFor({ timeout: 20_000 });

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
