/**
 * 真浏览器：条款改版后要重新确认才准同步（G-27 的界面取证半边）
 * ============================================================
 *
 * jsdom 那两支（`legal-reconfirm-sheet.spec.tsx` / `legal-recheck-gate.spec.ts`）
 * 数的是"注入的端口被调了几次"。这一支换成真 Chromium + **生产构建**再问一遍：
 *
 *   1. 面板**画得出来**，而且**只有一个肯定动作** —— 「只用本机」这一句在界面上
 *      根本不许出现（这里没有那个选项：设备级同意早就作过了，缺的是这个账号对
 *      现在这一版的确认）。按钮数与文本一起断言，因为"少画一个按钮"在 jsdom 里
 *      可以靠查询不到 testID 蒙过去。
 *   2. 🔴 待补签期间**没有任何 `/api/sync/` 请求**，而同一个分类器**数得出**
 *      `/api/account/legal-consent` 那一条 —— 配了对照，那条"零"才不是恒真
 *      （AGENTS §7 元规则 2）。
 *   3. 「稍后再说」**不落任何记录**，刷新之后面板**还在**（推迟不是同意）。
 *      这条是这一整支里最值钱的：一个"面板没了"的直觉实现很容易顺手把闸门也放开。
 *   4. 点「我已读完并确认」⇒ 提交的 `documentVersion` **逐字等于**服务端带回并
 *      刚刚展示给用户的那一版，然后面板消失。
 *   5. 已同意当前版本的人**一个弹窗都不许看到**（防"每次都拦"的误伤判据）。
 *   6. 英文界面上这句承诺是**英文**（中英词条同批的证据落在真渲染上，不是文件里）。
 *
 * ⚠️ 前置：`apps/web/dist` 必须是当前源码打的（配置文件头那条）。
 *
 * ## 这一支**不**声称覆盖了什么（写出来，别让下一个读者以为数不到就是拦住了）
 *
 * op-log 那条出口（`/api/sync/ops`）在这里数不到"放行之后会长什么样"：口令**永不落盘**
 * 是本仓的既有立场（`credential-storage.ts` 文件头），所以这套桩造不出一个"配好口令"的
 * 冷启动，`syncNow()` 在到闸门**之前**就会以 `not-configured` 返回 —— 那条"零"于是**恒真**。
 * 它在这里只作为**观测记录**保留，非恒真的那一半住在
 * `apps/web/tests/legal-reconfirm-sheet.spec.tsx`：那里播种口令后，断言"确认之后**真的发出**
 * 一条 /api/sync/ 请求"，与"待补签时一条都不发"配成同一个可观测量的两个方向。
 *
 * 🔴 这一支里**不恒真**的出口判据是实时通道：待补签时 `sockets` 为空，确认后同一个计数器
 * 数得到握手（用例 4 的 `poll(sockets.length)`）。WS 不经 `fetch`，是那道闸的第二个出口。
 */

import { expect, test, type Page } from '@playwright/test';

const CONSENT_KEY = 'privacy.consent';
const CREDENTIALS_KEY = 'heyta.sync.credentials';
const RECHECK = '/api/account/legal-consent';
/**
 * 🔴 op-log 同步的**唯一**出口路径（`packages/sync-client/src/client.ts` 里读写都用它：
 * 901 上传、1323 下载）。这一条判据的范围刻意**窄而准**：
 * `/api/sync/status`（权益探测）与 `/api/notifications`（通知轮询）**照样出境** ——
 * 它们送的是账号级元数据（配额数字、服务端生成的通知），不含一个字节的用户明文，
 * 而那句对外承诺的对象是"你的数据同步"。把它们一起拦下会是**另一件事**，
 * 那种范围扩张不该藏在这条判据里（台账 G-27 行按这个口径写边界）。
 */
const OP_LOG_PATH = '/api/sync/ops';
/**
 * 应用**自己的**实时端点（`buildRealtimeUrl`，`packages/sync-client/src/realtime.ts:200`：
 * `ws://<baseUrl>/api/sync/ws?token=…&clientId=…`）。`sockets` 只数这一条 —— 完整理由写在
 * {@link stubRecheck}（那一处同时解释"为什么必须数它"和"为什么不能数别的"）。
 */
const REALTIME_WS_PATH = '/api/sync/ws';
const CURRENT = 'terms@1.2;privacy@1.0';
const RECORDED = 'terms@1.1;privacy@1.0';

const DIALOG = '[data-testid="legal-reconfirm-dialog"]';
const ACTION = '[data-testid="legal-reconfirm-action"]';
const DEFER = '[data-testid="legal-reconfirm-defer"]';
const TERMS = '[data-testid="legal-reconfirm-terms"]';
const PRIVACY = '[data-testid="legal-reconfirm-privacy"]';

const SHOT = (name: string): string => `/tmp/heyta-legal-reconfirm-results/${name}.png`;

interface Seen {
  method: string;
  path: string;
  body: string | null;
}

/**
 * 装好补签端点的应答，并记录**所有** `/api/*` 请求。
 *
 * 🔴 应答是**有状态的**：收到一次"确认现在这一版"的 POST 之后，GET 就改答"不用补签"。
 * 这不是拟真用的装饰 —— 无状态的桩会让下面两条判据**各自恒真**：
 *   · 「确认后刷新不再拦」在无状态桩下永远通过（它压根没记录过任何东西），
 *     而它要钉的正是"确认这件事被服务端记住了"；
 *   · 「推迟后刷新还在」则需要"没收到 POST ⇒ 答案不变"这一半才有意义。
 * 两条合起来才说明**POST 是唯一能改变答案的动作**。
 *
 * ⚠️ 记录的是 pathname，不是整条 URL：查询串里带着令牌，逐字比较会让断言变得没意义。
 */
async function stubRecheck(
  page: Page,
  origin: string,
  needsReconfirm: boolean,
): Promise<{ seen: Seen[]; sockets: string[] }> {
  const seen: Seen[] = [];
  const sockets: string[] = [];
  let confirmedVersion: string | null = null;
  // 实时通道**不走** `fetch`，漏了它等于没测第二条出口（与链 5 那一支同一条理由）。
  //
  // 🔴 但**只许数应用自己那条**（路径 = `REALTIME_WS_PATH`），2026-10-02 实测到两个方向各坏一次：
  //   · 主配置 `playwright.config.ts` 的 webServer 是 `vite --host 127.0.0.1 --port 4318`，
  //     也就是 **dev** 服务器，Vite 的 HMR 客户端每条页面都会开一条
  //     `ws://127.0.0.1:4318/?token=<HMR 随机令牌>`（**根路径**、没有 `/api/sync/ws`、没有 clientId）。
  //     "来者不拒"的计数器于是恒含一条与产品无关的连接 ⇒「待补签时 sockets 为空」**假红**
  //     （在主配置下跑整条套件时它就是红的，红在探针不是闸）。
  //   · 更要命的是反方向：确认后那条正向对照 `poll(sockets.length)` 在 dev 下**恒真** ——
  //     它数到的那条握手就是 HMR，于是"确认之后实时通道真的会重开"这句话**从来没被验过**
  //     （AGENTS §7 元规则 2）。这一支的文件头原先声称它"不恒真"，靠的是各自那份
  //     `playwright.legal-reconfirm.config.ts`（端口 4323 + 生产构建 ⇒ 没有 HMR），
  //     而 spec 同时住在主套件的 `tests/` 里 —— 两套配置跑同一份判据，结论并不一样。
  // 过滤之后两个方向都在两套配置下诚实：dev 里 HMR 不再冒充，正向对照要真连上 `/api/sync/ws` 才过。
  page.on('websocket', (s) => {
    if (new URL(s.url()).pathname === REALTIME_WS_PATH) sockets.push(s.url());
  });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[browser ${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

  await page.route(`**/api/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const post = request.postData();
    seen.push({ method: request.method(), path: url.pathname, body: post });

    if (url.pathname === '/api/account/legal-consent') {
      if (request.method() === 'POST') {
        // 服务端记下的是**收到的那一版**（它与 `currentVersion` 不等时会回 409，
        // 这里模拟的是"提交的就是刚展示的那一版"这一条正常路径）。
        confirmedVersion = post ? (JSON.parse(post).documentVersion as string) : null;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, recordedVersion: confirmedVersion }),
        });
        return;
      }
      const pending = needsReconfirm && confirmedVersion !== CURRENT;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          needsReconfirm: pending,
          reason: pending ? 'version-changed' : 'current',
          currentVersion: CURRENT,
          recordedVersion: pending ? RECORDED : CURRENT,
        }),
      });
      return;
    }
    // 其余 `/api/*`（同步、实时握手…）一律回 500：**不许**因为"没人应答"就把闸门放开，
    // 而这条也让"有没有真的发过 /api/sync/"变得可数。
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"stub"}' });
  });
  void origin;
  return { seen, sockets };
}

/** 一台"已经同意联网、已经登录、凭据齐"的设备（链 5 开着，才轮得到第二道闸）。 */
async function seedDevice(page: Page, origin: string): Promise<void> {
  await page.addInitScript(
    ({ consentKey, credentialsKey, baseUrl }) => {
      window.localStorage.setItem(
        consentKey,
        JSON.stringify({ decision: 'accepted', decidedAt: new Date().toISOString() }),
      );
      window.localStorage.setItem(
        credentialsKey,
        JSON.stringify({ baseUrl, token: 'E2E-TOKEN-123', email: 'e2e@example.test' }),
      );
    },
    { consentKey: CONSENT_KEY, credentialsKey: CREDENTIALS_KEY, baseUrl: origin },
  );
}

const apiSeen = (seen: Seen[], prefix: string): Seen[] =>
  seen.filter((s) => s.path.startsWith(prefix));

test.describe('G-27 · 改版后要重新确认才准同步（真浏览器）', () => {
  /**
   * 🔴 必须**挡掉 service worker**，理由是被这一次实测教出来的（不是预防性的洁癖）：
   * 带着"已同意联网"冷启动时应用会注册 SW，而它一旦接管页面，第二次加载里
   * `/api/*` 的取回走的是 **SW 的网络管线**，`page.route` 收不到 —— 桩答不上话，
   * 应用拿到的是 preview 服务器那句非 JSON 的 404，被判成"问不到"⇒ 闸门按设计放行 ⇒
   * **面板再也不出现**。症状是「推迟后刷新还在」红，而红的原因在探针。
   *
   * ⚠️ 它同时会让「确认后刷新不再拦」变成**恒真**（面板本来就不出现，断言"不出现"当然过）。
   * 所以这两条 reload 判据除了看面板，还各自数一次"reload 之后问到过没有"（见用例内）。
   * SW 那条口本身由 `privacy-consent-zero-egress.spec.ts` 直接观测，不在这里重复。
   */
  test.use({ serviceWorkers: 'block' });

  test('待补签：面板出现、只有一个肯定动作，op-log 与实时通道两个出口都是零', async ({
    page,
    baseURL,
  }) => {
    const origin = String(baseURL);
    const { seen, sockets } = await stubRecheck(page, origin, true);
    await seedDevice(page, origin);
    await page.goto(`${origin}/?lang=zh-CN`);

    await expect(page.locator(DIALOG), '面板没出现 ⇒ 那句承诺没有出口').toBeVisible();
    // 🔴 先截图再断言（§6.2 规定一第 1 条）：失败时也得有图。
    await page.screenshot({ path: SHOT('reconfirm-panel-zh') });

    const buttons = page.locator(`${DIALOG} button`);
    expect(
      await buttons.count(),
      '这块上只许有「我已读完并确认」+ 一条从属的「稍后再说」',
    ).toBe(2);
    const text = String(await page.locator(DIALOG).innerText());
    // 「只用本机」属于设备级那一问；这里再问一遍就是**重复索取同意**。
    expect(text, '补签面板上不许出现"只用本机"这个选项').not.toContain('只用本机');
    expect(text).toContain('我已读完并确认');
    expect(text).toContain('条款文本已经更新');

    await expect
      .poll(() => apiSeen(seen, '/api/account/legal-consent').length, {
        message: '分类器必须数得出那次询问，否则下面的"零"是恒真',
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    const opLog = seen.filter((s) => s.path.startsWith(OP_LOG_PATH));
    expect(opLog, `待补签却把 op-log 发出去了：${JSON.stringify(seen)}`).toEqual([]);
    expect(sockets, `待补签却建了实时通道：${sockets.join(', ')}`).toEqual([]);
    // 如实记下"这条判据**没有**覆盖什么"：权益探测与通知轮询照旧出境（范围见常量注释）。
    console.log(
      `[范围对照] 待补签期间仍然出境的账号级请求：${seen
        .filter((s) => !s.path.startsWith(RECHECK))
        .map((s) => `${s.method} ${s.path}`)
        .join(', ') || '（无）'}`,
    );
  });

  test('两条条款链接指向这台实例自己，而且是链接不是按钮', async ({ page, baseURL }) => {
    const origin = String(baseURL);
    await stubRecheck(page, origin, true);
    await seedDevice(page, origin);
    await page.goto(`${origin}/?lang=zh-CN`);
    await expect(page.locator(DIALOG)).toBeVisible();

    // 链 2 的分流：自建实例的条款就在它自己身上，不指回 heyta 的落地页。
    expect(await page.locator(TERMS).getAttribute('href')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/terms\.html$/);
    expect(await page.locator(PRIVACY).getAttribute('href')).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/privacy\.html$/,
    );
    // 链接在 `<button>` 里会把"读条款"变成"顺手确认"，那是同意书里最坏的一种控件。
    for (const sel of [TERMS, PRIVACY]) {
      expect(await page.locator(sel).evaluate((el) => el.closest('button'))).toBeNull();
    }
  });

  test('点「稍后再说」：面板收起但**不留任何记录**，刷新后还在（推迟不是同意）', async ({
    page,
    baseURL,
  }) => {
    const origin = String(baseURL);
    const { seen } = await stubRecheck(page, origin, true);
    await seedDevice(page, origin);
    await page.goto(`${origin}/?lang=zh-CN`);
    await expect(page.locator(DIALOG)).toBeVisible();

    await page.locator(DEFER).click();
    await expect(page.locator(DIALOG)).toHaveCount(0);
    await page.screenshot({ path: SHOT('after-defer') });
    await page.waitForTimeout(1_200);

    expect(
      apiSeen(seen, '/api/account/legal-consent').filter((s) => s.method === 'POST'),
      '「稍后再说」不该提交确认',
    ).toEqual([]);
    const keys = await page.evaluate(() => Object.keys(window.localStorage));
    expect(
      keys.filter((k) => /legal|reconfirm/i.test(k)),
      `推迟被记成了什么：${keys.join(', ')}`,
    ).toEqual([]);

    // 刷新 ⇒ 重新问一次。**先证明问到过**，再说"面板还在"才有意义
    // （否则面板不出现也可能只是探针没送达 —— 见文件头 `serviceWorkers: 'block'` 那条）。
    const askedBefore = apiSeen(seen, RECHECK).length;
    await page.reload();
    await expect
      .poll(() => apiSeen(seen, RECHECK).length, {
        message: '刷新后没问过补签状态，那条"面板还在"就只是没人问',
        timeout: 15_000,
      })
      .toBeGreaterThan(askedBefore);
    await expect(
      page.locator(DIALOG),
      '刷新后面板不再出现 ⇒ "稍后再说"被当成了已经处理过',
    ).toBeVisible();
  });

  test('点「我已读完并确认」：提交的是刚展示的那一版，随后面板消失', async ({
    page,
    baseURL,
  }) => {
    const origin = String(baseURL);
    const { seen, sockets } = await stubRecheck(page, origin, true);
    await seedDevice(page, origin);
    await page.goto(`${origin}/?lang=zh-CN`);
    await expect(page.locator(DIALOG)).toBeVisible();

    await page.locator(ACTION).click();
    await expect(page.locator(DIALOG)).toHaveCount(0);
    await page.screenshot({ path: SHOT('after-confirm-zh') });

    const posts = apiSeen(seen, '/api/account/legal-consent').filter((s) => s.method === 'POST');
    expect(posts, '确认没有提交').toHaveLength(1);
    const body = JSON.parse(String(posts[0]!.body)) as Record<string, unknown>;
    // 🔴 提交的必须是**读侧带回、界面刚展示**的那一版（不是本机另存的一份，
    // 也不是"他上次同意的那一版" —— 那等于把旧确认再签一遍）。
    expect(body['documentVersion'], `提交错了版本：${JSON.stringify(body)}`).toBe(CURRENT);
    expect(typeof body['acceptedAt']).toBe('number');
    expect(Number.isInteger(body['acceptedAt'])).toBe(true);

    // 🔴 正向对照：上面那条"待补签时 sockets 为空"要可信，这里必须数得到**建过**连接
    // （preview 不认 WS 握手也没关系 —— 计数的是"发过握手"，那正是闸门放行的证据）。
    await expect
      .poll(() => sockets.length, {
        message: '确认之后应当尝试建实时通道；数不到说明探针看不见 WS',
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    // 确认之后闸门放开：这条用"再问一次还弹不弹"来验。**先证明 reload 之后真的又问过**
    // —— 不然"面板没出现"同样可能是根本没问（与上面「稍后再说」那条形成的正是同一个
    // 可观测量的**两个方向**：一个恒真，另一个也就不可信了）。
    const askedBefore = apiSeen(seen, RECHECK).length;
    await page.reload();
    await expect
      .poll(() => apiSeen(seen, RECHECK).length, {
        message: '刷新后没问过补签状态，那条"确认之后不再拦"就只是没人问',
        timeout: 15_000,
      })
      .toBeGreaterThan(askedBefore);
    await expect(page.locator(DIALOG), '确认之后不该再拦').not.toBeVisible();
  });

  test('🔴 已同意当前版本的人：一个弹窗都不许看到（防"每次都拦"的误伤）', async ({
    page,
    baseURL,
  }) => {
    const origin = String(baseURL);
    const { seen } = await stubRecheck(page, origin, false);
    await seedDevice(page, origin);
    await page.goto(`${origin}/?lang=zh-CN`);

    await expect
      .poll(() => apiSeen(seen, '/api/account/legal-consent').length, {
        message: '问过之后才可以断言"没弹"',
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    await page.waitForTimeout(1_500);
    await page.screenshot({ path: SHOT('clear-no-panel') });
    expect(await page.locator(DIALOG).count(), '这一版已经确认过，不该再拦').toBe(0);
  });

  test('英文界面：这句承诺是英文，且不漏汉字', async ({ page, baseURL }) => {
    const origin = String(baseURL);
    await stubRecheck(page, origin, true);
    await seedDevice(page, origin);
    await page.goto(`${origin}/?lang=en`);
    await expect(page.locator(DIALOG)).toBeVisible();

    const text = String(await page.locator(DIALOG).innerText());
    await page.screenshot({ path: SHOT('reconfirm-panel-en') });

    expect(text).toContain('I have read and confirm');
    expect(text).toContain('Not now');
    expect(text, `英文界面露出中文：${text}`).not.toMatch(/[一-鿿]/u);
  });
});
