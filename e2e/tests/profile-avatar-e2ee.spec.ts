/**
 * R15b · 头像的**端到端**往返（真浏览器 · 假服务端只搬字节）
 * ==========================================================
 *
 * 这一条补的是 `apps/web/evidence/profile-panel/README.md` 里那句
 * 「这几张图**没有**证明的第一件事：**没有真的上传图片**」。R15b 把读侧状态机
 * 抽进共享层之后，界面在四种状态里各说一句 —— 那种"各说一句"最该在真浏览器里
 * 走一遍，因为它的失败形状是**界面对解得开的图说解不开、对解不开的图说没有**。
 *
 * ## 载体：为什么是 dev server + `page.route`，不是那个假端点
 *
 * · `../stub-provider.mjs` 只实现 `/v1/chat/completions`，其余一律 404；
 * · 服务端**本来就不该**能解开头像（E2EE），所以这里刻意用**只会存字节**的假路由：
 *   它收到的就是 `{cipherBase64}`，存下来，下一次 GET 原样吐回去。
 *   **加密与解密两端都发生在真应用的真代码里**（Argon2id + AES-GCM，`@heyta/sync-core`），
 *   所以这条链不是 mock 出来的 API —— 桩只替代了 Postgres 那一格。
 * · ⚠️ 这里能用地地道道的 `page.route` 而不是像 `inbox.spec.ts` 那样担心 service worker：
 *   e2e 跑的是 vite **dev**（`import.meta.env.PROD === false`），`register.ts` 直接 return，
 *   没有 SW 接管 fetch（§7 那一族"SW 接管后 page.route 收不到 /api/*"在这条路上不成立）。
 *
 * ## 三段旅程与各自的那条产品结论
 *
 * | 段 | 界面状态 | 断言的产品结论 |
 * |---|---|---|
 * | ① 冷启动 | 口令不在内存（**设计如此**，`credential-storage.ts`） | 说的是"要先填一次口令"那句陈述句，而**不是**"你还没有头像"，也没有红字 |
 * | ② 填口令 + 选一张真图 | `ready` | 说的是"头像已更新"；`<img>` 真的把**解开之后的字节**画出来了（`naturalWidth > 0`） |
 * | ③ 刷新一次 | `needs-password`（口令不落盘 ⇒ 解不开） | 图还在服务端，界面**不许**改口说"没有头像" —— 这正是 R15b 抽共享裁决要堵的那个洞 |
 *
 * 🔴 另有一条与界面无关但更硬的：服务端收到的字节里**不许出现明文的 MIME 串**。
 *    这条挂了同刻的正向对照（客户端预览那条 `data:` URI 里同一枚 needle 必须找得到），
 *    否则"搜不到"可能只是探针根本没跑到那段字节（§7 元规则 1）。
 */

import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import {
  decidePrivacyConsent,
  enableAllModules,
  openSettingsView,
  stubLegalRecheck,
  stubEmptyHolidayAdjustments,
} from './helpers';
import { installMissingProducerShims } from './shims';

/** 假服务端：一个**不会被解析**的地址，所有请求都被 `page.route` 截住。 */
const SERVER = 'http://sync.e2e.test';
const REALTIME_WS = 'ws://sync.e2e.test/**';
const PASSWORD = 'e2e-头像口令-42';

const PANEL = '[data-testid="profile-panel"]';
const AVATAR_IMG = '[data-testid="profile-avatar-img"]';
const FILE_INPUT = '[data-testid="profile-avatar-file"]';
const NEED_PASSWORD = '[data-testid="profile-avatar-need-password"]';
const WRITE_NOTICE = '[data-testid="profile-avatar-notice"]';
const READ_NOTICE = '[data-testid="profile-avatar-read-notice"]';

const SHOT = (name: string): string => `../apps/web/evidence/profile-panel/${name}.png`;

function watchConsole(page: Page): string[] {
  const lines: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') lines.push(`[console.error] ${msg.text()}`);
  });
  page.on('pageerror', (err) => lines.push(`[pageerror] ${err.message}`));
  return lines;
}

/** 词条表是唯一文案事实源：期望串从这里读，不抄进测试（抄件一定会漂）。 */
async function zhValue(key: string): Promise<string> {
  const src = await readFile(
    new URL('../../packages/i18n/src/locales/zh-CN.ts', import.meta.url),
    'utf8',
  );
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = new RegExp(`^  '${escaped}': '(.*)',?$`, 'mu').exec(src);
  if (line === null) throw new Error(`在 packages/i18n/src/locales/zh-CN.ts 里读不到键「${key}」`);
  return line[1].replace(/\\'/gu, "'").replace(/\\\\/gu, '\\');
}

/**
 * 一台只会**存字节**的假服务端。
 *
 * 🔴 `unexpected` 是这条判据的牙齿之一：注册了 catch-all，任何我没预料到的路径都会
 * 被记下来并最终断言为空。它防的是"桩自己凭空造了一个 API"那一类（应用其实调了
 * 第六条路由，而测试给它回了 200，看起来一切正常）。
 */
async function fakeServer(
  page: Page,
  store: { cipher: string | null; hash: string | null },
): Promise<string[]> {
  const unexpected: string[] = [];

  // ⚠️ catch-all 必须**最先**注册：Playwright 是后注册的先匹配，把它放最后就永远轮不到。
  await page.route(`${SERVER}/**`, (route) => {
    const url = new URL(route.request().url());
    unexpected.push(`${route.request().method()} ${url.pathname}`);
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.route(`${SERVER}/api/account/profile**`, async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ displayName: '小鹿', avatarHash: store.hash }),
      });
      return;
    }
    // 昵称那条链在 R15a 已经单测钉过；这里只回一份合法资料，让旅程走得下去。
    const body = (route.request().postDataJSON() ?? {}) as { displayName?: string | null };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ displayName: body.displayName ?? null, avatarHash: store.hash }),
    });
  });

  await page.route(`${SERVER}/api/account/avatar**`, async (route) => {
    const method = route.request().method();
    if (method === 'PUT') {
      const body = (route.request().postDataJSON() ?? {}) as { cipherBase64?: string };
      if (typeof body.cipherBase64 !== 'string') {
        await route.fulfill({ status: 400, contentType: 'application/json', body: '{}' });
        return;
      }
      store.cipher = body.cipherBase64;
      store.hash = 'sha256-e2e-avatar';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ avatarHash: store.hash }),
      });
      return;
    }
    if (method === 'DELETE') {
      store.cipher = null;
      store.hash = null;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ avatarHash: null }),
      });
      return;
    }
    // GET：服务端只有密文，解不开就是解不开 —— 这里原样吐回去，一个字都不看。
    if (store.cipher === null) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ cipherBase64: store.cipher }),
    });
  });

  // 塞了凭据之后这几条也会真发出去；给空但合法的响应，免得无关的 404 淹掉真正的失败
  // （与 `admin-console.spec.ts` / `inbox.spec.ts` 同一条补位纪律）。
  await stubLegalRecheck(page, SERVER);
  await stubEmptyHolidayAdjustments(page, SERVER);
  // 设置页会探测管理员权限；此夹具是普通账号，真实接口应返回 403。
  await page.route(`${SERVER}/api/admin/overview`, (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Forbidden' }),
    }),
  );
  await page.routeWebSocket(REALTIME_WS, () => {
    // 保持打开即可，本用例不验实时同步。
  });
  await page.route(`${SERVER}/api/sync/status**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ latestSeq: 0 }),
    });
  });
  await page.route(`${SERVER}/api/notifications**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ notifications: [], unreadCount: 0 }),
    });
  });
  await page.route(`${SERVER}/api/activity**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ campaigns: [] }),
    });
  });
  await page.route(`${SERVER}/api/passkeys**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ passkeys: [] }),
    });
  });
  // 「保存并同步」会真发一次上传。本用例不验同步，给它一份"没有东西要传"的合法应答，
  // 免得传输层的失败混进上面那条 `unexpected` 与 console 断言里。
  await page.route(`${SERVER}/api/sync/ops**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [], latestSeq: 0 }),
    });
  });

  return unexpected;
}

test('🔴 头像：口令缺失 → 真上传 → 刷新之后仍说"要先填口令"（而不是"你还没有头像"）', async ({
  page,
}) => {
  const errors = watchConsole(page);
  const store: { cipher: string | null; hash: string | null } = { cipher: null, hash: null };

  await page.addInitScript((server: string) => {
    localStorage.setItem(
      'heyta.sync.credentials',
      JSON.stringify({ baseUrl: server, token: 'e2e-avatar-token', email: 'deer@example.test' }),
    );
  }, SERVER);
  const unexpected = await fakeServer(page, store);

  await page.setViewportSize({ width: 1280, height: 900 });
  await enableAllModules(page);
  await installMissingProducerShims(page);
  await page.goto('/?lang=zh-CN');
  await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
  // 🔴 这条旅程**要出门**（往假服务端上传），所以显式选 `accepted`，不用默认的最小承诺。
  await decidePrivacyConsent(page, 'accepted');

  // ── ① 冷启动：口令不在内存 ────────────────────────────────────
  await openSettingsView(page);
  await expect(page.locator(PANEL)).toBeVisible();
  const needPassword = await zhValue('common.profile.avatar.needPassword');
  await expect(page.locator(NEED_PASSWORD)).toHaveText(needPassword);
  // 「换一张」按钮**在**，但一次点击也传不上去 —— 所以那句是陈述句而不是错误。
  await expect(page.locator(AVATAR_IMG)).toHaveCount(0);
  await page.screenshot({ path: SHOT('r15b-1-need-password'), fullPage: false });
  await page.keyboard.press('Escape');

  // ── ② 填口令（SyncBar 在页头，浮层关掉之后才点得到）────────────
  await page
    .getByRole('button', { name: await zhValue('web.sync.settings.title') })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(await zhValue('web.sync.password.label')).fill(PASSWORD);
  await dialog.getByRole('button', { name: await zhValue('web.sync.saveAndSync') }).click();

  await openSettingsView(page);
  await expect(page.locator(NEED_PASSWORD)).toHaveCount(0);

  // 真图：拿一张真截图当"用户交来的照片"（尺寸刻意小，避免撞 512 KB 的原图上限）。
  const sourceShot = 'test-results/avatar-source.png';
  await page.screenshot({ path: sourceShot, clip: { x: 200, y: 200, width: 240, height: 240 } });
  await page.locator(FILE_INPUT).setInputFiles(sourceShot);

  // 写侧那句必须是"头像已更新"，不是昵称那句。
  await expect(page.locator(WRITE_NOTICE)).toHaveText(
    await zhValue('common.profile.avatar.uploaded'),
  );
  // 🔴 读侧真的把图**解开并画出来了**：`naturalWidth > 0` 只有解码成功才会成立，
  //    而解码要求"服务端那份密文 + 本机这把口令"两者同时成立。断言的是产品结论，
  //    不是 `src` 字符串长什么样。
  await expect(page.locator(AVATAR_IMG)).toBeVisible();
  const rendered = await page.locator(AVATAR_IMG).evaluate((el) => {
    const img = el as HTMLImageElement;
    return { natural: img.naturalWidth, srcHead: img.src.slice(0, 11) };
  });
  expect(rendered.natural, '解开了却没画出任何像素（naturalWidth = 0）').toBeGreaterThan(0);
  // 正向对照：明文预览里**该**找得到 MIME 串 —— 否则下面那条"密文里找不到"没有牙齿。
  expect(rendered.srcHead, '预览不是 data:image/… 那种形状').toMatch(/^data:image\//u);

  // ── 🔴 E2EE：服务端收到的字节里不许有明文 MIME ────────────────
  expect(store.cipher, '上传之后服务端没有收到任何密文').not.toBeNull();
  const received = Buffer.from(store.cipher ?? '', 'base64');
  expect(received.length, '收到的密文解 base64 之后是 0 字节').toBeGreaterThan(0);
  expect(
    received.includes(Buffer.from('image/', 'utf8')),
    '服务端收到的字节里出现了明文 MIME ⇒ 头像没有真的加密就出去了',
  ).toBe(false);
  expect(
    received.includes(Buffer.from('contentType', 'utf8')),
    '服务端收到的字节里出现了明文键名 ⇒ 载荷是 JSON 原文而不是密文',
  ).toBe(false);
  await page.screenshot({ path: SHOT('r15b-2-ready'), fullPage: false });

  // 暗色：走 `lib/theme.ts` 的那一条属性（应用自己就是这么切的）。
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await expect(page.locator(AVATAR_IMG)).toBeVisible();
  await page.screenshot({ path: SHOT('r15b-3-ready-dark'), fullPage: false });
  await page.evaluate(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  // ── ③ 刷新一次：口令不落盘 ⇒ 这台设备解不开，但**图还在服务端** ──
  await page.reload();
  await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
  await openSettingsView(page);
  await expect(page.locator(PANEL)).toBeVisible();
  // 🔴 这一句是 R15b 的靶心：状态是 `needs-password`，不是 `absent`。
  //    并成 `absent` 的旧形状是"你还没有头像" + 用户接着点「换一张」把自己那张覆盖掉。
  await expect(page.locator(NEED_PASSWORD)).toHaveText(needPassword);
  await expect(page.locator(AVATAR_IMG), '口令不在内存时不该把图画出来（那是凭空解开了）').toHaveCount(
    0,
  );
  expect(store.cipher, '刷新之后服务端的密文不见了 ⇒ 这一腿测的就不是同一个状态').not.toBeNull();
  // 那句**不该**出现在读侧：界面不许说"没有头像"。
  const readNotice = await page.locator(READ_NOTICE).count();
  const readText = readNotice === 0 ? '' : ((await page.locator(READ_NOTICE).textContent()) ?? '');
  expect(readText, `读侧那句说的是：「${readText}」`).not.toContain('还没有头像');
  await page.screenshot({ path: SHOT('r15b-4-after-reload'), fullPage: false });

  // 🔴 应用只调了我登记过的那几条路由（凭空多出来的调用 = 桩在给一个不存在的 API 回 200）。
  expect(unexpected, `假服务端收到了没登记过的调用：${unexpected.join(' | ')}`).toEqual([]);
  // 控制台：这一条的范围刻意**只圈资料链**，因为同步传输层对着假服务端必然有噪声
  //（`/api/sync/ops` 的应答形状不是本用例的主题，上面已经给了合法的空应答）。
  const profileErrors = errors.filter((e) => /account|avatar|profile/iu.test(e));
  expect(profileErrors, `资料链上的控制台报错：${profileErrors.join(' | ')}`).toEqual([]);
});
