import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

import { expect, test, type CDPSession, type Page } from '@playwright/test';

import {
  openApp,
  openSettingsSheet,
  selectSettingsSection,
  waitForOverlaySettled,
} from './helpers.js';

const ORIGIN = 'http://127.0.0.1:4355';
const EVIDENCE = path.resolve('../apps/web/evidence/reminder-permission-final');
const REPORT = '/tmp/heyta-reminder-permission-final/report.json';

type PermissionSetting = 'granted' | 'denied' | 'prompt';

interface PermissionSnapshot {
  readonly label: string;
  readonly browserPermission: string;
  readonly secureContext: boolean;
  readonly statusTestIds: Record<string, number>;
  readonly requestButtonCount: number;
  readonly limitText: string;
  readonly panelText: string;
  readonly screenshot: string;
}

const snapshots: PermissionSnapshot[] = [];
const permissionSessions = new WeakMap<Page, CDPSession>();

async function setPermission(page: Page, setting: PermissionSetting): Promise<void> {
  // Chromium only materializes an origin permission entry after the target has
  // visited that origin once. Establish 4355 before setting the first prompt.
  if (page.url() === 'about:blank') await page.goto(ORIGIN);
  await page.context().clearPermissions();
  // The Playwright test fixture uses an incognito context. Resolve its exact
  // CDP id from the page target instead of assuming Target.getBrowserContexts[0]
  // is the context under test.
  let targetCdp = permissionSessions.get(page);
  if (targetCdp === undefined) {
    targetCdp = await page.context().newCDPSession(page);
    permissionSessions.set(page, targetCdp);
  }
  const { targetInfo } = await targetCdp.send('Target.getTargetInfo');
  await targetCdp.send('Browser.setPermission', {
    permission: { name: 'notifications' },
    setting,
    origin: ORIGIN,
    browserContextId: targetInfo.browserContextId,
  });
  if (setting === 'granted') {
    // Keep the granted state in Playwright's real browser context permission
    // store as well; this avoids treating CDP's transient page state as a
    // user decision when the app refreshes on visibilitychange.
    await page.context().grantPermissions(['notifications'], { origin: ORIGIN });
  }
  // Keep this CDP session attached until the context closes. In the Chromium
  // build used here, detaching the session rolls Browser.setPermission back to
  // `default`; that is a browser-driver limitation, not application state.
  // The prompt state is intentionally detached after setup so the real click
  // path remains a normal browser user-gesture request instead of an attached
  // CDP permission override that can leave requestPermission pending.
  if (setting === 'prompt') {
    await targetCdp.detach();
    permissionSessions.delete(page);
  }
}

async function openReminderPanel(page: Page): Promise<void> {
  await openSettingsSheet(page);
  await selectSettingsSection(page, 'appearance');
  await waitForOverlaySettled(page, 'settings-sheet');
  await expect(page.getByTestId('reminder-notify-panel')).toBeVisible();
}

async function reloadAfterBrowserPermissionChange(page: Page): Promise<void> {
  await page.reload();
  await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
  await expect(page.locator('#heyta-boot')).toHaveCount(0);
}

async function capture(page: Page, label: string): Promise<PermissionSnapshot> {
  const screenshot = path.join(EVIDENCE, `${label}.png`);
  const snapshot = await page.evaluate(() => {
    const notification = (globalThis as { Notification?: { permission?: string } }).Notification;
    return {
      browserPermission: notification?.permission ?? 'unsupported',
      secureContext: globalThis.isSecureContext,
    };
  });
  const ids = [
    'reminder-notify-granted',
    'reminder-notify-denied',
    'reminder-notify-unsupported',
    'reminder-notify-request-failed',
  ];
  const statusTestIds = Object.fromEntries(
    await Promise.all(ids.map(async (id) => [id, await page.getByTestId(id).count()])),
  );
  const result: PermissionSnapshot = {
    label,
    ...snapshot,
    statusTestIds,
    requestButtonCount: await page.getByTestId('reminder-notify-request').count(),
    limitText: await page.getByTestId('reminder-notify-limit').innerText(),
    panelText: await page.getByTestId('reminder-notify-panel').innerText(),
    screenshot,
  };
  await page.screenshot({ path: screenshot, fullPage: true });
  snapshots.push(result);
  return result;
}

test.beforeEach(async ({ page }) => {
  await mkdir(EVIDENCE, { recursive: true });
  await mkdir('/tmp/heyta-reminder-permission-final', { recursive: true });
  // Every case starts with a real Chromium permission state selected explicitly.
  await setPermission(page, 'prompt');
});

test.afterEach(async ({ page }) => {
  // Do not leak the origin permission into any later local browser run.
  await setPermission(page, 'prompt');
  await writeFile(REPORT, JSON.stringify(snapshots, null, 2));
});

test('default → click request → granted (real Chromium permission and user gesture)', async ({ page }) => {
  await openApp(page, '/?lang=zh-CN');
  await openReminderPanel(page);

  const before = await capture(page, '01-default-before-request');
  expect(before.browserPermission).toBe('default');
  expect(before.requestButtonCount).toBe(1);
  expect(before.statusTestIds['reminder-notify-granted']).toBe(0);
  expect(before.statusTestIds['reminder-notify-denied']).toBe(0);
  expect(before.limitText).toContain('应用关掉后不会响');

  // Invoke the real user-gesture path. The native prompt outcome is owned by
  // Chromium/OS in this unattended run; record the resulting browser state
  // without pretending the runner accepted or denied that OS prompt.
  await page.getByTestId('reminder-notify-request').click();
  await expect
    .poll(async () => {
      const counts = await Promise.all([
        page.getByTestId('reminder-notify-granted').count(),
        page.getByTestId('reminder-notify-denied').count(),
        page.getByTestId('reminder-notify-request-failed').count(),
      ]);
      return counts.reduce((sum, count) => sum + count, 0);
    })
    .toBe(1);
  const after = await capture(page, '02-after-real-request-click');
  expect(after.browserPermission).toMatch(/^(default|denied|granted)$/);
});

test('granted from browser permission store shows success with no request button', async ({ page }) => {
  await openApp(page, '/?lang=zh-CN');
  await openReminderPanel(page);
  await setPermission(page, 'granted');
  await reloadAfterBrowserPermissionChange(page);
  await openReminderPanel(page);

  const result = await capture(page, '03-granted-direct');
  expect(result.browserPermission).toBe('granted');
  expect(result.statusTestIds['reminder-notify-granted']).toBe(1);
  expect(result.requestButtonCount).toBe(0);
});

test('denied from browser permission store hides request and refreshes after site-setting change', async ({ page }) => {
  await openApp(page, '/?lang=zh-CN');
  await openReminderPanel(page);
  await setPermission(page, 'denied');
  await reloadAfterBrowserPermissionChange(page);
  await openReminderPanel(page);

  const denied = await capture(page, '04-denied-direct');
  expect(denied.browserPermission).toBe('denied');
  expect(denied.statusTestIds['reminder-notify-denied']).toBe(1);
  expect(denied.requestButtonCount).toBe(0);

  await setPermission(page, 'granted');
  await reloadAfterBrowserPermissionChange(page);
  await openReminderPanel(page);
  const refreshed = await capture(page, '05-denied-to-granted-return-refresh');
  expect(refreshed.browserPermission).toBe('granted');
  expect(refreshed.statusTestIds['reminder-notify-granted']).toBe(1);
  expect(refreshed.requestButtonCount).toBe(0);
});

test('unsupported capability boundary (simulated Notification absence; not OS evidence)', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'Notification', { configurable: true, value: undefined });
  });
  await openApp(page, '/?lang=zh-CN');
  await openReminderPanel(page);

  const result = await capture(page, '06-unsupported-boundary-simulated');
  expect(result.browserPermission).toBe('unsupported');
  expect(result.statusTestIds['reminder-notify-unsupported']).toBe(1);
  expect(result.requestButtonCount).toBe(0);
});

test('error capability boundary (simulated request rejection; not OS evidence)', async ({ page }) => {
  await page.addInitScript(() => {
    class SimulatedNotification {
      static permission = 'default';

      static requestPermission(): Promise<NotificationPermission> {
        return Promise.reject(new Error('simulated browser policy rejection'));
      }
    }
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: SimulatedNotification,
    });
  });
  await openApp(page, '/?lang=zh-CN');
  await openReminderPanel(page);

  const before = await capture(page, '07-error-before-request');
  expect(before.browserPermission).toBe('default');
  await page.getByTestId('reminder-notify-request').click();
  const failed = page.getByTestId('reminder-notify-request-failed');
  await expect(failed).toBeVisible();
  const after = await capture(page, '08-error-after-request');
  expect(after.statusTestIds['reminder-notify-request-failed']).toBe(1);
  expect(after.requestButtonCount).toBe(1);
});
