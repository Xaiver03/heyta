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
 *   互见：owner 在共享清单里写一条任务 → **bob 那台不刷新就看得见**；反向同一件事。
 *         这一格是 M2 的界面腿（宿主层由 `verify:collab-sync` 第 12 步验，两台浏览器
 *         里看得见才是用户事实）。
 *
 * §6.2 规定一的四条全做到：截图先落再断言、固定路径、console/pageerror
 * 从窗口创建起监听、人要看图（verify 脚本尾部打印证据路径）。
 *
 * 用法（不要直接跑；由 scripts/verify-collab-journey.mjs 驱动）：
 *   HEYTA_COLLAB_BASE=<server> HEYTA_COLLAB_WEB_URL=<vite> npx playwright test \
 *     --config playwright.collab.config.ts tests/collab-journey.spec.ts
 */
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { decidePrivacyConsent, selectSettingsSection } from './helpers';
import { fillVaultSecret } from '../vault/privacy';

const API_BASE = process.env['HEYTA_COLLAB_BASE'] ?? 'http://127.0.0.1:3217';
// 任务书第 1 步要钉的字面落点：链接文本里必须出现应用自己的 `http://127.0.0.1:<WEB_PORT>`。
// 靶子由 `scripts/verify-collab-journey.mjs` 注入（它自己就用这个号起 vite），缺省值与它逐字一致。
// 🔴 这道 fail-fast 不是装饰：靶子若是空串，`toContain('')` 对任何链接都成立 —— 一条永远通过的判据
//    比没有判据更糟（AGENTS §8.3），所以宁可装置自己在加载期就炸。
const WEB_URL = process.env['HEYTA_COLLAB_WEB_URL'] ?? 'http://127.0.0.1:4327';
if (!/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(WEB_URL)) {
  throw new Error(`装置坏：HEYTA_COLLAB_WEB_URL 不像应用的 loopback 地址（读到 "${WEB_URL}"）`);
}
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
/**
 * 固定证据路径（§6.2 规定二）：跑完直接打开同一组文件看。
 * 🔴 不落共享的 `test-results/` 树——并行套件的 Playwright 启动会整树清掉它
 * （见 playwright.collab.config.ts 的 outputDir 注释）；独立目录才能保证
 * 「拍了就在」，verify 脚本收口读的也是这里。
 */
const EVIDENCE = `${ROOT}e2e/collab-journey-results`;

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
  // 🔬 设置浮层是「分类导航 + 内容区」的 IA，默认停在「显示」组——必须显式切到
  // 「同步与隐私」组，否则 sync-settings-panel 在 DOM 里但 hidden（首跑实测）。
  await selectSettingsSection(page, 'sync');
  await page.getByTestId('sync-settings-panel').waitFor({ state: 'visible' });
  const section = page.getByTestId('sync-settings-panel');
  await section.scrollIntoViewIfNeeded();

  // vault 面板的 session 加载（IndexedDB + 首次 refreshFromRemote）在共享构建机
  // 上可超过默认 5s —— 这里同样给环境等待留余量。
  await expect(section.getByTestId('vault-create-form')).toBeVisible({ timeout: 30_000 });
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

/**
 * 打开「共享清单（实验）」开关（设置 → 同步）。
 *
 * 🔴 这一趟走的是**真实用户路径**，不是往 localStorage 里塞值：入口默认关是产品裁决
 * P-1（`docs/plans/collaboration-shared-lists.md` §9.2），所以"谁能打开它"本身就是
 * 今天这条链的一部分，得被验一遍。默认态不可达那一句由
 * `apps/web/tests/share-entry-experimental.spec.tsx` 在行为层钉，
 * `check:share-entry-hidden` 在源码层钉。
 */
async function enableShareExperimental(page: Page): Promise<void> {
  await page.getByTestId('account-menu-avatar').click();
  await page.getByTestId('account-menu-settings').click();
  await selectSettingsSection(page, 'sync');
  const toggle = page.getByTestId('share-experimental-toggle');
  await expect(toggle).toBeVisible();
  // 先留图再点：这枚开关的**措辞**就是 P-1 的交付内容（"看不到彼此改动"必须写在界面上），
  // 只断言可点击证不了那句话还在。名字用 01b 是为了不动既有 02–07 的引用。
  // 🔴 必须先滚到它：这一节比一屏长，第一版留的图里开关和那句话**根本不在画面内**
  //   （`toBeVisible()` 只要求有盒子，不要求在视口里 —— 一张看不到判据的图等于没取证）。
  await toggle.scrollIntoViewIfNeeded();
  await evidenceShot(page, '01b-owner-experimental-switch.png');
  await toggle.check();
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

/**
 * 按**标题**找一条任务行：`task-title-*` 是行体内唯一只装标题的那一枚。
 *
 * 🔴 不许退成整页 `getByText(标题)`，也不许按行体取：窄档下每行里常驻一只
 * `subtask-select-*`，它把**别的任务**的标题当 `<option>` 写进同一棵子树 —— 实测
 * `getByTestId('task-list').getByText('量窗台')` 先命中那枚 hidden 的 `<option>`，
 * 于是"这条搬过来了"被读成"这条没搬过来"（造一个假红）。同一条取数前提写在
 * `e2e/tests/selection-projections.spec.ts` 文件头与 `packages/ui/src/task-list/TaskRow.tsx` 里。
 */
const taskRowByTitle = (page: Page, text: string): Locator =>
  page.locator('[data-testid^="task-title-"]').filter({ hasText: text });

/** 这一台浏览器里"共享下行落了多少盘"的现场读数（只用于**失败信息**）。
 *
 * 为什么要它：两台互见那一腿断了有三种形状 —— ① 信号到不了这台/闸门把它丢了（没拉）
 * ② 拉到了但没合进视图 ③ 合了但界面没重读。Playwright 的默认报错只会说"元素没出现"，
 * 三种病灶的修法完全不同，而现场只有跑的时候拿得到（重跑一趟 ≈ 4 分钟）。
 * `heyta.share-log.*` 是那条唯一的痕迹：索引里没有这份 share = 一次都没落过盘。
 */
async function shareLogKeys(page: Page, label: string): Promise<string> {
  const keys = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith('heyta.share-log'))
      .map((k) => `${k}=${String(localStorage.getItem(k)).slice(0, 40)}`),
  );
  return `[${label}] ${keys.length > 0 ? keys.join(' | ') : '（没有任何 heyta.share-log* 键 ⇒ 这台设备一份共享内容都没落过盘）'}`;
}

/** 等一条跨设备搬过来的内容；等不到就把两边的现场读数并进报错里。 */
async function expectVisibleWithShareLogDump(
  page: Page,
  locator: Locator,
  label: string,
  timeout: number,
): Promise<void> {
  try {
    await expect(locator.first()).toBeVisible({ timeout });
  } catch (error: unknown) {
    const dump = await shareLogKeys(page, label);
    throw new Error(`${String(error)}\n      现场读数：${dump}`);
  }
}

test('共享清单全旅程：owner 建共享 + 邀请 → bob 贴 token 入群 → 双方成员对账 → 两台互见对方写的任务', async ({ browser }) => {
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
  // 应用就绪探针放 30s：vite dev 冷启动（模块转换）在共享构建机上可超 5s
  // （首跑实测：同一断言一轮过、一轮超时 —— 是环境等待，不是产品判据）。
  await expect(ownerPage.locator('input[placeholder^="添加任务"]')).toBeVisible({ timeout: 30_000 });
  await decidePrivacyConsent(ownerPage, 'accepted');
  await establishVault(ownerPage, OWNER_PASSPHRASE);
  await createProjectAndOpen(ownerPage, '家庭装修');
  await evidenceShot(ownerPage, '01-owner-list-ready.png');

  // 🔴 P-1 的默认态：停在自己的清单上、同步也配好了，入口**仍然不在**（不是隐藏样式，是不进 DOM）。
  await expect(ownerPage.getByTestId('share-open-button')).toHaveCount(0);
  await enableShareExperimental(ownerPage);

  // 头部「共享」→ PIPL 同意模态（方案 a）→ 确认。
  await ownerPage.getByTestId('share-open-button').click();
  await expect(ownerPage.getByTestId('share-consent-modal')).toBeVisible();
  // 🔴 视觉层级判据。这一格曾经"控件全都能用、整块零样式"通过了一轮 ——
  // 确认与取消等权时，同意面读起来就是一段裸文本加两颗一样的按钮，而功能断言一条都不会红。
  // 所以判的是**不等权**（主按钮吃到实心主蓝、取消没有），不是"有没有 class"。
  const consentEmphasis = await ownerPage.evaluate(() => {
    const bg = (testId: string) => {
      const el = document.querySelector(`[data-testid="${testId}"]`);
      return el === null ? '<missing>' : getComputedStyle(el).backgroundColor;
    };
    // `--ht-color-primary` 是十六进制，计算样式是 `rgb(...)`，先归一到后者再比。
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--ht-color-primary').trim();
    const hex = raw.replace('#', '');
    const primaryRgb =
      hex.length === 6
        ? `rgb(${Number.parseInt(hex.slice(0, 2), 16)}, ${Number.parseInt(hex.slice(2, 4), 16)}, ${Number.parseInt(hex.slice(4, 6), 16)})`
        : raw;
    return { accept: bg('share-consent-accept'), cancel: bg('share-consent-cancel'), primary: primaryRgb };
  });
  expect(consentEmphasis.accept, `确认共享按钮应是实心主蓝（现算 ${consentEmphasis.primary}）`).toBe(
    consentEmphasis.primary,
  );
  expect(consentEmphasis.cancel, '取消按钮不许与确认等权（读到同一个主蓝＝同意面又变成裸文本）').not.toBe(
    consentEmphasis.primary,
  );
  await evidenceShot(ownerPage, '02-owner-consent-modal.png');
  // ⚠️ 这一屏的**暗色**证据不在这里（`apps/web/tests/share-consent-modal-theme.spec.tsx` 用
  // 暗色 token 表渲染同一棵树来判）。原因记在 `apps/web/src/lib/theme.ts` 的文件头：
  // 应用暗色只改 `<html data-theme>`，而共享层按钮的颜色来自**开机时解析的 token 表**，
  // 中途 `emulateMedia({colorScheme:'dark'})` 截出来的与亮色那张**逐字节相同**（本轮实测），
  // 要让它真变暗必须重载页面，而重载会把这条旅程的解锁态打断。
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

  // W6 链接落点（把 04 号截图里「凭证 + 链接双展示」的可见事实钉进判据）：
  // 链接 = 应用可分享地址 + shareToken，落点是**应用自己**（bob 点开直接进加入旅程），
  // 不是同步服务器（ADR-0062 决策 2；`buildShareJoinLink` 用 window.location.origin 拼）。
  const inviteLink = (await ownerPage.getByTestId('share-invite-link').textContent())?.trim() ?? '';
  expect(inviteLink, '邀请链接以查询串形式携带 shareToken').toContain('shareToken=');
  expect(inviteLink, `邀请链接文本里出现应用自身的 loopback 落点 ${WEB_URL}`).toContain(WEB_URL);
  const parsedLink = new URL(inviteLink);
  const appOrigin = new URL(ownerPage.url()).origin;
  expect(parsedLink.origin, '邀请链接落点是应用自己的源').toBe(appOrigin);
  expect(parsedLink.origin, '邀请链接不得指向同步服务器').not.toBe(new URL(API_BASE).origin);
  expect(parsedLink.searchParams.get('shareToken'), '链接里的 token 与展示的凭证是同一个').toBe(inviteToken);

  // owner 面板保持打开 —— bob 接受后由这里的轮询自动封信封（旅程的下一跳）。

  // ── bob：vault + 贴 token 入群 ───────────────────────────────────────────
  await seedCredentials(bobContext, bob);
  await bobPage.goto('/?lang=zh-CN');
  await expect(bobPage.locator('input[placeholder^="添加任务"]')).toBeVisible({ timeout: 30_000 });
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
  // 🔴 一份共享只许在侧栏落**一条**清单行。06 号截图（2026-10-22 10:38 那一趟）里出现过两条
  // 同名行，而上面那条标题断言抓不到它 —— 标题读的是"当前在看哪条"，两条都叫这个名字。
  await expect(
    bobPage.locator('.ht-sidebar').getByText('家庭装修（合伙）', { exact: true }),
    '侧栏里这条共享清单只许出现一行',
  ).toHaveCount(1);

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

  // ── 面板阶段的失败**必须看得见** ─────────────────────────────────────────
  // 为什么钉这一发：面板阶段（`phase.kind === 'panel'`）先前**没有任何错误可见面** ——
  // 邀请 / 改角色 / 移除 / 转让的失败都往 `creatingError` 里写，而那块只画在 consent 阶段，
  // 于是"接不上就说是接不上"这句注释在真实面板上等于什么都没说。
  // 这里用一次确定性的 409（不靠服务端语义）把这条通路钉住：夹具让邀请接口失败，
  // 判的是界面上出现一句读得到的话，而不是按钮转一圈就完。
  await ownerPage.route('**/api/shares/*/invitations', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'SHARE_MEMBER_LIMIT', message: 'fixture：故意让邀请失败' }),
    });
  });
  await ownerPage.getByTestId('share-invite-email').fill('carol@example.com');
  await ownerPage.getByTestId('share-invite-submit').click();
  await expect(ownerPage.getByTestId('share-panel-error'), '面板阶段的失败要在面板上看得见').toBeVisible({
    timeout: 15_000,
  });
  await evidenceShot(ownerPage, '08-owner-panel-error-visible.png');
  await ownerPage.unroute('**/api/shares/*/invitations');

  // ── 9. 🔴 两台真浏览器里互见（M2 的界面腿） ───────────────────────────────
  //
  // `verify:collab-sync` 第 12 步在**宿主层**证了任务族的 op 会搬。宿主层两台 Node 互见
  // ≠ 用户互相看得见：中间还隔着三层，每一层都能单独断掉 ——
  //   ① 合并视图把它挂到哪条清单行（挂在作者本机那个 id 上的话，对面那台筛不出来）；
  //   ② `new_share_ops` 到不到**这台浏览器**（WS 是壳里接的，宿主层没有 WS）；
  //   ③ 界面到底重不重读状态（共享内容能在个人 op-log 一动没动的前提下变）。
  // 所以这一格判的是那三层合起来的用户可见结果，零 mock。
  //
  // ⚠️ 标题只当**锚**用，不当期望值：添加框是快速添加输入框，会解析日期/标签，
  // 拿"我敲进去的串"去对面找会被解析规则误判。取的是**界面上真落成的那一行**的文字，
  // 要跨线的就是那一句 —— 判据因此既不受解析器改动影响，也不可能空转。
  const ownerAnchor = '换窗纱';
  const bobAnchor = '量窗台';

  // 面板是模态，先关掉才回到清单面；关完仍在共享的那条清单上（写侧路由读的就是这条筛选）。
  await ownerPage.getByTestId('share-dialog-close').click();
  await expect(ownerPage.getByTestId('share-dialog')).toHaveCount(0);
  await expect(ownerPage.locator('.ht-header__title')).toHaveText('家庭装修');

  await ownerPage.locator('input[placeholder^="添加任务"]').fill(`${ownerAnchor}谁来约师傅`);
  await ownerPage.keyboard.press('Enter');
  const ownerRow = taskRowByTitle(ownerPage, ownerAnchor).first();
  await expect(ownerRow, 'owner 自己那台先看得见这条任务').toBeVisible();
  const titleFromOwner = (await ownerRow.textContent())?.trim() ?? '';
  expect(titleFromOwner.length, '取到界面上实际落成的那一行文字').toBeGreaterThan(0);
  await evidenceShot(ownerPage, '09-owner-wrote-shared-task.png');

  // ① + ② + ③：bob 那台**没有做任何刷新**，靠 WS 信号把这条搬过来并画出来。
  const bobSeesOwner = taskRowByTitle(bobPage, titleFromOwner);
  await expectVisibleWithShareLogDump(
    bobPage,
    bobSeesOwner,
    `B 那台看不见 A 写的「${titleFromOwner}」（信号/合并/重读三层里断了一层）`,
    30_000,
  );
  // 同一条共享任务在对面那台只许出现一行：挂两处（自己的行 + 共享的行）是这一族最容易
  // 长出来的形状，而"看得见"这一句对它照样是绿的。
  await expect(bobSeesOwner, '一条共享任务在对面那台只许出现一行').toHaveCount(1);
  await expect(bobPage.locator('.ht-header__title'), 'bob 仍站在自己那条清单行上').toHaveText('家庭装修（合伙）');
  await evidenceShot(bobPage, '10-bob-sees-owner-task.png');

  // 反向那一腿（同一个 seam 的另一半方向）：bob 写一条，owner 那台要看得见。
  await bobPage.locator('input[placeholder^="添加任务"]').fill(`${bobAnchor}周末去建材城`);
  await bobPage.keyboard.press('Enter');
  const bobRow = taskRowByTitle(bobPage, bobAnchor).first();
  await expect(bobRow, 'bob 自己那台先看得见这条任务').toBeVisible();
  const titleFromBob = (await bobRow.textContent())?.trim() ?? '';
  const ownerSeesBob = taskRowByTitle(ownerPage, titleFromBob);
  await expectVisibleWithShareLogDump(
    ownerPage,
    ownerSeesBob,
    `A 那台看不见 B 写的「${titleFromBob}」（反向那一腿断了）`,
    30_000,
  );
  await expect(ownerSeesBob, '反向：一条共享任务在作者以外那台只许出现一行').toHaveCount(1);
  await evidenceShot(ownerPage, '11-owner-sees-bob-task.png');

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
