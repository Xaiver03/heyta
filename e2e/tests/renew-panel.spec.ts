import { expect, test, type Page } from '@playwright/test';

import { STUB_ORIGIN, STUB_PORT } from '../ports';
import { openApp, openSettingsView, selectSettingsSection, stubLegalRecheck } from './helpers';

/**
 * 续费面板的**真浏览器**判据（AGENTS §6.2 规定一：界面结论只有截图算）
 * ==================================================================
 *
 * jsdom 那一组（`apps/web/tests/renew-panel.spec.tsx`）已经管住了"金额从哪来、
 * 失败说不说真话、不发无谓的请求"。这一组管的是**看得见的东西**：
 *
 *   · 面板真的出现在设置页里（不是只存在于组件树里）；
 *   · 点下去真的发出那一发 POST，而且**请求体里只有档位**；
 *   · 下单成功后屏幕上是一个**能读的支付串**，不是一句"已到账"的假确认；
 *   · 没配收款通道时（503）屏幕上是一句人话，且**没有**半截付款面板。
 *
 * 对端是 `page.route` 桩（与 `admin-console.spec.ts` 同一套理由）：
 * 真实微信商户不在本仓库、也不该在 CI 里被调用。
 */

const SERVER = STUB_ORIGIN;
const REALTIME_WS_GLOB = `ws://127.0.0.1:${String(STUB_PORT)}/api/sync/ws*`;

const ORDER_BODY = {
  orderId: 21,
  outTradeNo: 'hy21x2xdeadbeef',
  priceId: 'hosted-monthly',
  currency: 'CNY',
  originalAmountMinor: 500,
  discountMinor: 100,
  amountMinor: 400,
  expiresAt: Date.now() + 15 * 60_000,
  rejectedCoupons: [],
  qrCode: 'weixin://wxpay/bizpayurl?pr=E2ETEST',
};

async function seedCredentialsAndProbe(page: Page): Promise<void> {
  await page.addInitScript((server: string) => {
    localStorage.setItem(
      'heyta.sync.credentials',
      JSON.stringify({ baseUrl: server, token: 'e2e-renew-token', email: 'boss@example.test' }),
    );
  }, SERVER);
  await stubLegalRecheck(page, SERVER);
  await page.routeWebSocket(REALTIME_WS_GLOB, () => {
    // 保持打开即可：本用例不验实时同步。
  });
  await page.route(`${SERVER}/api/sync/status**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ latestSeq: 0 }) });
  });
  // 设置页上的 `PasskeyPanel` 一挂载就列表（同 `admin-console.spec.ts` 的补位理由）。
  // 不补位的话它会落进假端点的 404，屏上多出一条「没能加载通行密钥列表」——
  // 与本用例无关，却会在截图里长得像我们自己的缺陷（三张图里都出现过）。
  await page.route(`${SERVER}/api/passkeys**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ passkeys: [] }) });
  });
}

/**
 * 走到设置页里的续费面板。
 *
 * 🔴 `consent` 必须是**判据的一部分**，不能靠默认值：2026-10-05 实测这一条
 * 默认走「只用本机」，于是每一次点击都被同意闸门拒发，而面板显示
 * 「连不上服务端，这一单没有下成。」—— 两条用例当时红得像是 `page.route`
 * 没接上，实际是界面在说谎（缺陷已在 `RenewPanel` 里修掉，两条同意闸门用例
 * 住在 `apps/web/tests/renew-panel.spec.tsx`）。
 *
 * 🔴 必须显式选中「账号与安全」那一组：设置浮层现在是「左侧分类 + 右侧内容」的
 * IA（`63e61f237`），`RenewPanel` 住在 `settings-group-account` 里，而其余每一组
 * 都带 `hidden`。打开浮层只落在默认分类 ⇒ 本套件此前的症状是
 * `getByTestId('renew-panel')` 解析得到节点却判 `hidden`，五条用例（含三条早已
 * 存在的）一起红，看起来像面板坏了。这里走的是人真走的那一步，不是放宽判据。
 */
async function openSettings(page: Page, consent: 'accepted' | 'local-only' = 'accepted'): Promise<void> {
  await openApp(page, '/', consent);
  await seedCredentialsAndProbe(page);
  await page.reload();
  await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
  await openSettingsView(page);
  await selectSettingsSection(page, 'account');
  await expect(page.getByTestId('renew-panel')).toBeVisible();
}

test('下单成功：屏上是服务端那一单的金额与支付串，不是一句"已到账"', async ({ page }) => {
  test.info().annotations.push({ type: '截图', description: 'test-results/renew-panel-order.png' });
  await openSettings(page);

  const bodies: string[] = [];
  await page.route(`${SERVER}/api/billing/checkout**`, async (route) => {
    bodies.push(String(route.request().postData()));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ORDER_BODY) });
  });

  await page.getByTestId('renew-place-order').click();

  const order = page.getByTestId('renew-order');
  await expect(order).toBeVisible();
  // 🔴 金额是**服务端**的实付（500-100=4.00），不是原价、不是本地常量。
  await expect(order).toContainText('4.00 CNY');
  await expect(page.locator('#renew-pay-url')).toHaveValue('weixin://wxpay/bizpayurl?pr=E2ETEST');
  // 界面不许声称钱已经到账。
  await expect(order).not.toContainText('已到账');
  await expect(order).not.toContainText('付款成功');

  // 🔴 失效时刻必须由**界面语言**排版，不能由浏览器/系统语言排版。
  //    真浏览器实测：裸 `toLocaleString()` 在这条用例里排出
  //    `10/5/2026, 5:47:10 PM`（Playwright 的浏览器 locale 是 en-US），
  //    于是中文界面里出现了一个英文习惯的日期。`check:ui-language` 看不见它 ——
  //    那个门禁比的是词条，这一串是运行时生成的。
  await expect(order).not.toContainText(/AM|PM/);

  // 🔴 那一发请求的体里只有一个键：没有金额、没有币种、没有 provider。
  expect(bodies).toHaveLength(1);
  expect(JSON.parse(bodies[0] ?? '{}')).toEqual({ priceId: 'hosted-monthly' });

  await page.screenshot({ path: 'test-results/renew-panel-order.png' });
});

test('这台实例没配收款通道：一句人话，且不留半截付款面板', async ({ page }) => {
  test.info().annotations.push({ type: '截图', description: 'test-results/renew-panel-no-channel.png' });
  await openSettings(page);

  await page.route(`${SERVER}/api/billing/checkout**`, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'BILLING_PROVIDER_NOT_CONFIGURED' }),
    });
  });

  await page.getByTestId('renew-place-order').click();

  const failure = page.getByTestId('renew-failure');
  await expect(failure).toHaveText('这台实例没有配置收款通道，现在买不了。');
  // 🔴 失败态下**不许**出现支付串输入框：半截付款面板会让人以为已经付过了。
  await expect(page.locator('#renew-pay-url')).toHaveCount(0);
  await expect(page.getByTestId('renew-order')).toHaveCount(0);

  await page.screenshot({ path: 'test-results/renew-panel-no-channel.png' });
});

/**
 * 🔴 这一条是**上面两条用例红过之后**补出来的：那个缺陷只有真浏览器能看到。
 *
 * 点「下单续费」但用户选了「只用本机」⇒
 *   · 一个请求都不许发（`checkoutCalls` 必须为 0，且**不许**有 `renew-failure`）；
 *   · 屏上必须是"没有发任何请求"那一句，**不是**"连不上服务端"。
 *
 * ⚠️ 为什么这条在 jsdom 那一组存在之后**仍然**要在这里跑一遍：jsdom 里
 * `fetch` 是被 stub 的，同意闸门那道补丁（`installConsentGatedFetch`）根本
 * 没装上去 —— "闸门在真实浏览器里真的会拦"这个事实只有这里能证。
 */
test('只用本机时点下单：零请求，且界面不把"我们自己拒发"说成"连不上服务端"', async ({ page }) => {
  test.info().annotations.push({ type: '截图', description: 'test-results/renew-panel-no-consent.png' });

  const checkoutCalls: string[] = [];
  await page.route(`${SERVER}/api/billing/checkout**`, async (route) => {
    checkoutCalls.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ORDER_BODY) });
  });

  await openSettings(page, 'local-only');
  await page.getByTestId('renew-place-order').click();

  await expect(page.getByTestId('renew-consent')).toHaveText(
    '刚才那一步需要与服务器通信，而还没有同意隐私规则，所以 heyta 一个请求都没有发。',
  );
  await expect(page.getByTestId('renew-failure')).toHaveCount(0);
  await expect(page.locator('#renew-pay-url')).toHaveCount(0);
  // 阳性对照在 jsdom 那一组（同意之后同一条路径真的发得出去）；这里断言的是**零**。
  expect(checkoutCalls).toHaveLength(0);

  await page.screenshot({ path: 'test-results/renew-panel-no-consent.png' });
});

/**
 * 🔴 档位选择器（¥5 / ¥12）只有真浏览器能证的三件事。
 *
 * jsdom 那一组装的是 stub 的 `fetch`，看不见"两枚单选在真实布局里到底渲染成什么"，
 * 也看不见选完之后**旧的那一单**是否还挂在屏上（那是本条抓出来的真缺陷形状：
 * 换档之后旧金额还在，读起来就像"¥12 也只要 4.00"）。
 */
test('选 ¥12 那一档：发出去的是 hosted-ai-monthly，而换档把旧的那一单清掉了', async ({ page }) => {
  test.info().annotations.push({ type: '截图', description: 'test-results/renew-panel-tiers.png' });
  await openSettings(page);

  const bodies: string[] = [];
  await page.route(`${SERVER}/api/billing/checkout**`, async (route) => {
    bodies.push(String(route.request().postData()));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ORDER_BODY) });
  });

  const hosted = page.getByTestId('renew-tier-hosted');
  const hostedAi = page.getByTestId('renew-tier-hostedAi');
  await expect(hosted).toBeVisible();
  await expect(hostedAi).toBeVisible();
  await expect(hosted).toBeChecked();

  // 选档那一屏**一个金额都不许出现**：价格只在服务端报价之后才落到屏上。
  await expect(page.getByTestId('renew-panel')).not.toContainText(/\d+\.\d{2}\s+(CNY|USD)/);

  await hostedAi.click();
  await page.getByTestId('renew-place-order').click();
  await expect(page.getByTestId('renew-order')).toContainText('4.00 CNY');

  // 换到另一档：旧单那张卡必须消失，否则屏幕上写的是**上一档**冻的金额。
  await hosted.click();
  await expect(page.getByTestId('renew-order')).toHaveCount(0);

  await hostedAi.click();
  await page.getByTestId('renew-place-order').click();
  await expect.poll(() => bodies).toHaveLength(2);
  expect(JSON.parse(bodies[1] ?? '{}')).toEqual({ priceId: 'hosted-ai-monthly' });
  // 🔴 截图要等**落定那一屏**：`bodies` 在请求发出那一刻就够数了，先拍会拍到
  //    按钮上的「正在下单…」（实测第一版就是这样，证据图里看不到那一单的金额）。
  await expect(page.getByTestId('renew-order')).toContainText('4.00 CNY');

  await page.screenshot({ path: 'test-results/renew-panel-tiers.png' });
});

test('服务端按 ④′ 拒降档：屏上说"这一档不含你当前档的全部能力"，而不是"没有定价"', async ({ page }) => {
  test.info().annotations.push({ type: '截图', description: 'test-results/renew-panel-downgrade.png' });
  await openSettings(page);

  await page.route(`${SERVER}/api/billing/checkout**`, async (route) => {
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'PRICE_TIER_LOSES_GRANTS', message: 'PRICE_TIER_LOSES_GRANTS' }),
    });
  });

  await page.getByTestId('renew-place-order').click();

  const failure = page.getByTestId('renew-failure');
  await expect(failure).toBeVisible();
  await expect(failure).toContainText('这一档不包含你当前这一档的全部能力');
  await expect(page.getByTestId('renew-order')).toHaveCount(0);

  await page.screenshot({ path: 'test-results/renew-panel-downgrade.png' });
});
