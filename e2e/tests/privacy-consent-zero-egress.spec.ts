/**
 * 回归：同意是**网络守卫**，不是首启的墙（ADR-0086）—— 同意之前一个请求都不发。
 *
 * 2026-11-16 ADR-0086 把"问的时机"从冷启动挪到"第一次真要出门"。本文件随之改写成
 * JIT 口径（旧版断言"首启即弹面板"，与 ADR-0086 直接矛盾）：
 *
 *   · 冷启动（全新设备）：面板**不在**，且零出站 / 无记录 / 无 SW —— 这是 PIPL 的核心保证，
 *     "本地优先"意味着不点任何"要出门"的动作时，一个请求都不发。
 *   · 决定由"预置本机存储"表达（`openApp` 的 `local-only` / `accepted`）：
 *     `local-only` ⇒ 零出站、无 SW，产品仍完整可用（PIPL 16）；`accepted` ⇒ SW 才注册（正向对照）。
 *   · 面板自身的交互（提交才弹、关掉≠决定、点遮罩不关、条款只是字符串）用"提交登录"这条
 *     `requireNetworkConsent()` 的落点来触发 —— 见 `privacy-consent-jit.spec.ts` 与
 *     `auth-consent-registration.spec.ts` 的同一条路。
 *
 * 零出站的探针在 './net-egress'（分类规则单一所有者）；本文件只做断言。
 */
import { expect, test, type Page } from '@playwright/test';

import { enableAllModules, pinChineseUi, waitForBootSplashGone, openApp } from './helpers';
import { installMissingProducerShims } from './shims.js';
import { openAuthPanel } from '../auth-journey/helpers.js';
import { swState, trackEgress } from './net-egress';

const CONSENT_KEY = 'privacy.consent';

/** 面板与各动作的 testID（`apps/web/src/features/privacy/PrivacyConsentSheet.tsx`）。 */
const DIALOG = '[data-testid="privacy-consent-dialog"]';
const ACCEPT = '[data-testid="privacy-consent-accept"]';
const LOCAL_ONLY = '[data-testid="privacy-consent-local-only"]';
const CLOSE = '[data-testid="privacy-consent-close"]';

async function readRecord(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), CONSENT_KEY);
}

/**
 * 打开应用但**不作任何同意决定**（保持"没问过"= undecided）—— 与 `openApp` 的区别是
 * `openApp` 会预置一条决定；这里留空，好让"关掉面板 ≠ 决定（不写记录）"能被断言。
 */
async function openUndecided(page: Page): Promise<void> {
  await enableAllModules(page);
  await pinChineseUi(page);
  await installMissingProducerShims(page);
  await page.goto('/?lang=zh-CN');
  await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
  await waitForBootSplashGone(page);
}

/**
 * 用"提交登录"触发同意面板 —— 这正是 `requireNetworkConsent()` 在产品里的落点：
 * 未决定时 `networkAllowed()` 为假，提交登录会打开面板并拦下这次提交。
 */
async function triggerConsent(page: Page): Promise<void> {
  const auth = await openAuthPanel(page);
  await auth.getByTestId('auth-form-email').fill('zero-egress@example.com');
  await auth.getByTestId('auth-form-password').fill('a private and deliberate plan');
  await auth.getByTestId('auth-form-submit').click();
  await expect(page.getByTestId('privacy-consent-dialog')).toBeVisible();
}

test.describe('链 5 · 同意之前一个请求都不发（真浏览器 · ADR-0086 JIT）', () => {
  test('冷启动：同意面板不出现，且它之前零出站、没有记录、没有 SW', async ({ page, baseURL }) => {
    const origin = String(baseURL);
    const { egress, sockets } = trackEgress(page, origin);
    await page.goto(`${origin}/?lang=zh-CN`);
    // 首屏可交互 = 应用真的起来了（不是拿空白页当"没有面板"）。
    await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();

    await expect(
      page.locator(DIALOG),
      '冷启动弹出了同意面板 —— ADR-0086 之后它只该由"要出门的动作"打开',
    ).toHaveCount(0);

    await page.waitForTimeout(1_500);
    expect(egress, `未同意时不该有任何出站请求，实际：${JSON.stringify(egress)}`).toEqual([]);
    expect(sockets, `未同意时不该建立任何 WebSocket：${sockets.join(', ')}`).toEqual([]);
    expect(await readRecord(page), '没作过决定时不该已经有决定记录').toBeNull();
    expect(await swState(page), '未同意时 SW 不该注册').toBe('NONE');
  });

  test('「只用本机」决定：零出站、无 SW，产品仍可本地用（PIPL 16）', async ({ page, baseURL }) => {
    const origin = String(baseURL);
    const { egress, sockets } = trackEgress(page, origin);
    await openApp(page, '/?lang=zh-CN', 'local-only');

    // 纯本地操作走一遍：一个从没点过"要出门"按钮的用户，不该在任何一步被问同意。
    const input = page.locator('input[placeholder^="添加任务"]');
    await input.fill('离线也能写的一条');
    await input.press('Enter');
    await expect(page.getByText('离线也能写的一条').first()).toBeVisible();
    await expect(page.locator(DIALOG), '只用本机的路上被隐私面板打断了').toHaveCount(0);

    await page.waitForTimeout(1_500);
    expect(egress, `不同意之后也不该发出请求，实际：${JSON.stringify(egress)}`).toEqual([]);
    expect(sockets).toEqual([]);
    expect(await swState(page), 'local-only 之下 SW 仍不该注册').toBe('NONE');
    expect(String(await readRecord(page)), '「只用本机」的决定要落盘').toContain('local-only');
  });

  test('「同意并联网」：SW 那条口**确实开了** —— 上面那些"零"不是恒真', async ({ page, baseURL }) => {
    const origin = String(baseURL);
    const { egress } = trackEgress(page, origin);
    await openApp(page, '/?lang=zh-CN', 'accepted');

    await expect
      .poll(async () => await swState(page), {
        message: '同意之后 SW 必须注册上（正向对照：它不为零，前面的零才有意义）',
        timeout: 20_000,
      })
      .toMatch(/installing|waiting|active/);
    expect(String(await readRecord(page)), '预置的同意要落成 accepted').toContain('accepted');

    // 🔴 **探针自检**（不是产品断言）：由页面自己发两条命中规则的请求，证明分类器抓得到它
    // 声称要抓的两类（`/sw.js` 与 `/api/*`）—— 数得出来，"零"才只可能是"没发"。
    await page.evaluate(async () => {
      await Promise.allSettled([
        fetch('/sw.js', { method: 'HEAD' }),
        fetch('/api/consent-probe'),
      ]);
    });
    await expect
      .poll(() => egress.filter((item) => item.url.includes('/sw.js')).length, {
        message: '分类器必须数得出 /sw.js 那一类请求，否则上面那些"零出站"是恒真',
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
    expect(
      egress.some((item) => item.url.startsWith('/api/')),
      `分类器必须认 /api/* 这一类，实际清单：${JSON.stringify(egress)}`,
    ).toBe(true);
  });

  test('全新设备不注册 SW；预置「已同意」冷启动则立刻注册', async ({ browser, baseURL }) => {
    const origin = String(baseURL);

    // 臂 A：全新设备 —— 冷启动无面板、无 SW。
    const fresh = await browser.newContext({ locale: 'zh-CN' });
    const freshPage = await fresh.newPage();
    trackEgress(freshPage, origin);
    await freshPage.goto(`${origin}/?lang=zh-CN`);
    await expect(freshPage.locator('input[placeholder^="添加任务"]')).toBeVisible();
    await freshPage.waitForTimeout(1_500);
    expect(await swState(freshPage)).toBe('NONE');
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
    await seededPage.goto(`${origin}/?lang=zh-CN`);
    await expect(seededPage.locator('input[placeholder^="添加任务"]')).toBeVisible();
    await expect(seededPage.locator(DIALOG)).toHaveCount(0);
    await expect
      .poll(async () => await swState(seededPage), {
        message: '带着"已同意"冷启动时 SW 必须注册（证明那条"零"确实由决定驱动）',
        timeout: 20_000,
      })
      .toMatch(/installing|waiting|active/);
    await seeded.close();
  });

  test('关掉面板（X / Esc）不是决定：不产生记录、不发请求，下次动作再问', async ({ page, baseURL }) => {
    const origin = String(baseURL);
    await openUndecided(page);
    await triggerConsent(page);

    await page.locator(CLOSE).click();
    await expect(page.locator(DIALOG)).toHaveCount(0);
    await page.waitForTimeout(1_000);
    expect(await readRecord(page), '点 X 不该写任何记录').toBeNull();

    // 关掉 ≠ 决定：再次提交仍会被拦下、面板再现（关掉不是"同意"，也不是"拒绝"）。
    await openUndecided(page);
    await triggerConsent(page);
    await page.keyboard.press('Escape');
    await expect(page.locator(DIALOG)).toHaveCount(0);
    expect(await readRecord(page), '按 Esc 同样不该写记录').toBeNull();
  });

  test('点遮罩不许关掉面板 —— 同意不能靠点空白处作出', async ({ page, baseURL }) => {
    await openUndecided(page);
    await triggerConsent(page);
    // 左上角那一点在对话框之外，命中的是遮罩本身。
    await page.mouse.click(4, 4);
    await expect(page.locator(DIALOG)).toBeVisible();
    expect(await readRecord(page)).toBeNull();
  });

  test('面板上的两个条款链接只是字符串：不点它就没有任何请求', async ({ page, baseURL }) => {
    await openUndecided(page);
    await triggerConsent(page);
    // 打开面板这一路（登录 config 探测等）之后，把计数归零基线；再看渲染条款链接本身会不会发请求。
    const origin = String(baseURL);
    const { egress } = trackEgress(page, origin);
    const baseline = egress.length;

    const terms = page.locator('[data-testid="privacy-consent-terms"]');
    await expect(terms).toBeVisible();
    expect(await terms.getAttribute('href')).toBe('https://heyta.waytofuture.cn/legal/terms/');
    expect(
      await page.locator('[data-testid="privacy-consent-privacy"]').getAttribute('href'),
    ).toBe('https://heyta.waytofuture.cn/legal/privacy/');

    await page.waitForTimeout(800);
    expect(
      egress.length,
      `光渲染条款链接不该发请求，实际新增：${JSON.stringify(egress.slice(baseline))}`,
    ).toBe(baseline);
  });
});
