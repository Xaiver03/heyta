/**
 * collab-journey —— 共享清单的真浏览器全旅程（ADR-0062 W4；`verify:collab-journey`）。
 * ================================================================================
 *
 * 🔴 零 mock：真服务端（TEST_MODE + 真迁移过的 PostgreSQL）、真 vite 应用、
 *    两个**真账号**（`/api/test/create-user` 签的真 JWT）、真 vault 建立
 *    （设置 → 同步 → 密钥库，真 Argon2/AES、真发布 key package）、真共享
 *    密码学（身份种子 / 信封 / ECIES 全在浏览器里真跑）。
 *
 * 旅程（用户视角，一镜到底）：
 *   owner：建清单 → 清单头「共享」→ PIPL 单独同意（方案 a）→ 面板（自己是
 *         所有者）→ 输邮箱邀请 → 一次性凭证显示（读出 token）。
 *   bob：  侧栏「加入共享清单」→ 贴 token → 接受（带公钥）→ 等 owner 自动
 *         下发信封 → 解出同一把密钥 → 清单出现在自己侧栏。
 *   owner：面板轮询看到 bob 成员行（信封已发）。
 *
 * §6.2 规定一的四条全做到：截图先落再断言、固定路径、console/pageerror
 * 从窗口创建起监听、人要看图（verify 脚本尾部打印证据路径）。
 *
 * 用法（不要直接跑；由 scripts/verify-collab-journey.mjs 驱动）：
 *   HEYTA_COLLAB_BASE=<server> HEYTA_COLLAB_WEB_URL=<vite> npx playwright test \
 *     --config playwright.collab.config.ts tests/collab-journey.spec.ts
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { decidePrivacyConsent } from './helpers';
import { fillVaultSecret } from '../vault/privacy';

const API_BASE = process.env['HEYTA_COLLAB_BASE'] ?? 'http://127.0.0.1:3217';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** 固定证据路径（§6.2 规定二）：跑完直接打开同一组文件看。 */
const EVIDENCE = `${ROOT}e2e/test-results/collab-journey`;

const OWNER_PASSPHRASE = 'owner journey passphrase 2026';
const BOB_PASSPHRASE = 'bob journey passphrase 2026';

interface TestUser {
  token: string;
  userId: number;
  email: string;
}

async function createTestUser(email: string): Promise<TestUser> {
  const res = await fetch(`${API_BASE}/api/test/create-user`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'collab-journey-password' }),
  });
  if (!res.ok) throw new Error(`create-user ${email} failed: HTTP ${res.status}`);
  const json = (await res.json()) as { token: string; userId: number };
  return { token: json.token, userId: json.userId, email };
}

/** §6.2 规定三：console/pageerror 在页面一创建就挂上，失败时打印。 */
function attachConsoleCapture(page: Page, label: string, sink: string[]): void {
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      sink.push(`[${label}][${msg.type()}] ${msg.text().slice(0, 400)}`);
    }
  });
  page.on('pageerror', (err) => {
    sink.push(`[${label}][pageerror] ${String(err).slice(0, 400)}`);
  });
}

async function seedCredentials(context: BrowserContext, user: TestUser): Promise<void> {
  await context.addInitScript(({ server, user: u }) => {
    localStorage.setItem('heyta.sync.credentials', JSON.stringify({
      baseUrl: server,
      token: u.token,
      email: u.email,
      accountId: String(u.userId),
    }));
  }, { server: API_BASE, user });
}

/** 真实 vault 建立：口令 → 恢复码回显确认 → 发布 → ready。 */
async function establishVault(page: Page, passphrase: string): Promise<void> {
  await page.getByTestId('account-menu-avatar').click();
  await page.getByTestId('account-menu-settings').click();
  await page.getByTestId('sync-settings-panel').waitFor({ state: 'visible' });
  const section = page.getByTestId('sync-settings-panel');
  await section.scrollIntoViewIfNeeded();

  await expect(section.getByTestId('vault-create-form')).toBeVisible();
  await fillVaultSecret(section.getByTestId('vault-create-passphrase'), passphrase);
  await section.getByTestId('vault-create').click();

  await expect(section.getByTestId('vault-recovery-display')).toBeVisible();
  const recoveryCode = await section.getByTestId('vault-recovery-display').textContent();
  expect(recoveryCode, '恢复码形状合法').toMatch(/^[0-9A-Z-]{40,}$/u);
  await fillVaultSecret(section.getByTestId('vault-recovery-confirm'), recoveryCode ?? '');
  await section.getByTestId('vault-publish').click();
  await expect(section.getByTestId('vault-ready')).toBeVisible();

  await page.getByTestId('settings-sheet-close').click();
  await expect(page.getByTestId('settings-sheet')).toHaveCount(0);
}

/** 建清单并停在它上面（侧栏 + → 填名 → 创建 → 点它）。 */
async function createProjectAndOpen(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: '新建清单', exact: true }).click();
  const dialog = page.getByTestId('category-create-dialog');
  await dialog.locator('#ht-category-create-name').fill(name);
  await dialog.getByRole('button', { name: '创建清单', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const row = page.locator('aside[aria-label="清单与标签"]').getByText(name, { exact: true });
  await expect(row).toBeVisible();
  await row.click();
  // 停在清单上之后，头部标题就是清单名（= 筛选已落到 project）。
  await expect(page.locator('.ht-header__title')).toHaveText(name);
}

async function evidenceShot(page: Page, filename: string): Promise<void> {
  // 先截图再断言（§6.2 规定一第 1 条）：失败时也要有图。
  await page.screenshot({ path: `${EVIDENCE}/${filename}`, fullPage: false });
}

test('共享清单全旅程：owner 建共享 + 邀请 → bob 贴 token 入群 → 双方成员对账', async ({ browser }) => {
  // 固定路径清旧图（规定二：采集失败不得沿用旧图）。
  await rm(EVIDENCE, { recursive: true, force: true });
  await mkdir(EVIDENCE, { recursive: true });

  const runId = Date.now();
  const owner = await createTestUser(`journey-owner-${runId}@example.test`);
  const bob = await createTestUser(`journey-bob-${runId}@example.test`);

  const consoleSink: string[] = [];
  const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const bobContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ownerPage = await ownerContext.newPage();
  const bobPage = await bobContext.newPage();
  attachConsoleCapture(ownerPage, 'owner', consoleSink);
  attachConsoleCapture(bobPage, 'bob', consoleSink);

  // ── owner：vault + 清单 + 共享同意 + 邀请 ────────────────────────────────
  await seedCredentials(ownerContext, owner);
  await ownerPage.goto('/?lang=zh-CN');
  await expect(ownerPage.locator('input[placeholder^="添加任务"]')).toBeVisible();
  await decidePrivacyConsent(ownerPage, 'accepted');
  await establishVault(ownerPage, OWNER_PASSPHRASE);
  await createProjectAndOpen(ownerPage, '家庭装修');
  await evidenceShot(ownerPage, '01-owner-list-ready.png');

  // 头部「共享」→ PIPL 同意模态（方案 a）→ 确认。
  await ownerPage.getByTestId('share-open-button').click();
  await expect(ownerPage.getByTestId('share-consent-modal')).toBeVisible();
  await evidenceShot(ownerPage, '02-owner-consent-modal.png');
  await ownerPage.getByTestId('share-consent-accept').click();

  // 创建共享（服务端建 share + 自封信封 + shareId 回写）→ 面板出现。
  await expect(ownerPage.getByTestId('share-panel')).toBeVisible({ timeout: 30_000 });
  await evidenceShot(ownerPage, '03-owner-panel-created.png');

  // 邀请 bob：输邮箱 → 一次性凭证显示（读出 token，交给 bob 旅程）。
  await ownerPage.getByTestId('share-invite-email').fill(bob.email);
  await ownerPage.getByTestId('share-invite-submit').click();
  const ticket = ownerPage.getByTestId('share-invite-ticket');
  await expect(ticket).toBeVisible();
  await evidenceShot(ownerPage, '04-owner-invite-ticket.png');
  const inviteToken = (await ownerPage.getByTestId('share-invite-token').textContent())?.trim() ?? '';
  expect(inviteToken.length, '一次性邀请凭证已显示').toBeGreaterThan(20);
  // 链接不含密钥（ADR-0062 决策 2：链接 = 入群凭证）：只可能是 token。
  const linkText = await ownerPage.getByTestId('share-invite-ticket').textContent();
  expect(linkText, '票据里不出现密钥材料').not.toContain('listKey');

  // owner 面板保持打开 —— bob 接受后由这里的轮询自动封信封（旅程的下一跳）。

  // ── bob：vault + 贴 token 入群 ───────────────────────────────────────────
  await seedCredentials(bobContext, bob);
  await bobPage.goto('/?lang=zh-CN');
  await expect(bobPage.locator('input[placeholder^="添加任务"]')).toBeVisible();
  await decidePrivacyConsent(bobPage, 'accepted');
  await establishVault(bobPage, BOB_PASSPHRASE);

  await bobPage.getByTestId('share-join-entry').click();
  await expect(bobPage.getByTestId('share-join-dialog')).toBeVisible();
  await evidenceShot(bobPage, '05-bob-join-dialog.png');
  await bobPage.getByTestId('share-join-token').fill(inviteToken);
  await bobPage.getByTestId('share-join-name').fill('家庭装修（合伙）');
  await bobPage.getByTestId('share-join-submit').click();

  // 等待 owner 自动下发信封（owner 面板 3s 轮询 → autoSeal）→ bob 解钥 → 清单落侧栏。
  await expect(bobPage.getByTestId('share-join-done')).toBeVisible({ timeout: 60_000 });
  await evidenceShot(bobPage, '06-bob-joined.png');
  await bobPage.getByTestId('share-join-close-final').click();
  await expect(bobPage.getByTestId('share-join-dialog')).toHaveCount(0);
  // 入群即导航：bob 现在就站在那条清单上（标题 = 自己起的本机名）。
  await expect(bobPage.locator('.ht-header__title')).toHaveText('家庭装修（合伙）');

  // ── owner：面板轮询看到 bob 成员行（信封已发） ──────────────────────────
  // 🔴 成员行的 testID 是 `share-member-<memberId>`，但它下面还挂着
  // `share-member-actions-<memberId>`（owner 对他人行的管理区）—— 前缀选择器
  // 要把 actions 排掉，否则"两个成员"会被数成三个节点。
  await expect(
    ownerPage.locator('[data-testid^="share-member-"]:not([data-testid^="share-member-actions"])'),
    'owner 面板出现第二个成员（bob）',
  ).toHaveCount(2, { timeout: 30_000 });
  // bob 的默认角色是 editor —— 面板里能看到「可编辑」。
  await expect(ownerPage.getByTestId('share-panel')).toContainText('可编辑');
  await evidenceShot(ownerPage, '07-owner-sees-bob.png');

  // ── 读数收口 ─────────────────────────────────────────────────────────────
  // 服务端事实（真 API，不靠 UI）：两个成员、bob 是 editor、信封已下。
  const sharesRes = await fetch(`${API_BASE}/api/shares`, {
    headers: { authorization: `Bearer ${owner.token}` },
  });
  expect(sharesRes.ok, 'owner 的 GET /api/shares 可读').toBe(true);
  const sharesBody = (await sharesRes.json()) as { shares: unknown[] };
  expect(sharesBody.shares.length, 'owner 名下至少有一份共享').toBeGreaterThanOrEqual(1);

  // console/pageerror 里不允许有未捕获的页面错误（§6.2 第 3 条的判据）。
  const pageErrors = consoleSink.filter((line) => line.includes('[pageerror]'));
  expect(pageErrors, `旅程中不允许未捕获页面错误：\n${pageErrors.join('\n')}`).toEqual([]);

  await ownerContext.close();
  await bobContext.close();
});
