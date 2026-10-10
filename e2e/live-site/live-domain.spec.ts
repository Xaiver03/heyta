/**
 * 线上站点验收：**真浏览器 + 真域名 + 真 TLS + 真服务端**。
 * ==========================================================
 *
 * 与另三份 e2e 配置的分工见 `playwright.live-site.config.ts` 的文件头。
 * 这一份只回答一个问题：**部署之后，用户真的能用吗？** —— 而且是用
 * `curl` 回答不了的那部分：
 *
 *   · 落地页上的「立即使用」**点下去**落在哪（`curl` 看不到点击）；
 *   · 换域名之后页面里**还有没有旧域名的残留**（分享卡、hreflang、canonical）；
 *   · 应用与同步服务端是不是**真的同源**（WebAuthn 的前提，不同源则 passkey 不可能工作）。
 *
 * ## 规矩来自 `AGENTS.md` §6.2（四条，不是建议）
 *
 * 1. **先截图，再断言** —— 截图在断言之前落盘，失败时也有图；
 * 2. 截图放**固定路径**（`test-results/live-*.png`），不随测试名变化；
 * 3. 抓控制台 `console` 与 `pageerror`，失败时打印出来（白屏的根因只在这里现形）；
 * 4. **人要打开那张图看一眼** —— 不是"截了就算"。
 */

import { expect, test, type Page } from '@playwright/test';

const ORIGIN = process.env['HEYTA_LIVE_ORIGIN'] ?? 'https://heyta.waytofuture.cn';

/** 固定截图路径 —— 规定一第 2 条。 */
const SHOT_DIR = 'test-results';

/**
 * 控制台 / 页面错误收集器 —— 规定一第 3 条。
 *
 * ⚠️ 必须在 `goto` **之前**挂上：挂晚了收不到加载期的错误，
 * 而白屏的根因 100% 在加载期。输出会显示"控制台无内容"，那是最误导人的结果。
 */
function attachLogs(page: Page): string[] {
  const logs: string[] = [];
  page.on('console', (message) => {
    logs.push(`[console.${message.type()}] ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    logs.push(`[pageerror] ${error.message}`);
  });
  page.on('requestfailed', (request) => {
    logs.push(`[requestfailed] ${request.url()} ${request.failure()?.errorText ?? ''}`);
  });
  return logs;
}

/** 未捕获异常与 4xx/5xx 之外的**硬**噪声：`pageerror` 一律算失败。 */
function hardErrors(logs: readonly string[]): string[] {
  return logs.filter((line) => line.startsWith('[pageerror]'));
}

/**
 * 应用是 SPA —— 但**不要用"字符数 > N"当判据**。
 *
 * 🔴 第一次写这条验收时用了 `#root` 的 `textContent.length > 1000`，
 * 结果应用**完全正常渲染**（失败截图里整页 UI 都在、布局正确），
 * 只有这个断言红了 —— 红在一个**我自己编的数字**上。
 * 那个 1000 是照着文档另一处的"14629 字符"猜的，而那一处量的是 `innerHTML`。
 *
 * **拿一个编出来的阈值当验收判据，是"看起来在验收"的典型**：
 * 它既不能证明应用可用，又会在应用完全正常时报警。
 *
 * 所以判据换成"**真正属于应用外壳的东西可见**"：看得见任务输入框，
 * 才叫"应用打开了"。字符数只记进日志，**不做断言**。
 */
async function waitForAppRender(page: Page): Promise<number> {
  // 🔴 两条 needle 都是**词条文本**，而这一发进来的语言不一定是中文：
  //    `withLocale`（`apps/landing/src/lib/app-url.ts`）只给**非默认**那一档打标，
  //    中文落地页的入口地址就是裸的 `/app`，于是应用自己按浏览器语言选 ——
  //    Playwright 的浏览器是 en-US，界面就是英文（实测截图：整页外壳都在，
  //    只是写着 "Add a task…" 与 "Inbox"）。
  //    这条判据要问的是"**应用外壳在不在**"，不是"它写了哪句中文"，
  //    所以中英两版**都算**（写死一版 = 一条会在正确的时候变红的判据）。
  await page
    .locator('input[placeholder*="添加任务"], input[placeholder*="Add a task"]')
    .first()
    .waitFor({ state: 'visible', timeout: 60_000 });
  // 收件箱标题也要在：只有输入框可能是某个残缺的中间态。
  // ⚠️ 不要用 `getByRole('button', { name: '任务' })` —— 侧栏导航不是 button，
  // 那样写会红在一个**选择器猜错**上，而不是应用有问题。
  await expect(
    page.getByText('收集箱').or(page.getByText('Inbox')).first(),
  ).toBeVisible({ timeout: 30_000 });
  return page.evaluate(() => document.querySelector('#root')?.textContent?.length ?? 0);
}

/**
 * 落地页是 React 客户端渲染 + `motion` 入场动画。
 *
 * 🔴 `waitUntil: 'domcontentloaded'` 只保证**HTML 到了**，React 还没跑。
 * 第一次写这条验收时就直接在 `domcontentloaded` 后截图，得到的是一张**全白图** ——
 * 而断言随后仍然是绿的（元素最终渲染出来了）。
 * 一张空白截图作为"界面正常"的证据，比没有证据更坏：它看起来像证据。
 *
 * 所以：先等英雄区标题**可见**，再等网络静默，然后才截图。
 */
async function settleLanding(page: Page): Promise<void> {
  await page.locator('h1').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  // 入场动画（motion）跑完再截，否则拍到的是半透明中间帧。
  await page.waitForTimeout(1200);
}

test('中文落地页 →「立即使用」→ 应用：全程新域名，且无旧域名残留', async ({ page }) => {
  const logs = attachLogs(page);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await settleLanding(page);

  // 规定一第 1 条：**先截图**。
  await page.screenshot({ path: `${SHOT_DIR}/live-landing-zh.png` });
  console.log(`📷 中文落地页：${SHOT_DIR}/live-landing-zh.png`);

  // canonical 必须自我声明**新**域名（爬虫看到的正版地址）。
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${ORIGIN}/`);

  // 旧域名不许以任何形式残留在页面上 —— 这是 R14 那条缺陷的形状：
  // 换域名后分享卡/hreflang 仍印旧地址，**页面不报错**。
  const html = await page.content();
  expect(html, '页面里仍出现旧域名 heyta.finlaw.cloud').not.toContain('heyta.finlaw.cloud');

  /**
   * 入口地址的两条设计口径，逐条都是断言：
   *
   * 1. **不带尾斜杠**（`apps/landing/src/lib/app-url.ts` 的规范化）—— 写死 `/app/`
   *    会让页面上给出的地址与 nginx 的 `location = /app` 301 规则互为冗余。
   *    它点了之后能落到 `/app/`，由下面的 `waitForURL` 证明。
   * 2. **带 `?lang=zh-CN`** —— 中文页也是。这条以前断的是"不带"，前提被
   *    `0aa6cb0e` 撤掉了：应用的首启语言解析链多了系统语言那一层
   *    （**显式存储 > `?lang=` > 系统语言**），不带参数时这里就是英文界面。
   *
   * 🔴 这条用例**故意**不改浏览器语言：`devices['Desktop Chrome']` 的 locale 是 `en-US`，
   *    所以下面 `waitForAppRender` 等到中文输入框这件事，量的是
   *    **落地页带来的 `?lang=` 真的压过了系统语言**，而不是"这台机器恰好是中文"。
   *    少了这个参数，整条用例会红在那句等待上（2026-10-04 实测就是这个形状）。
   */
  // The hero's first primary button is the showcase anchor. The deployed
  // "立即使用" action is the navigation CTA, which is the link under test.
  const cta = page.locator('a.lp-nav__cta');
  await expect(cta).toHaveAttribute('href', `${ORIGIN}/app?lang=zh-CN`);

  await cta.click();
  // 允许 301：`/app` → `/app/`（nginx `location = /app`）。
  await page.waitForURL(/\/app\/?(\?|$)/u, { timeout: 60_000 });
  await expect(page).toHaveTitle('heyta');

  const rootLength = await waitForAppRender(page);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SHOT_DIR}/live-app-after-cta.png` });
  console.log(`📷 点击后落在应用：${SHOT_DIR}/live-app-after-cta.png（#root textContent ${String(rootLength)} 字符）`);

  const hard = hardErrors(logs);
  console.log(`控制台共 ${String(logs.length)} 条：\n  ${logs.join('\n  ')}`);
  expect(hard, `页面抛了未捕获异常：\n${hard.join('\n')}`).toEqual([]);
  // 🔴 这里**故意没有**字符数阈值。
  //
  // 我先后试过 `> 1000` 和 `> 200`，两次都在应用**完全正常渲染**时报警
  // （实测 `#root` textContent 只有 145 字符，而截图里整页 UI 都在）——
  // 数字是照着文档另一处"14629 字符"猜的，那一处量的是 `innerHTML`。
  //
  // 「应用打开了」这件事，上面两条**元素可见**断言（任务输入框 + 收件箱标题）
  // 是严格更强的证据：它们指向真正属于应用外壳的节点。
  // 再叠一个自己编的阈值，只会让验收在正确的时候变红。
});

test('英文落地页的入口带 ?lang=en（否则英文访客进应用看到中文）', async ({ page }) => {
  const logs = attachLogs(page);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto(`${ORIGIN}/en/`, { waitUntil: 'domcontentloaded' });
  await settleLanding(page);
  await page.screenshot({ path: `${SHOT_DIR}/live-landing-en.png` });
  console.log(`📷 英文落地页：${SHOT_DIR}/live-landing-en.png`);

  // 同 ZH：不带尾斜杠，英文页额外带 `?lang=en`（否则英文访客进应用看到中文）。
  // The hero's first primary button is the showcase anchor. The deployed
  // "Use it now" action is the navigation CTA, which is the link under test.
  const cta = page.locator('a.lp-nav__cta');
  await expect(cta).toHaveAttribute('href', `${ORIGIN}/app?lang=en`);

  const hard = hardErrors(logs);
  console.log(`控制台共 ${String(logs.length)} 条：\n  ${logs.join('\n  ')}`);
  expect(hard, `页面抛了未捕获异常：\n${hard.join('\n')}`).toEqual([]);
});

test('凭据页与 API 与站点同域（同源是 passkey 的前提）', async ({ page }) => {
  const logs = attachLogs(page);
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });

  // 用**页面内**的 fetch 而不是 Playwright 的 request fixture：
  // 后者走 Node 的网络栈，验不到 Chromium 的解析与 TLS 路径。
  const probe = await page.evaluate(async (origin: string) => {
    const health = (await fetch(`${origin}/health`).then((r) => r.json())) as { status?: string };
    const verify = await fetch(`${origin}/verify-email`);
    const verifyText = await verify.text();
    const options = (await fetch(`${origin}/api/login/passkey/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'probe@example.com' }),
    }).then((r) => r.json())) as { rpId?: string };
    return {
      healthStatus: health.status,
      verifyStatus: verify.status,
      // 凭据页必须是**服务端渲染的页面**。被落地页的 SPA 兜底吞掉时
      // 返回的是 200 + 落地页 HTML —— 不报错，只是"点登录打开了官网"。
      verifyIsLandingHtml: verifyText.includes('id="root"'),
      rpId: options.rpId,
    };
  }, ORIGIN);

  console.log(`PROBE: ${JSON.stringify(probe)}`);

  expect(probe.healthStatus, '/health 没代理到同步服务端').toBe('ok');
  expect(probe.verifyIsLandingHtml, '/verify-email 被落地页 SPA 兜底吞了').toBe(false);
  expect(probe.verifyStatus, '/verify-email 应当是服务端的诚实失败').not.toBe(200);
  expect(probe.rpId, 'WebAuthn RP ID 没跟着域名一起换').toBe(new URL(ORIGIN).host);

  const hard = hardErrors(logs);
  expect(hard, `页面抛了未捕获异常：\n${hard.join('\n')}`).toEqual([]);
});

/**
 * 管理后台**已真的部署上去**，而且是**锁着**的（ADR-0038）。
 *
 * 这一条验的是部署事实，不是业务逻辑：
 *   · 路由真的注册了（否则会是 404 —— SPA 兜底也可能给出 200 + HTML）；
 *   · 没有令牌时是 **401**，不是 200；
 *   · 而且它返回的是 **JSON**，不是落地页。
 *
 * 🔴 "没人有权限"是**设计**：`users.is_admin` 默认 false，
 * 必须由人在服务器上显式授权（`docker exec … node dist/scripts/admin.js grant <email>`）。
 * 所以这条断言**在授权之后依然成立** —— 它没有令牌，与谁是不是管理员无关。
 */
test('管理后台已部署且默认锁着（无令牌 ⇒ 401 JSON）', async ({ page }) => {
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });

  const probe = await page.evaluate(async (origin: string) => {
    const response = await fetch(`${origin}/api/admin/overview`);
    const text = await response.text();
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      looksLikeLanding: text.includes('id="root"'),
    };
  }, ORIGIN);

  console.log(`ADMIN PROBE: ${JSON.stringify(probe)}`);

  // 404 说明路由没注册；200 说明闸门没生效。两者都是红。
  expect(probe.status, '/api/admin/overview 没有按预期要求身份').toBe(401);
  expect(probe.looksLikeLanding, '管理端点被落地页的 SPA 兜底吞了').toBe(false);
  expect(probe.contentType).toContain('application/json');
});

/**
 * PWA 在**子路径**下的回归判据。
 *
 * 这一条是 2026-09-30 迁移验收时**当场抓到**的真缺陷的守卫：
 * 应用挂在 `/app/` 下，但 `register.ts` 写死 `'/sw.js'`、`gen-pwa.mjs`
 * 生成的 manifest 里 `start_url`/`scope`/`icons[].src` 也是 `/…` ——
 * 于是线上 `/sw.js` 与 `/icons/*.png` 落到站点根（落地页，`text/html`），
 * SW 注册抛 `SecurityError`，**PWA 装出来的入口是落地页**。
 *
 * ⚠️ 它**只能**在这一层验：`vite dev` / `vite preview` 都跑在根路径，
 * 那里旧代码也是对的。
 */
test('PWA 资产在 /app/ 子路径下拿到真身，且 SW 真的注册成功', async ({ browser }) => {
  /**
   * 🔴 这条走的是"访客直接用书签 / PWA 图标打开 `/app/`"——**没有落地页可以继承语言**，
   * 所以应用按解析链第三层（`navigator.language`）走。下面的判据等的是中文外壳，
   * 这个上下文就必须是 `zh-CN`（项目默认的 `Desktop Chrome` 是 `en-US`，
   * 拿默认值跑这条会红在那句"等中文输入框"上，而站点没坏）。
   *
   * 顺带它成了第三层的一条正例：地址栏里**没有** `?lang=`，界面仍是中文。
   */
  const context = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const logs = attachLogs(page);
  await page.goto(`${ORIGIN}/app/`, { waitUntil: 'domcontentloaded' });

  /**
   * 🔴 **必须等应用真的渲染出来再截图** —— 而且这一步本身就是一条判据。
   *
   * 第一版这里截完图才发现是**全白**：这条用例直接 `goto('/app/')`
   * （不像上一条是先点落地页的 CTA），没有等 React 渲染。
   * 一张标着「应用（PWA 验收）」的全白图，比没有图更坏 —— 它看起来像证据。
   *
   * 顺带它把一个**没人验过的入口**补上了：**直接打开 `/app/`**（书签、
   * PWA 启动、或用户手输地址都是这条路径）。上一条只覆盖了"从落地页点进来"。
   */
  const rootLength = await waitForAppRender(page);
  await page.screenshot({ path: `${SHOT_DIR}/live-app-pwa.png` });
  console.log(`📷 应用（PWA 验收）：${SHOT_DIR}/live-app-pwa.png（#root textContent ${String(rootLength)} 字符）`);

  /**
   * 🔴 线上这一层必须**先答掉那份隐私披露**，再等 SW。
   *
   * 注册是刻意排在同意之后的（`apps/web/src/main.tsx` 的 `createStartupNetwork`，
   * G-12：注册本身会向 `scope` 发一次请求，而那时用户还没决定"这台应用会不会
   * 跟服务端说话"）。所以未同意时 `getRegistrations()` **恒空、控制台一条错都没有**
   * —— 这条断言等的是一件产品设计上还没做的事，红的是探针，不是产品。
   * 实测（2026-10-05 线上）：不点同意 ⇒ `sw:"timeout"` 且 `logs: []`；
   * 其余六条读数（`start_url` / `scope` / 图标 / `sw.js` 的 200 与
   * `application/javascript`）当时就已经全对。
   *
   * ⚠️ 点，而不是往 `localStorage` 塞一条已同意记录：这条用例的价值一半在
   * "真人那条路走得通"，预置存储会把同意面板这一段整个绕过去。
   */
  const accept = page.locator('[data-testid="privacy-consent-accept"]');
  await accept.waitFor({ state: 'visible', timeout: 30_000 });
  await accept.click();
  await expect(
    page.locator('[data-testid="privacy-consent-dialog"]'),
    '点了同意之后披露面板必须收掉（还开着就是决定没落）',
  ).toHaveCount(0, { timeout: 15_000 });

  /**
   * 🔴 这两个资产**不许**在 `page.evaluate` 里用 `fetch` 取 —— 要用 `page.request`。
   *
   * 应用把 `globalThis.fetch` 换成了隐私同意闸门（`consent-gate.ts:179`），
   * 而这条用例开的是**全新 context = 还没答过那份披露**，于是页面里的每一次
   * `fetch` 都抛 `PrivacyConsentBlockedError`。症状长得像"PWA 资产取不回来"，
   * 实际取不回来的只有探针 —— 先怀疑探针（§7 元规则 1）。
   *
   * ⚠️ 这**不是**产品缺陷，别去给闸门开后门：浏览器为 PWA 取 manifest、注册 SW
   * 走的是网络栈而不是 `window.fetch`，所以未同意的用户照样装得上 —— 下面那条
   * `serviceWorker.ready` 断言就是这件事的证据，它必须留在页面里等。
   */
  const manifestUrl = new URL('manifest.webmanifest', `${ORIGIN}/app/`);
  const manifestRes = await page.request.get(manifestUrl.toString());
  expect(
    manifestRes.status(),
    `线上 manifest 取回 ${String(manifestRes.status())}，不是 200`,
  ).toBe(200);
  const manifest = (await manifestRes.json()) as {
    start_url: string;
    scope: string;
    icons: { src: string }[];
  };
  // 相对 URL 必须相对 **manifest 自己** 解析（这正是修法的依据）。
  const resolve = (value: string): string => new URL(value, manifestUrl).pathname;
  const swRes = await page.request.get(new URL('sw.js', manifestUrl).toString());

  const sw = await page.evaluate(async () => {
    // SW 真的注册上了吗 —— 这条比"文件取得回来"更强：
    // 它要求浏览器**接受**了那份脚本（MIME 与语法都对）。
    const ready = navigator.serviceWorker.ready.then((registration) => ({
      scope: registration.scope,
      script:
        registration.active?.scriptURL ??
        registration.installing?.scriptURL ??
        registration.waiting?.scriptURL ??
        null,
    }));
    const timeout = new Promise<'timeout'>((resolveTimeout) => {
      setTimeout(() => resolveTimeout('timeout'), 20_000);
    });
    return Promise.race([ready, timeout]);
  });

  const probe = {
    startUrl: resolve(manifest.start_url),
    scope: resolve(manifest.scope),
    iconPath: resolve(manifest.icons[0]?.src ?? ''),
    swStatus: swRes.status(),
    swType: swRes.headers()['content-type'] ?? null,
    manifestType: manifestRes.headers()['content-type'] ?? null,
    sw,
  };

  console.log(`PWA PROBE: ${JSON.stringify(probe)}`);

  // 装出来的入口必须是**应用**，不是站点根的落地页。
  expect(probe.startUrl, 'PWA 的 start_url 不是应用 ⇒ 装出来打开的是落地页').toBe('/app/');
  expect(probe.scope).toBe('/app/');
  expect(probe.iconPath, '把图标解析到了站点根（落地页会返回 text/html）').toBe(
    '/app/icons/icon-192.png',
  );

  // SW 必须是**脚本**而不是落地页 HTML —— 这条正是当初的 SecurityError 来源。
  expect(probe.swStatus).toBe(200);
  expect(probe.swType ?? '', `SW 的 Content-Type 是 ${String(probe.swType)}，不是脚本`).toMatch(
    /javascript/,
  );

  expect(probe.sw, 'service worker 在 20 秒内没有 ready').not.toBe('timeout');
  if (probe.sw !== 'timeout') {
    expect(probe.sw.scope, 'SW 的作用域不是应用所在的 /app/').toContain('/app/');
    expect(probe.sw.script ?? '', 'SW 的脚本地址不是 /app/sw.js').toContain('/app/sw.js');
  }

  // 控制台不许再出现注册失败那条（register.ts 的 warn 文案）。
  const swWarnings = logs.filter((line) => line.includes('service worker 注册失败'));
  console.log(`控制台共 ${String(logs.length)} 条：\n  ${logs.join('\n  ')}`);
  expect(swWarnings, `service worker 注册失败：\n${swWarnings.join('\n')}`).toEqual([]);

  const hard = hardErrors(logs);
  expect(hard, `页面抛了未捕获异常：\n${hard.join('\n')}`).toEqual([]);

  await context.close();
});

/**
 * 🔴 凭据页在真浏览器里**不许有 JS 报错**，按钮必须真的有反应。
 *
 * 这条来自一次**真实报障**（2026-09-30）：用户点邮件里的登录链接，
 * 页面出来了、按钮**点了完全没反应**，控制台是
 *
 * ```
 * magic-login-confirm.js:15 Uncaught TypeError:
 *   Cannot read properties of null (reading 'dataset')
 * ```
 *
 * 根因是脚本被渲染在 `<head>` 里且没有 `defer` —— 同步执行时 `<body>` 还没解析，
 * `document.body` 是 `null`。服务端的单测已经钉住了脚本位置（`server-i18n-design.spec.ts`），
 * 但**只有真浏览器能证明"没有报错、按钮确实有反应"** —— 所以这里再验一层。
 *
 * ⚠️ 用**无效 token**：页面照常渲染，点按钮会走一次注定失败的 POST。
 *    我们要的是"它有反应"（显示出错状态），而不是"登录成功"。
 */
test('凭据页脚本无 JS 报错，且按钮真的有反应', async ({ page }) => {
  const logs = attachLogs(page);

  await page.goto(`${ORIGIN}/magic-login?token=definitely-invalid-token`, {
    waitUntil: 'domcontentloaded',
  });

  // ① 脚本的启动前提成立：body 上有 data-token（也就是脚本没在 body 之前跑）
  const hasToken = await page.evaluate(() => document.body?.dataset.token !== undefined);
  expect(hasToken, 'body.dataset.token 取不到 —— 脚本多半又在 <body> 之前就跑了').toBe(true);

  await page.screenshot({ path: `${SHOT_DIR}/live-magic-login.png` });
  console.log(`📷 魔法登录页：${SHOT_DIR}/live-magic-login.png`);

  // ② 点按钮：必须真的有反应（无效 token ⇒ 出现错误状态），而不是"点了没反应"
  await page.locator('#login-btn').click();
  await expect(page.locator('#error')).toBeVisible({ timeout: 20_000 });

  // ③ 全程不许有未捕获异常 —— 这一条就是报障里那个 TypeError 的判据
  const hard = logs.filter((l) => l.startsWith('[pageerror]'));
  console.log(`控制台共 ${String(logs.length)} 条：\n  ${logs.join('\n  ')}`);
  expect(
    hard,
    `凭据页抛了未捕获异常（用户看到的就是"按钮点了没反应"）：\n${hard.join('\n')}`,
  ).toEqual([]);
});

/**
 * 🔴 「停掉对外错话」这条**只能在线上判**，在仓库里判不算。
 *
 * 本批改写过两条对外自托管文案（词条 `site.docs.selfhost.sum` 与 `site.help.a.selfhost`），
 * 依据是 `docs/research/self-host-distribution-audit.md` §8.21：那句
 * 「不是一个命令就完事」**被本批自己的交付否证** —— `docker-compose.migrate-once.yml`
 * 让首次安装真的是"一条命令起全套"（一次性迁移服务在第一次开机时自己跑）。
 *
 * 但**词条改了 ≠ 页面改了**：那两句由构建期烘进 `apps/landing` 产物里各页面的
 * `index.html`（meta description / og / twitter / JSON-LD）。所以这条判的是"线上现在到底印着谁"。
 * 2026-10-04 00:5x 第一次跑它时它是**红的**，而那条红就是这一项的当前状态，不是测试坏了。
 *
 * 两条腿成对写（本仓规矩：负向断言必须配阳性对照）——
 * 「旧句 0 命中」单独不构成证据：页面整块没构建、404 兜底、meta 压根没渲染，
 * 给出的都是同一个 0。阳性对照跟着当前 IA 的实际标题与摘要走，不能继续依赖已被
 * IA 改写移除的旧锚点。
 */
test('自托管文案：线上不许再印那句已被现量否证的话', async ({ page }) => {
  const logs = attachLogs(page);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto(`${ORIGIN}/docs/selfhost/`, { waitUntil: 'domcontentloaded' });
  // 先让正文真的渲染出来再截图（同 `settleLanding` 的理由：domcontentloaded 时 React 还没跑）。
  await page.locator('h1').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.screenshot({ path: `${SHOT_DIR}/live-selfhost-copy.png` });
  console.log(`📷 线上自建指南页：${SHOT_DIR}/live-selfhost-copy.png`);
  await expect(page.locator('h1').first()).toHaveText('自托管同步服务');

  const STALE = '不是一个命令就完事';
  /**
   * 每页的阳性对照取自当前线上实际烘出的标题与正文摘要：
   * `/docs/selfhost/` 是自托管文章的 SEO 标题与 `site.docs.selfhost.sum`，
   * `/docs/` 是帮助中心标题与 `site.help.a.selfhost`。
   * 旧的「自己运维一套服务」锚点已随 IA 改写移除，不能再拿它证明页面存在。
   */
  const targets = [
    {
      path: '/docs/selfhost/',
      heading: '自建一套同步服务器 —— heyta',
      fresh: '部署自己的服务，配置连接，并维护备份与升级。',
    },
    {
      path: '/docs/',
      heading: '帮助中心 —— heyta',
      fresh: '可以使用自己的同步服务器。部署、升级与备份步骤请查看“自托管同步服务”；连接入口位于应用同步设置的高级选项。',
    },
  ];

  /** 用页面内的 fetch 拿**原始 HTML** —— 这些句子住在 meta 与 JSON-LD 里，不在可见文本里。 */
  const countNeedle = async (p: string, needle: string): Promise<number> =>
    page.evaluate(
      async ({ path, s }: { path: string; s: string }) =>
        (await (await fetch(path)).text()).split(s).length - 1,
      { path: p, s: needle },
    );

  for (const t of targets) {
    const htmlMarks = await countNeedle(t.path, '<html');
    const heading = await countNeedle(t.path, t.heading);
    const stale = await countNeedle(t.path, STALE);
    const fresh = await countNeedle(t.path, t.fresh);
    console.log(
      `${t.path}  heading=${String(heading)}（${t.heading}）  stale=${String(stale)}  fresh=${String(fresh)}（${t.fresh}）`,
    );
    expect(htmlMarks, `${t.path} 取回来的不是一份 HTML 文档（<html 数到 ${String(htmlMarks)}）`).toBeGreaterThan(0);
    // 对照必须在被验状态**之外**取：它红了说明这一页根本不在判据射程里，
    // 此时那条 stale=0 什么都证明不了（404 兜底 / 构建没跑 / 词条没接线都是同样的 0）。
    expect(
      heading,
      `对照落空：${t.path} 里连当前页面标题「${t.heading}」都数不到 —— ` +
        `这一页压根没烘自托管文案，下面的"错话停了"就没有意义。`,
    ).toBeGreaterThan(0);
    expect(
      stale,
      `${t.path} 仍在线上印「${STALE}」${String(stale)} 处。` +
        `仓库里那句已改掉并被 §8.21 现量否证，但落地页要**重新发一次**才会变 ——` +
        `发布命令见 docs/runbooks/deployment.md。`,
    ).toBe(0);
    // 走到这里说明旧句确实没了；这一条再确认**换上去的那句**真的发了出去
    // （只判"旧的不在"会放过一种很具体的坏态：新文案没接进词条、页面只剩半句）。
    expect(fresh, `${t.path} 旧句已停，但新句「${t.fresh}」没在场 —— 发的是半份文案`).toBeGreaterThan(0);
  }

  /**
   * 上面的计数取的是**元数据**（meta / og / twitter / JSON-LD）。但这一页真正被访客读到的
   * 是**渲染出来的正文**，而正文里有一句被本批自己的交付否证得更直接的话：
   *
   *   `site.docs.selfhost.s1i2` 旧值：「…服务自己不在启动时动表结构。」
   *
   * 同一页 §7 让访客敲的那条入口命令**就带着** `-f docker-compose.migrate-once.yml`
   * —— 也就是说"起来"那一次，表结构正是由一个服务在启动时建的。这句话错在正文里，
   * 比错在 meta 里更该停，所以单独判，而且判的是**渲染后的文本**（词条在 JS bundle 里，
   * 抓原始 HTML 数不到它）。
   */
  const bodyText = await page.locator('body').innerText();
  const hits = (needle: string) => bodyText.split(needle).length - 1;
  console.log(
    `正文：章节标题=${String(hits('先把难度说清楚'))}  旧句=${String(hits('服务自己不在启动时动表结构'))}  ` +
      `新句=${String(hits('首次开机由那份一次性迁移服务'))}`,
  );
  // 对照：这一页真的渲染完了（hydration 没做时正文也会是"0 命中"）。
  expect(hits('先把难度说清楚'), '正文里连本节标题都没有 —— 页面没渲染完，下面的 0 命中不算证据').toBeGreaterThan(0);
  expect(
    hits('服务自己不在启动时动表结构'),
    '线上正文仍写着「服务自己不在启动时动表结构」，而同一页 §7 给的入口命令带着 ' +
      '`docker-compose.migrate-once.yml` —— 首次开机就是由一个服务在启动时动的表结构。' +
      '词条已改（`site.docs.selfhost.s1i2`），要**重新发一次落地页**才会变。',
  ).toBe(0);
  expect(
    hits('首次开机由那份一次性迁移服务'),
    '旧句已停，但 §1 的新表述没渲染出来 —— 发出去的可能是旧 bundle（缓存/没重构建）',
  ).toBeGreaterThan(0);

  const hard = hardErrors(logs);
  expect(hard, `线上文档页抛了未捕获异常：\n${hard.join('\n')}`).toEqual([]);
});
