import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { decidePrivacyConsent } from '../tests/helpers';
import { fillVaultSecret } from './privacy';

/**
 * 冲突对话框的真浏览器腿（全局 UX 线 P6 欠的那一格）
 * =====================================================
 *
 * `ConflictDialog` 在 P6 第二批里换上了 `WebModalShell`，但当时只有 jsdom 契约测
 * （`apps/web/tests/conflict-dialog.spec.tsx`）读过它 —— 而 §7 第 606 条刚教过：
 * **共享浮层原语在真浏览器里那一层可以根本没出现，而 jsdom 全绿、零报错**。
 * 所以这一格不补上读数，P6 就不许判完。
 *
 * ## 🔴 为什么这一条走的是"真路径"而不是注入
 *
 * 冲突不是能靠 `page.evaluate` 摆出来的东西：把 store 的 `status` 手改成 `conflict`
 * 等于装置自己造出被测物（needle 自证，量到的只是"我给的值渲染出来了"）。
 * 这里两台设备是**两个真浏览器 context**（各自一份 clientId / IndexedDB / vault 密钥），
 * 中间那次并发是**真离线**（`context.setOffline` —— 等价于合盖），
 * 判 CONCURRENT 的是**真服务端**，弹对话框的是产品自己的 `store.ts` 那条
 * `if (status.kind === 'conflict') set({ conflictDialogOpen: true })`。
 *
 * ## 三个前提，缺一个就被静默吃掉（写成注释免得后人以为"随便改改就冲突"）
 *
 *   ① 两条 op 的向量时钟真并发 —— 所以 A 改的那一下必须在**离线**期间发生，
 *      且它恢复在线后的那一趟是"先上传后下载"（`client.ts` 的顺序就是如此）；
 *   ② 两条 op 的 `timestamp` 差 ≤ 1 小时 —— `suggestConflictResolution` 超过一小时
 *      直接判时间戳新的那一边自动赢，**不看内容**（`conflict-resolution.ts` 那一档）；
 *   ③ 两条都得是 UPD —— 一边删一边改、或一边建一边改，也都被自动吃掉。
 *
 * ⚠️ 两侧内容**故意不同**（A 改名、B 勾选完成）：对话框的判据是"用户看得见两边分别是什么"，
 * 两边一样时那一格会渲染成空载荷，看图就读不出东西了。
 *
 * 跑法（环境由那枚既有的验收脚本起：真 PG + 真服务端 TEST_MODE + `vite preview`）：
 *   pnpm verify:vault-web -- vault/conflict-dialog.spec.ts
 */

const api = process.env['HEYTA_VAULT_TEST_SERVER'];
const evidence = fileURLToPath(new URL('../../apps/web/evidence/conflict-dialog-browser/', import.meta.url));
const passphrase = 'ux conflict browser passphrase';

type Credentials = { baseUrl: string; token: string; accountId: string; email: string };

/** 一枚"设备" = 一个独立 context（独立 clientId 与独立本机日志）。与 vault 套件同形：只预置登录态，不 mock 任何请求。 */
async function device(browser: Browser, credentials: Credentials) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.addInitScript((value) => localStorage.setItem('heyta.sync.credentials', JSON.stringify(value)), credentials);
  await page.goto('/?lang=en');
  await decidePrivacyConsent(page, 'accepted');
  return { context, page };
}

async function openSyncSettings(page: Page): Promise<void> {
  if (await page.getByTestId('settings-sheet').isVisible().catch(() => false)) {
    // 已经在浮层里，但可能停在别的节上（分节之后每一节都是 `hidden` 切换）
  } else {
    await page.getByTestId('account-menu-avatar').click();
    await page.getByTestId('account-menu-settings').click();
  }
  /*
   * 🔴 设置浮层现在是**分节**的：每一节 `<section hidden={active !== id}>`，
   * 所以"打开设置"之后 `sync-settings-panel` 一定在 DOM 里但**是 hidden** ——
   * 先点导航里那一节才画得出来。按 `aria-controls` 认，不按文案（语言中立）。
   * ⚠️ 同一枚失效让 vault 套件的两条既有测在当前 HEAD 上就红了（`ai-egress` 与本目录
   *    那条 three-device 报的是同一句"设置浮层里没有「同步」那一节"），已登记，不代改。
   */
  await page.locator('[aria-controls="settings-group-sync"]').click();
  const section = page.getByTestId('sync-settings-panel');
  await expect(section, '设置浮层里没有「同步」那一节（或点了导航也没切过去）').toBeVisible();
  await section.scrollIntoViewIfNeeded();
}

async function closeSettings(page: Page): Promise<void> {
  await page.getByTestId('settings-sheet-close').click();
  await expect(page.getByTestId('settings-sheet')).toHaveCount(0);
}

/** A 那台建库（建口令 + 确认恢复码），返回口令本身 —— B 那台用同一把口令解锁。 */
async function createVault(page: Page): Promise<void> {
  await openSyncSettings(page);
  await fillVaultSecret(page.getByTestId('vault-create-passphrase'), passphrase);
  await page.getByTestId('vault-create').click();
  const code = (await page.getByTestId('vault-recovery-display').textContent())!;
  await fillVaultSecret(page.getByTestId('vault-recovery-confirm'), code);
  await page.getByTestId('vault-publish').click();
  await expect(page.getByTestId('vault-ready')).toBeVisible();
  await closeSettings(page);
}

/** B 那台用同一把口令解锁 —— 这一步同时证明"两台设备能解同一份数据"，否则后面的冲突没有意义。 */
async function unlockVault(page: Page): Promise<void> {
  /*
   * 🔴 先同步一次才看得到密钥包：`hasPackage = session.keyPackage !== undefined`
   * （`VaultSettingsPanel.tsx:278`），而密钥包是**同步那一趟**从服务端取的。
   * 没同步就进设置，这一节画的是**建钥表单**（"Encryption passphrase" + "Create key"），
   * 不是解锁表单 —— 第一次跑就是红在这里（读数：`vault-unlock-form` 0 枚，
   * 快照里出现的是 create 那一档的标签）。
   */
  // 这一枚探针只回答一件事：客户端到底有没有向服务端要过那一枚包（要过而没拿到 ⇒ 服务端侧；
  // 一次都没要 ⇒ 客户端那道 `created` 闸）。读数打进日志，免得下一趟又靠猜。
  page.on('response', (response) => {
    if (response.url().includes('/api/sync/key-package')) {
      console.log(`KEYPACKAGE-GET status=${String(response.status())}`);
    }
  });
  await sync(page);
  /*
   * 🔴 刷新一次，让"第一次装配会话"这一步发生在**服务端已经有包**之后。
   * 依据在 `apps/web/src/lib/vault-session.ts:117-122`：向服务端要那一枚包
   * （`refreshFromRemote`）只发生在**创建那一枚会话的那一次装配**里 —— 本机启动时
   * 若先被别的路径（同步条 / 头像密钥）装配走了会话，面板再拿到的就是"已存在的那一枚"，
   * 而它的 `keyPackage` 是空的 ⇒ 那一节画出来的是建钥表单。
   * 刷新是真人会做的动作，不是夹具后门。
   */
  await page.reload();
  await decidePrivacyConsent(page, 'accepted');
  await openSyncSettings(page);
  await expect(page.getByTestId('vault-unlock-form'), '这台设备没看到已发布的密钥包').toBeVisible();
  await fillVaultSecret(page.getByTestId('vault-passphrase'), passphrase);
  await page.getByTestId('vault-unlock').click();
  await expect(page.getByTestId('vault-ready')).toBeVisible();
  await closeSettings(page);
}

async function sync(page: Page): Promise<void> {
  await page.getByTestId('sync-rail-action').click();
}

/**
 * 选中列表里第一条 ⇒ 宽档右侧那一格换成它的面单。
 *
 * 走 `task-row-*`（标题那一格）而不是整行：`detail-pane-task.spec.ts` 的现量教训是
 * 行尾面板展开时整行会被拦截，先 `parkCursor` 把鼠标挪开才点得到。
 */
async function selectFirstTask(page: Page): Promise<void> {
  await page.mouse.move(1100, 940);
  await page.waitForTimeout(120);
  await page.locator('[data-testid^="task-row-"]').first().click();
  await expect(page.getByTestId('task-detail-title'), '点了行之后栏里没出现面单').toBeVisible();
}


test('两台设备并发改同一条任务：冲突对话框在真浏览器里出现、两边内容并排、保留一边后两台收敛', async ({ browser, request }) => {
  test.setTimeout(300_000);
  if (!api) throw new Error('用 `pnpm verify:vault-web -- vault/conflict-dialog.spec.ts` 起环境');
  await mkdir(evidence, { recursive: true });

  const email = `ux-conflict-${Date.now()}@test.local`;
  const created = await request.post(`${api}/api/test/create-user`, { data: { email, password: 'Auth-test-only-928!' } });
  expect(created.status()).toBe(201);
  const account = (await created.json()) as { token: string; userId: number };
  const credentials: Credentials = { baseUrl: api, token: account.token, accountId: String(account.userId), email };

  const a = await device(browser, credentials);
  await createVault(a.page);
  const title = `ux conflict task ${Date.now()}`;
  await a.page.locator('input[placeholder^="Add a task"]').fill(title);
  await a.page.locator('input[placeholder^="Add a task"]').press('Enter');
  await sync(a.page);
  /*
   * 🔴 等密钥包真的落到服务端再叫第二台进场。前两趟都红在 B 那台看到的是**建钥表单**
   * 而不是解锁表单（快照读数：状态条写着"No end-to-end encryption password was set"、
   * 那一节画的是 `Create key`）—— 也就是 B 还没东西可解。这里不猜"应该传上去了"，
   * 直接向服务端要那一枚包（与 vault 套件轮询 `key-migration/inventory` 同一味道）。
   */
  await expect
    .poll(
      async () =>
        (
          await request.get(`${api}/api/sync/key-package`, {
            headers: { authorization: `Bearer ${account.token}` },
          })
        ).status(),
      'A 建的密钥包没在服务端出现 ⇒ 第二台没有东西可解',
    )
    .toBe(200);

  const b = await device(browser, credentials);
  await unlockVault(b.page);
  await sync(b.page);
  await expect(b.page.getByText(title, { exact: true }).first(), 'B 没拉到 A 建的那条任务').toBeVisible();

  // 对照臂：并发之前，这一层不许已经在 DOM 里（否则"对话框出现了"这句恒真）。
  await expect(a.page.getByTestId('conflict-dialog')).toHaveCount(0);

  // ① A 离线改标题（op 只进本机队列）
  await a.context.setOffline(true);
  await selectFirstTask(a.page);
  await a.page.getByTestId('task-detail-title').click();
  await a.page.getByTestId('task-detail-title-input').fill(`${title}（A 台改的）`);
  await a.page.keyboard.press('Enter');
  await expect(a.page.getByTestId('task-detail-title')).toHaveText(`${title}（A 台改的）`);

  /* ② B 在线把**同一条**改成**另一个**标题并先传上去 ⇒ 服务端最新那条来自 B。
     ⚠️ 两侧都用改名、不用"一边改名一边勾选"：勾选会把那条推出默认视图（完成态被收起），
     后面读收敛时"列表里没有"就分不清是没收敛还是被收起来了 —— 上一趟正是这个形状。
     两边都是 UPD 也才落在 `suggestConflictResolution` 判 manual 的那一档。 */
  await selectFirstTask(b.page);
  await b.page.getByTestId('task-detail-title').click();
  await b.page.getByTestId('task-detail-title-input').fill(`${title}（B 台改的）`);
  await b.page.keyboard.press('Enter');
  await expect(b.page.getByTestId('task-detail-title')).toHaveText(`${title}（B 台改的）`);
  await sync(b.page);

  // ③ A 恢复在线再同步：上传被服务端判 CONCURRENT → 下载 → 自动解不开 → 弹对话框
  await a.context.setOffline(false);
  await sync(a.page);
  const dialog = a.page.getByTestId('conflict-dialog');
  await expect(dialog, 'A 同步完没有出现冲突对话框（并发被判成可自动解决？还是这一层没画出来？）').toBeVisible();
  await expect(a.page.getByRole('dialog'), '对话框不在壳里：真浏览器里没有 role=dialog').toHaveCount(1);
  await a.page.screenshot({ path: `${evidence}conflict-dialog-1280-light.png` });

  // 两边内容并排：这一句是"用户看得见两边分别是什么"的现量，不是"有个框"。
  const body = await dialog.textContent();
  expect(body ?? '', '对话框里没有本机那一侧的标题').toContain(`${title}（A 台改的）`);
  expect(body ?? '', '对话框里没有对端那一侧的标题').toContain(`${title}（B 台改的）`);
  const keep = dialog.getByRole('button', { name: /Keep this|保留这一版/u });
  expect(await keep.count(), '每一侧都要有一枚"保留这一版"').toBeGreaterThanOrEqual(2);

  await keep.first().click();
  await expect(dialog, '选完一边之后对话框还开着').toHaveCount(0);

  /* 🔴 选完不算完：那一条"按本机这一版重写"的 op 走的是**正常上传队列**，
     要 A 再同步一次才进服务端历史，B 再拉一次才看得见。上一趟 B 读不到 A 那一版，
     红因就是这个 —— 产品从没有承诺"点一下就把对端推平"。 */
  await sync(a.page);
  await sync(b.page);

  // 收敛：B 列表里那一行必须变成 A 保留的那一版 —— 这一句才把"选了"变成"生效了"。
  // 读数吐的是 B 那台**实际**有的行文字：再红也能一眼分清"没收敛"与"被视图收起来了"。
  await expect
    .poll(
      async () => (await b.page.locator('[data-testid^="task-item-"]').allTextContents()).join(' ⏐ '),
      'B 同步之后列表里没有 A 保留的那一版标题 ⇒ "保留这一版"没真落进数据',
    )
    .toContain(`${title}（A 台改的）`);
  await b.page.screenshot({ path: `${evidence}converged-on-b-1280-light.png` });

  for (const { context } of [a, b]) await context.close();
});
