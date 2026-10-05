/**
 * 线上落地页的「可安装」那句承诺 —— **部署层**的守卫（G-51 步骤 ④）。
 *
 * 本地那份 `e2e/landing/platforms-install-claim.spec.ts` 量的是**当前源码构建出来的那份**，
 * 而用户读到的是**公网上的那一份**。这两件事在本仓库不是一件事：
 * 落地页要 `publish` 才换（§8.27 那次就是"词条改了但线上还是旧的"）。
 * 所以这句"没有载体就不许承诺"必须在线上再量一次，否则摘掉的承诺可以悄悄从发布层回来。
 *
 * ## 🔴 这条**今天（2026-10-04 20:1x）是红的**，而且它红得对
 *
 * 现量（`LIVE_RC=1`，两条 locale 各一条红）：线上那张 Web 卡的正文仍是
 * 「完整产品，不是演示。**可安装**、可离线用，数据就存在你的浏览器里。」/
 * "… **Installable**, works offline …"，而 `main:packages/i18n` 里也还是这一句 ——
 * 也就是说**线上与 main 是一致的**，缺的不是发布动作，是这一批还没落地（审计 §8.123）。
 *
 * 关闭条件（两个都要成立，缺一个这条就还是红的）：
 *   ① `feat/self-host-distribution` 落进 `main`（目标第 1 项）；
 *   ② 从**落地后的 main** 重发落地页。
 * 在那之前不要"为了绿"改断言 —— 那正是这条判据要拦的动作。
 *
 * ## 为什么这条判据长成"正向锚点 + 负向断言"两条
 *
 * 只写"页面里不含 `可安装`"的话，**页面空了、被 SPA 兜底成别的页、CDN 挂了返回一张壳**
 * 都会让它无条件成立 —— 那是最典型的假绿（AGENTS §7 元规则 2）。
 * 所以先要求那张卡**渲染了、正文非空、且含当前这句新文案**，再判被摘掉的词不在里面。
 * 两腿各自都能红，且都红过：锚点腿今天因"线上还是旧文案"红，
 * 负向腿在**受控变异**（暂时拿掉锚点断言）下报出
 * `线上 Web 卡不该再承诺「可安装」：完整产品，不是演示。可安装、可离线用…`。
 */
import { expect, test, type Page } from '@playwright/test';

const ORIGIN = process.env['HEYTA_LIVE_ORIGIN'] ?? 'https://heyta.waytofuture.cn';

/** 当前文案的锚点（与 `packages/i18n` 的 `site.platforms.web.body` 同源，中英各一条）。 */
const ZH_ANCHOR = '断网也能照常记';
const EN_ANCHOR = 'keeps working when you are offline';

/** 被摘掉的承诺：Web 端从来没有可安装的载体（`check:tokens` 之外那条 PWA 缺口）。 */
const FORBIDDEN = ['可安装', 'Installable'];

function attachLogs(page: Page): string[] {
  const hits: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') hits.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => hits.push(`pageerror: ${err.message}`));
  return hits;
}

/**
 * 读线上那张 Web 卡的正文段落。
 *
 * 🔴 取 `section#web p.lp-prose` 而不是整页文本：这张卡是唯一由 `site.platforms.web.body`
 *   供文的区块。整页文本会让"别处出现这个词"误红，也会让"这张卡根本没渲染"被别处的文字盖住。
 */
async function webCardBody(page: Page): Promise<string> {
  const card = page.locator('section#web');
  await expect(card, `${page.url()} 上应当有 id="web" 这张卡`).toBeVisible();
  const paras = card.locator('p.lp-prose');
  await expect(paras.first(), 'Web 卡应当至少渲染出一个正文段落').toBeVisible();
  return (await paras.first().innerText()).trim();
}

for (const [locale, path, anchor] of [
  ['zh-CN', '/platforms/', ZH_ANCHOR],
  ['en', '/en/platforms/', EN_ANCHOR],
] as const) {
  test(`线上 ${locale} Web 卡：新句在场，且「可安装」这句没有从发布层回来`, async ({ browser }) => {
    // 线上验收开**独立 context**（不带 storageState），且 locale 显式给：
    // 这条走的是"访客直接打开 /en/platforms/"，语言由路径决定，不由浏览器默认值决定。
    const context = await browser.newContext({ locale });
    const page = await context.newPage();
    const logs = attachLogs(page);

    await page.goto(`${ORIGIN}${path}`, { waitUntil: 'domcontentloaded' });

    // §6.2 规定一第 1 条：**先截图再断言**，失败时那张图必须已经在盘上。
    // 放在本套件自己的 outputDir（`live-site-results/`，已忽略），不写进共享的 `test-results/`。
    await page.locator('#main').screenshot({ path: `live-site-results/platforms-web-card-${locale}.png` });

    const body = await webCardBody(page);
    expect(body.length, `Web 卡正文不能是空串（空串会让下面那条负向断言无条件成立）`).toBeGreaterThan(0);
    expect(
      body,
      `线上 Web 卡里没有当前文案锚点「${anchor}」——` +
        `如果读到的是「可安装 / Installable」那句，说明这一批还没落地或落地页还没从 main 重发（不是站点坏了）：${body}`,
    ).toContain(anchor);
    for (const needle of FORBIDDEN) {
      expect(body, `线上 Web 卡不该再承诺「${needle}」：${body}`).not.toContain(needle);
    }
    expect(logs.filter((l) => l.startsWith('[pageerror]')), `页面不该有未捕获报错：${logs.join('\n')}`).toEqual([]);

    await context.close();
  });
}
