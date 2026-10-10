import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { addTask, openApp, switchTheme, switchView } from './helpers';

const out = '../apps/web/evidence/global-sidebar-resize';

async function drag(page: Page, selector: string, dx: number) {
  if (!await page.locator(selector).isVisible()) return false;
  const box = await page.locator(selector).boundingBox();
  if (!box) return false;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 12 });
  await page.mouse.up();
  return true;
}

test('逐页左右栏连续拖拽：内容不被裁切，窄窗保持操作可达', async ({ page }) => {
  test.setTimeout(240_000);
  await mkdir(out, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await addTask(page, '这是一条用于检验拖窄详情栏后标题和操作能够正确换行的任务');
  const results: Record<string, unknown>[] = [];
  const views = ['任务', '日历', '四象限', '时间线', '习惯', '便签', '番茄钟'] as const;
  for (const theme of ['light', 'dark'] as const) {
    if (theme === 'dark') await switchTheme(page, theme);
    for (const view of views) {
      await switchView(page, view);
      if (view === '任务' || view === '四象限' || view === '时间线') {
        const row = page.locator('[data-testid^="task-row-"]').filter({ hasText: '这是一条用于检验' }).first();
        if (await row.isVisible()) await row.click();
      }
      if (view === '便签') {
        await page.getByTestId('notes-input').fill('便签测试：较长的内容在窄列中应自动换行，编辑按钮仍可操作。');
        await page.getByTestId('notes-submit').click();
        await page.locator('[data-testid^="note-edit-"]').first().click();
      }
      if (view === '习惯') {
        await page.getByTestId('habits-add-open').click();
        const habitDialog = page.getByTestId('habit-create-dialog');
        await habitDialog.getByLabel('新习惯名称', { exact: true }).fill('每天阅读并整理一条学习记录');
        await habitDialog.getByRole('button', { name: '添加习惯', exact: true }).click();
        const row = page.locator('.ht-habit__row').first();
        await expect(row).toBeVisible();
        await row.click();
        await expect(page.getByTestId('habit-board')).toBeVisible();
        await expect(page.locator('.ht-habit__pane')).toBeVisible();
        await expect(page.locator('.ht-app__detail-resizer')).toBeVisible();
      }
      for (const phase of ['narrow', 'wide', 'restore'] as const) {
        const dx = phase === 'narrow' ? 300 : phase === 'wide' ? -300 : 100;
        const rightDragged = await drag(page, '.ht-app__detail-resizer', dx);
        const leftDragged = await drag(page, '.ht-sidebar__resizer', -dx);
        const data = await page.evaluate(() => {
          return {
            documentOverflow: document.documentElement.scrollWidth - innerWidth,
            columns: ['.ht-sidebar__body', '.ht-sidebar__calendar-body', '.ht-app__detail', '.ht-habit__pane', '.ht-content'].map(selector => {
              const element = document.querySelector<HTMLElement>(selector);
              if (!element || !element.getBoundingClientRect().width) return { selector, visible: false };
              const rect = element.getBoundingClientRect();
              const spill = [...element.querySelectorAll<HTMLElement>('input, textarea, button, select, [role="button"]')]
                .filter(child => {
                  const r = child.getBoundingClientRect();
                  if (!r.width || !r.height || getComputedStyle(child).visibility === 'hidden') return false;
                  if (r.right <= rect.right + 1 && r.left >= rect.left - 1) return false;
                  // 时间线等明确横向滚动内容不应被当成布局裁切。
                  let parent = child.parentElement;
                  while (parent && parent !== element) {
                    if (['auto', 'scroll'].includes(getComputedStyle(parent).overflowX)) return false;
                    parent = parent.parentElement;
                  }
                  return true;
                }).map(child => ({ cls: child.className, id: child.dataset.testid, text: child.textContent?.slice(0, 70) }));
              return { selector, visible: true, width: rect.width, horizontalOverflow: element.scrollWidth - element.clientWidth, spill };
            }),
          };
        });
        results.push({ theme, view, phase, rightDragged, leftDragged, ...data });
        await page.screenshot({ path: `${out}/${view}-${theme}-${phase}.png` });
      }
    }
  }
  await writeFile(`${out}/readout.json`, JSON.stringify(results, null, 2));
  expect(results.filter(row => Number(row.documentOverflow) > 1)).toEqual([]);
  expect(results.filter(row => (row.columns as { spill?: unknown[] }[]).some(column => column.spill?.length))).toEqual([]);
  expect(results.filter(row => (row.columns as { horizontalOverflow?: number }[]).some(column => (column.horizontalOverflow ?? 0) > 1))).toEqual([]);
});
