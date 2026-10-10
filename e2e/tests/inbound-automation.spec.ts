/** Real browser/UI with HTTP fixtures; database authorization is tested separately. */
import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { openApp, openSettingsSheet, selectSettingsSection, stubLegalRecheck, stubPublicFacts } from './helpers';
const server = 'http://sync.inbound.e2e.test';
const evidence = '../apps/web/evidence/inbound-recovery';
for (const width of [1280, 390]) {
  test(`encrypted date draft review and Vault invalidation ${width}`, async ({ page }) => {
    const { sealInbound } = await import('../../packages/inbound-core/dist/index.js');
    const { prepareInboundAutomationResult } = await import('../../packages/inbound-core/dist/index.js');
    await page.setViewportSize({ width, height: 900 });
    await mkdir(evidence, { recursive: true });
    await stubLegalRecheck(page); await stubPublicFacts(page);
    await page.addInitScript((baseUrl) => localStorage.setItem('heyta.sync.credentials', JSON.stringify({ baseUrl,
      token: 'fixture-token', accountId: '1', email: 'draft-fixture@example.test' })), server);
    const ruleId = '11111111-1111-4111-8111-111111111111';
    const eventId = 'date-draft';
    let recipient: any;
    let snapshot: any;
    let state = 'needs-confirmation';
    const decisions: any[] = [];
    await page.route(`${server}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = {}; let status = 200;
      if (path.endsWith('/automation/rules')) body = { rules: [{ id: ruleId, version: 1, enabled: true, keyId: 'hook',
        createdAt: '2026-10-08T00:00:00Z', deletedAt: null, allowedFields: ['title', 'dueDate'], targetProjectId: null,
        timezone: 'Asia/Shanghai', parseVersion: 1, authorizationVersion: 1, maxItems: 2 }] };
      else if (path.endsWith('/automation/events')) body = { events: snapshot ? [{ eventId, ruleId, ruleVersion: 1,
        status: state, reasonCode: state === 'needs-confirmation' ? 'needs-confirmation' : null, attempt: 1, receivedAt: 1_700_000_000_000 }] : [] };
      else if (path.endsWith(`/${eventId}/draft`)) body = snapshot;
      else if (path.endsWith(`/${eventId}/draft/decision`)) {
        const decision = route.request().postDataJSON(); decisions.push(decision);
        expect(Object.keys(decision).sort()).toEqual(['decision', 'expectedAttempt', 'expectedDigest', 'expectedRuleVersion',
          'resultCiphertext', 'resultDigest', 'resultItemCount'].sort());
        expect(JSON.stringify(decision)).not.toContain('Corrected draft');
        state = 'prepared'; body = { eventId, state };
      } else if (path.endsWith('/recipient-key')) {
        if (route.request().method() === 'PUT') {
          const input = route.request().postDataJSON(); recipient = { keyEpoch: input.keyEpoch, publicKey: input.publicKey, packageVersion: input.packageVersion };
        }
        if (recipient) body = recipient; else status = 404;
      } else if (path.endsWith('/key-package')) status = 404;
      else if (path.endsWith('/devices')) body = { devices: [] };
      else if (path.endsWith('/ops')) body = { ops: [], hasMore: false, latestSeq: 0 };
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await openApp(page, '/?lang=zh-CN', 'accepted');
    // Synthetic unlocked account fixture uses the production Vault and key store.
    // No UI/runtime mocks: draft encryption/decryption occurs in the real browser.
    await page.evaluate(async (baseUrl) => {
      const vault = await import('/src/lib/vault-session.ts');
      const runtime = await import('/src/features/settings/inbound-runtime.ts');
      const session = await vault.getWebVaultSession('1', baseUrl, async () => 'fixture-token');
      const pending = await session.beginCreation('synthetic-fixture-passphrase');
      await session.confirmAndPublish(pending, pending.recoveryCode);
      await runtime.ensureWebInboundRecipientKey({ accountId: '1', baseUrl, token: 'fixture-token' });
    }, server);
    const frozen = prepareInboundAutomationResult({ eventId, ruleId, ruleVersion: 1, parseVersion: 1, receivedAt: 1,
      timezone: 'Asia/Shanghai', modelResult: { tasks: [{ title: 'Draft to review', dueDate: '2026-02-30' }] } });
    const ciphertext = await sealInbound(new TextEncoder().encode(JSON.stringify(frozen.payload)), recipient.publicKey.replace(/-/g, '+').replace(/_/g, '/') + '=',
      { accountId: 'user-1', serverOrigin: server, eventId, ruleId, purpose: 'result', keyEpoch: recipient.keyEpoch });
    snapshot = { eventId, ruleId, ruleVersion: 1, parseVersion: 1, attempt: 1,
      resultDigest: frozen.resultDigest, resultItemCount: 1, resultCiphertext: JSON.stringify(ciphertext) };
    await openSettingsSheet(page); await selectSettingsSection(page, 'ai');
    const row = page.getByTestId(`inbound-event-${eventId}`);
    await row.getByRole('button', { name: '查看并编辑草稿', exact: true }).click();
    const editor = row.getByTestId('inbound-draft-editor');
    await expect(editor).toBeVisible();
    await expect(editor.locator('input').first()).toHaveValue('Draft to review');
    expect(decisions).toHaveLength(0);
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      await editor.scrollIntoViewIfNeeded();
      expect(await editor.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await editor.screenshot({ path: `${evidence}/draft-${width}-${theme}.png` });
    }
    await editor.locator('input').first().fill('Corrected draft');
    await editor.getByLabel('截止时间', { exact: true }).fill('2026-10-08');
    await editor.getByRole('button', { name: '确认创建这些任务', exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ decision: 'confirm', expectedDigest: snapshot.resultDigest, expectedAttempt: 1, expectedRuleVersion: 1 });
    state = 'needs-confirmation';
    await selectSettingsSection(page, 'sync'); await selectSettingsSection(page, 'ai');
    await row.getByRole('button', { name: '查看并编辑草稿', exact: true }).click();
    await expect(editor).toBeVisible();
    await page.evaluate(async (baseUrl) => {
      const vault = await import('/src/lib/vault-session.ts');
      (await vault.getWebVaultSession('1', baseUrl, async () => 'fixture-token')).lock();
    }, server);
    await expect(editor).toHaveCount(0);
    expect(decisions).toHaveLength(1);
  });
}
for (const width of [1280, 390]) {
  test(`inbound explicit retry and themes ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mkdir(evidence, { recursive: true });
    await stubLegalRecheck(page); await stubPublicFacts(page);
    await page.addInitScript((baseUrl) => localStorage.setItem('heyta.sync.credentials', JSON.stringify({ baseUrl, token: 'fixture-token', accountId: 'inbound-ui-account', email: 'fixture@example.test' })), server);
    let state = 'needs-confirmation'; let retries = 0;
    await page.route(`${server}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = {};
      let status = 200;
      if (path.endsWith('/automation/rules')) body = { rules: [] };
      else if (path.endsWith('/automation/events')) body = { events: [{ eventId: 'event-recovery', ruleId: 'rule', ruleVersion: 1,
        status: state, reasonCode: state === 'needs-confirmation' ? 'model-result-uncertain' : null, attempt: 1, receivedAt: 1_700_000_000_000 }] };
      else if (path.endsWith('/event-recovery/retry')) {
        expect(route.request().postDataJSON()).toEqual({ expectedAttempt: 1, expectedRuleVersion: 1 });
        retries++; state = 'queued'; body = { eventId: 'event-recovery', state };
      } else if (path.endsWith('/key-package') || path.endsWith('/recipient-key')) status = 404;
      else if (path.endsWith('/devices')) body = { devices: [] };
      else if (path.endsWith('/ops')) body = { ops: [], hasMore: false, latestSeq: 0 };
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await openApp(page, '/?lang=zh-CN', 'accepted');
    await openSettingsSheet(page); await selectSettingsSection(page, 'ai');
    const row = page.getByTestId('inbound-event-event-recovery');
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '重新解析', exact: true }).click();
    await expect(row).toContainText('可能已计费');
    expect(retries).toBe(0);
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      const form = page.getByTestId('inbound-automation-settings').locator('.ht-inbound__group').first();
      await form.scrollIntoViewIfNeeded();
      // No horizontal overflow alone does not catch text squeezed vertically.
      for (const input of await form.locator('.ht-settings__input').all()) {
        expect((await input.boundingBox())!.width).toBeGreaterThan(200);
      }
      for (const label of await form.locator('.ht-inbound__check').all()) {
        const geometry = await label.boundingBox();
        expect(geometry!.width).toBeGreaterThan(45);
        expect(geometry!.height).toBeLessThan(60);
      }
      await form.screenshot({ path: `${evidence}/form-${width}-${theme}.png` });
      await row.scrollIntoViewIfNeeded();
      const bounds = await row.evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth }));
      expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1);
      expect((await row.locator('strong').boundingBox())!.height).toBeLessThan(40);
      await page.screenshot({ path: `${evidence}/retry-${width}-${theme}.png` });
    }
    await row.getByRole('button', { name: '取消', exact: true }).click();
    expect(retries).toBe(0);
    await row.getByRole('button', { name: '重新解析', exact: true }).click();
    await row.getByRole('button', { name: '确认重新解析', exact: true }).click();
    await expect(row).toContainText('等待处理设备');
    expect(retries).toBe(1);
  });
}
