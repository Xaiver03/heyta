import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * 自托管整套（真容器 + 真浏览器 + 零 mock）
 * ============================================================================
 *
 * ## 它判的是哪句话
 *
 * 「外人一条 `docker compose` 起全套、打开浏览器就能用」——
 * 这句话在 2026-10-03 之前**不成立**，因为镜像里根本没有界面
 * （`server/Dockerfile` 只打服务端，`apps/web/dist` 从来不在任何镜像里）。
 * 现在界面由同一个进程挂在 `/app/` 下，于是这条套件判的就是：
 *
 *   S1 打开 `/app/` 渲染出的是**应用**（不是空白、不是落地页、不是错误屏）；
 *      并且 service worker 在 `/app/` 这个 scope 下**真的注册上了**。
 *   S2 在这台实例上注册一个账号并登录，凭据落在**这台服务器**上。
 *   S3 建一条任务同步出去，**另一台全新设备**（空 IndexedDB）能读到它。
 *
 * ## 🔴 为什么 S1 里"SW 注册上了"是一条独立判据
 *
 * 它是 `docs/runbooks/deployment.md` §3.7 那条"还没做的"缺陷的直接反证：
 * 线上曾经 `SW_URL='/sw.js'` 指向站点根 ⇒ 注册请求拿回落地页 HTML ⇒
 * `SecurityError`，而**症状只是"少个功能"，界面上什么都正常**。
 * 那个缺陷只在"应用挂在子路径下"时才现形，而 `vite dev` / `vite preview`
 * 都跑在根路径 ⇒ 此前的所有离线套件**结构上看不见它**。
 * 所以这里必须量 `registration.scope`，而不是只看"没报错"。
 *
 * ## 🔴 为什么 S3 要开一台"全新设备"而不是查服务端
 *
 * 服务端端到端加密，**读不了明文**（这是产品立场，不是限制）。
 * 所以"数据真的上去了"唯一的判据形态是：另一个 clientId、空库的设备同步后
 * 读得到同一条任务。这也是 `verify:multi-end` 立的口径。
 *
 * ## 界面文案的取值来源
 *
 * 定位符全部用 `data-testid`（源码里打上的），少数用中文文案。
 * ⚠️ 中文定位符依赖 `heyta.locale` —— Playwright 的 Chromium 报 `en-US`，
 * 不钉语言会整片英文，红的形状像"元素不存在"（`e2e/tests/helpers.ts`
 * 的 `pinChineseUi` 记的同一件事）。本文件用 `contextOptions.locale='zh-CN'`
 * 之外的另一条：直接写 `localStorage`，与共享入口同一条口径。
 */

const BASE = process.env['HEYTA_SELFHOST_BASE'] ?? 'http://127.0.0.1:1900/app/';

/** 每轮一套新凭据：账号唯一 ⇒ 断言不会被上一轮留下的数据满足。 */
const STAMP = Date.now().toString().slice(-7);
const TASK_TITLE_PREFIX = `selfhost-task-${STAMP}`;
const E2EE_PASSWORD = `selfhost-e2ee-${STAMP}`;
const ACCOUNT_PASSWORD = `selfhost-pw-${STAMP}`;

/**
 * 一条用例一个账号。
 *
 * 🔴 不能共用一个模块级邮箱：`POST /register/email-password` 对**已存在**的邮箱
 * 走的是另一条分支（"已经有账号了？直接登录"），第二条用例会在
 * 第一条建好的账号上注册，红的形状是"登录面板不关"，看不出原因。
 */
let accountSeq = 0;
const newAccount = () => {
  accountSeq += 1;
  return { email: `selfhost-${STAMP}-${accountSeq}@example.test` };
};

/**
 * 打开应用并走完首启。
 *
 * 🔴 隐私同意**用点的**，不写 localStorage 伪造：本套件判的是
 * "同意之后这条链通不通"，而 SW 注册恰好是**由这道闸门驱动**的
 * （`apps/web/src/pwa/register.ts` 文件头：它不再只挂在 `load` 上）。
 * 替用户把状态写进磁盘，等于把要判的那一环跳过去。
 */
async function openApp(page: Page): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('heyta.locale', 'zh-CN'));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  const composer = page.locator('input[placeholder^="添加任务"]');
  await expect(composer, '`/app/` 打开后必须渲染出任务输入框（白屏/落地页/错误屏都到不了这一步）').toBeVisible({
    timeout: 30_000,
  });

  const consent = page.getByTestId('privacy-consent-dialog');
  if (await consent.isVisible().catch(() => false)) {
    await page.getByTestId('privacy-consent-accept').click();
    await expect(consent).toHaveCount(0);
  }
}

/** 头像菜单 → 登录/注册面板。 */
async function openAuthForm(page: Page): Promise<void> {
  await page.locator('[data-testid="account-menu-avatar"]').click();
  await page.getByText('登录 / 注册', { exact: false }).first().click();
  await expect(page.locator('[data-testid="auth-form"]')).toBeVisible();
}

/**
 * 注册 + 登录，返回时**已登录**。
 *
 * ⚠️ 注册与登录是两步：`POST /register/email-password` 的契约是
 * 「201 + 那句中性文案 + **不发会话**」（`server/tests/password-auth-routes.spec.ts:274`）。
 * 本套件跑在 `REQUIRE_EMAIL_VERIFICATION=false` 的实例上（没配 SMTP 的自托管），
 * 所以紧接着的口令登录**必须**成功 —— 这正是"这台实例能用起来"的那一步。
 *
 * 🔴 注册那一刻界面上会写"去邮箱点开那条验证链接"。这台实例**永远发不出那封信**
 * （没配 SMTP，且已显式关掉验证），所以那句话对本次部署是假的。
 * 已登记为缺口 G-42（见 `docs/research/self-host-distribution-audit.md` §8），
 * 修法要么动响应契约（本目标明令不动线协议），要么改 i18n 词条（被并行会话占用）。
 * 这里刻意**不**把它断言成期望行为。
 */
/**
 * 等表单**自己**换到目标档位，再往下填。
 *
 * 🔴 这不是"加个 sleep 让它别红"。实测：切档之后立刻 `fill()`，值会落进
 * 那一瞬间还在的旧节点上，重渲染把它清掉 ⇒ 提交时口令是空的 ⇒
 * 面板不关，红的形状是"登录失败"，而真实原因是探针抢跑（§7 元规则 1）。
 * 判据取"提交按钮的文案已经变成这一档的那句" —— 它是档位切换**唯一**的产出。
 */
async function settleToSubmitLabel(form: Locator, label: string): Promise<void> {
  const submit = form.locator('[data-testid="auth-form-submit"]');
  await expect(submit, `表单应当已经切到「${label}」那一档`).toHaveText(label, { timeout: 10_000 });
  await expect(form.locator('[data-testid="auth-form-password"]')).toBeVisible();
}

async function registerAndSignIn(page: Page, email: string): Promise<void> {
  await openAuthForm(page);
  const form = page.locator('[data-testid="auth-form"]');

  await form.locator('[data-testid="auth-form-email"]').fill(email);
  await form.locator('[data-testid="auth-form-continue"]').click();
  await settleToSubmitLabel(form, '登录');

  // 切到注册档，填口令并**亲手勾**同意（界面不许替他勾）。
  await form.locator('[data-testid="auth-form-switch-mode"]').click();
  await settleToSubmitLabel(form, '注册新账号');
  await form.locator('[data-testid="auth-form-password"]').fill(ACCOUNT_PASSWORD);
  await form.locator('[data-testid="auth-form-terms"]').click();
  await form.locator('[data-testid="auth-form-submit"]').click();
  // 🔴 等**响应落地**再切档：这句只可能来自 `POST /register/email-password` 的回复。
  // 不等的话，切档点击会跑在响应之前，而响应带着一次重渲染 ——
  // 症状是"面板还开着、口令看得见、点登录没反应"，红得完全看不出是抢跑
  // （实测：加 1.5s 等待的探针过，不加的这条用例红）。
  await expect(
    form.locator('[data-testid="auth-form-status"]'),
    '注册必须真的发出请求并拿到回复',
  ).toContainText('注册申请已提交', { timeout: 20_000 });

  // 切回登录档，用刚设的口令登录。
  await form.locator('[data-testid="auth-form-switch-mode"]').click();
  await settleToSubmitLabel(form, '登录');
  await form.locator('[data-testid="auth-form-password"]').fill(ACCOUNT_PASSWORD);
  await form.locator('[data-testid="auth-form-submit"]').click();

  await expect(form, '口令登录必须把面板关掉（面板还开着 = 登录没成）').toBeHidden({ timeout: 20_000 });
}

/** 只登录（第二台设备用）：账号由同一条用例的前半段建出来。 */
async function signIn(page: Page, email: string): Promise<void> {
  await openAuthForm(page);
  const form = page.locator('[data-testid="auth-form"]');
  await form.locator('[data-testid="auth-form-email"]').fill(email);
  await form.locator('[data-testid="auth-form-continue"]').click();
  await settleToSubmitLabel(form, '登录');
  await form.locator('[data-testid="auth-form-password"]').fill(ACCOUNT_PASSWORD);
  await form.locator('[data-testid="auth-form-submit"]').click();
  await expect(form, '口令登录必须把面板关掉（面板还开着 = 登录没成）').toBeHidden({ timeout: 20_000 });
}

/**
 * 打开 **设置 → 同步** 那一节，返回它的定位符。
 *
 * 🔴 H9 第 3 刀（2026-10-06）之后「同步设置」不再是 rail 齿轮点开的同级对话框，
 * 而是设置浮层里的**一节**：`SyncSettingsPanel.tsx` 是个带 `aria-label` 的
 * `<section>` ⇒ 可访问角色是 **region**，`getByRole('dialog', { name: '同步设置' })`
 * 从此恒不命中（裸 `getByRole('dialog')` 命中的是设置浮层，语义完全不同）。
 * 唯一路径是头像 → 设置；这一节住在**可滚动的长列表**里，不先
 * `scrollIntoViewIfNeeded()` 就点不到密钥表单、那张截图也拍的是浮层顶部。
 *
 * 🔴 这一份是**本套件自己的** helper：本套件跑在真容器的 `/app/` 子路径上，
 * 入口和语言钉法都跟离线套件不同，不把两套夹具接起来（不去 import
 * `e2e/tests/helpers.ts` 里那份同名的 `openSettingsView`）。
 */
async function openSyncSection(page: Page): Promise<Locator> {
  await page.getByTestId('account-menu-avatar').click();
  await page.getByTestId('account-menu-settings').click();
  const section = page.getByTestId('sync-settings-panel');
  await expect(section, '设置浮层里没有「同步」那一节').toBeVisible();
  await section.scrollIntoViewIfNeeded();
  return section;
}

/** 退出设置浮层：走它自己的 ✕（`settings-sheet-close`），不是凭空按 Esc。 */
async function closeSettingsSheet(page: Page): Promise<void> {
  await page.getByTestId('settings-sheet-close').click();
  await expect(page.getByTestId('settings-sheet'), '设置浮层没关上').toHaveCount(0);
}

/** 在 设置 → 同步 那一节里补端到端加密口令并保存（保存顺带触发一次同步）。 */
async function setE2eePassword(page: Page): Promise<void> {
  const section = await openSyncSection(page);
  // 🔴 全新实例上这一节是**另一档**：先「创建加密数据钥匙」，再把钥匙包发布出去。
  // 上一版只认「已有钥匙」那一档的 label（`web.sync.password.label`），所以在自己
  // 造的干净栈上必然等不到 —— 外人照着指南走的第一条路，验收从没驱动过它。
  //
  // 🔴 **分档必须有界地等，不许用瞬时 `isVisible()`**（2026-10-06 实测）：这两档都由
  // `!loading && …` 决定，而 `loading` 是"钥匙包 refresh 还没回来"。读那一瞬间还没决定档位
  // ⇒ 走 else ⇒ 去等一个界面根本不会出现的 label ⇒ 症状是整条用例超时（本机负载 16–18 时
  // S2/S3/S4 **三条同时**死在 `locator.fill` 的等待上，而失败快照里「创建钥匙」那档就在屏幕上）。
  // 现在两档各等各的锚点，两档都没出现就**点名报错** —— 静默走 else 比红更糟。
  const create = section.getByTestId('vault-create-form');
  const unlock = section.getByTestId('vault-unlock-form');
  const seen = await Promise.race([
    create.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'create' as const).catch(() => undefined),
    unlock.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'unlock' as const).catch(() => undefined),
  ]);
  if (seen === 'create') {
    await create.getByTestId('vault-create-passphrase').fill(E2EE_PASSWORD);
    await create.getByTestId('vault-create').click();
    const pending = section.getByTestId('vault-pending');
    await expect(pending, '创建之后必须进入待发布，并且给出恢复码').toBeVisible();
    await expect(section.getByTestId('vault-recovery-display')).not.toHaveText('');
    // 🔴 「确认并发布」在**照抄一遍恢复码**之前是 disabled（`VaultSettingsPanel.tsx:377` 那个
    // `vault-recovery-confirm` + `:383` 的 `disabled=… pendingCode.length === 0`）。
    // 上一版直接点它 ⇒ Playwright 反复"element is not enabled"直到用例预算耗尽，
    // 症状和"产品发不出去"一模一样，而红面会记在产品头上。这里把界面上那串码**读回来再填回去** ——
    // 这一步同时是判据：界面说"只显示这一次"，探针就必须能从界面拿到它。
    // ⚠️ 码本身**不进日志**（AGENTS §10：恢复码不得出现在证据里），只打印它的长度。
    const recovery = (await section.getByTestId('vault-recovery-display').innerText()).trim();
    expect(recovery.length, '恢复码必须真的显示出来').toBeGreaterThan(8);
    await section.getByTestId('vault-recovery-confirm').fill(recovery);
    await expect(pending.getByTestId('vault-publish')).toBeEnabled({ timeout: 30_000 });
    await pending.getByTestId('vault-publish').click();
    await expect(
      section.getByTestId('vault-ready'),
      '发布后界面必须说出钥匙就绪（否则同步只会在后台失败）',
    ).toBeVisible({ timeout: 30_000 });
  } else if (seen === 'unlock') {
    // 🔴 这一支以前写的是 `getByLabel('端到端加密口令')`。**那句话在产品里是有的**
    // （`web.sync.password.label` = 「端到端加密口令」，现量 `packages/i18n/src/locales/zh-CN.ts:701`），
    // 但它长在 `SyncSettingsPanel.tsx` 的 **`!vaultMode` 那一块**（legacy 口令字段），
    // 而走到这一支时 `vaultMode` 已经是真（`sync.accountId` 非空 —— 托管登录会把
    // `session.user.id` 交进去，`features/auth/store.ts:323`）⇒ 那一块根本不在 DOM 里，
    // 这个 label 在这档位上恒不命中。钥匙面板两档的输入框用的是另一条词条
    // `web.sync.vault.passphrase`（中文值「加密口令」，`VaultSettingsPanel.tsx:294` 与 `:327`）。
    // 加上这一支还漏了第二件事 —— 填完口令**从没点「解锁」**，直接去点「保存并同步」。
    // 两条叠在一起，这一支从写下那天起就不可能走通，而它此前从没被执行过：
    // 只有 S3 的**第二台设备**（服务端已有钥匙包、本地空库）才会落到解锁档。
    // ⇒ 判据换成产品自己给的 testid 锚点（`vault-passphrase` 只在解锁档：`:329`），
    //   并把"解锁成功"那句话真的断出来。
    await unlock.getByTestId('vault-passphrase').fill(E2EE_PASSWORD);
    await expect(unlock.getByTestId('vault-unlock'), '口令填了就必须允许解锁').toBeEnabled({ timeout: 30_000 });
    await unlock.getByTestId('vault-unlock').click();
    await expect(
      section.getByTestId('vault-unlocked'),
      '解锁之后界面必须进入"钥匙已解锁"那一档（否则同步只会在后台失败）',
    ).toBeVisible({ timeout: 30_000 });
  } else {
    throw new Error(
      '设置 → 同步 那一节里的钥匙面板既没有 `vault-create-form`（创建档）也没有 `vault-unlock-form`（解锁档）' +
        '⇒ 探针不认识当前档位；不把这一格读成产品坏了，也不静默走 else',
    );
  }
  await section.getByRole('button', { name: '保存并同步' }).click();
  // 🔴 旧断言 `expect(dialog).toBeHidden()` 的载体没了：这一节住在设置浮层里，
  // 保存不再关任何东西。这里必须**自己把浮层收掉**再判它离开 DOM ——
  // 不收的话 S2 之后要点头像、S3/S4 之后要填任务输入框，全都在浮层底下，
  // 而那张 `s2-signed-in.png` 拍到的会是设置页（§6.2 规定一：图里得真是那件事）。
  await closeSettingsSheet(page);
  await expect(
    section,
    '关掉设置之后那一节还在 DOM 里 ⇒ 它其实是常驻浮层，不是设置的一部分',
  ).toHaveCount(0);
}

/**
 * 同步那一枚所在的容器（rail 底部）。
 *
 * 🔴 H9 第 1 刀之后没有「立即同步」按钮，`div[role="status"]` + `has:` 那条
 * 结构判据恒不命中；容器 testID 才是"结构上唯一"那一条，整句状态文案常驻其内
 * （与 `e2e/multi-end/helpers.ts` 的 `statusBar` 同理由）。
 */
function statusBar(page: Page) {
  return page.getByTestId('sync-rail');
}

const credentialsOf = (page: Page) =>
  page.evaluate(() => window.localStorage.getItem('heyta.sync.credentials'));

test('S1 `/app/` 打开就是应用，且 service worker 在 /app/ scope 下注册上', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await openApp(page);
  // SW 注册发生在同意闸门**之后**，给它一点时间（注册本身不阻塞渲染）。
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => !!r)), {
      timeout: 20_000,
    })
    .toBe(true);

  const sw = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return { scope: r?.scope ?? null };
  });
  // 🔴 判 scope 而不是"注册成功了"：scope 回落到站点根就意味着
  // 产物里的 URL 又写成了根绝对 —— 那正是 §3.7 那条缺陷的形状。
  expect(sw.scope, 'SW 的 scope 必须是 /app/，否则产物又按根路径打了').toBe(
    new URL(BASE).href,
  );
  // 接管要等 SW 自己 claim，所以这是一条**轮询**而不是一次性读数
  // （一次性读必然拿到 `null` —— 注册那一页不会被自己首次接管）。
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), {
      message: 'SW 装上后必须真的接管这个页面（否则组件/离线那两条路都不成立）',
      timeout: 20_000,
    })
    .toBe(true);

  // manifest 必须由**服务端**以正确的 MIME 提供（拿回 HTML 是同一个缺陷的另一副面目）。
  const manifest = await page.request.get(new URL('manifest.webmanifest', BASE).href);
  expect(manifest.ok(), 'manifest.webmanifest 必须 200').toBe(true);
  expect(manifest.headers()['content-type'] ?? '').toContain('application/manifest+json');

  expect(consoleErrors, `界面不许有控制台报错：${consoleErrors.join(' | ')}`).toEqual([]);
  await page.screenshot({ path: 'selfhost-stack-results/s1-app-loaded.png', fullPage: false });
});

test('S2 在这台实例上注册并登录，凭据落在本机自己那台服务器', async ({ page }) => {
  await openApp(page);
  const { email } = newAccount();
  await registerAndSignIn(page, email);

  const creds = JSON.parse((await credentialsOf(page)) ?? 'null');
  expect(creds, '登录之后必须有凭据落盘（否则刷新就掉线）').not.toBeNull();
  // 🔴 认证地址 = 界面自己的 origin。这是"同一个容器 = 同一个 origin"这句话的
  // 产品级判据：它要是漂到别的域名上，自托管的用户就是在往**别人的**服务器登录。
  expect(creds.baseUrl, '凭据里的服务端地址必须就是这台实例').toBe(new URL(BASE).origin);

  await setE2eePassword(page);

  // 🔴 「登录上了」这件事必须**在界面上看得见**。上一版这张截图和 S1 逐像素级别相似
  // （顶栏仍是"未同步"、头像仍是占位符），也就是说它没有证明任何东西 ——
  // 判据在 localStorage 里，图不在。身份区就是那句话的产品级形态。
  await page.getByTestId('account-menu-avatar').click();
  const panel = page.getByTestId('account-menu-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('account-menu-email')).toHaveText(email);
  // 🔴 等入场动画落位再拍：`.ht-material` 带 `ht-material-in`（透明度渐入），
  // 上一版这张图拍在半透明那一帧，玻璃面板后面的侧栏字全部透出来叠在菜单上，
  // 看着像"面板没有背景"的缺陷。判据用动画的**唯一产出**（opacity 到 1），不是 sleep。
  await expect
    .poll(async () => panel.evaluate((el) => getComputedStyle(el).opacity), '面板动画没落位')
    .toBe('1');
  await page.screenshot({ path: 'selfhost-stack-results/s2-signed-in.png' });
});

test('S3 建一条任务同步出去，全新设备只能从服务端读到它', async ({ page, browser }) => {
  test.slow();
  const { email } = newAccount();
  // 任务名带账号序号：断言的是**这一条**，不是"上一轮剩的那条"。
  const title = `${TASK_TITLE_PREFIX}-${accountSeq}`;

  await openApp(page);
  await registerAndSignIn(page, email);
  await setE2eePassword(page);

  const composer = page.locator('input[placeholder^="添加任务"]');
  await expect(composer).toBeVisible();
  const row = page.locator('[data-testid^="task-item-"]').filter({ hasText: title });
  await expect(row, '写之前这条任务不许已经在（否则"出现了"可能来自上一轮）').toHaveCount(0);

  await composer.fill(title);
  await composer.press('Enter');
  await expect(row).toBeVisible();

  await page.getByTestId('sync-rail-action').click();
  await expect(statusBar(page)).toContainText('已同步', { timeout: 30_000 });
  await page.screenshot({ path: 'selfhost-stack-results/s3-device-a-synced.png' });

  // ── 第二台设备：全新 context = 空 IndexedDB ─────────────────────
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const fresh = ctx.pages[0] ?? (await ctx.newPage());
  await openApp(fresh);
  await signIn(fresh, email);

  // 口令**不随账号同步**（它从不落盘、也从不上传），所以新设备必须补一次。
  await setE2eePassword(fresh);
  await expect(
    fresh.locator('[data-testid^="task-item-"]').filter({ hasText: title }),
    '空库里那条任务只可能来自服务端',
  ).toBeVisible({ timeout: 30_000 });

  await fresh.screenshot({ path: 'selfhost-stack-results/s3-device-b-recovered.png' });
  await ctx.close();
});
