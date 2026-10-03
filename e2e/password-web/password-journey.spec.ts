/**
 * 邮箱 + 口令：**真浏览器里的整条旅程**（J8 的界面腿 + J15 的无障碍契约）
 * ====================================================================
 *
 * 由 `scripts/verify-password-web-journey.mjs` 驱动（同源反代 + **TEST_MODE 关**
 * 的真服务端 + 真发信）。配置与拓扑的理由写在
 * `e2e/playwright.password-web.config.ts` 文件头。
 *
 * ## 两条用例，各自独立
 *
 * - **⓪ J15 的 DOM 契约**：不需要账号，只要表单渲染出来就能判 ——
 *   所以它是单独一条，坏了不会被整条旅程的失败掩盖。
 * - **①–⑥ 一台设备的旅程**：注册 → 收信 → 点链接 → 确认 → 退出 → 用口令再登录 →
 *   暗色。这几步**必须在同一个 context 里**（= 同一台设备），所以只能是一条用例；
 *   拆成多条会让每一步都重新注册一个账号，而"会话交回的是哪台设备"就判不出来了。
 *
 * ## 🔴 共享步骤一律来自 `../auth-journey/helpers`
 *
 * `openApp` / `openAuthPanel` / `toCredentialStage` / `toRegisterMode` /
 * `acceptTerms` / `authStatus` 都是那边已有的。这里**不重写**它们 ——
 * AGENTS §3.5 记过两次"抽出了共享实现但旧的那份没删"的事故，
 * 而漂移的表现是"某一端突然找不到元素"。
 *
 * ## 断言的分工
 *
 * `outcome`（用户能不能用）与 `structure`（这版实现靠什么成立）在**标题里点名**，
 * 与 CLI 那条链同一张判据表。读红的人要能立刻知道"是不是产品坏了"。
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  SERVER,
  acceptTerms,
  authStatus,
  freshEmail,
  openApp,
  openAuthPanel,
  requireServer,
  toCredentialStage,
  toRegisterMode,
} from '../auth-journey/helpers';

/**
 * 证据目录在**仓库里的**固定路径（`apps/web/evidence/`，与另外几条真链路验收同级）。
 *
 * ⚠️ 从 `import.meta.url` 推而不是从 cwd 推：这个套件由驱动脚本以
 * `pnpm --dir e2e exec playwright test` 启动，cwd 恰好是 `e2e/` ——
 * 但"恰好"不是判据。有人手工从仓库根跑一次，相对路径就会把截图写到别处，
 * 而"证据不见了"看起来像套件坏了。
 */
const EVIDENCE = fileURLToPath(new URL('../../apps/web/evidence/password-web-journey', import.meta.url));
const SHOT = (name: string): string => `${EVIDENCE}/${name}.png`;
// 🔴 先把目录建出来：`page.screenshot()` 自己会建，但**用例在任何一张图之前就失败**时
//    不会 —— 而驱动结尾那句"截图在 apps/web/evidence/…"就会指向一个不存在的目录。
//    空目录至少说的是实话："跑了，没出图"。
mkdirSync(EVIDENCE, { recursive: true });

/** 登录口令。每轮换邮箱（`freshEmail()`），所以固定值即可。 */
const LOGIN_PASSWORD = 'lantern otter ledger 27';

const API_LOG = (): string => {
  const p = process.env['HEYTA_PASSWORD_WEB_API_LOG'];
  if (!p) {
    throw new Error(
      '缺 HEYTA_PASSWORD_WEB_API_LOG —— 本套件必须由 `pnpm verify:password-web` 启动' +
        '（服务端日志是"那一封信真的存在"的唯一仪器）。',
    );
  }
  return p;
};

const PSQL_URL = (): string => {
  const p = process.env['HEYTA_PASSWORD_WEB_PSQL'];
  if (!p) {
    throw new Error('缺 HEYTA_PASSWORD_WEB_PSQL —— 同上，必须由驱动脚本启动。');
  }
  return p;
};

/**
 * 读 `users` 那一行的三个形状位：`is_verified | 有口令哈希 | 验证令牌已清`。
 *
 * ⚠️ URL 已由驱动剥掉 Prisma 专有查询参数（`?schema=` 等）—— `psql` 只认 libpq URL，
 *    不剥的症状是它直接失败、stdout 为空，而判据只会说"读到空"。
 *
 * 🔴 这个查询**只看形状、不看内容**：库里是密文与哈希，任何"按明文断言"的写法
 *    在这里都结构上不可能（服务端从设计上看不到用户明文），别顺手加。
 */
function queryRow(email: string): string {
  return spawnSync(
    'psql',
    [
      PSQL_URL(),
      '-tAc',
      `select is_verified, coalesce(length(password_hash),0) > 0, verification_token is null ` +
        `from users where email='${email}'`,
    ],
    { encoding: 'utf8' },
  ).stdout.trim();
}

const field = (dialog: Locator, id: string) => dialog.getByTestId(`auth-form-${id}`);

/**
 * 断言"这一面真的处于登录态，而且登录的是这个账号"。
 *
 * 🔴 身份区**不是** `menuitem`（`AccountMenu.tsx:314` 是一个 `div.ht-accountmenu__who`
 * 带 `data-testid="account-menu-email"`）。2026-09-30 的身份入口唯一化把已登录态定成
 * 「身份区（不可点）+ 设置 + 成长 + 退出登录」—— 不可点的东西没有 menuitem 角色，
 * 所以 `getByRole('menuitem').filter({ hasText: email })` 是一条**永远红**的判据，
 * 而快照里明明白白写着那个邮箱（本轮实测就是这样）。
 *
 * 🔴 三件一起判才不是一句空话：身份区在、退出登录在、**「登录 / 注册」不在**。
 *    少了第三件，"未登录时身份区恰好也叫别的名字"这类形态就漏掉了 ——
 *    而这正是那条 IA 裁决的另一半。
 */
async function expectSignedIn(page: Page, email: string): Promise<void> {
  await page.getByTestId('account-menu-avatar').click();
  const who = page.getByTestId('account-menu-email');
  await expect(who, '已登录时菜单里必须显示这个账号').toHaveText(email);
  await expect(page.getByTestId('account-menu-signout'), '已登录时必须有退出登录').toBeVisible();
  await expect(
    page.getByTestId('sync-signin-entry'),
    '已登录时不许再出现「登录 / 注册」入口',
  ).toHaveCount(0);
}

/**
 * 控制台与未捕获异常，**按用例**收集，失败时整段打出来（AGENTS §6.2 规定一第 3 条）。
 *
 * 🔴 为什么这一条在这个套件里格外重要：这条旅程有**五个**可能白屏的面
 * （应用、认证面板、确认页、`/app/#sessionToken=` 那一跳、暗色重挂），
 * 而白屏在自动化里的表现是"某个元素没出现 ⇒ 超时"，**什么都不报**。
 * 真正说得出原因的那一行（模块 404、CSP 拦脚本、React 抛错）只在控制台里。
 *
 * ⚠️ 监听挂在 **context** 上而不只是 `page`：新标签页（如果有）最容易坏在这一条
 *    旅程上，只挂 `page` 会恰好收不到它 —— 本轮那句 OPFS
 *    `NoModificationAllowedError` 就是这样从 `[other-page]` 那一栏才看见的
 *    （④ 现在刻意用同一个标签页，见那里的说明；这张 watcher 是留着，
 *    因为"哪天有人把它改回两张标签页"的征兆只会出现在控制台里）。
 */
const consoleByTest = new Map<string, string[]>();

test.beforeEach(async ({ page, context, request }, testInfo) => {
  const lines: string[] = [];
  consoleByTest.set(testInfo.testId, lines);
  const watch = (target: typeof page, label: string) => {
    target.on('console', (m) => lines.push(`[${label} console:${m.type()}] ${m.text()}`));
    target.on('pageerror', (e) => lines.push(`[${label} pageerror] ${e.message}`));
  };
  watch(page, 'page');
  context.on('page', (p) => watch(p, 'other-page'));
  await requireServer(request);
});

test.afterEach(async ({}, testInfo) => {
  const lines = consoleByTest.get(testInfo.testId) ?? [];
  consoleByTest.delete(testInfo.testId);
  if (testInfo.status === testInfo.expectedStatus || lines.length === 0) return;
  // 🔴 **两个通道都给**：`console.log` 满足 §6.2 规定一第 3 条（"失败时打印"），
  //    而 `attach` 让它**跟着报告落盘**。本轮实测过一次只剩 attach 才有救：
  //    驱动的输出被管道吞掉之后，stdout 里的诊断一个字都找不回来，
  //    而 trace/error-context 里也没有控制台。
  console.log(
    `\n── 控制台 / 未捕获异常（${testInfo.title.slice(0, 24)}…）──\n${lines.join('\n')}\n──`,
  );
  await testInfo.attach('console-and-pageerrors', {
    body: lines.join('\n'),
    contentType: 'text/plain',
  });
});

// ── ⓪ J15 的 DOM 契约（失败态就能判，不需要账号）────────────────────────
test('⓪ 表单的无障碍契约：autocomplete 的值 / 显隐按钮的 aria-pressed / 错误是文字（structure）', async ({
  page,
}) => {
  await openApp(page, '/app/');

  const dialog = await openAuthPanel(page);
  // 用一个**不存在**的邮箱：反枚举 ⇒ 这一屏的文案不暴露账号是否存在。
  const email = `pw-web-nobody-${Date.now()}@example.invalid`;

  /**
   * 🔴 表单是**两屏**的，而两屏的节点是**互斥**的（`AuthForm.tsx` 的
   * `stage === 'identify' ? … : …`）：第一屏只有邮箱框（`auth-form-email`），
   * 第二屏把它换成一条身份行（`auth-form-change-email`）并**才**出现口令框与显隐钮。
   * 所以每条断言必须挂在自己那一屏上 —— 先点「继续」再回头找 `auth-form-email`
   * 得到的是"element(s) not found"，而那**不是**契约坏了。
   */
  const emailInput = field(dialog, 'email');
  await expect(emailInput, '⓪ 第一屏必须有邮箱框').toBeVisible();
  // 🔴 断言的是**值**而不是"有这个属性"：`autocomplete` 写错成
  //    `new-password` / `current-password` 两种都"看起来有值"，而后果完全不同
  //    （浏览器会把**旧口令**填进注册框）。
  await expect(emailInput).toHaveAttribute('autocomplete', 'username webauthn');

  // 进第二屏，并切到注册档（`toRegisterMode` 幂等：已经在那儿就不重复点）。
  await toRegisterMode(dialog, email);
  const pw = field(dialog, 'password');
  await expect(pw).toHaveAttribute('autocomplete', 'new-password');

  // 显隐开关：读屏用户听到的必须是**状态**，不是一个图标。
  const reveal = field(dialog, 'reveal');
  /**
   * 口令框的有效类型读的是 **IDL 属性 `input.type`**，不是 `type` 属性。
   *
   * 🔴 本轮实测出来的：react-native-web 的 `TextInput` 只在传了 `inputMode` 或
   * `keyboardType` 时才给 DOM 写 `type`（它内部那段 `var type;` 在两者都没传时
   * 保持 `undefined`），而共享表单的口令框两样都没传。于是掩码态有
   * `type="password"`（`secureTextEntry` 那一支真的会写），**明文态却根本没有
   * `type` 属性** —— `getAttribute('type')` 是 `null`，浏览器按 HTML 默认状态
   * 把它当 `text`。判"属性"得到的是一句 `Expected "text" / Received ""`，
   * 而屏幕上口令**确实显出来了**：红的是探针，不是契约。
   * 判 `el.type` 说的才是用户看到的那件事，且两种读法在掩码态仍相等。
   */
  const typeOf = (l: Locator) => l.evaluate((el) => (el as HTMLInputElement).type);
  await expect(reveal).toHaveAttribute('aria-pressed', 'false');
  await expect
    .poll(() => typeOf(pw), { message: '⓪ 口令默认必须是掩码' })
    .toBe('password');
  await reveal.click();
  await expect(reveal).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() => typeOf(pw), { message: '⓪ 点了显隐之后口令必须是明文' })
    .toBe('text');
  // 🔴 **先打字再拍**：空框的"明文"和"根本没内容"在 PNG 上长得一模一样，
  //    那张图就判不出显隐到底生效没有（§6.2 规定一：图是证据，不是仪式）。
  //    这一句本来就是下面失败态要填的那个太短口令，挪上来不额外做任何事。
  await pw.fill('123');
  await page.screenshot({ path: SHOT('1-register-revealed') });

  // 失败态：口令填一个**太短**的，让**服务端**按 policyCode 拒（不是客户端演的）。
  await acceptTerms(dialog);
  await field(dialog, 'submit').click();

  const st = authStatus(dialog);
  await expect(st, '失败原因必须出现在状态区').toContainText('至少', { timeout: 60_000 });
  // live region：错误**念得出来**，不只是一个红框（红框对读屏等于零信息）。
  await expect(st).toHaveAttribute('aria-live', 'polite');
  // 错误**是文字**：`textContent` 拿得到实质内容，而不是只有颜色变了。
  await expect(st).not.toHaveText(/^\s*$/);
  await page.screenshot({ path: SHOT('2-register-policy-error') });

  // 失败之后输入的内容必须**还在**（清空重填是最常见的表单反模式）。
  // 第二屏上承载"还在不在"的是身份行，不是输入框（见上面那段两屏说明）。
  await expect(field(dialog, 'change-email')).toContainText('pw-web-nobody-');

  await field(dialog, 'close').click();
  await expect(dialog).toBeHidden();
});

// ── ①–⑥ 一台设备的整条旅程 ────────────────────────────────────────────
test('①–⑥ 注册 → 那一封信 → 确认页 → 落到 /app/ → 退出 → 用口令再登录（outcome）', async ({
  page,
  context,
}) => {
  const email = freshEmail();

  /**
   * 🔴 在**任何导航之前**记下每个文档启动瞬间的 URL。
   *
   * ④ 要判"会话是经 fragment 交回应用的"，而应用消费完令牌会把 hash 清掉 ——
   * 事后读 `location.hash` 得到的是**清理之后**的状态，那条判据就会永远红。
   * （`verify-email-web-chain.mjs` 用的是同一个 `__boot` 仪器，不是巧合。）
   */
  await context.addInitScript(() => {
    (window as unknown as { __boot?: { href: string } }).__boot = { href: location.href };
  });

  await openApp(page, '/app/');

  // ── ① UI 注册（注册档 + 填口令 + 勾同意）────────────────────────────
  const dialog = await openAuthPanel(page);
  await toRegisterMode(dialog, email);
  await field(dialog, 'password').fill(LOGIN_PASSWORD);
  await acceptTerms(dialog);
  await field(dialog, 'submit').click();

  const st = authStatus(dialog);
  await expect(st, '注册受理之后状态区要有话').toContainText('邮箱', { timeout: 120_000 });
  // outcome：那句话指向"去邮箱点验证链接"，而不是"已经登录好了"（注册不发令牌）。
  await expect(st).toContainText('验证链接');
  await page.screenshot({ path: SHOT('3-register-submitted') });

  // 🔴 A1（structure）：注册那一步**不许**把会话写进任何存储 —— 登录才是
  //    唯一发令牌的落点。这一条的正对照在 ④（登录之后同一个 key **必须**存在），
  //    没有正对照的话，这里可能只是"这个 key 从来不会被写"（名字拼错、写入路径
  //    没接）也能判过 —— 一条永远通过的判据比没有判据更糟。
  await expect.poll(() => page.evaluate(() => localStorage.getItem('heyta.sync.credentials'))).toBe(
    null,
  );

  // 库里这一行：还没验证、口令**已经存下**、一次性令牌**还挂着**（那封信正是它）。
  // ⚠️ `is_verified` 是 INTEGER（`schema.prisma:17` 的 `0 or 1`），不是 boolean：
  //    它打出 `0`/`1`，而同一句里那两个 boolean 表达式打出 `t`/`f`。
  //    整条都按 `t|t|t` 写会**永远红**，按 `.*` 写会**永远绿**。
  expect(queryRow(email), '① 库里：未验证 / 有口令哈希 / 验证令牌还在').toMatch(/^0\|t\|f$/);

  // ── ② 验证**之前**用口令登录：403 email_not_verified 的那一句 ─────────
  await field(dialog, 'switch-mode').click();
  await expect(field(dialog, 'password')).toBeVisible();
  await field(dialog, 'password').fill(LOGIN_PASSWORD);
  await field(dialog, 'submit').click();
  await expect(st).toContainText('验证', { timeout: 120_000 });
  {
    // outcome：界面承认**口令已经验对**了，只差最后一步。
    await expect(st).toContainText('密码是对的');
    // structure：不能把"没验证"说成"账号不存在"（反枚举 —— 这句是产品承诺）。
    await expect(st).not.toContainText('不存在');
    await page.screenshot({ path: SHOT('4-email-not-verified') });
  }
  await field(dialog, 'close').click();

  // ── ③ 那一封信**真的存在**：从服务端日志抓 preview，再从信里取链接 ────
  // ⚠️ `expect.poll(...).matcher()` **不返回那个值**（它是断言，返回 void），
  //    所以这里先"等到有"，再单独读一次 —— 日志只会变长，两次读之间不会失效。
  await expect.poll(verifyLinkFromLog, {
    timeout: 120_000,
    message:
      '③ 那一封信没发出来（TEST_MODE 没关？没网？），或信里没有可用的验证链接 —— ' +
      '注意：日志文件里可能留着**上一轮**的 preview，驱动每次运行先截断它。',
  }).not.toBe('');
  const verifyLink = await verifyLinkFromLog();
  // structure：链接指向**本次反代**这个 origin（`PUBLIC_URL` 配错的症状是"点开了 404"，
  // 而那条 404 会被读成"确认页坏了"）。
  expect(verifyLink.startsWith(SERVER), `③ 信里的链接：${verifyLink.slice(0, 80)}`).toBe(true);

  // 🔴 structure：**界面语言必须一路传到信和页**。产品负责人 2026-10-03 的口径是
  //   「默认中文，英文只能是用户自己选的」，而这里能证到的最强形式是"跟着界面走"：
  //   客户端把当前界面语言作为 `body.locale` 发出去，服务端把它写进链接的 `lang=`。
  //   这条同时钉住两件事：① 参数没在链路上丢；② 页不再由 `Accept-Language` 决定
  //   （本套件的 chromium 是 `Desktop Chrome` ⇒ `en-US`，界面是中文时只要链路上
  //   任何一环还读浏览器头，这里就会拿到 `en` 而红）。
  const uiLang = await page.evaluate(() => document.documentElement.lang);
  expect(uiLang, '③ 先证明界面语言本身可读（读不到就是判据空转）').toBe('zh-CN');
  expect(verifyLink.includes(`lang=${uiLang}`), `③ 链接里的语言：${verifyLink}`).toBe(true);

  // ── ④ 在浏览器里点开它：确认页 → 点确认 → 跳 /app/ → 真的登录了 ────────
  /**
   * 🔴 **同一个标签页**，不是 `context.newPage()`。
   *
   * 实测（本轮）：另开一张去点那条链接，控制台会刷成串的
   * `NoModificationAllowedError: Failed to execute 'createSyncAccessHandle' …
   * there is another open Access Handle`，而那张页面上的应用**永远启动不完**
   * —— 判据红在"找不到头像"，看起来像"确认页跳转坏了"。
   * 原因是 web 的存储是 `@sqlite.org/sqlite-wasm` + OPFS **SAH Pool VFS**，
   * 同一个文件只允许一个 access handle（`packages/storage/src/sqlite/`
   * 的驱动文件头警告的就是这件事）。第一张标签页还活着（带着面板与库），
   * 第二张就必然拿不到存储。
   *
   * ✅ 同一个标签页同时是**真实用户形态**：他在邮件客户端里点链接，浏览器把
   *    **当前这一页**带到确认页 → 确认 → 落到 `/app/`。
   *    `scripts/verify-email-web-chain.mjs` 用的也是这一种。
   */
  await page.goto(verifyLink);
  const confirmButton = page.locator('#login-btn');
  // outcome：打开的是**确认页**（有那个确认按钮），不是"链接已失效"。
  await expect(confirmButton, '④ 服务端渲染的确认页必须有确认按钮').toBeVisible();
  // 🔴 outcome：确认页**说界面那种语言**。这张图就是 2026-10-03 那次翻车的位置 ——
  //   它渲染成了整页英文，而收件人真正点开的链接是带 `lang=zh-CN` 的（探针截了参数）。
  expect(
    await page.evaluate(() => document.documentElement.lang),
    '④ 确认页的 <html lang> 必须等于界面语言',
  ).toBe(uiLang);
  await page.screenshot({ path: SHOT('5-confirm-page') });

  await confirmButton.click();
  await page.waitForURL(/\/app\//, { timeout: 120_000 });

  // 🔴 structure：会话交回的**通道**本身也是判据，不只是"最后登上了"。
  //    令牌必须在 **fragment** 里 —— 查询串会进服务端访问日志与 Referer 链路。
  //    读的是文档启动**瞬间**的 `__boot.href`（上面那段 addInitScript）：
  //    应用消费完令牌会把 hash 清掉，事后读 `location.hash` 得到的是清理后的状态，
  //    那条判据就会**永远红**。
  const boot = await page.evaluate(() => String((window as unknown as { __boot?: { href?: string } }).__boot?.href ?? ''));
  expect(boot.includes('/app/#') && boot.includes('sessionToken='), `④ 启动瞬间的地址：${boot.slice(0, 90)}`).toBe(
    true,
  );
  // 与上一条**成对**：先证明它来了，再证明它走了 —— 不清的话会话就长期留在浏览历史
  // 与"复制当前地址"里。
  //
  // 🔴 **顺序是判据的一部分**：先判 outcome（这一面真的登录了），再判 hygiene。
  //    `holdPendingLogin()`（抹 fragment 的那一步）挂在 `main.tsx` 的
  //    `initOpLog().then()` 里，所以"fragment 没被抹掉"的**真原因**很可能是
  //    "这一面压根没启动完"。反过来写就得到一句"没抹掉"的超时 ——
  //    把两件事说成同一件事，而读红的人只会去查清理逻辑。
  await expect(
    page.getByTestId('account-menu-avatar'),
    '④ 点完信里的链接之后，应用这一面必须已经启动并登录',
  ).toBeVisible({ timeout: 120_000 });

  // ⚠️ 判的是 `hash === ''` 而不是"不含 sessionToken"：产品的 `clear()` 抹的是
  //    **整个** fragment（`history.replaceState(null,'',pathname+search)`），
  //    留半个片段就是留状态。与 `verify-email-web-chain.mjs` 同一个谓词。
  //    用显式等待环而不是 `expect.poll`：失败时把**当前地址**吐出来。
  const clearDeadline = Date.now() + 20_000;
  let hashGone = false;
  let finalHref = page.url();
  while (Date.now() < clearDeadline && !hashGone) {
    finalHref = page.url();
    hashGone = new URL(finalHref).hash === '';
    if (!hashGone) await new Promise((r) => setTimeout(r, 250));
  }
  expect(
    hashGone,
    `④ 会话 fragment 必须被抹掉（一次性凭据不许留在历史里）。当前地址：${finalHref.slice(0, 120)}`,
  ).toBe(true);

  // 会话不是只活在"刚点完链接"那一瞬：**刷新之后仍在**才算落到了这台设备上。
  // ⚠️ 刷新会重启整个应用（存储 + op-log + 同步），所以这一步顺带判了
  //    "fragment 消费掉的令牌真的写进了凭据存储"。
  await page.reload();
  await expectSignedIn(page, email);
  await page.screenshot({ path: SHOT('6-signed-in-light') });

  // 🔴 ① 那条 `null` 判据的**正对照**（见上面那段注释）：登录之后同一个 key 必须存在。
  const creds = await page.evaluate(() => localStorage.getItem('heyta.sync.credentials'));
  expect(creds, '④ 登录之后凭据 key 确实会写（否则 ① 那条 null 判据是空的）').not.toBeNull();
  const keys = Object.keys(JSON.parse(creds as string) as Record<string, unknown>);
  // structure：落盘的凭据里**没有口令字段** —— 口令是解密密钥，落盘等于取消端到端加密。
  expect(keys.some((k) => k.toLowerCase().includes('password')), `④ 落盘字段：${keys.join(',')}`).toBe(
    false,
  );

  // 🔴 与 ① 的 `0|t|f` 配成另一对：令牌**在** → 点了信里的链接 → 令牌**没了**、
  //    账号**变成已验证**。只看界面上"登录了"判不出这封信真的落到库里。
  expect(queryRow(email), '④ 那封信真的改了库：已验证 / 有口令哈希 / 令牌已清').toMatch(/^1\|t\|t$/);

  // ── ⑤ 退出登录 ⇒ **只用邮箱 + 口令**再登一次（J8 的反证就在这一条）─────
  // 菜单此刻是开着的（上面那条判据就是打开它拍的图）。用 testID 而不是"退出登录"
  // 这个中文词条 —— 词条会变，结构不会。
  await page.getByTestId('account-menu-signout').click();
  await page.reload();

  // 🔴 先证明**退出真的生效了**，否则下面"登进去了"可能只是没退干净。
  //    （凭据被清 + 菜单第一项回到「登录 / 注册」，两条同时成立才算。）
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('heyta.sync.credentials')), {
      message: '⑤ 退出登录必须把落盘的凭据清掉',
    })
    .toBeNull();
  const back = await openAuthPanel(page);
  await expect(back).toBeVisible();

  await toCredentialStage(back, email);
  const pw2 = field(back, 'password');
  await expect(pw2, '⑤ 登录档必须出现口令框').toBeVisible();
  // structure：登录档是 `current-password`（注册档那条是 `new-password`；
  // 两档写反 = 浏览器把旧口令填进注册框 / 把新口令当自动填充源）。
  await expect(pw2).toHaveAttribute('autocomplete', 'current-password');
  // 🔴 这条判据的**能失败性**（2026-10-02 实测）：把下面那一格换成错口令后重跑，
  //    ⑤ 当场红，且吐出来的是「登录失败：邮箱或密码不正确。」、判定 `failed：…` ——
  //    等待环不是装饰：没有它这里只会得到一个 120 秒超时，而"口令错"与"服务端没起"
  //    在超时输出上长得一模一样。
  await pw2.fill(LOGIN_PASSWORD);
  await field(back, 'submit').click();

  // 🔴 成功判据**不能**只断言"面板里出现已登录"：成功后面板会自动关
  //    （`SyncBar` 的 `onSignedIn → closeSignIn`），那是在赌竞态。
  //    2026-09-30 实测：桌面壳那边面板**稳定先关**，4 条登录用例全红，
  //    而服务端日志明写登录成功、令牌已落盘 —— **产品是对的，断言是错的**。
  //    ⇒ 合法形态是**两者之一**：面板关掉，或状态区出现"已登录"。
  //
  // ⚠️ 这里用**显式等待环**而不是 `expect.poll`：失败时要能把"最后一次状态区文案"
  //    一起吐出来。`expect.poll` 的 message 是静态的，于是红只等于一个超时 ——
  //    而"口令错了""服务端没起来""界面卡在等待"三种红在超时输出上长得一模一样。
  const beforeSubmit = ((await authStatus(back).textContent().catch(() => '')) ?? '').trim();
  const deadline = Date.now() + 120_000;
  let shape = 'waiting';
  let last = beforeSubmit;
  while (Date.now() < deadline && shape === 'waiting') {
    if (!(await back.isVisible().catch(() => false))) {
      shape = 'closed';
      break;
    }
    last = ((await authStatus(back).textContent().catch(() => '')) ?? '').trim();
    if (last.includes('已登录')) shape = 'signed-in';
    // 状态区出现了**既不是空态开头、也不是"已登录"**的文案 ⇒ 那是失败原因，当场报。
    // （空态与错误态在表单里是互斥的两套节点，所以"以空态开头"精确圈出"仍在等待"。）
    else if (last !== '' && !last.startsWith(beforeSubmit)) shape = `failed：${last.slice(0, 140)}`;
    else await new Promise((r) => setTimeout(r, 300));
  }
  expect(
    shape === 'closed' || shape === 'signed-in',
    `⑤ 用邮箱 + 口令没有登进去（最后一次状态区文案：「${last.slice(0, 140)}」，判定：${shape}）`,
  ).toBe(true);
  await page.reload();
  // outcome：刷新之后仍是登录态 —— 会话不是只活在面板里的一次性状态。
  await expectSignedIn(page, email);

  // ── ⑥ 暗色：先断言主题**真的**切了，再拍 ────────────────────────────
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  // 🔴 structure：这一条不是仪式。AGENTS §5「暗色不是亮色的反相，必须实际切换查看」，
  //    而"切了没切"两张 PNG 在没人看的时候长得一模一样 —— §7 第 82 条那次
  //    "四轮截图统计全绿、装出来的却是报错页"就是这么漏的。
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset['theme'] ?? null), {
      message: '⑥ 系统偏好暗色时 <html data-theme> 必须真的是 dark',
    })
    .toBe('dark');
  // 暗色那张图必须是**登录态**的暗色：否则它证明不了"暗色下的身份区也画得出来"，
  // 而"暗色 + 掉登录"恰恰是刷新路径最容易同时坏掉的一对。
  await expectSignedIn(page, email);
  await page.screenshot({ path: SHOT('7-signed-in-dark') });
});

/**
 * 从服务端日志里取出**这一轮那一封**验证邮件里的链接；还没发出来时返回 `''`。
 *
 * 服务端在**没有** `SMTP_*` 时走 Ethereal 兜底，并把
 * `Preview URL: https://ethereal.email/message/…` 打进 stdout ——
 * 那是"这封信真的被交出去了"唯一的外部证据（`verify:password-chain` 用的是同一条）。
 *
 * 🔴 取**最后一条** preview 而不是第一条：日志是跨轮复用的文件，
 *    驱动虽然每次截断它，但同一轮里注册之外还可能有别的信（找回密码等）。
 *    "这一轮这个账号的信"这件事**不由这里判** —— 由 ①→④ 那对
 *    `0|t|f → 1|t|t` 判：点掉这条链接之后，**这个邮箱**变成已验证，
 *    所以它只能是这个账号的信。
 */
async function verifyLinkFromLog(): Promise<string> {
  const log = readFileSync(API_LOG(), 'utf8');
  const preview = /Preview URL: (\S+)/.exec(log)?.[1];
  if (!preview) return '';
  const res = await fetch(preview).catch(() => null);
  const raw = (await res?.text()) ?? '';
  // 🔴 预览页把正文内嵌时做了两层转义（`\u002f` 与 `&amp;`），不归一化就取不出链接。
  const html = raw.replace(/\\u002f/gi, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&');
  // 🔴 取**整条**链接，含 `&lang=`。原来这里写到 `token=[0-9a-f]+` 就停，
  //    于是导航的是一个**没有任何用户会打开的 URL**（少了发信时写进去的语言），
  //    确认页因此按浏览器语言渲染 —— 英文 chromium 上得到一整页英文，
  //    而真实收件人点开的从来都是带 `lang=zh-CN` 的那条。截参数 = 换被测对象。
  const all = html.match(/https?:\/\/[^"'\s\\]*\/verify-email\?token=[0-9a-f]+(?:&[^\s"'\\]*)?/g) ?? [];
  return all.at(-1) ?? '';
}
