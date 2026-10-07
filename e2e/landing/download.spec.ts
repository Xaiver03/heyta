import { expect, test, type Page } from '@playwright/test';

import { waitHeadRevealed } from './head-reveal';

/**
 * `/download` 的真浏览器验收 —— 看的是**访客真的拿到的那份字节**
 * ===============================================================
 *
 * 三条不显然的前提，都在下面的用例里：
 *
 *   1. **零直链也要有正向对照**。"这一页没有下载链接"是一条负断言，而负断言在
 *      页面根本没渲染时会无条件成立 —— 所以每一条都配一句"卡片确实画全了"。
 *      （`AGENTS.md` §7：一条永远通过的判据比没有判据更糟。）
 *   2. **快照说什么，页面就画什么**。这一趟读的是 `release-manifest.json` 的当前内容，
 *      期望值从它推出来，不是写死 0。发布之后这一条会自然变成"有 N 条直链"而仍然不用改。
 *   3. **截图先于断言**（§6.2 规定一第 1 条），且人在看这两张图之后才宣布这一页做完了。
 */

const BUCKET = 'heyta-dist-1380503169.cos.ap-guangzhou.myqcloud.com';
const ROW_IDS = ['web', 'macos', 'ios', 'android', 'windows', 'linux', 'harmony', 'selfhost'];

function attachConsole(page: Page): string[] {
  const hits: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') hits.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => hits.push(`pageerror: ${err.message}`));
  return hits;
}

test('中文 /download：八端全画、直链只来自清单、拿不到的那一档没有假按钮', async ({page}) => {
  const errors = attachConsole(page);

  // 先落盘再断言：失败时这张图必须已经在盘上。
  await page.goto('/download/');
  await waitHeadRevealed(page);
  await page.screenshot({path: 'landing-results/download-zh.png', fullPage: true, animations: 'disabled'});

  const cards = page.locator('.dl-card');
  await expect(cards, '八个端应当一张不少').toHaveCount(ROW_IDS.length);

  // 正向前提：出口按钮真的会画出来（否则下面那条"pending 档没有按钮"会恒绿）。
  // 判据推自快照，而不是写死数字。
  const manifest = await readSnapshot();
  const expectLinks = stablePublishedCount(manifest);
  const bucketLinks = page.locator(`a[href*="${BUCKET}"]`);
  await expect(bucketLinks, `清单里正式通道的产物是 ${expectLinks} 枚，页面就应当恰好这么多直链`)
    .toHaveCount(expectLinks);

  // 没有产物的那几档：不许有一个看起来能点的按钮，但必须有一句"差在哪一步"。
  for (const id of ['windows', 'linux', 'harmony']) {
    const card = page.locator(`#dl-${id}`);
    await expect(card.locator('.lp-btn'), `${id} 没有产物却画了按钮`).toHaveCount(0);
    const gap = card.locator('.dl-gap');
    await expect(gap, `${id} 应当写明差在哪一步`).toBeVisible();
    expect((await gap.innerText()).trim().length, `${id} 的原因不能是一句占位`).toBeGreaterThan(8);
  }

  // 系统识别只挑推荐位，且**一张都不隐藏**。
  // ⚠️ 这里刻意不断言"推荐的是哪一端"：Playwright 的 `Desktop Chrome` 设备描述符把 UA
  //    **钉成 Windows**（与跑它的那台机器无关），所以"这台是 Mac"测的是脚手架而不是产品。
  //    真正的分端行为在下面用显式 UA 各造一次上下文来验。
  await expect(page.locator('.dl-card[data-recommended="true"]')).toHaveCount(1);
  const marked = await page.locator('.dl-card[data-recommended="true"]').getAttribute('id');
  const finderState = await page.locator('.dl-finder').getAttribute('data-state');
  expect(['sure', 'ask'], `识别成功时不该退回 unknown（标的是 ${marked}）`).toContain(finderState);

  expect(errors, `控制台不该有报错：${errors.join('\n')}`).toEqual([]);
});

test('英文 /download：同一套结构，没有半页还是中文', async ({page}) => {
  const errors = attachConsole(page);
  await page.goto('/en/download/');
  await page.locator('#main').screenshot({path: 'landing-results/download-en-head.png'});
  await waitHeadRevealed(page);
  await page.screenshot({path: 'landing-results/download-en.png', fullPage: true, animations: 'disabled'});

  await expect(page.locator('.dl-card')).toHaveCount(ROW_IDS.length);
  await expect(page.locator('#dl-windows .dl-gap')).toBeVisible();
  // 英文页里不许出现中文正文（页脚与语言切换器除外，那是两种语言都要显示的东西）。
  const bodyText = await page.locator('.dl-body').innerText();
  expect(/[\u4e00-\u9fff]/.test(bodyText), `英文页正文里出现了中文字符：${bodyText.slice(0, 80)}`).toBe(false);
  expect(errors, `控制台不该有报错：${errors.join('\n')}`).toEqual([]);
});

test('识别按 UA 走：Mac 只能"请你确认"，Android 可以直接挑定', async ({browser}) => {
  // 两条各造一次上下文：UA 是这一页唯一的输入，它就是被测变量本身。
  const cases = [
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'dl-macos', 'ask'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36', 'dl-android', 'sure'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', 'dl-ios', 'sure'],
  ] as const;
  for (const [userAgent, expected, state] of cases) {
    const context = await browser.newContext({userAgent});
    const tab = await context.newPage();
    await tab.goto('/download/');
    await expect(tab.locator('.dl-card[data-recommended="true"]'), `UA=${userAgent.slice(0, 40)}`).toHaveId(expected);
    await expect(tab.locator('.dl-finder')).toHaveAttribute('data-state', state);
    // 推荐位不许把别的端挤掉：八张卡是恒定的。
    await expect(tab.locator('.dl-card')).toHaveCount(ROW_IDS.length);
    await tab.screenshot({path: `landing-results/download-finder-${expected}.png`});
    await context.close();
  }
});

test('/platforms 上不许出现下载直链（下载动作只住在一页）', async ({page}) => {
  await page.goto('/platforms/');
  await page.locator('#main').screenshot({path: 'landing-results/platforms-no-links.png'});
  await expect(page.locator(`a[href*="${BUCKET}"]`)).toHaveCount(0);
  // 阳性对照：这一页不是空的。
  await expect(page.locator('section#web')).toBeVisible();
});

test('已发布那一档要把版本、大小与校验值一起给出来（只在清单真有产物时生效）', async ({page}) => {
  const manifest = await readSnapshot();
  const ready = Object.entries(manifest.files ?? {}).filter(([, file]) =>
    stable(file.version ?? manifest.version),
  );
  test.skip(ready.length === 0, '清单里还没有正式通道的产物 —— 这一条要等发布，届时它自己会生效');

  await page.goto('/download/');
  const [platform, file] = ready[0]!;
  const card = page.locator(`#dl-${platform}`);
  await expect(card.locator('a.lp-btn')).toHaveAttribute('href', file.url);
  await expect(card).toContainText(manifest.version);
  await expect(card.locator('.dl-hash__value')).toHaveText(file.sha256);
});

/* ── 快照读取：期望值从真源推出来，不写死 ─────────────────────────────── */

import { readFileSync } from 'node:fs';

interface SnapshotFile {url: string; sha256: string; size: number; version?: string}

function readSnapshot(): {version: string; files: Record<string, SnapshotFile>; channels?: Record<string, {url: string}>} {
  const path = new URL('../../apps/landing/src/site/release-manifest.json', import.meta.url);
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** 与 `src/site/downloads.ts` 同一条：带预发布后缀的通道不给直链。 */
function stable(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

/**
 * 期望值按**每一枚文件自己的版本**推，不按批次号。
 *
 * 🔴 这一条是刚踩出来的：清单是合并的（各端不同轮），批次号 1.0.0 盖不住一条
 * 去年试传的 `0.0.0-dev` APK。按批次号数会得到 2，页面按端判是 1 ——
 * 那时红的是判据自己，不是产品。
 */
function stablePublishedCount(manifest: ReturnType<typeof readSnapshot>): number {
  return Object.values(manifest.files ?? {}).filter((file) => stable(file.version ?? manifest.version))
    .length;
}
