/**
 * 同步入口搬进 rail 底部（工单 H9 的第一刀，web 端）
 * ===================================================
 *
 * 产品负责人 2026-10-06 的原话："同步按钮不应该放在左下角侧边栏的左下角吗？"
 * 裁决与逐条现量在 `docs/plans/goal-layout-audit.md` §9.1。这一份用例钉的是
 * **搬走之后两边都还成立**：
 *
 *   S1 🔴 页头那一排**不许再有同步**（存在性反向判据）。
 *      为什么必须有这一条而不是只验"rail 里有一枚"：这一排的成因就是
 *      "每批都往页头右侧再塞一枚"（六枚不相关控件平铺）。只验新位置，
 *      下一批把旧的加回来也不会红。
 *   S2 rail 底部那一枚在、可点、**`aria-label` 里带着整句状态**，
 *      且 DOM 里有一枚 `role="status"` 的 live region（状态是异步变的）。
 *   S3 「同步设置」齿轮仍然打得开对话框，且共享那枚状态条**在对话框里**
 *      （它从页头搬到这里，不是被删掉 —— `check:ui-provider` 登记的消费者必须在）。
 *
 * ⚠️ 载体与图标那一族同一条：`vite preview` + `apps/web/dist`，
 *    改完 `apps/web/src/**` 或 `packages/ui/src/**` **必须先重打**（§7 第 27 条那一族）。
 *    跑法（仓库根）：
 *      pnpm --filter @heyta/ui build && pnpm --filter @heyta/web build
 *      cd e2e && npx playwright test tests/shell-sync-rail.spec.ts \
 *        --config playwright.detail-pane.config.ts
 */
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { openApp } from './helpers';

const APP_ZH = '/?lang=zh-CN';

const SHOT = (name: string) =>
  fileURLToPath(new URL(`../../apps/web/evidence/shell-sync-rail/${name}.png`, import.meta.url));

/** 量一枚元素的盒子。 */
async function boxOf(page: Page, locator: ReturnType<Page['locator']>, what: string) {
  const box = await locator.first().boundingBox();
  expect(box, `${what} 量不到盒子 ⇒ 它没画出来`).not.toBeNull();
  return box as { x: number; y: number; width: number; height: number };
}

test.describe('同步入口在 rail 底部（H9，web 端）', () => {
  test('S1 🔴 页头那一排不许再出现同步的任何一枚', async ({ page }) => {
    await openApp(page, APP_ZH);

    const actions = page.locator('.ht-header__actions');
    await expect(actions, '页头动作区没画出来 ⇒ 这一条没有基准').toHaveCount(1);

    // 反向存在性：整块同步 affordance（旧形状）与其三枚动作都不许在页头里。
    await expect(
      actions.locator('[data-testid="sync-rail"], [data-testid="sync-settings-entry"], [data-testid="sync-help-link"]'),
      '页头里又出现了同步的某一枚 ⇒ "别往页头塞"这条没有生效',
    ).toHaveCount(0);
    // 文字通道：旧的那枚主按钮/链接的文案也不许在页头出现（testID 改名挡不住文案回来）。
    for (const word of ['未同步', '立即同步', '处理冲突']) {
      await expect(
        actions.getByText(word, { exact: false }),
        `页头里还能读到「${word}」—— 同步没真的搬走`,
      ).toHaveCount(0);
    }
  });

  test('S2 rail 底部那一枚在、可点、并且把状态说得出', async ({ page }) => {
    await openApp(page, APP_ZH);

    const button = page.getByTestId('sync-rail').locator('button').first();
    await expect(button, 'rail 底部没有同步那一枚').toBeVisible();
    await expect(button, '这一枚没有可访问名 ⇒ 纯图标控件').not.toHaveAttribute('aria-label', '');

    // 🔴 状态必须**在标签里**：这一枚没有常驻文字，色点也不是给眼睛之外的通道。
    const label = (await button.getAttribute('aria-label')) ?? '';
    expect(label, `aria-label 里没念出状态：${label}`)
      .toMatch(/未同步|已同步|同步中|离线|冲突|出错|同步，当前状态/);

    // live region 与 hover 标签是两件事：读屏要的那句必须常驻 DOM。
    const live = page.getByTestId('sync-rail').locator('[role="status"]');
    await expect(live, '少了 role="status" 的 live region ⇒ 状态变化不会播报').toHaveCount(1);
    expect(((await live.textContent()) ?? '').trim().length, 'live region 是空的').toBeGreaterThan(0);

    // 位置：它要在 rail 里、并且是这一列**最底下**那一组（在「帮助」之下）。
    const rail = await boxOf(page, page.locator('.ht-rail'), '左 rail');
    const here = await boxOf(page, button, '同步那一枚');
    const help = await boxOf(page, page.getByTestId('rail-help'), '「帮助」那一枚');
    expect(here.x, '同步那一枚不在 rail 的横向范围里').toBeGreaterThanOrEqual(rail.x - 1);
    expect(here.x + here.width, '同步那一枚超出 rail 右边界').toBeLessThanOrEqual(
      rail.x + rail.width + 1,
    );
    expect(here.y, '同步那一枚不在「帮助」之下 ⇒ 它没有真的贴到左下角').toBeGreaterThan(help.y);

    const viewport = page.viewportSize();
    expect(viewport, '量不到视口尺寸 ⇒ 这一条没有基准').not.toBeNull();
    const vh = viewport?.height ?? 0;

    /*
      🔴 下段**每一枚**都要在视口内，而不只同步那一枚。
      这一条的第一版只量了同步按钮，于是它红的时候（底边 y=800 > 视口 720）我把它读成
      "差一点，挪挪间距就行" —— 真相是 rail 底下整组（通知/帮助/同步/齿轮 ≈ 210px）
      都堆在折叠线以下，而只有眼睛能一眼看出"堆了几枚"（§6.2 规定一第 4 条）。
      逐枚量还把"只把同步那枚救回来、把齿轮留在折叠线下"这种改法挡掉。
    */
    const bottomGroup = [
      ['通知（铃铛）', page.locator('nav.ht-rail > button[aria-haspopup="dialog"]')],
      ['帮助', page.getByTestId('rail-help')],
      ['同步', button],
      ['同步设置（齿轮）', page.getByTestId('sync-settings-entry')],
    ] as const;
    const readings: string[] = [];
    for (const [what, locator] of bottomGroup) {
      const box = await boxOf(page, locator, what);
      readings.push(`${what} y=${String(Math.round(box.y))}..${String(Math.round(box.y + box.height))}`);
      expect(box.y >= -1, `${what} 顶边 y=${String(Math.round(box.y))} 在视口顶之上`).toBe(true);
      expect(
        box.y + box.height <= vh + 1,
        `${what} 底边 y=${String(Math.round(box.y + box.height))} 掉出视口底边（视口高 ${String(Math.round(vh))}；${readings.join(' | ')}）`,
      ).toBe(true);
    }

    /*
      🔴 "下段常驻"的另一半：**放不下的那一段必须自己会滚**。
      只断言上面那四条的话，把 `.ht-rail` 改成 `overflow: hidden` 而不给上段滚动区
      也会全绿 —— 那等于把视图列表裁掉，比掉出视口更糟（够不着了）。
      所以这里按"上段内容是否超出它自己的盒子"分流：超出就必须 `overflow-y: auto|scroll`，
      没超出（高视口）就只要求它别是 `hidden`（否则这条判据在矮视口下也会红得没人信）。
    */
    const tabsOverflow = await page
      .locator('.ht-rail__tabs')
      .evaluate((el) => ({
        clipped: el.scrollHeight - el.clientHeight,
        overflowY: getComputedStyle(el).overflowY,
      }));
    if (tabsOverflow.clipped > 1) {
      expect(
        tabsOverflow.overflowY === 'auto' || tabsOverflow.overflowY === 'scroll',
        `上段的视图列表被裁掉 ${String(Math.round(tabsOverflow.clipped))}px 而 overflow-y 是 "${tabsOverflow.overflowY}" —— 那些视图谁都点不到`,
      ).toBe(true);
    }

    // 🔴 **先截图，再断言**（§6.2 规定一第 1 条）：这一条第一版把截图放在最后一句，
    //    于是"掉出视口底边"红的时候**没有图可看** —— 而那恰恰是最需要看图的一红
    //    （rail 底下到底堆了多少枚，只有眼睛能一眼判断）。
    await page.screenshot({ path: SHOT('rail-sync-button') });

    /*
      整页 1280×720 里 rail 只有 64px 宽 —— 那一列在整图里**看不清任何一枚**，
      而 H9 的全部争议都在那一列的底部（"下段堆了几枚、每枚画成什么样"）。
      所以额外裁一份下段放大图：`clip` 只截这块，`scale: 'device'` 保留像素密度。
      这张图是给人看的证据，不是判据（判据是上面那四条逐枚量出来的盒子）。
    */
    await page.screenshot({
      path: SHOT('rail-bottom-group'),
      clip: { x: 0, y: Math.max(0, vh - 300), width: 128, height: Math.min(300, vh) },
      scale: 'device',
    });
  });

  test('S3 「同步设置」齿轮仍打得开对话框，状态条住在里面', async ({ page }) => {
    await openApp(page, APP_ZH);

    await page.getByTestId('sync-settings-entry').click();
    const dialog = page.getByRole('dialog', { name: '同步设置' });
    await expect(dialog, '齿轮点不开「同步设置」对话框').toBeVisible();

    // 共享那枚状态条骨架的**消费者从页头改成了这里**，不是被删：
    // 拿掉它会同时让 `check:ui-provider` 红（那枚组件登记在 PROVIDER_DEPENDENT 里）。
    await expect(
      dialog.getByTestId('sync-status-bar'),
      '「同步设置」对话框里没有状态条 ⇒ 搬家的收尾是把旧的删了',
    ).toBeVisible();
    await page.screenshot({ path: SHOT('sync-settings-dialog') });

    await page.getByRole('button', { name: '关闭同步设置' }).click();
    await expect(dialog, '关掉之后对话框还在').toBeHidden();
  });
});
