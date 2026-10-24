/** Real browser/UI with HTTP fixtures; database authorization is tested separately. */
import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { assertFormRhythm, openApp, openSettingsSheet, selectSettingsSection, stubLegalRecheck, stubPublicFacts } from './helpers';
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
      // 🔴 2026-10-24：选择器从 `.ht-settings__input` 改成**共享原语**那一族。
      //    那个类**全仓没有定义**（九个字段因此渲成 UA 默认的 ≈22px），
      //    而按它取的循环在迁移之后会迭代 **0 次** —— 一条永远通过的判据。
      //    现在改用量几何的 helper：既量宽度，也量"只有一档高度、且 ≥44"。
      const inputs = form.locator('input:not([type="checkbox"]):not([type="radio"]), textarea');
      for (const input of await inputs.all()) {
        expect((await input.boundingBox())!.width).toBeGreaterThan(200);
      }
      await assertFormRhythm(form);
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

/**
 * 自动收集设置面板的**排版取证**（负责人 2026-10-11 指令：由我以产品经理身份定排版）。
 * 判据全是真浏览器里的计算样式与几何，不是 DOM 类名字符串：
 * 层级（面板标题 > 事件区分节标题）、事件区的分隔线、一次性凭据卡与它所属规则卡的从属、
 * 删除按钮的危险色、错误行与提示行的色差。
 * 🔴 夹具里那枚 once-code 是合成值，不属于任何账号；截图里出现的也只有它。
 */
for (const width of [1280, 390]) {
  test(`inbound settings panel layout evidence ${width}`, async ({ page }) => {
    // 视口给到 2200：面板在 390 下约 1389 高，视口不够时 Playwright 会**滚动拼接**，
    // 而设置浮层的吸顶头会被拼进图里（本轮就是这样先"看图判出一条窄屏裁切缺陷"，
    // 逐元素量出来 offenders 为空、面板右缘 358 ≤ 390 —— 那条缺陷不存在，是探针被污染）。
    await page.setViewportSize({ width, height: 2200 });
    const evidence = '../docs/research/evidence/inbound-automation-review/panel-layout';
    await mkdir(evidence, { recursive: true });
    await stubLegalRecheck(page); await stubPublicFacts(page);
    await page.addInitScript((baseUrl) => localStorage.setItem('heyta.sync.credentials', JSON.stringify({ baseUrl,
      token: 'fixture-token', accountId: 'layout-fixture-account', email: 'layout-fixture@example.test' })), server);
    const ruleId = 'rule-layout';
    await page.route(`${server}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = {}; let status = 200;
      if (path.endsWith('/automation/rules')) body = { rules: [{ id: ruleId, version: 7, enabled: true, keyId: 'hook-layout',
        createdAt: '2026-10-08T00:00:00Z', deletedAt: null, allowedFields: ['title', 'dueDate'], targetProjectId: null,
        timezone: 'Asia/Shanghai', parseVersion: 1, authorizationVersion: 1, maxItems: 5 }] };
      else if (path.endsWith('/automation/events')) body = { events: [{ eventId: 'event-queued', ruleId, ruleVersion: 7,
        status: 'queued', reasonCode: null, attempt: 1, receivedAt: 1_700_000_000_000 }] };
      else if (path.endsWith('/sender-credentials') && route.request().method() === 'POST') {
        body = { credentialId: 'cred-layout', keyId: 'hook-layout', secret: 'synthetic-fixture-once-code', ruleId };
      } else if (path.endsWith('/sender-credentials')) body = { credentials: [{ credentialId: 'cred-layout', keyId: 'hook-layout',
        createdAt: '2026-10-08T00:00:00Z', revokedAt: null, rotatedAt: null }] };
      else if (path.endsWith('/recipient-key')) body = { keyEpoch: 2, packageVersion: 1 };
      else if (path.endsWith('/key-package')) status = 404;
      else if (path.endsWith('/devices')) body = { devices: [] };
      else if (path.endsWith('/ops')) body = { ops: [], hasMore: false, latestSeq: 0 };
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await openApp(page, '/?lang=zh-CN', 'accepted');
    await openSettingsSheet(page); await selectSettingsSection(page, 'ai');

    const panel = page.getByTestId('inbound-automation-settings');
    await expect(panel).toBeVisible();
    const card = page.getByTestId(`inbound-rule-${ruleId}`);
    await expect(card).toBeVisible();

    // 签发一次凭据，让一次性凭据卡出现在页面上（它落在哪一格是这次要取证的决定之一）。
    await card.getByRole('button', { name: '生成或轮换发送方凭据', exact: true }).click();
    const secretCard = page.getByTestId('inbound-credential-secret');
    await expect(secretCard).toBeVisible();

    const geometry = await panel.evaluate((root) => {
      const px = (node: Element | undefined, property: string): string | undefined =>
        node === undefined ? undefined : getComputedStyle(node)[property as CSSStyleDeclaration];
      const title = root.querySelector('h3');
      const events = root.querySelector('.ht-inbound__events');
      const eventsTitle = events?.querySelector('h4');
      const danger = root.querySelector('.ht-btn--danger') as HTMLElement | null;
      const hint = root.querySelector('.ht-settings__hint') as HTMLElement | null;
      const cardBox = root.querySelector('[data-testid^="inbound-rule-"]')?.getBoundingClientRect();
      const secretBox = root.querySelector('[data-testid="inbound-credential-secret"]')?.getBoundingClientRect();
      const inside = cardBox !== undefined && secretBox !== undefined
        && secretBox.left >= cardBox.left - 1 && secretBox.right <= cardBox.right + 1
        && secretBox.top >= cardBox.top - 1 && secretBox.bottom <= cardBox.bottom + 1;
      return {
        titleSize: px(title, 'fontSize'), eventsTitleSize: px(eventsTitle, 'fontSize'),
        titleWeight: px(title, 'fontWeight'), eventsTitleWeight: px(eventsTitle, 'fontWeight'),
        eventsBorderTop: px(events, 'borderTopWidth'),
        dangerColor: px(danger ?? undefined, 'color'), hintColor: px(hint ?? undefined, 'color'),
        secretInsideCard: inside,
        overflow: root.scrollWidth - root.clientWidth,
      };
    });
    const toPx = (value: string | undefined): number => value === undefined ? -1 : Number.parseFloat(value);
    expect(toPx(geometry.titleSize), '面板标题必须真比事件区分节标题大（层级倒挂在计算样式里现形）')
      .toBeGreaterThan(toPx(geometry.eventsTitleSize));
    expect(toPx(geometry.eventsBorderTop), '事件区必须有一条上分隔线').toBeGreaterThan(0);
    expect(geometry.secretInsideCard, '一次性凭据卡必须落在那枚规则卡的框内').toBe(true);
    expect(geometry.overflow, '整块面板不许横向溢出').toBeLessThanOrEqual(1);
    expect(geometry.dangerColor).not.toBe(geometry.hintColor);

    // 🔴 逐元素量横向溢出：只量面板自己那一层会漏 —— 截图上看到"字被裁掉"时，
    // 溢出往往在某个子块上，而父层的 scrollWidth 并不反映它（§7 那一族"断言只验写了什么、
    // 不验看得见的有多少"）。读数写成证据文件，不靠人眼从 PNG 里反推。
    const probe = await panel.evaluate((root) => {
      const viewport = { width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth };
      const box = root.getBoundingClientRect();
      const offenders: { selector: string; overflow: number; width: number }[] = [];
      for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
        const overflow = el.scrollWidth - el.clientWidth;
        if (overflow > 1) offenders.push({
          selector: `${el.tagName.toLowerCase()}.${(el.className ?? '').toString().split(' ')[0]}`,
          overflow, width: el.clientWidth,
        });
      }
      return { viewport, panelBox: { x: box.x, right: box.right, width: box.width }, offenders: offenders.slice(0, 12) };
    });
    await mkdir(evidence, { recursive: true });
    await writeFile(`${evidence}/geometry-${width}.json`, JSON.stringify({ carrier: 'inb-t7 @ f16ad4d7 + 本批排版改动',
      viewport: probe.viewport, panelBox: probe.panelBox, offenders: probe.offenders }, null, 2));
    expect(probe.offenders, `窄屏里有 ${probe.offenders.length} 个子块横向溢出（明细见 geometry-${width}.json）`).toEqual([]);
    expect(probe.panelBox.x, '面板左缘不许偏出视口').toBeGreaterThanOrEqual(-1);
    expect(probe.panelBox.right, '面板右缘不许偏出视口').toBeLessThanOrEqual(probe.viewport.width + 1);

    // 通栏的 ghost 按钮会被读成区块标题（截图实测：「生成或轮换发送方凭据」压在凭据卡上方，
    // 看起来像那张卡的表头）。动作按钮要跟卡片里其它动作一样按内容取宽。
    const rotateBox = await card.getByRole('button', { name: '生成或轮换发送方凭据', exact: true }).boundingBox();
    const credentialBox = await card.locator('.ht-inbound__credential').boundingBox();
    expect(rotateBox!.width, '动作按钮不许通栏').toBeLessThan(credentialBox!.width * 0.9);

    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      await panel.scrollIntoViewIfNeeded();
      await panel.screenshot({ path: `${evidence}/panel-${width}-${theme}.png` });
    }
  });
}

/**
 * 自动收集草稿里那枚 date-only（只给日历日、不给时刻）在两枚相隔 26 小时的设备时区下各跑一遍：
 * 浏览器里那枚「截止时间」控件的取值必须逐字是 `2026-12-31`，而它发布出去的确认摘要
 * 必须等于**同一个输入在 Node 侧算出的摘要** —— 确认那一步若把这天按设备时区重新折过一次，
 * epoch 就变、摘要就变，这一条当场红。
 *
 * 🔴 为什么挑这两枚时区：`Pacific/Kiritimati` 是 UTC+14，`Etc/GMT+12` 是 UTC−12。
 * 规则时区 `Asia/Shanghai` 把 `2026-12-31` 折成 `2026-12-30T16:00Z`，任何一处绕开
 * `dueDateLocal` 去按设备时区读那个 epoch，两面会各读成 12-31 与 12-30。
 *
 * ⚠️ 这一条只覆盖浏览器今天真能到的那一层（草稿编辑面 + 确认发布）。**确认之后列表与详情
 * 显示的日不在这里**：任务不是「确认」那一步创建的 —— 确认只做再密封与发决定
 * （`packages/app-host/src/inbound-draft-review.ts:105-131`），领用与派发协调归 worker
 * （`packages/app-host/src/task-batch-actions.ts:22`）。那两面的浏览器读数要等 worker 那条链，
 * 已记进 `docs/plans/inbound-automation.md` C29 与 BLOCKED.md；同一枚不变量在缝那一层的
 * 逐时区读数由 `packages/app-host/tests/inbound-draft-date-zone.spec.ts` 负责。
 */
const zoneList = ['Pacific/Kiritimati', 'Etc/GMT+12'] as const;
for (const zone of zoneList) {
  test.describe(`inbound draft date-only under ${zone}`, () => {
    // 设备时区只能在建上下文时给（`page.emulateTimezone` 这枚 API 在 Playwright 1.63 已不存在）。
    test.use({ timezoneId: zone });
    test(`inbound draft editor keeps the date-only literal and digest under ${zone}`, async ({ page }) => {
      const { sealInbound } = await import('../../packages/inbound-core/dist/index.js');
      const { prepareInboundAutomationResult } = await import('../../packages/inbound-core/dist/index.js');
      const evidence = '../docs/research/evidence/inbound-automation-review/date-consistency';
      // IANA 时区名带 `/`（`Pacific/Kiritimati`），直接拼进文件名会被当成子目录 ⇒ 先做文件名安全的转写。
      const slug = zone.replace(/[^A-Za-z0-9]+/g, '-');
      // 🔴 探针控制：`timezoneId` 若没真落进浏览器上下文，下面两档会读出同一枚偏移、
      // 摘要也当然相同 —— 判据就成了永远通过的那一种。先在浏览器里回读时区与偏移并钉住。
      const browserClock: Record<(typeof zoneList)[number], { timeZone: string; offset: number }> = {
        'Pacific/Kiritimati': { timeZone: 'Pacific/Kiritimati', offset: -840 },
        'Etc/GMT+12': { timeZone: 'Etc/GMT+12', offset: 720 },
      }[zone];
      await page.setViewportSize({ width: 1280, height: 1400 });
      await mkdir(evidence, { recursive: true });
      await stubLegalRecheck(page); await stubPublicFacts(page);
      await page.addInitScript((baseUrl) => localStorage.setItem('heyta.sync.credentials', JSON.stringify({ baseUrl,
        token: 'fixture-token', accountId: '3', email: 'date-zone-fixture@example.test' })), server);
      const ruleId = '22222222-2222-4222-8222-222222222222';
      const eventId = 'date-zone';
      // 参考摘要在**浏览器之外**算：那枚草稿任务只给 `dueDate: '2026-12-31'`，规则时区 Asia/Shanghai。
      // Node 侧这一趟跑在本机时区，与下面两枚浏览器时区都不同 —— 浏览器若按设备时区重折，摘要必然对不上。
      const frozen = prepareInboundAutomationResult({ eventId, ruleId, ruleVersion: 1, parseVersion: 1, receivedAt: 1,
        timezone: 'Asia/Shanghai', modelResult: { tasks: [{ title: 'TZ probe task', dueDate: '2026-12-31' }] } });
      expect(frozen.payload.tasks[0]).toMatchObject({ dueDateLocal: '2026-12-31', dueDate: Date.UTC(2026, 11, 30, 16) });
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
          status: state, reasonCode: state === 'needs-confirmation' ? 'needs-confirmation' : null, attempt: 1,
          receivedAt: 1_700_000_000_000 }] : [] };
        else if (path.endsWith(`/${eventId}/draft`)) body = snapshot;
        else if (path.endsWith(`/${eventId}/draft/decision`)) {
          decisions.push(route.request().postDataJSON()); state = 'prepared'; body = { eventId, state };
        } else if (path.endsWith('/recipient-key')) {
          if (route.request().method() === 'PUT') {
            const input = route.request().postDataJSON();
            recipient = { keyEpoch: input.keyEpoch, publicKey: input.publicKey, packageVersion: input.packageVersion };
          }
          if (recipient) body = recipient; else status = 404;
        } else if (path.endsWith('/key-package')) status = 404;
        else if (path.endsWith('/devices')) body = { devices: [] };
        else if (path.endsWith('/ops')) body = { ops: [], hasMore: false, latestSeq: 0 };
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      });
      await openApp(page, '/?lang=zh-CN', 'accepted');
      await page.evaluate(async (baseUrl) => {
        const vault = await import('/src/lib/vault-session.ts');
        const runtime = await import('/src/features/settings/inbound-runtime.ts');
        const session = await vault.getWebVaultSession('3', baseUrl, async () => 'fixture-token');
        const pending = await session.beginCreation('synthetic-fixture-passphrase');
        await session.confirmAndPublish(pending, pending.recoveryCode);
        await runtime.ensureWebInboundRecipientKey({ accountId: '3', baseUrl, token: 'fixture-token' });
      }, server);
      const ciphertext = await sealInbound(new TextEncoder().encode(JSON.stringify(frozen.payload)),
        recipient.publicKey.replace(/-/g, '+').replace(/_/g, '/') + '=',
        { accountId: 'user-3', serverOrigin: server, eventId, ruleId, purpose: 'result', keyEpoch: recipient.keyEpoch });
      snapshot = { eventId, ruleId, ruleVersion: 1, parseVersion: 1, attempt: 1,
        resultDigest: frozen.resultDigest, resultItemCount: 1, resultCiphertext: JSON.stringify(ciphertext) };

      await openSettingsSheet(page); await selectSettingsSection(page, 'ai');
      const row = page.getByTestId(`inbound-event-${eventId}`);
      await row.getByRole('button', { name: '查看并编辑草稿', exact: true }).click();
      const editor = row.getByTestId('inbound-draft-editor');
      await expect(editor).toBeVisible();
      const editorDateValue = await editor.getByLabel('截止时间', { exact: true }).inputValue();
      const clock = await page.evaluate(() => ({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        offset: new Date().getTimezoneOffset(), localDay: new Date(1798646400000).getDate() }));
      await editor.screenshot({ path: `${evidence}/draft-editor-${slug}.png` });

      // 用户一字未改就确认：浏览器发布的摘要必须等于 Node 侧对同一输入算出的那枚。
      await editor.getByRole('button', { name: '确认创建这些任务', exact: true }).click();
      await expect(editor).toHaveCount(0);
      expect(decisions).toHaveLength(1);
      const publishedDigest = decisions[0].resultDigest;
      await writeFile(`${evidence}/readout-${slug}.json`, JSON.stringify({
        carrier: '共享主检出（含别线在飞 diff）', zone, browserZone: clock.timeZone, browserOffset: clock.offset,
        browserDayOfEpoch: clock.localDay, nodeOffset: new Date().getTimezoneOffset(),
        editorDateValue, nodeDigest: frozen.resultDigest, publishedDigest,
        nodeEpoch: frozen.payload.tasks[0].dueDate, nodeLocal: frozen.payload.tasks[0].dueDateLocal,
        覆盖: '草稿编辑面 + 确认发布；列表/详情两面在 worker 链上，见 C29',
      }, null, 2) + '\n');

      expect(editorDateValue, `${zone}：草稿里那枚截止时间逐字必须是 2026-12-31`).toBe('2026-12-31');
      expect(publishedDigest, `${zone}：浏览器确认发布的摘要 ≠ 同一输入在 Node 侧的摘要 ⇒ 这天在浏览器里被按设备时区重折过一次`)
        .toBe(frozen.resultDigest);
      expect(decisions[0].resultItemCount).toBe(1);
      // ① 探针控制那两条：浏览器确实活在那枚时区里，且那个 epoch 在浏览器本地读出来就不是 12-31
      //（这天全靠配对字段锚住 —— 与 `packages/app-host/tests/inbound-draft-date-zone.spec.ts` 同一件事）。
      expect(clock.timeZone, `${zone}：test.use 的 timezoneId 没落进浏览器 ⇒ 这两条在空转`).toBe(browserClock.timeZone);
      expect(clock.offset, `${zone}：浏览器设备偏移 ≠ 请求值（Kiritimati −840 / GMT+12 +720）`).toBe(browserClock.offset);
    });
  });
}
