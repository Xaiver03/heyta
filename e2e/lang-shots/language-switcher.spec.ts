/**
 * 顶栏语言控件 —— 真浏览器取证 + 形态判据
 * =======================================
 *
 * 产品负责人 2026-10-04：「中英文的那个切换组件太离谱了，你看一下规范应该是什么样子的。」
 *
 * ## 这一支测什么
 *
 * 1. **形态（可访问性树里的结构）**：顶栏里语言这件事**只有一个入口**，
 *    而且那个入口自己说明它是什么（分组带可访问名「语言」/ `Language`）。
 *    改造前这里是**两枚没有上下文、没有名字的裸 `.ht-chip`** ——
 *    同一个错法仓库里已经记过两次（`App.tsx:1662`、`main-area.css:45`，
 *    产品负责人 2026-09-30："用户根本不知道它们是什么"）。
 * 2. **行为没退化**：点某一项之后 `<html lang>` 与一条**具体词条**同时变，
 *    当前项标出、点它不写盘。
 * 3. **截图**（AGENTS §6.2 规定一：界面结论只有截图算证据）：
 *    中/英 × 浅/暗 × 1280/660 共 8 张整屏 + 8 张页头特写，落在固定路径。
 *
 * ## 🔴 截图的命名带 `before` / `after`
 *
 * 前缀由 `HEYTA_LANG_TAG` 决定。改之前先跑一趟 `before`，改完再跑 `after`，
 * **两组文件同时存在**才能逐张对着看 —— 覆盖式写同一批文件名，
 * 就等于把"改前长什么样"这唯一证据删掉（而它正是这次改动的动机）。
 */

import { expect, test, type Page } from '@playwright/test';

import { decidePrivacyConsent, enableAllModules } from '../tests/helpers';
import { installMissingProducerShims } from '../tests/shims';

const TAG = process.env['HEYTA_LANG_TAG'] ?? 'before';
/** 🔴 不是 outputDir —— Playwright 会清空那个目录，见配置文件头。 */
const SHOT_DIR = 'lang-shots-evidence';

/** 用**产品自己的**那一层状态钉住语言与主题（解析链第 1 层 = 用户明确选过）。 */
async function seed(page: Page, opts: { locale: 'zh-CN' | 'en'; theme: 'light' | 'dark' }): Promise<void> {
  await enableAllModules(page);
  await page.addInitScript(({ locale, theme }) => {
    window.localStorage.setItem('heyta.locale', locale);
    window.localStorage.setItem('heyta.theme', theme);
  }, opts);
  await installMissingProducerShims(page);
}

async function openAndSettle(
  page: Page,
  opts: { locale: 'zh-CN' | 'en'; theme: 'light' | 'dark'; width: number; height: number },
): Promise<void> {
  await page.setViewportSize({ width: opts.width, height: opts.height });
  await seed(page, opts);
  await page.goto('/');
  await expect(page.locator('.ht-header__actions')).toBeVisible();
  await decidePrivacyConsent(page);
}

const MATRIX: ReadonlyArray<{
  locale: 'zh-CN' | 'en';
  theme: 'light' | 'dark';
  width: number;
  height: number;
}> = [
  { locale: 'zh-CN', theme: 'light', width: 1280, height: 720 },
  { locale: 'en', theme: 'light', width: 1280, height: 720 },
  { locale: 'zh-CN', theme: 'dark', width: 1280, height: 720 },
  { locale: 'en', theme: 'dark', width: 1280, height: 720 },
  { locale: 'zh-CN', theme: 'light', width: 660, height: 900 },
  { locale: 'en', theme: 'light', width: 660, height: 900 },
  { locale: 'zh-CN', theme: 'dark', width: 660, height: 900 },
  { locale: 'en', theme: 'dark', width: 660, height: 900 },
];

test('取证：语言控件的中/英 × 浅/暗 × 宽/窄 共 16 张图，且窄视口不许横向溢出', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  for (const cell of MATRIX) {
    await openAndSettle(page, cell);
    const name = `${TAG}-lang-${cell.locale}-${cell.theme}-${cell.width}`;
    // 整屏（看它和邻居们成不成一套）+ 页头动作区特写（看控件自己的样子）。
    await page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
    await page
      .locator('.ht-header__actions')
      .screenshot({ path: `${SHOT_DIR}/${name}-actions.png` });

    // 判据：整页不许出现横向滚动（MASTER §8 清单里那条"无横向滚动"）。
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `${name}：页面横向溢出 ${overflow}px`).toBeLessThanOrEqual(0);
  }

  expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
});

test('🔴 形态：顶栏语言入口只有一个，而且它自己说明自己是什么', async ({ page }) => {
  await openAndSettle(page, { locale: 'zh-CN', theme: 'light', width: 1280, height: 720 });

  const group = page.getByRole('group', { name: '语言' });
  // 恰好一个入口 —— "同一个动作两个入口"是仓库明确判过的错形（goal-layout-audit §6 第 2 条）。
  await expect(group).toHaveCount(1);
  // 入口必须住在顶栏的全局控件区里（改造前后同一条位置判据）。
  await expect(group.locator('..')).toBeVisible();
  expect(
    await group.evaluate((node) => node.closest('.ht-header__actions') !== null),
    '语言分组不在 .ht-header__actions 里',
  ).toBe(true);

  // 每一项仍然由 `LOCALES` 驱动、写自己的自称、带自己的 lang。
  const zh = page.getByTestId('language-option-zh-CN');
  const en = page.getByTestId('language-option-en');
  await expect(zh).toHaveText('中文');
  await expect(en).toHaveText('English');
  await expect(zh).toHaveAttribute('lang', 'zh-CN');
  await expect(en).toHaveAttribute('lang', 'en');
  // 当前语言能被辅助技术认出来。
  await expect(zh).toHaveAttribute('aria-current', 'true');
  await expect(en).not.toHaveAttribute('aria-current');

  // 每一项的可访问名要说清"这是切到 X"，而不是只有一个孤零零的词。
  await expect(zh).toHaveAccessibleName(/中文/);
  await expect(en).toHaveAccessibleName(/English/);
});

test('🔴 键盘焦点：两项上的焦点环都真的画出来了（不许 outline:none）', async ({ page }) => {
  await openAndSettle(page, { locale: 'zh-CN', theme: 'light', width: 1280, height: 720 });

  /** 量"当前聚焦的那个语言项"的焦点环。 */
  const ringOf = (testId: string) =>
    page.evaluate((id) => {
      const node = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
      if (node === null || document.activeElement !== node) return null;
      const cs = getComputedStyle(node);
      return { width: cs.outlineWidth, style: cs.outlineStyle, color: cs.outlineColor };
    }, testId);

  // 起点选**紧邻分组右侧**的那枚主题按钮（`.focus()` 只是落点，不算键盘交互），
  // 之后每一下都是真的 **Shift+Tab** —— 走键盘才可能触发 `:focus-visible`，
  // 而这条判据要证的正是"键盘用户看得见焦点在哪"。
  // 从左边 Tab 过来要穿过 SyncBar 那几枚按钮，站点数会随同步状态变（脆）。
  await page.getByRole('button', { name: '切换到暗色主题' }).focus();
  await page.keyboard.press('Shift+Tab');
  let en = await ringOf('language-option-en');
  expect(en, 'Shift+Tab 一次没落到语言项上 —— Tab 顺序变了？').not.toBeNull();
  // `none` / `0px` 就是"焦点环被抹掉了"的两种写法（MASTER §3 禁止 `outline: none`）。
  expect(en!.style).not.toBe('none');
  expect(parseFloat(en!.width), `焦点环宽度 ${en!.width}`).toBeGreaterThan(0);

  await page.keyboard.press('Shift+Tab');
  const zh = await ringOf('language-option-zh-CN');
  expect(zh, '再按一下 Shift+Tab 应该落在当前语言那一项').not.toBeNull();
  expect(zh!.style).not.toBe('none');
  expect(parseFloat(zh!.width), `焦点环宽度 ${zh!.width}`).toBeGreaterThan(0);

  await page.screenshot({ path: `${SHOT_DIR}/${TAG}-lang-focus-1280.png` });
});

test('🔴 行为：点一下之后 <html lang> 与一条具体词条同时变；点当前项不改任何东西', async ({ page }) => {
  await openAndSettle(page, { locale: 'zh-CN', theme: 'light', width: 1280, height: 720 });

  // 点之前：中文界面。
  await expect(page.locator('body')).toContainText('收集箱');

  // 先点**当前项**：无操作（界面不动、存储里的值不变）。
  // ⚠️ 这里证的是"值不变"：`openAndSettle` 已经把偏好钉成 zh-CN，
  //   "首启点当前项也不许凭空写出一条偏好"那半条由 jsdom 用例负责
  //   （`apps/web/tests/language-switcher.spec.tsx`：点 zh 之后 `heyta.locale` 仍是 null）。
  await page.getByTestId('language-option-zh-CN').click();
  expect(await page.evaluate(() => localStorage.getItem('heyta.locale'))).toBe('zh-CN');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('body')).toContainText('收集箱');

  await page.getByTestId('language-option-en').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  // 词条与 <html lang> **同时**变 —— 只改一个是"点了没反应"的那种缺陷。
  await expect(page.locator('body')).toContainText('Inbox');
  await expect(page.locator('body')).not.toContainText('收集箱');
  expect(await page.evaluate(() => localStorage.getItem('heyta.locale'))).toBe('en');
  // 标记跟着换过去。
  await expect(page.getByTestId('language-option-en')).toHaveAttribute('aria-current', 'true');

  await page.screenshot({ path: `${SHOT_DIR}/${TAG}-lang-en-after-click-1280.png` });
});
