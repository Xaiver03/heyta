// 一次性取证探针（不是门禁）：暗色那一档到底有没有同时落到两层主题上。
//
// 产品的暗色有两个消费者，且必须由同一个状态驱动（现量在 `apps/web/src/App.tsx`）：
//   ① CSS 层 —— `applyTheme(theme)` 写 `<html data-theme>`，`tokens.css` 的暗色覆盖挂在它上面；
//   ② 共享层 —— `resolveHeytaUiTheme({ scheme: theme })` 交给 `<HeytaUiProvider value=…>`，
//      `packages/ui` 的 RN 组件吃的是这份 JS token（RNW 内联样式），**不读那个 DOM 属性**。
// 本装置的提醒/分组两档原先只写 ①，于是"暗色"截图里凡走共享层的组件仍是亮色字板。
// 这个探针把两种驱动方式各自的实测色值打出来，用来把这件事钉成数字。
//
// 跑法（无头、不抢前台）：
//   cd apps/web && ./node_modules/.bin/vite --port <空端口> --strictPort --host 127.0.0.1
//   HEYTA_THEME_PROBE_ORIGIN=http://127.0.0.1:<同端口> node scripts/qa/probe-theme-layer.mjs
import { chromium } from '../../e2e/node_modules/@playwright/test/index.mjs';

const ORIGIN = process.env.HEYTA_THEME_PROBE_ORIGIN ?? 'http://127.0.0.1:4379';
// 一个确定走共享层的节点：`WidgetJourneyPanel` 里的 `SettingsSection`（RN 组件、内联样式）。
const SHARED = '[data-testid="widget-journey-panel"]';
// 一个确定走 CSS 层的节点：同一组里的 web 区块标题（`ht-settings__group-title`）。
const CSS_LAYER = '#settings-group-appearance .ht-settings__group-title';

async function decidePrivacy(page) {
  const dialog = page.getByTestId('privacy-consent-dialog');
  if (await dialog.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false)) {
    await page.getByTestId('privacy-consent-local-only').click();
    await dialog.waitFor({ state: 'detached' });
  }
}

async function openAppearanceGroup(page) {
  await decidePrivacy(page);
  await page.getByTestId('account-menu-avatar').click();
  await page.getByTestId('account-menu-settings').click();
  await page.getByTestId('settings-sheet').waitFor();
  const link = page.locator(
    'button.ht-settings__nav-link[aria-controls="settings-group-appearance"],'
    + ' a.ht-settings__nav-link[href="#settings-group-appearance"]');
  const found = await link.count();
  if (found !== 1) throw new Error(`设置导航「任务与显示」命中 ${found} 枚（应为 1），两种形状各查过一遍`);
  await link.first().click();
  await page.locator('#settings-group-appearance').waitFor({ state: 'visible', timeout: 15_000 });
}

async function measure(page) {
  return page.evaluate(([shared, cssLayer]) => {
    const rootStyle = getComputedStyle(document.documentElement);
    const host = document.querySelector(shared);
    // 只认字面色值：web 组件的内联 color 写的是 `var(--ht-color-…)`，那会跟着 CSS 变量走，
    // 拿它当共享层会让"两层同色"假过。RNW 写的是 JS token 解析出来的字面值。
    const colored = host
      ? [host, ...host.querySelectorAll('*')].find((el) => {
        const s = el.getAttribute('style') ?? '';
        return /(^|;)\s*color\s*:/.test(s) && !s.includes('var(');
      }) ?? null
      : null;
    const cssTitle = document.querySelector(cssLayer);
    return {
      datasetTheme: document.documentElement.dataset.theme ?? '(unset)',
      storedTheme: localStorage.getItem('heyta.theme') ?? '(unset)',
      cssVarForeground: rootStyle.getPropertyValue('--ht-color-foreground').trim(),
      cssLayerTitleColor: cssTitle ? getComputedStyle(cssTitle).color : '(css node not found)',
      sharedNodeFound: Boolean(colored),
      sharedLayerColor: colored ? getComputedStyle(colored).color : '(shared node has no inline color)',
    };
  }, [SHARED, CSS_LAYER]);
}

async function run(browser, { initScript, forceDatasetTheme }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  if (initScript) await page.addInitScript(initScript);
  else await page.addInitScript(() => localStorage.setItem('heyta.locale', 'zh-CN'));
  await page.goto(`${ORIGIN}/?lang=zh-CN`);
  await openAppearanceGroup(page);
  if (forceDatasetTheme) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, forceDatasetTheme);
    await page.waitForTimeout(250);
  }
  const out = await measure(page);
  await context.close();
  return out;
}

const browser = await chromium.launch({ headless: true });
const arms = {
  'A 起跑默认（不驱动任何一档）': await run(browser, {}),
  'B 只写 dataset.theme（装置原先的暗色档）': await run(browser, { forceDatasetTheme: 'dark' }),
  'C 走产品真实那条（localStorage heyta.theme=dark）': await run(browser, { initScript: () => localStorage.setItem('heyta.theme', 'dark') }),
};
await browser.close();

const rgb = (s) => (s ?? '').replace(/\s+/g, ' ');
for (const [name, v] of Object.entries(arms)) {
  console.log(`\n${name}`);
  for (const [k, x] of Object.entries(v)) console.log(`   ${k.padEnd(19)} ${x}`);
  const agree = v.sharedNodeFound && rgb(v.sharedLayerColor) === rgb(v.cssLayerTitleColor);
  console.log(`   ⇒ 两层同色？${agree ? '是' : '否'}`);
}
const b = arms['B 只写 dataset.theme（装置原先的暗色档）'];
const c = arms['C 走产品真实那条（localStorage heyta.theme=dark）'];
console.log('\n判读：');
console.log(`   B 共享层色 ${rgb(b.sharedLayerColor)} vs CSS 层色 ${rgb(b.cssLayerTitleColor)}`);
console.log(`   C 共享层色 ${rgb(c.sharedLayerColor)} vs CSS 层色 ${rgb(c.cssLayerTitleColor)}`);
console.log('   ⇒ 若 B 两色不同而 C 两色相同：暗色档必须走 C 那条驱动（写 `heyta.theme`），');
console.log('     只写 `dataset.theme` 的截图里共享层组件仍是亮色字板 —— 那是载体的问题，不是产品的。');
