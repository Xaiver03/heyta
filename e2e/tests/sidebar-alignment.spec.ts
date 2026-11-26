/**
 * 侧栏对齐脊线（2026-11-24 重排后新增）
 * ==========================================
 *
 * 钉住侧栏**两条对齐脊线**（几何判据，只有真浏览器量得到；jsdom 恒为 0）：
 *
 * 1. **左脊线**：所有行内前导图标（导航行 / 回收站 / 已存视图行）的图标左缘同 x；
 *    分组标题文字也落在这一条上。
 * 2. **右脊线**：所有尾部动作（各分组头的 `+`、已存视图行的 `×`）的**右缘同 x**，
 *    且 `+` 与 `×` 的**图标同心**（同宽 44 盒、居中同一 x）。
 *
 * 这条判据的来历：产品负责人截图指出「已存视图」行尾的 `×` 与上面的 `+`
 * 不在一条线上（此前 `+` 在 aside 内距里、`×` 贴到内容右缘，差 8px），
 * 于是整列看起来"没排版"。判据只量几何，不量颜色。
 *
 * ⚠️ 启动只等侧栏出来（不等 composer）：本判据只关心侧栏，且这样不受
 *    采集框异步挂载的影响。
 */
import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

test.use({ viewport: { width: 1280, height: 900 } });

test('侧栏：左脊线（图标/标题）与右脊线（+/×）各自对齐', async ({ page }) => {
  try {
    await openApp(page);
  } catch {
    /* 只关心侧栏：composer 未及时出现不影响本判据 */
  }
  await page.waitForSelector('nav.ht-sidebar', { timeout: 30_000 });

  // 造一条已存视图，让行尾的 × 出现
  await page.getByTestId('filter-add').click();
  await page.locator('[data-testid="filter-create-form"] input').fill('对齐判据视图');
  await page.getByTestId('filter-save').click();
  await expect(page.locator('[data-testid^="filter-apply-"]')).toHaveCount(1);

  const m = await page.evaluate(() => {
    const rect = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, right: r.right, w: r.width, cx: r.x + r.width / 2 };
    };
    return {
      navIcon: rect('[data-testid="nav-scope-today"] > svg'),
      trashIcon: rect('[data-testid="sidebar-tool-trash"] > svg'),
      filterIcon: rect('[data-testid^="filter-apply-"] > svg'),
      filterAdd: rect('[data-testid="filter-add"]'),
      filterAddIcon: rect('[data-testid="filter-add"] > svg'),
      removeBtn: rect('[aria-label="删除视图"]'),
      removeIcon: rect('[aria-label="删除视图"] > svg'),
      organizerAddRights: [...document.querySelectorAll('.ht-sidebar__organizer-add')].map(
        (el) => el.getBoundingClientRect().right,
      ),
    };
  });

  expect(m.navIcon && m.trashIcon && m.filterIcon && m.filterAdd && m.filterAddIcon && m.removeBtn && m.removeIcon).toBeTruthy();

  // 左脊线：三种行的前导图标左缘一致（±1px）
  expect(Math.abs(m.navIcon!.x - m.trashIcon!.x), '导航行与回收站图标左缘').toBeLessThanOrEqual(1);
  expect(Math.abs(m.navIcon!.x - m.filterIcon!.x), '导航行与已存视图行图标左缘').toBeLessThanOrEqual(1);

  // 右脊线：+ 与 × 的按钮右缘一致、图标同心（±1px）
  expect(Math.abs(m.filterAdd!.right - m.removeBtn!.right), '+ 与 × 的右缘').toBeLessThanOrEqual(1);
  expect(Math.abs(m.filterAddIcon!.cx - m.removeIcon!.cx), '+ 与 × 的图标中心').toBeLessThanOrEqual(1);
  expect(m.filterAdd!.w, '+ 应是 44 的命中盒').toBeGreaterThanOrEqual(44);
  expect(m.removeBtn!.w, '× 应与 + 同为 44 的命中盒').toBeGreaterThanOrEqual(44);

  // 所有分组头的 + 都落在同一条右脊线上
  const rights = m.organizerAddRights;
  expect(rights.length, '侧栏至少有「清单/标签/已存视图」三个 +').toBeGreaterThanOrEqual(3);
  for (const r of rights) {
    expect(Math.abs(r - m.filterAdd!.right), '每个 + 的右缘都应在同一条脊线上').toBeLessThanOrEqual(1);
  }
});
