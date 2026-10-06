/**
 * 同步入口搬进 rail 底部 + 同步设置搬进 设置（工单 H9，web 端）
 * ============================================================
 *
 * 产品负责人 2026-10-06 的原话："同步按钮不应该放在左下角侧边栏的左下角吗？"
 * 以及第 2 条："设置不应该点击头像之后再打开吗？"
 * 裁决与逐条现量在 `docs/plans/goal-layout-audit.md` §9.1。这一份用例钉的是
 * **搬走之后两边都还成立**：
 *
 *   S1 🔴 页头那一排**不许再有同步**（存在性反向判据）。
 *      为什么必须有这一条而不是只验"rail 里有一枚"：这一排的成因就是
 *      "每批都往页头右侧再塞一枚"（六枚不相关控件平铺）。只验新位置，
 *      下一批把旧的加回来也不会红。
 *   S2 rail 底部那一枚在、可点、**`aria-label` 里带着整句状态**，
 *      且 DOM 里有一枚 `role="status"` 的 live region（状态是异步变的）。
 *   S3 设置里的那一节带着共享状态条（它从页头搬到这里，不是被删掉 ——
 *      `check:ui-provider` 登记的消费者必须在）。
 *   S4 🔴 「同步设置」**只有一处**，而那一处在设置浮层里：
 *      rail 上那颗齿轮必须消失（它长得像全局设置，点开的却只是同步），
 *      而设置关掉之后这一节必须跟着不在 DOM 里（它不再是常驻的同级浮层）。
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

import { closeSettingsSheet, openApp, openSettingsView, parkCursor } from './helpers';

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
      "差一点，挪挪间距就行" —— 真相是 rail 底下整组（通知/帮助/同步 ≈ 160px）
      都堆在折叠线以下，而只有眼睛能一眼看出"堆了几枚"（§6.2 规定一第 4 条）。
      逐枚量还把"只把同步那枚救回来、把下面那一枚留在折叠线下"这种改法挡掉。
    */
    const bottomGroup = [
      ['通知（铃铛）', page.locator('nav.ht-rail > button[aria-haspopup="dialog"]')],
      ['帮助', page.getByTestId('rail-help')],
      ['同步', button],
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

  test('S3 设置里那一节带着共享状态条，并且三个字段都在', async ({ page }) => {
    await openApp(page, APP_ZH);
    await openSettingsView(page);

    const panel = page.getByTestId('sync-settings-panel');
    await expect(panel, '设置浮层里没有「同步」那一节').toBeVisible();

    /*
      🔴 必须**滚进视野再拍**：`toBeVisible()` 量的是 CSS 可见，而设置浮层是一列
      很长的可滚动列表 —— 不滚的话截图拍的是浮层**顶部**（个人信息 + 显示），
      而这张图的名字声称的是同步那一节。2026-10-06 人眼看第一版这张图时看到的就是
      顶部那一屏 —— 判据全绿、图是错的（§6.2 规定一第 4 条要的就是这一步）。
    */
    await panel.scrollIntoViewIfNeeded();

    /*
      🔴 把"图里真的是那一节"从人眼步骤升级成一条几何判据：截图之前量一次盒子，
      要求它的**顶边在视口内**。没有这一条，下一次有人把 `scrollIntoViewIfNeeded`
      删掉或把这一节挪到浮层更深处，红只会出现在"人看图"那一格（而那一格经常被跳过），
      而它红的时候已经太晚了 —— 同 §7 第 82 条"错误屏也非空白"是一个家族：
      **判据要能自己变红，不能靠人替它红**。
    */
    const panelBox = await panel.boundingBox();
    expect(panelBox, '量不到「同步」那一节的盒子').not.toBeNull();
    const viewportSize = page.viewportSize();
    expect(
      panelBox!.y >= 0 && panelBox!.y < (viewportSize?.height ?? 0),
      `截图时那一节的顶边在 y=${String(Math.round(panelBox!.y))}，不在视口里 ⇒ 那张图拍的不是它`,
    ).toBe(true);

    // 🔴 先截图再断言（§6.2 规定一第 1 条）：这张图是"同步设置搬到设置里之后
    //    到底长什么样"的唯一人眼证据，红的时候也必须留着它。
    await parkCursor(page);
    await page.screenshot({ path: SHOT('settings-sync-section') });

    // 共享那枚状态条骨架的**消费者从页头改成了这里**，不是被删：
    // 拿掉它会同时让 `check:ui-provider` 红（那枚组件登记在 PROVIDER_DEPENDENT 里）。
    await expect(
      panel.getByTestId('sync-status-bar'),
      '「同步设置」那一节里没有状态条 ⇒ 搬家的收尾是把旧的删了',
    ).toBeVisible();

    // 字段这一半：地址与令牌必须在（口令在未登录时也在）。
    for (const label of ['服务端地址', '访问令牌']) {
      await expect(
        panel.getByLabel(label),
        `那一节里没有「${label}」的输入框 ⇒ 表单只搬了一半`,
      ).toHaveCount(1);
    }
    await expect(
      panel.getByRole('button', { name: '保存并同步' }),
      '那一节没有「保存并同步」⇒ 填了也没法生效',
    ).toHaveCount(1);
  });

  test('S4 🔴 同步设置只有一处，而那一处住在设置浮层里', async ({ page }) => {
    await openApp(page, APP_ZH);

    // 齿轮必须真的没了 —— 产品负责人第 2 条的病根就是它**长得像**全局设置。
    await expect(
      page.getByTestId('sync-settings-entry'),
      'rail 上还有那颗「同步设置」齿轮 ⇒ 旧入口没删（AGENTS §3.5：抽取的收尾是删掉旧的那份）',
    ).toHaveCount(0);
    // 「查看帮助」也跟着表单搬进设置，不再常驻 rail 那一列。
    await expect(
      page.locator('.ht-rail__sync [data-testid="sync-help-link"]'),
      'rail 里还留着「查看帮助」⇒ 它现在住在 设置 → 同步 那一节',
    ).toHaveCount(0);
    // 未打开设置时，屏幕上不该有同步表单（它不是常驻的同级浮层了）。
    await expect(
      page.getByLabel('服务端地址'),
      '没进设置就能读到服务端地址输入框 ⇒ 那一节其实是常驻浮层',
    ).toHaveCount(0);

    await openSettingsView(page);
    // 「有且只有一处」：多处会红，缺一处也会红。
    await expect(page.getByTestId('sync-settings-panel'), '同步设置不止一处').toHaveCount(1);
    await expect(page.getByLabel('服务端地址'), '地址输入框不止一处').toHaveCount(1);

    await closeSettingsSheet(page);
    await expect(
      page.getByTestId('sync-settings-panel'),
      '关掉设置之后那一节还在 DOM 里 ⇒ 它其实不是设置的一部分',
    ).toHaveCount(0);
  });
});
