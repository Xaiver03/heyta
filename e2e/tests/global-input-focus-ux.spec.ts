/**
 * 全局选中输入态与单行回车快捷输入 —— 真浏览器几何 + 样式 + 视觉验收（2026-11-25）
 * ================================================================================
 *
 * 覆盖产品负责人的两条核心要求：
 *   1. 任务 / 便签 / 子任务等单行快捷输入收成单行紧凑高度（≤52px），去掉多余加号/添加按钮，
 *      回车即提交；
 *   2. 全局所有输入控件的选中输入态统一为圆角主色边框（复合容器由外层圆角容器承接，
 *      内层输入不画直角方框；独立 input / textarea / select 统一走圆角 border + 1px ring）。
 */

import { mkdir } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

import { decorativeShadowLayers, visibleFocusRing } from './focus-ring.js';
import { openApp, parkCursor, switchTheme, switchView } from './helpers.js';

const OUT_DIR =
  process.env.HEYTA_FOCUS_SHOT_DIR ??
  '/Users/rocalight/.gemini/antigravity/brain/23ec2398-81e2-4686-ae5d-0ea13e56c02a/scratch/input-focus-verify';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${String(e)}`));
  return errors;
}

async function readAppearance(locator: Locator) {
  return locator.evaluate((el) => {
    const s = getComputedStyle(el);
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--ht-color-ring)';
    document.body.appendChild(probe);
    const ringColor = getComputedStyle(probe).color;
    probe.remove();
    return {
      outlineStyle: s.outlineStyle,
      outlineWidth: s.outlineWidth,
      outlineColor: s.outlineColor,
      outlineOffset: s.outlineOffset,
      boxShadow: s.boxShadow,
      backgroundColor: s.backgroundColor,
      borderTopColor: s.borderTopColor,
      borderTopWidth: s.borderTopWidth,
      borderRadius: s.borderRadius,
      ringColor,
      focused: document.activeElement === el,
      focusVisible: el.matches(':focus-visible'),
    };
  });
}

function parsePx(value: string): number {
  const m = value.match(/[\d.]+/);
  return m ? Number.parseFloat(m[0]) : 0;
}

async function assertCompositeFocus(shell: Locator, inner: Locator, label: string) {
  const innerState = await readAppearance(inner);
  const shellState = await readAppearance(shell);
  expect(innerState.focused, `${label}: 内层输入未获得焦点`).toBe(true);
  expect(
    visibleFocusRing(innerState),
    `${label}: 内层输入不应自画焦点框（会形成框中框/直角破角）：${JSON.stringify(innerState)}`,
  ).toBeNull();
  const shellRing = visibleFocusRing(shellState);
  expect(
    shellRing,
    `${label}: 外层圆角容器缺少可见焦点环：${JSON.stringify(shellState)}`,
  ).not.toBeNull();
  expect(shellRing!.source, `${label}: 外层焦点环应走圆角 box-shadow`).toBe('box-shadow');
  expect(shellRing!.widthPx, `${label}: 外层焦点环宽度不足`).toBeGreaterThanOrEqual(1);
  expect(parsePx(shellState.borderRadius), `${label}: 外层容器缺少圆角`).toBeGreaterThanOrEqual(8);
  expect(shellState.borderTopColor, `${label}: 外层容器边框色应切为 --ht-color-ring`).toBe(
    shellState.ringColor,
  );
  expect(decorativeShadowLayers(shellState.boxShadow), `${label}: 不应有装饰性阴影`).toEqual([]);
}

async function assertStandaloneFocus(control: Locator, label: string) {
  const state = await readAppearance(control);
  expect(state.focused, `${label}: 控件未获得焦点`).toBe(true);
  const ring = visibleFocusRing(state);
  expect(ring, `${label}: 缺少可见焦点环：${JSON.stringify(state)}`).not.toBeNull();
  expect(ring!.source, `${label}: 独立输入控件应走贴合圆角的 box-shadow，而不是 outline`).toBe(
    'box-shadow',
  );
  expect(parsePx(state.borderRadius), `${label}: 独立输入控件缺少圆角`).toBeGreaterThanOrEqual(6);
  expect(state.borderTopColor, `${label}: 边框色应切为 --ht-color-ring`).toBe(state.ringColor);
  expect(decorativeShadowLayers(state.boxShadow), `${label}: 不应有装饰性阴影`).toEqual([]);
}

test('全局选中输入态与单行快捷输入：暗色/亮色 × 桌面/窄屏全量核验并留图', async ({ page }) => {
  test.setTimeout(180_000);
  await mkdir(OUT_DIR, { recursive: true });
  const errors = watchErrors(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, '/?lang=zh-CN');
  await page.emulateMedia({ reducedMotion: 'reduce' });

  for (const theme of ['dark', 'light'] as const) {
    if ((await page.locator('html').getAttribute('data-theme')) !== theme) {
      await switchTheme(page, theme);
    }

    // ── 1. 任务快速捕获框（核心对照图 1）──────────────────────────
    await switchView(page, '任务');
    const captureShell = page.getByTestId('capture-compose');
    const captureInput = page.getByTestId('capture-input');
    const captureCapsule = page.getByTestId('capture-due-capsule');
    await expect(captureShell).toBeVisible();
    await expect(captureCapsule).toBeVisible();
    await expect(page.getByTestId('capture-submit'), '任务框不应再有加号提交按钮').toHaveCount(0);

    const captureBox = (await captureShell.boundingBox())!;
    expect(captureBox.height, `任务输入行过高：${String(captureBox.height)}px`).toBeLessThanOrEqual(52);

    await captureInput.click();
    await captureInput.fill('今天 验收全局输入态');
    await expect(captureCapsule).toContainText('今天');
    await parkCursor(page);
    await page.screenshot({ path: `${OUT_DIR}/01-capture-${theme}-1440.png` });
    await assertCompositeFocus(captureShell, captureInput, `CaptureComposer(${theme})`);

    if (theme === 'dark') {
      // 回车提交：验证真正落库且清空输入
      await captureInput.press('Enter');
      await expect(captureInput).toHaveValue('');
      await expect(
        page.locator('[data-testid^="task-row-"]').filter({ hasText: '验收全局输入态' }).first(),
      ).toBeVisible();
    } else {
      await captureInput.fill('');
    }

    // ── 2. Spotlight 搜索浮层输入壳 ───────────────────────────────
    await switchView(page, '搜索');
    const searchShell = page.getByTestId('search-panel-field');
    const searchInput = page.getByTestId('search-panel-input');
    await expect(searchInput).toBeFocused();
    await parkCursor(page);
    await page.screenshot({ path: `${OUT_DIR}/02-search-${theme}-1440.png` });
    await assertCompositeFocus(searchShell, searchInput, `SearchPanel(${theme})`);
    await searchInput.press('Escape');
    await expect(searchInput).toHaveCount(0);

    // ── 3. 便签单行快速输入壳 ────────────────────────────────────
    await switchView(page, '便签');
    const notesShell = page.getByTestId('notes-composer');
    const notesInput = page.getByTestId('notes-input');
    await expect(page.getByTestId('notes-submit'), '便签框不应再有多余添加按钮').toHaveCount(0);
    const notesBox = (await notesShell.boundingBox())!;
    expect(notesBox.height, `便签输入行过高：${String(notesBox.height)}px`).toBeLessThanOrEqual(52);
    await notesInput.click();
    await parkCursor(page);
    await page.screenshot({ path: `${OUT_DIR}/03-notes-${theme}-1440.png` });
    await assertCompositeFocus(notesShell, notesInput, `NotesBoard(${theme})`);

    if (theme === 'dark') {
      await notesInput.fill('回车直接记一条便签');
      await notesInput.press('Enter');
      await expect(
        page.locator('[data-testid^="note-row-"]').filter({ hasText: '回车直接记一条便签' }).first(),
      ).toBeVisible();
    }

    // ── 4. 任务详情页：标题编辑态 & 子任务无按钮 ───────────────────
    await switchView(page, '任务');
    const firstRow = page
      .locator('[data-testid^="task-row-"]')
      .filter({ hasText: '验收全局输入态' })
      .first();
    await firstRow.click();
    const titleRead = page.getByTestId('task-detail-title');
    await expect(titleRead).toBeVisible();
    await titleRead.click();
    const titleInput = page.getByTestId('task-detail-title-input');
    await expect(titleInput).toBeFocused();
    await parkCursor(page);
    await page.screenshot({ path: `${OUT_DIR}/04-detail-title-${theme}-1440.png` });
    await assertStandaloneFocus(titleInput, `TaskDetailTitle(${theme})`);
    await titleInput.press('Escape');

    // ── 5. 表单页：添加习惯对话框（<input> 与 <select> 统一圆角聚焦态）──
    await switchView(page, '习惯');
    await page.getByTestId('habits-add-open').click();
    const habitDialog = page.getByTestId('habit-create-dialog');
    await expect(habitDialog).toBeVisible();
    const habitName = habitDialog.getByLabel('新习惯名称', { exact: true });
    await habitName.click();
    await parkCursor(page);
    await page.screenshot({ path: `${OUT_DIR}/05-habit-form-input-${theme}-1440.png` });
    await assertStandaloneFocus(habitName, `HabitFormInput(${theme})`);

    // 用键盘 Tab 走到第一个 select，验证 <select> 也走圆角焦点环而非直角 outline
    const firstSelect = habitDialog.locator('select').first();
    if (await firstSelect.count()) {
      await page.keyboard.press('Tab');
      await firstSelect.focus();
      await parkCursor(page);
      await page.screenshot({ path: `${OUT_DIR}/06-habit-form-select-${theme}-1440.png` });
      await assertStandaloneFocus(firstSelect, `HabitFormSelect(${theme})`);
    }
    await page.keyboard.press('Escape');
  }

  // ── 6. 窄屏（390×844）暗色：单行捕获框不换行、不溢出 ─────────────
  await switchTheme(page, 'dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await switchView(page, '任务');
  const narrowShell = page.getByTestId('capture-compose');
  const narrowInput = page.getByTestId('capture-input');
  await narrowInput.click();
  await parkCursor(page);
  await page.screenshot({ path: `${OUT_DIR}/07-capture-dark-390.png` });
  const narrowBox = (await narrowShell.boundingBox())!;
  expect(narrowBox.height, `窄屏任务输入行过高：${String(narrowBox.height)}px`).toBeLessThanOrEqual(52);
  await assertCompositeFocus(narrowShell, narrowInput, 'CaptureComposer(dark-390)');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow, '窄屏出现横向溢出').toBe(false);

  expect(errors, `验收期间出现控制台错误：\n${errors.join('\n')}`).toEqual([]);
});
