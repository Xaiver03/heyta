/**
 * 三端验收的公共步骤（真浏览器，真服务端）。
 * ==========================================
 *
 * 这些用例**故意不在** `e2e/tests/` 里 —— 那个目录由离线的
 * `playwright.config.ts` 驱动并挂在 `pnpm check` 上。放在这里，
 * 就只会由 `pnpm verify:multi-end`（及其 shell 脚本）拉起。
 *
 * 🔴 **凭据一律走环境变量，且必须显式检查非空。**
 * 少了这一步，一个忘了导出变量的运行会**安静地**变成"配了空地址、同步没发生、
 * 断言却都在看本地数据"，然后部分通过 —— 那比直接报错危险得多。
 */

import { expect, type Locator, type Page } from '@playwright/test';
import { openApp as openSharedApp } from '../tests/helpers';

export const SERVER = process.env['HEYTA_SYNC_SERVER'] ?? '';
export const TOKEN = process.env['HEYTA_SYNC_TOKEN'] ?? '';
export const PASSWORD = process.env['HEYTA_SYNC_PASSWORD'] ?? '';

/** 缺口令时同步会被服务端拒绝（服务端只接受端到端加密的载荷）。 */
export function requireCredentials(): void {
  const missing = [
    ['HEYTA_SYNC_SERVER', SERVER],
    ['HEYTA_SYNC_TOKEN', TOKEN],
    ['HEYTA_SYNC_PASSWORD', PASSWORD],
  ]
    .filter(([, value]) => value === '')
    .map(([name]) => String(name));

  if (missing.length > 0) {
    throw new Error(
      `缺环境变量：${missing.join('、')} —— ` +
        '这个套件必须由 `scripts/verify-multi-end-sync.sh` 启动（它会建一个新账号并把凭据传进来）。',
    );
  }
}

/**
 * 打开真应用，等输入框真的可见（白屏不算通过）。
 *
 * 🔴 转接 `e2e/tests/helpers` 那一份共享入口，为的是两件**探针**的事：
 *   · **钉中文**：这一套的定位符（`添加任务` 的 placeholder、`服务端地址` /
 *     `访问令牌` / `端到端加密口令` 三个标签、rail 上那句状态文案）全是中文，
 *     而 Playwright 的 Chromium 报 `en-US` ⇒ 界面变英文，
 *     红的是"找不到元素"，长得像产品坏了；
 *   · **做完首启隐私同意**：`consent-gate.ts` 换掉的是整个 `window.fetch`，
 *     `local-only` 之下连自建服务器的请求都发不出去 —— 而这套件判的就是
 *     "真的同步上去了"。所以这里**必须**答 `accepted`：那条旅程测的是
 *     同意联网之后的行为，不是"不同意时一个字节都不出进程"（那由
 *     `privacy-consent-zero-egress.spec.ts` 专门判）。
 */
export async function openApp(page: Page): Promise<void> {
  await openSharedApp(page, '/', 'accepted');
}

/**
 * 同步那一枚所在的容器（rail 底部）。
 *
 * 🔴 **用容器 testID 定位，不用 `getByRole('status')` 裸取** —— 应用里还有别的
 * live region（`SubscriptionNotice`、以及 设置 → 同步 那一节里的共享状态条
 * 都是 `role="status"`），裸取会撞上 strict mode。
 *
 * 理由跟着 H9 第 1 刀改写过：以前判的是"**那个拥有「立即同步」按钮的**状态区"
 * （结构上唯一），而现在 rail 上那枚按钮的 aria-label 是整句状态、
 * 「立即同步」这个词在真应用里**根本不存在**（只剩落地页假窗口用它的词条），
 * 所以那条 `has:` 过滤器恒不命中。现在的"结构上唯一"来自 testID 本身，
 * 而整句状态文案（「未同步」「已同步」「离线」…）常驻在这个容器里
 * —— 读数和搬家前那枚 `div[role="status"]` 是同一件事。
 */
export function statusBar(page: Page) {
  return page.getByTestId('sync-rail');
}

/**
 * 打开 **设置 → 同步** 那一节，返回它的定位符。
 *
 * 🔴 H9 第 3 刀（2026-10-06）之后「同步设置」不再是 rail 齿轮点开的同级对话框，
 * 而是设置浮层里的**一节**：`SyncSettingsPanel.tsx` 是个带 `aria-label` 的
 * `<section>` ⇒ 可访问角色是 **region**，`getByRole('dialog', { name: '同步设置' })`
 * 从此恒不命中（而裸 `getByRole('dialog')` 会命中设置浮层，语义完全变了）。
 * 真实用户路径只剩头像 → 设置这一条，那颗齿轮（`sync-settings-entry`）随这一刀删掉了。
 *
 * ⚠️ 必须 `scrollIntoViewIfNeeded()`：设置浮层是可滚动的长列表，这一节不保证在
 * 第一屏，不滚就点不到也拍不到。
 *
 * 🔴 这一份是**本套件自己的** helper，没有去 `import` `e2e/tests/helpers.ts`
 * 里那份同名的 `openSettingsView` —— 那是另一个 testDir、另一份 config，
 * 两套夹具接起来会让离线套件的改动连带改红这一套。
 */
async function openSyncSection(page: Page): Promise<Locator> {
  await page.getByTestId('account-menu-avatar').click();
  await page.getByTestId('account-menu-settings').click();
  const section = page.getByTestId('sync-settings-panel');
  await expect(section, '设置浮层里没有「同步」那一节').toBeVisible();
  await section.scrollIntoViewIfNeeded();
  return section;
}

/** 退出设置浮层：走它自己的 ✕，不在普通视图里凭空按 Esc。 */
async function closeSettingsSheet(page: Page): Promise<void> {
  await page.getByTestId('settings-sheet-close').click();
  await expect(page.getByTestId('settings-sheet'), '设置浮层没关上').toHaveCount(0);
}

/** 在 设置 → 同步 那一节里填好三个字段并保存（保存会顺带触发一次同步）。 */
export async function configureSync(page: Page): Promise<void> {
  const section = await openSyncSection(page);

  await section.getByLabel('服务端地址').fill(SERVER);
  await section.getByLabel('访问令牌').fill(TOKEN);
  // 🔴 这一套**用得起** legacy 那个 label，而 `../auth-journey/helpers.ts` 用不起：
  // 本套件从不走托管登录（就是手填地址 + 粘令牌），`sync.accountId` 一直是空
  // ⇒ `SyncSettingsPanel.tsx:137` 的 `!vaultMode` 那块在屏上。别"顺手统一"成钥匙档的
  // testid —— 那会等一个本套件根本不会出现的表单。
  await section.getByLabel('端到端加密口令').fill(PASSWORD);

  // 「保存并同步」= configure() + closeSettings() + syncNow()
  await section.getByRole('button', { name: '保存并同步' }).click();
  // 🔴 旧写法在这一行之后断 `expect(dialog).toBeHidden()`：那时它是自己的对话框，
  // 保存会关掉它，所以"关掉了"顺带证明"这个点击被产品接住了"。现在这一节住在
  // 设置浮层里，保存**不再关任何东西**（`closeSettings()` 只撤掉"请把界面落到
  // 这一节"的请求），那条断言没有载体了。口径没变的那一半仍在：
  // 「凭据已写入、同步真的跑过一轮」由各调用点紧随其后的 rail『已同步』断言来证
  // （`syncNow()`，01-web-up / 02-web-down 都是这个形状），这里不把它吞进来重复等，
  // 否则两处各等一次、红的时候分不清是谁没到。
  await closeSettingsSheet(page);
  await expect(
    section,
    '关掉设置之后那一节还在 DOM 里 ⇒ 它其实是常驻浮层，不是设置的一部分',
  ).toHaveCount(0);
}

/**
 * 按 rail 那枚同步按钮并等到状态变成「已同步」。
 *
 * 🔴 H9 第 1 刀之后没有单独的「立即同步」按钮了：rail 底部**只有这一枚**，
 * 状态是「冲突」时它的点击语义会变成打开冲突对话框（判据在共享层
 * `syncStatusAffordances`），所以这一条只在"没有待处理冲突"时才是"再同步一次"。
 *
 * ⚠️ 「未同步」不包含「已同步」，所以 `toContainText('已同步')` 是可靠的 ——
 * 但**不包含"真的拉到了东西"**。那一条只能由服务端/另一台设备来证，
 * 所以本文件里的每个用例都由 shell 脚本在外部再交叉验证一次。
 */
export async function syncNow(page: Page): Promise<void> {
  await page.getByTestId('sync-rail-action').click();
  await expect(statusBar(page)).toContainText('已同步');
}

/**
 * 按标题定位任务行（与离线套件同一套选择器）。
 *
 * 🔴 `task-item-*` 是共享 `TaskList` 打在外层行上的 testID（整行，含行尾
 * 插槽）—— web 手写的 `.ht-task` 已随 M3 第一刀删除。
 */
export function rowFor(page: Page, title: string) {
  return page.locator('[data-testid^="task-item-"]').filter({ hasText: title });
}

/** 侧栏「清单与标签」面板。 */
export function sidebar(page: Page) {
  return page.locator('aside[aria-label="清单与标签"]');
}

/**
 * 任务行右侧的元信息区（清单归属 / 截止时间 / 优先级徽标）。
 *
 * 🔴 清单归属**只有这一个显示位**：行尾那枚清单 chip 已随"归属进共享槽"删除，
 * 留着它同一行里会出现两遍清单名（见 `apps/web/src/features/tasks/TaskOrganizer.tsx`）。
 */
export function metaFor(page: Page, title: string) {
  return rowFor(page, title).locator('[data-testid="task-meta"]');
}