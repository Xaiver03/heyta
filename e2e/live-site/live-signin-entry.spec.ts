/**
 * 线上验收：**点「登录」真的进到登录界面**，而那段说明真的在文档中心。
 * =====================================================================
 *
 * 起因是产品负责人 2026-10-03 的实测（原话）：「点击登录怎么不直接进入到登录界面？
 * 而是出来这么一段说明文字。这段说明文字不应该在帮助里面吗？不应该在文档中心里面吗？」
 * 库里那两层各自都绿（`apps/landing/tests/render.spec.tsx` 1312 条、
 * `apps/web/tests/auth-deep-link.spec.tsx` 5 条），而**这两条判据都是本机的**：
 * 一条测源码，一条测构建产物，没有一条测"服务器上现在躺着的那份字节"。
 *
 * 🔴 所以这一份存在的唯一理由是：`VITE_APP_URL` 是**构建期**变量。
 * 仓库默认构建里它是空的 ⇒ 站点绿、测试绿、线上那个「登录」仍然指向站内那一页。
 * 这种"改对了但没上线"的形状，本批已经踩过一次（§8.13：发出去的第一版自己带着一条 404，
 * 是发布后的实测才抓出来的）。
 *
 * 判据的形状（延续 `live-domain.spec.ts` 文件头那条规矩：**不编阈值**）：
 *
 *   1. 导航那个「登录」的 href 必须**就是**应用地址且带那个参数 —— 参数名不是抄的，
 *      是从**同一页上另一条同源链接**（页头那颗）与 URL 本身推出来的；
 *   2. 点下去之后**先只看到一张浮层**（首启隐私那一层），答完决定之后
 *      **认证表单真的可见**（`auth-form-email` 是四端共用的字段契约，
 *      不是 web 恰好这么写的 DOM）—— 这两步合起来才是用户那句"直接进入到登录界面"，
 *      而第一步单独成判据是因为**叠两层模态**是这次改动自己引入的形状（见下面 ②）；
 *   3. `/signin/` 那一页**没有说明性小节**，但主行动仍然在（防止"删过头"变成空页）；
 *   4. 那段说明在 `/docs/account/` 上**读得到**（needle 来自被搬走的那句话本身）；
 *   5. 出口按钮与页脚那条链接在**同一列**（参照物取自同一页，不引入像素阈值）。
 *
 * ⚠️ 与 `apps/landing/tests/` 的分工：那边钉"代码会渲染出什么"，
 * 这里钉"线上那份产物渲染出了什么"。两边都要 —— 只有前者会漏"没发布"，
 * 只有后者会漏"根本没做"。
 */

import { expect, test, type Page } from '@playwright/test';

const ORIGIN = process.env['HEYTA_LIVE_ORIGIN'] ?? 'https://heyta.waytofuture.cn';

/**
 * 🔴 独立截图目录，**不用** `test-results/`。
 * 同目录 `live-domain.spec.ts` 把自己那批固定路径截图写进共享的 `test-results/`，
 * 两条会话同时跑线上验收会互相吃掉证据（AGENTS §7 记过一次"断言全过而用例判红"）。
 */
const SHOT_DIR = 'live-signin-results';

/** 控制台与页面错误收集器 —— 必须在 `goto` **之前**挂上（AGENTS §6.2 规定一第 3 条）。 */
function attachLogs(page: Page): string[] {
  const logs: string[] = [];
  page.on('console', (message) => {
    logs.push(`[console.${message.type()}] ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    logs.push(`[pageerror] ${error.message}`);
  });
  return logs;
}

/**
 * 等落地页**真的渲染完**再截图。
 *
 * `domcontentloaded` 只保证 HTML 到了；落地页是客户端渲染 + motion 入场动画，
 * 那时截到的是全白一张，而白图看起来仍然"像证据"（同目录那份的实测教训）。
 */
async function settleLanding(page: Page): Promise<void> {
  await page.locator('h1').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);
}

test('线上「登录」：点一次就到登录界面，中途不落在那段说明上', async ({ page }) => {
  const logs = attachLogs(page);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await settleLanding(page);

  // ① 导航那个「登录」的落点：应用 + 那个参数。
  const signin = page.locator('a.lp-nav__signin').first();
  await expect(signin).toBeVisible();
  const href = await signin.getAttribute('href');
  expect(href, '线上导航里没有「登录」的 href —— 落地页多半是**不带 VITE_APP_URL** 构建的').not.toBeNull();
  // The fallback landing build may expose a same-origin relative URL. Resolve
  // it before checking the contract so a deployment problem is reported by
  // the semantic assertions below rather than as `Invalid URL`.
  const target = new URL(href!, page.url());
  expect(target.origin).toBe(ORIGIN);
  // 🔴 参数名从**这一页自己的另一条应用链接**推不出来（那条不带参数），
  // 所以这里只断言"有且仅有一个查询参数，名字叫 signin"这件事的可读形式：
  // 键名写死在这里是**刻意的**，它是线上契约的一半（另一半在 `apps/web`），
  // 而键名两侧的对账由 `apps/landing/tests/render.spec.tsx` 在 CI 里钉住。
  expect([...target.searchParams.keys()]).toContain('signin');
  expect(target.pathname).toBe('/app');

  await page.screenshot({ path: `${SHOT_DIR}/live-1-landing-zh.png` });

  // ② 点它 —— 到的是应用，而且**先只看到隐私那一层**。
  //
  // 🔴 这一条不是妥协，是判据：全新访客（干净上下文 = 没做过隐私决定）点「登录」
  // 落到应用时，第一屏必须是**一张**浮层，不是"登录表单被卡片盖住一半"。
  // 那个叠层形状是这次深链改动自己引入的，2026-10-03 由线上截图看到（第一版这条
  // 用例直接断"表单可见"，结果它红 —— 红得对：表单当时确实不在，因为隐私那一层
  // 还没答，而深链的意图被记到那之后才兑现）。
  await signin.click();
  await page.waitForLoadState('domcontentloaded');
  const consent = page.locator('[data-testid="privacy-consent-dialog"]').first();
  await expect(consent).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-testid="auth-form-email"]')).toHaveCount(0);
  await page.screenshot({ path: `${SHOT_DIR}/live-2a-first-visit-consent.png` });

  // 答完之后，登录表单真的出现 —— 而不是永远不兑现。
  await page.locator('[data-testid="privacy-consent-accept"]').first().click();
  await expect(page.locator('[data-testid="auth-form-email"]').first()).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOT_DIR}/live-2b-signin-panel.png` });

  // 邮箱、密码与登录提交按钮必须真实可见，排除空壳或隐藏表单。
  await expect(page.locator('[data-testid="auth-form-password"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="auth-form-submit"]').first()).toBeVisible();

  // 地址此刻仍然带着那个参数（说明这不是"跳错了地方恰好有个表单"）。
  expect(new URL(page.url()).searchParams.has('signin')).toBe(true);

  const noisy = logs.filter((line) => line.startsWith('[console.error]') || line.startsWith('[pageerror]'));
  expect(noisy, `控制台有错误：\n${noisy.join('\n')}`).toEqual([]);
});

test('线上英文页同一条路（语言参数不能把 signin 挤掉）', async ({ page }) => {
  const logs = attachLogs(page);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto(`${ORIGIN}/en/`, { waitUntil: 'domcontentloaded' });
  await settleLanding(page);

  const signin = page.locator('a.lp-nav__signin').first();
  const href = await signin.getAttribute('href');
  expect(href).not.toBeNull();
  // Keep the same semantic check for the English page while accepting the
  // browser's valid same-origin relative URL representation.
  const target = new URL(href!, page.url());
  expect([...target.searchParams.keys()]).toEqual(expect.arrayContaining(['lang', 'signin']));
  expect(target.searchParams.get('lang')).toBe('en');

  await signin.click();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('[data-testid="privacy-consent-dialog"]').first()).toBeVisible({
    timeout: 60_000,
  });
  await page.locator('[data-testid="privacy-consent-accept"]').first().click();
  await expect(page.locator('[data-testid="auth-form-email"]').first()).toBeVisible({
    timeout: 30_000,
  });
  // 界面确实跟着切到英文 —— 否则"参数带上了但语言丢了"这条判据就没牙。
  await expect(page.locator('html')).toHaveAttribute('lang', /^en/);
  await page.screenshot({ path: `${SHOT_DIR}/live-3-signin-panel-en.png` });

  const noisy = logs.filter((line) => line.startsWith('[console.error]') || line.startsWith('[pageerror]'));
  expect(noisy, `控制台有错误：\n${noisy.join('\n')}`).toEqual([]);
});

test('线上 /signin/ 只剩出口，那段说明在文档中心读得到', async ({ page }) => {
  const logs = attachLogs(page);
  await page.setViewportSize({ width: 1280, height: 900 });

  // ③ `/signin/` 这一页：没有说明性小节，但主行动仍在。
  await page.goto(`${ORIGIN}/signin/`, { waitUntil: 'domcontentloaded' });
  await settleLanding(page);
  const body = page.locator('#main');
  await expect(body.locator('.lp-row')).toHaveCount(0);
  await expect(body.locator('h1')).not.toHaveText('');
  // 出口至少一条（没配应用时是站内锚点，配了是外链 —— 两种都算"有出口"）。
  expect(await body.locator('a[href]').count()).toBeGreaterThan(0);

  /**
   * 🔴 出口必须落在**内容列**里，而不是贴视口左边缘。
   *
   * 这条是"人看图"看出来的：`.lp-section` 只管纵向留白，横向容器是它里面的
   * `.lp-wrap`，少写一层时按钮跑到 x≈10 而引言在 x=88 —— 同一屏两套左边距，
   * 读起来就是"页面坏了"（2026-10-03 第一版线上截图实测到的形状）。
   *
   * 参照物取**同一页页脚**里的那条链接：两者都是 `.lp-wrap` 的直接子元素，
   * 所以这条比的是"同一列"，不引入任何编出来的像素数。
   */
  const ctaBox = await body.locator('.lp-page__cta a').first().boundingBox();
  const footerBox = await page.locator('footer .lp-wrap a').first().boundingBox();
  expect(ctaBox, '正文里没有主行动按钮 —— 上面那条 a[href] 判据的前提变了').not.toBeNull();
  expect(footerBox, '页脚里没有可比的参照链接：这条判据的参照物没了，要改就一起改').not.toBeNull();
  expect(
    Math.round(ctaBox!.x),
    `出口按钮在 x=${String(Math.round(ctaBox!.x))} 而内容列在 x=${String(Math.round(footerBox!.x))} —— 少了一层 .lp-wrap`,
  ).toBe(Math.round(footerBox!.x));

  await page.screenshot({ path: `${SHOT_DIR}/live-4-signin-page.png` });

  // ④ 说明的归处：文档中心那篇文章里，**线上那份**真的读得到。
  await page.goto(`${ORIGIN}/docs/account/`, { waitUntil: 'domcontentloaded' });
  await settleLanding(page);
  const docs = page.locator('#main');
  // 节数与标题数自洽（渲染漏了某一节，两者就会错开）。
  const sections = await docs.locator('.lp-row').count();
  const headings = await docs.locator('.lp-row h2').count();
  expect(headings, `小节 ${String(sections)} 个但标题 ${String(headings)} 个 —— 有一节没渲染出标题`).toBe(sections);
  // needle 是被搬走的那句话里的一段：它**只可能**来自那段说明。
  await expect(docs.getByText('对着 A 服务器登录').first()).toBeVisible();
  // 而它原来待的地方已经没有了（整站 /signin 那一页不再断言"没有密码"）。
  await page.goto(`${ORIGIN}/signin/`, { waitUntil: 'domcontentloaded' });
  await settleLanding(page);
  await expect(page.locator('#main').getByText('没有密码')).toHaveCount(0);
  await page.screenshot({ path: `${SHOT_DIR}/live-5-docs-account.png` });

  const noisy = logs.filter((line) => line.startsWith('[console.error]') || line.startsWith('[pageerror]'));
  expect(noisy, `控制台有错误：\n${noisy.join('\n')}`).toEqual([]);
});
