/**
 * 线上验收：`/admin` 这一格地址本身。
 * =====================================================================
 *
 * 本机那一套（`e2e/tests/admin-console-route.spec.ts`）钉的是"界面会画成什么样"，
 * 它连的是假端点与本地 vite —— **没有一条判据打在"服务器上现在躺着的那份字节"上**。
 * 这一族缺口的形状本仓已经记过：`live-signin-entry.spec.ts` 文件头写的
 * "仓库默认构建里 VITE_APP_URL 是空的 ⇒ 站点绿、测试绿、线上那个按钮仍然指向错的地方"。
 *
 * 这一份补的就是那一格，而且只补**不需要凭据**的那部分：
 *
 *   1. `/admin` 回 200，且 HTML 与 `/app/` **逐字节同一份**（后台壳是应用自己按
 *      pathname 切的，边缘只交那一份 index.html；两份产物 = 迟早不同步）；
 *   2. 那份 HTML **不许被启发式缓存**（`cache-control: no-cache`）—— 发布时旧分片被
 *      清掉，拿着旧 HTML 的人去请求不存在的 JS，症状是白屏；
 *   3. `/admin/` 301 到 `/admin`（同一个界面不许有两个正规地址）；
 *   4. 未登录打开 `/admin`：落点是**登录**，既不是空白，也不是任务视图；
 *   5. 🔴 后台那三条读端点在**没有会话时一律 401** —— 这一条钉的是"权限在边缘之外
 *      还在服务端"：地址公开 ⇒ 任何人都能敲，判不许靠界面藏。
 *
 * ⚠️ 第 5 条用 `request` fixture 打，不用 `page.evaluate` 里的 `fetch`：
 * 后者会被应用自己的隐私同意闸门挡下（本仓线上验收记过的那条假红），
 * 而"被闸门挡下"与"服务端拒绝"在结果上都是拿不到数据 —— 只有绕开浏览器才分得清。
 *
 * 🔴 这一份**故意不含**"登录进去点三个发放动作"那条：那需要一把线上凭据，
 * 而凭据不许住在仓库里。那一格的做法写在
 * [`docs/plans/admin-console.md`](../../docs/plans/admin-console.md) §9.4。
 */

import { expect, test } from '@playwright/test';

const ORIGIN = process.env['HEYTA_LIVE_ORIGIN'] ?? 'https://heyta.waytofuture.cn';

/** 独立截图目录（不用共享的 `test-results/`，理由同 `live-signin-entry.spec.ts`）。 */
const SHOT_DIR = 'live-admin-results';

/**
 * 后台壳在**那份 HTML 里**的标记。
 *
 * ⚠️ 不能用"管理后台"那四个字：它是 JS 起来之后由 i18n 渲染的，静态 HTML 里没有，
 * 拿它当标记会得到一条"200 且字节确实是对的"却判红的假红（2026-10-25 第一次跑就是红的在这里）。
 * 这一枚 `<link rel="manifest" href="/app/manifest.webmanifest">` 是构建期写进 HTML 的，
 * 而且**只有应用那份** index.html 有 —— 落地页的是 `/manifest.webmanifest`。
 */
const CONSOLE_MARK = 'href="/app/manifest.webmanifest"';

test('线上 /admin：与 /app/ 同一份 HTML、不缓存、带斜杠那条 301 回来', async ({ request }) => {
  const admin = await request.get(`${ORIGIN}/admin`);
  expect(admin.status()).toBe(200);
  const adminBody = await admin.text();
  // 这一句挡的是"200 但交回来的是落地页"——本域名历史上踩过三次（nginx 时代
  // 的 /health、/terms.html、/*.js 都掉进过 SPA 兜底），所以断言内容而不是状态码。
  expect(adminBody, '/admin 交回来的不是应用那份 HTML').toContain(CONSOLE_MARK);

  const app = await request.get(`${ORIGIN}/app/`);
  expect(app.status()).toBe(200);
  expect(adminBody, '/admin 与 /app/ 不是同一份字节 ⇒ 边缘在复制产物，迟早不同步').toBe(
    await app.text(),
  );

  const cacheControl = admin.headers()['cache-control'] ?? '';
  expect(cacheControl, 'HTML 没有 no-cache：发一次布就有人白屏').toContain('no-cache');

  const slash = await request.fetch(`${ORIGIN}/admin/`, { maxRedirects: 0 });
  expect(slash.status()).toBe(301);
  expect(new URL(slash.headers().location ?? '', ORIGIN).pathname).toBe('/admin');
});

test('线上 /admin 未登录：给的是"进不去"的一句话，而后台端点在服务端被拒（不是靠界面藏）', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${ORIGIN}/admin`, { waitUntil: 'domcontentloaded' });

  // 全新访客第一屏是隐私那一层（与 /app/ 同一条纪律）。
  // 🔴 必须**等**它，不许 `isVisible()` 判一下就走：应用是启动后才渲染那一层的，
  // 2026-10-25 第一版就是拿瞬时可见性当判据，结果那一层在截图里明明开着，
  // 用例却判它"不在"，然后去等一个永远不会出现的登录表单。
  const consent = page.locator('[data-testid="privacy-consent-dialog"]');
  await consent
    .waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => page.locator('[data-testid="privacy-consent-accept"]').first().click())
    .catch(() => undefined);

  // 落点：后台壳在，而**内容区一块都没有**（未登录不许看到任何读数），
  // 并且那一格给的是**一句原因**而不是空白。
  // ⚠️ 断"非空"不断字面：这句话跟着界面语言走（线上这一趟是英文装机态），
  // 钉死中文会得到一条只在默认语言下才成立的假判据。
  await expect(page.getByTestId('admin-console')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('admin-panel')).toHaveCount(0);
  await expect(page.getByTestId('admin-console-reason')).not.toHaveText('');
  await page.screenshot({ path: `${SHOT_DIR}/live-admin-logged-out.png`, fullPage: true });

  expect(errors, `页面报错：\n${errors.join('\n')}`).toEqual([]);

  // 🔴 三条读端点在没有会话时**必须** 401。地址是公开的，任何人都会敲到这里；
  // 判如果写在界面里（"没登录就不渲染那一格"），拿 curl 就能把数据读走。
  for (const path of ['/api/admin/skus', '/api/admin/subscriptions/grants', '/api/admin/overview']) {
    const res = await request.get(`${ORIGIN}${path}`);
    expect(res.status(), `${path} 在没有会话时竟然回了 ${String(res.status())}`).toBe(401);
  }
});
