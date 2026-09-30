import { expect, test } from '@playwright/test';

import { openApp } from './helpers';

/**
 * 头像菜单：身份入口唯一 + 浮层不被 rail 裁掉
 * ==========================================
 *
 * 2026-09-30 产品负责人实测两句话推动了这一组判据：
 *   ① 「注册登录那个地方排版还是不对吧？」
 *   ② 「应该是点击头像出来注册、登录吧？…这个 UX 逻辑根本就不对」
 *
 * 修法（见 `apps/web/src/features/shell/AccountMenu.tsx` 文件头）：
 *   · 撤掉头像旁边那个常驻的「登录 / 注册」pill —— **身份入口只能有一个**；
 *   · 未登录时菜单**第一项**是「登录 / 注册」（主操作），且**不出现「退出登录」**；
 *   · 面板从 `position: absolute` 改成 `fixed` + 实测锚点 ——
 *     它此前比 rail 宽 16px，被 `nav.ht-rail { overflow-y: auto }` **切掉右边**。
 *
 * 🔴 为什么这条必须**真浏览器**：裁剪是**渲染层**的事 ——
 * `getBoundingClientRect()` 报的是**布局矩形**，被裁掉时它照样"看起来正常"。
 * jsdom 里更是连布局都没有。所以判据用 **`elementFromPoint` 命中测试**
 * （裁掉的部分命中的是别的东西 / null），而不是只量尺寸。
 * 截图按 §6.2 规定一落固定路径，人必须看。
 */

/** 面板的几何 + 边缘命中测试。命中测试才是"没被裁掉"的判据。 */
async function panelProbe(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('[data-testid="account-menu-panel"]');
    const rail = document.querySelector<HTMLElement>('nav.ht-rail');
    if (panel === null) throw new Error('面板不在 DOM 里');
    const r = panel.getBoundingClientRect();
    const hits = (x: number, y: number): boolean => {
      const el = document.elementFromPoint(x, y);
      return el !== null && panel.contains(el);
    };
    const railRect = rail?.getBoundingClientRect() ?? null;
    return {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
      railRight: railRect?.right ?? 0,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      // 三条边各取一个内侧 2px 的点：被祖先裁掉的话，这些点命中的是别的东西。
      // ⚠️ 底边取**中点**而不是右下角 —— 面板是圆角，右下角那 2px 落在圆角外，
      //    命中不到面板（那是判据自己的假阳性，不是缺陷）。
      hitLeft: hits(r.left + 2, r.top + Math.min(12, r.height / 2)),
      hitRight: hits(r.right - 2, r.top + Math.min(12, r.height / 2)),
      hitBottom: hits(r.left + r.width / 2, r.bottom - 2),
    };
  });
}

test('未登录：身份入口唯一，登录/注册是菜单第一项，没有退出登录', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);

  // ① 首屏**只有头像**这一个身份入口：菜单没开时里面那项不在 DOM。
  await expect(page.getByTestId('account-menu-avatar')).toBeVisible();
  await expect(page.getByTestId('sync-signin-entry')).toHaveCount(0);

  // ② 点一次打开菜单。
  await page.getByTestId('account-menu-avatar').click();
  const panel = page.getByTestId('account-menu-panel');
  await expect(panel).toBeVisible();

  // ③ 「登录 / 注册」是**第一项**（不是第二项、不是藏在设置里）。
  const items = panel.getByRole('menuitem');
  await expect(items.first()).toHaveAttribute('data-testid', 'sync-signin-entry');
  await expect(items.first()).toContainText('登录');
  // ④ 未登录时「退出登录」在语义上不存在 —— 渲染它等于给一个按不出效果的危险按钮。
  await expect(page.getByTestId('account-menu-signout')).toHaveCount(0);
  // ⑤ 未登录的人也要能进设置（同步地址 / AI / 导入都在那里）。
  await expect(page.getByTestId('account-menu-settings')).toBeAttached();

  const box = await panelProbe(page);
  await page.screenshot({ path: 'test-results/account-menu-signed-out.png' });

  // ⑥ 🔴 判据本体：面板**右侧伸出 rail 之外**（旧实现那 16px 就丢在这里），
  //    而且四条边都**真的画出来了**（命中测试通过 = 没被裁剪/遮挡）。
  expect(box.right, '面板应当比 rail 宽（否则这条判据测不到裁剪）').toBeGreaterThan(
    box.railRight + 4,
  );
  expect(box.hitLeft, '面板左边必须可见').toBe(true);
  expect(box.hitRight, '面板右边必须可见（被 rail 裁掉时这里是 false）').toBe(true);
  expect(box.hitBottom, '面板底边必须可见').toBe(true);
  // ⑦ 完整落在视口内（坐标是实测的，不许算出屏幕外）。
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(box.viewport.width);
  expect(box.bottom).toBeLessThanOrEqual(box.viewport.height);

  // ⑧ 再点一次就开认证面板（合计 2 次点击 —— "前置"的可执行含义）。
  await page.getByTestId('sync-signin-entry').click();
  await expect(page.locator('[role="dialog"][aria-label="登录 / 注册"]')).toBeVisible();
});

test('已登录：身份区是邮箱，退出登录在最底且是危险色', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  // 凭据落盘在 `localStorage['heyta.sync.credentials']`（见 `credential-storage.ts`）。
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'heyta.sync.credentials',
      JSON.stringify({
        baseUrl: 'https://sync.example',
        token: 'e2e-jwt',
        email: 'e2e@example.com',
      }),
    );
  });
  await openApp(page);

  await page.getByTestId('account-menu-avatar').click();
  const panel = page.getByTestId('account-menu-panel');
  await expect(panel).toBeVisible();

  // 身份区在**最上面**（SaaSUI 的账号面模式：先回答"这是谁的账号"）。
  await expect(page.getByTestId('account-menu-email')).toHaveText('e2e@example.com');
  // 已登录的人**不该**再看到"去登录"。
  await expect(page.getByTestId('sync-signin-entry')).toHaveCount(0);
  // 退出登录：最后一项 + 危险样式。
  const items = panel.getByRole('menuitem');
  await expect(items.last()).toHaveAttribute('data-testid', 'account-menu-signout');
  await expect(page.getByTestId('account-menu-signout')).toHaveClass(/ht-accountmenu__item--danger/);

  await panelProbe(page);
  await page.screenshot({ path: 'test-results/account-menu-signed-in.png' });
});

test('塌缩态（≤768px）：rail 在底部，菜单**向上弹**且完整可见', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 720 });
  await openApp(page);

  const avatar = page.getByTestId('account-menu-avatar');
  await avatar.click();

  const box = await panelProbe(page);
  const avatarBox = await avatar.boundingBox();
  expect(avatarBox, '头像有几何').not.toBeNull();

  // 🔴 塌缩态 rail 变成底部导航：向下弹的话整块面板都在视口外（旧实现就是那样）。
  expect(box.bottom, '面板必须整体在视口内（向上弹）').toBeLessThanOrEqual(box.viewport.height);
  expect(box.top, '面板顶部不能被顶出屏幕').toBeGreaterThanOrEqual(0);
  expect(box.bottom, '面板应当在头像**上方**（塌缩态 rail 贴底）').toBeLessThanOrEqual(
    avatarBox!.y + avatarBox!.height,
  );
  expect(box.hitRight, '塌缩态面板右边也必须可见').toBe(true);
  expect(box.hitBottom, '塌缩态面板底边也必须可见').toBe(true);

  await page.screenshot({ path: 'test-results/account-menu-narrow.png' });
});
