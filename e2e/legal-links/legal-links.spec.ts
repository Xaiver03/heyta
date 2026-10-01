/**
 * 链 2 的上线判据：条款链接**在真浏览器里点得开**，而且按连的那台服务端分流。
 * ==========================================================================
 *
 * 分工见 `playwright.legal-links.config.ts` 的文件头。一句话：
 * jsdom 里**没有导航** —— `target="_blank"` 什么都不发生，所以"点下去到了哪"
 * 这一件事只有在真浏览器里才算被观测过。这一组因此是
 * `packages/app-host/tests/legal-links.spec.ts`（决策）与
 * `apps/web/tests/auth-panel.spec.tsx`（渲染）之上的**第三层**。
 *
 * ## 三种形状
 *
 * | baseUrl | 两条链接必须打开 | 内容来源 |
 * |---|---|---|
 * | `https://heyta.waytofuture.cn`（官方托管） | `/legal/terms/`、`/legal/privacy/` | 本地落地页构建（本套件刻意离线；线上字节由 `e2e/live-site/live-legal.spec.ts` 直连真服务器验，两侧不重叠） |
 * | `https://heyta.finlaw.cloud`（另一台真服务端） | `<base>/terms.html`、`<base>/privacy.html` ⇒ **404** | **零转发**，那个 404 是它自己答的 |
 * | 空（还没配地址） | **不渲染链接** | —— |
 *
 * 🔴 中间那一行的判据不是"打开"，而是"**打开的是那台自己的地址、并且是 404**"。
 * 悄悄退回落地页 = 把 heyta 署名的政策挂在别人的实例上（D-09 明令不许）。
 *
 * ## 规矩（AGENTS §6.2 规定一）
 *
 * 1. 截图**先于断言**落盘，失败时也有图；
 * 2. 路径固定（`legal-links-results/legal-*.png`），不随测试名变化；
 * 3. 收 `console` / `pageerror` / `requestfailed`，失败时打印；
 * 4. 人必须打开那几张图看一眼。
 */

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { openApp } from '../tests/helpers';

/** 官方托管域（与 `packages/app-host/src/legal-links.ts` 的常量同一个值）。 */
const OFFICIAL = 'https://heyta.waytofuture.cn';
/** 本地落地页构建的预览地址（`playwright.legal-links.config.ts` 的第二个 webServer）。 */
const LANDING_PREVIEW = 'http://127.0.0.1:4332';
/** 一台**真在跑**的非自建面板服务端：老域名，同步服务端还在，`PRIVACY_*` 配了 0 条。 */
const OTHER_SERVER = 'https://heyta.finlaw.cloud';

const SHOT = (name: string): string => `legal-links-results/legal-${name}.png`;

/** 规定一第 3 条：挂晚了就收不到加载期错误，而那是白屏唯一的线索。 */
function attachLogs(page: Page, sink: string[], label: string): void {
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      sink.push(`[${label}.console.${m.type()}] ${m.text()}`);
    }
  });
  page.on('pageerror', (e) => {
    sink.push(`[${label}.pageerror] ${e.message}`);
  });
  page.on('requestfailed', (r) => {
    sink.push(`[${label}.requestfailed] ${r.url()} ${r.failure()?.errorText ?? ''}`);
  });
}

/**
 * 把官方域**整个来源**转到本地落地页构建。
 *
 * 🔴 转发的是"服务器返回哪些字节"，不是产品行为：链接由 `resolveLegalLinks()`
 * 真算、点击是真点击、导航是真导航、渲染是真渲染。线上那份 `/legal/*`
 * 还没发布（工作树里未提交），线上那个路径当前由 nginx 兜底返回首页外壳 ——
 * 那是发布缺口，登记在计划文档的缺口表里。
 */
async function serveOfficialFromLocalBuild(context: BrowserContext): Promise<void> {
  await context.route(`${OFFICIAL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const upstream = `${LANDING_PREVIEW}${url.pathname}${url.search}`;
    try {
      const response = await route.fetch({ url: upstream });
      await route.fulfill({ response });
    } catch {
      // 转发失败要**看得见**：静默放行会让浏览器真去连线上，
      // 于是"本地构建渲染出来的政策页"与"线上首页外壳"两种结果都能让断言过。
      await route.fulfill({ status: 502, body: `本地落地页转发失败：${upstream}` });
    }
  });
}

/** 打开注册面板（头像 → 「登录 / 注册」，2 次点击 —— "前置"的可执行含义）。 */
async function openAuthPanel(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  // 🔴 `?lang=zh-CN` 是**必需**的，不是排版偏好：Playwright 的浏览器默认语言是
  //    en-US，于是界面整个是英文，而这一组的定位符（`添加任务` 的 placeholder、
  //    对话框的 `aria-label="登录 / 注册"`、落地页 `<h1>heyta 服务条款</h1>`）全是中文。
  //    本轮实测就红在这里：五条全挂，挂在 `openApp` 那句"等中文输入框出现"上。
  //    `?lang=` 在解析链上排在系统语言之前（`apps/web/src/lib/locale.ts`）。
  await openApp(page, '/?lang=zh-CN');
  await page.getByTestId('account-menu-avatar').click();
  await page.getByTestId('sync-signin-entry').click();
  const dialog = page.locator('[role="dialog"][aria-label="登录 / 注册"]');
  await expect(dialog).toBeVisible();
}

/** 往地址框里填一台服务端，并等两条链接真的出现。 */
async function setBaseUrl(page: Page, url: string): Promise<void> {
  const dialog = page.locator('[role="dialog"][aria-label="登录 / 注册"]');
  const field = dialog.locator('input[type="url"]').first();
  await expect(field, '未配置服务端时地址框必须在（已配置时整块不渲染）').toBeVisible();
  await field.fill(url);
  await expect(dialog.locator('a[target="_blank"]')).toHaveCount(2);
}

/** 面板里那两条链接（按 href 后缀取，不按文字 —— 文字由 i18n 决定，不是判据）。 */
function linkByHref(page: Page, suffix: string): ReturnType<Page['locator']> {
  return page
    .locator('[role="dialog"]')
    .locator(`a[href$="${suffix}"]`)
    .first();
}

/**
 * 等入场动画落位，**再**截图。
 *
 * 🔴 实测依据：落地页的标题是 `.lp-mask { overflow: hidden }` + 内层
 * `translateY(100%) → 0` 的揭示动画，`getAnimations()` 在 +300ms 时还有
 * **3 条在跑**（内层 transform = `matrix(1,0,0,1,0,1.68)`，也就是标题正被
 * 裁在框外），+700ms 归零。而断言 `toContainText` 只看 DOM，**动画中就能过** ——
 * 于是第一版截图里标题那一条是空白的：判据绿、证据却是残缺的图。
 * 截图是给人看的（§6.2 规定一第 4 条），所以落位必须在截图**之前**。
 */
async function waitForAnimationsSettled(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      (document.getAnimations?.() ?? []).every(
        (a) => a.playState === 'finished' || a.playState === 'idle',
      ),
    undefined,
    { timeout: 20_000 },
  );
}

/** 真点一条链接，返回它打开的那个新标签。
 *
 * ⚠️ `rel="noopener"` 不影响 Playwright 看见它：新标签是 CDP 的 target 事件，
 * 与 opener 能不能拿到 `window.opener` 无关。
 */
async function clickAndCapture(
  page: Page,
  suffix: string,
  shotName: string,
  logs: string[],
): Promise<{ popup: Page; href: string | null }> {
  const link = linkByHref(page, suffix);
  await expect(link).toBeVisible();
  const href = await link.getAttribute('href');
  // 截图先落盘（规定一第 1 条）：这一步留的是**点之前**的面板，
  // 它是"链接长在勾选框旁边"这个形状的证据。
  await page.screenshot({ path: SHOT(`${shotName}-panel`) });

  const [popup] = await Promise.all([
    page.context().waitForEvent('page'),
    link.click(),
  ]);
  attachLogs(popup, logs, `${shotName}-popup`);
  await popup.waitForLoadState('load');
  return { popup, href };
}

test.describe('官方托管域：点开的是落地页 /legal/*', () => {
  test('两条链接的地址、打开方式、以及**不在勾选框的 label 里**', async ({ page, context }) => {
    await serveOfficialFromLocalBuild(context);
    await openAuthPanel(page);
    await setBaseUrl(page, OFFICIAL);

    const dialog = page.locator('[role="dialog"]');
    expect(await linkByHref(page, '/legal/terms/').getAttribute('href')).toBe(
      `${OFFICIAL}/legal/terms/`,
    );
    expect(await linkByHref(page, '/legal/privacy/').getAttribute('href')).toBe(
      `${OFFICIAL}/legal/privacy/`,
    );

    for (const suffix of ['/legal/terms/', '/legal/privacy/']) {
      const link = linkByHref(page, suffix);
      expect(await link.getAttribute('target'), suffix).toBe('_blank');
      const rel = (await link.getAttribute('rel')) ?? '';
      // 新标签拿到 `window.opener` 就能反过来改登录面板 —— 条款页是**另一个来源**时尤其。
      expect(rel).toContain('noopener');
      expect(rel).toContain('noreferrer');
    }

    // 🔴 链接在 label **外面**：放进 `<label>` 里则点条款会切换勾选，
    // "我想先读条款"变成"我已经同意了"。这是同意留痕上的真缺陷，不是样式问题。
    expect(await dialog.locator('label a[href]').count(), 'label 里不许有链接').toBe(0);
    // 而两条路都得还在：勾选框本身没被挪走。
    await expect(dialog.locator('input[type="checkbox"]')).toHaveCount(1);

    await page.screenshot({ path: SHOT('official-panel') });
  });

  test('真点《服务条款》：新标签里渲染出条款正文，且勾选状态没被动过', async ({
    page,
    context,
  }) => {
    const logs: string[] = [];
    await serveOfficialFromLocalBuild(context);
    await openAuthPanel(page);
    attachLogs(page, logs, 'official');
    await setBaseUrl(page, OFFICIAL);

    const checkbox = page.locator('[role="dialog"] input[type="checkbox"]').first();
    await expect(checkbox).not.toBeChecked();

    const { popup } = await clickAndCapture(page, '/legal/terms/', 'official-terms', logs);
    try {
      expect(popup.url(), '点开的地址必须就是官方域的条款页').toBe(`${OFFICIAL}/legal/terms/`);
      await popup.waitForLoadState('domcontentloaded');
      await waitForAnimationsSettled(popup);
      // 转发没生效时这里拿到的是线上首页 —— 那条断言就是这一整组存在的理由。
      const heading = popup.getByRole('heading', { level: 1 }).first();
      await expect(
        heading,
        `控制台：\n${logs.join('\n')}`,
      ).toContainText('heyta 服务条款', { timeout: 30_000 });
      // 标题**画在屏幕里**，不只是在 DOM 里：`.lp-mask` 把没落位的标题裁在框外，
      // 那时 `toContainText` 照样过，而截图是一条空白。
      const box = await heading.boundingBox();
      expect(box, 'h1 必须有布局盒').not.toBeNull();
      expect(box!.y, '标题必须落在可视区内（被 mask 裁掉时它在视口外）').toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeLessThan(600);
      await popup.screenshot({ path: SHOT('official-terms-page') });
      // 点了条款 ≠ 同意了条款。
      await expect(checkbox, '点外链不许切换同意勾选').not.toBeChecked();
    } finally {
      await popup.close();
    }
  });

  test('真点《隐私政策》：打开的是隐私政策，不是首页外壳', async ({ page, context }) => {
    const logs: string[] = [];
    await serveOfficialFromLocalBuild(context);
    await openAuthPanel(page);
    attachLogs(page, logs, 'official-privacy');
    await setBaseUrl(page, OFFICIAL);

    const { popup, href } = await clickAndCapture(page, '/legal/privacy/', 'official-privacy', logs);
    try {
      expect(href).toBe(`${OFFICIAL}/legal/privacy/`);
      await popup.waitForLoadState('domcontentloaded');
      await waitForAnimationsSettled(popup);
      const privacyHeading = popup.getByRole('heading', { level: 1 }).first();
      await expect(
        privacyHeading,
        `控制台：\n${logs.join('\n')}`,
      ).toContainText('隐私政策', { timeout: 30_000 });
      const privacyBox = await privacyHeading.boundingBox();
      expect(privacyBox, 'h1 必须有布局盒').not.toBeNull();
      expect(
        privacyBox!.y,
        '标题必须落在可视区内（.lp-mask 未落位时它在视口外）',
      ).toBeGreaterThanOrEqual(0);
      // 政策正文里必须真的出现它承诺过的那些词 —— 只验标题会红在"标题对了、正文没渲染"之外的一切情况。
      await expect(popup.getByText('个人信息').first()).toBeVisible();
      await popup.screenshot({ path: SHOT('official-privacy-page') });
    } finally {
      await popup.close();
    }
  });
});

test.describe('另一台服务端：点开的是它自己的 <base>/privacy.html，并且是 404', () => {
  test('地址分流 + 真点开 + 状态码由**那台服务端自己**回答（零转发）', async ({ page, context }) => {
    const logs: string[] = [];
    await openAuthPanel(page);
    attachLogs(page, logs, 'other');
    await setBaseUrl(page, OTHER_SERVER);

    const dialog = page.locator('[role="dialog"]');
    expect(await linkByHref(page, '/terms.html').getAttribute('href')).toBe(
      `${OTHER_SERVER}/terms.html`,
    );
    expect(await linkByHref(page, '/privacy.html').getAttribute('href')).toBe(
      `${OTHER_SERVER}/privacy.html`,
    );
    // 🔴 不许出现官方落地页的痕迹：出现了就是"替别人的实例代发 heyta 的政策"。
    expect(await dialog.locator(`a[href*="waytofuture.cn"]`).count()).toBe(0);

    const { popup, href } = await clickAndCapture(page, '/privacy.html', 'other', logs);
    await popup.screenshot({ path: SHOT('other-server-404') });
    try {
      expect(href).toBe(`${OTHER_SERVER}/privacy.html`);
      // 🔴 导航真的停在那台主机上 —— 没有 302 到落地页、没有兜底回首页。
      expect(new URL(popup.url()).host, '不许悄悄退回落地页').toBe('heyta.finlaw.cloud');
      expect(popup.url()).toBe(`${OTHER_SERVER}/privacy.html`);

      // 第二条独立测量：浏览器落在哪儿是一回事，那个地址答什么码是另一回事。
      const res = await context.request.get(popup.url());
      expect(res.status(), '那台服务端没配 PRIVACY_*，必须是诚实的 404').toBe(404);
      const body = await res.text();
      expect(body, '404 页面里不许出现 heyta 的隐私政策正文').not.toContain('个人信息');

      const pageText = (await popup.textContent('body')) ?? '';
      expect(pageText, '渲染出来的也不是政策页').not.toContain('隐私政策');
    } finally {
      await popup.close();
    }
  });
});

test.describe('还没配服务端地址：不承诺任何文本', () => {
  test('两条链接不存在，但勾选框照旧在', async ({ page }) => {
    await openAuthPanel(page);
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.locator('a[href]')).toHaveCount(0);
    await expect(dialog.locator('input[type="checkbox"]')).toHaveCount(1);
    await page.screenshot({ path: SHOT('no-base-url') });
  });
});
