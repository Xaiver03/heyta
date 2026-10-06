import { fillVaultSecret } from './privacy';
/** Real vault, UI, encrypted HTTP/PG and an observing HTTP model endpoint.
 * The endpoint returns a deterministic response; it never receives a vault key.
 * Traces/video are disabled by playwright.vault.config.ts. Captured requests and
 * synthetic secrets remain in memory; failures expose only boolean predicates.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  unlockVaultWithPassphrase, deriveVaultFeatureKey,
} from '../../packages/sync-core/dist/index.mjs';
import {
  enableAllModules, pinChineseUi, decidePrivacyConsent, addTask, rowFor,
  switchView, configureEndpoint, CAP_STRUCTURED_OUTPUT, CAP_LONG_CONTEXT,
} from '../tests/helpers.js';

/**
 * 进 **设置 → 同步** 那一节（工单 H9 第 3 刀，2026-10-06 之后的形状）。
 *
 * 🔴 「同步设置」不再是 rail 齿轮点开的同级对话框，而是设置浮层里的**一节**：
 * `SyncSettingsPanel.tsx` 是个带 `aria-label` 的 `<section>` ⇒ 可访问角色是
 * **region**，`getByRole('button', { name: '同步设置' })` 与
 * `getByRole('dialog', { name: '同步设置' })` 从此都不再命中。
 * 唯一路径是头像 → 设置（只走 testID ⇒ 语言中立）；这一节住在可滚动的长列表里，
 * 不先 `scrollIntoViewIfNeeded()` 就点不到密钥表单。
 * 本套件自己的 helper，不借用 `e2e/tests/helpers.ts` 那份 —— 不同 testDir、
 * 不同 config，两套夹具接起来会让离线套件的改动连带改红这一套。
 */
async function openSyncSection(page: Page): Promise<Locator> {
  await page.getByTestId('account-menu-avatar').click();
  await page.getByTestId('account-menu-settings').click();
  const section = page.getByTestId('sync-settings-panel');
  await expect(section, '设置浮层里没有「同步」那一节').toBeVisible();
  await section.scrollIntoViewIfNeeded();
  return section;
}

/** 退出设置浮层：旧的「关闭同步设置」✕ 随 H9 第 3 刀一起没了。 */
async function closeSyncSettings(page: Page): Promise<void> {
  await page.getByTestId('settings-sheet-close').click();
  await expect(page.getByTestId('settings-sheet')).toHaveCount(0);
}

test('unlocked vault exports only the disclosed task fields to the breakdown provider', async ({ browser, request }) => {
  const api = process.env['HEYTA_VAULT_TEST_SERVER'];
  if (!api) throw new Error('Run scripts/verify-vault-web-journey.mjs');
  const evidence = fileURLToPath(new URL('../../apps/web/evidence/vault-panel/', import.meta.url));
  await mkdir(evidence, { recursive: true });
  const captured: { body: string; headers: string }[] = [];
  const provider = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:4346');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
    let body = '';
    for await (const chunk of req) body += chunk;
    captured.push({ body, headers: JSON.stringify(req.headers) });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '- 第一项\n- 第二项\n- 第三项' } }] }));
  });
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const port = (provider.address() as { port: number }).port;
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  // Do not print console messages: a broken egress boundary could put secrets in them.
  let pageErrors = 0;
  page.on('pageerror', () => { pageErrors++; });
  const keyBytes: Uint8Array[] = [];
  try {
    const email = `vault-egress-${Date.now()}@test.local`;
    const authPassword = 'Auth-test-only-928!';
    const created = await request.post(`${api}/api/test/create-user`, { data: { email, password: authPassword } });
    expect(created.status()).toBe(201);
    const account = await created.json() as { token: string; userId: number };
    const headers = { authorization: `Bearer ${account.token}` };
    await page.addInitScript((credentials) => localStorage.setItem('heyta.sync.credentials', JSON.stringify(credentials)), {
      baseUrl: api, token: account.token, accountId: String(account.userId), email,
    });
    await enableAllModules(page);
    await pinChineseUi(page);
    await page.goto('/');
    await decidePrivacyConsent(page, 'accepted');
    await openSyncSection(page);
    const passphrase = 'synthetic egress vault passphrase';
    await fillVaultSecret(page.getByTestId('vault-create-passphrase'), passphrase);
    await page.getByTestId('vault-create').click();
    await expect(page.getByTestId('vault-recovery-display')).toBeVisible();
    const recovery = (await page.getByTestId('vault-recovery-display').textContent())!;
    await fillVaultSecret(page.getByTestId('vault-recovery-confirm'), recovery);
    await page.getByTestId('vault-publish').click();
    await expect(page.getByTestId('vault-ready')).toBeVisible();
    await closeSyncSettings(page);

    const target = 'DISCLOSED_TARGET_TASK';
    const unrelated = 'UNDISCLOSED_OTHER_TASK';
    const habit = 'UNDISCLOSED_HABIT';
    await addTask(page, target);
    await addTask(page, unrelated);
    await switchView(page, '习惯');
    const input = page.getByPlaceholder('新习惯，例如「喝水」');
    await input.fill(habit); await input.press('Enter');
    await expect(page.locator('[data-testid^="habit-row-"]').filter({ hasText: habit })).toBeVisible();
    await switchView(page, '番茄钟');
    await page.getByRole('button', { name: '开始专注', exact: true }).click();
    await expect(page.getByRole('button', { name: '暂停专注', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '中止', exact: true }).click();
    await switchView(page, '任务');
    // 🔴 H9 第 1 刀之后没有「立即同步」那颗按钮了：rail 底部只剩**同一枚**，
    // 状态是「冲突」时它的点击语义才会改成打开冲突对话框（判据在共享层
    // `syncStatusAffordances`）。这一趟前面没有任何冲突写入，所以它仍是"再同步一次"。
    await page.getByTestId('sync-rail-action').click();
    // Positive controls: excluded entities really exist in the same encrypted vault.
    const vaultHeader = Buffer.from('heyta-vault-op/\x01', 'ascii');
    await expect.poll(async () => {
      const response = await request.get(`${api}/api/sync/key-migration/inventory`, { headers });
      if (response.status() !== 200) return false;
      const inventory = await response.json() as { operations: { entityType: string; payload: string }[] };
      return ['TASK', 'HABIT', 'FOCUS_SESSION'].every((entityType) =>
        inventory.operations.some((op) => op.entityType === entityType && typeof op.payload === 'string' &&
          Buffer.from(op.payload, 'base64').subarray(0, vaultHeader.length).equals(vaultHeader)));
    }).toBe(true);
    const packageResponse = await request.get(`${api}/api/sync/key-package`, { headers });
    expect(packageResponse.status()).toBe(200);
    const active = await packageResponse.json();
    const root = await unlockVaultWithPassphrase(active.package, passphrase);
    keyBytes.push(root);
    for (const purpose of ['sync', 'ai-task-planning', 'ai-feedback'] as const) {
      keyBytes.push(deriveVaultFeatureKey(root, purpose, active.payloadKeyVersion));
    }
    const forbidden = [authPassword, email, passphrase, recovery, account.token, unrelated, habit, 'FOCUS_SESSION',
      ...keyBytes.flatMap((key) => [Buffer.from(key).toString('base64'), Buffer.from(key).toString('hex'), JSON.stringify([...key])])];
    await configureEndpoint(page, { endpoint: `http://127.0.0.1:${port}/v1`,
      capabilities: [CAP_STRUCTURED_OUTPUT, CAP_LONG_CONTEXT], features: ['breakdown'] });
    await switchView(page, '任务');
    await rowFor(page, target).locator('[data-testid^="ai-breakdown-"]').click();
    await page.screenshot({ path: `${evidence}pg-ai-egress-disclosure.png` });
    await expect(page.getByTestId('ai-field-list')).toHaveText('title');
    expect(captured.length).toBe(0);
    await page.getByTestId('ai-send').click();
    await expect(page.getByTestId('ai-proposal')).toBeVisible();
    await page.screenshot({ path: `${evidence}pg-ai-egress-result.png` });
    expect(captured.length).toBe(1);
    const wire = JSON.parse(captured[0]!.body);
    expect(Object.keys(wire).sort()).toEqual(['messages', 'model']);
    expect(wire.messages.length).toBe(2);
    expect(wire.messages[1]?.role).toBe('user');
    expect(wire.messages[1]?.content === `任务标题：${target}`,
      'the user message must contain exactly the disclosed title').toBe(true);
    expect(captured[0]!.body.includes(target), 'disclosed target must reach provider').toBe(true);
    expect(forbidden.some((secret) => Object.values(captured[0]!).some((part) => part.includes(secret))),
      'undisclosed entities and vault/auth secrets must stay out of provider body and headers').toBe(false);
    const providerHeaders = JSON.parse(captured[0]!.headers) as Record<string, string>;
    expect(providerHeaders.authorization === 'Bearer stub-key', 'only the provider credential may be sent').toBe(true);
    expect(Object.keys(providerHeaders).some((key) => /^(cookie|x-(?:heyta|sync)|x-auth)/iu.test(key)),
      'application session headers must not reach provider').toBe(false);
    expect(pageErrors).toBe(0);
  } catch (error) {
    // Mask every vault input even when an earlier creation step failed.
    await page.screenshot({ path: `${evidence}pg-ai-egress-failure.png`, mask: [
      page.locator('input'), page.getByTestId('vault-recovery-display'),
    ] }).catch(() => undefined);
    throw error;
  } finally {
    for (const key of keyBytes) key.fill(0);
    captured.length = 0;
    await context.close();
    await new Promise<void>((resolve, reject) => provider.close((error) => error ? reject(error) : resolve()));
  }
});
