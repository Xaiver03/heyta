import { expect, test, type Page } from '@playwright/test';

import { closeSettingsSheet, decidePrivacyConsent, enableAllModules, openSettingsSheet } from './helpers';
import { installMissingProducerShims } from './shims';

/**
 * 首启语言解析链 —— 在**真浏览器**里钉住
 * ======================================
 *
 * 🔴 这条套件存在的理由：解析链（`apps/web/src/lib/locale.ts` 的
 * `resolveInitialLocale`：已存偏好 > `?lang=` > 系统语言 > 默认中文）此前
 * **只有 jsdom 单测**，而那份单测把 `navigator.language` 钉死成 `zh-CN`
 * （`apps/web/tests/setup.ts`）。也就是说"英文浏览器的首启访客看到的是不是英文"
 * 这件事**在单元测试里根本观测不到** —— 把第 3 层整个删掉，jsdom 那批用例照样全绿。
 *
 * Playwright 的 `newContext({ locale })` 改的是**真的** `navigator.language`，
 * 所以这里能测到那条路。每条用例都**显式设 locale**，不依赖这台机器的系统语言
 * （否则同一份代码在中文 Mac 与英文 CI 上给出不同结论，那不算判据）。
 *
 * ## 为什么"首启不落盘"是这里最重的一条
 *
 * 推断值一旦写进 `localStorage`，`hasStoredLocalePreference()` 就会把它误判成
 * "用户选过" ⇒ 登录后的**账号语言采纳**（解析链第 2 层）永远不触发。
 * 症状是"新设备首登之后仍是浏览器语言，账号里的语言设置像没生效"，
 * 而界面上一切正常。所以每条首启用例都顺手断言**存储里什么都没有**。
 *
 * 截图落固定路径（§6.2 规定一），人必须打开看。
 */

const STORAGE_KEY = 'heyta.locale';

/** 打开应用并等**外壳真的渲染出来**（白屏不算通过）。 */
async function openAppNeutral(page: Page, path = '/'): Promise<void> {
  await enableAllModules(page);
  await installMissingProducerShims(page);
  await page.goto(path);
  // 判据不能用"添加任务"输入框：`openApp()` 那条中文锚点在英文界面上必然超时。
  // （这里也不改用英文 placeholder 当锚 —— 那等于把 i18n 文案抄进测试，抄件一定会漂。）
  // 🔴 锚点原来是 `language-option-en`（语言中立的 testID，且它就是"顶栏渲染完了"的证据）。
  //   H9 第三刀把语言搬进 设置 → 显示 之后，"打开应用"这一步**没有**那个控件了 ——
  //   换成 rail 底部那两枚：它们不随语言变、不随视图变，也不在设置浮层里面。
  await expect(page.getByTestId('rail-help')).toBeVisible();
  // 🔴 首启隐私同意必须收掉，但它**不碰这一条判据的地盘**：决定写的是
  // `heyta.consent.*` 而不是 `heyta.locale`，所以下面"推断语言不落盘"那条
  // （`getItem(STORAGE_KEY) === null`）测的仍然是纯首启。
  // 不关掉它，第 5 条用例点语言切换器时会卡在 `div[role="presentation"] …
  // intercepts pointer events` —— 遮罩是整屏的，rail 与设置浮层也在它底下。
  await decidePrivacyConsent(page);
}

/** 界面上出现的是哪一门语言：正向含对方不含。 */
async function uiLanguage(page: Page): Promise<'en' | 'zh'> {
  const text = await page.locator('body').innerText();
  if (text.includes('收集箱')) return 'zh';
  if (text.includes('Inbox')) return 'en';
  throw new Error('界面上既没有「收集箱」也没有 Inbox —— 侧栏没渲染还是词条表空了？');
}

test('英文浏览器 + 全新访客 ⇒ 英文界面，且不写盘', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  await openAppNeutral(page);

  expect(await page.evaluate(() => navigator.language)).toBe('en-US');
  expect(await uiLanguage(page)).toBe('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  // 🔴 推断值不落盘（见文件头）。
  expect(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).toBeNull();

  await page.screenshot({ path: 'test-results/language-first-launch-en-browser.png' });
  await context.close();
});

test('中文浏览器 ⇒ 中文界面（上一条的反面对照，证明它不是永远英文）', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN' });
  const page = await context.newPage();
  await openAppNeutral(page);

  expect(await uiLanguage(page)).toBe('zh');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  expect(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).toBeNull();

  await page.screenshot({ path: 'test-results/language-first-launch-zh-browser.png' });
  await context.close();
});

test('不受支持的系统语言（ja-JP）⇒ 落回默认中文，而不是白屏或半英文', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'ja-JP' });
  const page = await context.newPage();
  await openAppNeutral(page);

  // `matchLocale` 只认 LOCALES 里的标签；`ja` 登记了文字系统规则但还没启用。
  expect(await uiLanguage(page)).toBe('zh');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');

  await page.screenshot({ path: 'test-results/language-first-launch-unsupported.png' });
  await context.close();
});

test('落地页带来的 ?lang= 压过系统语言，且不落盘', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN' });
  const page = await context.newPage();
  await openAppNeutral(page, '/?lang=en');

  // 浏览器说中文，URL 是英文 ⇒ 英文赢：那是用户刚在落地页读着的语言。
  expect(await uiLanguage(page)).toBe('en');
  expect(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).toBeNull();

  await page.screenshot({ path: 'test-results/language-first-launch-url-beats-browser.png' });
  await context.close();
});

test('显式选择压过一切：存过之后，浏览器语言与 ?lang= 都翻不回去', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'zh-CN' });
  const page = await context.newPage();
  await openAppNeutral(page);
  expect(await uiLanguage(page)).toBe('zh');

  // 真的点切换器（不是往 localStorage 里塞值）⇒ 先走真路径到设置那一层。
  await openSettingsSheet(page);
  await page.getByTestId('language-option-en').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  // 🔴 先关掉设置再判语言：`uiLanguage()` 读的是**范围列**那个导航词，而设置是浮层、
  //   开着的时候范围列不在 DOM 里 —— 那时两条都不命中，这条会报成"侧栏没渲染"。
  await closeSettingsSheet(page);
  expect(await uiLanguage(page)).toBe('en');
  // 这次**必须**落盘 —— 它是用户的选择，不是推断。
  expect(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).toBe('en');

  await page.screenshot({ path: 'test-results/language-first-launch-after-click.png' });

  // ① 刷新：同浏览器（zh）⇒ 仍是英文。
  await page.reload();
  await expect(page.getByTestId('rail-help')).toBeVisible();
  expect(await uiLanguage(page)).toBe('en');

  // ② 带一个**相反**的 ?lang= 进来 ⇒ 仍是英文。
  //    这条钉的是"陈旧参数不许覆盖用户明确的意图"（locale.ts 文件头那条纪律）。
  await page.goto('/?lang=zh-CN');
  await expect(page.getByTestId('rail-help')).toBeVisible();
  expect(await uiLanguage(page), '?lang=zh-CN 不该把已存的英文偏好翻回去').toBe('en');

  await page.screenshot({ path: 'test-results/language-first-launch-stored-wins.png' });
  await context.close();
});
