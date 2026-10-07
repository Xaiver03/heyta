/**
 * 真浏览器：同意之前一个请求都不发（链 5 · G-12 的界面取证）
 * ==========================================================
 *
 * ## 这一支补的是哪一条
 *
 * `docs/plans/legal-compliance-before-filing.md` 的链 5 此前只有 jsdom 与 RN 单测层
 * 的判据（数的是"注入的端口被调了几次"）。🔴 那**不等于**真浏览器里成立：
 * jsdom 没有 service worker、没有真的网络栈，而 G-12 点名的第一条症状
 * 就是"SW 注册自己会向 scope 发一次请求"（那次取回由浏览器发起，**不在页面的请求流里**
 * —— 下面那张表第二行记的就是这件事）。这一支把同一件事在**生产构建 + Chromium**
 * 里再数一遍，并把那条"数得出 0"的判据接上一个**数得出非 0**的正向对照。
 *
 * ## 🔴 为什么"零"必须有对照，否则这条判据是空的
 *
 * 「同意前零出站」单独看永远可能是假的 —— 它同样兼容"这个 harness 根本测不到出站"。
 * 所以每一条零出站断言都配一个**同一个可观测量在同意之后不为零**的臂：
 *
 * | 可观测量 | 未同意 | 已同意 |
 * |---|---|---|
 * | `navigator.serviceWorker.getRegistration()` | `null` | 非空（SW 真的注册上了）|
 * | 请求分类器本身（同一套规则） | 空 | 页面**主动**发 `/sw.js` 与 `/api/*` 时**数得出** |
 *
 * 🔴 第二行是**探针自检**不是产品断言，而且它是被实测教出来的：原先这里写的是
 * "同意之后清单里出现 `/sw.js`"，看着最自然，**但它永远不可能成立** ——
 * Chromium 把 service worker 脚本的取回放在**页面之外**的网络管线里，
 * `page.on('request')` 一条都收不到（注册本身成功，`active` 有值）。
 * 那条断言会红，而红的原因是**判据用了一个不存在的可观测性**，不是产品坏了。
 *
 * 两个臂跑在**同一份产物**上，只有一个变量是那份决定 —— 于是"零"不再是恒真。
 *
 * ## 什么算"出站"（分类必须显式，不然模块加载也算进去）
 *
 * 应用自己要加载 `index.html` / `/assets/*` / `/icons/*` / `manifest.webmanifest`，
 * 那些是**页面渲染**，不是"这台应用会不会跟服务端说话"。判据只数三类：
 * ① 任何**非本源**的请求；② `/api/*`；③ `/sw.js`（注册那一下的 fetch，G-12 的原话）。
 * 外加 `page.on('websocket')` —— 实时通道根本不走 `fetch`，漏了它等于没测第二条出口。
 */

import { expect, test, type Page } from '@playwright/test';
import { swState, trackEgress } from './net-egress';


const CONSENT_KEY = 'privacy.consent';

/** 面板与各动作的 testID（`apps/web/src/features/privacy/PrivacyConsentSheet.tsx`）。 */
const DIALOG = '[data-testid="privacy-consent-dialog"]';
const ACCEPT = '[data-testid="privacy-consent-accept"]';
const LOCAL_ONLY = '[data-testid="privacy-consent-local-only"]';
const CLOSE = '[data-testid="privacy-consent-close"]';

/** 固定的取证图路径（§6.2 规定一：先截图、再断言，失败时也得有图）。 */
const SHOT = (name: string): string => `/tmp/heyta-privacy-consent-results/${name}.png`;

/**
 * 出站/套接字/SW 这三支探针现在住在 './net-egress.ts'（W7 的导出用例要用**同一套**
 * 分类规则）。搬走而不是留一份本地副本：两份分类器会漂，而漂了的“零出站”
 * 仍是绿色的 —— 那是承诺悄悄变宽，不是测试失败。原注释里那些道理（为什么要在
 * goto 之前挂、为什么 'NO_SW_SUPPORT' 不能当正向对照）跟着函数一起走了。
 */

/** 这台设备上当前的决定记录（直接读 `localStorage`，不经过应用的任何判断）。 */
async function readRecord(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), CONSENT_KEY);
}

async function openFresh(page: Page, origin: string): Promise<void> {
  // 🔴 每条用例都是**全新 context**（空 localStorage + 空 IndexedDB）= 一台刚装好的设备。
  await page.goto(`${origin}/?lang=zh-CN`);
}

test.describe('链 5 · 同意之前一个请求都不发（真浏览器）', () => {
  test('首启：面板出现，且它出现之前零出站、没有记录、没有 SW', async ({ page, baseURL }) => {
    const origin = String(baseURL);
    const { egress, sockets } = trackEgress(page, origin);
    await openFresh(page, origin);
    await expect(page.locator(DIALOG)).toBeVisible();

    await page.screenshot({ path: SHOT('first-launch-panel'), fullPage: false });

    expect(egress, `未同意时不该有任何出站请求，实际：${JSON.stringify(egress)}`).toEqual([]);
    expect(sockets, `未同意时不该建立任何 WebSocket：${sockets.join(', ')}`).toEqual([]);
    expect(await readRecord(page), '面板出现时不该已经有决定记录').toBeNull();
    expect(await swState(page), '未同意时 SW 不该注册').toBe('NONE');
  });

  test('点「只用本机」：记录落盘，而出站仍然为零（PIPL 16：不同意照样能用）', async ({
    page,
    baseURL,
  }) => {
    const origin = String(baseURL);
    const { egress, sockets } = trackEgress(page, origin);
    await openFresh(page, origin);
    await expect(page.locator(DIALOG)).toBeVisible();
    await page.locator(LOCAL_ONLY).click();
    await expect(page.locator(DIALOG)).toHaveCount(0);
    // 收起之后再等一拍：补跑路径（`startupNetwork.arm()`）就在这一刻跑。
    await page.waitForTimeout(1_500);

    await page.screenshot({ path: SHOT('after-local-only') });

    expect(
      JSON.parse(String(await readRecord(page))),
      '「只用本机」要落的就是这个词表值',
    ).toMatchObject({ decision: 'local-only' });
    expect(egress, `不同意之后也不该发出请求，实际：${JSON.stringify(egress)}`).toEqual([]);
    expect(sockets).toEqual([]);
    expect(await swState(page), 'local-only 之下 SW 仍不该注册').toBe('NONE');
  });

  test('点「同意并联网」：SW 那条口**确实开了** —— 上面那些"零"不是恒真', async ({
    page,
    baseURL,
  }) => {
    const origin = String(baseURL);
    const { egress } = trackEgress(page, origin);
    await openFresh(page, origin);
    await expect(page.locator(DIALOG)).toBeVisible();
    await page.locator(ACCEPT).click();
    await expect(page.locator(DIALOG)).toHaveCount(0);

    await expect
      .poll(async () => await swState(page), {
        message: '同意之后 SW 必须注册上（正向对照：它不为零，前面的零才有意义）',
        timeout: 20_000,
      })
      .toMatch(/installing|waiting|active/);

    await page.screenshot({ path: SHOT('after-accept') });

    expect(await readRecord(page)).toContain('accepted');

    // 🔴 **探针自检**（不是产品断言）：前面那几条"清单为空"要可信，必须先证明
    // 这个分类器**抓得到它声称要抓的那两类请求**。所以由页面自己发两条命中规则的
    // 请求（`/sw.js` 与 `/api/*`）—— 数得出来，"零"才只可能是"没发"而不是"看不见"。
    //
    // ⚠️ 这里**不**声称"SW 注册的那次脚本获取出现在页面请求流里"。实测（`/tmp` 探针，
    // 2026-10-01）：Chromium 把 service worker 脚本的取回放在**页面之外**的网络管线里，
    // 注册成功后 `getRegistration().active` 有值，而 `page.on('request')` 一条 `/sw.js`
    // 都没有 —— 所以"注册这件事本身"由上面那个 poll **直接**观测，不走请求计数。
    // 把不存在的可观测性写成判据，得到的就是一条永远为假的断言（§7 元规则 1）。
    await page.evaluate(async () => {
      await Promise.allSettled([
        fetch('/sw.js', { method: 'HEAD' }),
        fetch('/api/consent-probe'),
      ]);
    });

    await expect
      .poll(
        () => egress.filter((item) => item.url.includes('/sw.js')).length,
        {
          message: '分类器必须数得出 /sw.js 那一类请求，否则上面那些"零出站"是恒真',
          timeout: 10_000,
        },
      )
      .toBeGreaterThan(0);
    expect(
      egress.some((item) => item.url.startsWith('/api/')),
      `分类器必须认 /api/* 这一类，实际清单：${JSON.stringify(egress)}`,
    ).toBe(true);
  });

  test('全新设备不注册 SW；预置「已同意」冷启动则立刻注册', async ({ browser, baseURL }) => {
    const origin = String(baseURL);

    // 臂 A：全新设备 —— 面板挡住，SW 不注册。
    const fresh = await browser.newContext({ locale: 'zh-CN' });
    const freshPage = await fresh.newPage();
    const a = trackEgress(freshPage, origin);
    await openFresh(freshPage, origin);
    await expect(freshPage.locator(DIALOG)).toBeVisible();
    await freshPage.waitForTimeout(1_500);
    expect(await swState(freshPage)).toBe('NONE');
    expect(a.egress).toEqual([]);
    await fresh.close();

    // 臂 B：**同一份产物**，只在 localStorage 里预置一条已同意的记录（= 第二次冷启动）。
    // 🔴 这条就是那条零判据的反证：闸门一旦不认记录，这里数出来的就是"照样不注册"，
    // 而臂 A 与臂 B 的差别**只剩那份决定**。
    const seeded = await browser.newContext({ locale: 'zh-CN' });
    await seeded.addInitScript((record) => {
      window.localStorage.setItem(record.key, record.value);
    }, {
      key: CONSENT_KEY,
      value: JSON.stringify({ decision: 'accepted', decidedAt: new Date().toISOString() }),
    });
    const seededPage = await seeded.newPage();
    trackEgress(seededPage, origin);
    await openFresh(seededPage, origin);
    await expect(seededPage.locator(DIALOG)).toHaveCount(0);

    await expect
      .poll(async () => await swState(seededPage), {
        message: '带着"已同意"冷启动时 SW 必须注册（证明那条"零"确实由决定驱动）',
        timeout: 20_000,
      })
      .toMatch(/installing|waiting|active/);
    await seeded.close();
  });

  test('关掉面板（X / Esc）不是决定：不产生记录、不发请求，下次冷启动再问', async ({
    page,
    baseURL,
  }) => {
    const origin = String(baseURL);
    const { egress, sockets } = trackEgress(page, origin);

    await openFresh(page, origin);
    await expect(page.locator(DIALOG)).toBeVisible();
    await page.locator(CLOSE).click();
    await expect(page.locator(DIALOG)).toHaveCount(0);
    await page.waitForTimeout(1_000);
    expect(await readRecord(page), '点 X 不该写任何记录').toBeNull();
    expect(egress, `关掉面板不该发出请求：${JSON.stringify(egress)}`).toEqual([]);
    expect(sockets).toEqual([]);

    // 重新加载：还没问过，所以必须再问一次（关掉 ≠ 决定）。
    await page.reload();
    await expect(page.locator(DIALOG)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator(DIALOG)).toHaveCount(0);
    expect(await readRecord(page), '按 Esc 同样不该写记录').toBeNull();
  });

  test('点遮罩不许关掉面板 —— 同意不能靠点空白处作出', async ({ page, baseURL }) => {
    await openFresh(page, String(baseURL));
    await expect(page.locator(DIALOG)).toBeVisible();
    // 左上角那一点在对话框之外，命中的是遮罩本身。
    await page.mouse.click(4, 4);
    await expect(page.locator(DIALOG)).toBeVisible();
    expect(await readRecord(page)).toBeNull();
  });

  test('面板上的两个条款链接只是字符串：不点它就没有任何请求', async ({ page, baseURL }) => {
    const origin = String(baseURL);
    const { egress } = trackEgress(page, origin);
    await openFresh(page, origin);
    await expect(page.locator(DIALOG)).toBeVisible();

    const terms = page.locator('[data-testid="privacy-consent-terms"]');
    await expect(terms).toBeVisible();
    // 本机 preview 只是载体。未主动开启自托管时，默认服务仍为官方，
    // 因而条款链接指向官方站点；链接存在不应提前产生请求。
    expect(await terms.getAttribute('href')).toBe('https://heyta.waytofuture.cn/legal/terms/');
    expect(
      await page.locator('[data-testid="privacy-consent-privacy"]').getAttribute('href'),
    ).toBe('https://heyta.waytofuture.cn/legal/privacy/');

    expect(egress, `光打开面板不该因为渲染链接就发请求：${JSON.stringify(egress)}`).toEqual([]);
  });
});
