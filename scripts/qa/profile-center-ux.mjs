/**
 * Profile IA/UX acceptance in a real browser.
 *
 * Run from the repository root with localhost:5173 already serving the Web app.
 * The sync endpoint is a browser fixture; no external account or server is used.
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const root = process.cwd();
const evidenceDir = `${root}/apps/web/evidence/profile-center`;
const scenarios = [
  { name: 'desktop-light', width: 1440, height: 1000, theme: 'light' },
  { name: 'desktop-dark', width: 1440, height: 1000, theme: 'dark' },
  { name: 'narrow-light', width: 390, height: 844, theme: 'light' },
  { name: 'narrow-dark', width: 390, height: 844, theme: 'dark' },
  { name: 'growth-disabled', width: 1440, height: 1000, theme: 'light', growth: false },
];

/** Open the same profile-center path a user takes from the avatar menu. */
async function openProfileCenter(page) {
  await page.getByTestId('account-menu-avatar').click();
  await page.getByTestId('account-menu-profile-center').click();
}

/** Let reduced-motion transitions settle before measuring or capturing the sheet. */
async function waitForAnimations(page) {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))),
  );
}

const browser = await chromium.launch();
const findings = [];

try {
  for (const scenario of scenarios) {
    const page = await browser.newPage({
      viewport: scenario,
      locale: 'zh-CN',
      reducedMotion: 'reduce',
    });
    let displayName = '认真工作也记得好好休息的用户';

    await page.addInitScript(
      ({ theme, growth }) => {
        localStorage.setItem('heyta.locale', 'zh-CN');
        localStorage.setItem('heyta.theme', theme);
        localStorage.setItem(
          'heyta.sync.credentials',
          JSON.stringify({
            baseUrl: 'http://profile.test',
            token: 'profile-ui-fixture',
            email: 'a.very.long.profile.address.for.responsive.review@example.test',
          }),
        );
        localStorage.setItem('heyta.shell.modules', JSON.stringify({ growth: growth !== false }));
      },
      scenario,
    );

    await page.route('http://profile.test/**', (route) =>
      route.fulfill({ status: 403, contentType: 'application/json', body: '{}' }),
    );
    await page.routeWebSocket('ws://profile.test/**', () => {});
    await page.route('http://profile.test/api/account/profile', async (route) => {
      if (route.request().method() === 'PUT') {
        displayName = route.request().postDataJSON().displayName;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ displayName, avatarHash: null }),
      });
    });

    await page.goto('http://localhost:5173/');
    await page.getByTestId('privacy-consent-accept').click();
    await openProfileCenter(page);
    await page.locator('#profile-center-identity-title').filter({ hasText: displayName }).waitFor();
    await waitForAnimations(page);

    if (scenario.growth === false) {
      assert.equal(await page.getByTestId('profile-achievements').count(), 0);
      assert.equal(await page.getByTestId('profile-center-growth').count(), 0);
    }

    const bounds = await page.getByTestId('settings-sheet').evaluate((sheet) => ({
      client: sheet.clientWidth,
      scroll: sheet.scrollWidth,
    }));
    assert(bounds.scroll <= bounds.client + 1, JSON.stringify(bounds));
    await page.screenshot({ path: `${evidenceDir}/${scenario.name}.png` });

    await page.getByRole('button', { name: '编辑个人资料', exact: true }).click();
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('data-testid') === 'profile-nickname-input',
    );
    await page.getByTestId('profile-nickname-input').fill('新昵称');
    await page.getByTestId('profile-nickname-save').click();
    await page
      .getByTestId('profile-nickname-notice')
      .filter({ hasText: '昵称已保存' })
      .waitFor({ timeout: 5000 });

    await page.getByTestId('settings-back-to-profile').click();
    await page.locator('#profile-center-identity-title').filter({ hasText: '新昵称' }).waitFor();
    await page.getByTestId('profile-center-settings').click();
    await page.getByTestId('settings-back-to-profile').click();
    await page.getByTestId('settings-sheet-close').click();
    assert.equal(await page.getByTestId('settings-sheet').count(), 0);

    await page.getByTestId('account-menu-avatar').focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('data-testid') === 'account-menu-profile-center',
    );
    await page.keyboard.press('Enter');
    await page.getByTestId('profile-center').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByTestId('settings-sheet').count(), 0);
    assert(
      await page
        .getByTestId('account-menu-avatar')
        .evaluate((avatar) => avatar === document.activeElement),
    );

    if (scenario.growth !== false) {
      await openProfileCenter(page);
      await page.getByTestId('profile-center-growth').click();
      await page.locator('.ht-header__title').filter({ hasText: '成长' }).waitFor();
      assert.equal(await page.getByTestId('settings-sheet').count(), 0);
    }

    findings.push({
      ...scenario,
      overflow: bounds,
      editAndReturn: true,
      settingsAndReturn: true,
      closeRestoresWork: true,
      keyboardEnterEscape: true,
    });
    await page.close();
  }

  await writeFile(`${evidenceDir}/journeys.json`, JSON.stringify(findings, null, 2));
  console.log(JSON.stringify(findings));
} finally {
  await browser.close();
}
