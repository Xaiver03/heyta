/**
 * A 包两条「阻断性提示」的真浏览器证据（R1 · ADR-0084）
 * =====================================================
 *
 * A 包验收记录 §三 第 1 条自认：这两态**只有 jsdom**（`apps/web/tests/account-security.spec.tsx`
 * 与 `sync-data-status.spec.tsx` 各有一条），真浏览器一张图都没有。这一份补那两张图，
 * 并且**尽量走真路径**（见每条用例的「造法」）。
 *
 * ## 两态各自靠什么成立
 *
 * | 态 | 界面元素 | 真实前置 | 本文件怎么造 |
 * |---|---|---|---|
 * | 归属冲突 | `library-owner-conflict` + 唯一出口 `library-owner-clear` | 这台设备上的库**已经绑给另一个账号** | **真路径**：先用 A 的凭据启一次（`verifyLibraryOwner()` 把库绑给 A），再把凭据换成 B 并刷新 —— 这正是"共享电脑换人用"的形状，一行产品代码都没绕 |
 * | 登出后红条 | `sign-out-erase-failed` | `purgeLocalLibrary()` 回 `incomplete`（某个容器没删掉） | **故障注入**：让 `localStorage` 的**访问**抛错（隐私模式/存储不可用是真实条件），销毁报告里那条 `containerRemoved:false` ⇒ 状态 `incomplete`。⚠️ 这一条是**注入**，不是"用户真的退出登录就会看到" —— 见报告 |
 *
 * ## 🔴 与 A 包验收记录对账时发现的一处**不准**
 *
 * 记录第 12 行写「退出登录后顶部红条『本机的任务数据没有清除干净』+ 重试」。
 * 现量读 `SignOutNotice.tsx`（改之前）：`local-erase-failed` 那一支**只有一个标题、没有任何动作**，
 * 而重试按钮 `sign-out-retry` 属于**另一支** `pending-revocation`（服务端那枚没撤销）。
 * ⇒ 那句"重试"把两件事并成了一件；而更贵的一半是**那一支本来就该有个动作** ——
 * 它的指引是「请**重新退出一次**」，可用户**已经退出了**，退出入口此时变成「登录」。
 *
 * ## 2026-11-07：这一档从"只说不做"改成"有一枚动作"（判据跟着翻）
 *
 * 这一支补了一枚 `sign-out-erase-retry`，调的是与 `libraryOwner` 那一支**同一个**
 * `purgeLocalLibrary()`（成功 ⇒ `reload()`；仍 `incomplete` ⇒ 红条留着、按钮可再点）。
 * ⇒ 旧断言「红条里**不许**有按钮」**被推翻了**，现在钉的是：
 *   ① 有且仅有一枚动作；② 它**不是**服务端那条「重新尝试撤销」（两个分支不许混）；
 *   ③ 点了仍失败 ⇒ 红条还在 + 按钮可再点（不是"点完就消失"，也不是"永久禁用"）；
 *   ④ 把前置条件恢复之后再点 ⇒ 走成功那一路，`reload()` 之后红条消失。
 * 🔴 留下"为什么翻"：**判据的对象变了**（当时确实没有按钮，现在有了），
 * 这不是放宽，是把"图上没有按钮而文案说有"那一格补成真的。
 *
 * ⚠️ 按钮文案目前**复用** `common.libraryOwner.clear`（「清除本机数据」/`Clear this device`）——
 * `packages/i18n` 此刻由另一个包独占（单对象字面量，两边同时加键会静默吃掉一方），
 * 所以本包**不加新键**；「再清一次」那一对 zh/en 写在交付报告里，由总包统一追加。
 */
import { expect, test, type Page } from '@playwright/test';

import { openApp, parkCursor, stubLegalRecheck, stubPublicFacts } from './helpers';

const SERVER = 'http://owner-conflict.e2e.test';

const SHOT = (name: string): string => `../apps/web/evidence/signout-owner-notice/${name}.png`;

interface Seeded {
  readonly baseUrl: string;
  readonly token: string;
  readonly email: string;
  readonly accountId: string;
}

const credentialsOf = (accountId: string): Seeded => ({
  baseUrl: SERVER,
  token: `e2e-owner-token-${accountId}`,
  email: `${accountId}@example.test`,
  accountId,
});

/** 开机就会打的那几条请求：不登记它们，失败会看着像"同步坏了"。 */
async function stubBootRequests(page: Page): Promise<void> {
  await stubLegalRecheck(page, SERVER);
  await stubPublicFacts(page, SERVER);
  await page.route(`${SERVER}/api/sync/status**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ latestSeq: 0 }),
    });
  });
  await page.route(`${SERVER}/api/sync/payload-mode**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ mode: 'e2ee' }),
    });
  });
  // 撤销端点：让「退出登录」这条路能走完（本文件不验撤销，只验它之后本机剩什么）。
  await page.route(`${SERVER}/api/auth/logout**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.routeWebSocket(`ws://owner-conflict.e2e.test/api/sync/ws*`, () => {
    /* 保持连接打开即可 */
  });
}

async function seed(page: Page, accountId: string): Promise<void> {
  await page.addInitScript((creds: Seeded) => {
    localStorage.setItem('heyta.sync.credentials', JSON.stringify(creds));
  }, credentialsOf(accountId));
}

test.describe('A 包两条阻断性提示（真浏览器）', () => {
  test('归属冲突：A 的库 + B 的凭据 ⇒ 红条 + 唯一出口「清除本机数据」', async ({ page }) => {
    await stubBootRequests(page);
    /*
      🔴 **不能用 `addInitScript` 播种凭据**（第一版就是这么写的，红在"没有冲突提示"上）。
      `addInitScript` 在**每一次导航**前都会重跑：第二趟我们把 localStorage 换成 B、
      然后 `reload()` —— 而那条 init script 又把它写回 A ⇒ 第二趟测的还是 A，
      于是"没有冲突提示"是**对的**，红的是探针（这不是产品缺陷，是探针坏了）。
      ⇒ 改成"先让应用起来，再用 evaluate 写凭据，再刷新"：写进去的是谁，测的就是谁。
      这也是唯一一条不绕开产品代码的播种方式 —— 凭据的正式入口就是 localStorage 那一个键。
    */
    const setCredentials = (accountId: string) =>
      page.evaluate((creds) => {
        localStorage.setItem('heyta.sync.credentials', JSON.stringify(creds));
      }, credentialsOf(accountId));

    // ① 先让应用起一次（承不承载凭据都行），拿到一个已决定的隐私同意。
    await openApp(page, '/?lang=zh-CN', 'accepted');

    // ② 以 **A** 启动：`verifyLibraryOwner()` 会把本机库绑给 A。
    //    ⚠️ 这一步不是"造状态"，它是真路径的前半段 —— 库的归属只能由一次真实会话写出来。
    await setCredentials('acct-a');
    await page.reload();
    await openApp(page, '/?lang=zh-CN', 'accepted');
    await expect(
      page.getByTestId('library-owner-conflict'),
      '第一次以 A 启动就出现归属冲突 ⇒ 这一条没有基准（前一半没成立）',
    ).toHaveCount(0);
    // 归属是启动时 fire-and-forget 的一次异步写，等它落库再换人。
    await page.waitForTimeout(1_500);

    // ③ 换成 **B** 的凭据（模拟"这台设备换人用了"），刷新。
    await setCredentials('acct-b');
    await page.reload();
    await openApp(page, '/?lang=zh-CN', 'accepted');

    const notice = page.getByTestId('library-owner-conflict');
    await expect(notice, 'B 的凭据 + A 的库，却没有归属冲突提示 ⇒ 上一个账号的数据还看得见').toBeVisible();
    // 三件事各自都要成立：标题说清"属于另一个账号"、正文点名那是谁、出口只有一枚。
    await expect(notice).toContainText('这台设备上的数据属于另一个账号');
    await expect(notice).toContainText('acct-a');
    const clear = page.getByTestId('library-owner-clear');
    await expect(clear, '冲突提示里没有「清除本机数据」⇒ 用户被卡死在这一屏').toBeVisible();
    await expect(clear).toHaveText('清除本机数据');
    await expect(
      notice.locator('button, a'),
      '冲突提示里的可点控件不止一枚 ⇒ "唯一出口"这句话不成立',
    ).toHaveCount(1);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('1-owner-conflict') });
  });

  test('登出后红条：销毁没清干净 ⇒ 红条说出实话，并给一枚「再清一次」', async ({ page }) => {
    await stubBootRequests(page);
    await seed(page, 'acct-c');
    await openApp(page, '/?lang=zh-CN', 'accepted');

    /*
      🔴 先量一次**原样**的退出登录：本构建里销毁是能成功的（下面那句 `console.info`
      把读数打出来）。也就是说这条红条**不是**"退出登录就会看到"的那一态 ——
      它只在某个容器删不掉时出现。这个前提必须写在证据里，不能靠读者猜。
    */
    await page.getByTestId('account-menu-avatar').click();
    await page.getByTestId('account-menu-signout').click();
    // 销毁成功时 `finish()` 会 `location.reload()`；给 6 秒看它出不出那条红条。
    const appearedNaturally = await page
      .getByTestId('sign-out-erase-failed')
      .waitFor({ state: 'visible', timeout: 6_000 })
      .then(() => true)
      .catch(() => false);
    // eslint-disable-next-line no-console
    console.info(
      `[A包] 原样退出登录后出现 "本机没清干净" 红条：${appearedNaturally ? '是' : '否（本构建的销毁成功）'}`,
    );

    /*
      真正的取证走**注入**那一趟：把 `localStorage` 的访问变成抛错
      （隐私模式 / 被策略禁用时浏览器就是这个行为），于是
      `wipePrefixedKeys` 回 -1 ⇒ 那条报告 `containerRemoved:false` ⇒
      `purgeLocalLibrary()` 回 `incomplete` ⇒ `notice = 'local-erase-failed'`。
      ⚠️ 注入的是**前置条件**，不是那句红条本身：状态判定、渲染、文案全走产品代码。
      ⚠️ 原生取值器先存下来 —— 下面要把它**还回去**，好验成功那一路（`reload()` 之后红条消失）。
    */
    await page.reload();
    await openApp(page, '/?lang=zh-CN', 'accepted');
    /*
      哨兵键：`heyta.e2e.sentinel` 是**只由这条用例写**的一个 `heyta*` 前缀键。
      销毁路径里那句 `wipePrefixedKeys(localStorage)` 会把它抹掉 ——
      所以"它还在不在"就是"purge 到底跑没跑"的**可观测读数**（见下面那段判据）。
      ⚠️ 不能用 `heyta.sync.credentials` 当哨兵：登出自己就会把它删掉，
      那样哨兵恒缺，判据就没有牙了（第一版踩过）。
    */
    await page.evaluate(() => {
      localStorage.setItem('heyta.e2e.sentinel', '1');
      /*
        🔴 原生 `localStorage` 在 Chromium 里是 **window 自己的** 访问器
        （不在 `Window.prototype` 上）。所以还原时必须把那份**自有描述符放回去**，
        不能用 `delete window.localStorage` —— 删了就什么都不剩了
        （第一版这么写，报 `ReferenceError: localStorage is not defined`）。
      */
      (window as unknown as { __e2eLsDesc?: PropertyDescriptor }).__e2eLsDesc =
        Object.getOwnPropertyDescriptor(window, 'localStorage');
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new Error('e2e：模拟隐私模式下的 localStorage 不可用');
        },
      });
    });

    await page.getByTestId('account-menu-avatar').click();
    await page.getByTestId('account-menu-signout').click();

    const banner = page.getByTestId('sign-out-erase-failed');
    await expect(
      banner,
      '销毁报告里有 containerRemoved:false，界面却没出那句红条 ⇒ 用户在"没清干净"的机器上以为清干净了',
    ).toBeVisible();
    // 整句是「这台设备已退出，但本机的任务数据没有清除干净。点下面的「清除本机数据」再试一次；……」
    await expect(banner).toContainText('本机的任务数据没有清除干净');

    /*
      🔴 **红条上必须有一个"再清一次"的动作**（2026-11-07 看图后补的那一刀）。
      A 包验收记录当时写的是"红条 + 重试"，而那一支**一个按钮都没有** ——
      图上没有、文案说有，靠读代码是发现不了的（先看图再读文案才发现）。
    */
    const clearAgain = page.getByTestId('sign-out-erase-retry');
    await expect(
      clearAgain,
      '这一支又回到了"只说不做"：红条指的两条路（再退出一次 / 清浏览器数据）在退出之后都不可达',
    ).toBeVisible();
    await expect(clearAgain).toBeEnabled();
    // 它**不是**服务端那条「重新尝试撤销」（`common.signOut.retry`）—— 两个分支不许混。
    await expect(clearAgain).not.toHaveText(/撤销/);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('2-signout-erase-failed') });

    // ① 失败那一路：容器还是删不掉 ⇒ 红条留着、按钮回到可点（可以再点一次）。
    await clearAgain.click();
    await expect(banner, '再清一次失败之后红条消失了 ⇒ 界面假装清了').toBeVisible();
    await expect(clearAgain, '失败之后按钮停在 disabled ⇒ 用户只能刷新页面').toBeEnabled();

    // ② 第二趟：把 localStorage 还回去（= 用户关掉了占着库的标签页），再点一次。
    await page.evaluate(() => {
      const desc = (window as unknown as { __e2eLsDesc?: PropertyDescriptor }).__e2eLsDesc;
      if (desc === undefined) throw new Error('e2e：没存到 localStorage 的原生描述符');
      Object.defineProperty(window, 'localStorage', desc);
    });
    /*
      🔴 **成功那一路的判据 = 产品自己重载了，且红条随之消失。**

      实测（2026-11-07）：把 localStorage 的原生描述符还原之后点「再清一次」，
      `purgeLocalLibrary()` 这一趟**成功了**（`purged`）⇒ `window.location.reload()`。
      ⚠️ 第一版这里用 `await page.waitForLoadState(); await openApp();` 去"接住"这次重载 ——
      那是**探针替产品把人导航走了**：把 onClick 注掉之后它照样绿（`openApp` 自己会 goto）。
      现在只等**产品发起的那一次 load**，没有它就一直等到超时。
    */
    /*
      🔴 `unrouteAll` 必须在点之前：产品自己那次 `window.location.reload()` 会**打断在途的
      `page.route` 处理器**，而 `shims.ts:127` 里的 `response.text()` 此时已经 disposed
      ⇒ 整条用例死在 `apiResponse.text: Response has been disposed`，看起来像产品没重载。
      实测（2026-11-06）：不解除路由时 2/2 都红；解除后绿。
      `behavior: 'ignoreErrors'` 是给"已经无人等待的处理"用的，不是放宽判据。
    */
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    const [reloaded] = await Promise.all([
      page
        .waitForEvent('load', { timeout: 15_000 })
        .then(() => true)
        .catch(() => false),
      clearAgain.click(),
    ]);
    // eslint-disable-next-line no-console
    console.info(`[A包] 「再清一次」成功那一路：页面重载=${reloaded ? '是' : '否'}`);
    expect(
      reloaded,
      '点了「再清一次」、销毁也成功了，页面却没重载 ⇒ 界面还停在一个已经清空的库上，用户看不出"清干净了"',
    ).toBe(true);
    await expect(
      page.getByTestId('sign-out-erase-failed'),
      '重载之后红条还在 ⇒ 用户会以为本机数据还留着',
    ).toHaveCount(0);
    // 顺手记一笔：哨兵键被 purge 抹掉了（`wipePrefixedKeys` 的证据）。
    expect(
      await page.evaluate(() => localStorage.getItem('heyta.e2e.sentinel')),
      '销毁成功了而 heyta.* 前缀键还在 ⇒ 那一趟 purge 没走完整的清理路径',
    ).toBeNull();
  });
});
